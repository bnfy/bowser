// Pure tab-sync logic: merge, fingerprint, budget, pruning, repair
// comparison. No electron and no ./store import (store.js requires electron)
// so all of this runs under node --test. Orchestration/persistence live in
// tabsync.js. See the tab-sync design spec §4–§7.

const PRUNE_MS = 30 * 24 * 60 * 60 * 1000;   // dead devices age out (spec §5)
const HEARTBEAT_MS = 24 * 60 * 60 * 1000;    // live devices republish (spec §6)
const BUDGET_BYTES = 320 * 1024;             // plaintext budget (spec §7)

const MAX_TABS = 500;
const MAX_URL = 2048;
const MAX_TITLE = 200;
const MAX_NAME = 80;

/** Deterministic serialization — sorted object keys — so fingerprints and
 * equality checks are stable across devices and JSON round-trips. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The publishable content of an entry — everything except the clock, so a
 * bare updatedAt bump (heartbeat) never reads as a content change. */
const fingerprint = ({ name, platform, tabs, groups }) => canonical({ name, platform, tabs, groups });

function sanitizeTab(raw) {
  if (!raw || typeof raw.url !== 'string') return null;
  if (!/^https?:\/\//.test(raw.url) || raw.url.length > MAX_URL) return null;
  return {
    url: raw.url,
    title: typeof raw.title === 'string' ? raw.title.slice(0, MAX_TITLE) : '',
    groupId: typeof raw.groupId === 'string' ? raw.groupId : null,
    pinned: !!raw.pinned,
  };
}

/** Validate a remote device entry the way bookmarks.sanitizeRemoteItem does
 * for favorites — a blob from a buggy/older client must not inject junk that
 * internal surfaces then render. */
function sanitizeEntry(raw) {
  if (!raw || !Number.isFinite(raw.updatedAt)) return null;
  if (raw.retracted) return { retracted: true, updatedAt: raw.updatedAt };
  return {
    name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, MAX_NAME) : 'unknown device',
    platform: typeof raw.platform === 'string' ? raw.platform : '',
    updatedAt: raw.updatedAt,
    tabs: (Array.isArray(raw.tabs) ? raw.tabs : []).map(sanitizeTab).filter(Boolean).slice(0, MAX_TABS),
    groups: (Array.isArray(raw.groups) ? raw.groups : [])
      .filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string')
      .map(({ id, name }) => ({ id, name: name.slice(0, MAX_NAME) })),
  };
}

/** LWW winner with a deterministic equal-clock rule (PR #41 review, P2):
 * a plain "local wins ties" made merge order-dependent, so two peers holding
 * different same-clock entries for a third device would never converge. On a
 * tie: our OWN entry is authoritative on this device — the stored full entry
 * must never lose to its budget-trimmed upload copy, which shares its clock
 * by design (exportDevices); for other devices a retraction wins, then the
 * lexicographically smaller canonical form. Symmetric for non-own ids, so
 * mergeDevices(a, b) === mergeDevices(b, a). */
function winner(local, remote, isOwn) {
  if (remote.updatedAt !== local.updatedAt) return remote.updatedAt > local.updatedAt ? remote : local;
  if (isOwn) return local;
  if (!!remote.retracted !== !!local.retracted) return remote.retracted ? remote : local;
  return canonical(remote) < canonical(local) ? remote : local;
}

/** Union by deviceId, last-writer-wins per entry on updatedAt with the
 * deterministic tie rule above (each device only ever rewrites its own
 * entry, so this is commutative and idempotent across peers — spec §5).
 * Both cached and remote entries are sanitized; this also migrates away any
 * unknown tab fields written by an experimental/newer client, keeping the
 * deployed session shape stable across mixed-version accounts. Both sides
 * prune at 30 days. */
function mergeDevices(local, remote, { now, ownId }) {
  const out = {};
  for (const [id, raw] of Object.entries(local ?? {})) {
    const e = sanitizeEntry(raw);
    if (e) out[id] = e;
  }
  for (const [id, raw] of Object.entries(remote ?? {})) {
    const e = sanitizeEntry(raw);
    if (!e) continue;
    const cur = out[id];
    out[id] = cur ? winner(cur, e, id === ownId) : e;
  }
  for (const [id, e] of Object.entries(out)) {
    if (now - e.updatedAt > PRUNE_MS) delete out[id];
  }
  return out;
}

/** Account-isolation guard (spec §4): cached device entries belong to the
 * account they were merged against. On a credential change they must be
 * discarded, never uploaded into the new account. Returns `stored` untouched
 * when the account matches. */
function rebindDevices(stored, accountId) {
  if (stored.accountId === accountId) return stored;
  return { accountId, devices: {} };
}

/** Our entry, rebuilt from live tab state before every push — but the clock
 * advances ONLY when the fingerprint changed or the 24h heartbeat is due
 * (spec §5), so a rebuilt-but-identical entry keeps its prior updatedAt and
 * the repair comparison can recognize a true no-op. */
function buildOwnEntry({ prev, snapshot, name, platform, now }) {
  const next = { name, platform, updatedAt: now, tabs: snapshot.tabs, groups: snapshot.groups };
  if (
    prev && !prev.retracted &&
    fingerprint(prev) === fingerprint(next) &&
    now - prev.updatedAt < HEARTBEAT_MS
  ) {
    return { ...next, updatedAt: prev.updatedAt };
  }
  return next;
}

/** Toggle-off publishes a retraction that LWW-beats every stale copy of our
 * tabs on other devices (spec §5). Never published → nothing to retract. */
function retractedEntry(prev, now) {
  if (!prev) return null;
  if (prev.retracted) return prev;
  return { retracted: true, updatedAt: now };
}

/** The consent gate (spec §3) as one pure decision: publishing only while
 * syncTabs is on AND a live snapshot exists; otherwise retract (or omit —
 * null — when this device never published). */
function ownEntryFor({ syncTabs, prev, snapshot, name, platform, now }) {
  if (syncTabs && snapshot) return buildOwnEntry({ prev, snapshot, name, platform, now });
  return retractedEntry(prev, now);
}

/** A continuously running device with stable tabs must republish at least
 * daily or it would age past the 30-day prune on every other device. */
const heartbeatDue = (entry, now) => !!entry && !entry.retracted && now - entry.updatedAt >= HEARTBEAT_MS;

/** The repair comparison (spec §6): PUT whenever export differs from the
 * decrypted remote map — which heals a blob that lost our unchanged entry. */
const devicesEqual = (a, b) => canonical(a ?? {}) === canonical(b ?? {});

/** Account-level size budget (spec §7): the worker's 512 KB cap applies to
 * the combined encrypted map, so bound the plaintext here — in UTF-8 BYTES
 * (ciphertext size tracks bytes; CJK/emoji titles are 3–4 bytes per char, so
 * a JS-char budget would pass locally and still trip the worker cap). Trim
 * our own tab list from the end first (dropping any group the trim orphans);
 * only then drop the stalest OTHER devices — they resurrect from their own
 * next push. Input is not mutated. */
function applyBudget(devices, ownId, { maxBytes = BUDGET_BYTES } = {}) {
  const out = { ...devices };
  const over = () => Buffer.byteLength(canonical(out), 'utf8') > maxBytes;
  if (!over()) return out;
  if (out[ownId] && !out[ownId].retracted) {
    const own = { ...out[ownId], tabs: [...out[ownId].tabs] };
    out[ownId] = own;
    while (own.tabs.length && over()) {
      own.tabs.splice(-Math.max(1, Math.ceil(own.tabs.length / 4)));
      own.groups = (own.groups ?? []).filter((g) => own.tabs.some((t) => t.groupId === g.id));
    }
  }
  const others = Object.entries(out)
    .filter(([id]) => id !== ownId)
    .sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
  for (const [id] of others) {
    if (!over()) break;
    delete out[id];
  }
  return out;
}

/** The whole export pipeline, pure and regression-tested: `store` is the
 * FULL merged map to persist locally; `upload` is the budget-trimmed copy to
 * encrypt and PUT. The stored map must keep the full own entry — persisting
 * the trimmed copy would make the next live snapshot differ from it, bump
 * the clock, and produce a PUT on every refresh. */
function exportDevices({ devices, deviceId, syncTabs, snapshot, name, platform, now, maxBytes }) {
  const next = { ...devices };
  const own = ownEntryFor({ syncTabs, prev: next[deviceId] ?? null, snapshot, name, platform, now });
  if (own) next[deviceId] = own;
  else delete next[deviceId];
  const store = mergeDevices(next, {}, { now, ownId: deviceId }); // prunes our cache at 30 days
  const upload = applyBudget(store, deviceId, maxBytes ? { maxBytes } : {});
  return { store, upload };
}

/** What the UI renders (spec §2): other devices' non-retracted, non-empty,
 * non-stale entries, newest first. */
function displayDevices(devices, ownId, { now }) {
  return Object.entries(devices ?? {})
    .filter(([id, e]) =>
      id !== ownId && e && !e.retracted &&
      Array.isArray(e.tabs) && e.tabs.length > 0 &&
      now - e.updatedAt <= PRUNE_MS)
    .map(([deviceId, e]) => ({
      deviceId, name: e.name, platform: e.platform, updatedAt: e.updatedAt,
      tabs: e.tabs, groups: e.groups ?? [],
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

module.exports = {
  PRUNE_MS, HEARTBEAT_MS, BUDGET_BYTES,
  canonical, fingerprint, sanitizeEntry,
  mergeDevices, rebindDevices,
  buildOwnEntry, retractedEntry, ownEntryFor, heartbeatDue,
  devicesEqual, applyBudget, exportDevices, displayDevices,
};
