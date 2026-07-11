const crypto = require('crypto');
const { JsonStore } = require('./store');
const { validFavicon, validFolder } = require('./bookmark-validate');
const data = require('./bookmark-data');

let store = null;
const ensureStore = () => (store ??= new JsonStore('bookmarks', { items: [], tombstones: [] }));

// Two independent listener sets, deliberately separate:
//  - changeListeners: a LOCAL user edit → the sync engine schedules a push.
//  - mergeListeners:  a sync PULL applied remote changes → refresh open UI.
// A merge must refresh the UI (mergeListeners) WITHOUT re-triggering a sync
// (changeListeners), or a pulled change would schedule another sync and loop.
const changeListeners = new Set();
const mergeListeners = new Set();
const onChanged = (fn) => changeListeners.add(fn);
const onMerged = (fn) => mergeListeners.add(fn);
const notifyChanged = () => { for (const fn of changeListeners) fn(); };
const notifyMerged = () => { for (const fn of mergeListeners) fn(); };

function listBookmarks() {
  return [...ensureStore().data.items];
}

function isBookmarked(url) {
  return ensureStore().data.items.some((b) => b.url === url);
}

/** Toggle a bookmark for `url`; returns the new bookmarked state. `favicon`
 * is the tab's favicon URL at the time of favoriting, shown on the start
 * page — a missing/invalid one just falls back to the letter tile there,
 * and `updateFavicon` keeps it fresh afterward as the tab's own favicon
 * resolves or upgrades. */
function toggleBookmark(url, title, favicon) {
  const s = ensureStore();
  if (isBookmarked(url)) {
    s.update((d) => {
      d.items = d.items.filter((b) => b.url !== url);
      d.tombstones.push({ url, deletedAt: Date.now() });
    });
    notifyChanged();
    return false;
  }
  s.update((d) => {
    const now = Date.now();
    d.items.push({ id: crypto.randomUUID(), url, title: title || url, favicon: validFavicon(favicon), addedAt: now, updatedAt: now, folder: null });
    d.tombstones = d.tombstones.filter((t) => t.url !== url); // re-favoriting clears a prior delete
  });
  notifyChanged();
  return true;
}

/** Patch an existing bookmark's favicon — called as a tab's favicon
 * resolves/upgrades (self-healing a bookmark made before the sharp icon
 * loaded, or one bulk-added while its tab was still loading) and when the
 * start page reports a stored favicon URL as dead (`favicon: null`, so it
 * stops retrying). No-op if `url` isn't bookmarked.
 *
 * Favicon is cosmetic, device-local self-healing: deliberately NOT stamped
 * into `updatedAt` and NOT a sync trigger, so an incidental favicon refresh
 * can't outrank a delete tombstone and resurrect a favorite deleted on
 * another device. */
function updateFavicon(url, favicon) {
  const validated = validFavicon(favicon);
  const s = ensureStore();
  if (!s.data.items.some((b) => b.url === url && b.favicon !== validated)) return;
  s.update((d) => {
    const item = d.items.find((b) => b.url === url);
    if (item) item.favicon = validated;
  });
}

function removeBookmark(id) {
  ensureStore().update((d) => {
    const item = d.items.find((b) => b.id === id);
    d.items = d.items.filter((b) => b.id !== id);
    if (item) d.tombstones.push({ url: item.url, deletedAt: Date.now() });
  });
  notifyChanged();
}

/** Bulk-import parsed entries; dedupe by url, one sync-triggering write. */
function importBookmarks(entries) {
  const s = ensureStore();
  const res = data.addImported(s.data, entries, { now: Date.now(), makeId: crypto.randomUUID });
  if (res.changed) {
    s.update((d) => { d.items = res.items; d.tombstones = res.tombstones; });
    notifyChanged();
  }
  return { added: res.added, skipped: res.skipped };
}

function setBookmarkFolder(id, folder) {
  const s = ensureStore();
  const res = data.applySetFolder(s.data, id, folder, { now: Date.now() });
  if (!res.changed) return;
  s.update((d) => { d.items = res.items; });
  notifyChanged();
}

function renameFolder(oldName, newName) {
  const s = ensureStore();
  const res = data.applyRenameFolder(s.data, oldName, newName, { now: Date.now() });
  if (!res.changed) return;
  s.update((d) => { d.items = res.items; });
  notifyChanged();
}

function removeFolder(name) {
  const s = ensureStore();
  const res = data.applyRemoveFolder(s.data, name, { now: Date.now() });
  if (!res.changed) return;
  s.update((d) => { d.items = res.items; });
  notifyChanged();
}

function exportForSync() {
  const { items, tombstones } = ensureStore().data;
  return { items, tombstones };
}

/** An item's effective clock for LWW/tombstone comparisons. Falls back to
 * addedAt so legacy items (persisted before `updatedAt` existed) get a real
 * timestamp instead of 0 — which would let any tombstone delete them. */
const itemClock = (it) => (Number.isFinite(it.updatedAt) ? it.updatedAt : (Number.isFinite(it.addedAt) ? it.addedAt : 0));

/** Validate a remote item the same way local writes are validated — a blob
 * from a buggy/older client must not inject an unvalidated favicon or a
 * non-string title, since favorites are served straight to internal pages. */
function sanitizeRemoteItem(it) {
  if (!it || typeof it.url !== 'string') return null;
  const addedAt = Number.isFinite(it.addedAt) ? it.addedAt : Date.now();
  return {
    id: typeof it.id === 'string' ? it.id : crypto.randomUUID(),
    url: it.url,
    title: typeof it.title === 'string' && it.title ? it.title : it.url,
    favicon: validFavicon(it.favicon),
    addedAt,
    updatedAt: Number.isFinite(it.updatedAt) ? it.updatedAt : addedAt,
    folder: validFolder(it.folder),
  };
}

// Union-merge a decrypted remote snapshot into local, keyed by url (Favorites
// are a set of urls). Newer effective-clock wins per item; a tombstone removes
// an item only when the item's clock is not newer than the delete. Nothing is
// ever silently dropped — deletes travel exclusively as tombstones.
function mergeFromSync(remote) {
  ensureStore().update((d) => {
    const byUrl = new Map(d.items.map((it) => [it.url, it]));
    for (const raw of remote.items ?? []) {
      const it = sanitizeRemoteItem(raw);
      if (!it) continue;
      const cur = byUrl.get(it.url);
      if (!cur || it.updatedAt > itemClock(cur)) byUrl.set(it.url, it);
    }
    const tomb = new Map();
    for (const t of [...d.tombstones, ...(remote.tombstones ?? [])]) {
      if (!t || typeof t.url !== 'string' || !Number.isFinite(t.deletedAt)) continue;
      const cur = tomb.get(t.url);
      if (!cur || t.deletedAt > cur.deletedAt) tomb.set(t.url, t);
    }
    for (const [url, t] of tomb) {
      const it = byUrl.get(url);
      if (it && itemClock(it) <= t.deletedAt) byUrl.delete(url);
    }
    // Oldest-first: listBookmarks() consumers (favoritesMenuItems' slice(-20)
    // .reverse(), the start page) rely on insertion (oldest-first) order.
    // Canonicalize folder spellings after merge: two devices can independently
    // create Work and work, and sanitizeRemoteItem only validates strings — so
    // collapse each folderKey group to one deterministic spelling here.
    d.items = data.canonicalizeFolders(
      [...byUrl.values()].sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))
    );
    // Drop tombstones superseded by a surviving newer item, plus stale ones.
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    d.tombstones = [...tomb.values()].filter((t) => {
      const it = byUrl.get(t.url);
      if (it && itemClock(it) > t.deletedAt) return false; // re-added after this delete
      return t.deletedAt >= cutoff;
    });
  });
  notifyMerged();
}

module.exports = { listBookmarks, isBookmarked, toggleBookmark, updateFavicon, removeBookmark, importBookmarks, setBookmarkFolder, renameFolder, removeFolder, exportForSync, mergeFromSync, onChanged, onMerged };
