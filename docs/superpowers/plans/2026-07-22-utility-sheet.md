# Utility Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present the five utility pages (favorites, history, downloads, settings, shortcuts) as a transient sheet over a scrim instead of regular tabs, per `docs/superpowers/specs/2026-07-22-utility-sheet-design.md`.

**Architecture:** One lazily-created main-owned `WebContentsView` (transparent; the page draws scrim + card) loads utility `blanc://` URLs. A shared `isUtilityUrl()` classifier gates every route into a tab (`openInternalPage`, tab `will-navigate`, `createTab`, typed navigation) and reroutes to the sheet. A zipped pure filter cleans stale sessions. Pages gain `body.sheet` presentation + a shared `sheet.js` (dialog semantics, ✕, scrim click, heading focus) and a strictly-guarded `pages:surface:close` IPC.

**Tech Stack:** Electron `WebContentsView`, plain JS/CSS, `node --test` unit tests, Cucumber + Playwright-Electron acceptance.

## Global Constraints

- Work on a feature branch off `main` (e.g. `feature/utility-sheet`). **Precondition:** the uncommitted quiet-rows work (overlay.js/styles.css/specs) must be committed separately by the user first — verify `git status` is clean before branching; if not, stop and ask.
- Internal identifiers stay `bookmarks` (never rename to favorites); user-facing copy says Favorites.
- No changes to `tokens/`, `settings-schema/`, `copy/`, or anything under `*/generated/` — none of this work touches substrate values; `npm run substrate:check` must stay green.
- Utility set is exactly: `bookmarks`, `history`, `downloads`, `settings`, `shortcuts`. `newtab`, `error`, `auth` remain tab/dialog content.
- Chrome/pages files load once — every manual verification requires killing and restarting `npm start`. Playwright verification windows run BEFORE any user-facing dev relaunch; the user's dev instance must be the last window standing at end of work (see memory `always-relaunch-dev-after-ui-changes`).
- pages CSP allows no inline scripts/styles: all new CSS in `pages.css`, all new JS in a flat file under `src/renderer/pages/` (flat-serving constraint — no subdirectories).
- No new IPC channel namespaces: the close channel is `pages:surface:close`.

---

### Task 1: `isUtilityUrl` classifier (pure module + unit tests)

**Files:**
- Create: `src/main/utility-pages.js`
- Test: `test/unit/utility-pages.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `UTILITY_PAGES: Set<string>` and `isUtilityUrl(url: string): boolean` — exact-host `blanc://` match. Tasks 2–7 all import these; never re-derive the set.

- [ ] **Step 1: Write the failing test**

```js
// test/unit/utility-pages.test.js
const assert = require('node:assert/strict');
const test = require('node:test');

const { UTILITY_PAGES, isUtilityUrl } = require('../../src/main/utility-pages');

test('isUtilityUrl: utility hosts match, with paths and queries', () => {
  assert.equal(isUtilityUrl('blanc://bookmarks/'), true);
  assert.equal(isUtilityUrl('blanc://history/'), true);
  assert.equal(isUtilityUrl('blanc://downloads/'), true);
  assert.equal(isUtilityUrl('blanc://settings/'), true);
  assert.equal(isUtilityUrl('blanc://shortcuts/'), true);
  assert.equal(isUtilityUrl('blanc://settings/?section=sync'), true);
});

test('isUtilityUrl: non-utility internal pages and other schemes do not match', () => {
  assert.equal(isUtilityUrl('blanc://newtab/'), false);
  assert.equal(isUtilityUrl('blanc://newtab/?private=1'), false);
  assert.equal(isUtilityUrl('blanc://error/?url=x'), false);
  assert.equal(isUtilityUrl('blanc://auth/'), false);
  assert.equal(isUtilityUrl('https://settings/'), false);
  assert.equal(isUtilityUrl('https://example.com/blanc://settings/'), false);
  assert.equal(isUtilityUrl('not a url'), false);
  assert.equal(isUtilityUrl(''), false);
  assert.equal(isUtilityUrl(undefined), false);
});

test('UTILITY_PAGES is exactly the five sheet pages', () => {
  assert.deepEqual([...UTILITY_PAGES].sort(),
    ['bookmarks', 'downloads', 'history', 'settings', 'shortcuts']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/utility-pages.test.js`
Expected: FAIL — `Cannot find module '../../src/main/utility-pages'`

- [ ] **Step 3: Write the implementation**

```js
// src/main/utility-pages.js
// The single source of truth for "belongs in the utility sheet" (design:
// docs/superpowers/specs/2026-07-22-utility-sheet-design.md §4). Every
// route into a tab checks this; pages.js's KNOWN_PAGES stays the superset
// of all internal pages and is deliberately separate.
const UTILITY_PAGES = new Set(['bookmarks', 'history', 'downloads', 'settings', 'shortcuts']);

/** Exact-host blanc:// match: true only for the five sheet pages. */
function isUtilityUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'blanc:' && UTILITY_PAGES.has(u.host);
  } catch {
    return false;
  }
}

module.exports = { UTILITY_PAGES, isUtilityUrl };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/utility-pages.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/utility-pages.js test/unit/utility-pages.test.js
git commit -m "feat(sheet): shared utility-page URL classifier"
```

---

### Task 2: Zipped session-restore filter (pure module + unit tests)

**Files:**
- Create: `src/main/session-restore.js`
- Test: `test/unit/session-restore.test.js`

**Interfaces:**
- Consumes: a `shouldDrop(url) => boolean` predicate (Task 6 passes `isUtilityUrl`).
- Produces: `filterRestoredSession({urls, groupIds, pinned, activeIndex}, shouldDrop) => {urls, groupIds, pinned, activeIndex}` — arrays stay zipped; `activeIndex` remaps to the surviving entry at the original index, else the first survivor after it, else the last survivor before it, else 0.

- [ ] **Step 1: Write the failing test**

```js
// test/unit/session-restore.test.js
const assert = require('node:assert/strict');
const test = require('node:test');

const { filterRestoredSession } = require('../../src/main/session-restore');

const drop = (url) => url.startsWith('blanc://settings');

test('keeps zipped alignment when middle entries drop', () => {
  const out = filterRestoredSession({
    urls: ['https://a/', 'blanc://settings/', 'https://b/'],
    groupIds: ['g1', null, 'g2'],
    pinned: [true, false, false],
    activeIndex: 0,
  }, drop);
  assert.deepEqual(out, {
    urls: ['https://a/', 'https://b/'],
    groupIds: ['g1', 'g2'],
    pinned: [true, false],
    activeIndex: 0,
  });
});

test('active entry removed: next surviving neighbor wins', () => {
  const out = filterRestoredSession({
    urls: ['https://a/', 'blanc://settings/', 'https://b/'],
    groupIds: [null, null, null],
    pinned: [false, false, false],
    activeIndex: 1,
  }, drop);
  assert.equal(out.activeIndex, 1); // https://b/ at new index 1
});

test('active entry removed with no survivor after: last survivor before wins', () => {
  const out = filterRestoredSession({
    urls: ['https://a/', 'https://b/', 'blanc://settings/'],
    groupIds: [null, null, null],
    pinned: [false, false, false],
    activeIndex: 2,
  }, drop);
  assert.equal(out.activeIndex, 1); // https://b/
});

test('active survives a shift left', () => {
  const out = filterRestoredSession({
    urls: ['blanc://settings/', 'https://a/'],
    groupIds: [null, 'g1'],
    pinned: [false, true],
    activeIndex: 1,
  }, drop);
  assert.deepEqual(out, { urls: ['https://a/'], groupIds: ['g1'], pinned: [true], activeIndex: 0 });
});

test('everything removed: empty arrays, activeIndex 0', () => {
  const out = filterRestoredSession({
    urls: ['blanc://settings/'], groupIds: [null], pinned: [false], activeIndex: 0,
  }, drop);
  assert.deepEqual(out, { urls: [], groupIds: [], pinned: [], activeIndex: 0 });
});

test('missing metadata arrays and out-of-range activeIndex are tolerated', () => {
  const out = filterRestoredSession({ urls: ['https://a/'], activeIndex: 99 }, drop);
  assert.deepEqual(out, { urls: ['https://a/'], groupIds: [null], pinned: [false], activeIndex: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/session-restore.test.js`
Expected: FAIL — `Cannot find module '../../src/main/session-restore'`

- [ ] **Step 3: Write the implementation**

```js
// src/main/session-restore.js
// Pure restore-time filter (design §6): session.json holds parallel arrays
// (urls / groupIds / pinned) plus activeIndex, so dropping entries must be
// zipped or the metadata silently misaligns onto the wrong tabs.

/**
 * @param {{urls?: string[], groupIds?: (string|null)[], pinned?: boolean[], activeIndex?: number}} saved
 * @param {(url: string) => boolean} shouldDrop
 */
function filterRestoredSession({ urls = [], groupIds = [], pinned = [], activeIndex = 0 } = {}, shouldDrop) {
  const survivors = [];
  for (const [i, url] of urls.entries()) {
    if (shouldDrop(url)) continue;
    survivors.push({ url, groupId: groupIds[i] ?? null, pinned: !!pinned[i], originalIndex: i });
  }
  const clamped = Math.min(Math.max(0, activeIndex), Math.max(0, urls.length - 1));
  // The survivor at the original index, else the next surviving neighbor
  // (first after, falling back to last before), else 0.
  let next = survivors.findIndex((s) => s.originalIndex >= clamped);
  if (next === -1) next = survivors.length - 1;
  if (next === -1) next = 0;
  return {
    urls: survivors.map((s) => s.url),
    groupIds: survivors.map((s) => s.groupId),
    pinned: survivors.map((s) => s.pinned),
    activeIndex: next,
  };
}

module.exports = { filterRestoredSession };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/session-restore.test.js`
Expected: PASS (6 tests). Note the `originalIndex >= clamped` trick covers both "survived at index" and "first after" in one scan.

- [ ] **Step 5: Commit**

```bash
git add src/main/session-restore.js test/unit/session-restore.test.js
git commit -m "feat(sheet): zipped session-restore filter with activeIndex remap"
```

---

### Task 3: Sheet lifecycle in main.js + test-hook accessor

**Files:**
- Modify: `src/main/main.js` (near `createOverlay`/`showOverlay`/`hideOverlay`, `openInternalPage` at ~1329, `setActiveTab`, `resizeActiveView`, window teardown)
- Modify: `src/main/test-hook.js`

**Interfaces:**
- Consumes: `isUtilityUrl` (Task 1); existing `hasLiveWindow`, `TAB_WEB_PREFERENCES`, `chromeHeight`, `overlayMode`/`overlayView`, `tabs`, `activeTabId`.
- Produces (module-scope in main.js, used by Tasks 4–5): `showUtilityPage(url)`, `hideUtilitySheet({refocusContent}={})`, `utilitySheetUrl` (string|null, null = hidden), `utilitySheetView` (WebContentsView|null). Test-hook gains `utilitySurface() => ({visible, url})`.

- [ ] **Step 1: Add the sheet state + lifecycle functions to main.js**

Place directly below `hideOverlay`. `require` the classifier at the top of main.js with the other local requires: `const { isUtilityUrl } = require('./utility-pages');`

```js
// --- Utility sheet (design: 2026-07-22-utility-sheet-design.md) ---
// The five utility pages render here, never as tabs. One lazy transparent
// view; the page draws its own scrim + card (body.sheet in pages.css).
let utilitySheetView = null;
/** Currently shown utility URL; null = hidden. The single mode flag. */
let utilitySheetUrl = null;

function createUtilitySheet() {
  utilitySheetView = new WebContentsView({ webPreferences: TAB_WEB_PREFERENCES });
  utilitySheetView.setBackgroundColor('#00000000');
  const wc = utilitySheetView.webContents;
  // Esc dismisses no matter what inside the page holds focus (mirrors the
  // island overlay's handler).
  wc.on('before-input-event', (event, input) => {
    if (utilitySheetUrl && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      hideUtilitySheet();
    }
  });
  // A crashed sheet renderer is dismissed and destroyed; the next open
  // lazily recreates it. Close the dead webContents — dropping the
  // reference alone leaks the crashed guest. Default refocus: nothing else
  // will hand focus back after a crash.
  wc.on('render-process-gone', () => {
    hideUtilitySheet();
    wc.close();
    utilitySheetView = null;
  });
}

function showUtilityPage(url) {
  if (!hasLiveWindow()) return;
  // Toggle: a direct re-invocation (menu/accelerator) of the shown page
  // closes it. Overlay-hosted entry points can never hit this — summoning
  // the overlay already dismissed the sheet.
  if (utilitySheetUrl === url) return hideUtilitySheet();
  // One floating layer at a time, in both directions.
  hideOverlay({ refocusContent: false });
  if (!utilitySheetView) createUtilitySheet();
  utilitySheetUrl = url;
  // Rapid page swaps abort the in-flight load — loadURL rejects with
  // ERR_ABORTED; that's routine, not an error.
  utilitySheetView.webContents.loadURL(url).catch(() => {});
  // Mirror tabs: a detached view's document still reports visibilityState
  // 'visible' and never background-throttles — toggle real visibility.
  utilitySheetView.setVisible(true);
  win.contentView.addChildView(utilitySheetView);
  resizeActiveView();
  utilitySheetView.webContents.focus();
}

function hideUtilitySheet({ refocusContent = true } = {}) {
  if (!utilitySheetUrl) return;
  utilitySheetUrl = null;
  if (hasLiveWindow() && utilitySheetView) {
    win.contentView.removeChildView(utilitySheetView);
    utilitySheetView.setVisible(false);
    if (refocusContent) tabs.get(activeTabId)?.view.webContents.focus();
  }
}
```

- [ ] **Step 2: Route `openInternalPage` through the classifier**

Replace the existing function body's head (keep the existing else-path exactly):

```js
function openInternalPage(url) {
  if (isUtilityUrl(url)) return showUtilityPage(url);
  const existing = tabOrder.find((id) => tabs.get(id)?.url.startsWith(url));
  if (existing) {
    setActiveTab(existing);
    tabs.get(existing).view.webContents.reload(); // pick up fresh data
  } else {
    setActiveTab(createTab(url));
  }
}
```

- [ ] **Step 3: Wire the interplay rules**

Three insertions:

a) `showOverlay(...)` — first line of the function body: `hideUtilitySheet({ refocusContent: false });` (summoning the island dismisses the sheet).

b) `setActiveTab(...)` — immediately after the `if (id === activeTabId) return;` no-op guard: `hideUtilitySheet({ refocusContent: false });` (tab switches dismiss; the switched-to tab takes focus via the existing flow).

c) `resizeActiveView()` — alongside the existing overlay line at the end:

```js
  if (utilitySheetUrl && utilitySheetView) {
    const b = win.getContentBounds();
    utilitySheetView.setBounds({ x: 0, y: chromeHeight, width: b.width, height: Math.max(0, b.height - chromeHeight) });
  }
```

Also add the stacking guard right after `setActiveTab`'s existing overlay re-stack line (`if (overlayMode && overlayView) win.contentView.addChildView(overlayView);` — the sheet was just dismissed two lines up, so only the defensive ordering matters; add ABOVE that overlay line):

```js
  if (utilitySheetUrl && utilitySheetView) win.contentView.addChildView(utilitySheetView);
```

And in the window teardown where `overlayView` is destroyed on window `closed` (grep `closed` near `createMainWindow`), destroy the sheet with the explicit close guard — dropping the reference without closing leaks the webContents:

```js
  if (utilitySheetView) {
    utilitySheetView.webContents.close();
    utilitySheetView = null;
    utilitySheetUrl = null;
  }
```

- [ ] **Step 4: Test-hook accessor + reset dismissal**

In `main.js`, extend the `refs` object passed to `testHook.install` with `showUtilityPage, hideUtilitySheet, getUtilitySheetState: () => ({ visible: !!utilitySheetUrl, url: utilitySheetUrl })`. In `src/main/test-hook.js`, destructure them and add to `globalThis.__blanc`:

```js
    utilitySurface() { return getUtilitySheetState(); },
```

and in `reset()`, first line: `hideUtilitySheet();`

- [ ] **Step 5: Verify with a scratch Playwright run (throwaway window — run before any user-facing relaunch)**

Write `<scratchpad>/verify-sheet-task3.cjs` modeled on the session's existing `verify-overlay.cjs` harness (launch with `BLANC_TEST=1` + temp `--user-data-dir`, wait for `__blanc`), then:

```js
    // openDownloads goes through openInternalPage → sheet, not a tab.
    const before = await app.evaluate(() => globalThis.__blanc.state());
    await app.evaluate(() => globalThis.__blanc.openDownloads());
    const surf = await app.evaluate(() => globalThis.__blanc.utilitySurface());
    const after = await app.evaluate(() => globalThis.__blanc.state());
    if (!surf.visible || surf.url !== 'blanc://downloads/') throw new Error('sheet not shown: ' + JSON.stringify(surf));
    if (after.tabs.length !== before.tabs.length) throw new Error('a tab was created');
    if (after.activeTabId !== before.activeTabId) throw new Error('active tab changed');
    // Toggle via direct re-invocation.
    await app.evaluate(() => globalThis.__blanc.openDownloads());
    const surf2 = await app.evaluate(() => globalThis.__blanc.utilitySurface());
    if (surf2.visible) throw new Error('toggle did not dismiss');
    // Palette dismisses the sheet.
    await app.evaluate(() => { globalThis.__blanc.openDownloads(); globalThis.__blanc.openPalette(); });
    const surf3 = await app.evaluate(() => globalThis.__blanc.utilitySurface());
    if (surf3.visible) throw new Error('overlay summon did not dismiss sheet');
```

Run: `node <scratchpad>/verify-sheet-task3.cjs` — Expected: no throws. Also `npm run test:unit` still passes.

- [ ] **Step 6: Commit**

```bash
git add src/main/main.js src/main/test-hook.js
git commit -m "feat(sheet): utility sheet lifecycle, routing chokepoint, test hook"
```

---

### Task 4: Routing interceptions (tab nav, createTab, typed address, sheet default-deny)

**Files:**
- Modify: `src/main/main.js` — the tab `will-navigate` handler (grep `page-initiated hops`), `createTab` head, `tabs:navigate` chromeHandle, `createUtilitySheet` (from Task 3).

**Interfaces:**
- Consumes: `isUtilityUrl`, `showUtilityPage`, `hideUtilitySheet`, `utilitySheetUrl` (Tasks 1, 3); existing `handOffToOs`, `normalizeAddressInput`, `openInternalPage`, `createTab`, `setActiveTab`.
- Produces: no new symbols — behavior only.

- [ ] **Step 1: Intercept ordinary-tab navigation to utility URLs**

The existing tab handler permits `blanc:` → `blanc:` hops, which lets the newtab ledger's `favorites` link create a utility tab. Replace the handler body:

```js
  wc.on('will-navigate', (event, targetUrl) => {
    // Utility pages never load in a tab — the newtab ledger links to
    // blanc://bookmarks/ and blanc:→blanc: hops are otherwise legal.
    if (isUtilityUrl(targetUrl)) {
      event.preventDefault();
      openInternalPage(targetUrl);
      return;
    }
    if (/^blanc:/i.test(targetUrl) && !wc.getURL().startsWith('blanc://')) {
      event.preventDefault();
    }
    if (handOffToOs(targetUrl)) event.preventDefault();
  });
```

- [ ] **Step 2: Guard `createTab` (defense in depth) + dismiss on any tab creation**

First lines of `createTab`, before the id/view creation:

```js
  if (isUtilityUrl(url)) {
    // Utility pages never become tabs regardless of caller (external
    // open-url handoff, future call sites). Session restore filters
    // first and never trips this. Callers tolerate null: setActiveTab
    // no-ops on unknown ids.
    showUtilityPage(url);
    return null;
  }
  // Creating any real tab dismisses the sheet (design §5) — including
  // BACKGROUND creation (cmd-click arrives as disposition 'background-tab'
  // and never calls setActiveTab, so setActiveTab's dismissal alone has a
  // hole). DEFAULT refocus: background creation activates nothing, so the
  // current active tab must take focus back or it strands in the detached
  // sheet; when foreground creation follows with setActiveTab, that call
  // immediately re-focuses the new tab — the transient refocus is harmless.
  // No-ops during session restore and window creation (sheet hidden).
  hideUtilitySheet();
```

- [ ] **Step 2b: Intercept utility targets in the window-open handler**

In `applyWindowOpenPolicy` (grep `Web content must not mint privileged`), add BEFORE the existing web→blanc deny check:

```js
      // Utility pages never become tabs — and an adopted child must never
      // reach createTab's guard: by createWindow time the guest webContents
      // already exists, and a null return would leave it half-built and
      // unmanaged. Route to the sheet, deny the child outright. (Only
      // blanc:// pages can reach this line — web → blanc is denied below.)
      if (isUtilityUrl(targetUrl)) {
        openInternalPage(targetUrl);
        return { action: 'deny' };
      }
```

- [ ] **Step 2c: Route zoom commands to the sheet while visible**

`zoomActiveTab(delta)` and `resetZoomForActiveTab()` (grep `ZOOM_STEP`) currently always target the active tab — with the sheet open, ⌘+/⌘−/⌘0 would zoom the covered page. Add a target helper and use it in both:

```js
/** Zoom acts on what the user is looking at: the sheet when open, else the active tab. */
function zoomTargetWebContents() {
  if (utilitySheetUrl && utilitySheetView) return utilitySheetView.webContents;
  return tabs.get(activeTabId)?.view.webContents ?? null;
}

function zoomActiveTab(delta) {
  const wc = zoomTargetWebContents();
  if (!wc) return;
  const level = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, wc.getZoomLevel() + delta));
  wc.setZoomLevel(level);
}

function resetZoomForActiveTab() {
  zoomTargetWebContents()?.setZoomLevel(0);
}
```

(Keep any additional lines the real `zoomActiveTab` body has — only the webContents lookup changes.)

- [ ] **Step 3: Route typed utility addresses**

In the `tabs:navigate` chromeHandle, after the `handOffToOs` early-return and before `loadURL`:

```js
    const target = normalizeAddressInput(url);
    if (isUtilityUrl(target)) return openInternalPage(target);
    tabsWantingAddressBarFocus.delete(id);
    tab.view.webContents.loadURL(target);
```

(The existing `tabsWantingAddressBarFocus.delete(id)` and `loadURL(normalizeAddressInput(url))` lines are replaced by the above — normalize once.)

- [ ] **Step 4: Default-deny navigation policy on the sheet itself**

Append inside `createUtilitySheet()` after the crash handler:

```js
  // Default-deny (design §4): utility→utility stays in-sheet; http(s)
  // opens a real tab (setActiveTab dismisses the sheet); approved handoff
  // protocols go to the OS; everything else — and every window.open — dies.
  wc.on('will-navigate', (event, targetUrl) => {
    if (isUtilityUrl(targetUrl)) {
      utilitySheetUrl = targetUrl; // keep the toggle honest across in-sheet nav
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//i.test(targetUrl)) {
      const id = createTab(targetUrl);
      if (id) setActiveTab(id);
    } else {
      handOffToOs(targetUrl);
    }
  });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
```

- [ ] **Step 5: Verify with a scratch Playwright run**

Extend/copy the Task 3 script into `verify-sheet-task4.cjs`; after `__blanc` is up:

```js
    // (a) newtab ledger link routes to the sheet, no tab appears.
    const before = await app.evaluate(() => globalThis.__blanc.state());
    // Drive the ACTIVE newtab page's real anchor click via its webContents.
    await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('blanc://newtab'));
      await wc.executeJavaScript(`document.querySelector('a[href="blanc://bookmarks/"]').click()`);
    });
    await new Promise((r) => setTimeout(r, 500));
    const surf = await app.evaluate(() => globalThis.__blanc.utilitySurface());
    const after = await app.evaluate(() => globalThis.__blanc.state());
    if (!surf.visible || surf.url !== 'blanc://bookmarks/') throw new Error('ledger link did not open sheet');
    if (after.tabs.length !== before.tabs.length) throw new Error('ledger link created a tab');
    // (b) createTab guard.
    const id = await app.evaluate(() => globalThis.__blanc.openTab('blanc://settings/'));
    if (id !== null) throw new Error('createTab built a utility tab');
    // (c) outbound: a favorite clicked on the favorites sheet opens exactly
    // one real tab and dismisses the sheet.
    await app.evaluate((_, repo) => {
      process.mainModule.require(`${repo}/src/main/bookmarks`).toggleBookmark('https://www.example.com/', 'Example');
    }, REPO_ROOT);
    // The bookmarks sheet is already open from (a). Reload it so the list
    // shows the seeded favorite, then click the first outbound link.
    const mid = await app.evaluate(() => globalThis.__blanc.state());
    const outboundClicked = await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('blanc://bookmarks'));
      await wc.reload();
      await new Promise((r) => wc.once('did-finish-load', r));
      return wc.executeJavaScript(
        `(() => { const a = document.querySelector('a[href^="https"]'); if (a) a.click(); return !!a; })()`);
    });
    if (!outboundClicked) throw new Error('no outbound link rendered on the bookmarks sheet');
    await new Promise((r) => setTimeout(r, 800));
    const surfC = await app.evaluate(() => globalThis.__blanc.utilitySurface());
    const afterC = await app.evaluate(() => globalThis.__blanc.state());
    if (afterC.tabs.length !== mid.tabs.length + 1) throw new Error('outbound click did not create exactly one tab');
    if (surfC.visible) throw new Error('outbound click did not dismiss the sheet');
```

(If the bookmarks page renders favorites as non-anchor rows — check `bookmarks.js` at execution time — drive its real row-activation path instead of an `a[href]` selector and keep the same two asserts.) Expected: all asserts pass.

Run: `node <scratchpad>/verify-sheet-task4.cjs` — Expected: no throws. `npm run test:unit` green.

- [ ] **Step 6: Commit**

```bash
git add src/main/main.js
git commit -m "feat(sheet): classifier-gated routing — tab nav, createTab, typed address, sheet default-deny"
```

---

### Task 5: Sheet presentation — scrim/card CSS, sheet.js, ✕, strict close IPC

**Files:**
- Modify: `src/renderer/pages/pages.css`
- Create: `src/renderer/pages/sheet.js`
- Modify: `src/renderer/pages/{bookmarks,history,downloads,settings,shortcuts}.html` (body class + script tag)
- Modify: `src/main/pages.js` (strict `pages:surface:close`), `src/main/tab-preload.js` (`surface.close`), `src/main/main.js` (hooks)

**Interfaces:**
- Consumes: `hideUtilitySheet`, `utilitySheetView` (Task 3); `UTILITY_PAGES` (Task 1).
- Produces: `window.bowserPages.surface.close()` in utility pages; `hooks.utilitySheet = { isSheetSender(wc): boolean, close(): void }` consumed by `pages.js`.

- [ ] **Step 1: pages.css — scrim + card (append at end of file)**

```css
/* ---------- Utility sheet presentation (body.sheet) ----------
   The sheet WebContentsView is transparent; the page draws the scrim
   (body) and the card (.page). The shared `html, body` rule paints an
   OPAQUE var(--bg) root — without the :has override the translucent body
   would composite over that, not over the web content behind the view.
   The card owns its own scrolling — the scrim never scrolls — and must
   stay usable at the 640×480 window minimum. */
html:has(body.sheet) { background: transparent; }
body.sheet {
  background: rgba(14, 14, 14, 0.18);
  height: 100vh;
  min-height: 0; /* the shared rule's min-height:100% must not stretch the scrim */
  overflow: hidden;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}
body.sheet .page {
  position: relative;
  margin: 0;
  width: 100%;
  max-width: 900px;
  max-height: 100%;
  overflow-y: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.22);
}
/* The ✕ lives INSIDE .page-nav (sheet.js appends it): the nav is already
   position:sticky/z-index:5 with an opaque background, so the close
   control stays visible while the card scrolls, gets reserved flex space,
   and can never be occluded by the nav band itself. */
.page-nav .sheet-close {
  margin-left: auto;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.page-nav .sheet-close:hover { color: var(--text); background: var(--surface); }
/* 640×480 floor: stack the Settings sidebar over its content instead of
   overflowing beside it (.settings-shell is flex with a 150px fixed rail —
   at a 592px card the content column would drop below its ~460px need),
   and let controls shrink. Viewport == sheet view == window content area,
   so a plain media query is correct. */
@media (max-width: 719px) {
  body.sheet .settings-shell { flex-direction: column; gap: 16px; }
  body.sheet .settings-nav { position: static; flex: none; flex-direction: row; flex-wrap: wrap; }
  body.sheet .setting { flex-wrap: wrap; }
  /* ALL controls, not just text inputs — Settings has fixed-width url and
     password fields (sync form) that would still overflow under zoom. */
  body.sheet .setting input,
  body.sheet .setting select { max-width: 100%; min-width: 0; }
}
@media (prefers-color-scheme: dark) {
  body.sheet { background: rgba(0, 0, 0, 0.35); }
}
```

(No `prefers-reduced-motion` addition needed — the sheet ships without show/hide animation in v1, so there is nothing to disable. Check `.settings-nav`'s base rule when editing: it sets `flex-direction: column` inside a `flex: 0 0 150px` rail — the narrow override above must fully neutralize both.)

- [ ] **Step 2: sheet.js — dialog semantics, ✕, scrim click, heading focus**

```js
// src/renderer/pages/sheet.js
// Shared glue for utility pages presented in the sheet (body.sheet):
// dialog semantics, the ✕, scrim-click dismissal, and initial focus on the
// page heading so keyboard/screen-reader users land on what just opened.
// Esc is handled main-side (before-input-event); this file never needs it.
(() => {
  const page = document.querySelector('.page');
  if (!page || !window.bowserPages?.surface) return;

  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-modal', 'true');
  const heading = page.querySelector('h1');
  if (heading) {
    if (!heading.id) heading.id = 'sheetTitle';
    page.setAttribute('aria-labelledby', heading.id);
    heading.tabIndex = -1;
    heading.focus();
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'sheet-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  close.addEventListener('click', () => window.bowserPages.surface.close());
  // All five utility pages have a sticky .page-nav — the ✕ rides it so it
  // never scrolls away and never stacks under the nav band.
  page.querySelector('.page-nav').append(close);

  // Clicks on the scrim (the body itself, outside the card) dismiss.
  document.body.addEventListener('mousedown', (e) => {
    if (e.target === document.body) window.bowserPages.surface.close();
  });
})();
```

- [ ] **Step 3: The five HTML files**

In each of `bookmarks.html`, `history.html`, `downloads.html`, `settings.html`, `shortcuts.html`: change `<body>` to `<body class="sheet">` and add `<script src="sheet.js"></script>` immediately BEFORE the page's existing script tag. (Flat dir — `sheet.js` is served by the same basename-only handler.) Do NOT touch `newtab.html`, `error.html`, `auth.html`.

- [ ] **Step 4: Strict close IPC**

`src/main/tab-preload.js` — add to the `bowserPages` object:

```js
    surface: {
      close: () => ipcRenderer.invoke('pages:surface:close'),
    },
```

`src/main/main.js` — in the `setupPages(...)` hooks argument, add:

```js
    utilitySheet: {
      isSheetSender: (wc) => !!utilitySheetView && wc === utilitySheetView.webContents,
      close: () => hideUtilitySheet(),
    },
```

`src/main/pages.js` — register OUTSIDE the generic `handle()` wrapper (its KNOWN_PAGES trust is too broad — newtab must not be able to dismiss the sheet). Add near the other handlers, importing the classifier at top (`const { UTILITY_PAGES } = require('./utility-pages');`):

```js
  // Stricter than handle(): only the sheet view itself, on a utility page,
  // may close the sheet (design §5) — KNOWN_PAGES trust is too broad here.
  ipcMain.handle('pages:surface:close', (event) => {
    let senderUrl = null;
    try { senderUrl = new URL(event.senderFrame?.url ?? ''); } catch { /* denied below */ }
    const trusted = event.senderFrame === event.sender.mainFrame &&
      senderUrl?.protocol === 'blanc:' && UTILITY_PAGES.has(senderUrl.host) &&
      hooks.utilitySheet?.isSheetSender(event.sender);
    if (!trusted) throw new Error(`pages:surface:close: denied for ${event.senderFrame?.url ?? event.sender.getURL()}`);
    hooks.utilitySheet.close();
  });
```

- [ ] **Step 5: Verify (scratch Playwright + screenshot)**

`verify-sheet-task5.cjs`. **`blanc://` WebContentsViews do not surface as Playwright Pages** (project memory: only file:// chrome documents do) — drive the sheet document exclusively through `electronApp.evaluate` → `webContents.executeJavaScript`, and capture pixels with `webContents.capturePage()`:

```js
    await app.evaluate(() => globalThis.__blanc.openDownloads()); // any utility page
    await new Promise((r) => setTimeout(r, 800));
    const dom = await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('blanc://downloads'));
      return wc.executeJavaScript(`(() => {
        const page = document.querySelector('.page');
        return {
          role: page.getAttribute('role'),
          modal: page.getAttribute('aria-modal'),
          labelledBy: page.getAttribute('aria-labelledby'),
          headingFocused: document.activeElement === page.querySelector('h1'),
          closeLabel: page.querySelector('.page-nav .sheet-close')?.getAttribute('aria-label'),
          rootTransparent: getComputedStyle(document.documentElement).backgroundColor === 'rgba(0, 0, 0, 0)',
        };
      })()`);
    });
    // assert: role==='dialog', modal==='true', labelledBy set, headingFocused,
    // closeLabel==='Close', rootTransparent===true
    // ✕ click closes:
    await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('blanc://downloads'));
      await wc.executeJavaScript(`document.querySelector('.sheet-close').click()`);
    });
    // assert utilitySurface().visible === false; reopen, then scrim:
    // executeJavaScript `document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))`
    // (target === body ⇒ dismiss), assert hidden again.
    // Deny check: from the ACTIVE NEWTAB tab's webContents run
    // `window.bowserPages.surface.close()` — expect the promise to REJECT.
    // Visual record: png = await app.evaluate(...capturePage on the sheet wc
    // ...).toPNG() is not serializable — write it main-side is overkill;
    // instead capture via: const img = await app.evaluate(async ({webContents}) => {
    //   const wc = ...; return (await wc.capturePage()).toDataURL(); });
    // and fs.writeFileSync('panel-sheet.png', Buffer.from(img.split(',')[1], 'base64')).
```

Seeding helpers may use `process.mainModule.require(<abs path>)` inside `electronApp.evaluate` — verified working in this exact runtime (Electron 43) earlier today.

Run: `node <scratchpad>/verify-sheet-task5.cjs` — Expected: all asserts pass, the newtab deny rejects.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/pages.css src/renderer/pages/sheet.js src/renderer/pages/*.html src/main/pages.js src/main/tab-preload.js src/main/main.js
git commit -m "feat(sheet): scrim/card presentation, dialog semantics, strictly-guarded close IPC"
```

---

### Task 6: Session-restore wiring

**Files:**
- Modify: `src/main/main.js` (the restore block — grep `Snapshot, don't alias`)

**Interfaces:**
- Consumes: `filterRestoredSession` (Task 2), `isUtilityUrl` (Task 1).
- Produces: none — behavior only.

- [ ] **Step 1: Wire the filter**

`require` at top with the other locals: `const { filterRestoredSession } = require('./session-restore');`
In the restore block, after `const saved = structuredClone(ensureSessionStore().data);` insert:

```js
  // Stale sessions from before the utility sheet may hold utility-page
  // tabs; drop them (zipped — groupIds/pinned/activeIndex stay aligned)
  // so the createTab replay never routes through the sheet guard.
  const cleaned = filterRestoredSession(saved, isUtilityUrl);
  saved.urls = cleaned.urls;
  saved.groupIds = cleaned.groupIds;
  saved.pinned = cleaned.pinned;
  saved.activeIndex = cleaned.activeIndex;
```

- [ ] **Step 2: Verify with a seeded stale session**

`verify-sheet-task6.cjs`: create the temp `--user-data-dir` and BEFORE launching write the fixture to **`${userDataDir}-Dev/session.json`** — main.js appends `-Dev` to userData **unconditionally** in unpackaged runs ([main.js:45-47](../../../src/main/main.js)), *after* Electron has applied the `--user-data-dir` switch, so the app actually reads/writes the `-Dev`-suffixed sibling directory (`fs.mkdirSync(userDataDir + '-Dev', {recursive: true})` first). Fixture content:

```json
{ "urls": ["https://www.example.com/", "blanc://settings/", "blanc://downloads/"], "activeIndex": 1, "groups": [], "groupIds": [null, null, null], "pinned": [false, false, false] }
```

Launch, then assert `state()`: exactly 1 restored tab (`https://www.example.com/`), no tab URL starts with `blanc://settings` or `blanc://downloads`, and `utilitySurface().visible === false` (restore must not pop the sheet either). If the launched app writes a fresh session before the assert, read state immediately after `__blanc` appears. Cleanup in `finally` must remove BOTH `userDataDir` and `${userDataDir}-Dev`.

Run: `node <scratchpad>/verify-sheet-task6.cjs` — Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/main/main.js
git commit -m "feat(sheet): filter stale utility tabs out of session restore"
```

---

### Task 7: Acceptance spec + step updates

**Files:**
- Modify: `spec/acceptance/internal-pages.feature`, `spec/acceptance/island-and-commands.feature`
- Modify: `test/desktop/steps/runnable.steps.js`, `test/desktop/cucumber.mjs`
- Modify: `src/main/test-hook.js` (drive helpers for the new scenarios)

**Interfaces:**
- Consumes: `__blanc.utilitySurface()` (Task 3), `__blanc.state()`; `tabs`/`getActiveTabId`/`bookmarks` already in test-hook scope; `getUtilitySheetWebContents` (add to refs here).
- Produces: updated shared Gherkin + executing desktop bindings; `__blanc.followNewtabFavoritesLink()`, `__blanc.seedFavorite(url, title)`, `__blanc.clickFirstSheetLink()`.

- [ ] **Step 1: Fix F16-2 and reword the affected scenarios**

`internal-pages.feature` — F16-2 today reads "When I follow its \"History\" navigation link", but the ledger's only navigation link is **Favorites** (`newtab.html:17`, `blanc://bookmarks/`) — the scenario as written is unimplementable. Replace the whole scenario (keeping its stable id):

```gherkin
  @F16-2 @F16 @all
  Scenario: Internal navigation stays within the blanc scheme
    Given the new-tab page is open
    When I follow its "Favorites" navigation link
    Then the favorites page opens in the utility sheet under the blanc scheme
    And no new tab is created
```

Add two new scenarios to `internal-pages.feature` (design §8 proofs 1 and 3), with fresh stable ids in the F16 family:

```gherkin
  @F16-4 @F16 @all
  Scenario: Utility pages never occupy tabs
    Given a tab open on "site.example"
    When I open the downloads page
    Then the downloads page opens in the utility sheet
    And the active tab and tab order are unchanged

  @F16-5 @F16 @all
  Scenario: Activating a favorite from the utility sheet opens one real tab
    Given a favorite for "kept.example" exists
    And the favorites page is open in the utility sheet
    When I activate that favorite
    Then exactly one new tab opens on "kept.example"
    And the utility sheet is dismissed
```

(F16-4's "a tab open on" — not "is open on" — matches the existing binding `Given('a tab open on {string}')` at runnable.steps.js:22 verbatim; do not mint a near-duplicate step. F16-2's `Given the new-tab page is open` has NO existing binding — it was backlog until now — Step 4 adds one.)

In `island-and-commands.feature`'s command table: `| /downloads | the downloads page opens |` → `| /downloads | the downloads page opens in the utility sheet |`. (F16-3 — "Privileged browser chrome cannot navigate to web content" — is unrelated to the sheet; leave it alone.)

- [ ] **Step 2: Register the new ids in the runnable profile**

`test/desktop/cucumber.mjs` — the `RUNNABLE` allowlist selects scenarios by stable tag; an untagged or unlisted scenario is silently skipped. Add to the list: `'@F16-2', '@F16-4', '@F16-5'` (F16-3 is already present).

- [ ] **Step 3: Test-hook drive helpers**

The steps run through `this.call(...)` → `__blanc`; clicking real page DOM needs main-side helpers. In `src/main/test-hook.js` (bookmarks module already required; add `getUtilitySheetWebContents` to the refs main.js passes — `() => utilitySheetView?.webContents ?? null`):

```js
    // ---- utility sheet drive helpers (acceptance) ----
    // Both click helpers ASSERT the anchor exists — an optional-chained
    // click would silently no-op and turn a rendering regression into a
    // downstream timeout instead of a pointed failure.
    async followNewtabFavoritesLink() {
      const t = tabs.get(getActiveTabId());
      const clicked = await t.view.webContents.executeJavaScript(
        `(() => { const a = document.querySelector('a[href="blanc://bookmarks/"]'); if (a) a.click(); return !!a; })()`);
      if (!clicked) throw new Error('newtab ledger has no favorites link');
    },
    seedFavorite(url, title) {
      if (!bookmarks.isBookmarked(url)) bookmarks.toggleBookmark(url, title || url);
    },
    async clickFirstSheetLink() {
      const wc = getUtilitySheetWebContents();
      if (!wc) throw new Error('sheet not open');
      const clicked = await wc.executeJavaScript(
        `(() => { const a = document.querySelector('a[href^="https"], a[href^="http"]'); if (a) a.click(); return !!a; })()`);
      if (!clicked) throw new Error('no outbound link rendered in sheet');
    },
```

(If the bookmarks page renders favorites without anchors, check `bookmarks.js` and drive its real row-activation path in `clickFirstSheetLink` — keep the helper's name and signature.)

- [ ] **Step 4: Bindings in runnable.steps.js**

Follow the file's existing conventions (read it first; `this.call(...)` proxies `__blanc`). New/updated steps:

Add a small poll helper near the top of the file (fixed sleeps turn slow CI into flakes; a missing state change must time out loudly):

```js
async function until(fn, what, ms = 4000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
```

```js
Given('the new-tab page is open', async function () {
  await this.call('newTab'); // opens blanc://newtab as the active tab
});

When('I follow its {string} navigation link', async function (label) {
  assert.equal(label, 'Favorites'); // the ledger's only nav link
  this.tabStateBefore = await this.call('state');
  await this.call('followNewtabFavoritesLink');
  await until(async () => (await this.call('utilitySurface')).visible, 'sheet to open');
});

When('I open the downloads page', async function () {
  this.tabStateBefore = await this.call('state');
  await this.call('openDownloads');
  await until(async () => (await this.call('utilitySurface')).visible, 'sheet to open');
});

Given('a favorite for {string} exists', async function (host) {
  await this.call('seedFavorite', `https://${host}/`, host);
});
```

For "the favorites page is open in the utility sheet", open via the chokepoint: add `openFavoritesSheet() { openInternalPage('blanc://bookmarks/'); }` to the test-hook (`openInternalPage` is already in the refs main.js passes — verified in the current `install()` destructure), and bind:

```js
Given('the favorites page is open in the utility sheet', async function () {
  await this.call('openFavoritesSheet');
  const surf = await this.call('utilitySurface');
  assert.equal(surf.visible, true);
  this.tabStateBefore = await this.call('state');
});

When('I activate that favorite', async function () {
  await this.call('clickFirstSheetLink');
  await until(async () => {
    const now = await this.call('state');
    return now.tabs.length === this.tabStateBefore.tabs.length + 1;
  }, 'outbound tab to open');
});

Then('the {word} page opens in the utility sheet', async function (name) {
  const surf = await this.call('utilitySurface');
  assert.equal(surf.visible, true);
  assert.equal(surf.url, `blanc://${name === 'favorites' ? 'bookmarks' : name}/`);
});

Then('the {word} page opens in the utility sheet under the blanc scheme', async function (name) {
  const surf = await this.call('utilitySurface');
  assert.equal(surf.visible, true);
  assert.ok(surf.url.startsWith(`blanc://${name === 'favorites' ? 'bookmarks' : name}/`));
});

Then('no new tab is created', async function () {
  const now = await this.call('state');
  assert.equal(now.tabs.length, this.tabStateBefore.tabs.length);
});

Then('the active tab and tab order are unchanged', async function () {
  const now = await this.call('state');
  assert.equal(now.activeTabId, this.tabStateBefore.activeTabId);
  assert.deepEqual(now.tabOrder, this.tabStateBefore.tabOrder);
});

Then('exactly one new tab opens on {string}', async function (host) {
  const now = await this.call('state');
  assert.equal(now.tabs.length, this.tabStateBefore.tabs.length + 1);
  assert.ok(now.tabs.some((t) => t.url.includes(host)));
});

Then('the utility sheet is dismissed', async function () {
  const surf = await this.call('utilitySurface');
  assert.equal(surf.visible, false);
});
```

If an existing Then-step already binds the old "page opens under the blanc scheme" text, update that SAME definition to the new text — never leave a dangling binding.

- [ ] **Step 5: Run the suites**

Run: `npm run test:acceptance:dry` — Expected: 0 undefined steps across the runnable set, including the three new/updated F16 ids.
Run: `npm run test:acceptance:desktop` — Expected: previously-passing scenarios still pass; F16-2, F16-4, F16-5 pass. (Launches real windows — keep before any user-facing relaunch.)

- [ ] **Step 6: Commit**

```bash
git add spec/acceptance/internal-pages.feature spec/acceptance/island-and-commands.feature test/desktop/steps/runnable.steps.js test/desktop/cucumber.mjs src/main/test-hook.js src/main/main.js
git commit -m "test(sheet): tagged, runnable acceptance proofs — ledger routing, no-tab invariant, outbound activation"
```

---

### Task 8: Docs — parity spec, CLAUDE.md, AGENTS.md

**Files:**
- Modify: the parity feature contract file under `spec/` that describes internal pages (locate: `grep -rln "internal pages" spec/ --include="*.md"`), `spec/parity-matrix.md` if it mentions tabs for these pages
- Modify: `CLAUDE.md`, `AGENTS.md` (both instruction files carry the same internal-pages architecture description — updating only one leaves the other stale)

- [ ] **Step 1: Amend the parity contract**

In the internal-pages feature entry, replace the presentation clause with: *"Utility pages (Favorites, History, Downloads, Settings, Shortcuts) present as a transient chrome surface — on desktop a sheet over a scrim — never as tabs; `newtab` and `error` remain tab content. Outbound activations open real tabs and dismiss the surface."* No new D# — this contract is platform-neutral and maps to native sheets on mobile.

- [ ] **Step 2: Update CLAUDE.md and AGENTS.md**

In each file's `**blanc:// internal pages**` section (AGENTS.md mirrors CLAUDE.md — apply the same edit to both, adjusted to each file's exact surrounding wording), after the sentence describing the pages, add: *"The five utility pages (`bookmarks`, `history`, `downloads`, `settings`, `shortcuts`) never open as tabs — main routes them (via `src/main/utility-pages.js`'s `isUtilityUrl`, the single classifier) into the utility sheet: a transparent always-below-the-island `WebContentsView` whose page draws its own scrim + card (`body.sheet` in pages.css + `sheet.js`). Esc/scrim/✕ dismiss; tab switches and ⌘L dismiss; session restore filters stale utility tabs (`session-restore.js`)."*

- [ ] **Step 3: Commit**

```bash
git add spec/ CLAUDE.md AGENTS.md
git commit -m "docs(sheet): parity contract + CLAUDE.md/AGENTS.md for the utility sheet"
```

---

### Task 9: Full verification + handoff

- [ ] **Step 1: Full automated pass**

Run: `npm run test:unit && npm run substrate:check && npm run test:acceptance:dry`
Expected: all green (unit count grows by the Task 1+2 tests; substrates untouched).

- [ ] **Step 2: Manual checklist (relaunch `npm start` — kill any existing dev instance first, and do this LAST so the user's window survives)**

Every entry point: footer buttons ×4, `/history` `/downloads` `/settings` `/favorites`, menu items, ⌘, ⌘⇧J ⌘⌥B ⌘/. Every dismissal: Esc, scrim click, ✕, menu-toggle (⌘, twice), tab switch, ⌘L. Newtab ledger `favorites` link → sheet. History entry click → one tab, sheet gone. Cross-page nav links inside the sheet swap in place. Light/dark/private-active-tab theming (sheet stays normal-themed). Resize to 640×480 — card scrolls internally. Confirm the dev instance is left running (`ps` by PID) in the final report.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch — present merge/PR options to the user (repo convention: squash-merged PRs via /commit-push-pr).

---

## Self-Review Notes

- Spec §3 (surface, stacking, lazy view) → Task 3. §4 (classifier; interceptions now FIVE: chokepoint, tab will-navigate, createTab guard + creation-dismissal, window-open handler, typed address; sheet default-deny) → Tasks 1, 3, 4. §5 (dismissals, ✕, toggle, one-layer, blur-survival — blur needs NO code: only the overlay has a blur-dismiss handler, the sheet simply doesn't add one) → Tasks 3, 5. §6 (free fallout + zipped restore, `-Dev` profile path) → Tasks 2, 6. §7 (a11y, focus, geometry floor incl. 640×480 settings stacking + zoom routing, crash close, loadURL catch, teardown, reset) → Tasks 3, 4, 5. §8 (proofs 1–3 as TAGGED RUNNABLE acceptance F16-2/F16-4/F16-5, 4 unit, 5 manual) → Tasks 2, 7, 9.
- Type consistency: `utilitySurface()` returns `{visible, url}` everywhere (Tasks 3, 4, 6, 7); `filterRestoredSession(saved, shouldDrop)` matches Task 6's call; `hooks.utilitySheet.{isSheetSender, close}` matches pages.js usage; test-hook drive helpers `followNewtabFavoritesLink`/`seedFavorite`/`clickFirstSheetLink`/`openFavoritesSheet` match the Task 7 bindings.
- Known judgment calls: `showUtilityPage` calls `hideOverlay({refocusContent:false})` so a menu accelerator hit while the palette is open swaps cleanly to the sheet (one-layer in both directions). `process.mainModule.require` is retained in scratch verification seeding — empirically verified working in this exact runtime (Electron 43 main process) earlier this session.
- Review-round fixes incorporated: transparent root (`html:has(body.sheet)`) over the opaque `html, body` rule; background-tab-creation dismissal in `createTab`; window-open utility interception before child adoption; tagged+RUNNABLE acceptance with real bindings and the F16-2 History→Favorites correction; 640×480 settings reflow + zoom routing; ✕ inside the sticky `.page-nav`; `${userDataDir}-Dev` fixture path; `loadURL` catch + crashed-webContents close; sheet DOM driven via `executeJavaScript` (blanc:// views expose no Playwright Page); AGENTS.md alongside CLAUDE.md.
