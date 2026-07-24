const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-sync-icons-'));
const requests = [];
let responseStatus = 404;
const electronId = require.resolve('electron');
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: {
    nativeImage: {},
    net: {
      fetch: async (url, opts = {}) => {
        requests.push({ url: String(url), method: opts.method ?? 'GET' });
        return { status: responseStatus, ok: responseStatus >= 200 && responseStatus < 300 };
      },
    },
    app: { getPath: () => tmp, on: () => {} },
  },
};

fs.writeFileSync(path.join(tmp, 'sync.json'), JSON.stringify({
  enabled: true,
  handle: 'compat-test',
  accountId: 'a'.repeat(64),
  key: Buffer.alloc(32, 7).toString('base64'),
  lastSyncedAt: 1234,
  lastError: 'A required store failed earlier.',
  deviceId: 'compat-device',
  syncTabs: true,
}));

const sync = require('../../src/main/sync');

test('an older Worker rejecting the optional icons store does not fail profile sync', async () => {
  const result = await sync.syncNow(['icons']);
  assert.equal(result.ok, true);
  assert.deepEqual(requests.map(({ method }) => method), ['GET', 'PUT']);
  assert.equal(sync.status().lastSyncedAt, 1234);
  assert.equal(sync.status().lastError, 'A required store failed earlier.');
});

test('an optional icon-store outage cannot overwrite the primary profile sync status', async () => {
  requests.length = 0;
  responseStatus = 500;
  const result = await sync.syncNow(['icons']);
  assert.equal(result.ok, true);
  assert.deepEqual(requests.map(({ method }) => method), ['GET']);
  assert.equal(sync.status().lastSyncedAt, 1234);
  assert.equal(sync.status().lastError, 'A required store failed earlier.');
});
