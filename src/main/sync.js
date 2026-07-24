const os = require('os');
const crypto = require('crypto');
const { net } = require('electron');
const { JsonStore } = require('./store');
const settings = require('./settings');
const bookmarks = require('./bookmarks');
const tabsync = require('./tabsync');
const tabicons = require('./tabicons');
const { deriveKeys, encrypt, decrypt } = require('./sync-crypto');
const { wipeDecision } = require('./sync-wipe');

// Blanc-hosted E2EE profile sync. This module holds the only network calls;
// the Worker (cloudflare/sync-worker) stores AES-GCM ciphertext keyed by an
// opaque accountId and can't read anything. See the design spec.
const SYNC_ENDPOINT = 'https://blanc-sync.bnfy-441.workers.dev'; // wrangler dev -> http://127.0.0.1:8787

let store = null;
const ensureStore = () => (store ??= new JsonStore('sync', {
  enabled: false, handle: '', accountId: '', key: '', lastSyncedAt: 0, lastError: null,
  deviceId: '', syncTabs: false,
}));

/** What tabsync needs from this device's identity on every export/merge.
 * deviceId is a random UUID minted here once — deliberately NOT the
 * telemetry installId (nothing may attach to that). */
function tabSyncContext() {
  const s = ensureStore();
  if (!s.data.deviceId) s.update((d) => { d.deviceId = crypto.randomUUID(); });
  const d = s.data;
  return {
    accountId: d.accountId, deviceId: d.deviceId, syncTabs: !!d.syncTabs,
    deviceName: os.hostname(), platform: process.platform,
  };
}

// Order doesn't matter; each store syncs independently.
const STORES = [
  { name: 'bookmarks', export: bookmarks.exportForSync, merge: bookmarks.mergeFromSync },
  { name: 'settings', export: settings.exportForSync, merge: settings.mergeFromSync },
  {
    name: 'session',
    // ctx is the run-scoped context syncNow snapshotted — NOT re-resolved
    // here, so a credential change during the network round-trip can't leak
    // one account's devices into another (PR #41 review, P1).
    export: (ctx) => tabsync.exportForSync(ctx),
    merge: (remote, ctx) => tabsync.mergeFromSync(remote, ctx),
    // Repair comparison (spec §6): a true no-op skips the PUT; anything else
    // — including a remote blob that lost our unchanged entry — uploads.
    equals: (exported, remote) => tabsync.equalsRemote(exported, remote),
  },
  {
    // Optional sidecar: older deployed Workers return 404 on PUT, which the
    // sync pipeline treats as a quiet no-op until the store is available.
    // Keeping this separate preserves the mixed-version `session` schema.
    name: 'icons',
    optional: true,
    export: (ctx) => tabicons.exportForSync(ctx),
    merge: (remote, ctx) => tabicons.mergeFromSync(remote, ctx),
    equals: (exported, remote) => tabicons.equalsRemote(exported, remote),
  },
];

let syncing = false, timer = null, sessionTimer = null, iconTimer = null;
/** Coalesced re-run request while a sync is in flight: undefined = none,
 * null = all stores, array = just those names. */
let pendingNames;
const unionNames = (a, b) => (a === null || b === null ? null : [...new Set([...a, ...b])]);
/** Credential/consent generation. Bumped whenever the account identity or
 * the tab-share consent changes (enable, disable, setSyncTabs); every sync
 * run snapshots it and aborts at its next checkpoint once it's stale, so an
 * in-flight response from the OLD account can never be merged or re-uploaded
 * under the NEW one (or recreate a just-wiped account's blob). */
let syncGen = 0;
/** Resolves when the currently-running pass has fully settled — dispatched
 * network requests included. `disable()` awaits it before wiping: a PUT
 * already on the wire can't be recalled, so the DELETE must not race it. */
let passSettled = Promise.resolve();
/** True while disable() drains and wipes: no new pass may start, or the
 * drain barrier would be meaningless. */
let suspended = false;
// True only while a pull's merge() applies remote data, so the local-change
// triggers can distinguish a sync-induced settings change from a genuine user
// edit and not schedule a redundant follow-up sync.
let applyingRemote = false;

class SyncError extends Error {}

function status() {
  const d = ensureStore().data;
  return {
    enabled: d.enabled, handle: d.handle, lastSyncedAt: d.lastSyncedAt,
    lastError: d.lastError, syncTabs: !!d.syncTabs,
  };
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
  syncGen += 1; // new identity — strand any in-flight run from the old one
  tabicons.cancelCaptures();
  ensureStore().update((d) => {
    d.enabled = true; d.handle = h; d.accountId = accountId; d.key = key.toString('base64'); d.lastError = null;
  });
  refreshTabIcons().catch(() => {});
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
  clearTimeout(sessionTimer);
  sessionTimer = null;
  clearTimeout(iconTimer);
  iconTimer = null;
  // Barrier (PR #41 re-review): a dispatched PUT can't be recalled, and a
  // stale check after its response can't undo the server mutation. So before
  // touching the server or the credentials: (1) block new passes, (2) strand
  // the active one at its next checkpoint, (3) WAIT for it to settle —
  // network included. Only then is the DELETE (or the credential clear) safe.
  suspended = true;
  syncGen += 1;
  tabicons.cancelCaptures();
  try {
    await passSettled;
    const d = ensureStore().data;
    if (wipeRemote && d.accountId) {
      // The wipe must be confirmed before the credentials are erased: the
      // accountId is the only handle on the server copy, so clearing it after
      // a failed DELETE would strand unreachable ciphertext while telling the
      // user it's gone. On failure, keep the record intact (sync stays enabled)
      // and report, so "erase server copy" can be retried — or the user can
      // turn sync off without the wipe. The clear-vs-keep rule is pinned by
      // sync-wipe.js and its unit test.
      let outcome;
      try {
        const res = await net.fetch(`${SYNC_ENDPOINT}/v1/blob/${d.accountId}`, { method: 'DELETE' });
        outcome = { status: res.status };
      } catch {
        outcome = { error: true };
      }
      const decision = wipeDecision(outcome);
      if (!decision.clearCredentials) {
        return { ok: false, message: decision.message, status: status() };
      }
    }
    ensureStore().update((s) => { s.enabled = false; s.handle = ''; s.accountId = ''; s.key = ''; s.lastError = null; });
    // The cached device map must not outlive the account it came from — and
    // the UI must stop listing other devices the moment sync is off.
    // (syncTabs and deviceId survive: consent and identity are per-device,
    // not per-account.)
    tabsync.onSyncDisabled();
    tabicons.onSyncDisabled();
    return { ok: true, status: status() };
  } finally {
    suspended = false; // a failed wipe keeps sync enabled — future passes must run
  }
}

/** `run` is immutable for the whole sync pass: `run.ctx` is the tab-sync
 * context snapshotted when the pass began (never re-resolved after an await,
 * so a mid-flight credential change can't cross account boundaries), and
 * `run.stale()` is checked after every await so a stranded pass aborts
 * before it merges, exports, or writes anything. */
async function syncOne(accountId, key, desc, run, attempt = 0) {
  const url = `${SYNC_ENDPOINT}/v1/blob/${accountId}/${desc.name}`;
  const getRes = await net.fetch(url);
  if (run.stale()) throw new SyncError('stale');
  let version = null, remote = null;
  if (getRes.status === 200) {
    let body;
    try { body = await getRes.json(); } catch { throw new SyncError('server'); }
    if (run.stale()) throw new SyncError('stale');
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
    try { desc.merge(remote, run.ctx); } finally { applyingRemote = false; }
  }
  const payload = desc.export(run.ctx);
  if (remote && desc.equals?.(payload, remote)) return; // true no-op — skip the PUT
  const blob = encrypt(key, JSON.stringify(payload));
  if (run.stale()) throw new SyncError('stale'); // last gate before the write
  const putRes = await net.fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ifVersion: version, blob }),
  });
  if (putRes.status === 409 && attempt < 3) {
    if (run.stale()) throw new SyncError('stale');
    return syncOne(accountId, key, desc, run, attempt + 1); // re-pull-merge
  }
  if (putRes.status === 409) throw new SyncError('conflict');
  if (desc.optional && putRes.status === 404) return;
  if (!putRes.ok) throw new SyncError(`http-${putRes.status}`);
}

async function syncNow(names = null) {
  const d = ensureStore().data;
  // `suspended` bars new passes while disable() drains and wipes — a fresh
  // pass dispatching requests mid-drain would defeat the barrier.
  if (suspended || !d.enabled || !d.accountId || !d.key) return { ok: false, message: 'Sync is off.' };
  if (syncing) { // coalesce concurrent triggers
    pendingNames = pendingNames === undefined ? names : unionNames(pendingNames, names);
    return { ok: true };
  }
  syncing = true;
  // Everything below — network requests included — settles before this
  // resolves; disable() awaits it as its drain barrier.
  let settle;
  passSettled = new Promise((resolve) => { settle = resolve; });
  try {
    const accountId = d.accountId;          // snapshot so a mid-flight disable can't redirect writes
    const key = Buffer.from(d.key, 'base64');
    // The whole pass runs under ONE generation and ONE tab-sync context; a
    // credential/consent change mid-flight strands it at the next checkpoint.
    const gen = syncGen;
    const run = { ctx: tabSyncContext(), stale: () => gen !== syncGen };
    let firstError = null, stranded = false, ranRequiredStore = false;
    try {
      for (const desc of STORES) {
        if (names && !names.includes(desc.name)) continue;
        if (!ensureStore().data.enabled) break; // disabled mid-flight — stop
        if (!desc.optional) ranRequiredStore = true;
        try { await syncOne(accountId, key, desc, run); }
        catch (err) {
          if (err instanceof SyncError && err.message === 'stale') { stranded = true; break; }
          // Cosmetic sidecars degrade to fallback UI; they must never make
          // Favorites/settings/session sync report a failure.
          if (!desc.optional) firstError ??= err;
        }
      }
    } finally { syncing = false; }
    // If sync was turned off mid-flight, don't stamp status onto a disabled store.
    if (!ensureStore().data.enabled) return { ok: false, message: 'Sync is off.' };
    // A stranded pass stamps nothing: its results belong to a dead generation.
    // Cosmetic-only passes must not erase a real required-store error or make
    // lastSyncedAt imply that Favorites/settings/session were refreshed.
    if (!stranded && ranRequiredStore) {
      ensureStore().update((s) => {
        if (firstError) s.lastError = describe(firstError);
        else { s.lastError = null; s.lastSyncedAt = Date.now(); }
      });
    }
    if (pendingNames !== undefined) {
      const next = pendingNames;
      pendingNames = undefined;
      return syncNow(next); // re-runs under the CURRENT generation and context
    }
    if (stranded) return { ok: true };
    return firstError ? { ok: false, message: describe(firstError) } : { ok: true };
  } finally { settle(); }
}

function schedule(delay = 4000) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

/** Tab churn gets timers separate from both favorites/settings and cosmetic
 * icon work. A page rotating favicons must never postpone the primary session
 * snapshot (especially the prompt consent-change retraction/publication). */
function scheduleSession(delay = 15000) {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => { syncNow(['session']).catch(() => {}); }, delay);
}

function scheduleIcons(delay = 15000) {
  clearTimeout(iconTimer);
  iconTimer = setTimeout(() => { syncNow(['icons']).catch(() => {}); }, delay);
}

function scheduleTabs(delay = 15000) {
  scheduleSession(delay);
  scheduleIcons(delay);
}

/** The per-device "share this device's open tabs" consent (spec §3). Turning
 * it off publishes a retraction on the prompt sync below. */
function setSyncTabs(on) {
  syncGen += 1; // consent changed — a stale in-flight export must not publish under the old setting
  tabicons.cancelCaptures();
  ensureStore().update((d) => { d.syncTabs = !!on; });
  if (ensureStore().data.enabled) scheduleTabs(1000);
  if (on) refreshTabIcons().catch(() => {});
  return status();
}

let lastSessionRefresh = 0;
/** Freshness pull on window focus / panel open (spec §6), throttled to one
 * per minute. Session + icon-sidecar only: keeps it off favorites/settings
 * and inside the worker's per-account GET limit. Errors stay silent — this
 * is a background freshness path, not a user-initiated sync. */
function refreshSession() {
  const d = ensureStore().data;
  if (!d.enabled) return;
  const now = Date.now();
  if (now - lastSessionRefresh < 60_000) return;
  lastSessionRefresh = now;
  syncNow(['session', 'icons']).catch(() => {});
}

/** A generation-bound capture run. Favicon rasterization is asynchronous,
 * so credentials/consent must still match before its result enters a store. */
function iconCaptureRun() {
  const d = ensureStore().data;
  if (!d.enabled || !d.syncTabs) return null;
  const gen = syncGen;
  const ctx = tabSyncContext();
  return {
    ctx,
    isCurrent: () => {
      const current = ensureStore().data;
      return gen === syncGen &&
        current.enabled &&
        current.syncTabs &&
        current.accountId === ctx.accountId &&
        current.deviceId === ctx.deviceId;
    },
  };
}

function captureTabIcon(tab) {
  const run = iconCaptureRun();
  return run
    ? tabicons.captureTab(tab, run.ctx, { isCurrent: run.isCurrent })
    : Promise.resolve(false);
}

function refreshTabIcons() {
  const run = iconCaptureRun();
  return run
    ? tabicons.refreshCurrent(run.ctx, { isCurrent: run.isCurrent })
    : Promise.resolve(false);
}

/** Other devices' tabs for the UI ([] whenever sync is off). The sidecar is
 * joined only for the trusted renderer projection; the session wire format
 * remains unchanged. */
function listRemoteDevices() {
  const d = ensureStore().data;
  if (!d.enabled) return [];
  const ctx = tabSyncContext();
  return tabicons.attachToRemoteDevices(tabsync.getRemoteDevices(ctx), ctx);
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
  // Tab-driven publishes: fingerprint-gated upstream (tabsync.noteTabsChanged),
  // debounced 15s here, and only while this device actually shares its tabs.
  tabsync.onChanged(() => {
    const d = ensureStore().data;
    if (d.enabled && d.syncTabs) scheduleTabs();
  });
  tabicons.onChanged(() => {
    const d = ensureStore().data;
    if (d.enabled && d.syncTabs) scheduleIcons();
  });
  refreshTabIcons().catch(() => {});
  // Heartbeat (spec §6): hourly check; republishes once our entry is 24h old
  // so a long-running device with stable tabs never ages past the 30-day
  // prune on other devices.
  setInterval(() => {
    const d = ensureStore().data;
    if (!d.enabled || !d.syncTabs) return;
    const ctx = tabSyncContext();
    if (tabsync.heartbeatDue(ctx)) scheduleSession(5000);
    if (tabicons.heartbeatDue(ctx)) scheduleIcons(5000);
  }, 60 * 60 * 1000);
}

module.exports = {
  init,
  enable,
  disable,
  syncNow,
  status,
  setSyncTabs,
  refreshSession,
  listRemoteDevices,
  captureTabIcon,
};
