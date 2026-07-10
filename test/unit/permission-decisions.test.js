const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizedMediaTypes,
  keyFor,
  storedDecision,
  rememberDecision,
} = require('../../src/main/permission-decisions');

test('normalizes media scopes and keys camera separately from microphone', () => {
  assert.deepEqual(normalizedMediaTypes(['video', 'audio', 'video', 'other']), ['audio', 'video']);
  assert.equal(keyFor('https://example.com', 'media', 'audio'), 'https://example.com|media|audio');
  assert.equal(keyFor('https://example.com', 'media', 'video'), 'https://example.com|media|video');
});

test('a microphone grant does not authorize camera', () => {
  const decisions = {};
  rememberDecision(decisions, 'https://example.com', 'media', ['audio'], true);

  assert.equal(storedDecision(decisions, 'https://example.com', 'media', 'audio'), 'allow');
  assert.equal(storedDecision(decisions, 'https://example.com', 'media', 'video'), null);
});

test('combined media prompts store one decision per device type', () => {
  const decisions = {};
  rememberDecision(decisions, 'https://example.com', 'media', ['video', 'audio'], false);

  assert.equal(decisions['https://example.com|media|audio'], 'deny');
  assert.equal(decisions['https://example.com|media|video'], 'deny');
});

test('legacy media allows are re-prompted while legacy denies stay safe', () => {
  assert.equal(storedDecision(
    { 'https://example.com|media': 'allow' },
    'https://example.com',
    'media',
    'video'
  ), null);
  assert.equal(storedDecision(
    { 'https://example.com|media': 'deny' },
    'https://example.com',
    'media',
    'video'
  ), 'deny');
});
