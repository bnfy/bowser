# Tabs & Favorites Menu Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the macOS native menu bar's Tabs and Favorites submenus up to Safari/Chrome-style parity — dynamic tab/favorites lists, dynamic labels, group actions — and add the Pin/Mute/Duplicate tab features neither menu can surface today because they don't exist yet.

**Architecture:** All new tab state (`pinned`, `muted`) lives on the existing per-tab object in `src/main/main.js`'s `tabs` Map, following the exact shape/lifecycle of existing fields like `bookmarked`. The native menu (`buildMenu()`) is rebuilt on a debounced schedule hung off the existing `broadcastTabs()` choke point, so it stays live without rebuilding at the ~10/s rate `broadcastTabs()` already runs at during page loads. The pill (`renderer.js`) and panel switcher list (`overlay.js`) each get a pinned-tabs section rendered separately from — and excluded from — the existing group/ungrouped clustering, mirroring the hand-synced-by-convention pattern those two files already use for `clusterTabs()`.

**Tech Stack:** Electron 43 (main process: Node/CommonJS), vanilla JS renderers (no framework), IPC via `contextBridge`/`ipcRenderer`, plain CSS custom properties.

## Global Constraints

- No test suite or linter exists in this repo — every "Verify" step below is a manual `npm start` interaction, not an automated test run. Do not add a test framework as part of this plan.
- The chrome documents (`index.html`, `overlay.html`) load once at window creation. Any step that changes `styles.css`, `overlay.js`, or `renderer.js` requires a **fresh `npm start`** to see the change — `Cmd/Ctrl+R` only reloads the active tab's web content.
- Favorites' internal identifiers stay named `bookmarks` (`bookmarks.js`, `bookmarks.json`, `isBookmarked`, etc.) — only user-facing labels/copy say "Favorites". Do not rename internals.
- No new npm dependencies. Everything here is buildable with what's already installed (Electron's `Menu`/`ipcMain` APIs, existing `JsonStore`).
- Mute does not persist across restarts; pinned does (see spec, `docs/superpowers/specs/2026-07-05-tabs-favorites-menu-design.md`).

---

## Task 1: Pin & Mute tab-state — model, persistence, IPC, slash commands

**Files:**
- Modify: `src/main/main.js:206-207` (tab JSDoc type)
- Modify: `src/main/main.js:349-426` (`persistSession`, `ensureSessionStore`)
- Modify: `src/main/main.js:655-694` (`createTab` signature + tab literal)
- Modify: `src/main/main.js:1411-1420` (session restore)
- Modify: `src/main/main.js` (new `toggleTabPinned`/`toggleTabMuted` functions, placed right after `closeGroup` at line 641)
- Modify: `src/main/main.js:1140-1146` (add two new `ipcMain.handle` lines to the existing `tabs:*` block)
- Modify: `src/main/preload.js:17` (add two new `browserAPI` methods)
- Modify: `src/renderer/overlay.js:349-371` (`COMMANDS` array — add `/pin`, `/mute`)

**Interfaces:**
- Produces: `toggleTabPinned(id: string): boolean` — toggles `tabs.get(id).pinned`, returns the new value. `toggleTabMuted(id: string): boolean` — toggles `tabs.get(id).muted`, calls `webContents.setAudioMuted()`, returns the new value. Both are consumed directly by Task 2's menu wiring and Task 4/7's UI.
- Produces: `window.browserAPI.toggleTabPinned(id)` / `window.browserAPI.toggleTabMuted(id)` (renderer-side, return a Promise resolving to the new boolean) — consumed by Task 7's row buttons.
- Produces: every tab object serialized by `serializeTabs()` (and thus every `tabs:updated` broadcast payload) now includes `pinned: boolean` and `muted: boolean` — consumed by Task 6 (pill) and Task 7 (panel row).

- [ ] **Step 1: Update the tab model's JSDoc type**

In `src/main/main.js`, find:
```js
/** @type {Map<string, { id: string, view: WebContentsView, title: string, url: string, isLoading: boolean, canGoBack: boolean, canGoForward: boolean, favicon: string | null, bookmarked: boolean, blockedCount: number, private: boolean, pageBg: string | null, themeColor: string | null }>} */
const tabs = new Map();
```
Replace with:
```js
/** @type {Map<string, { id: string, view: WebContentsView, title: string, url: string, isLoading: boolean, canGoBack: boolean, canGoForward: boolean, favicon: string | null, bookmarked: boolean, blockedCount: number, private: boolean, pinned: boolean, muted: boolean, pageBg: string | null, themeColor: string | null }>} */
const tabs = new Map();
```

- [ ] **Step 2: Add `pinned`/`muted` to `createTab`'s signature and tab literal**

Find:
```js
function createTab(url = newTabUrl(), { private: isPrivate = false, groupId = null, view = null } = {}) {
```
Replace with:
```js
function createTab(url = newTabUrl(), { private: isPrivate = false, groupId = null, view = null, pinned = false } = {}) {
```

Then find the tab literal (still inside `createTab`):
```js
  const tab = {
    id,
    view,
    title: 'New Tab',
    url,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    favicon: null,
    bookmarked: false,
    blockedCount: 0,
    private: isPrivate,
    groupId: groupId && groups.some((g) => g.id === groupId) ? groupId : null,
```
Replace with:
```js
  const tab = {
    id,
    view,
    title: 'New Tab',
    url,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    favicon: null,
    bookmarked: false,
    blockedCount: 0,
    private: isPrivate,
    pinned,
    muted: false,
    groupId: groupId && groups.some((g) => g.id === groupId) ? groupId : null,
```
(Leave every field after `groupId` — `pageBg`, `themeColor`, `historyEligible` — untouched.)

- [ ] **Step 3: Persist `pinned` in `session.json`**

Find:
```js
const ensureSessionStore = () => (sessionStore ??= new JsonStore('session', { urls: [], activeIndex: 0, groups: [], groupIds: [] }));
```
Replace with:
```js
const ensureSessionStore = () => (sessionStore ??= new JsonStore('session', { urls: [], activeIndex: 0, groups: [], groupIds: [], pinned: [] }));
```

Find, inside `persistSession()`:
```js
        return url ? { id, url, groupId: tab.groupId ?? null } : null;
      })
      .filter(Boolean);
    d.urls = entries.map((e) => e.url);
    d.groupIds = entries.map((e) => e.groupId);
```
Replace with:
```js
        return url ? { id, url, groupId: tab.groupId ?? null, pinned: !!tab.pinned } : null;
      })
      .filter(Boolean);
    d.urls = entries.map((e) => e.url);
    d.groupIds = entries.map((e) => e.groupId);
    d.pinned = entries.map((e) => e.pinned);
```

- [ ] **Step 4: Restore `pinned` on startup**

Find (in the `app.whenReady()` startup block):
```js
  const restoredIds = saved.urls.map((u, i) => createTab(u, { groupId: saved.groupIds?.[i] ?? null }));
```
Replace with:
```js
  const restoredIds = saved.urls.map((u, i) => createTab(u, { groupId: saved.groupIds?.[i] ?? null, pinned: !!saved.pinned?.[i] }));
```

- [ ] **Step 5: Add `toggleTabPinned`/`toggleTabMuted`**

Immediately after the existing `closeGroup` function (right after its closing `}` at line 641), add:
```js
function toggleTabPinned(id) {
  const tab = tabs.get(id);
  if (!tab) return false;
  tab.pinned = !tab.pinned;
  broadcastTabs();
  return tab.pinned;
}

function toggleTabMuted(id) {
  const tab = tabs.get(id);
  if (!tab) return false;
  tab.muted = !tab.muted;
  tab.view.webContents.setAudioMuted(tab.muted);
  broadcastTabs();
  return tab.muted;
}
```

- [ ] **Step 6: Wire up IPC**

Find:
```js
  ipcMain.handle('tabs:close-group', (_e, groupId) => closeGroup(groupId));
  ipcMain.handle('tabs:toggle-bookmark', () => toggleBookmarkForActiveTab());
```
Replace with:
```js
  ipcMain.handle('tabs:close-group', (_e, groupId) => closeGroup(groupId));
  ipcMain.handle('tabs:toggle-bookmark', () => toggleBookmarkForActiveTab());
  ipcMain.handle('tabs:toggle-pinned', (_e, id) => toggleTabPinned(id));
  ipcMain.handle('tabs:toggle-muted', (_e, id) => toggleTabMuted(id));
```

- [ ] **Step 7: Expose the new IPC methods on `browserAPI`**

In `src/main/preload.js`, find:
```js
  toggleBookmark: () => ipcRenderer.invoke('tabs:toggle-bookmark'),
```
Replace with:
```js
  toggleBookmark: () => ipcRenderer.invoke('tabs:toggle-bookmark'),
  toggleTabPinned: (id) => ipcRenderer.invoke('tabs:toggle-pinned', id),
  toggleTabMuted: (id) => ipcRenderer.invoke('tabs:toggle-muted', id),
```

- [ ] **Step 8: Add `/pin` and `/mute` slash commands**

In `src/renderer/overlay.js`, find the `COMMANDS` array entry for `/close`:
```js
    { cmd: '/close', hint: 'Close this tab', run: () => state.activeTabId && window.browserAPI.closeTab(state.activeTabId) },
```
Add these two entries immediately after it:
```js
    { cmd: '/close', hint: 'Close this tab', run: () => state.activeTabId && window.browserAPI.closeTab(state.activeTabId) },
    { cmd: '/pin', hint: 'Pin or unpin this tab', run: () => state.activeTabId && window.browserAPI.toggleTabPinned(state.activeTabId) },
    { cmd: '/mute', hint: 'Mute or unmute this tab', run: () => state.activeTabId && window.browserAPI.toggleTabMuted(state.activeTabId) },
```

- [ ] **Step 9: Verify — pin persists, mute doesn't, mute actually mutes audio**

Run `npm start`. In the running app:
1. Open a tab to any page. Press `⌘L`, type `/pin`, hit Enter.
2. Quit the app (`⌘Q`).
3. Run: `cat ~/Library/Application\ Support/Blanc/session.json | grep -o '"pinned":\[[^]]*\]'` — expect to see `true` in the array at the same index as that tab's URL in `"urls"`.
4. Relaunch (`npm start`). Confirm the app doesn't crash and the tab reopens (visual pinned-shelf treatment isn't built yet — that's Task 6/7).
5. Open `https://www.youtube.com` (or any page with audio), play a video, press `⌘L`, type `/mute`, hit Enter — confirm audio stops. Type `/mute` again — confirm audio resumes.
6. Quit and relaunch again — confirm the tab is NOT muted on restart (audio would play again if you hit play), matching the "mute does not persist" rule.

- [ ] **Step 10: Commit**

```bash
git add src/main/main.js src/main/preload.js src/renderer/overlay.js
git commit -m "$(cat <<'EOF'
Add pinned/muted tab state, persistence, and slash commands

Pinned persists in session.json like groupId; muted resets on
relaunch, matching Chrome/Safari (it rides a live audio session,
not a saved preference). No UI yet — that lands in later tasks.
EOF
)"
```

---

## Task 2: Duplicate Tab — function, IPC, native menu item

**Files:**
- Modify: `src/main/main.js` (new `duplicateTab` function, placed right after `toggleTabMuted` from Task 1)
- Modify: `src/main/main.js:1140-1148` (one new `ipcMain.handle` line)
- Modify: `src/main/main.js:1257-1270` (existing `Tabs` submenu template — insert one item)
- Modify: `src/main/preload.js` (one new `browserAPI` method)

**Interfaces:**
- Consumes: `createTab`, `reorderTab`, `tabOrder` (all existing, from `src/main/main.js`).
- Produces: `duplicateTab(id: string): string | undefined` — returns the new tab's id. Consumed by Task 4's dynamic-list wiring is not required (this is a standalone action), but Task 4 will replace this same menu item's surrounding template wholesale, so its exact position matters — see Step 3.

- [ ] **Step 1: Add `duplicateTab`**

Immediately after `toggleTabMuted` (added in Task 1, Step 5), add:
```js
function duplicateTab(id) {
  const source = tabs.get(id);
  if (!source) return;
  const insertAt = tabOrder.indexOf(id) + 1;
  const newId = createTab(source.url, { private: source.private, groupId: source.groupId, pinned: source.pinned });
  reorderTab(newId, insertAt);
  return newId;
}
```

- [ ] **Step 2: Wire up IPC**

Find:
```js
  ipcMain.handle('tabs:toggle-muted', (_e, id) => toggleTabMuted(id));
```
Replace with:
```js
  ipcMain.handle('tabs:toggle-muted', (_e, id) => toggleTabMuted(id));
  ipcMain.handle('tabs:duplicate', (_e, id) => duplicateTab(id));
```

- [ ] **Step 3: Add the native menu item**

Find the current `Tabs` submenu in `buildMenu()`:
```js
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => cycleTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycleTab(-1) },
        { type: 'separator' },
        // "Tab or Group": with groups these jump to the nth pill cluster.
        ...Array.from({ length: 9 }, (_, i) => ({
          label: i === 8 ? 'Last Tab or Group' : `Tab or Group ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => selectTabAtIndex(i),
        })),
      ],
    },
```
Replace with:
```js
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => cycleTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycleTab(-1) },
        { type: 'separator' },
        { label: 'Duplicate Tab', enabled: !!activeTabId, click: () => activeTabId && duplicateTab(activeTabId) },
        { type: 'separator' },
        // "Tab or Group": with groups these jump to the nth pill cluster.
        ...Array.from({ length: 9 }, (_, i) => ({
          label: i === 8 ? 'Last Tab or Group' : `Tab or Group ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => selectTabAtIndex(i),
        })),
      ],
    },
```
(This is a temporary placement — Task 4 replaces this whole submenu block again to add Pin/Mute/groups/the dynamic list. Getting Duplicate Tab working and independently testable now, before that larger rewrite, keeps this task's deliverable self-contained.)

- [ ] **Step 4: Expose on `browserAPI`**

In `src/main/preload.js`, find:
```js
  toggleTabMuted: (id) => ipcRenderer.invoke('tabs:toggle-muted', id),
```
Replace with:
```js
  toggleTabMuted: (id) => ipcRenderer.invoke('tabs:toggle-muted', id),
  duplicateTab: (id) => ipcRenderer.invoke('tabs:duplicate', id),
```

- [ ] **Step 5: Verify**

Run `npm start`. Open a tab, put it in a group via `/group work`, pin it via `/pin`. Open the **Tabs** menu → **Duplicate Tab**. Confirm: a new tab appears immediately to the right of the source tab (check tab order via `⌘⌥→`/`⌃⇥` cycling or the pill dots), same URL, same group (check the `group` chip in the panel row switcher), and (via `session.json` after quitting, same as Task 1 Step 9) the duplicate is also pinned.

- [ ] **Step 6: Commit**

```bash
git add src/main/main.js src/main/preload.js
git commit -m "$(cat <<'EOF'
Add Duplicate Tab action

Clones the source tab's URL, group, and pinned state into a new
tab inserted immediately after it — standard browser convention.
EOF
)"
```

---

## Task 3: Menu-rebuild coalescing

**Files:**
- Modify: `src/main/main.js:428-434` (`broadcastTabs`)

**Interfaces:**
- Produces: `scheduleMenuRebuild(): void` — debounced wrapper around `buildMenu()`, called from `broadcastTabs()`. Tasks 4 and 5 depend on the native menu being rebuilt automatically whenever tab/bookmark/group state changes; this task is what makes that safe to do without a rebuild storm.

**Why this is safe:** every mutation that should be reflected in the menu (tab created/closed/activated/reordered/regrouped, bookmark toggled, pin/mute toggled) already flows through `broadcastTabs()` — including high-frequency events like `page-title-updated` and `page-favicon-updated` that fire repeatedly during a single page load. `persistSession()` already runs unconditionally at the top of `broadcastTabs()` despite this; hanging a debounced menu rebuild off the same choke point reuses that exact, already-proven pattern (mirrors `scheduleBroadcastTabs`'s own 100ms coalescing further up in the same file) instead of threading new calls into a dozen separate mutation functions.

- [ ] **Step 1: Add the debounced rebuild and hook it into `broadcastTabs`**

Find:
```js
function broadcastTabs() {
  persistSession();
  if (!win || win.isDestroyed()) return;
  const payload = { tabs: serializeTabs(), activeTabId, groups };
  win.webContents.send('tabs:updated', payload);
  overlayView?.webContents.send('tabs:updated', payload);
}
```
Replace with:
```js
function broadcastTabs() {
  persistSession();
  scheduleMenuRebuild();
  if (!win || win.isDestroyed()) return;
  const payload = { tabs: serializeTabs(), activeTabId, groups };
  win.webContents.send('tabs:updated', payload);
  overlayView?.webContents.send('tabs:updated', payload);
}

// The native menu's dynamic content (tab list, favorites list, Pin/Mute/
// Add-to-Favorites labels) must stay live, but broadcastTabs() itself fires
// at up to ~10/s during a page load — rebuilding the native menu that often
// would be wasted work and can visibly flicker an open menu. Coalesce to
// one rebuild per 100ms, same window as scheduleBroadcastTabs above.
let menuRebuildTimer = null;
function scheduleMenuRebuild() {
  if (menuRebuildTimer) return;
  menuRebuildTimer = setTimeout(() => {
    menuRebuildTimer = null;
    buildMenu();
  }, 100);
}
```

- [ ] **Step 2: Verify no flicker and no crash on rapid updates**

Run `npm start`. Navigate to a heavy page (e.g. `https://www.wikipedia.org`) so `page-title-updated`/`page-favicon-updated` fire several times in quick succession. While it's loading, click and hold open the **Tabs** menu from the menu bar. Confirm the menu stays open, responsive, and doesn't flicker or auto-dismiss. Confirm the app doesn't crash or log errors to the terminal running `npm start`.

- [ ] **Step 3: Commit**

```bash
git add src/main/main.js
git commit -m "$(cat <<'EOF'
Coalesce native menu rebuilds to 100ms, off the broadcastTabs choke point

Prepares buildMenu() to be called on every real state change (next
tasks add a dynamic tab list, dynamic favorites list, and dynamic
labels) without rebuilding at the ~10/s rate broadcastTabs already
runs at during page loads.
EOF
)"
```

---

## Task 4: Native Tabs menu — full rewrite

**Files:**
- Modify: `src/main/main.js:572-581` (`clusterList` — exclude pinned tabs)
- Modify: `src/main/main.js:1257-1273` (the `Tabs` submenu template, this time the full rewrite — replaces Task 2's interim version)

**Interfaces:**
- Consumes: `toggleTabPinned`, `toggleTabMuted`, `duplicateTab` (Task 1/2), `scheduleMenuRebuild` via `broadcastTabs` (Task 3), `setTabGroup`, `groupTabByName`, `closeGroup` (existing), `showOverlay` (existing, extended below with an optional `prefill` param).
- Produces: `clusterList()` no longer includes pinned tabs in any group's `tabIds` or the loose list — consumed by Task 6 (pill) and Task 7 (panel row), which apply the identical exclusion to their own `clusterTabs()` copies.

- [ ] **Step 1: Exclude pinned tabs from `clusterList()`**

Find:
```js
function clusterList() {
  const list = [];
  for (const g of groups) {
    const tabIds = tabOrder.filter((id) => tabs.get(id)?.groupId === g.id);
    if (tabIds.length) list.push({ group: g, tabIds });
  }
  const loose = tabOrder.filter((id) => tabs.get(id) && !tabs.get(id).groupId);
  if (loose.length) list.push({ group: null, tabIds: loose });
  return list;
}
```
Replace with:
```js
function clusterList() {
  const list = [];
  for (const g of groups) {
    const tabIds = tabOrder.filter((id) => tabs.get(id)?.groupId === g.id && !tabs.get(id)?.pinned);
    if (tabIds.length) list.push({ group: g, tabIds });
  }
  const loose = tabOrder.filter((id) => tabs.get(id) && !tabs.get(id).groupId && !tabs.get(id).pinned);
  if (loose.length) list.push({ group: null, tabIds: loose });
  return list;
}
```
This keeps `⌘1`–`⌘9` ("Tab or Group N") behavior unchanged — they still jump between group/ungrouped clusters, just no longer counting a pinned tab as part of whichever cluster it happens to belong to. Pinned tabs remain reachable via `⌃⇥`/`⌃⇧⇥` (Next/Previous Tab, unaffected by this function) and the new dynamic list below.

- [ ] **Step 2: Add an optional prefill to `showOverlay`, so "New Group…" can open the command bar pre-typed**

Find:
```js
function showOverlay(mode) {
  if (!hasLiveWindow() || !overlayView) return;
  overlayMode = mode;
  // (Re-)adding moves the overlay to the top of the child-view stack.
  win.contentView.addChildView(overlayView);
  overlayView.setBounds(overlayBounds());
  overlayView.webContents.send('overlay:show', { mode });
  overlayView.webContents.focus();
  win.webContents.send('chrome:island-state', { mode });
}
```
Replace with:
```js
function showOverlay(mode, { prefill } = {}) {
  if (!hasLiveWindow() || !overlayView) return;
  overlayMode = mode;
  // (Re-)adding moves the overlay to the top of the child-view stack.
  win.contentView.addChildView(overlayView);
  overlayView.setBounds(overlayBounds());
  overlayView.webContents.send('overlay:show', { mode, prefill });
  overlayView.webContents.focus();
  win.webContents.send('chrome:island-state', { mode });
}
```

- [ ] **Step 3: Handle `prefill` in the overlay renderer**

In `src/renderer/overlay.js`, find:
```js
  window.browserAPI.onOverlayShow(({ mode: next }) => applyMode(next));
```
Replace with:
```js
  window.browserAPI.onOverlayShow(({ mode: next, prefill }) => applyMode(next, prefill));
```

Then find `applyMode`:
```js
  function applyMode(next) {
    const reshow = mode === next;
    mode = next;
    document.body.dataset.mode = next ?? '';
    backdrop.hidden = next !== 'panel' && next !== 'palette';
    panelAnchor.hidden = next !== 'panel' && next !== 'palette';
    findBar.hidden = next !== 'find';

    if (next === 'panel' || next === 'palette') {
      if (!reshow) pickingTabId = null;
      refreshSwitcherData();
      renderPanel();
      // A reassert (main re-focusing the same open panel) must not clobber
      // what the user already typed.
      if (!reshow || !inputTouched) {
        inputTouched = false;
        addressInput.value = addressDisplayValue(activeTab());
      }
      addressInput.focus();
      addressInput.select();
    } else if (next === 'find') {
      findInput.focus();
      findInput.select();
    }
  }
```
Replace with:
```js
  function applyMode(next, prefill) {
    const reshow = mode === next;
    mode = next;
    document.body.dataset.mode = next ?? '';
    backdrop.hidden = next !== 'panel' && next !== 'palette';
    panelAnchor.hidden = next !== 'panel' && next !== 'palette';
    findBar.hidden = next !== 'find';

    if (next === 'panel' || next === 'palette') {
      if (!reshow) pickingTabId = null;
      refreshSwitcherData();
      renderPanel();
      if (prefill) {
        // A menu-triggered command (e.g. "New Group…") arrives pre-typed —
        // land the cursor at the end, ready to type the rest, rather than
        // selecting the whole string the way a fresh open does below.
        inputTouched = true;
        addressInput.value = prefill;
        renderList();
      } else if (!reshow || !inputTouched) {
        // A reassert (main re-focusing the same open panel) must not
        // clobber what the user already typed.
        inputTouched = false;
        addressInput.value = addressDisplayValue(activeTab());
      }
      addressInput.focus();
      if (prefill) addressInput.setSelectionRange(prefill.length, prefill.length);
      else addressInput.select();
    } else if (next === 'find') {
      findInput.focus();
      findInput.select();
    }
  }
```

- [ ] **Step 4: Add a helper to build the dynamic tab list**

Immediately before `function buildMenu() {`, add:
```js
/** Native-menu items for every open tab, ordered pinned-first then by
 * cluster (matching the pill and panel switcher). Clicking jumps to it. */
function tabMenuItems() {
  const pinnedIds = tabOrder.filter((id) => tabs.get(id)?.pinned);
  const orderedIds = [...pinnedIds, ...clusterList().flatMap((c) => c.tabIds)];
  return orderedIds.map((id) => {
    const tab = tabs.get(id);
    const group = tab.groupId ? groups.find((g) => g.id === tab.groupId) : null;
    let domain = tab.url;
    try {
      domain = new URL(tab.url).hostname || tab.url;
    } catch {
      /* not a parseable URL (blank tab, blanc:// page) — show it as-is */
    }
    const label = `${tab.title || 'New Tab'} — ${domain}${group ? ` (${group.name})` : ''}`;
    return {
      label: label.length > 120 ? `${label.slice(0, 119)}…` : label,
      type: 'checkbox',
      checked: id === activeTabId,
      click: () => setActiveTab(id),
    };
  });
}
```

- [ ] **Step 5: Replace the `Tabs` submenu template**

Find (this is Task 2's interim version):
```js
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => cycleTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycleTab(-1) },
        { type: 'separator' },
        { label: 'Duplicate Tab', enabled: !!activeTabId, click: () => activeTabId && duplicateTab(activeTabId) },
        { type: 'separator' },
        // "Tab or Group": with groups these jump to the nth pill cluster.
        ...Array.from({ length: 9 }, (_, i) => ({
          label: i === 8 ? 'Last Tab or Group' : `Tab or Group ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => selectTabAtIndex(i),
        })),
      ],
    },
```
Replace with:
```js
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => cycleTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycleTab(-1) },
        { type: 'separator' },
        { label: 'Duplicate Tab', enabled: !!activeTabId, click: () => activeTabId && duplicateTab(activeTabId) },
        { label: tabs.get(activeTabId)?.pinned ? 'Unpin Tab' : 'Pin Tab', enabled: !!activeTabId, click: () => activeTabId && toggleTabPinned(activeTabId) },
        { label: tabs.get(activeTabId)?.muted ? 'Unmute Tab' : 'Mute Tab', enabled: !!activeTabId, click: () => activeTabId && toggleTabMuted(activeTabId) },
        { type: 'separator' },
        {
          label: 'New Group…',
          enabled: !!activeTabId,
          click: () => { if (hasLiveWindow()) { win.focus(); showOverlay('palette', { prefill: '/group ' }); } },
        },
        {
          label: 'Ungroup Tab',
          enabled: !!tabs.get(activeTabId)?.groupId,
          click: () => activeTabId && setTabGroup(activeTabId, null),
        },
        {
          label: 'Close Group',
          enabled: !!tabs.get(activeTabId)?.groupId,
          click: () => {
            const groupId = tabs.get(activeTabId)?.groupId;
            if (groupId) closeGroup(groupId);
          },
        },
        { type: 'separator' },
        // "Tab or Group": with groups these jump to the nth pill cluster.
        ...Array.from({ length: 9 }, (_, i) => ({
          label: i === 8 ? 'Last Tab or Group' : `Tab or Group ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => selectTabAtIndex(i),
        })),
        { type: 'separator' },
        ...tabMenuItems(),
      ],
    },
```

- [ ] **Step 6: Verify**

Run `npm start`.
1. Open 3-4 tabs; put two in a group via `/group work`; pin one of them via `/pin`.
2. Open the **Tabs** menu. Confirm: **Pin Tab**/**Unpin Tab** and **Mute Tab**/**Unmute Tab** labels match the active tab's actual state (switch active tabs and reopen the menu to confirm the label updates); the bottom of the menu lists every open tab as `Title — domain (group name)`, pinned tab listed first with no group suffix issue, a checkmark on whichever is active.
3. Click a non-active tab in that dynamic list — confirm it becomes the active tab (pill highlights it, page content switches).
4. **New Group…** → confirm the command bar opens with `/group ` already typed and the cursor at the end; type a name and press Enter — confirm the active tab joins that group (same as typing the whole command manually).
5. With a grouped tab active, **Ungroup Tab** → confirm it leaves the group; **Close Group** on a still-grouped tab → confirm every tab in that group closes.
6. Deactivate context (no tabs, if reachable, or just confirm disabled items gray out): active tab with no group → confirm **Ungroup Tab** and **Close Group** are disabled (grayed out).

- [ ] **Step 7: Commit**

```bash
git add src/main/main.js src/renderer/overlay.js
git commit -m "$(cat <<'EOF'
Rewrite native Tabs menu: pin/mute labels, group actions, dynamic tab list

Surfaces existing group functionality (previously slash-command-only)
and the new pin/mute/duplicate actions natively. The dynamic tab list
mirrors the pill's pinned-then-clustered order.
EOF
)"
```

---

## Task 5: Native Favorites menu — full rewrite

**Files:**
- Modify: `src/main/main.js` (new `addAllTabsToFavorites` function, placed right after `toggleBookmarkForActiveTab`)
- Modify: `src/main/main.js:1271-1278` (the `Favorites` submenu template)

**Interfaces:**
- Consumes: `bookmarks.listBookmarks()`, `bookmarks.isBookmarked()`, `bookmarks.toggleBookmark()` (existing, `src/main/bookmarks.js` — unmodified), `createTab`, `setActiveTab`, `toggleBookmarkForActiveTab` (existing).
- Produces: `addAllTabsToFavorites(): void` — no return value needed; callers just observe the resulting `tabs:updated`/menu rebuild.

- [ ] **Step 1: Add `addAllTabsToFavorites`**

Immediately after the existing `toggleBookmarkForActiveTab` function, add:
```js
/** "Add All Open Tabs to Favorites" — mirrors toggleBookmarkForActiveTab's
 * own URL guard. Skips private tabs (favorites never populate from private
 * browsing) and anything already favorited (idempotent). */
function addAllTabsToFavorites() {
  for (const id of tabOrder) {
    const tab = tabs.get(id);
    if (!tab || tab.private) continue;
    if (!/^https?:\/\//.test(tab.url)) continue;
    if (bookmarks.isBookmarked(tab.url)) continue;
    tab.bookmarked = bookmarks.toggleBookmark(tab.url, tab.title);
  }
  broadcastTabs();
}
```

- [ ] **Step 2: Add a helper to build the dynamic favorites list**

Immediately before `function buildMenu() {`, add (alongside `tabMenuItems` from Task 4):
```js
/** Native-menu items for the most-recently-added favorites, newest first. */
function favoritesMenuItems() {
  const all = bookmarks.listBookmarks(); // oldest-first
  return all.slice(-20).reverse().map((b) => ({
    label: (b.title || b.url).length > 120 ? `${(b.title || b.url).slice(0, 119)}…` : (b.title || b.url),
    click: () => setActiveTab(createTab(b.url)),
  }));
}
```

- [ ] **Step 3: Replace the `Favorites` submenu template**

Find:
```js
    {
      label: 'Favorites',
      submenu: [
        { label: 'Add to Favorites', accelerator: 'CmdOrCtrl+D', click: toggleBookmarkForActiveTab },
        { label: 'Show Favorites', accelerator: isMac ? 'Cmd+Alt+B' : 'Ctrl+Shift+O', click: () => openInternalPage('blanc://bookmarks/') },
        { label: 'Show History', accelerator: 'CmdOrCtrl+Y', click: () => openInternalPage('blanc://history/') },
      ],
    },
```
Replace with:
```js
    {
      label: 'Favorites',
      submenu: [
        {
          label: tabs.get(activeTabId)?.bookmarked ? 'Remove from Favorites' : 'Add to Favorites',
          accelerator: 'CmdOrCtrl+D',
          enabled: !!activeTabId,
          click: toggleBookmarkForActiveTab,
        },
        {
          label: 'Add All Open Tabs to Favorites',
          enabled: tabOrder.some((id) => tabs.get(id) && !tabs.get(id).private),
          click: addAllTabsToFavorites,
        },
        { type: 'separator' },
        ...favoritesMenuItems(),
        ...(bookmarks.listBookmarks().length > 20
          ? [{ label: 'Show All Favorites…', click: () => openInternalPage('blanc://bookmarks/') }]
          : []),
        { type: 'separator' },
        { label: 'Show Favorites', accelerator: isMac ? 'Cmd+Alt+B' : 'Ctrl+Shift+O', click: () => openInternalPage('blanc://bookmarks/') },
        { label: 'Show History', accelerator: 'CmdOrCtrl+Y', click: () => openInternalPage('blanc://history/') },
      ],
    },
```

- [ ] **Step 4: Verify**

Run `npm start`.
1. Open a tab to a page not yet favorited. Open **Favorites** menu — confirm it reads "Add to Favorites". Click it. Reopen the menu — confirm it now reads "Remove from Favorites" and the page appears at the top of the dynamic list.
2. Open two more tabs (one to a URL already favorited, one to a new URL) plus one private tab (`⌘⇧N`) to any page. Click **Add All Open Tabs to Favorites**. Open `blanc://bookmarks/` — confirm exactly one new favorite was added (the new URL), the already-favorited one wasn't duplicated, and the private tab's URL is absent.
3. Manually add (via the address bar + `⌘D`) more favorites until there are more than 20 total. Reopen the **Favorites** menu — confirm the dynamic list shows only 20 entries (newest first) and a **Show All Favorites…** item appears below it; click it and confirm `blanc://bookmarks/` opens.
4. Click any favorite in the dynamic list — confirm it opens in a new tab.

- [ ] **Step 5: Commit**

```bash
git add src/main/main.js
git commit -m "$(cat <<'EOF'
Rewrite native Favorites menu: dynamic label, bulk add, dynamic list

Add to Favorites now flips to "Remove from Favorites" based on the
active tab's actual bookmark state, and the menu lists real favorites
(capped at 20, newest first) instead of only static actions.
EOF
)"
```

---

## Task 6: Pill — pinned shelf capsule

**Files:**
- Modify: `src/renderer/renderer.js` (`clusterTabs` — exclude pinned tabs; `render` — add the pinned shelf)
- Modify: `src/renderer/styles.css` (new `.pinned-shelf` rule)

**Interfaces:**
- Consumes: `state.tabs[].pinned` (already present in every `tabs:updated` payload as of Task 1), `tabDot(t)` (existing).

- [ ] **Step 1: Exclude pinned tabs from `clusterTabs()`**

In `src/renderer/renderer.js`, find:
```js
  function clusterTabs() {
    const clusters = [];
    for (const g of state.groups) {
      const gtabs = state.tabs.filter((t) => t.groupId === g.id);
      if (gtabs.length) clusters.push({ group: g, tabs: gtabs });
    }
    const loose = state.tabs.filter((t) => !t.groupId);
    if (loose.length) clusters.push({ group: null, tabs: loose });
    return clusters;
  }
```
Replace with:
```js
  function clusterTabs() {
    const clusters = [];
    for (const g of state.groups) {
      const gtabs = state.tabs.filter((t) => t.groupId === g.id && !t.pinned);
      if (gtabs.length) clusters.push({ group: g, tabs: gtabs });
    }
    const loose = state.tabs.filter((t) => !t.groupId && !t.pinned);
    if (loose.length) clusters.push({ group: null, tabs: loose });
    return clusters;
  }
```

- [ ] **Step 2: Render the pinned shelf capsule**

Find:
```js
  function render() {
    const tab = activeTab();

    const clusters = clusterTabs();
    pillDots.replaceChildren(
      ...clusters.map(({ group, tabs: gtabs }) => {
```
Replace with:
```js
  function render() {
    const tab = activeTab();

    const pinnedTabs = state.tabs.filter((t) => t.pinned);
    const pinnedShelf = document.createElement('span');
    pinnedShelf.className = 'pill-cluster pinned-shelf';
    pinnedShelf.title = `${pinnedTabs.length} pinned ${pinnedTabs.length === 1 ? 'tab' : 'tabs'}`;
    pinnedShelf.append(...pinnedTabs.map(tabDot));

    const clusters = clusterTabs();
    pillDots.replaceChildren(
      ...(pinnedTabs.length ? [pinnedShelf] : []),
      ...clusters.map(({ group, tabs: gtabs }) => {
```
(Leave everything from the `const isActiveCluster = ...` line through the end of the existing `.map()` callback and its closing `);` untouched — only the two lines shown above change.)

- [ ] **Step 3: Add the `.pinned-shelf` style**

In `src/renderer/styles.css`, find:
```css
.pill-cluster.folded {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 6px;
  cursor: pointer;
}
.pill-cluster.folded:hover { border-color: var(--accent); }
```
Add immediately after it:
```css
/* Pinned tabs get their own bordered capsule at the very start of the
   dot list, always unfolded — same visual language as .folded above, but
   individual dots stay clickable (no click-to-jump on the capsule itself). */
.pill-cluster.pinned-shelf {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 6px;
}
```

- [ ] **Step 4: Verify**

Fresh `npm start` (chrome documents load once — a plain reload won't pick this up).
1. Open 3 tabs, put two in a group via `/group work`, pin the third via `/pin`.
2. Confirm the pill shows: a bordered capsule containing the pinned tab's dot, first; then the "work" group's cluster; the pinned tab's dot must NOT also appear inside the group cluster even if you pin a tab that's also grouped (test this explicitly: `/group` the pinned tab into "work", confirm its dot appears only in the pinned-shelf capsule, not duplicated in the "work" cluster).
3. Restart the app — confirm the pinned tab is still in the shelf capsule (persistence from Task 1 showing up visually now).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/renderer.js src/renderer/styles.css
git commit -m "$(cat <<'EOF'
Add pinned shelf capsule to the pill

Pinned tabs render in their own bordered capsule at the start of the
dot list, always unfolded — same visual language as a folded group's
capsule. Excluded from their own group's cluster to avoid double
rendering.
EOF
)"
```

---

## Task 7: Panel row — pin/mute buttons, mute badge, pinned header, panel width

**Files:**
- Modify: `src/renderer/overlay.js` (`clusterTabs`, `tabRow`, `renderList`, `ICONS` — add pin/mute icons, `pinnedHeaderRow`)
- Modify: `src/renderer/styles.css` (row-pin/row-mute/row-mute-badge styles, `#islandPanel` width)

**Interfaces:**
- Consumes: `window.browserAPI.toggleTabPinned`/`toggleTabMuted` (Task 1), `state.tabs[].pinned`/`.muted` (Task 1's broadcast payload).

- [ ] **Step 1: Exclude pinned tabs from overlay.js's `clusterTabs()`**

In `src/renderer/overlay.js`, find:
```js
  function clusterTabs() {
    const clusters = [];
    for (const g of state.groups) {
      const gtabs = state.tabs.filter((t) => t.groupId === g.id);
      if (gtabs.length) clusters.push({ group: g, tabs: gtabs });
    }
    const loose = state.tabs.filter((t) => !t.groupId);
    if (loose.length) clusters.push({ group: null, tabs: loose });
    return clusters;
  }
```
Replace with:
```js
  function clusterTabs() {
    const clusters = [];
    for (const g of state.groups) {
      const gtabs = state.tabs.filter((t) => t.groupId === g.id && !t.pinned);
      if (gtabs.length) clusters.push({ group: g, tabs: gtabs });
    }
    const loose = state.tabs.filter((t) => !t.groupId && !t.pinned);
    if (loose.length) clusters.push({ group: null, tabs: loose });
    return clusters;
  }
```

- [ ] **Step 2: Add pin/mute icons to `ICONS`**

Find:
```js
  const ICONS = {
    reload: '<svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-5-5c1.4 0 2.74.56 3.74 1.53L13 5.78"/><path d="M13 3v2.78h-2.78"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5"/></svg>',
    plus: '<svg viewBox="0 0 16 16"><path d="M8 3.25v9.5M3.25 8h9.5"/></svg>',
  };
```
Replace with:
```js
  const ICONS = {
    reload: '<svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-5-5c1.4 0 2.74.56 3.74 1.53L13 5.78"/><path d="M13 3v2.78h-2.78"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5"/></svg>',
    plus: '<svg viewBox="0 0 16 16"><path d="M8 3.25v9.5M3.25 8h9.5"/></svg>',
    pin: '<svg viewBox="0 0 16 16"><path d="M5 3h6l-1 5 2 2v1H4v-1l2-2z"/><path d="M8 11v3"/></svg>',
    mute: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3.5v11L5 10H2z"/><path d="M11 5.5l3 5M14 5.5l-3 5"/></svg>',
  };
```

- [ ] **Step 3: Add pin/mute buttons and the mute favicon badge to `tabRow`**

Find:
```js
  function tabRow(tab) {
    const row = document.createElement('div');
    row.className = 'island-row' + (tab.id === state.activeTabId ? ' active' : '');
    row.dataset.tabId = tab.id;

    const favicon = document.createElement('span');
    setFavicon(favicon, tab);

    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = tab.isLoading ? 'Loading…' : tab.title || 'New Tab';

    const sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = tabDomain(tab);

    row.append(favicon, title, sub);
```
Replace with:
```js
  function tabRow(tab) {
    const row = document.createElement('div');
    row.className = 'island-row' + (tab.id === state.activeTabId ? ' active' : '');
    row.dataset.tabId = tab.id;

    const faviconWrap = document.createElement('span');
    faviconWrap.className = 'row-favicon-wrap';
    const favicon = document.createElement('span');
    setFavicon(favicon, tab);
    faviconWrap.append(favicon);
    if (tab.muted) {
      const muteBadge = document.createElement('span');
      muteBadge.className = 'row-mute-badge';
      muteBadge.innerHTML = ICONS.mute;
      faviconWrap.append(muteBadge);
    }

    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = tab.isLoading ? 'Loading…' : tab.title || 'New Tab';

    const sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = tabDomain(tab);

    row.append(faviconWrap, title, sub);
```

Then find (still inside `tabRow`, right before the existing `grp`/close-button block):
```js
    const grp = document.createElement('button');
    grp.className = 'row-grp';
```
Replace with:
```js
    const pin = document.createElement('button');
    pin.className = 'row-pin' + (tab.pinned ? ' on' : '');
    pin.title = tab.pinned ? 'Unpin tab' : 'Pin tab';
    pin.setAttribute('aria-label', pin.title);
    pin.innerHTML = ICONS.pin;
    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      window.browserAPI.toggleTabPinned(tab.id);
    });
    row.append(pin);

    const mute = document.createElement('button');
    mute.className = 'row-mute' + (tab.muted ? ' on' : '');
    mute.title = tab.muted ? 'Unmute tab' : 'Mute tab';
    mute.setAttribute('aria-label', mute.title);
    mute.innerHTML = ICONS.mute;
    mute.addEventListener('click', (e) => {
      e.stopPropagation();
      window.browserAPI.toggleTabMuted(tab.id);
    });
    row.append(mute);

    const grp = document.createElement('button');
    grp.className = 'row-grp';
```

- [ ] **Step 4: Add the "pinned" section header and render pinned rows first**

Find, inside `renderList()`:
```js
      const clusters = clusterTabs();
      const rows = [];
      for (const { group, tabs: gtabs } of clusters) {
        if (group) rows.push(groupHeaderRow(group, gtabs.length, clusters.findIndex((c) => c.group === group)));
        else if (clusters.length > 1) rows.push(looseHeaderRow());
        if (group?.collapsed) rows.push(foldedGroupRow(group, gtabs));
        else rows.push(...gtabs.map(tabRow));
      }
      islandList.replaceChildren(...rows, newTabRow(), newPrivateTabRow());
```
Replace with:
```js
      const pinned = state.tabs.filter((t) => t.pinned);
      const rows = [];
      if (pinned.length) {
        rows.push(pinnedHeaderRow(pinned.length));
        rows.push(...pinned.map(tabRow));
      }

      const clusters = clusterTabs();
      for (const { group, tabs: gtabs } of clusters) {
        if (group) rows.push(groupHeaderRow(group, gtabs.length, clusters.findIndex((c) => c.group === group)));
        else if (clusters.length > 1) rows.push(looseHeaderRow());
        if (group?.collapsed) rows.push(foldedGroupRow(group, gtabs));
        else rows.push(...gtabs.map(tabRow));
      }
      islandList.replaceChildren(...rows, newTabRow(), newPrivateTabRow());
```

- [ ] **Step 5: Add the `pinnedHeaderRow` function**

Immediately before `function groupHeaderRow(group, count, clusterIndex) {`, add:
```js
  /** "pinned" section header — same dim-rule visual language as a group
   * header, but static (no fold/unfold — pinned tabs are always shown). */
  function pinnedHeaderRow(count) {
    const row = document.createElement('div');
    row.className = 'island-ghead static';
    const name = document.createElement('span');
    name.className = 'ghead-name';
    name.textContent = 'pinned';
    const rule = document.createElement('span');
    rule.className = 'ghead-rule';
    const n = document.createElement('span');
    n.className = 'ghead-n';
    n.textContent = String(count);
    row.append(name, rule, n);
    return row;
  }

```

- [ ] **Step 6: Style the new row buttons, badge, and favicon wrapper**

In `src/renderer/styles.css`, find:
```css
.row-grp {
  opacity: 0;
  height: 18px;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 0 7px;
  border: 1px solid var(--border);
  color: var(--text-dim);
  flex: 0 0 auto;
}
.island-row:hover .row-grp,
.row-grp.open,
.row-grp:focus-visible { opacity: 1; }
.row-grp:hover { color: var(--accent); border-color: var(--accent); }
```
Add immediately after it:
```css
/* Pin/mute row buttons — same reserved-space/hover-reveal convention as
   .row-close: always occupy layout width, opacity-faded until hovered/
   focused, but stay visible and accent-filled (like .shield/.row-private)
   whenever the tab is actually pinned or muted. */
.row-pin,
.row-mute {
  opacity: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex: 0 0 auto;
}
.row-pin svg,
.row-mute svg { width: 12px; height: 12px; stroke-width: 1.75; }
.island-row:hover .row-pin,
.island-row:hover .row-mute,
.row-pin:focus-visible,
.row-mute:focus-visible { opacity: 1; }
.row-pin:hover,
.row-mute:hover { background: var(--border); color: var(--text); }
.row-pin.on,
.row-mute.on { opacity: 1; color: var(--accent); background: var(--accent-dim); }

.row-favicon-wrap { position: relative; flex: 0 0 auto; }
.row-mute-badge {
  position: absolute;
  bottom: -3px;
  right: -4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
}
.row-mute-badge svg { width: 7px; height: 7px; stroke-width: 2; }
```

- [ ] **Step 7: Bump the panel width**

Find:
```css
#islandPanel {
  width: 560px;
```
Replace with:
```css
#islandPanel {
  width: 620px;
```

- [ ] **Step 8: Verify**

Fresh `npm start`.
1. Open several tabs; pin one (`/pin`), mute another (`/mute`), group a third (`/group work`), and note a fourth tab that's neither.
2. Open the panel (⌘L). Confirm: a "pinned" section header appears above the pinned tab's row, separate from the "work" group header further down; the pinned tab's row shows an accent-filled pin icon persistently (no hover needed); the muted tab's row shows an accent-filled mute icon persistently AND a small badge on its favicon's corner; hovering a row with neither pinned nor muted reveals faint pin/mute icon buttons (matching the existing close/group-chip hover reveal).
3. Click the pin icon on an unpinned row — confirm it becomes pinned (row moves into the pinned section on next render, pill shelf updates too per Task 6). Click the mute icon on an unmuted row playing audio — confirm audio stops and the badge appears.
4. Visually confirm the panel doesn't feel more cramped than before: a row with title+domain+shield+group chip+pin+mute all visible should not have its title so aggressively truncated that it becomes unreadable at typical page-title lengths (~40-50 characters).
5. Resize the window very narrow — confirm the panel still fits (doesn't overflow the window) via `max-width: calc(100vw - 24px)`.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/overlay.js src/renderer/styles.css
git commit -m "$(cat <<'EOF'
Add pin/mute row buttons, mute favicon badge, pinned header, wider panel

Pin/mute follow the existing .row-close convention: reserved space,
hover-revealed by default, persistently visible when active. Panel
width grows 560px -> 620px to fully offset the two new buttons' cost
to a busy row's available title space.
EOF
)"
```
