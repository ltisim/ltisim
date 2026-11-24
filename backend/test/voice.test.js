const test = require('node:test');
const assert = require('node:assert');
const voice = require('../src/services/voice');

function withEnv(env, state, fn) {
  const keys = ['VOICE_MODE', 'VOICE_REPLIES', 'AWS_VOICE_REGION', 'AWS_BEDROCK_REGION', 'AWS_REGION'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  keys.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  voice._reset(state);
  try { return fn(); } finally {
    keys.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
    voice._reset();
  }
}
const pick = ({ input, browser_fallback, replies }) => ({ input, browser_fallback, replies });

test('auto with AWS: Amazon for both, browser allowed as fallback', () => {
  withEnv({}, { credentials: true }, () =>
    assert.deepStrictEqual(pick(voice.status()), { input: 'aws', browser_fallback: true, replies: true }));
});

test('auto without AWS credentials: browser input, no replies', () => {
  withEnv({}, { credentials: false }, () =>
    assert.deepStrictEqual(pick(voice.status()), { input: 'browser', browser_fallback: false, replies: false }));
});

test('aws mode never hands audio to the browser', () => {
  withEnv({ VOICE_MODE: 'aws' }, { credentials: true }, () =>
    assert.deepStrictEqual(pick(voice.status()), { input: 'aws', browser_fallback: false, replies: true }));
  withEnv({ VOICE_MODE: 'aws' }, { credentials: false }, () =>
    assert.deepStrictEqual(pick(voice.status()), { input: 'off', browser_fallback: false, replies: false }));
  withEnv({ VOICE_MODE: 'aws' }, { credentials: true, transcribeDenied: true }, () =>
    assert.deepStrictEqual(pick(voice.status()), { input: 'off', browser_fallback: false, replies: true }));
});

test('browser mode never uses AWS, even when credentials exist', () => {
  withEnv({ VOICE_MODE: 'browser' }, { credentials: true }, () => {
    assert.deepStrictEqual(pick(voice.status()), { input: 'browser', browser_fallback: false, replies: false });
    assert.strictEqual(voice.usesAws(), false);
  });
});

test('off turns everything off', () => {
  withEnv({ VOICE_MODE: 'off' }, { credentials: true }, () =>
    assert.deepStrictEqual(pick(voice.status()), { input: 'off', browser_fallback: false, replies: false }));
});

test('an unknown mode is treated as auto', () => {
  withEnv({ VOICE_MODE: 'whatever' }, { credentials: true }, () => assert.strictEqual(voice.status().mode, 'auto'));
});

test('replies can be switched off or denied without affecting input', () => {
  withEnv({ VOICE_REPLIES: 'false' }, { credentials: true }, () =>
    assert.deepStrictEqual(pick(voice.status()), { input: 'aws', browser_fallback: true, replies: false }));
  withEnv({}, { credentials: true, pollyDenied: true }, () =>
    assert.deepStrictEqual(pick(voice.status()), { input: 'aws', browser_fallback: true, replies: false }));
});

test('a denied permission and bad credentials are remembered; other errors are not', () => {
  withEnv({}, { credentials: true }, () => {
    assert.strictEqual(voice.noteAwsError('transcribe', { name: 'ThrottlingException' }), false);
    assert.strictEqual(voice.status().input, 'aws');
    assert.strictEqual(voice.noteAwsError('transcribe', { name: 'AccessDeniedException' }), true);
    assert.deepStrictEqual(pick(voice.status()), { input: 'browser', browser_fallback: false, replies: true });
    assert.strictEqual(voice.noteAwsError('polly', { name: 'CredentialsProviderError' }), true);
    assert.strictEqual(voice.status().replies, false);
  });
});

test('region: voice setting, then Bedrock region, then AWS_REGION, then us-east-1', () => {
  withEnv({}, {}, () => assert.strictEqual(voice.region(), 'us-east-1'));
  withEnv({ AWS_REGION: 'eu-west-1' }, {}, () => assert.strictEqual(voice.region(), 'eu-west-1'));
  withEnv({ AWS_REGION: 'eu-west-1', AWS_BEDROCK_REGION: 'us-west-2' }, {}, () => assert.strictEqual(voice.region(), 'us-west-2'));
  withEnv({ AWS_BEDROCK_REGION: 'us-west-2', AWS_VOICE_REGION: 'ap-southeast-2' }, {}, () => assert.strictEqual(voice.region(), 'ap-southeast-2'));
});
