# Import Favorites + Favorites Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import favorites from any browser's exported bookmarks HTML file, and organize favorites into single-level folders managed on the Favorites page.

**Architecture:** All non-trivial logic lives in three new pure, Electron-free modules (`bookmark-validate.js`, `bookmark-import.js`, `bookmark-data.js`) unit-tested under `node --test`; `bookmarks.js` stays the thin `JsonStore` wrapper that writes only when a transform reports a real change; `pages.js` adds guarded IPC (native file dialog in main); the Favorites page renders grouped folder sections with a per-row folder picker.

**Tech Stack:** Electron (main process), Node `node:test`, vanilla DOM renderer over the privileged `blanc://` scheme, CSS custom properties.

## Global Constraints

- **No new npm dependencies.** Parser is a hand-written regex scan; crypto/uuid via Node built-ins already in use.
- **Folder model = tab-groups model:** single level, no separate entity, a folder exists only while a favorite references it. `null`/absent `folder` = ungrouped.
- **Folder identity is case-insensitive:** `folderKey(name) = name.trim().toLowerCase()`; first-existing spelling wins; rename-to-existing merges.
- **`null` folder is only ever an explicit ungroup** — invalid folder input is a no-op, never an ungroup.
- **`addedAt` is authoritative for order.** Store kept oldest-first by `addedAt` (same comparator as `mergeFromSync`); Favorites page sorts each folder `addedAt` descending.
- **Canonicalization never bumps `updatedAt`** and never triggers a sync push (rides `notifyMerged`, like favicon self-healing).
- **`validFavicon`: `http(s):`/`data:image/` only, ≤ 2048 chars. `validFolder`: trimmed non-empty string ≤ 100 chars, else `null`.** Import keeps only `http:`/`https:` links. Import file size cap: **20 MiB** (`20 * 1024 * 1024`), checked with `stat()` before `readFile`.
- **Guarded IPC:** every new `pages:*` handler uses the existing `handle()` wrapper that re-verifies the sender is an internal `blanc://` page.
- **Every commit message ends with:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (append as a second `-m` on each commit; omitted from step snippets for brevity).
- **Don't stage unrelated files** — the working tree may carry concurrent `site/` work. Stage only the paths each task names.
- Substrate checks and per-file CSP are unaffected (no new slash command, settings enum, token, or web-facing resource).

## File Structure

| Path | New/Mod | Responsibility |
|---|---|---|
| `src/main/bookmark-validate.js` | New | Pure `validFavicon`, `validFolder`, `folderKey`. |
| `src/main/bookmark-import.js` | New | Pure `parseNetscapeBookmarks(html, { now })`. |
| `src/main/bookmark-data.js` | New | Pure transforms: `addImported`, `applySetFolder`, `applyRenameFolder`, `applyRemoveFolder`, `canonicalizeFolders`. |
| `src/main/bookmarks.js` | Mod | Import validators/transforms; add `importBookmarks`/`setBookmarkFolder`/`renameFolder`/`removeFolder`; `folder` in `sanitizeRemoteItem`; canonicalize in `mergeFromSync`; `folder:null` on new `toggleBookmark` items. |
| `src/main/pages.js` | Mod | `pages:bookmarks:import/set-folder/rename-folder/remove-folder` handlers; `dialog`+`fs`. |
| `src/main/main.js` | Mod | `getMainWindow` hook on the `setupPages({…})` call. |
| `src/main/tab-preload.js` | Mod | `import`/`setFolder`/`renameFolder`/`removeFolder` on `bowserPages.bookmarks`. |
| `src/renderer/pages/bookmarks.html` | Mod | Header with "Import…" button + status line. |
| `src/renderer/pages/bookmarks.js` | Mod | Import flow; grouped folder rendering; folder picker; rename/remove. |
| `src/renderer/pages/pages.css` | Mod | Header, folder-section, picker styles. |
| `test/unit/bookmark-validate.test.js` | New | Validator tests. |
| `test/unit/bookmark-import.test.js` | New | Parser tests over real fixtures. |
| `test/unit/bookmark-data.test.js` | New | Transform tests. |
| `test/fixtures/chrome-bookmarks.html`, `firefox-bookmarks.html`, `safari-bookmarks.html` | New | Representative export fixtures. |

---

### Task 1: Pure validators (`bookmark-validate.js`)

**Files:**
- Create: `src/main/bookmark-validate.js`
- Test: `test/unit/bookmark-validate.test.js`

**Interfaces:**
- Produces: `validFavicon(favicon) → string|null`, `validFolder(name) → string|null`, `folderKey(name) → string` (lowercased+trimmed; `''` for non-string).

- [ ] **Step 1: Write the failing test**

Create `test/unit/bookmark-validate.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { validFavicon, validFolder, folderKey } = require('../../src/main/bookmark-validate');

test('validFavicon accepts http(s) and data:image, rejects others and over-long', () => {
  assert.equal(validFavicon('https://x.com/f.ico'), 'https://x.com/f.ico');
  assert.equal(validFavicon('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(validFavicon('javascript:alert(1)'), null);
  assert.equal(validFavicon('data:text/html,x'), null);
  assert.equal(validFavicon('data:image/png;base64,' + 'A'.repeat(3000)), null);
  assert.equal(validFavicon(42), null);
});

test('validFolder trims, caps at 100 chars, else null', () => {
  assert.equal(validFolder('  Work  '), 'Work');
  assert.equal(validFolder(''), null);
  assert.equal(validFolder('   '), null);
  assert.equal(validFolder('x'.repeat(100)), 'x'.repeat(100));
  assert.equal(validFolder('x'.repeat(101)), null);
  assert.equal(validFolder(null), null);
});

test('folderKey lowercases and trims; non-string is empty', () => {
  assert.equal(folderKey('  Work '), 'work');
  assert.equal(folderKey('WORK'), 'work');
  assert.equal(folderKey(null), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/bookmark-validate.test.js`
Expected: FAIL — `Cannot find module '../../src/main/bookmark-validate'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/bookmark-validate.js`:

```js
// Pure, Electron-free validators shared by bookmark-import.js, bookmark-data.js
// and bookmarks.js. Kept out of bookmarks.js so importing them can't drag in
// the JsonStore singleton (which needs Electron's app at construction), which
// would make these untestable under `node --test`.

/** Same allow-list/length cap as the async-refined favicon path in main.js. */
function validFavicon(favicon) {
  return typeof favicon === 'string' && favicon.length <= 2048 && /^(https?:|data:image\/)/i.test(favicon)
    ? favicon
    : null;
}

/** A storable folder name, or null (= ungrouped). null is ONLY ever an
 * explicit ungroup — callers must treat a null result from a non-null input
 * as "reject", not "ungroup". */
function validFolder(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 100 ? trimmed : null;
}

/** Case-insensitive folder identity key. Work and work are one folder. */
function folderKey(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

module.exports = { validFavicon, validFolder, folderKey };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/bookmark-validate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/bookmark-validate.js test/unit/bookmark-validate.test.js
git commit -m "feat(bookmarks): add pure favorite/folder validators"
```

---

### Task 2: Netscape bookmark parser (`bookmark-import.js`)

**Files:**
- Create: `src/main/bookmark-import.js`
- Create: `test/fixtures/chrome-bookmarks.html`, `test/fixtures/firefox-bookmarks.html`, `test/fixtures/safari-bookmarks.html`
- Test: `test/unit/bookmark-import.test.js`

**Interfaces:**
- Consumes: `validFavicon` from `bookmark-validate.js`.
- Produces: `parseNetscapeBookmarks(html, { now = Date.now() } = {}) → [{ url, title, favicon, addedAt, folder }]` (document order; `folder` = immediate enclosing `<H3>` name or `null`).

- [ ] **Step 1: Create the three fixtures**

Create `test/fixtures/chrome-bookmarks.html`:

```html
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/" ADD_DATE="1700000000" ICON="data:image/png;base64,AAAA">Example</A>
        <DT><H3 ADD_DATE="1700000100">News</H3>
        <DL><p>
            <DT><A HREF="https://news.example.com/tech?q=a&amp;b=1" ADD_DATE="1700000200">Tech &amp; Science</A>
        </DL><p>
    </DL><p>
    <DT><H3>Other bookmarks</H3>
    <DL><p>
        <DT><A HREF="javascript:void(0)" ADD_DATE="1700000300">A Bookmarklet</A>
        <DT><A HREF="https://plain.example.org/">Plain</A>
    </DL><p>
</DL><p>
```

Create `test/fixtures/firefox-bookmarks.html`:

```html
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks Menu</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><H3 ADD_DATE='1600000000' LAST_MODIFIED='1600000000'>Mozilla Firefox</H3>
    <DL><p>
        <DT><A HREF="https://www.mozilla.org/" ADD_DATE=1600000000>Mozilla</A>
        <DT><A HREF="place:type=6&maxResults=10" ADD_DATE="1600000000">Recently Bookmarked</A>
        <DT><A HREF="https://future.example.com/" ADD_DATE="99999999999">Future Dated</A>
    </DL><p>
</DL><p>
```

Create `test/fixtures/safari-bookmarks.html`:

```html
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<HTML>
<HEAD><TITLE>Bookmarks</TITLE></HEAD>
<BODY>
<H1>Bookmarks</H1>
<DL><P>
    <DT><H3 FOLDED>Favorites</H3>
    <DL><P>
        <DT><A HREF="https://apple.com/">Apple</A>
    </DL><P>
    <DT><A HREF="https://toplevel.example.net/">Top Level</A>
</DL><P>
</BODY>
</HTML>
```

- [ ] **Step 2: Write the failing test**

Create `test/unit/bookmark-import.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { parseNetscapeBookmarks } = require('../../src/main/bookmark-import');

const FIXED_NOW = 1710000000000; // ms, after all fixture ADD_DATEs, before the "future" one
const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
const byUrl = (entries) => new Map(entries.map((e) => [e.url, e]));

test('chrome: immediate-parent folders, entity decode, icon, non-http dropped', () => {
  const entries = parseNetscapeBookmarks(fixture('chrome-bookmarks.html'), { now: FIXED_NOW });
  const m = byUrl(entries);
  assert.equal(m.get('https://example.com/').folder, 'Bookmarks bar');
  assert.equal(m.get('https://example.com/').favicon, 'data:image/png;base64,AAAA');
  assert.equal(m.get('https://example.com/').addedAt, 1700000000 * 1000);
  // immediate parent is News, not the joined path
  assert.equal(m.get('https://news.example.com/tech?q=a&b=1').folder, 'News');
  assert.equal(m.get('https://news.example.com/tech?q=a&b=1').title, 'Tech & Science');
  assert.equal(m.get('https://plain.example.org/').folder, 'Other bookmarks');
  // javascript: bookmarklet is dropped
  assert.equal([...m.keys()].some((u) => u.startsWith('javascript:')), false);
});

test('firefox: single/bare quotes, place: dropped, future date clamped to now', () => {
  const entries = parseNetscapeBookmarks(fixture('firefox-bookmarks.html'), { now: FIXED_NOW });
  const m = byUrl(entries);
  assert.equal(m.get('https://www.mozilla.org/').folder, 'Mozilla Firefox');
  assert.equal(m.get('https://www.mozilla.org/').addedAt, 1600000000 * 1000);
  assert.equal([...m.keys()].some((u) => u.startsWith('place:')), false);
  assert.equal(m.get('https://future.example.com/').addedAt, FIXED_NOW); // future rejected
});

test('safari: uppercase tags, top-level (no H3) is ungrouped', () => {
  const entries = parseNetscapeBookmarks(fixture('safari-bookmarks.html'), { now: FIXED_NOW });
  const m = byUrl(entries);
  assert.equal(m.get('https://apple.com/').folder, 'Favorites');
  assert.equal(m.get('https://toplevel.example.net/').folder, null);
});

test('over-length ICON is dropped to null favicon', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(3000);
  const html = `<DL><p><DT><A HREF="https://x.com/" ICON="${big}">X</A></DL><p>`;
  const [e] = parseNetscapeBookmarks(html, { now: FIXED_NOW });
  assert.equal(e.favicon, null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/unit/bookmark-import.test.js`
Expected: FAIL — `Cannot find module '../../src/main/bookmark-import'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/main/bookmark-import.js`:

```js
// Pure parser for the Netscape bookmark HTML format that every major browser
// exports. Deliberately a simple regex scan (same pragmatic spirit as
// normalizeAddressInput), not a DOM parse: attribute values containing an
// unescaped '>' are not supported, which real exports never emit.
const { validFavicon } = require('./bookmark-validate');

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&'); // last, so &amp;lt; decodes to &lt; not <
}

/** Read one attribute from a tag's attribute string, case-insensitively.
 * Handles double-quoted, single-quoted, and bare values. */
function attr(attrs, name) {
  const m =
    attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')) ||
    attrs.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i')) ||
    attrs.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, 'i'));
  return m ? m[1] : null;
}

const TOKEN = /<\/dl\s*>|<dl\b[^>]*>|<h3\b[^>]*>([\s\S]*?)<\/h3\s*>|<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;

function parseNetscapeBookmarks(html, { now = Date.now() } = {}) {
  const out = [];
  const stack = [];              // folder path; top = current folder or null
  let pending;                   // folder name awaiting its <DL>, or undefined
  const current = () => (stack.length ? stack[stack.length - 1] : null);

  for (const m of String(html).matchAll(TOKEN)) {
    const tok = m[0].slice(0, 4).toLowerCase();
    if (tok.startsWith('</dl')) {
      stack.pop();
    } else if (tok.startsWith('<dl')) {
      stack.push(pending !== undefined ? pending : null);
      pending = undefined;
    } else if (tok.startsWith('<h3')) {
      pending = decodeEntities(m[1] || '').trim() || null;
    } else {
      const attrs = m[2] || '';
      const rawHref = attr(attrs, 'href');
      if (!rawHref) continue;
      const url = decodeEntities(rawHref);
      if (!/^https?:\/\//i.test(url)) continue; // http(s) only
      const rawIcon = attr(attrs, 'icon');
      const secs = Number(attr(attrs, 'add_date'));
      let addedAt = now;
      if (Number.isFinite(secs) && secs > 0) {
        const ms = secs * 1000;
        if (ms <= now) addedAt = ms; // reject future timestamps
      }
      const title = decodeEntities(m[3] || '').trim();
      out.push({
        url,
        title: title || url,
        favicon: validFavicon(rawIcon),
        addedAt,
        folder: current(),
      });
    }
  }
  return out;
}

module.exports = { parseNetscapeBookmarks };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/unit/bookmark-import.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/bookmark-import.js test/unit/bookmark-import.test.js test/fixtures/
git commit -m "feat(bookmarks): parse Netscape bookmark HTML exports"
```

---

### Task 3: Pure data transforms (`bookmark-data.js`)

**Files:**
- Create: `src/main/bookmark-data.js`
- Test: `test/unit/bookmark-data.test.js`

**Interfaces:**
- Consumes: `validFavicon`, `validFolder`, `folderKey` from `bookmark-validate.js`.
- Produces (each takes a read-only `{ items, tombstones }` snapshot, returns new objects, never mutates):
  - `addImported(snapshot, entries, { now, makeId }) → { items, tombstones, added, skipped, changed }`
  - `applySetFolder(snapshot, id, folder, { now }) → { items, changed }`
  - `applyRenameFolder(snapshot, oldName, newName, { now }) → { items, changed }`
  - `applyRemoveFolder(snapshot, name, { now }) → { items, changed }`
  - `canonicalizeFolders(items) → items`

- [ ] **Step 1: Write the failing test**

Create `test/unit/bookmark-data.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  addImported, applySetFolder, applyRenameFolder, applyRemoveFolder, canonicalizeFolders,
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
    { id: 'a', url: 'ua', title: 'A', favicon: null, addedAt: 1, updatedAt: 1, folder: 'News' },
    { id: 'b', url: 'ub', title: 'B', favicon: null, addedAt: 2, updatedAt: 2, folder: 'Reading' },
  ]);
  const merged = applyRenameFolder(cur, 'News', 'Reading', opts); // collision -> merge
  assert.equal(merged.items.find((it) => it.id === 'a').folder, 'Reading');
  assert.equal(merged.items.find((it) => it.id === 'a').updatedAt, NOW);

  const respell = applyRenameFolder(cur, 'news', 'News', opts); // case-only -> verbatim
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/bookmark-data.test.js`
Expected: FAIL — `Cannot find module '../../src/main/bookmark-data'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/bookmark-data.js`:

```js
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

module.exports = {
  addImported, applySetFolder, applyRenameFolder, applyRemoveFolder, canonicalizeFolders,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/bookmark-data.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/bookmark-data.js test/unit/bookmark-data.test.js
git commit -m "feat(bookmarks): add pure folder + import data transforms"
```

---

### Task 4: Wire transforms into `bookmarks.js`

**Files:**
- Modify: `src/main/bookmarks.js`

**Interfaces:**
- Consumes: `bookmark-validate.js` (`validFavicon`, `validFolder`), `bookmark-data.js` (all transforms).
- Produces: `importBookmarks(entries) → { added, skipped }`, `setBookmarkFolder(id, folder)`, `renameFolder(oldName, newName)`, `removeFolder(name)` (all in `module.exports`). Existing exports unchanged.

- [ ] **Step 1: Replace the local `validFavicon` with the shared module**

In `src/main/bookmarks.js`, replace the top requires and the local `validFavicon` function. Change lines 1-2:

```js
const crypto = require('crypto');
const { JsonStore } = require('./store');
```

to:

```js
const crypto = require('crypto');
const { JsonStore } = require('./store');
const { validFavicon, validFolder } = require('./bookmark-validate');
const data = require('./bookmark-data');
```

Then delete the entire local `validFavicon` function (the `/** Same allow-list… */` JSDoc block and the `function validFavicon(favicon) { … }` at lines 19-26). All existing call sites keep working via the imported `validFavicon`.

- [ ] **Step 2: Add `folder: null` to newly-starred favorites**

In `toggleBookmark`, the `d.items.push({...})` call, add `folder: null` so new stars are explicitly ungrouped:

```js
d.items.push({ id: crypto.randomUUID(), url, title: title || url, favicon: validFavicon(favicon), addedAt: now, updatedAt: now, folder: null });
```

- [ ] **Step 3: Add the four wrapper functions**

Insert after `updateFavicon` (before `removeBookmark`):

```js
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
```

- [ ] **Step 4: Sanitize `folder` on sync-in, canonicalize the merged store**

In `sanitizeRemoteItem`, add `folder` to the returned object (last property):

```js
    updatedAt: Number.isFinite(it.updatedAt) ? it.updatedAt : addedAt,
    folder: validFolder(it.folder),
```

In `mergeFromSync`, wrap the `d.items = …` sort with `data.canonicalizeFolders(...)`:

```js
    d.items = data.canonicalizeFolders(
      [...byUrl.values()].sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))
    );
```

- [ ] **Step 5: Export the new functions**

Update the `module.exports` line to add the four names:

```js
module.exports = { listBookmarks, isBookmarked, toggleBookmark, updateFavicon, removeBookmark, importBookmarks, setBookmarkFolder, renameFolder, removeFolder, exportForSync, mergeFromSync, onChanged, onMerged };
```

- [ ] **Step 6: Verify the whole unit suite still passes**

Run: `npm run test:unit`
Expected: PASS — all existing tests plus the three new files. (No new unit test here: `bookmarks.js` needs the Electron-backed `JsonStore`; its logic is fully covered by Tasks 1-3, and this task is thin wiring.)

- [ ] **Step 7: Commit**

```bash
git add src/main/bookmarks.js
git commit -m "feat(bookmarks): import + folder mutations, canonicalize on sync"
```

---

### Task 5: IPC handlers + main-window hook (`pages.js`, `main.js`)

**Files:**
- Modify: `src/main/pages.js`
- Modify: `src/main/main.js` (the `setupPages({…})` call near line 2004)

**Interfaces:**
- Consumes: `bookmarks.importBookmarks/setBookmarkFolder/renameFolder/removeFolder`, `parseNetscapeBookmarks`, `hooks.getMainWindow`.
- Produces: IPC channels `pages:bookmarks:import` (→ `{ added, skipped } | { cancelled } | { error }`), `pages:bookmarks:set-folder`, `pages:bookmarks:rename-folder`, `pages:bookmarks:remove-folder`.

- [ ] **Step 1: Add `dialog`, `fs`, and the parser to `pages.js` requires**

Change the top of `src/main/pages.js`. Line 1:

```js
const { app, protocol, net, ipcMain, session, dialog } = require('electron');
```

Add after the existing `const path = require('path');` line:

```js
const fs = require('fs');
const { parseNetscapeBookmarks } = require('./bookmark-import');

const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MiB
```

- [ ] **Step 2: Add the four handlers**

In `setupPages`, immediately after the existing `handle('pages:bookmarks:clear-favicon', …)` line, add:

```js
  handle('pages:bookmarks:import', async () => {
    const parent = hooks.getMainWindow?.();
    const picked = await dialog.showOpenDialog(parent ?? undefined, {
      title: 'Import favorites',
      filters: [{ name: 'Bookmarks', extensions: ['html', 'htm'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths.length) return { cancelled: true };
    try {
      const stat = await fs.promises.stat(picked.filePaths[0]);
      if (stat.size > MAX_IMPORT_BYTES) return { error: 'too-large' };
      const html = await fs.promises.readFile(picked.filePaths[0], 'utf8');
      const entries = parseNetscapeBookmarks(html);
      if (!entries.length) return { error: 'empty' };
      const { added, skipped } = bookmarks.importBookmarks(entries);
      hooks.onDataChanged?.();
      return { added, skipped };
    } catch {
      return { error: 'unreadable' };
    }
  });
  handle('pages:bookmarks:set-folder', (id, folder) => {
    bookmarks.setBookmarkFolder(id, folder);
    hooks.onDataChanged?.();
  });
  handle('pages:bookmarks:rename-folder', (oldName, newName) => {
    bookmarks.renameFolder(oldName, newName);
    hooks.onDataChanged?.();
  });
  handle('pages:bookmarks:remove-folder', (name) => {
    bookmarks.removeFolder(name);
    hooks.onDataChanged?.();
  });
```

- [ ] **Step 3: Provide the `getMainWindow` hook from `main.js`**

In `src/main/main.js`, in the `setupPages({ … })` call (near line 2004), add one line alongside the existing hooks (e.g. right after `onDataChanged: refreshBookmarkFlags,`):

```js
    getMainWindow: () => (hasLiveWindow() ? win : undefined),
```

(`win` is the module-scoped main window and `hasLiveWindow()` already guards its liveness elsewhere in this file.)

- [ ] **Step 4: Verify the unit suite still passes**

Run: `npm run test:unit`
Expected: PASS. (Handlers reuse the existing `handle()` trust wrapper covered by `ipc-trust.test.js`; no new unit test. Behavior is smoke-verified in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/main/pages.js src/main/main.js
git commit -m "feat(bookmarks): guarded IPC for import and folder actions"
```

---

### Task 6: Preload bridge (`tab-preload.js`)

**Files:**
- Modify: `src/main/tab-preload.js`

**Interfaces:**
- Produces: `window.bowserPages.bookmarks.import()`, `.setFolder(id, folder)`, `.renameFolder(oldName, newName)`, `.removeFolder(name)`.

- [ ] **Step 1: Extend the `bookmarks` bridge object**

In `src/main/tab-preload.js`, change the `bookmarks: { … }` block to add four methods:

```js
    bookmarks: {
      list: () => ipcRenderer.invoke('pages:bookmarks:list'),
      remove: (id) => ipcRenderer.invoke('pages:bookmarks:remove', id),
      clearFavicon: (url) => ipcRenderer.invoke('pages:bookmarks:clear-favicon', url),
      import: () => ipcRenderer.invoke('pages:bookmarks:import'),
      setFolder: (id, folder) => ipcRenderer.invoke('pages:bookmarks:set-folder', id, folder),
      renameFolder: (oldName, newName) => ipcRenderer.invoke('pages:bookmarks:rename-folder', oldName, newName),
      removeFolder: (name) => ipcRenderer.invoke('pages:bookmarks:remove-folder', name),
    },
```

- [ ] **Step 2: Relaunch dev and sanity-check the bridge exists**

Preloads bind at view creation, so a tab reload is not enough — restart the dev app (kill the running instance, then `npm start`). Open a new tab, go to `blanc://bookmarks/`, open DevTools for that tab, and run in its console:

```js
Object.keys(window.bowserPages.bookmarks)
```

Expected: array includes `import`, `setFolder`, `renameFolder`, `removeFolder`.

- [ ] **Step 3: Commit**

```bash
git add src/main/tab-preload.js
git commit -m "feat(bookmarks): expose import + folder bridge to Favorites page"
```

---

### Task 7: Import button + status on the Favorites page

**Files:**
- Modify: `src/renderer/pages/bookmarks.html`
- Modify: `src/renderer/pages/bookmarks.js`
- Modify: `src/renderer/pages/pages.css`

**Interfaces:**
- Consumes: `window.bowserPages.bookmarks.import()`.
- Produces: working end-to-end import onto the existing (still flat) list. Folder rendering arrives in Task 8.

- [ ] **Step 1: Add the header + status markup**

In `src/renderer/pages/bookmarks.html`, replace:

```html
    <h1>Favorites</h1>
    <div id="list" class="row-list"></div>
```

with:

```html
    <div class="page-head">
      <h1>Favorites</h1>
      <button id="importBtn" type="button">Import…</button>
    </div>
    <p id="importStatus" class="section-hint" role="status"></p>
    <div id="list" class="row-list"></div>
```

- [ ] **Step 2: Add header styles**

In `src/renderer/pages/pages.css`, append:

```css
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.page-head h1 { margin-bottom: 12px; }
#importStatus { margin: 0 0 16px; min-height: 16px; }
```

- [ ] **Step 3: Wire the import button in the renderer**

In `src/renderer/pages/bookmarks.js`, inside the IIFE, after `const list = document.getElementById('list');` add:

```js
  const importBtn = document.getElementById('importBtn');
  const importStatus = document.getElementById('importStatus');

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function importSummary(added, skipped) {
    if (added === 0 && skipped > 0) return `All ${plural(skipped, 'favorite')} were already saved.`;
    const tail = skipped > 0 ? ` (skipped ${skipped} already saved)` : '';
    return `Imported ${plural(added, 'favorite')}${tail}.`;
  }

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    importStatus.textContent = 'Choose a bookmarks file…';
    const res = await window.bowserPages.bookmarks.import();
    importBtn.disabled = false;
    if (res.cancelled) { importStatus.textContent = ''; return; }
    if (res.error === 'empty') { importStatus.textContent = 'No bookmarks found in that file.'; return; }
    if (res.error === 'unreadable') { importStatus.textContent = "Couldn't read that file."; return; }
    if (res.error === 'too-large') { importStatus.textContent = 'That file is too large to import.'; return; }
    importStatus.textContent = importSummary(res.added, res.skipped);
    refresh();
  });
```

- [ ] **Step 4: Manually verify import works end-to-end**

The Favorites page is a tab `WebContentsView` served fresh over `blanc://` on every navigation, so a tab reload picks up HTML/JS/CSS changes (no full relaunch needed after Task 6's relaunch). In the running app: open `blanc://bookmarks/`, reload the tab (Cmd/Ctrl+R), click **Import…**, choose `test/fixtures/chrome-bookmarks.html`.

Expected: status reads `Imported 3 favorites.` (Example, Tech & Science, Plain — the `javascript:` bookmarklet is dropped), and those three appear in the list. Click **Import…** again with the same file → `All 3 favorites were already saved.`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/bookmarks.html src/renderer/pages/bookmarks.js src/renderer/pages/pages.css
git commit -m "feat(bookmarks): Import button + result status on Favorites page"
```

---

### Task 8: Grouped folder rendering + folder management UI

**Files:**
- Modify: `src/renderer/pages/bookmarks.js`
- Modify: `src/renderer/pages/pages.css`

**Interfaces:**
- Consumes: `window.bowserPages.bookmarks.list()` (items carry `folder`), `.setFolder`, `.renameFolder`, `.removeFolder`.
- Produces: Favorites page renders alphabetical folder sections (rows `addedAt` desc) + an ungrouped section, each row with a folder picker, each folder header with rename/remove.

- [ ] **Step 1: Replace `refresh()` with grouped rendering**

In `src/renderer/pages/bookmarks.js`, replace the entire existing `refresh` function (the `async function refresh() { … }` block that builds the flat reversed list) with the grouping + rendering code below. Keep the import wiring from Task 7 and the trailing `refresh();` call.

```js
  const folderKey = (name) => (typeof name === 'string' ? name.trim().toLowerCase() : '');
  const byDateDesc = (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0);

  function group(items) {
    const byKey = new Map();       // key -> { name, items }
    const ungrouped = [];
    for (const b of items) {
      if (b.folder == null) { ungrouped.push(b); continue; }
      const key = folderKey(b.folder);
      if (!byKey.has(key)) byKey.set(key, { name: b.folder, items: [] });
      byKey.get(key).items.push(b);
    }
    const folders = [...byKey.values()].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const f of folders) f.items.sort(byDateDesc);
    ungrouped.sort(byDateDesc);
    return { folders, ungrouped, names: folders.map((f) => f.name) };
  }

  async function refresh() {
    const items = await window.bowserPages.bookmarks.list();
    list.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No favorites yet. Press Ctrl/Cmd+D on a page to add one, or use Import.';
      list.append(empty);
      return;
    }
    const { folders, ungrouped, names } = group(items);
    for (const f of folders) list.append(folderSection(f, names));
    if (ungrouped.length) list.append(ungroupedSection(ungrouped, names));
  }

  function folderSection(folder, allNames) {
    const section = document.createElement('section');
    section.className = 'folder-section';

    const head = document.createElement('div');
    head.className = 'folder-header';
    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = folder.name;
    const count = document.createElement('span');
    count.className = 'folder-count';
    count.textContent = String(folder.items.length);

    const acts = document.createElement('div');
    acts.className = 'folder-actions';
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => startRename(head, folder.name));
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove folder';
    removeBtn.addEventListener('click', async () => {
      await window.bowserPages.bookmarks.removeFolder(folder.name);
      refresh();
    });
    acts.append(renameBtn, removeBtn);
    head.append(name, count, acts);
    section.append(head);
    for (const b of folder.items) section.append(row(b, allNames));
    return section;
  }

  function ungroupedSection(items, allNames) {
    const section = document.createElement('section');
    section.className = 'folder-section';
    if (allNames.length) {
      const head = document.createElement('div');
      head.className = 'folder-header';
      const name = document.createElement('span');
      name.className = 'folder-name folder-name-dim';
      name.textContent = 'Ungrouped';
      head.append(name);
      section.append(head);
    }
    for (const b of items) section.append(row(b, allNames));
    return section;
  }

  function startRename(head, oldName) {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 100;
    input.value = oldName;
    input.className = 'folder-rename-input';
    const commit = async () => {
      const next = input.value.trim();
      if (next && next !== oldName) await window.bowserPages.bookmarks.renameFolder(oldName, next);
      refresh();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') refresh();
    });
    input.addEventListener('blur', commit);
    head.replaceChildren(input);
    input.focus();
    input.select();
  }

  function row(b, allNames) {
    const el = document.createElement('div');
    el.className = 'row';

    const main = document.createElement('div');
    main.className = 'main';
    const title = document.createElement('a');
    title.className = 'title';
    title.href = b.url;
    title.textContent = b.title;
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = b.url;
    main.append(title, url);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = new Date(b.addedAt).toLocaleDateString();

    const actions = document.createElement('div');
    actions.className = 'actions';
    const folderBtn = document.createElement('button');
    folderBtn.type = 'button';
    folderBtn.className = 'folder-chip';
    folderBtn.textContent = b.folder ? `▸ ${b.folder}` : '▸ folder';
    folderBtn.addEventListener('click', () => openPicker(folderBtn, b, allNames));
    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      await window.bowserPages.bookmarks.remove(b.id);
      refresh();
    });
    actions.append(folderBtn, remove);

    el.append(main, meta, actions);
    return el;
  }

  let openMenu = null;
  function closeMenu() { openMenu?.remove(); openMenu = null; }
  document.addEventListener('click', (e) => {
    if (openMenu && !openMenu.contains(e.target) && !e.target.classList.contains('folder-chip')) closeMenu();
  });

  function openPicker(anchor, b, allNames) {
    if (openMenu) { closeMenu(); return; }
    const menu = document.createElement('div');
    menu.className = 'folder-picker';
    const pick = async (fn) => { await fn(); closeMenu(); refresh(); };

    for (const nm of allNames) {
      if (folderKey(nm) === folderKey(b.folder)) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'picker-item';
      item.textContent = `→ ${nm}`;
      item.addEventListener('click', () => pick(() => window.bowserPages.bookmarks.setFolder(b.id, nm)));
      menu.append(item);
    }
    if (b.folder) {
      const none = document.createElement('button');
      none.type = 'button';
      none.className = 'picker-item';
      none.textContent = '→ none';
      none.addEventListener('click', () => pick(() => window.bowserPages.bookmarks.setFolder(b.id, null)));
      menu.append(none);
    }
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 100;
    nameInput.placeholder = 'new folder…';
    nameInput.className = 'picker-new';
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = nameInput.value.trim();
        if (v) pick(() => window.bowserPages.bookmarks.setFolder(b.id, v));
      } else if (e.key === 'Escape') closeMenu();
    });
    menu.append(nameInput);

    anchor.parentElement.append(menu);
    openMenu = menu;
    nameInput.focus();
  }
```

- [ ] **Step 2: Add folder-section, header, chip, and picker styles**

In `src/renderer/pages/pages.css`, append:

```css
.folder-section { margin-bottom: 14px; }
.folder-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 2px;
}
.folder-name { font-family: var(--font-mono); font-size: 12.5px; color: var(--text); }
.folder-name-dim { color: var(--text-dim); }
.folder-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  background: var(--surface);
  border-radius: 999px;
  padding: 1px 7px;
}
.folder-actions { margin-left: auto; display: flex; gap: 6px; }
.folder-actions button { padding: 3px 9px; font-size: 11px; }
.folder-rename-input { width: 220px; }
.folder-chip {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 3px 9px;
}
.row .actions .folder-chip { opacity: 1; }
.folder-picker {
  position: absolute;
  z-index: 20;
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 180px;
  padding: 6px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.picker-item {
  text-align: left;
  font-family: var(--font-mono);
  font-size: 11.5px;
  border: none;
  background: transparent;
}
.picker-item:hover { background: var(--surface); border-color: transparent; }
.picker-new { margin-top: 4px; font-size: 11.5px; }
```

The `.row .actions` rule hides action buttons until row hover (`opacity: 0`). The `.row .actions .folder-chip { opacity: 1; }` override keeps the folder chip always visible (it must be reachable to move an ungrouped favorite). The picker is `position: absolute`; its containing `.actions` is not positioned, so add one more rule:

```css
.row .actions { position: relative; }
```

- [ ] **Step 3: Manually verify folders end-to-end**

Reload the `blanc://bookmarks/` tab (Cmd/Ctrl+R). With the chrome fixture imported from Task 7, expect:
- A **Bookmarks bar** section (Example, Plain), a **News** section (Tech & Science), an **Other bookmarks** section — alphabetical.
- Click a row's **▸ folder** chip → picker lists the other folders, **→ none**, and a **new folder…** field. Pick another folder → the row moves; the emptied folder disappears if it was its last item.
- On a folder header, **Rename** → inline input; type a name colliding (case-insensitively) with another folder → the two sections merge. **Remove folder** → its rows drop to the Ungrouped section.
- Type a brand-new name in a row's **new folder…** field + Enter → a new alphabetical section appears.

- [ ] **Step 4: Run the full unit suite once more**

Run: `npm run test:unit`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/bookmarks.js src/renderer/pages/pages.css
git commit -m "feat(bookmarks): folder sections + picker + rename/remove UI"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- Module layout (validate/import/data/wrapper) → Tasks 1-4. Ordering (`addedAt` authoritative, oldest-first store, folder desc render) → Task 3 (`oldestFirst`), Task 8 (`byDateDesc`). Folder identity/collisions → Task 3 (`buildCanonMap`, rename/set), tested. Sync canonicalization → Task 4 Step 4. Parser rules (immediate parent, http-only, icon, dates, entities, quote/case tolerance) → Task 2. IPC + dialog + 20 MiB `stat()` → Task 5. Preload → Task 6. Favorites-page UI (import, status copy, grouped render, picker, rename/remove) → Tasks 7-8. Substrate/CSP no-impact → Global Constraints.
- No unit test for `bookmarks.js`/`pages.js` is by design (Electron-backed `JsonStore`); their logic is pure-tested in Tasks 1-3 and smoke-verified in Tasks 6-8, matching the existing `favicon-policy.js`/`permission-decisions.js` idiom.

**Placeholder scan** — no TBD/TODO; every code step carries full code; every test step carries real assertions.

**Type consistency** — transform return shapes (`{ items, changed, … }`, `addImported` adds `tombstones`/`added`/`skipped`) are consistent between Task 3 definitions, their tests, and the Task 4 wrappers. Bridge method names (`import`/`setFolder`/`renameFolder`/`removeFolder`) match across Tasks 5 (channels), 6 (bridge), 7-8 (calls). `folderKey`/`validFolder`/`validFavicon` signatures match across Tasks 1, 2, 3.
