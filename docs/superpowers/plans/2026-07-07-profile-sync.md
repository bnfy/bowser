# Profile Sync (v1) Implementation Plan

> **For agentic workers:** implement this plan task-by-task, in order — each task
> compiles and is independently committable. Steps use checkbox (`- [ ]`) syntax for
> tracking. Read the spec first.

**Goal:** Ship end-to-end encrypted, Blanc-hosted profile sync for **Favorites + settings** (v1). A user sets a sync name + passphrase once; Blanc encrypts each store client-side and syncs it through a Cloudflare Worker that only ever sees opaque ciphertext. Free, opt-in, local-first. History/tab-groups are a later phase (§ End matter).

**Architecture:** All crypto and networking live in the main process (`sync-crypto.js` + `sync.js`), peers of `telemetry.js`/`supporter.js` — nothing touches the renderer or web content, so no CSP change. Each syncable `JsonStore` gains an `exportForSync()`/`mergeFromSync()` pair; merges run on plaintext, client-side, and are union-based (never clobber). Key material derives from `handle + passphrase` via `scrypt` → `HKDF` (Node built-ins, no dependency); the Worker stores AES-256-GCM blobs under an opaque `accountId` and cannot read them. Sync state persists in a new `sync.json` store. The Settings page gets a Sync section over the existing guarded `pages:settings:*` IPC.

**Tech Stack:** Electron main-process `net.fetch`, Node `crypto` (`scryptSync`, `hkdfSync`, `aes-256-gcm`), existing `JsonStore`, a Cloudflare Worker + Workers KV (via `wrangler`), plain HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-07-07-profile-sync-design.md` — read it first; the decisions in its §14 are load-bearing here.

## Global Constraints

- **No new npm dependencies.** Key derivation, encryption, and the strength check all use Node built-ins or hand-rolled heuristics. The Worker is a separate `cloudflare/` project built with `wrangler`, not an app dependency.
- **No CSP changes** in any HTML file — every `fetch` happens in the main process (same as `supporter.js`/`telemetry.js`).
- **Flat pages dir:** any asset used by `pages/*.html` must sit directly in `src/renderer/pages/`.
- **Don't rename internals:** `bookmarks`/`bowserPages`/`blanc://` identifiers stay as-is (CLAUDE.md).
- **Never sync** (filtered at the export boundary, belt-and-suspenders with existing whitelists): `supporter` (license-sharing vector), `appIcon` (device-local, per spec §14), `usagePing` (telemetry consent is per-install, not per-person), and anything not explicitly listed — cookies/storage, history (v1), downloads, permissions, adblock-stats.
- **At-rest posture:** the passphrase is used once at setup, then discarded; the *derived* `accountId` + encryption key are stored in `sync.json`. This is no weaker than the app's existing plaintext stores — the guarantee is *server-blindness*, not local-disk encryption. Document it, don't apologize for it.
- **`SYNC_ENDPOINT` ships pointing at the deployed Worker URL** (`https://blanc-sync.bnfy-441.workers.dev`, matching the `blanc-ping` account). Until the Worker is deployed (Task 4), sync degrades to a clear "couldn't reach sync" status — it must never throw or block startup. For local testing, point it at `wrangler dev`'s `http://127.0.0.1:8787`.
- **No test suite** (CLAUDE.md): verify via `node --check`, `npm start`, and `wrangler dev`. Chrome/pages HTML+CSS changes need an app **relaunch**, not Cmd+R.
- **Copy voice:** Settings copy is sentence case, quiet, honest, no exclamation marks.
- **Commit style:** short imperative sentence-case subject; end each commit with your session's `Co-Authored-By` trailer as seen in `git log`.

---

### Task 1: Store seam — sync metadata on bookmarks + settings

Give the two v1 stores what merge needs: Favorites get a per-item `updatedAt` and delete **tombstones**; settings get a `_syncMeta` timestamp map. Merge logic lives with the data (not in the generic `JsonStore`).

**Files:**
- Modify: `src/main/bookmarks.js`
- Modify: `src/main/settings.js`

**Interfaces (Task 3 relies on these exact names):**
- `bookmarks.exportForSync(): { items, tombstones }`
- `bookmarks.mergeFromSync({ items, tombstones }): void`
- `bookmarks.onChanged(fn): void` — fires after any local Favorites mutation (not after a sync merge).
- `settings.exportForSync(): { values, meta }` — synced keys only.
- `settings.mergeFromSync({ values, meta }): void`

- [ ] **Step 1: Bookmarks — tombstones, `updatedAt`, change notifier, export/merge**

In `src/main/bookmarks.js`, change the store default to carry tombstones:

```js
const ensureStore = () => (store ??= new JsonStore('bookmarks', { items: [], tombstones: [] }));
```

Add a change notifier near the top (after `ensureStore`):

```js
// Sync (and only sync) listens here; fired after local mutations, NOT after
// a sync merge — the merge is initiated by the sync engine's own cycle, so
// re-notifying would loop.
const changeListeners = new Set();
const onChanged = (fn) => changeListeners.add(fn);
const notifyChanged = () => { for (const fn of changeListeners) fn(); };
```

Stamp `updatedAt` on create and call `notifyChanged()` on every local mutation. In `toggleBookmark`, the add branch becomes:

```js
  s.update((d) => {
    d.items.push({ id: crypto.randomUUID(), url, title: title || url, favicon: validFavicon(favicon), addedAt: Date.now(), updatedAt: Date.now() });
    d.tombstones = d.tombstones.filter((t) => t.url !== url); // re-favoriting clears a prior delete
  });
  notifyChanged();
  return true;
```

and the remove branch (both `toggleBookmark`'s remove path and `removeBookmark`) records a tombstone instead of only dropping the row:

```js
// toggleBookmark, when already bookmarked:
  s.update((d) => {
    d.items = d.items.filter((b) => b.url !== url);
    d.tombstones.push({ url, deletedAt: Date.now() });
  });
  notifyChanged();
  return false;
```

```js
function removeBookmark(id) {
  ensureStore().update((d) => {
    const item = d.items.find((b) => b.id === id);
    d.items = d.items.filter((b) => b.id !== id);
    if (item) d.tombstones.push({ url: item.url, deletedAt: Date.now() });
  });
  notifyChanged();
}
```

In `updateFavicon`, bump `updatedAt` when the favicon actually changes and call `notifyChanged()` (so a favicon fix propagates). Then add the sync pair:

```js
function exportForSync() {
  const { items, tombstones } = ensureStore().data;
  return { items, tombstones };
}

// Union-merge a decrypted remote snapshot into local, keyed by url (Favorites
// are a set of urls). Newer updatedAt wins per item; a tombstone removes an
// item only if the item wasn't re-added more recently. Nothing is ever
// silently dropped — deletes travel exclusively as tombstones.
function mergeFromSync(remote) {
  ensureStore().update((d) => {
    const byUrl = new Map(d.items.map((it) => [it.url, it]));
    for (const it of remote.items ?? []) {
      const cur = byUrl.get(it.url);
      if (!cur || (it.updatedAt ?? 0) > (cur.updatedAt ?? 0)) byUrl.set(it.url, it);
    }
    const tomb = new Map();
    for (const t of [...d.tombstones, ...(remote.tombstones ?? [])]) {
      const cur = tomb.get(t.url);
      if (!cur || t.deletedAt > cur.deletedAt) tomb.set(t.url, t);
    }
    for (const [url, t] of tomb) {
      const it = byUrl.get(url);
      if (it && (it.updatedAt ?? 0) <= t.deletedAt) byUrl.delete(url);
    }
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000; // prune stale tombstones
    d.items = [...byUrl.values()].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
    d.tombstones = [...tomb.values()].filter((t) => t.deletedAt >= cutoff);
  });
}
```

Extend the exports: `module.exports = { listBookmarks, isBookmarked, toggleBookmark, updateFavicon, removeBookmark, exportForSync, mergeFromSync, onChanged };`

- [ ] **Step 2: Settings — `_syncMeta`, `sanitize()` refactor, export/merge**

In `src/main/settings.js`, add to `DEFAULTS`: `_syncMeta: {},` and add the synced-key list near the top:

```js
// Keys that sync (per spec §4). Deliberately excludes appIcon (device-local),
// usagePing (per-install consent), and supporter (never — license sharing).
const SYNCED_KEYS = ['searchEngine', 'adblockEnabled', 'homePage', 'theme', 'adblockExceptions'];
```

Factor the validation block out of `setSettings` into a reusable `sanitize(partial)` that returns `clean` (move the existing `if (typeof partial.searchEngine …)` … `adblockExceptions` logic verbatim into it). `setSettings` then stamps `_syncMeta` for the keys it actually changed:

```js
function setSettings(partial) {
  const s = ensureStore();
  const clean = sanitize(partial);
  const now = Date.now();
  s.update((data) => {
    Object.assign(data, clean);
    data._syncMeta ??= {};
    for (const k of Object.keys(clean)) if (SYNCED_KEYS.includes(k)) data._syncMeta[k] = now;
  });
  for (const fn of listeners) fn(getSettings());
  return getSettings();
}
```

Add the sync pair (merge stamps meta to the **remote** timestamp so LWW ordering is preserved across devices, and routes values through `sanitize` so a tampered blob can't inject unvalidated settings):

```js
function exportForSync() {
  const d = ensureStore().data;
  const values = {}, meta = {};
  for (const k of SYNCED_KEYS) {
    if (d[k] !== undefined) values[k] = d[k];
    if (d._syncMeta?.[k]) meta[k] = d._syncMeta[k];
  }
  return { values, meta };
}

function mergeFromSync(remote) {
  const s = ensureStore();
  const winners = {};
  for (const k of SYNCED_KEYS) {
    const rt = remote.meta?.[k] ?? 0;
    const lt = s.data._syncMeta?.[k] ?? 0;
    if (rt > lt && remote.values?.[k] !== undefined) winners[k] = rt;
  }
  const keys = Object.keys(winners);
  if (!keys.length) return;
  const clean = sanitize(Object.fromEntries(keys.map((k) => [k, remote.values[k]])));
  s.update((data) => {
    Object.assign(data, clean);
    data._syncMeta ??= {};
    for (const k of Object.keys(clean)) data._syncMeta[k] = winners[k];
  });
  for (const fn of listeners) fn(getSettings());
}
```

Add `exportForSync, mergeFromSync` to `module.exports`. Leave `getSettings()`'s existing `appIcon` sanitization untouched (`_syncMeta` is harmless in the client payload, but if you prefer, strip it in `pages.js`'s `clientSettings()` alongside `supporter`).

- [ ] **Step 3: Syntax-check**

Run: `node --check src/main/bookmarks.js && node --check src/main/settings.js`
Expected: silent.

- [ ] **Step 4: Behavior smoke-check**

Run `npm start`. Favorite a page, unfavorite it, favorite it again. Quit, inspect `~/Library/Application Support/Blanc-Dev/bookmarks.json`: items carry `updatedAt`, a `tombstones` array exists, and re-favoriting cleared the tombstone. Change the theme; `settings.json` gains a `_syncMeta.theme` timestamp.

- [ ] **Step 5: Commit** — `Add sync export/merge metadata to bookmarks and settings stores`

---

### Task 2: Crypto module

**Files:**
- Create: `src/main/sync-crypto.js`

**Interfaces (Task 3 consumes):**
- `deriveKeys(handle, passphrase): { accountId: string(hex,64), key: Buffer(32) }`
- `encrypt(key, plaintext): { v, iv, ct, tag }` (all base64)
- `decrypt(key, blob): string` — throws if the auth tag fails (wrong passphrase / tampered blob).

- [ ] **Step 1: Create `src/main/sync-crypto.js`**

```js
const crypto = require('crypto');

// All key material derives from a user handle + passphrase; the server only
// ever sees ciphertext. Node built-ins only — no dependency (CLAUDE.md:
// "small enough for one person to audit"). See the design spec §6.

// scrypt is deliberately slow. Derivation happens once at setup, so a high
// cost is free; maxmem must be raised for N=2^15 or Node throws.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function deriveKeys(handle, passphrase) {
  // handle is a per-user salt: it namespaces the account and makes offline
  // guessing target one account rather than the whole keyspace.
  const salt = Buffer.from(`blanc-sync:v1:${String(handle).trim().toLowerCase()}`);
  const root = crypto.scryptSync(String(passphrase), salt, 64, SCRYPT);
  const accountId = crypto.hkdfSync('sha256', root, salt, 'blanc-sync-id/v1', 32);
  const encKey = crypto.hkdfSync('sha256', root, salt, 'blanc-sync-enc/v1', 32);
  return { accountId: Buffer.from(accountId).toString('hex'), key: Buffer.from(encKey) };
}

function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(key, blob) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  // .final() throws if the tag doesn't verify — wrong passphrase or tamper.
  return Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { deriveKeys, encrypt, decrypt };
```

- [ ] **Step 2: Round-trip check**

Run:
```bash
node -e "const c=require('./src/main/sync-crypto');const {accountId,key}=c.deriveKeys('anthony','correct horse battery staple');const b=c.encrypt(key,'{\"hi\":1}');console.log('id',accountId.length,'rt',c.decrypt(key,b));const {key:k2}=c.deriveKeys('anthony','wrong');try{c.decrypt(k2,b);console.log('BUG: decrypted with wrong key')}catch{console.log('wrong key rejected OK')}"
```
Expected: `id 64`, `rt {"hi":1}`, `wrong key rejected OK`. Same handle+passphrase yields the same `accountId` across runs (determinism — verify by running twice).

- [ ] **Step 3: Commit** — `Add sync key derivation and AES-GCM blob crypto`

---

### Task 3: Sync engine

**Files:**
- Create: `src/main/sync.js`

**Interfaces (Tasks 5 + 7 consume):**
- `sync.init(): void` — sync-on-launch if enabled, and register debounced triggers.
- `sync.enable({ handle, passphrase }): Promise<{ ok: true, status } | { ok: false, message }>`
- `sync.disable({ wipeRemote }): Promise<{ ok: true, status }>`
- `sync.syncNow(): Promise<{ ok: boolean, message? }>`
- `sync.status(): { enabled, handle, lastSyncedAt, lastError }` — **never** returns keys.

- [ ] **Step 1: Create `src/main/sync.js`**

```js
const { net } = require('electron');
const { JsonStore } = require('./store');
const settings = require('./settings');
const bookmarks = require('./bookmarks');
const { deriveKeys, encrypt, decrypt } = require('./sync-crypto');

// Blanc-hosted E2EE profile sync. This module holds the only network calls;
// the Worker (cloudflare/sync-worker) stores AES-GCM ciphertext keyed by an
// opaque accountId and can't read anything. See the design spec.
const SYNC_ENDPOINT = 'https://blanc-sync.bnfy-441.workers.dev'; // wrangler dev → http://127.0.0.1:8787

// Order doesn't matter; each store syncs independently.
const STORES = [
  { name: 'bookmarks', export: bookmarks.exportForSync, merge: bookmarks.mergeFromSync },
  { name: 'settings', export: settings.exportForSync, merge: settings.mergeFromSync },
];

let store = null;
const ensureStore = () => (store ??= new JsonStore('sync', {
  enabled: false, handle: '', accountId: '', key: '', lastSyncedAt: 0, lastError: null,
}));

let syncing = false, pending = false, timer = null;

class SyncError extends Error {}

function status() {
  const d = ensureStore().data;
  return { enabled: d.enabled, handle: d.handle, lastSyncedAt: d.lastSyncedAt, lastError: d.lastError };
}

// length OR variety — a client-side nudge (spec §14), not a security boundary
// (the Worker's per-account rate limit is that). No dependency.
function passphraseStrong(p) {
  if (p.length >= 16) return true;
  if (p.length < 10) return false;
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(p)).length >= 2;
}

function describe(err) {
  if (err instanceof SyncError && err.message === 'bad-passphrase') return 'Passphrase doesn’t match this sync account.';
  if (err instanceof SyncError && err.message === 'rate-limited') return 'Too many sync attempts — try again in a minute.';
  return 'Couldn’t reach sync — check your connection.';
}

async function enable({ handle, passphrase }) {
  const h = String(handle ?? '').trim();
  const p = String(passphrase ?? '');
  if (h.length < 2) return { ok: false, message: 'Choose a sync name (at least 2 characters).' };
  if (!passphraseStrong(p)) return { ok: false, message: 'Use a longer passphrase — 16+ characters, or 10+ with mixed characters.' };
  const { accountId, key } = deriveKeys(h, p);
  ensureStore().update((d) => {
    d.enabled = true; d.handle = h; d.accountId = accountId; d.key = key.toString('base64'); d.lastError = null;
  });
  const res = await syncNow();
  if (res.ok) return { ok: true, status: status() };
  // First sync failed (bad passphrase for an existing account, or offline):
  // stay enabled so a retry works, but report why.
  return { ok: false, message: res.message };
}

async function disable({ wipeRemote = false } = {}) {
  const d = ensureStore().data;
  if (wipeRemote && d.accountId) {
    try { await net.fetch(`${SYNC_ENDPOINT}/v1/blob/${d.accountId}`, { method: 'DELETE' }); } catch { /* best effort */ }
  }
  ensureStore().update((s) => { s.enabled = false; s.handle = ''; s.accountId = ''; s.key = ''; s.lastError = null; });
  return { ok: true, status: status() };
}

async function syncOne(accountId, key, desc, attempt = 0) {
  const url = `${SYNC_ENDPOINT}/v1/blob/${accountId}/${desc.name}`;
  const getRes = await net.fetch(url);
  let version = null, remote = null;
  if (getRes.status === 200) {
    const body = await getRes.json();
    version = body.version;
    try { remote = JSON.parse(decrypt(key, body.blob)); }
    catch { throw new SyncError('bad-passphrase'); }
  } else if (getRes.status === 429) {
    throw new SyncError('rate-limited');
  } else if (getRes.status !== 404) {
    throw new SyncError(`http-${getRes.status}`);
  }
  if (remote) desc.merge(remote);
  const blob = encrypt(key, JSON.stringify(desc.export()));
  const putRes = await net.fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ifVersion: version, blob }),
  });
  if (putRes.status === 409 && attempt < 3) return syncOne(accountId, key, desc, attempt + 1); // re-pull-merge
  if (!putRes.ok) throw new SyncError(`http-${putRes.status}`);
}

async function syncNow() {
  const d = ensureStore().data;
  if (!d.enabled) return { ok: false, message: 'Sync is off.' };
  if (syncing) { pending = true; return { ok: true }; } // coalesce concurrent triggers
  syncing = true;
  const key = Buffer.from(d.key, 'base64');
  let firstError = null;
  try {
    for (const desc of STORES) {
      try { await syncOne(d.accountId, key, desc); }
      catch (err) { firstError ??= err; }
    }
  } finally { syncing = false; }
  ensureStore().update((s) => {
    if (firstError) s.lastError = describe(firstError);
    else { s.lastError = null; s.lastSyncedAt = Date.now(); }
  });
  if (pending) { pending = false; return syncNow(); }
  return firstError ? { ok: false, message: describe(firstError) } : { ok: true };
}

function schedule(delay = 4000) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

function init() {
  if (ensureStore().data.enabled) schedule(2000); // sync-on-launch
  // React to local changes. mergeFromSync does NOT fire these, so no loop;
  // schedule() is a no-op churn-wise while a sync is in flight (coalesced).
  settings.onSettingsChanged(() => { if (ensureStore().data.enabled) schedule(); });
  bookmarks.onChanged(() => { if (ensureStore().data.enabled) schedule(); });
}

module.exports = { init, enable, disable, syncNow, status };
```

- [ ] **Step 2: Syntax-check** — `node --check src/main/sync.js`. (Full behavior is verified in Task 7 with the Worker running.)

- [ ] **Step 3: Commit** — `Add profile sync engine (pull-merge-push, coalesced, offline-safe)`

---

### Task 4: The sync Worker

**Files:**
- Create: `cloudflare/sync-worker/wrangler.toml`
- Create: `cloudflare/sync-worker/src/index.js`
- Create: `cloudflare/sync-worker/README.md`

**Interfaces:** HTTP only, consumed by `sync.js`. `GET/PUT /v1/blob/:accountId/:store`, `DELETE /v1/blob/:accountId`. Sees only ciphertext.

- [ ] **Step 1: `wrangler.toml`**

```toml
name = "blanc-sync"
main = "src/index.js"
compatibility_date = "2026-07-01"

# Create with: wrangler kv namespace create SYNC  → paste the id below.
[[kv_namespaces]]
binding = "SYNC"
id = "REPLACE_WITH_KV_NAMESPACE_ID"
```

- [ ] **Step 2: `src/index.js`**

```js
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
```

- [ ] **Step 3: `README.md`** — document the guarantee and deploy steps:

```markdown
# blanc-sync — E2EE profile sync store

Stores only AES-GCM ciphertext for Blanc's profile sync (see src/main/sync.js
in the main repo). Keyed by an opaque `accountId` the client derives from a
passphrase this Worker never sees. It cannot read, index, or merge any user
data — no IPs, no ids, no browsing data, consistent with ../ping-worker.

## Deploy
1. `cd cloudflare/sync-worker`
2. `wrangler kv namespace create SYNC` → paste the id into `wrangler.toml`.
3. `wrangler deploy`
4. Confirm the URL matches `SYNC_ENDPOINT` in `src/main/sync.js`.

## Local dev
`wrangler dev` serves on http://127.0.0.1:8787; temporarily point
`SYNC_ENDPOINT` there to test the app end-to-end.

## API
- `GET /v1/blob/:accountId/:store` → `{ version, blob }` | 404 | 429
- `PUT /v1/blob/:accountId/:store` `{ ifVersion, blob }` → `{ version }` | 409
- `DELETE /v1/blob/:accountId` → 204 (account wipe)

No secrets or tokens: possession of the (unguessable) accountId is the
capability. A per-accountId GET rate limit throttles online guessing.
```

- [ ] **Step 4: Validate locally**

Run `cd cloudflare/sync-worker && wrangler dev` (needs a KV id; for a pure dry-run use `wrangler dev --local`). With it running:
```bash
A=$(printf 'a%.0s' {1..64})
curl -s "http://127.0.0.1:8787/v1/blob/$A/settings"; echo                        # -> not found (404)
curl -s -X PUT "http://127.0.0.1:8787/v1/blob/$A/settings" -H 'content-type: application/json' \
  -d '{"ifVersion":null,"blob":{"v":1,"iv":"x","ct":"y","tag":"z"}}'; echo       # -> {"version":"..."}
curl -s "http://127.0.0.1:8787/v1/blob/$A/settings"; echo                        # -> {"version":"...","blob":{...}}
curl -s -X PUT "http://127.0.0.1:8787/v1/blob/$A/settings" -H 'content-type: application/json' \
  -d '{"ifVersion":null,"blob":{"v":1}}' -o /dev/null -w '%{http_code}\n'         # -> 409 (stale version)
```

- [ ] **Step 5: Commit** — `Add blanc-sync Cloudflare Worker (blind ciphertext store)`

---

### Task 5: IPC + preload bridge

**Files:**
- Modify: `src/main/pages.js` (after the supporter-activate handler, ~line 95)
- Modify: `src/main/tab-preload.js` (settings block, lines 35-39)

**Interfaces (Task 6 consumes):** `window.bowserPages.settings.syncGet/syncEnable/syncDisable/syncNow`. The passphrase crosses renderer→main only on `syncEnable`; nothing ever returns keys.

- [ ] **Step 1: `pages.js`** — add `const sync = require('./sync');` to the requires, and after the `pages:settings:supporter-activate` handler:

```js
  // Sync: the passphrase arrives once on enable and never leaves main; every
  // response is status-only (enabled/handle/lastSyncedAt/lastError) — no keys.
  handle('pages:settings:sync-get', () => sync.status());
  handle('pages:settings:sync-enable', (payload) => sync.enable(payload ?? {}));
  handle('pages:settings:sync-disable', (opts) => sync.disable(opts ?? {}));
  handle('pages:settings:sync-now', () => sync.syncNow().then(() => sync.status()));
```

- [ ] **Step 2: `tab-preload.js`** — extend the `settings` block:

```js
    settings: {
      get: () => ipcRenderer.invoke('pages:settings:get'),
      set: (partial) => ipcRenderer.invoke('pages:settings:set', partial),
      activateSupporter: (key) => ipcRenderer.invoke('pages:settings:supporter-activate', key),
      syncGet: () => ipcRenderer.invoke('pages:settings:sync-get'),
      syncEnable: (payload) => ipcRenderer.invoke('pages:settings:sync-enable', payload),
      syncDisable: (opts) => ipcRenderer.invoke('pages:settings:sync-disable', opts),
      syncNow: () => ipcRenderer.invoke('pages:settings:sync-now'),
    },
```

- [ ] **Step 3: Syntax-check** — `node --check src/main/pages.js && node --check src/main/tab-preload.js`.

- [ ] **Step 4: Commit** — `Expose sync over guarded settings IPC (status-only responses)`

---

### Task 6: Settings page — Sync section

**Files:**
- Modify: `src/renderer/pages/settings.html` (insert before the `Supporter` `<h1>`, ~line 117)
- Modify: `src/renderer/pages/settings.js` (append a self-contained block alongside the existing settings wiring)
- Modify: `src/renderer/pages/pages.css` (small `.inline-check` rule)

**Interfaces:** consumes `window.bowserPages.settings.sync*` (Task 5). Produces nothing consumed later.

- [ ] **Step 1: `settings.html`** — insert before `<h1 class="section-title" id="supporterTitle">`:

```html
    <h1 class="section-title">Sync</h1>
    <p class="section-hint">
      Sync your favorites and settings across devices. Blanc encrypts everything on this
      device with your passphrase and stores only unreadable data — we can’t read it, and
      can’t recover it if you forget your passphrase.
    </p>
    <div id="syncSetup">
      <div class="toolbar-row">
        <input id="syncHandle" type="text" placeholder="Sync name" autocomplete="off" spellcheck="false" maxlength="64" />
        <input id="syncPassphrase" type="password" placeholder="Passphrase" autocomplete="off" />
        <button id="syncEnable">Turn on sync</button>
      </div>
      <p class="section-hint" id="syncSetupStatus" role="status"></p>
    </div>
    <div id="syncActive" hidden>
      <p class="section-hint" id="syncActiveStatus" role="status"></p>
      <div class="toolbar-row">
        <button id="syncNow">Sync now</button>
        <button id="syncDisable" class="danger">Turn off sync</button>
        <label class="inline-check"><input id="syncWipe" type="checkbox" /> also delete synced data</label>
      </div>
    </div>
```

- [ ] **Step 2: `settings.js`** — append (self-contained; reads its own state so it doesn't depend on the main `get` payload):

```js
  // --- Sync ---
  (function initSync() {
    const setup = document.getElementById('syncSetup');
    const active = document.getElementById('syncActive');
    const handleEl = document.getElementById('syncHandle');
    const passEl = document.getElementById('syncPassphrase');
    const enableBtn = document.getElementById('syncEnable');
    const setupStatus = document.getElementById('syncSetupStatus');
    const activeStatus = document.getElementById('syncActiveStatus');
    const nowBtn = document.getElementById('syncNow');
    const disableBtn = document.getElementById('syncDisable');
    const wipeEl = document.getElementById('syncWipe');

    const when = (ts) => (ts ? new Date(ts).toLocaleString() : 'never');
    function render(status) {
      const on = !!status.enabled;
      setup.hidden = on;
      active.hidden = !on;
      if (on) {
        activeStatus.textContent = status.lastError
          ? `Sync is on (${status.handle}). ${status.lastError}`
          : `Sync is on (${status.handle}). Last synced ${when(status.lastSyncedAt)}.`;
      }
    }

    window.bowserPages.settings.syncGet().then(render);

    async function enable() {
      enableBtn.disabled = true;
      setupStatus.textContent = 'Turning on sync…';
      const res = await window.bowserPages.settings.syncEnable({ handle: handleEl.value, passphrase: passEl.value });
      enableBtn.disabled = false;
      if (res.ok) { passEl.value = ''; render(res.status); }
      else { setupStatus.textContent = res.message; }
    }
    enableBtn.addEventListener('click', enable);
    passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') enable(); });

    nowBtn.addEventListener('click', async () => {
      nowBtn.disabled = true;
      activeStatus.textContent = 'Syncing…';
      render(await window.bowserPages.settings.syncNow());
      nowBtn.disabled = false;
    });

    disableBtn.addEventListener('click', async () => {
      const res = await window.bowserPages.settings.syncDisable({ wipeRemote: wipeEl.checked });
      wipeEl.checked = false;
      render(res.status);
    });
  })();
```

- [ ] **Step 3: `pages.css`** — add near the other form rows:

```css
/* Inline "also delete synced data" checkbox next to Turn-off-sync. */
.inline-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-dim); }
```

- [ ] **Step 4: Relaunch and verify UI states**

Run `npm start` (relaunch, not Cmd+R). In Settings → Sync: the setup row shows handle + passphrase + button. Enter a weak passphrase (`abc`) → inline "Use a longer passphrase…". With the Worker unreachable (endpoint not deployed / `wrangler dev` off), a strong passphrase shows "Couldn’t reach sync…" but the section flips to the active state (enabled locally). "Turn off sync" returns to setup.

- [ ] **Step 5: Commit** — `Add Sync section to Settings`

---

### Task 7: Wire into main, document, verify end-to-end

**Files:**
- Modify: `src/main/main.js` (require + `sync.init()` in `app.whenReady`, after `setupPages(...)`)
- Modify: `CLAUDE.md` (a Profile Sync paragraph after the Supporter/Telemetry sections)

- [ ] **Step 1: `main.js`** — add `const sync = require('./sync');` near the other main requires (by `require('./telemetry')`, line 10). In `app.whenReady`, after the `setupPages({ … })` call (ends ~line 1816) and the existing `settings.onSettingsChanged(...)` block, add:

```js
  // Profile sync: sync-on-launch if configured, then follow local changes.
  // Runs after stores + setupPages so its triggers see a live app; failures
  // are swallowed and surfaced only in Settings (never block startup).
  sync.init();
```

- [ ] **Step 2: `CLAUDE.md`** — after the **Blanc Supporter** paragraph, insert:

```markdown
**Profile Sync** (`src/main/sync.js` + `src/main/sync-crypto.js`): opt-in, end-to-end-encrypted cross-device sync of **Favorites and settings** (off by default, local-first). A user sets a sync name + passphrase once (Settings → Sync); `sync-crypto.js` derives an opaque `accountId` and an AES-256-GCM key via `scrypt`→`HKDF` (Node built-ins, no dependency), the passphrase is then discarded and only the derived key persists in `sync.json`. Each store's plaintext is merged client-side (`bookmarks.exportForSync`/`mergeFromSync`, ditto `settings`) and pushed as ciphertext to the `blanc-sync` Cloudflare Worker (`cloudflare/sync-worker/`), which stores only opaque blobs keyed by `accountId` — it cannot read, index, or merge anything. Merges are union-based (Favorites keyed by url + delete tombstones; settings per-key LWW via a `_syncMeta` clock) so a sync never silently drops data. **Never synced:** `supporter` (license-sharing vector), `appIcon` (device-local), `usagePing` (per-install consent), cookies/storage, and — in v1 — history/downloads/permissions. All crypto and `net.fetch` are main-process only; the renderer sends the passphrase once over the guarded `pages:settings:sync-enable` IPC and otherwise sees status-only responses (no keys). The stored derived key is no weaker than the app's already-plaintext local stores — the guarantee is server-blindness, not local-at-rest encryption. Worker deploy/runbook: `cloudflare/sync-worker/README.md`.
```

- [ ] **Step 3: Two-device end-to-end verification**

Deploy the Worker (Task 4 Step 4) or run `wrangler dev` and temporarily set `SYNC_ENDPOINT` to `http://127.0.0.1:8787`. Simulate two devices with separate profiles:

```bash
npm start &                                   # device A (default Blanc-Dev profile)
npx electron . --user-data-dir=/tmp/blanc-b   # device B (fresh profile)
```

Walk the spec's testing checklist (§12):
1. Same handle+passphrase on A and B. Favorite a page on A → "Sync now" on both → it appears on B.
2. Delete it on A, sync both → it's gone on B and does **not** resurrect on the next sync (tombstone).
3. Change theme on A, favorite a different page on B, sync both → both changes survive (no clobber).
4. Wrong passphrase on B (different passphrase, same handle) → "Passphrase doesn’t match this sync account"; B's local data intact.
5. Quit `wrangler dev` → "Couldn’t reach sync"; no crash; recovers when it's back.
6. Inspect the KV value (`wrangler kv key get 'blob:<accountId>:bookmarks' --binding SYNC`) → opaque `{v,iv,ct,tag}`, no readable url/title.
7. Activate a (sandbox) supporter license on A → colorways do **not** unlock on unlicensed B, and no `supporter` field appears in any blob.

Reset: turn off sync (with "delete synced data") on both, remove `/tmp/blanc-b`, restore `SYNC_ENDPOINT` if you changed it.

- [ ] **Step 4: Commit** — `Wire profile sync into startup and document the subsystem`

---

## End matter

**Deferred to a follow-up plan (spec §4, v2+):**
- **History sync** — union by `(url, visitedAt)`, re-sort, re-cap 5000, with a `clearedBefore` watermark for clear-all. Add `'history'` to the Worker's `STORES` set and raise `MAX_BLOB_BYTES`. Cheap once this plan's seam exists.
- **Tab-group sync** ("reopen my workspace"), live "tabs from another device," and the BYO-folder alternative (spec §14) — separate, larger features.

**User-side manual steps (after implementation):**
1. `cd cloudflare/sync-worker && wrangler kv namespace create SYNC`, paste the id into `wrangler.toml`, `wrangler deploy`; confirm the URL matches `SYNC_ENDPOINT`.
2. Smoke-test two profiles per Task 7 Step 3 against the deployed Worker.
