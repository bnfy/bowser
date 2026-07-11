const assert = require('node:assert/strict');
const test = require('node:test');

// telemetry.js lazy-requires electron/store, so it loads under plain node;
// the reset takes an injectable store (the repo's webauthn-style DI idiom).
const { resetInstallId } = require('../../src/main/telemetry');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fakeStore(id, { writable = true } = {}) {
  return {
    data: { id },
    flushes: 0,
    update(fn) { fn(this.data); },
    // Mirrors JsonStore.flush's contract: true iff the write reached disk.
    flush() { this.flushes += 1; return writable; },
  };
}

test('reset mints a fresh id and persists it immediately', () => {
  const store = fakeStore('11111111-2222-4333-8444-555555555555');
  assert.equal(resetInstallId(store), true);

  assert.notEqual(store.data.id, '11111111-2222-4333-8444-555555555555');
  assert.match(store.data.id, UUID_RE, 'the new id is a well-formed token');
  assert.equal(store.flushes, 1, 'flushed now, not on the debounce — a crash must not resurrect the old id');
});

test('a failed disk write must not be reported as a successful reset', () => {
  // The old id survives on disk when the write fails, so it comes back next
  // launch — telling the user "reset" would be false.
  const store = fakeStore('11111111-2222-4333-8444-555555555555', { writable: false });
  assert.equal(resetInstallId(store), false);
});

test('every reset yields a new identity — no null gap, no reuse', () => {
  const store = fakeStore('11111111-2222-4333-8444-555555555555');
  const seen = new Set([store.data.id]);
  for (let i = 0; i < 3; i++) {
    resetInstallId(store);
    assert.ok(store.data.id, 'the store never holds a "no id" state');
    assert.ok(!seen.has(store.data.id), 'ids never repeat');
    seen.add(store.data.id);
  }
});
