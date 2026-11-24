const pool = require('../config/database');

// Fire-and-forget AI usage logger.
// Writes one row to ai_usage per model call. Never blocks or throws —
// failures are logged and swallowed so a telemetry bug can't break grading.
//
// Cost is resolved server-side from ai_models.{input,output}_cost_per_1k, or
// left NULL when the model isn't in the table.
//
// The table is defined in db/migrations/001_baseline.sql.

// Simple in-process cache for model pricing. Refreshed on miss.
const priceCache = new Map();

async function getModelPricing(model_id) {
  if (priceCache.has(model_id)) return priceCache.get(model_id);
  try {
    const { rows } = await pool.query(
      'SELECT input_cost_per_1k, output_cost_per_1k FROM ai_models WHERE model_id = $1',
      [model_id]
    );
    // A model can be listed without a price: that is "unpriced", not free.
    const row = rows[0];
    const pricing = row && row.input_cost_per_1k != null && row.output_cost_per_1k != null ? row : null;
    // Only cache hits — a miss stays uncached so pricing added later
    // takes effect without a restart.
    if (pricing) priceCache.set(model_id, pricing);
    return pricing;
  } catch (err) {
    console.error('[ai-usage] pricing lookup failed:', err.message);
    return null;
  }
}

/**
 * Log a single AI call.
 *
 * @param {object} opts
 * @param {number?} opts.platform_id    - Optional.
 * @param {number?} opts.assignment_id  - Optional.
 * @param {number?} opts.session_id     - Optional.
 * @param {string}  opts.model_id       - Required. Provider model ID.
 * @param {string}  opts.call_type      - 'chat' | 'evaluation' | 'preview'
 * @param {object}  opts.usage          - { inputTokens, outputTokens } from the provider response
 */
async function logAiUsage(opts) {
  const {
    platform_id = null,
    assignment_id = null,
    session_id = null,
    model_id,
    call_type,
    usage = {},
  } = opts || {};

  if (!model_id || !call_type) {
    console.warn('[ai-usage] missing model_id or call_type; skipping log');
    return;
  }

  try {
    const inputTokens = Number(usage.inputTokens) || 0;
    const outputTokens = Number(usage.outputTokens) || 0;
    const totalTokens = inputTokens + outputTokens;

    // Compute cost
    let costUsd = null;
    const pricing = await getModelPricing(model_id);
    if (pricing) {
      costUsd =
        (inputTokens / 1000) * Number(pricing.input_cost_per_1k) +
        (outputTokens / 1000) * Number(pricing.output_cost_per_1k);
      costUsd = Math.round(costUsd * 1e6) / 1e6;
    }

    await pool.query(
      `INSERT INTO ai_usage
         (platform_id, assignment_id, session_id,
          model_id, call_type, prompt_tokens, completion_tokens, total_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        platform_id,
        assignment_id,
        session_id,
        model_id,
        call_type,
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
      ]
    );
  } catch (err) {
    console.error('[ai-usage] failed to write row:', err.message, { model_id, call_type });
  }
}

// Called when an administrator changes a price, so it applies at once.
const clearPriceCache = () => priceCache.clear();

module.exports = { logAiUsage, clearPriceCache };
