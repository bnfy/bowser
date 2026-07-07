// Blanc's E2EE profile-sync store. Holds ONLY AES-GCM ciphertext keyed by an
// opaque accountId derived client-side from a passphrase we never see — this
// Worker cannot read, index, or merge any user data. Mirrors the honesty of
// cloudflare/ping-worker: no IPs, no ids, no browsing data. See the design
// spec in the main repo (docs/superpowers/specs/2026-07-07-profile-sync-design.md).

const STORES = new Set(['bookmarks', 'settings']); // history/session added in a later phase
const MAX_BLOB_BYTES = 512 * 1024;                 // favorites+settings are tiny; raise for history
const RATE_LIMIT = 30;                             // GETs per accountId per minute (anti-brute-force, spec §7)

const blobKey = (a, s) => `blob:${a}:${s}`;
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// KV has no atomic increment; a few concurrent GETs can undercount by one or
// two — fine for coarse throttling. A Durable Object is the drop-in upgrade
// if strictness is ever needed.
async function rateLimited(env, accountId) {
  const k = `rl:${accountId}:${Math.floor(Date.now() / 60000)}`;
  const n = parseInt((await env.SYNC.get(k)) ?? '0', 10);
  if (n >= RATE_LIMIT) return true;
  await env.SYNC.put(k, String(n + 1), { expirationTtl: 120 });
  return false;
}

async function handleGet(env, accountId, store) {
  if (await rateLimited(env, accountId)) return json({ error: 'rate-limited' }, 429);
  const rec = await env.SYNC.get(blobKey(accountId, store), { type: 'json' });
  if (!rec) return new Response('not found', { status: 404 });
  return json({ version: rec.version, blob: rec.blob });
}

// Optimistic concurrency: reject if the caller's ifVersion isn't current. The
// read-then-write isn't a true transaction (KV limitation), but merges are
// commutative/idempotent, so a lost race just 409s the next sync and
// reconverges — no data loss. Durable Objects would make it strict.
async function handlePut(env, accountId, store, body) {
  if (!body || typeof body.blob !== 'object' || body.blob === null) return json({ error: 'bad blob' }, 400);
  if (JSON.stringify(body.blob).length > MAX_BLOB_BYTES) return json({ error: 'too large' }, 413);
  const cur = await env.SYNC.get(blobKey(accountId, store), { type: 'json' });
  if ((body.ifVersion ?? null) !== (cur?.version ?? null)) return json({ version: cur?.version ?? null, error: 'conflict' }, 409);
  const version = crypto.randomUUID();
  await env.SYNC.put(blobKey(accountId, store), JSON.stringify({ version, blob: body.blob }));
  return json({ version });
}

async function handleDelete(env, accountId) {
  await Promise.all([...STORES].map((s) => env.SYNC.delete(blobKey(accountId, s))));
  return new Response(null, { status: 204 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/v1\/blob\/([0-9a-f]{64})(?:\/([a-z]+))?$/);
    if (!m) return new Response('not found', { status: 404 });
    const [, accountId, store] = m;
    if (request.method === 'DELETE') return handleDelete(env, accountId);
    if (store && !STORES.has(store)) return new Response('unknown store', { status: 404 });
    if (request.method === 'GET') return handleGet(env, accountId, store);
    if (request.method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      return handlePut(env, accountId, store, body);
    }
    return new Response('method not allowed', { status: 405 });
  },
};
