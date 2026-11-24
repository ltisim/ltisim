const { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
const BaseAIProvider = require('./base');
const { cleanMessages, textFromBlocks } = require('./shared');

// Model IDs that rejected sampling parameters (temperature, top_p); newer
// models do. Remembered for the life of the process.
const noSampling = new Set();

class BedrockProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.client = new BedrockRuntimeClient({
      region: config.region || process.env.AWS_BEDROCK_REGION || 'us-east-1',
      ...(process.env.AWS_ACCESS_KEY_ID && {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }),
    });
    this.modelId = config.model;
  }

  body({ systemPrompt, messages, options }) {
    const sampling = !noSampling.has(this.modelId);
    return JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: options.max_tokens ?? 2048,
      ...(sampling && { temperature: options.temperature ?? 0.7 }),
      ...(sampling && options.top_p !== undefined && { top_p: options.top_p }),
      ...(systemPrompt && { system: systemPrompt }),
      messages: cleanMessages(messages),
    });
  }

  // Send a command built from the request; if the model rejects the request
  // while sampling parameters were included, retry once without them.
  async sendWithFallback(request, makeCommand) {
    try {
      return await this.client.send(makeCommand(this.body(request)));
    } catch (error) {
      if (error?.name !== 'ValidationException' || noSampling.has(this.modelId)) throw error;
      noSampling.add(this.modelId);
      try {
        return await this.client.send(makeCommand(this.body(request)));
      } catch (retryError) {
        noSampling.delete(this.modelId); // sampling was not the problem
        throw retryError;
      }
    }
  }

  async chat({ systemPrompt, messages, options = {} }) {
    const response = await this.sendWithFallback({ systemPrompt, messages, options }, (body) => new InvokeModelCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    }));
    const result = JSON.parse(new TextDecoder().decode(response.body));

    return {
      content: textFromBlocks(result.content),
      usage: {
        inputTokens: result.usage?.input_tokens,
        outputTokens: result.usage?.output_tokens,
      },
      metadata: {
        model: this.modelId,
        stopReason: result.stop_reason,
      },
    };
  }

  // Streaming variant: onDelta(text) fires per text chunk; resolves with the
  // same shape chat() returns once the stream completes. Usage comes from the
  // message_start/message_delta events (falling back to the final
  // invocationMetrics), so ai_usage logging stays accurate.
  async chatStream({ systemPrompt, messages, options = {}, onDelta }) {
    const response = await this.sendWithFallback({ systemPrompt, messages, options }, (body) => new InvokeModelWithResponseStreamCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    }));

    let content = '';
    let inputTokens;
    let outputTokens;
    let stopReason;
    const decoder = new TextDecoder();

    for await (const event of response.body) {
      if (!event.chunk?.bytes) continue;
      const chunk = JSON.parse(decoder.decode(event.chunk.bytes));
      switch (chunk.type) {
        case 'message_start':
          inputTokens = chunk.message?.usage?.input_tokens ?? inputTokens;
          break;
        case 'content_block_delta':
          if (chunk.delta?.type === 'text_delta' && chunk.delta.text) {
            content += chunk.delta.text;
            if (onDelta) onDelta(chunk.delta.text);
          }
          break;
        case 'message_delta':
          outputTokens = chunk.usage?.output_tokens ?? outputTokens;
          stopReason = chunk.delta?.stop_reason ?? stopReason;
          break;
        case 'message_stop': {
          const metrics = chunk['amazon-bedrock-invocationMetrics'];
          if (metrics) {
            inputTokens = inputTokens ?? metrics.inputTokenCount;
            outputTokens = outputTokens ?? metrics.outputTokenCount;
          }
          break;
        }
        default:
          break;
      }
    }

    return {
      content,
      usage: { inputTokens, outputTokens },
      metadata: { model: this.modelId, stopReason },
    };
  }
}

module.exports = BedrockProvider;
