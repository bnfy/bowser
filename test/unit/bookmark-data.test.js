const assert = require('node:assert/strict');
const test = require('node:test');
const {
  addImported, applySetFolder, applyRenameFolder, applyRemoveFolder, canonicalizeFolders,
  groupFavoritesForMenu,
} = require('../../src/main/bookmark-data');

const NOW = 2000;
let seq = 0;
const makeId = () => `id${++seq}`;
const opts = { now: NOW, makeId };
test.beforeEach(() => { seq = 0; });

const snap = (items, tombstones = []) => ({ items, tombstones });

test('addImported: dedupe vs existing and intra-batch, first occurrence wins', () => {
  const cur = snap([{ id: 'a', url: 'https://a.com/', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: null }]);
  const entries = [
    { url: 'https://a.com/', title: 'dup existing', addedAt: 5, folder: 'X' },
    { url: 'https://b.com/', title: 'B', addedAt: 10, folder: 'Work' },
    { url: 'https://b.com/', title: 'dup batch', addedAt: 11, folder: 'work' },
  ];
  const res = addImported(cur, entries, opts);
  assert.equal(res.added, 1);
  assert.equal(res.skipped, 2);
  assert.equal(res.changed, true);
  const b = res.items.find((it) => it.url === 'https://b.com/');
  assert.equal(b.title, 'B');
  assert.equal(b.folder, 'Work');
  assert.equal(b.updatedAt, NOW);
  // existing item untouched
  assert.equal(res.items.find((it) => it.url === 'https://a.com/').folder, null);
  // result oldest-first by addedAt
  assert.deepEqual(res.items.map((it) => it.addedAt), [1, 10]);
});

test('addImported: adopts existing folder spelling; all-duplicate => changed:false', () => {
  const cur = snap([{ id: 'a', url: 'https://a.com/', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: 'Work' }]);
  const res = addImported(cur, [{ url: 'https://c.com/', title: 'C', addedAt: 3, folder: 'WORK' }], opts);
  assert.equal(res.items.find((it) => it.url === 'https://c.com/').folder, 'Work'); // existing spelling wins

  const res2 = addImported(cur, [{ url: 'https://a.com/', title: 'dup', addedAt: 9, folder: 'X' }], opts);
  assert.equal(res2.changed, false);
  assert.equal(res2.added, 0);
  assert.equal(res2.skipped, 1);
});

test('addImported: clears tombstone for re-added url', () => {
  const cur = snap([], [{ url: 'https://a.com/', deletedAt: 100 }]);
  const res = addImported(cur, [{ url: 'https://a.com/', title: 'A', addedAt: 5, folder: null }], opts);
  assert.equal(res.tombstones.length, 0);
});

test('applySetFolder: explicit null ungroups; invalid string is a no-op (not ungroup)', () => {
  const cur = snap([{ id: 'a', url: 'u', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: 'Work' }]);
  assert.equal(applySetFolder(cur, 'a', null, opts).items[0].folder, null);
  assert.equal(applySetFolder(cur, 'a', '   ', opts).changed, false);       // blank
  assert.equal(applySetFolder(cur, 'a', 'x'.repeat(101), opts).changed, false); // too long
  assert.equal(applySetFolder(cur, 'missing', 'Y', opts).changed, false);   // unknown id
  assert.equal(applySetFolder(cur, 'a', 'Work', opts).changed, false);      // unchanged
});

test('applySetFolder: adopts existing spelling for a case-variant target', () => {
  const cur = snap([
    { id: 'a', url: 'ua', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: 'Reading' },
    { id: 'b', url: 'ub', title: 'B', favicon: null, addedAt: 2, updatedAt: 2, folder: null },
  ]);
  const res = applySetFolder(cur, 'b', 'READING', opts);
  assert.equal(res.items.find((it) => it.id === 'b').folder, 'Reading');
});

test('applyRenameFolder: merge-on-collision, case-only re-spell, rejects invalid', () => {
  const cur = snap([
    { id: 'a', url: 'ua', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: 'news' },
    { id: 'b', url: 'ub', title: 'B', favicon: null, addedAt: 2, updatedAt: 2, folder: 'Reading' },
  ]);
  const merged = applyRenameFolder(cur, 'News', 'Reading', opts); // collision -> merge
  assert.equal(merged.items.find((it) => it.id === 'a').folder, 'Reading');
  assert.equal(merged.items.find((it) => it.id === 'a').updatedAt, NOW);

  // case-only rename: stored 'news' re-spelled to 'News' (a real change)
  const respell = applyRenameFolder(cur, 'news', 'News', opts);
  assert.equal(respell.items.find((it) => it.id === 'a').folder, 'News');
  assert.equal(respell.changed, true);

  assert.equal(applyRenameFolder(cur, 'News', '   ', opts).changed, false);        // blank rejected
  assert.equal(applyRenameFolder(cur, 'Nope', 'Whatever', opts).changed, false);   // unknown folder
});

test('applyRemoveFolder: ungroups all in folder; empty => changed:false', () => {
  const cur = snap([
    { id: 'a', url: 'ua', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: 'Work' },
    { id: 'b', url: 'ub', title: 'B', favicon: null, addedAt: 2, updatedAt: 2, folder: 'Work' },
  ]);
  const res = applyRemoveFolder(cur, 'work', opts);
  assert.equal(res.changed, true);
  assert.equal(res.items.every((it) => it.folder === null), true);
  assert.equal(applyRemoveFolder(cur, 'Ghost', opts).changed, false);
});

test('canonicalizeFolders: mixed spellings collapse deterministically without touching updatedAt', () => {
  const items = [
    { id: 'a', url: 'ua', title: 'A', favicon: null, addedAt: 5, updatedAt: 5, folder: 'work' },
    { id: 'b', url: 'ub', title: 'B', favicon: null, addedAt: 2, updatedAt: 2, folder: 'Work' }, // oldest -> canonical
    { id: 'c', url: 'uc', title: 'C', favicon: null, addedAt: 9, updatedAt: 9, folder: null },
  ];
  const out = canonicalizeFolders(items);
  assert.equal(out.find((it) => it.id === 'a').folder, 'Work');
  assert.equal(out.find((it) => it.id === 'a').updatedAt, 5); // NOT bumped
  assert.equal(out.find((it) => it.id === 'c').folder, null);
  // idempotent / convergent
  assert.deepEqual(canonicalizeFolders(out).map((it) => it.folder), out.map((it) => it.folder));
});

test('groupFavoritesForMenu: folders alphabetical (case-insensitive) + newest-first, then ungrouped newest-first', () => {
  const items = [
    { id: '1', url: 'ua', title: 'A', addedAt: 1, folder: 'Zeta' },
    { id: '2', url: 'ub', title: 'B', addedAt: 5, folder: 'alpha' },
    { id: '3', url: 'uc', title: 'C', addedAt: 3, folder: 'alpha' },
    { id: '4', url: 'ud', title: 'D', addedAt: 2, folder: null },
    { id: '5', url: 'ue', title: 'E', addedAt: 9, folder: null },
  ];
  const { folders, ungrouped } = groupFavoritesForMenu(items);
  assert.deepEqual(folders.map((f) => f.name), ['alpha', 'Zeta']); // case-insensitive alpha order
  assert.deepEqual(folders[0].items.map((b) => b.title), ['B', 'C']); // newest-first (addedAt 5, 3)
  assert.deepEqual(ungrouped.map((b) => b.title), ['E', 'D']); // newest-first (addedAt 9, 2)
});

test('groupFavoritesForMenu: empty and all-ungrouped inputs', () => {
  assert.deepEqual(groupFavoritesForMenu([]), { folders: [], ungrouped: [] });
  const only = [{ id: '1', url: 'u', title: 'T', addedAt: 1, folder: null }];
  const r = groupFavoritesForMenu(only);
  assert.equal(r.folders.length, 0);
  assert.equal(r.ungrouped.length, 1);
});
