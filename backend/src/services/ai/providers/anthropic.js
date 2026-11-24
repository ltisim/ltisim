// Anthropic API provider (AI_PROVIDER=anthropic), using the official SDK.
//
// Credentials: AI_API_KEY, or the SDK's own resolution (ANTHROPIC_API_KEY,
// ANTHROPIC_AUTH_TOKEN, an `ant auth login` profile). AI_BASE_URL overrides
// the endpoint for gateways.
//
// Model IDs are supplied by the administrator, so nothing here assumes a
// particular model. Two things differ between models and are discovered at
// runtime instead:
//   - whether the model thinks before answering (Models API capabilities):
//     thinking counts toward max_tokens, so those models get headroom on top
//     of the reply length the caller asked for;
//   - whether the model accepts sampling parameters (temperature, top_p):
//     newer models reject them, so a rejected request is retried once
//     without them and the model is remembered.
const sdk = require('@anthropic-ai/sdk');
const BaseAIProvider = require('./base');
const { cleanMessages, textFromBlocks, providerError } = require('./shared');

const Anthropic = sdk.default || sdk;

// Extra output budget for models that think first.
const THINKING_HEADROOM = { conversation: 4000, default: 16000 };

// Per-process memory of what each model supports.
const capabilityCache = new Map(); // model id -> Promise<{ thinks, effort }>
const noSampling = new Set(); // model ids that rejected sampling parameters

class AnthropicProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.modelId = config.model;
    // `client` is injectable for tests.
    this.client = config.client || new Anthropic({
      ...(process.env.AI_API_KEY && { apiKey: process.env.AI_API_KEY }),
      ...(process.env.AI_BASE_URL && { baseURL: process.env.AI_BASE_URL }),
    });
  }

  // What this model supports, from the Models API. Unknown (lookup failed,
  // gateway without the endpoint) is treated as a plain model.
  capabilities() {
    if (!capabilityCache.has(this.modelId)) {
      capabilityCache.set(this.modelId, this.client.models.retrieve(this.modelId)
        .then((m) => ({
          thinks: m?.capabilities?.thinking?.types?.adaptive?.supported === true,
          effort: m?.capabilities?.effort?.supported === true,
        }))
        .catch(() => {
          capabilityCache.delete(this.modelId); // try again on a later call
          return { thinks: false, effort: false };
        }));
    }
    return capabilityCache.get(this.modelId);
  }

  async buildParams({ systemPrompt, messages, options }, { withSampling }) {
    const caps = await this.capabilities();
    const conversation = options.purpose === 'conversation';
    const requested = options.max_tokens ?? 2048;

    const params = {
      model: this.modelId,
      max_tokens: caps.thinks
        ? requested + (conversation ? THINKING_HEADROOM.conversation : THINKING_HEADROOM.default)
        : requested,
      messages: cleanMessages(messages),
    };
    if (systemPrompt) params.system = systemPrompt;
    // A live role-play turn should answer promptly; grading and drafting keep
    // the model's own default depth.
    if (conversation && caps.effort) params.output_config = { effort: 'low' };
    if (withSampling) {
      if (options.temperature !== undefined) params.temperature = options.temperature;
      if (options.top_p !== undefined) params.top_p = options.top_p;
    }
    return params;
  }

  // Every request streams (large output budgets would otherwise risk HTTP
  // timeouts); callers that do not want deltas simply pass no onDelta.
  async run(request, onDelta) {
    const wantsSampling = request.options.temperature !== undefined || request.options.top_p !== undefined;
    let withSampling = wantsSampling && !noSampling.has(this.modelId);

    for (;;) {
      const params = await this.buildParams(request, { withSampling });
      let emitted = false;
      try {
        const stream = this.client.messages.stream(params);
        if (onDelta) {
          stream.on('text', (delta) => {
            emitted = true;
            onDelta(delta);
          });
        }
        const message = await stream.finalMessage();
        return this.toResult(message);
      } catch (error) {
        // A model that rejects sampling parameters fails before any output:
        // remember it and retry once without them.
        if (error instanceof Anthropic.BadRequestError && withSampling && !emitted) {
          noSampling.add(this.modelId);
          withSampling = false;
          continue;
        }
        throw this.translate(error);
      }
    }
  }

  toResult(message) {
    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category;
      throw providerError(
        `The model declined this request${category ? ` (${category})` : ''}.`,
        { code: 'AI_REFUSED' }
      );
    }
    return {
      content: textFromBlocks(message.content),
      usage: {
        inputTokens: message.usage?.input_tokens,
        outputTokens: message.usage?.output_tokens,
      },
      metadata: { model: this.modelId, stopReason: message.stop_reason },
    };
  }

  // Most specific first; messages are written for the administrator.
  translate(error) {
    if (error?.name === 'AIProviderError') return error;
    if (error instanceof Anthropic.AuthenticationError) {
      return providerError('The Anthropic API rejected the credentials. Check AI_API_KEY.', { code: 'AI_AUTH', status: 401, cause: error });
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      return providerError(`This API key may not use model "${this.modelId}".`, { code: 'AI_AUTH', status: 403, cause: error });
    }
    if (error instanceof Anthropic.NotFoundError) {
      return providerError(`Model "${this.modelId}" was not found on the Anthropic API.`, { code: 'AI_MODEL_NOT_FOUND', status: 404, cause: error });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return providerError('The Anthropic API rate limit was reached. Try again shortly.', { code: 'AI_RATE_LIMITED', status: 429, cause: error });
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return providerError('Could not reach the Anthropic API.', { code: 'AI_UNREACHABLE', cause: error });
    }
    if (error instanceof Anthropic.APIError) {
      return providerError(`Anthropic API error ${error.status ?? ''}: ${error.message}`.trim(), { code: 'AI_ERROR', status: error.status, cause: error });
    }
    return error;
  }

  async chat({ systemPrompt, messages, options = {} }) {
    return this.run({ systemPrompt, messages, options });
  }

  async chatStream({ systemPrompt, messages, options = {}, onDelta }) {
    return this.run({ systemPrompt, messages, options }, onDelta);
  }

  // Models this account can use, for the administrator's model list.
  async listModels() {
    const models = [];
    try {
      for await (const m of this.client.models.list()) {
        models.push({ id: m.id, name: m.display_name || m.id });
      }
    } catch (error) {
      throw this.translate(error);
    }
    return models;
  }
}

// For tests.
AnthropicProvider._reset = () => {
  capabilityCache.clear();
  noSampling.clear();
};

module.exports = AnthropicProvider;
