const assert = require('node:assert/strict');
const test = require('node:test');

const { HANDOFF_PROTOCOLS, classifyExternalNavigation } = require('../../src/main/external-protocols');

test('web-initiated external protocols require confirmation, never open directly', () => {
  for (const url of ['mailto:a@b.c', 'tel:+15550100', 'sms:+15550100', 'facetime:a@b.c']) {
    const decision = classifyExternalNavigation(url, { trusted: false });
    assert.equal(decision.action, 'confirm', `${url} must be confirmed`);
  }
  // Default is untrusted — an entry point that forgets the option must
  // land on the confirm path, not the open path.
  assert.equal(classifyExternalNavigation('mailto:a@b.c').action, 'confirm');
});

test('typed address-bar input opens without a prompt', () => {
  const decision = classifyExternalNavigation('mailto:a@b.c', { trusted: true });
  assert.equal(decision.action, 'open');
  assert.equal(decision.protocol, 'mailto:');
});

test('non-allowlisted schemes are never handed to the OS, trusted or not', () => {
  for (const url of [
    'https://example.com',
    'javascript:alert(1)',
    'vbscript:x',
    'file:///etc/passwd',
    'steam://run/1',
    'not a url',
    '',
  ]) {
    assert.equal(classifyExternalNavigation(url, { trusted: false }).action, 'none', url);
    assert.equal(classifyExternalNavigation(url, { trusted: true }).action, 'none', url);
  }
});

test('the allowlist stays deliberately small', () => {
  // Growing this set is a product decision with a security review, not a
  // drive-by: every entry is a "launch another application" capability.
  assert.deepEqual([...HANDOFF_PROTOCOLS].sort(), ['facetime:', 'mailto:', 'sms:', 'tel:']);
});
