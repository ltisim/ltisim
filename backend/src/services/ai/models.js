// Which provider and models this instance offers.
//
// Nothing about models is built into the code:
//   - the provider comes from the environment (AI_PROVIDER), because it is
//     tied to credentials;
//   - the models instructors may pick are rows in the ai_models table,
//     managed by the administrator in the instance area;
//   - the default conversation and grading models are instance settings,
//     with AI_MODEL / AI_GRADING_MODEL as the fallback for installs that
//     prefer to configure them in the environment.
// Prices in ai_models are optional, entered by the administrator for their
// own cost tracking, and never shown to instructors.
const pool = require('../../config/database');

const PROVIDER_NAMES = {
  bedrock: 'AWS Bedrock',
  anthropic: 'Anthropic API',
  'openai-compatible': 'OpenAI-compatible API',
};

const currentProvider = () => process.env.AI_PROVIDER || 'bedrock';
const providerName = () => PROVIDER_NAMES[currentProvider()] || currentProvider();

// Defaults are read on every chat turn, so they are cached in memory and
// refreshed at boot, whenever the administrator changes them, and at most
// once a minute otherwise.
let cached = { default_model: null, default_grading_model: null };
let cachedAt = 0;
const CACHE_MS = 60_000;

async function refreshDefaults() {
  try {
    const { rows } = await pool.query('SELECT default_model, default_grading_model FROM instance_settings');
    cached = rows[0] || { default_model: null, default_grading_model: null };
    cachedAt = Date.now();
  } catch (err) {
    console.error('[ai-models] could not load default models:', err.message);
  }
  return cached;
}

function refreshIfStale() {
  if (Date.now() - cachedAt > CACHE_MS) refreshDefaults();
}

// The instance's default conversation model, or null when none is set.
function defaultModel() {
  refreshIfStale();
  return cached.default_model || process.env.AI_MODEL || null;
}

// The instance's default grading model; falls back to the conversation default.
function defaultGradingModel() {
  refreshIfStale();
  return cached.default_grading_model || process.env.AI_GRADING_MODEL || defaultModel();
}

// Where each default currently comes from, for the admin UI.
function defaultSources() {
  const source = (setting, envVar) => (cached[setting] ? 'instance' : process.env[envVar] ? 'environment' : 'unset');
  return {
    default_model: source('default_model', 'AI_MODEL'),
    default_grading_model: cached.default_grading_model
      ? 'instance'
      : process.env.AI_GRADING_MODEL ? 'environment' : 'conversation default',
  };
}

/**
 * Models instructors may select, for the configured provider. The
 * instance's default models are always included, even without a row.
 */
async function listModels() {
  const { rows } = await pool.query(
    `SELECT model_id, display_name
       FROM ai_models
      WHERE is_available AND provider = $1
      ORDER BY display_name`,
    [currentProvider()]
  );
  const models = rows.map((r) => ({ id: r.model_id, name: r.display_name }));
  for (const id of new Set([defaultModel(), defaultGradingModel()])) {
    if (id && !models.some((m) => m.id === id)) models.push({ id, name: id });
  }
  return models;
}

async function describe() {
  await refreshDefaults();
  return {
    provider: currentProvider(),
    provider_name: providerName(),
    default_model: defaultModel(),
    default_grading_model: defaultGradingModel(),
    models: await listModels(),
  };
}

/**
 * Clean an assignment's ai_provider_config before saving: the provider and
 * region are instance settings, and a model must be one this instance offers.
 * Returns { config } or { error }.
 */
async function normalizeAssignmentAiConfig(config) {
  if (config == null || typeof config !== 'object' || Array.isArray(config)) return { config: {} };
  const { provider, region, ...rest } = config; // eslint-disable-line no-unused-vars
  const allowed = new Set((await listModels()).map((m) => m.id));
  for (const field of ['model', 'grading_model']) {
    if (rest[field] === '' || rest[field] == null) {
      delete rest[field];
    } else if (!allowed.has(rest[field])) {
      return { error: `Model "${rest[field]}" is not available on this instance` };
    }
  }
  return { config: rest };
}

module.exports = {
  currentProvider,
  providerName,
  defaultModel,
  defaultGradingModel,
  defaultSources,
  refreshDefaults,
  listModels,
  describe,
  normalizeAssignmentAiConfig,
};
