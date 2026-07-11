// Pure, non-mutating transforms over a { items, tombstones } snapshot. Each
// returns new arrays and a `changed` flag; bookmarks.js writes only when
// changed. All folder identity/canonicalization rules live here.
const { validFavicon, validFolder, folderKey } = require('./bookmark-validate');

/** Map folderKey -> canonical spelling, chosen from the item with the oldest
 * addedAt (tie: smallest id) — fully deterministic so independent devices
 * converge on the same spelling. Ungrouped items are ignored. */
function buildCanonMap(items) {
  const map = new Map(); // key -> { folder, addedAt, id }
  for (const it of items) {
    if (it.folder == null) continue;
    const key = folderKey(it.folder);
    const cur = map.get(key);
    const addedAt = Number.isFinite(it.addedAt) ? it.addedAt : 0;
    const id = String(it.id ?? '');
    if (!cur || addedAt < cur.addedAt || (addedAt === cur.addedAt && id < cur.id)) {
      map.set(key, { folder: it.folder, addedAt, id });
    }
  }
  return map;
}

const oldestFirst = (a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0);

function addImported({ items, tombstones }, entries, { now, makeId }) {
  const seen = new Set(items.map((it) => it.url));
  const canon = buildCanonMap(items); // key -> { folder }
  const added = [];
  let skipped = 0;
  for (const e of entries || []) {
    if (typeof e.url !== 'string' || seen.has(e.url)) { skipped++; continue; }
    seen.add(e.url);
    let folder = validFolder(e.folder);
    if (folder != null) {
      const key = folderKey(folder);
      const existing = canon.get(key);
      if (existing) folder = existing.folder;      // first-existing spelling wins
      else canon.set(key, { folder });             // new folder: first-in-file spelling
    }
    added.push({
      id: makeId(),
      url: e.url,
      title: typeof e.title === 'string' && e.title ? e.title : e.url,
      favicon: validFavicon(e.favicon),
      addedAt: Number.isFinite(e.addedAt) ? e.addedAt : now,
      updatedAt: now,
      folder,
    });
  }
  if (added.length === 0) return { items, tombstones, added: 0, skipped, changed: false };
  const addedUrls = new Set(added.map((it) => it.url));
  return {
    items: [...items, ...added].sort(oldestFirst),
    tombstones: tombstones.filter((t) => !addedUrls.has(t.url)),
    added: added.length,
    skipped,
    changed: true,
  };
}

function applySetFolder({ items }, id, folder, { now }) {
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return { items, changed: false };
  let target;
  if (folder === null) {
    target = null;
  } else {
    const valid = validFolder(folder);
    if (valid === null) return { items, changed: false }; // invalid string: no-op, never ungroup
    const existing = buildCanonMap(items).get(folderKey(valid));
    target = existing ? existing.folder : valid;
  }
  if ((items[idx].folder ?? null) === (target ?? null)) return { items, changed: false };
  const next = items.slice();
  next[idx] = { ...items[idx], folder: target, updatedAt: now };
  return { items: next, changed: true };
}

function applyRenameFolder({ items }, oldName, newName, { now }) {
  const target0 = validFolder(newName);
  if (target0 === null) return { items, changed: false }; // reject blank/over-long
  const oldKey = folderKey(oldName);
  let target;
  if (folderKey(newName) === oldKey) {
    target = target0; // case-only rename: use the new spelling verbatim
  } else {
    const existing = buildCanonMap(items).get(folderKey(target0));
    target = existing ? existing.folder : target0; // merge-on-collision
  }
  let changed = false;
  const next = items.map((it) => {
    if (it.folder != null && folderKey(it.folder) === oldKey && it.folder !== target) {
      changed = true;
      return { ...it, folder: target, updatedAt: now };
    }
    return it;
  });
  return changed ? { items: next, changed: true } : { items, changed: false };
}

function applyRemoveFolder({ items }, name, { now }) {
  const key = folderKey(name);
  let changed = false;
  const next = items.map((it) => {
    if (it.folder != null && folderKey(it.folder) === key) {
      changed = true;
      return { ...it, folder: null, updatedAt: now };
    }
    return it;
  });
  return changed ? { items: next, changed: true } : { items, changed: false };
}

/** Collapse every folderKey group to one spelling. Rewrites folder spelling
 * ONLY — never touches updatedAt (cosmetic, must not outrank a real edit under
 * LWW or trigger sync ping-pong). */
function canonicalizeFolders(items) {
  const canon = buildCanonMap(items);
  return items.map((it) => {
    if (it.folder == null) return it;
    const target = canon.get(folderKey(it.folder))?.folder;
    return target && target !== it.folder ? { ...it, folder: target } : it;
  });
}

/** Group favorites for the native Favorites menu: folders first (alphabetical,
 * case-insensitive), each folder's items newest-first, then ungrouped items
 * newest-first — mirroring the Favorites page. Pure: the menu builder wires
 * click handlers onto the returned bookmarks.
 *
 * Ordering is intentionally identical to `group()` in
 * src/renderer/pages/bookmarks.js (the page can't share this — different
 * runtime); keep the two in sync so the menu and page never disagree. */
function groupFavoritesForMenu(items) {
  const newestFirst = (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0);
  const byKey = new Map(); // folderKey -> { name, items }
  const ungrouped = [];
  for (const b of items) {
    if (b.folder == null) { ungrouped.push(b); continue; }
    const key = folderKey(b.folder);
    if (!byKey.has(key)) byKey.set(key, { name: b.folder, items: [] });
    byKey.get(key).items.push(b);
  }
  const folders = [...byKey.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  for (const f of folders) f.items.sort(newestFirst);
  ungrouped.sort(newestFirst);
  return { folders, ungrouped };
}

module.exports = {
  addImported, applySetFolder, applyRenameFolder, applyRemoveFolder, canonicalizeFolders,
  groupFavoritesForMenu,
};
