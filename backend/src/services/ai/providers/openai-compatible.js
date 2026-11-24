// OpenAI-compatible provider (AI_PROVIDER=openai-compatible).
//
// Speaks the Chat Completions wire format over plain HTTP, which covers
// OpenAI, Azure OpenAI, and the many servers that copy the format (Ollama,
// vLLM, LM Studio, LiteLLM and other gateways).
//
// Environment:
//   AI_BASE_URL          API root, e.g. https://api.openai.com/v1 (the default)
//                        or http://localhost:11434/v1. A query string is kept
//                        (Azure's ?api-version=...).
//   AI_API_KEY           Sent as "Authorization: Bearer ...". Optional for
//                        local servers.
//   AI_EXTRA_HEADERS     JSON object of extra headers, e.g. {"api-key":"..."}
//                        for Azure.
//   AI_MAX_TOKENS_PARAM  "max_tokens" (default) or "max_completion_tokens".
//   AI_TIMEOUT_MS        Per-request timeout (default 120000; streaming 600000).
//
// Servers differ in which optional fields they accept. Rather than keeping a
// table of products, a request that is rejected as malformed (HTTP 400) is
// retried with fewer optional fields, and what worked is remembered per
// model for the life of the process.
const BaseAIProvider = require('./base');
const { cleanMessages, providerError } = require('./shared');

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const OTHER_TOKENS_PARAM = { max_tokens: 'max_completion_tokens', max_completion_tokens: 'max_tokens' };

// model id -> { noSampling, tokensParam, noStreamUsage }
const quirks = new Map();

function extraHeaders() {
  if (!process.env.AI_EXTRA_HEADERS) return {};
  try {
    const parsed = JSON.parse(process.env.AI_EXTRA_HEADERS);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw providerError('AI_EXTRA_HEADERS is not valid JSON.', { code: 'AI_CONFIG' });
  }
}

// Chat Completions content is usually a string; some servers return parts.
function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  }
  return '';
}

const STOP_REASONS = { stop: 'end_turn', length: 'max_tokens', content_filter: 'refusal' };

class OpenAICompatibleProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.modelId = config.model;
    this.baseUrl = (config.baseUrl || process.env.AI_BASE_URL || DEFAULT_BASE_URL).trim();
    this.fetch = config.fetch || globalThis.fetch; // injectable for tests
  }

  // Join a path onto the base URL, keeping any query string on the base.
  url(path) {
    const [root, query] = this.baseUrl.split('?');
    return `${root.replace(/\/+$/, '')}${path}${query ? `?${query}` : ''}`;
  }

  headers() {
    return {
      'Content-Type': 'application/json',
      ...(process.env.AI_API_KEY && { Authorization: `Bearer ${process.env.AI_API_KEY}` }),
      ...extraHeaders(),
    };
  }

  quirks() {
    if (!quirks.has(this.modelId)) {
      quirks.set(this.modelId, {
        noSampling: false,
        tokensParam: process.env.AI_MAX_TOKENS_PARAM === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens',
        noStreamUsage: false,
      });
    }
    return quirks.get(this.modelId);
  }

  body({ systemPrompt, messages, options }, { stream }) {
    const q = this.quirks();
    const body = {
      model: this.modelId,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...cleanMessages(messages),
      ],
      [q.tokensParam]: options.max_tokens ?? 2048,
    };
    if (!q.noSampling) {
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (options.top_p !== undefined) body.top_p = options.top_p;
    }
    if (stream) {
      body.stream = true;
      if (!q.noStreamUsage) body.stream_options = { include_usage: true };
    }
    return body;
  }

  // Loosen one optional field after a 400. Returns false when nothing is
  // left to try, so the original error is reported.
  relax(request, { stream }, tried) {
    const q = this.quirks();
    if (stream && !q.noStreamUsage && !tried.has('usage')) {
      tried.add('usage'); q.noStreamUsage = true; return true;
    }
    const sentSampling = request.options.temperature !== undefined || request.options.top_p !== undefined;
    if (sentSampling && !q.noSampling && !tried.has('sampling')) {
      tried.add('sampling'); q.noSampling = true; return true;
    }
    if (!tried.has('tokens')) {
      tried.add('tokens'); q.tokensParam = OTHER_TOKENS_PARAM[q.tokensParam]; return true;
    }
    return false;
  }

  async send(request, { stream }) {
    const tried = new Set();
    const before = { ...this.quirks() };
    for (;;) {
      let response;
      try {
        response = await this.fetch(this.url('/chat/completions'), {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(this.body(request, { stream })),
          signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || (stream ? 600_000 : 120_000)),
        });
      } catch (error) {
        if (error?.name === 'AIProviderError') throw error;
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        throw providerError(
          timedOut ? 'The AI endpoint did not respond in time.' : `Could not reach the AI endpoint at ${this.url('')}: ${error.message}`,
          { code: timedOut ? 'AI_TIMEOUT' : 'AI_UNREACHABLE', cause: error }
        );
      }
      if (response.ok) return response;

      const detail = await this.errorDetail(response);
      if (response.status === 400 && this.relax(request, { stream }, tried)) continue;
      // Nothing worked: do not keep guesses that did not help.
      if (response.status === 400) quirks.set(this.modelId, before);
      throw this.httpError(response.status, detail);
    }
  }

  async errorDetail(response) {
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        return String(json?.error?.message || json?.error || json?.message || text).slice(0, 300);
      } catch {
        return text.slice(0, 300);
      }
    } catch {
      return '';
    }
  }

  httpError(status, detail) {
    const tail = detail ? `: ${detail}` : '';
    if (status === 401 || status === 403) {
      return providerError(`The AI endpoint rejected the credentials (HTTP ${status})${tail}`, { code: 'AI_AUTH', status });
    }
    if (status === 404) {
      return providerError(`Model "${this.modelId}" or the endpoint was not found (HTTP 404)${tail}`, { code: 'AI_MODEL_NOT_FOUND', status });
    }
    if (status === 429) {
      return providerError(`The AI endpoint's rate limit was reached${tail}`, { code: 'AI_RATE_LIMITED', status });
    }
    return providerError(`AI endpoint error (HTTP ${status})${tail}`, { code: 'AI_ERROR', status });
  }

  result(content, usage, finishReason) {
    return {
      content,
      usage: { inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens },
      metadata: { model: this.modelId, stopReason: STOP_REASONS[finishReason] || finishReason || null },
    };
  }

  async chat({ systemPrompt, messages, options = {} }) {
    const response = await this.send({ systemPrompt, messages, options }, { stream: false });
    let json;
    try {
      json = await response.json();
    } catch (error) {
      throw providerError('The AI endpoint returned a response that is not JSON.', { code: 'AI_ERROR', cause: error });
    }
    const choice = json?.choices?.[0];
    if (!choice) throw providerError('The AI endpoint returned no choices.', { code: 'AI_ERROR' });
    return this.result(contentText(choice.message?.content), json.usage, choice.finish_reason);
  }

  // Server-sent events: "data: {json}" lines, ended by "data: [DONE]".
  async chatStream({ systemPrompt, messages, options = {}, onDelta }) {
    const response = await this.send({ systemPrompt, messages, options }, { stream: true });
    if (!response.body) throw providerError('The AI endpoint returned no stream.', { code: 'AI_ERROR' });

    let content = '';
    let usage;
    let finishReason;
    const handle = (line) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let chunk;
      try { chunk = JSON.parse(data); } catch { return; } // keep-alives, partial junk
      if (chunk.error) {
        throw providerError(`AI endpoint error: ${String(chunk.error.message || chunk.error).slice(0, 300)}`, { code: 'AI_ERROR' });
      }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = contentText(choice.delta?.content);
      if (delta) {
        content += delta;
        if (onDelta) onDelta(delta);
      }
    };

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of response.body) {
      buffer += decoder.decode(bytes, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        handle(buffer.slice(0, newline).trimEnd());
        buffer = buffer.slice(newline + 1);
      }
    }
    if (buffer.trim()) handle(buffer.trim());

    return this.result(content, usage, finishReason);
  }

  // Models the endpoint reports, for the administrator's model list.
  async listModels() {
    let response;
    try {
      response = await this.fetch(this.url('/models'), {
        headers: this.headers(),
        signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || 30_000),
      });
    } catch (error) {
      throw providerError(`Could not reach the AI endpoint at ${this.url('')}: ${error.message}`, { code: 'AI_UNREACHABLE', cause: error });
    }
    if (!response.ok) throw this.httpError(response.status, await this.errorDetail(response));
    const json = await response.json();
    const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
    return list
      .map((m) => ({ id: m.id || m.name, name: m.id || m.name }))
      .filter((m) => m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}

// For tests.
OpenAICompatibleProvider._reset = () => quirks.clear();

module.exports = OpenAICompatibleProvider;
