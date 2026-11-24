// Helpers shared by the AI providers.

// Conversation history comes from the database; only these two roles may be
// sent to a model as turns. Anything else (a stray "system" row, a role a
// client tried to inject) is dropped rather than forwarded.
const TURN_ROLES = new Set(['user', 'assistant']);

function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && TURN_ROLES.has(m.role) && m.content != null && m.content !== '')
    .map((m) => ({ role: m.role, content: String(m.content) }));
}

// Anthropic-format responses are a list of content blocks; a model that
// thinks first returns a thinking block before the text. Join the text.
function textFromBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

// An error callers and the admin UI can act on.
function providerError(message, { code, status, cause } = {}) {
  const err = new Error(message);
  err.name = 'AIProviderError';
  if (code) err.code = code;
  if (status) err.status = status;
  if (cause) err.cause = cause;
  return err;
}

module.exports = { cleanMessages, textFromBlocks, providerError };
