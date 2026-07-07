const { net } = require('electron');
const { JsonStore } = require('./store');
const settings = require('./settings');
const bookmarks = require('./bookmarks');
const { deriveKeys, encrypt, decrypt } = require('./sync-crypto');

// Blanc-hosted E2EE profile sync. This module holds the only network calls;
// the Worker (cloudflare/sync-worker) stores AES-GCM ciphertext keyed by an
// opaque accountId and can't read anything. See the design spec.
const SYNC_ENDPOINT = 'https://blanc-sync.bnfy-441.workers.dev'; // wrangler dev -> http://127.0.0.1:8787

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
// True only while a pull's merge() applies remote data, so the local-change
// triggers can distinguish a sync-induced settings change from a genuine user
// edit and not schedule a redundant follow-up sync.
let applyingRemote = false;

class SyncError extends Error {}

function status() {
  const d = ensureStore().data;
  return { enabled: d.enabled, handle: d.handle, lastSyncedAt: d.lastSyncedAt, lastError: d.lastError };
}

// length OR variety — a client-side nudge (spec §14), not a security boundary
// (the Worker's per-IP rate limit is that). No dependency.
function passphraseStrong(p) {
  if (p.length >= 16) return true;
  if (p.length < 10) return false;
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(p)).length >= 2;
}

function describe(err) {
  const code = err instanceof SyncError ? err.message : '';
  if (code === 'bad-passphrase') return 'Passphrase doesn’t match this sync account.';
  if (code === 'rate-limited') return 'Too many sync attempts — try again in a minute.';
  if (code === 'conflict') return 'Sync kept getting interrupted — try again in a moment.';
  if (code === 'server') return 'Sync sent an unexpected response — try again later.';
  if (/^http-4/.test(code)) return `Sync rejected the request (HTTP ${code.slice(5)}).`;
  if (/^http-5/.test(code)) return 'Sync server error — try again later.';
  return 'Couldn’t reach sync — check your connection.';
}

async function enable({ handle, passphrase }) {
  const h = String(handle ?? '').trim();
  const p = String(passphrase ?? '');
  if (h.length < 2) return { ok: false, message: 'Choose a sync name (at least 2 characters).', status: status() };
  if (!passphraseStrong(p)) {
    return { ok: false, message: 'Use a longer passphrase — 16+ characters, or 10+ with mixed characters.', status: status() };
  }
  const { accountId, key } = deriveKeys(h, p);
  ensureStore().update((d) => {
    d.enabled = true; d.handle = h; d.accountId = accountId; d.key = key.toString('base64'); d.lastError = null;
  });
  // Joining existing data, or starting fresh? A mistyped passphrase derives a
  // *different* accountId → 404 → a silent new account, so the UI warns when
  // nothing was found. null = couldn't tell (offline).
  let created = null;
  try {
    const probe = await net.fetch(`${SYNC_ENDPOINT}/v1/blob/${accountId}/settings`);
    if (probe.status === 200 || probe.status === 404) created = probe.status === 404;
  } catch { /* offline — leave created null */ }
  const res = await syncNow();
  return { ok: res.ok, message: res.message, created, status: status() };
}

async function disable({ wipeRemote = false } = {}) {
  clearTimeout(timer);
  timer = null;
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
    let body;
    try { body = await getRes.json(); } catch { throw new SyncError('server'); }
    version = body.version;
    try { remote = JSON.parse(decrypt(key, body.blob)); }
    catch { throw new SyncError('bad-passphrase'); }
  } else if (getRes.status === 429) {
    throw new SyncError('rate-limited');
  } else if (getRes.status !== 404) {
    throw new SyncError(`http-${getRes.status}`);
  }
  if (remote) {
    applyingRemote = true;
    try { desc.merge(remote); } finally { applyingRemote = false; }
  }
  const blob = encrypt(key, JSON.stringify(desc.export()));
  const putRes = await net.fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ifVersion: version, blob }),
  });
  if (putRes.status === 409 && attempt < 3) return syncOne(accountId, key, desc, attempt + 1); // re-pull-merge
  if (putRes.status === 409) throw new SyncError('conflict');
  if (!putRes.ok) throw new SyncError(`http-${putRes.status}`);
}

async function syncNow() {
  const d = ensureStore().data;
  if (!d.enabled || !d.accountId || !d.key) return { ok: false, message: 'Sync is off.' };
  if (syncing) { pending = true; return { ok: true }; } // coalesce concurrent triggers
  syncing = true;
  const accountId = d.accountId;            // snapshot so a mid-flight disable can't redirect writes
  const key = Buffer.from(d.key, 'base64');
  let firstError = null;
  try {
    for (const desc of STORES) {
      if (!ensureStore().data.enabled) break; // disabled mid-flight — stop
      try { await syncOne(accountId, key, desc); }
      catch (err) { firstError ??= err; }
    }
  } finally { syncing = false; }
  // If sync was turned off mid-flight, don't stamp status onto a disabled store.
  if (!ensureStore().data.enabled) return { ok: false, message: 'Sync is off.' };
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
  // React to LOCAL changes only. applyingRemote keeps a merge-applied settings
  // change (which fires settings' listeners so the app re-themes live) from
  // scheduling a redundant follow-up sync. Bookmarks merges never fire
  // onChanged (they use onMerged instead), so they're inherently safe.
  const onLocalChange = () => { if (ensureStore().data.enabled && !applyingRemote) schedule(); };
  settings.onSettingsChanged(onLocalChange);
  bookmarks.onChanged(onLocalChange);
}

module.exports = { init, enable, disable, syncNow, status };
