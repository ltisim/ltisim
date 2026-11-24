class BaseAIProvider {
  constructor(config = {}) {
    this.config = config;
  }

  async chat({ systemPrompt, messages, options = {} }) {
    throw new Error('chat() must be implemented by provider subclass');
  }

  async evaluate({ systemPrompt, messages, options = {} }) {
    return this.chat({ systemPrompt, messages, options: { ...options, temperature: 0.1 } });
  }

  // Default streaming fallback for providers without a native stream: run the
  // blocking chat and emit the whole reply as a single delta.
  async chatStream({ systemPrompt, messages, options = {}, onDelta }) {
    const result = await this.chat({ systemPrompt, messages, options });
    if (onDelta && result.content) onDelta(result.content);
    return result;
  }
}

module.exports = BaseAIProvider;
