# `/save [folder]` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/save [folder]` slash command that quick-favorites the active tab from the ⌘L command bar, optionally filing it into a Favorites folder.

**Architecture:** A pure, add-only store transform (`applySaveFavorite`) lives in `src/main/bookmark-data.js` alongside the other folder transforms and is unit-tested there. A thin `bookmarks.saveFavorite` wrapper does one write + one sync notification; `main.js` exposes it over the existing `tabs:*` IPC namespace; `overlay.js` adds the command; and the copy is registered in all **three** hand-synced slash-command inventories with `copy/build.mjs` extended to guard the third.

**Tech Stack:** Electron main/renderer, Node's built-in `node --test` for unit tests, the repo's `copy/` substrate generator.

## Global Constraints

- **Add-only / idempotent.** `/save` only ever adds; it never removes a favorite.
- **Guards (mirror `toggleBookmarkForActiveTab`):** no-op when the active tab is `private` or its URL is not `http(s)` (`!/^https?:\/\//.test(tab.url)`).
- **Folder rules (via existing `bookmark-data.js` machinery):** new folder keeps trimmed spelling; a case-insensitive match adopts the existing **canonical spelling**; a non-empty folder longer than **100 chars is rejected as a total no-op** — never a top-level save. An empty argument reaches the store as `folder = null` (top-level save).
- **Folder move on re-save:** an already-saved page + a *named* folder files it into that folder (`updatedAt` bumped); an already-saved page + bare `/save` is a no-op.
- **Copy is identical, verbatim, across four locations** (order matters — insert right after `/favorites` everywhere): `copy/slash-commands.json` (source of truth), `overlay.js` COMMANDS (base spelling), `pages/shortcuts.js` + `main.js` Help-menu `SLASH_COMMANDS` (both use the `doc`-override spelling `/save [folder]`). Palette hint uses an em dash `—` (U+2014).
- **Never hand-edit `copy/generated/`** — run `npm run copy:build` to regenerate.
- **Chrome documents load once at window creation** — verify overlay/renderer changes with a fresh `npm start`, not ⌘R.

---

### Task 1: `applySaveFavorite` pure transform + unit tests

**Files:**
- Modify: `src/main/bookmark-data.js` (add function + export; currently ends at the `module.exports` on line ~152)
- Test: `test/unit/bookmark-data.test.js` (add cases + import)

**Interfaces:**
- Consumes: existing `bookmark-data.js` helpers already imported at the top of the file — `validFavicon`, `validFolder`, `folderKey` (from `./bookmark-validate`) and the module-local `buildCanonMap(items)`.
- Produces: `applySaveFavorite({ items, tombstones }, { url, title, favicon, folder }, { now, makeId }) → { items, tombstones, changed }`. `folder` is `null` (top-level) or a candidate string. Returns `changed: false` for a rejected/over-long folder, an idempotent bare re-save, or a no-change folder move; otherwise returns new arrays.

- [ ] **Step 1: Write the failing tests**

Add these tests to the end of `test/unit/bookmark-data.test.js`, and add `applySaveFavorite` to the destructured `require` at the top of that file (line 3–6):

```js
test('applySaveFavorite: new url adds at top level (folder null)', () => {
  const res = applySaveFavorite(snap([]), { url: 'https://a.com/', title: 'A', favicon: null, folder: null }, opts);
  assert.equal(res.changed, true);
  assert.equal(res.items.length, 1);
  const a = res.items[0];
  assert.equal(a.url, 'https://a.com/');
  assert.equal(a.folder, null);
  assert.equal(a.addedAt, NOW);
  assert.equal(a.updatedAt, NOW);
  assert.equal(a.id, 'id1');
});

test('applySaveFavorite: new url into a folder adopts existing canonical spelling', () => {
  const cur = snap([{ id: 'a', url: 'https://a.com/', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: 'Work' }]);
  const res = applySaveFavorite(cur, { url: 'https://b.com/', title: 'B', favicon: null, folder: 'WORK' }, opts);
  assert.equal(res.changed, true);
  assert.equal(res.items.find((it) => it.url === 'https://b.com/').folder, 'Work'); // canonical spelling
});

test('applySaveFavorite: new url with a fresh folder keeps its trimmed spelling', () => {
  const res = applySaveFavorite(snap([]), { url: 'https://a.com/', title: 'A', favicon: null, folder: '  Reading List  ' }, opts);
  assert.equal(res.items[0].folder, 'Reading List');
});

test('applySaveFavorite: over-long folder is rejected — nothing added', () => {
  const res = applySaveFavorite(snap([]), { url: 'https://a.com/', title: 'A', favicon: null, folder: 'x'.repeat(101) }, opts);
  assert.equal(res.changed, false);
  assert.equal(res.items.length, 0); // never falls back to a top-level save
});

test('applySaveFavorite: already saved + bare save is a no-op', () => {
  const cur = snap([{ id: 'a', url: 'https://a.com/', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: 'Work' }]);
  const res = applySaveFavorite(cur, { url: 'https://a.com/', title: 'A2', favicon: null, folder: null }, opts);
  assert.equal(res.changed, false);
  assert.equal(res.items[0].folder, 'Work'); // untouched
  assert.equal(res.items[0].title, 'A');     // not overwritten
});

test('applySaveFavorite: already saved + named folder moves it (updatedAt bumped)', () => {
  const cur = snap([{ id: 'a', url: 'https://a.com/', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: null }]);
  const res = applySaveFavorite(cur, { url: 'https://a.com/', title: 'A', favicon: null, folder: 'Work' }, opts);
  assert.equal(res.changed, true);
  assert.equal(res.items[0].folder, 'Work');
  assert.equal(res.items[0].updatedAt, NOW);
});

test('applySaveFavorite: already saved + same folder (case-variant) is a no-op', () => {
  const cur = snap([{ id: 'a', url: 'https://a.com/', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: 'Work' }]);
  const res = applySaveFavorite(cur, { url: 'https://a.com/', title: 'A', favicon: null, folder: 'work' }, opts);
  assert.equal(res.changed, false);
});

test('applySaveFavorite: adding clears a prior tombstone for that url', () => {
  const cur = snap([], [{ url: 'https://a.com/', deletedAt: 100 }]);
  const res = applySaveFavorite(cur, { url: 'https://a.com/', title: 'A', favicon: null, folder: null }, opts);
  assert.equal(res.changed, true);
  assert.equal(res.tombstones.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `applySaveFavorite is not a function` (or `undefined`) from the new cases.

- [ ] **Step 3: Implement `applySaveFavorite`**

In `src/main/bookmark-data.js`, add this function immediately after `applySetFolder` (after line ~78, before `applyRenameFolder`):

```js
/** Save a favorite — add-only and idempotent. `folder`: null = save at / keep
 * at top level; a non-null candidate is validated (blank/over-long → reject,
 * NEVER a silent top-level save) and canonicalized to an existing folder's
 * spelling. On an already-saved url, only an explicitly named folder moves it
 * (a bare save leaves it untouched). Mirrors toggleBookmark's add path
 * (append, clear the url's tombstone) plus applySetFolder's folder resolution. */
function applySaveFavorite({ items, tombstones }, { url, title, favicon, folder }, { now, makeId }) {
  let target = null;
  if (folder != null) {
    const valid = validFolder(folder);
    if (valid === null) return { items, tombstones, changed: false }; // reject before any add
    const existing = buildCanonMap(items).get(folderKey(valid));
    target = existing ? existing.folder : valid;
  }
  const idx = items.findIndex((it) => it.url === url);
  if (idx !== -1) {
    // Already saved: bare save is a no-op; a named folder moves it.
    if (folder == null || (items[idx].folder ?? null) === target) return { items, tombstones, changed: false };
    const next = items.slice();
    next[idx] = { ...items[idx], folder: target, updatedAt: now };
    return { items: next, tombstones, changed: true };
  }
  const item = { id: makeId(), url, title: title || url, favicon: validFavicon(favicon), addedAt: now, updatedAt: now, folder: target };
  return {
    items: [...items, item],
    tombstones: tombstones.filter((t) => t.url !== url), // re-favoriting clears a prior delete
    changed: true,
  };
}
```

Then add `applySaveFavorite` to `module.exports` at the bottom of the file (currently `module.exports = { addImported, applySetFolder, applyRenameFolder, applyRemoveFolder, canonicalizeFolders, groupFavoritesForMenu };`):

```js
module.exports = {
  addImported, applySaveFavorite, applySetFolder, applyRenameFolder, applyRemoveFolder, canonicalizeFolders,
  groupFavoritesForMenu,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS — all existing `bookmark-data` tests plus the seven new `applySaveFavorite` cases.

- [ ] **Step 5: Commit**

```bash
git add src/main/bookmark-data.js test/unit/bookmark-data.test.js
git commit -m "feat(bookmarks): add applySaveFavorite pure transform"
```

---

### Task 2: Main-process wiring — store wrapper, `saveActiveTabAsFavorite`, IPC, preload bridge

**Files:**
- Modify: `src/main/bookmarks.js` (add `saveFavorite` wrapper + export)
- Modify: `src/main/main.js` (add `saveActiveTabAsFavorite` after `toggleBookmarkForActiveTab` ~line 1352; register handler after the `tabs:toggle-bookmark` line ~1499)
- Modify: `src/main/preload.js` (add `saveFavorite` to `browserAPI`, after `toggleBookmark` ~line 20)

**Interfaces:**
- Consumes: `data.applySaveFavorite(...)` from Task 1; existing `bookmarks.isBookmarked(url)`, `main.js`'s `tabs` Map / `activeTabId` / `broadcastTabs()` / `scheduleMenuRebuild()`, and the `chromeHandle(channel, handler)` helper.
- Produces: `bookmarks.saveFavorite(url, title, favicon, folder)` (returns nothing; writes once on change); `main.js` `saveActiveTabAsFavorite(folder)`; IPC channel `tabs:save-favorite`; `window.browserAPI.saveFavorite(folder)` for the renderer.

> **Note on testing:** this task has no automated functional test (the store wrapper needs Electron's `JsonStore` and `main.js` needs a running app). Its gate is: `npm run test:unit` and `npm run substrate:check` still pass (no regression), and `npm start` launches without error. End-to-end behavior is exercised in Task 3 once the command surface exists.

- [ ] **Step 1: Add the `saveFavorite` wrapper to `bookmarks.js`**

In `src/main/bookmarks.js`, add this function immediately after `toggleBookmark` (after line ~51):

```js
/** Add-only quick-save (the `/save` command). One write + one change
 * notification on change, mirroring setBookmarkFolder; a rejected/idempotent
 * call writes nothing. Folder validation/canonicalization live in the pure
 * transform. */
function saveFavorite(url, title, favicon, folder) {
  const s = ensureStore();
  const res = data.applySaveFavorite(s.data, { url, title, favicon, folder }, { now: Date.now(), makeId: crypto.randomUUID });
  if (!res.changed) return;
  s.update((d) => { d.items = res.items; d.tombstones = res.tombstones; });
  notifyChanged();
}
```

Add `saveFavorite` to `module.exports` (line ~186), after `toggleBookmark`:

```js
module.exports = { listBookmarks, isBookmarked, toggleBookmark, saveFavorite, updateFavicon, removeBookmark, importBookmarks, setBookmarkFolder, renameFolder, removeFolder, exportForSync, mergeFromSync, onChanged, onMerged };
```

- [ ] **Step 2: Add `saveActiveTabAsFavorite` to `main.js`**

In `src/main/main.js`, add this function immediately after `toggleBookmarkForActiveTab` (after line ~1352):

```js
/** The `/save [folder]` command: add-only favorite of the active tab, into an
 * optional folder. Same guards as toggleBookmarkForActiveTab; re-derives
 * bookmarked from the store so add / move / rejected-folder all report right. */
function saveActiveTabAsFavorite(folder) {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.private || !/^https?:\/\//.test(tab.url)) return;
  bookmarks.saveFavorite(tab.url, tab.title, tab.favicon, folder);
  tab.bookmarked = bookmarks.isBookmarked(tab.url);
  broadcastTabs();
  scheduleMenuRebuild();
}
```

- [ ] **Step 3: Register the IPC handler in `main.js`**

Immediately after the `tabs:toggle-bookmark` registration (line ~1499):

```js
  chromeHandle('tabs:save-favorite', (_e, folder) => saveActiveTabAsFavorite(folder));
```

- [ ] **Step 4: Add the preload bridge method**

In `src/main/preload.js`, immediately after the `toggleBookmark` line (~line 20):

```js
  saveFavorite: (folder) => ipcRenderer.invoke('tabs:save-favorite', folder),
```

- [ ] **Step 5: Verify no regression and clean launch**

Run: `npm run test:unit`
Expected: PASS (unchanged from Task 1).

Run: `npm run substrate:check`
Expected: PASS (no copy touched yet).

Run: `npm start`, confirm the app window opens with no console error, then quit.
Expected: launches cleanly (the new IPC path exists but nothing calls it yet).

- [ ] **Step 6: Commit**

```bash
git add src/main/bookmarks.js src/main/main.js src/main/preload.js
git commit -m "feat(bookmarks): wire saveFavorite through main process + preload"
```

---

### Task 3: Command surface + copy substrate (all three inventories + guard)

**Files:**
- Modify: `src/renderer/overlay.js` (add COMMANDS entry after `/favorites` ~line 389)
- Modify: `copy/slash-commands.json` (add command after `/favorites` ~line 8; add `main` source; update `$note`)
- Modify: `src/renderer/pages/shortcuts.js` (add `SLASH_COMMANDS` row after `/favorites` ~line 6)
- Modify: `src/main/main.js` (add `SLASH_COMMANDS` Help-menu row after `/favorites` ~line 1691)
- Modify: `copy/build.mjs` (parametrize the tuple parser, guard the `main.js` copy, update header comment)
- Regenerate: `copy/generated/SlashCommands.strings`, `copy/generated/slash_commands.xml` (via `npm run copy:build` — do not hand-edit)

**Interfaces:**
- Consumes: `window.browserAPI.saveFavorite(folder)` from Task 2; the `copy/build.mjs` `spec.sources`, `parseOverlay`, `diffList`, and `check()` structures.
- Produces: nothing consumed downstream — this task makes the command usable and keeps the four copies drift-guarded.

- [ ] **Step 1: Add the overlay command**

In `src/renderer/overlay.js`, insert into the `COMMANDS` array immediately after the `/favorites` entry (after line ~389). Keep `cmd` and `hint` on one line (the substrate parser is line-anchored):

```js
    { cmd: '/save', hint: 'Save this page to favorites — name a folder to file it', run: (input) => {
      const folder = (input ?? '').replace(/^\/save\s*/, '').trim();
      window.browserAPI.saveFavorite(folder || null);
    } },
```

- [ ] **Step 2: Add the command to the source of truth + register the third source**

In `copy/slash-commands.json`, insert this object immediately after the `/favorites` entry (after line ~8):

```json
    { "command": "/save", "hint": "Save this page to favorites — name a folder to file it", "doc": { "command": "/save [folder]", "hint": "Save this page to favorites, into a folder if you name one" } },
```

In the same file, add the `main` source to the `sources` object so the guard can find the third copy:

```json
  "sources": {
    "overlay": "src/renderer/overlay.js",
    "shortcuts": "src/renderer/pages/shortcuts.js",
    "main": "src/main/main.js"
  },
```

Update the `$note` string so it names all three copies — append to it: ` The Help → Slash Commands list in main.js (SLASH_COMMANDS) is a third copy in the doc-override spelling, guarded the same way.`

- [ ] **Step 3: Add the row to `pages/shortcuts.js`**

In `src/renderer/pages/shortcuts.js`, insert into `SLASH_COMMANDS` immediately after the `/favorites` row (after line ~6):

```js
  ['/save [folder]', 'Save this page to favorites, into a folder if you name one'],
```

- [ ] **Step 4: Add the row to the `main.js` Help-menu list**

In `src/main/main.js`, insert into the `SLASH_COMMANDS` array immediately after the `/favorites` row (after line ~1691):

```js
  ['/save [folder]', 'Save this page to favorites, into a folder if you name one'],
```

- [ ] **Step 5: Extend `copy/build.mjs` to guard the third copy**

In `copy/build.mjs`, replace the `parseShortcuts()` function (lines ~45–49) with a source-keyed parser that serves both tuple-list copies:

```js
// shortcuts.js and main.js each hold a `const SLASH_COMMANDS = [ ['cmd','hint'], … ]`
// in the doc-override spelling — parse either by its spec.sources key.
function parseTupleList(sourceKey) {
  const js = fs.readFileSync(path.join(ROOT, spec.sources[sourceKey]), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = js.match(/const SLASH_COMMANDS = \[([\s\S]*?)\];/)?.[1] ?? '';
  return [...block.matchAll(/^\s*\['([^']+)',\s*'([^']*)'\]/gm)].map((m) => ({ command: m[1], hint: m[2] }));
}
```

In `check()` (lines ~68–71), replace the `problems` array with the three-copy version:

```js
  const problems = [
    ...diffList('overlay.js', parseOverlay(), overlayExpected),
    ...diffList('shortcuts.js', parseTupleList('shortcuts'), shortcutsExpected),
    ...diffList('main.js', parseTupleList('main'), shortcutsExpected),
  ];
```

Update the file header comment (lines ~4–6) so it names three copies — change the `--check` description to: `verify all THREE desktop copies (overlay.js command table, pages/shortcuts.js reference list, and main.js's Help-menu SLASH_COMMANDS) match slash-commands.json,` and the following line's `the two hand-synced JS copies` → `the hand-synced JS copies`.

- [ ] **Step 6: Regenerate the mobile artifacts**

Run: `npm run copy:build`
Expected: rewrites `copy/generated/SlashCommands.strings` and `copy/generated/slash_commands.xml`, each gaining a `slash_save` entry. (These are committed, never hand-edited.)

- [ ] **Step 7: Verify the substrate guard passes and actually guards main.js**

Run: `npm run substrate:check`
Expected: PASS — `copy:check OK — both desktop copies match…` (the log line is cosmetic; the check now diffs three copies).

Prove the new `main.js` guard has teeth: temporarily change the `/save [folder]` hint in `main.js`'s `SLASH_COMMANDS` (e.g. drop a word), then:

Run: `npm run copy:check`
Expected: FAIL with a `main.js #1: got {…} source says {…}` drift line.

Revert the deliberate change, then re-run `npm run copy:check`.
Expected: PASS again.

- [ ] **Step 8: Verify units still pass, then manual end-to-end**

Run: `npm run test:unit`
Expected: PASS (unchanged).

Run: `npm start` (a **fresh** launch — chrome docs don't hot-reload), then walk the matrix:
- ⌘L → type `/save` → Enter → page appears in `blanc://bookmarks/` at top level; ⌘L → `/save` again → nothing changes (add-only).
- ⌘L → `/save work` → the page is filed under a new "work" folder; from a second `https://` page, `/save WORK` → joins the **same** folder (canonical "work" spelling).
- On the already-saved top-level page, `/save work` → it moves into "work".
- `/save reading list` → multi-word folder name preserved.
- `/save ` followed by a >100-char name → nothing is saved (no top-level fallback).
- `/save` on a private tab, on `blanc://settings/`, and on a blank new tab → no-op, no favorite created.
- Menu bar → Help → Slash Commands lists `/save [folder]`; `blanc://shortcuts/` lists `/save [folder]`.
- Typing bare `/s` shows both `/save` and `/settings` (with `/save` on top).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/overlay.js copy/slash-commands.json src/renderer/pages/shortcuts.js src/main/main.js copy/build.mjs copy/generated/SlashCommands.strings copy/generated/slash_commands.xml
git commit -m "feat(island): add /save [folder] command across all three inventories"
```

---

## Self-Review

**Spec coverage:**
- `/save` add-only, top-level → Task 1 (`applySaveFavorite` add path) + Task 3 (overlay command). ✓
- `/save <folder>` find-or-create + canonical spelling → Task 1 (canonicalization tests) + Task 2 (wrapper) + Task 3 (overlay parse). ✓
- Guards (private / non-http(s)) → Task 2 (`saveActiveTabAsFavorite`). ✓
- Over-long folder reject, empty → null → Task 1 (reject test) + Task 3 (overlay `folder || null`). ✓
- Move-on-re-save / bare-save no-op → Task 1 (move + no-op tests). ✓
- One write / one notification → Task 2 (`saveFavorite` wrapper, `if (!res.changed) return`). ✓
- `tab.bookmarked` correct for add/move/reject → Task 2 (`isBookmarked` re-derive). ✓
- Third inventory (main.js Help) + guard extension → Task 3 (steps 4–5, 7). ✓
- Copy in all four locations, order after `/favorites`, em dash → Task 3 (steps 1–4). ✓
- Regenerated mobile artifacts → Task 3 (step 6, 9 commit). ✓

**Placeholder scan:** No TBD/TODO; every code step shows the actual code; every command step shows expected output. ✓

**Type consistency:** `applySaveFavorite({items,tombstones}, {url,title,favicon,folder}, {now,makeId}) → {items,tombstones,changed}` is defined identically in Task 1 (impl + tests) and consumed with matching argument shape in Task 2's `saveFavorite` wrapper. `saveFavorite(url,title,favicon,folder)` (Task 2) matches the overlay call `saveFavorite(folder || null)`… note: the overlay bridge passes only `folder`; `main.js`'s `saveActiveTabAsFavorite(folder)` supplies `tab.url/title/favicon`. IPC channel name `tabs:save-favorite` matches across preload (Task 2 step 4) and handler (Task 2 step 3). ✓
