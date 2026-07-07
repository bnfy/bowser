const crypto = require('crypto');
const { JsonStore } = require('./store');

let store = null;
const ensureStore = () => (store ??= new JsonStore('bookmarks', { items: [], tombstones: [] }));

// Sync (and only sync) listens here; fired after local mutations, NOT after a
// sync merge — the merge is initiated by the sync engine's own cycle, so
// re-notifying would loop.
const changeListeners = new Set();
const onChanged = (fn) => changeListeners.add(fn);
const notifyChanged = () => { for (const fn of changeListeners) fn(); };

/** Same allow-list/length cap main.js's pickBestFavicon applies to the
 * async-refined favicon — the immediate page-favicon-updated value skips
 * that check, so anything persisted here must be validated independently. */
function validFavicon(favicon) {
  return typeof favicon === 'string' && favicon.length <= 2048 && /^(https?:|data:image\/)/i.test(favicon)
    ? favicon
    : null;
}

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
    d.items.push({ id: crypto.randomUUID(), url, title: title || url, favicon: validFavicon(favicon), addedAt: now, updatedAt: now });
    d.tombstones = d.tombstones.filter((t) => t.url !== url); // re-favoriting clears a prior delete
  });
  notifyChanged();
  return true;
}

/** Patch an existing bookmark's favicon — called as a tab's favicon
 * resolves/upgrades (self-healing a bookmark made before the sharp icon
 * loaded, or one bulk-added while its tab was still loading) and when the
 * start page reports a stored favicon URL as dead (`favicon: null`, so it
 * stops retrying). No-op if `url` isn't bookmarked. */
function updateFavicon(url, favicon) {
  const validated = validFavicon(favicon);
  const s = ensureStore();
  if (!s.data.items.some((b) => b.url === url && b.favicon !== validated)) return;
  s.update((d) => {
    const item = d.items.find((b) => b.url === url);
    if (item) { item.favicon = validated; item.updatedAt = Date.now(); }
  });
  notifyChanged();
}

function removeBookmark(id) {
  ensureStore().update((d) => {
    const item = d.items.find((b) => b.id === id);
    d.items = d.items.filter((b) => b.id !== id);
    if (item) d.tombstones.push({ url: item.url, deletedAt: Date.now() });
  });
  notifyChanged();
}

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

module.exports = { listBookmarks, isBookmarked, toggleBookmark, updateFavicon, removeBookmark, exportForSync, mergeFromSync, onChanged };
