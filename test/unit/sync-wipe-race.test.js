const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Regression pin for PR #41 (P1, re-review): a dispatched PUT cannot be
// recalled, and a stale check after its response cannot undo the server
// mutation — so disable({wipeRemote}) must drain the active sync pass
// (network included) BEFORE issuing the DELETE, or the wipe can be undone
// by a request that was already on the wire.
//
// sync.js reaches electron only through `net.fetch` and (via JsonStore)
// `app.getPath('userData')`; stub both through the require cache so the real
// module runs under node --test with a deferred-fetch fake worker.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-sync-race-'));
let fetchImpl = async () => { throw new Error('fetch stub not installed'); };
const electronId = require.resolve('electron');
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: {
    net: { fetch: (...args) => fetchImpl(...args) },
    app: { getPath: () => tmp, on: () => {} },
  },
};

const sync = require('../../src/main/sync');

test('a successful wipe cannot be undone by an already-dispatched PUT', async () => {
  // Fake worker: blobs apply in settlement order, like the real network.
  const kv = new Map();
  const events = [];
  let releasePut;
  const putGate = new Promise((resolve) => { releasePut = resolve; });
  let signalPutDispatched;
  const putDispatched = new Promise((resolve) => { signalPutDispatched = resolve; });

  fetchImpl = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    const store = String(url).split('/').pop();
    if (method === 'GET') return { status: 404, ok: false };
    if (method === 'PUT') {
      signalPutDispatched();
      await putGate; // the request is on the wire — undeliverable, unrecallable
      kv.set(store, 'ciphertext');
      events.push('put-landed');
      return { status: 200, ok: true, json: async () => ({ version: 'v1' }) };
    }
    if (method === 'DELETE') {
      kv.clear();
      events.push('delete');
      return { status: 204, ok: true };
    }
    throw new Error(`unexpected ${method}`);
  };

  // Seed enabled credentials directly (JsonStore reads tmp/sync.json).
  fs.writeFileSync(path.join(tmp, 'sync.json'), JSON.stringify({
    enabled: true,
    handle: 'race-test',
    accountId: 'a'.repeat(64),
    key: Buffer.alloc(32, 7).toString('base64'),
    lastSyncedAt: 0,
    lastError: null,
    deviceId: 'race-device',
    syncTabs: false,
  }));

  const pass = sync.syncNow(['session']); // GET 404 → export → PUT dispatched
  await putDispatched;

  const wipe = sync.disable({ wipeRemote: true }); // must drain the pass first
  // Give an incorrect implementation every chance to fire its DELETE early.
  await new Promise((resolve) => setImmediate(resolve));
  releasePut(); // the network finally delivers the stranded PUT

  const [passResult, wipeResult] = await Promise.all([pass, wipe]);

  assert.equal(wipeResult.ok, true, 'wipe reports success');
  assert.ok(events.includes('delete'), 'DELETE reached the worker');
  assert.ok(
    events.indexOf('delete') > events.indexOf('put-landed'),
    `DELETE must come after the in-flight PUT settles — got order ${JSON.stringify(events)}`
  );
  assert.equal(kv.size, 0, `wiped account must stay empty — got ${JSON.stringify([...kv.keys()])}`);
  void passResult; // stranded pass's result is unspecified; it must simply settle
});
