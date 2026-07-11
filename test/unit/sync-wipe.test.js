const assert = require('node:assert/strict');
const test = require('node:test');

const { wipeDecision } = require('../../src/main/sync-wipe');

test('a failed remote wipe never clears the credentials needed to retry', () => {
  // Regression pin (2026-07-11 audit): disable({wipeRemote:true}) used to
  // report success and erase accountId/key even when the DELETE failed,
  // stranding unreachable ciphertext on the server.
  for (const outcome of [{ error: true }, { status: 500 }, { status: 429 }, { status: 403 }, { status: 404 }]) {
    const decision = wipeDecision(outcome);
    assert.equal(decision.clearCredentials, false, JSON.stringify(outcome));
    assert.equal(decision.ok, false, JSON.stringify(outcome));
    assert.ok(decision.message, 'failure must carry a user-facing reason');
  }
});

test('rate limiting gets its own actionable message', () => {
  assert.match(wipeDecision({ status: 429 }).message, /try again in a minute/i);
});

test('only a confirmed 2xx clears the local record', () => {
  for (const status of [200, 204]) {
    const decision = wipeDecision({ status });
    assert.equal(decision.clearCredentials, true);
    assert.equal(decision.ok, true);
    assert.equal(decision.message, null);
  }
});
