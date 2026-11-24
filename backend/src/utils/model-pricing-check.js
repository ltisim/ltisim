const pool = require('../config/database');

// Startup audit: warn when a model that is actually in use (env defaults or
// any assignment's ai_provider_config) has no pricing row in ai_models.
// Calls on unpriced models log ai_usage.cost_usd = NULL, which understates
// cost reporting and budget quotas — better to hear about it at boot
// than discover it in a monthly statement.
//
// Fail-safe: logs and returns on any error; never blocks startup.

async function checkModelPricing() {
  try {
    const configured = new Set(
      [process.env.AI_MODEL, process.env.AI_GRADING_MODEL].filter(Boolean)
    );

    const { rows: assignmentModels } = await pool.query(`
      SELECT DISTINCT model FROM (
        SELECT ai_provider_config->>'model' AS model FROM assignments
        UNION
        SELECT ai_provider_config->>'grading_model' FROM assignments
      ) t WHERE model IS NOT NULL AND model <> ''
    `);
    for (const r of assignmentModels) configured.add(r.model);

    if (configured.size === 0) return;

    const { rows: priced } = await pool.query(
      `SELECT model_id FROM ai_models
       WHERE input_cost_per_1k IS NOT NULL AND output_cost_per_1k IS NOT NULL`
    );
    const pricedSet = new Set(priced.map((r) => r.model_id));

    const unpriced = [...configured].filter((m) => !pricedSet.has(m));
    if (unpriced.length > 0) {
      console.warn(
        `[model-pricing] ${unpriced.length} configured model(s) have no pricing in ai_models — ` +
        `their usage will log cost_usd = NULL: ${unpriced.join(', ')}`
      );
    } else {
      console.log(`[model-pricing] all ${configured.size} configured models have pricing`);
    }
  } catch (err) {
    console.error('[model-pricing] startup check failed:', err.message);
  }
}

module.exports = { checkModelPricing };
