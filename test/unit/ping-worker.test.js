const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

// The worker is an ES module (cloudflare/ping-worker/package.json sets
// type:module), so it's imported dynamically from this CJS test.
const WORKER_PATH = path.join(__dirname, '../../cloudflare/ping-worker/src/index.js');
let worker;
test.before(async () => {
  worker = (await import(pathToFileURL(WORKER_PATH))).default;
});

const RAW_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const HEX64 = /^[0-9a-f]{64}$/;

// Faithful to Cloudflare's list-keys semantics: keys come back in
// lexicographic order, the opaque cursor resumes AFTER the last key returned
// (so deletes during iteration can't skip keys), and — explicitly permitted
// by the API — a page may be EMPTY with list_complete:false, which callers
// must page through rather than treat as done. emptyPageOnCall injects one
// such page on the Nth list() call.
function fakeKV({ pageSize = Infinity, emptyPageOnCall = 0 } = {}) {
  const map = new Map();
  const kv = {
    map,
    listCalls: 0,
    emptyPageServed: false,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value) { map.set(key, String(value)); },
    async delete(key) { map.delete(key); },
    async list({ prefix = '', cursor } = {}) {
      kv.listCalls++;
      if (kv.listCalls === emptyPageOnCall) {
        kv.emptyPageServed = true;
        return { keys: [], list_complete: false, cursor: cursor ?? 'after:' };
      }
      const after = cursor ? cursor.slice('after:'.length) : '';
      const remaining = [...map.keys()].filter((k) => k.startsWith(prefix) && k > after).sort();
      const page = remaining.slice(0, pageSize);
      const done = page.length === remaining.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: done,
        cursor: done ? undefined : `after:${page[page.length - 1]}`,
      };
    },
  };
  return kv;
}

// Runs one ping and resolves after the KV writes AND the waitUntil'd GA
// forward settle, capturing any GA fetch bodies.
async function ping(env, body) {
  const gaCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    gaCalls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  const waited = [];
  const ctx = { waitUntil: (p) => waited.push(p) };
  try {
    const res = await worker.fetch(
      new Request('https://ping.test/ping', { method: 'POST', body: JSON.stringify(body) }),
      env, ctx
    );
    await Promise.all(waited);
    return { res, gaCalls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const PING_BODY = { installId: RAW_ID, sessionId: 42, version: '0.15.2', platform: 'darwin', arch: 'arm64' };

test('the raw install id never reaches storage — only the keyed hash does', async () => {
  const env = { PINGS: fakeKV(), INSTALL_HASH_SECRET: 'test-secret' };
  const { res } = await ping(env, PING_BODY);
  assert.equal(res.status, 204);

  const seenKeys = [...env.PINGS.map.keys()].filter((k) => k.startsWith('seen:'));
  assert.equal(seenKeys.length, 3, 'day, week, and month markers');
  for (const key of seenKeys) {
    const segment = key.slice(key.lastIndexOf(':') + 1);
    assert.match(segment, HEX64, key);
  }
  for (const key of env.PINGS.map.keys()) {
    assert.ok(!key.includes(RAW_ID), `raw id must not appear in any key: ${key}`);
  }
});

test('the hash is stable per install, so dedup still works', async () => {
  const env = { PINGS: fakeKV(), INSTALL_HASH_SECRET: 'test-secret' };
  await ping(env, PING_BODY);
  await ping(env, PING_BODY);
  // Second launch same day: the seen flag answers, the unique counter stays 1.
  const dayCounter = [...env.PINGS.map.entries()].find(([k]) => k.startsWith('active:day:'));
  assert.equal(dayCounter[1], '1');
  // A different secret re-buckets: different hash for the same install.
  const other = { PINGS: fakeKV(), INSTALL_HASH_SECRET: 'other-secret' };
  await ping(other, PING_BODY);
  const seenA = [...env.PINGS.map.keys()].find((k) => k.startsWith('seen:day:'));
  const seenB = [...other.PINGS.map.keys()].find((k) => k.startsWith('seen:day:'));
  assert.notEqual(seenA.slice(seenA.lastIndexOf(':') + 1), seenB.slice(seenB.lastIndexOf(':') + 1));
});

test('GA receives only the hashed token as client_id', async () => {
  const env = { PINGS: fakeKV(), INSTALL_HASH_SECRET: 'test-secret', GA_API_SECRET: 'ga-secret' };
  const { gaCalls } = await ping(env, PING_BODY);
  assert.equal(gaCalls.length, 1);
  const { client_id } = gaCalls[0].body;
  assert.match(client_id, HEX64);
  assert.notEqual(client_id, RAW_ID);
  // The KV marker and the GA client_id must be the SAME hash — that's the
  // stable-per-install property GA's active-user metrics rely on.
  const seenKey = [...env.PINGS.map.keys()].find((k) => k.startsWith('seen:day:'));
  assert.equal(client_id, seenKey.slice(seenKey.lastIndexOf(':') + 1));
});

test('no hashing secret fails closed: launches count, uniques and GA are skipped', async () => {
  const env = { PINGS: fakeKV(), GA_API_SECRET: 'ga-secret' }; // INSTALL_HASH_SECRET unset
  const { res, gaCalls } = await ping(env, PING_BODY);
  assert.equal(res.status, 204);
  assert.equal(gaCalls.length, 0, 'the raw id must never fall through to GA');
  const keys = [...env.PINGS.map.keys()];
  assert.equal(keys.filter((k) => k.startsWith('seen:')).length, 0);
  assert.equal(keys.filter((k) => k.startsWith('active:')).length, 0);
  assert.equal(env.PINGS.map.get('total'), '1', 'aggregate launch counts still work');
});

test('purge-legacy-ids deletes raw-UUID markers and nothing else', async () => {
  const env = { PINGS: fakeKV(), STATS_TOKEN: 'stats-token' };
  const hashed = 'a'.repeat(64);
  env.PINGS.map.set(`seen:month:2026-06:${RAW_ID}`, '1'); // legacy, old 800d TTL era
  env.PINGS.map.set(`seen:day:2026-07-10:${RAW_ID}`, '1'); // legacy
  env.PINGS.map.set(`seen:day:2026-07-11:${hashed}`, '1'); // post-migration
  env.PINGS.map.set('active:month:2026-06', '17'); // aggregate — must survive
  env.PINGS.map.set('total', '99');

  const res = await worker.fetch(
    new Request('https://ping.test/admin/purge-legacy-ids', {
      method: 'POST',
      headers: { Authorization: 'Bearer stats-token' },
    }),
    env, { waitUntil: () => {} }
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.done, true);
  assert.equal(body.deleted, 2);

  const keys = [...env.PINGS.map.keys()];
  assert.ok(!keys.some((k) => k.includes(RAW_ID)), 'legacy markers gone');
  assert.ok(keys.includes(`seen:day:2026-07-11:${hashed}`), 'hashed markers survive');
  assert.equal(env.PINGS.map.get('active:month:2026-06'), '17', 'aggregates survive');
});

test('purging more than one budget of legacy keys takes multiple calls to done:true', async () => {
  // 100-key pages force real cursor handling (805 legacy keys ≈ 9 pages),
  // and the third list() call returns Cloudflare's permitted empty page
  // with list_complete:false — the worker must page through it, not stop.
  const env = { PINGS: fakeKV({ pageSize: 100, emptyPageOnCall: 3 }), STATS_TOKEN: 'stats-token' };
  const hashed = 'b'.repeat(64);
  // 805 legacy markers — 800 is the per-invocation delete budget, so the
  // real migration path is call → done:false → call again → done:true.
  for (let i = 0; i < 805; i++) {
    const suffix = String(i).padStart(12, '0');
    env.PINGS.map.set(`seen:day:2026-07-10:01234567-89ab-4cde-8f01-${suffix}`, '1');
  }
  env.PINGS.map.set(`seen:day:2026-07-11:${hashed}`, '1');
  env.PINGS.map.set('active:day:2026-07-10', '805');

  const purge = () => worker.fetch(
    new Request('https://ping.test/admin/purge-legacy-ids', {
      method: 'POST',
      headers: { Authorization: 'Bearer stats-token' },
    }),
    env, { waitUntil: () => {} }
  ).then((res) => res.json());

  const first = await purge();
  assert.equal(first.done, false, 'the budget stops the first call short');
  assert.equal(first.deleted, 800);
  assert.ok(env.PINGS.listCalls >= 9, 'the worker actually paged (100-key pages)');
  assert.equal(env.PINGS.emptyPageServed, true, 'the empty list_complete:false page was served mid-run');

  const second = await purge();
  assert.equal(second.done, true);
  assert.equal(second.deleted, 5, 'the rerun finishes the remainder');

  const keys = [...env.PINGS.map.keys()];
  assert.equal(keys.filter((k) => k.startsWith('seen:') && !k.endsWith(hashed)).length, 0);
  assert.ok(keys.includes(`seen:day:2026-07-11:${hashed}`), 'hashed markers survive both passes');
  assert.equal(env.PINGS.map.get('active:day:2026-07-10'), '805', 'aggregates survive both passes');
});

test('purge-legacy-ids is bearer-gated and fails closed without a token', async () => {
  const kv = fakeKV();
  kv.map.set(`seen:day:2026-07-10:${RAW_ID}`, '1');
  for (const env of [
    { PINGS: kv, STATS_TOKEN: 'stats-token' }, // wrong header
    { PINGS: kv }, // no token configured at all
  ]) {
    const res = await worker.fetch(
      new Request('https://ping.test/admin/purge-legacy-ids', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong' },
      }),
      env, { waitUntil: () => {} }
    );
    assert.equal(res.status, 401);
  }
  assert.ok(kv.map.has(`seen:day:2026-07-10:${RAW_ID}`), 'nothing deleted on denial');
});
