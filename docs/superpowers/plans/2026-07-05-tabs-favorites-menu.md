# Tabs & Favorites Menu Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the macOS native menu bar's Tabs and Favorites submenus up to Safari/Chrome-style parity — dynamic tab/favorites lists, dynamic labels, group actions — and add the Pin/Mute/Duplicate tab features neither menu can surface today because they don't exist yet.

**Architecture:** All new tab state (`pinned`, `muted`) lives on the existing per-tab object in `src/main/main.js`'s `tabs` Map, following the exact shape/lifecycle of existing fields like `bookmarked`. The native menu (`buildMenu()`) is rebuilt via a debounced `scheduleMenuRebuild()`, called explicitly from each discrete state-mutating function (tab created/closed/activated/reordered/regrouped, bookmark toggled, pin/mute toggled) — **not** from `broadcastTabs()` itself, since that function is also invoked by high-frequency per-navigation events (`page-title-updated`, `page-favicon-updated`, `did-start-loading`, etc.) that fire repeatedly during a single page load and must NOT each trigger a native menu rebuild. The pill (`renderer.js`) and panel switcher list (`overlay.js`) each get a pinned-tabs section rendered separately from — and excluded from — the existing group/ungrouped clustering, mirroring the hand-synced-by-convention pattern those two files already use for `clusterTabs()`.

**Tech Stack:** Electron 43 (main process: Node/CommonJS), vanilla JS renderers (no framework), IPC via `contextBridge`/`ipcRenderer`, plain CSS custom properties.

## Global Constraints

- No test suite or linter exists in this repo — every "Verify" step below is a manual `npm start` interaction, not an automated test run. Do not add a test framework as part of this plan.
- The chrome documents (`index.html`, `overlay.html`) load once at window creation. Any step that changes `styles.css`, `overlay.js`, or `renderer.js` requires a **fresh `npm start`** to see the change — `Cmd/Ctrl+R` only reloads the active tab's web content.
- Favorites' internal identifiers stay named `bookmarks` (`bookmarks.js`, `bookmarks.json`, `isBookmarked`, etc.) — only user-facing labels/copy say "Favorites". Do not rename internals.
- No new npm dependencies. Everything here is buildable with what's already installed (Electron's `Menu`/`ipcMain`/`navigationHistory` APIs, existing `JsonStore`).
- Mute does not persist across restarts; pinned does (see spec, `docs/superpowers/specs/2026-07-05-tabs-favorites-menu-design.md`).
- The native Tabs-menu dynamic list's displayed titles reflect state as of the last discrete mutation, not the current instant — a page's title changing mid-load will not refresh the menu until some other mutation (tab created/closed/activated/etc.) happens. This is deliberate (see Task 1) and is not a bug to "fix" by hooking into the frequent per-navigation events.

---

## Task 1: Menu-rebuild coalescing

**Files:**
- Modify: `src/main/main.js:428-434` (`broadcastTabs` — unchanged; establishing this task doesn't touch it, see rationale below)
- Modify: `src/main/main.js` (new `scheduleMenuRebuild` function, placed directly above `function buildMenu() {`)
- Modify: `src/main/main.js:896-958` (`setActiveTab` — two call sites)
- Modify: `src/main/main.js:963-989` (`closeTab`)
- Modify: `src/main/main.js:1005-1012` (`reorderTab`)
- Modify: `src/main/main.js:592-601` (`setTabGroup`)
- Modify: `src/main/main.js:605-617` (`groupTabByName`)
- Modify: `src/main/main.js:1046-1051` (`toggleBookmarkForActiveTab`)
- Modify: `src/main/main.js:1054-1057` (`refreshBookmarkFlags`)
- Modify: `src/main/main.js:655-894` (`createTab` — tail)

**Interfaces:**
- Produces: `scheduleMenuRebuild(): void` — debounced (100ms) wrapper around `buildMenu()`. Every later task that adds a new state-mutating function (Task 2's `toggleTabPinned`/`toggleTabMuted`, Task 3's `duplicateTab`, Task 5's `addAllTabsToFavorites`) calls this directly at the point it's introduced.

**Why not hook this into `broadcastTabs()`:** `broadcastTabs()` is called not only from discrete actions (close/activate/reorder/etc.) but also directly from `page-title-updated`, `page-favicon-updated`, `did-start-loading`, `did-stop-loading`, `did-navigate`, and `did-navigate-in-page` handlers inside `createTab` — all of which can fire many times during a single page load. A debounced rebuild hung off `broadcastTabs()` itself would still cap out at rebuilding the native menu roughly as often as those events coalesce (up to ~10/s during a busy load), which is exactly the flicker/wasted-work outcome the spec calls out as unacceptable for a native OS menu (native menu rebuilds are heavier than the lightweight JS DOM diff `tabs:updated` triggers in the renderers). Calling `scheduleMenuRebuild()` explicitly from each discrete mutation function instead means the frequent per-navigation events never touch the menu at all.

- [ ] **Step 1: Add the debounced rebuild helper**

In `src/main/main.js`, immediately before `function buildMenu() {`, add:
```js
// The native menu's dynamic content (tab list, favorites list, Pin/Mute/
// Add-to-Favorites labels) must stay live, but must NOT rebuild at the
// high frequency page-load events (title/favicon/navigation) fire at —
// see the discrete mutation functions below, which call this explicitly.
// Debounced (not called on every invocation immediately) so several
// mutations in quick succession — e.g. closeGroup closing several tabs
// in a loop — still only rebuild once.
let menuRebuildTimer = null;
function scheduleMenuRebuild() {
  if (menuRebuildTimer) return;
  menuRebuildTimer = setTimeout(() => {
    menuRebuildTimer = null;
    buildMenu();
  }, 100);
}

```

- [ ] **Step 2: Wire it into `setActiveTab`**

Find:
```js
  // No window to attach to (quitting, or macOS with all windows closed):
  // just track the selection so window recreation attaches the right tab.
  if (!hasLiveWindow()) {
    activeTabId = id;
    return;
  }
```
Replace with:
```js
  // No window to attach to (quitting, or macOS with all windows closed):
  // just track the selection so window recreation attaches the right tab.
  // The menu bar persists on macOS even with no windows open, so it still
  // needs to reflect the new activeTabId.
  if (!hasLiveWindow()) {
    activeTabId = id;
    scheduleMenuRebuild();
    return;
  }
```

Then find the end of the same function:
```js
  if (!next.pageBg) scheduleSampleTint(next);
  broadcastTabs();
  if (shouldFocusAddress) {
```
Replace with:
```js
  if (!next.pageBg) scheduleSampleTint(next);
  broadcastTabs();
  scheduleMenuRebuild();
  if (shouldFocusAddress) {
```

- [ ] **Step 3: Wire it into `closeTab`**

Find the end of the function:
```js
    if (hasLiveWindow()) return; // setActiveTab already broadcasts
  }
  broadcastTabs();
}
```
Replace with:
```js
    if (hasLiveWindow()) return; // setActiveTab already broadcasts and schedules a menu rebuild
  }
  broadcastTabs();
  scheduleMenuRebuild();
}
```

- [ ] **Step 4: Wire it into `reorderTab`**

Find:
```js
function reorderTab(id, toIndex) {
  const from = tabOrder.indexOf(id);
  if (from === -1) return;
  const clamped = Math.max(0, Math.min(tabOrder.length - 1, toIndex));
  tabOrder.splice(from, 1);
  tabOrder.splice(clamped, 0, id);
  broadcastTabs();
}
```
Replace with:
```js
function reorderTab(id, toIndex) {
  const from = tabOrder.indexOf(id);
  if (from === -1) return;
  const clamped = Math.max(0, Math.min(tabOrder.length - 1, toIndex));
  tabOrder.splice(from, 1);
  tabOrder.splice(clamped, 0, id);
  broadcastTabs();
  scheduleMenuRebuild();
}
```

- [ ] **Step 5: Wire it into `setTabGroup` and `groupTabByName`**

Find:
```js
function setTabGroup(tabId, groupId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  // A requested group that no longer exists (a picker click racing the
  // group's dissolution) is a no-op — it must not ungroup the tab instead.
  if (groupId && !groups.some((g) => g.id === groupId)) return;
  tab.groupId = groupId || null;
  pruneEmptyGroups();
  broadcastTabs();
}
```
Replace with:
```js
function setTabGroup(tabId, groupId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  // A requested group that no longer exists (a picker click racing the
  // group's dissolution) is a no-op — it must not ungroup the tab instead.
  if (groupId && !groups.some((g) => g.id === groupId)) return;
  tab.groupId = groupId || null;
  pruneEmptyGroups();
  broadcastTabs();
  scheduleMenuRebuild();
}
```

Find:
```js
function groupTabByName(tabId, rawName) {
  const tab = tabs.get(tabId);
  const name = String(rawName ?? '').trim().toLowerCase().slice(0, 40);
  if (!tab || !name) return;
  let group = groups.find((g) => g.name === name);
  if (!group) {
    group = { id: crypto.randomUUID(), name, collapsed: false };
    groups.push(group);
  }
  tab.groupId = group.id;
  pruneEmptyGroups();
  broadcastTabs();
}
```
Replace with:
```js
function groupTabByName(tabId, rawName) {
  const tab = tabs.get(tabId);
  const name = String(rawName ?? '').trim().toLowerCase().slice(0, 40);
  if (!tab || !name) return;
  let group = groups.find((g) => g.name === name);
  if (!group) {
    group = { id: crypto.randomUUID(), name, collapsed: false };
    groups.push(group);
  }
  tab.groupId = group.id;
  pruneEmptyGroups();
  broadcastTabs();
  scheduleMenuRebuild();
}
```

- [ ] **Step 6: Wire it into `toggleBookmarkForActiveTab` and `refreshBookmarkFlags`**

Find:
```js
function toggleBookmarkForActiveTab() {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || !/^https?:\/\//.test(tab.url)) return;
  tab.bookmarked = bookmarks.toggleBookmark(tab.url, tab.title);
  broadcastTabs();
}
```
Replace with:
```js
function toggleBookmarkForActiveTab() {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || !/^https?:\/\//.test(tab.url)) return;
  tab.bookmarked = bookmarks.toggleBookmark(tab.url, tab.title);
  broadcastTabs();
  scheduleMenuRebuild();
}
```

Find:
```js
/** Bookmark state can change from the bookmarks page; re-derive per tab. */
function refreshBookmarkFlags() {
  for (const tab of tabs.values()) tab.bookmarked = bookmarks.isBookmarked(tab.url);
  broadcastTabs();
}
```
Replace with:
```js
/** Bookmark state can change from the bookmarks page; re-derive per tab. */
function refreshBookmarkFlags() {
  for (const tab of tabs.values()) tab.bookmarked = bookmarks.isBookmarked(tab.url);
  broadcastTabs();
  scheduleMenuRebuild();
}
```

- [ ] **Step 7: Wire it into `createTab`**

Find the end of the function:
```js
  if (!adopted) wc.loadURL(url).catch(() => {});
  return id;
}
```
Replace with:
```js
  if (!adopted) wc.loadURL(url).catch(() => {});
  scheduleMenuRebuild();
  return id;
}
```
(A background tab created without an immediate `setActiveTab` call — e.g. Cmd-click "Open Link in New Tab" — would otherwise not appear in the native menu's dynamic tab list, added in Task 4, until some unrelated mutation happened. `createTab` runs once per actual tab creation, not per navigation frame, so this is a discrete event, not the high-frequency case this task exists to avoid.)

- [ ] **Step 8: Verify — no rebuild storm, and menu bar keeps working**

Run `npm start`.
1. Navigate the active tab to a heavy page (e.g. `https://en.wikipedia.org`) so `page-title-updated`/`page-favicon-updated` fire several times in quick succession while it loads.
2. While it's loading, click and hold open the **Tabs** menu from the menu bar. Confirm the menu stays open, responsive, and doesn't flicker or auto-dismiss.
3. Confirm the terminal running `npm start` shows no new errors.
4. Open a second tab, switch between the two several times, close one — confirm the app behaves exactly as before (no visible change yet; this task adds no new UI, only the rebuild plumbing later tasks depend on).

- [ ] **Step 9: Commit**

```bash
git add src/main/main.js
git commit -m "$(cat <<'EOF'
Add debounced native-menu rebuild, wired into discrete mutations only

buildMenu() will become dynamic in later tasks (tab list, favorites
list, pin/mute/bookmark labels). Hooking the rebuild into each
discrete state change (create/close/activate/reorder/group/bookmark)
rather than the broadcastTabs() choke point avoids rebuilding at the
~10/s rate broadcastTabs already runs at during page loads, since
that's driven by per-navigation events unrelated to menu content.
EOF
)"
```

---

## Task 2: Pin & Mute tab-state — model, persistence, IPC, slash commands

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
- Consumes: `scheduleMenuRebuild` (Task 1).
- Produces: `toggleTabPinned(id: string): boolean` — toggles `tabs.get(id).pinned`, returns the new value. `toggleTabMuted(id: string): boolean` — toggles `tabs.get(id).muted`, calls `webContents.setAudioMuted()`, returns the new value. Both consumed by Task 4's menu wiring and Task 7's UI.
- Produces: `window.browserAPI.toggleTabPinned(id)` / `window.browserAPI.toggleTabMuted(id)` (renderer-side, return a Promise resolving to the new boolean) — consumed by Task 7's row buttons.
- Produces: every tab object serialized by `serializeTabs()` (and thus every `tabs:updated` broadcast payload) now includes `pinned: boolean` and `muted: boolean` — consumed by Task 3 (`duplicateTab` reads `source.pinned`), Task 6 (pill), and Task 7 (panel row).

- [ ] **Step 1: Update the tab model's JSDoc type**

Find:
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
  scheduleMenuRebuild();
  return tab.pinned;
}

function toggleTabMuted(id) {
  const tab = tabs.get(id);
  if (!tab) return false;
  tab.muted = !tab.muted;
  tab.view.webContents.setAudioMuted(tab.muted);
  broadcastTabs();
  scheduleMenuRebuild();
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

## Task 3: Duplicate Tab — function (with history), IPC, minimal menu item

**Files:**
- Modify: `src/main/main.js:655-894` (`createTab` — add `restoreHistory` option)
- Modify: `src/main/main.js` (new `duplicateTab` function)
- Modify: `src/main/main.js:1140-1148` (one new `ipcMain.handle` line)
- Modify: `src/main/main.js:1257-1270` (existing `Tabs` submenu template — insert one item)
- Modify: `src/main/preload.js` (one new `browserAPI` method)

**Interfaces:**
- Consumes: `createTab`, `reorderTab`, `tabOrder`, `scheduleMenuRebuild` (Task 1), `pinned` field (Task 2).
- Produces: `duplicateTab(id: string): string | undefined` — returns the new tab's id.

**On history cloning:** the spec calls for cloning the source tab's URL *and* history, matching real browser Duplicate Tab behavior. Electron's `webContents.navigationHistory.restore({ entries, index })` does this, but per Electron's docs it performs a real navigation and "it's recommended to call this API before any navigation entries are created... ideally before you call `loadURL()`" — so `createTab` needs to skip its normal `loadURL()` call and use `restore()` instead when duplicating, not call both.

- [ ] **Step 1: Let `createTab` optionally restore history instead of loading a URL**

Find:
```js
function createTab(url = newTabUrl(), { private: isPrivate = false, groupId = null, view = null, pinned = false } = {}) {
```
Replace with:
```js
function createTab(url = newTabUrl(), { private: isPrivate = false, groupId = null, view = null, pinned = false, restoreHistory = null } = {}) {
```

Find the end of the function:
```js
  if (!adopted) wc.loadURL(url).catch(() => {});
  scheduleMenuRebuild();
  return id;
}
```
Replace with:
```js
  if (!adopted) {
    // navigationHistory.restore() performs its own navigation and must be
    // the tab's first — used by duplicateTab below instead of a plain
    // loadURL when the source tab has real back/forward history to clone.
    if (restoreHistory) wc.navigationHistory.restore(restoreHistory).catch(() => {});
    else wc.loadURL(url).catch(() => {});
  }
  scheduleMenuRebuild();
  return id;
}
```

- [ ] **Step 2: Add `duplicateTab`**

Immediately after `toggleTabMuted` (added in Task 2, Step 5), add:
```js
function duplicateTab(id) {
  const source = tabs.get(id);
  if (!source) return;
  const insertAt = tabOrder.indexOf(id) + 1;
  const history = source.view.webContents.navigationHistory;
  const entries = history.getAllEntries();
  const newId = createTab(source.url, {
    private: source.private,
    groupId: source.groupId,
    pinned: source.pinned,
    // Only worth restoring if there's more than just the current page.
    restoreHistory: entries.length > 1 ? { entries, index: history.getActiveIndex() } : null,
  });
  reorderTab(newId, insertAt);
  return newId;
}
```

- [ ] **Step 3: Wire up IPC**

Find:
```js
  ipcMain.handle('tabs:toggle-muted', (_e, id) => toggleTabMuted(id));
```
Replace with:
```js
  ipcMain.handle('tabs:toggle-muted', (_e, id) => toggleTabMuted(id));
  ipcMain.handle('tabs:duplicate', (_e, id) => duplicateTab(id));
```

- [ ] **Step 4: Add the native menu item**

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

- [ ] **Step 5: Expose on `browserAPI`**

In `src/main/preload.js`, find:
```js
  toggleTabMuted: (id) => ipcRenderer.invoke('tabs:toggle-muted', id),
```
Replace with:
```js
  toggleTabMuted: (id) => ipcRenderer.invoke('tabs:toggle-muted', id),
  duplicateTab: (id) => ipcRenderer.invoke('tabs:duplicate', id),
```

- [ ] **Step 6: Verify — clone, including back/forward history**

Run `npm start`.
1. Open a tab, navigate through at least 3 different pages (e.g. `example.com` → `example.org` → `example.net`) so it has real back/forward history, put it in a group via `/group work`, pin it via `/pin`.
2. Open the **Tabs** menu → **Duplicate Tab**. Confirm: a new tab appears immediately to the right of the source tab, on the same page (`example.net`), same group (check the `group` chip in the panel row switcher), and (via `session.json` after quitting, same as Task 2 Step 9) the duplicate is also pinned.
3. On the duplicate, use **View → Back** (or the equivalent back action) twice — confirm it navigates back through `example.org` to `example.com`, proving the history was actually cloned, not just the current URL.
4. Duplicate a fresh single-page tab (no back/forward history) and confirm it still works (falls back to a plain load, no errors in the terminal).

- [ ] **Step 7: Commit**

```bash
git add src/main/main.js src/main/preload.js
git commit -m "$(cat <<'EOF'
Add Duplicate Tab action, cloning URL, back/forward history, group, and pin state

Uses navigationHistory.restore() instead of a plain loadURL when the
source tab has real history to clone, matching standard browser
Duplicate Tab behavior.
EOF
)"
```

---

## Task 4: Native Tabs menu — full rewrite

**Files:**
- Modify: `src/main/main.js:572-581` (`clusterList` — exclude pinned tabs)
- Modify: `src/main/main.js:626-636` (`focusGroup` — prefer an unpinned tab)
- Modify: `src/main/main.js:1017-1027` (`selectTabAtIndex` — fall back to raw `tabOrder` when clustering is empty)
- Modify: `src/main/main.js:261-302` (`createOverlay` — replay `prefill` on first-load)
- Modify: `src/main/main.js:304-313` (`showOverlay` — accept `prefill`)
- Modify: `src/main/main.js:1257-1273` (the `Tabs` submenu template, this time the full rewrite — replaces Task 3's interim version)
- Modify: `src/renderer/overlay.js:629-634` (`onOverlayShow` / `applyMode` — accept and act on `prefill`)

**Interfaces:**
- Consumes: `toggleTabPinned`, `toggleTabMuted`, `duplicateTab` (Task 2/3), `scheduleMenuRebuild` (Task 1), `setTabGroup`, `groupTabByName`, `closeGroup` (existing).
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

- [ ] **Step 2: Make `focusGroup` prefer an unpinned tab**

A group can still have pinned members even though `clusterList()` (Step 1) no longer counts them — a group's *only* tabs could be pinned, which excludes it from `clusterList()` entirely, but `focusGroup()` is also reachable via paths that don't go through `clusterList()` (e.g. a Quick Switcher group result). Without this fix, jumping to a group whose first tab (by `tabOrder`) happens to be pinned would activate a tab that isn't rendered as part of that group's visible cluster in the pill or panel — it shows up in the pinned shelf/section instead, which reads as a mismatch (click the "work" capsule, land somewhere that doesn't visually look like "work").

Find:
```js
function focusGroup(groupId) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  group.collapsed = false;
  const first = tabOrder.find((id) => tabs.get(id)?.groupId === groupId);
  // setActiveTab broadcasts, but no-ops when the tab is already active —
  // the unfold still has to reach the renderers.
  if (first && first !== activeTabId) setActiveTab(first);
  else broadcastTabs();
}
```
Replace with:
```js
function focusGroup(groupId) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  group.collapsed = false;
  const groupTabIds = tabOrder.filter((id) => tabs.get(id)?.groupId === groupId);
  // Prefer the first unpinned member — a pinned tab in this group renders
  // in the pinned shelf/section, not this group's own cluster, so jumping
  // to it here would look like landing in the wrong place. Only fall back
  // to a pinned one if the group has no unpinned tabs at all.
  const first = groupTabIds.find((id) => !tabs.get(id)?.pinned) ?? groupTabIds[0];
  // setActiveTab broadcasts, but no-ops when the tab is already active —
  // the unfold still has to reach the renderers.
  if (first && first !== activeTabId) setActiveTab(first);
  else broadcastTabs();
}
```

- [ ] **Step 3: Make `selectTabAtIndex` fall back to raw `tabOrder` when clustering is empty**

A group whose only tabs are all pinned makes `groups.length` truthy while `clusterList()` returns an empty array (that group's `tabIds` filters down to nothing and gets dropped). Without this fix, `Cmd+1`–`Cmd+9` would silently do nothing in that edge case instead of falling back to plain tab-index jumping.

Find:
```js
function selectTabAtIndex(index) {
  if (groups.length) {
    const cluster = clusterList()[index];
    if (!cluster) return;
    if (cluster.group) focusGroup(cluster.group.id);
    else setActiveTab(cluster.tabIds[0]);
    return;
  }
  const id = index >= 8 ? tabOrder[tabOrder.length - 1] : tabOrder[index];
  if (id) setActiveTab(id);
}
```
Replace with:
```js
function selectTabAtIndex(index) {
  const clusters = clusterList();
  if (groups.length && clusters.length) {
    const cluster = clusters[index];
    if (!cluster) return;
    if (cluster.group) focusGroup(cluster.group.id);
    else setActiveTab(cluster.tabIds[0]);
    return;
  }
  const id = index >= 8 ? tabOrder[tabOrder.length - 1] : tabOrder[index];
  if (id) setActiveTab(id);
}
```

- [ ] **Step 4: Add an optional prefill to `showOverlay`, so "New Group…" can open the command bar pre-typed**

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
  overlayPrefill = prefill ?? null;
  // (Re-)adding moves the overlay to the top of the child-view stack.
  win.contentView.addChildView(overlayView);
  overlayView.setBounds(overlayBounds());
  overlayView.webContents.send('overlay:show', { mode, prefill });
  overlayView.webContents.focus();
  win.webContents.send('chrome:island-state', { mode });
}
```

Then find, near the top of the file:
```js
/** @type {null | 'panel' | 'palette' | 'find'} */
let overlayMode = null;
```
Replace with:
```js
/** @type {null | 'panel' | 'palette' | 'find'} */
let overlayMode = null;
/** Companion to overlayMode, replayed alongside it below if the overlay's
 * first load hadn't finished when showOverlay was called. */
let overlayPrefill = null;
```

Then find, inside `createOverlay()`:
```js
  // A show requested before the overlay document finished its first load
  // would be lost — leaving an invisible view blocking clicks. Replay it.
  overlayView.webContents.once('did-finish-load', () => {
    if (overlayMode) {
      overlayView.webContents.send('overlay:show', { mode: overlayMode });
      overlayView.webContents.focus();
    }
  });
```
Replace with:
```js
  // A show requested before the overlay document finished its first load
  // would be lost — leaving an invisible view blocking clicks. Replay it.
  overlayView.webContents.once('did-finish-load', () => {
    if (overlayMode) {
      overlayView.webContents.send('overlay:show', { mode: overlayMode, prefill: overlayPrefill });
      overlayView.webContents.focus();
    }
  });
```

- [ ] **Step 5: Handle `prefill` in the overlay renderer**

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

- [ ] **Step 6: Add a helper to build the dynamic tab list**

Immediately before `function buildMenu() {`, add:
```js
/** Native-menu items for every open tab, ordered pinned-first then by
 * cluster (matching the pill and panel switcher). Clicking jumps to it.
 * Titles/domains reflect state as of the last menu rebuild, not the
 * current instant — see the Global Constraints note on this. */
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

- [ ] **Step 7: Replace the `Tabs` submenu template**

Find (this is Task 3's interim version):
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

- [ ] **Step 8: Verify**

Run `npm start`.
1. Open 3-4 tabs; put two in a group via `/group work`; pin one of them via `/pin`.
2. Open the **Tabs** menu. Confirm: **Pin Tab**/**Unpin Tab** and **Mute Tab**/**Unmute Tab** labels match the active tab's actual state (switch active tabs and reopen the menu to confirm the label updates); the bottom of the menu lists every open tab as `Title — domain (group name)`, pinned tab listed first with no group suffix issue, a checkmark on whichever is active.
3. Click a non-active tab in that dynamic list — confirm it becomes the active tab (pill highlights it, page content switches).
4. **New Group…** → confirm the command bar opens with `/group ` already typed and the cursor at the end; type a name and press Enter — confirm the active tab joins that group (same as typing the whole command manually).
5. With a grouped tab active, **Ungroup Tab** → confirm it leaves the group; **Close Group** on a still-grouped tab → confirm every tab in that group closes.
6. Active tab with no group → confirm **Ungroup Tab** and **Close Group** are disabled (grayed out).
7. Pin every tab in a group (so the group has zero unpinned members), then click that group's folded capsule in the pill (or reach it via the Quick Switcher if it's the active group and thus unfolded) — confirm `focusGroup` still lands on one of that group's tabs rather than doing nothing. With that same all-pinned-group state, confirm `Cmd+1` through `Cmd+9` still jump between actual tabs by raw order rather than silently doing nothing.

- [ ] **Step 9: Commit**

```bash
git add src/main/main.js src/renderer/overlay.js
git commit -m "$(cat <<'EOF'
Rewrite native Tabs menu: pin/mute labels, group actions, dynamic tab list

Surfaces existing group functionality (previously slash-command-only)
and the new pin/mute/duplicate actions natively. The dynamic tab list
mirrors the pill's pinned-then-clustered order. focusGroup and
selectTabAtIndex are hardened against the new pinned-exclusion in
clusterList (an all-pinned group no longer breaks group-jump or
Cmd+1-9).
EOF
)"
```

---

## Task 5: Native Favorites menu — full rewrite

**Files:**
- Modify: `src/main/main.js` (new `addAllTabsToFavorites` function, placed right after `toggleBookmarkForActiveTab`)
- Modify: `src/main/main.js:1271-1278` (the `Favorites` submenu template)

**Interfaces:**
- Consumes: `bookmarks.listBookmarks()`, `bookmarks.isBookmarked()`, `bookmarks.toggleBookmark()` (existing, `src/main/bookmarks.js` — unmodified), `createTab`, `setActiveTab`, `toggleBookmarkForActiveTab`, `scheduleMenuRebuild` (Task 1).
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
  scheduleMenuRebuild();
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
          // Same guard as toggleBookmarkForActiveTab itself — blanc://
          // pages and blank tabs can't be favorited, so don't offer to.
          enabled: /^https?:\/\//.test(tabs.get(activeTabId)?.url ?? ''),
          click: toggleBookmarkForActiveTab,
        },
        {
          label: 'Add All Open Tabs to Favorites',
          enabled: tabOrder.some((id) => tabs.get(id) && !tabs.get(id).private && /^https?:\/\//.test(tabs.get(id).url)),
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
1. Open a tab to a page not yet favorited. Open **Favorites** menu — confirm it reads "Add to Favorites" and is enabled. Click it. Reopen the menu — confirm it now reads "Remove from Favorites" and the page appears at the top of the dynamic list.
2. Navigate the active tab to `blanc://settings/` — reopen **Favorites** — confirm "Add to Favorites"/"Remove from Favorites" is grayed out (disabled), since internal pages aren't favoritable.
3. Open two more tabs (one to a URL already favorited, one to a new URL) plus one private tab (`⌘⇧N`) to any page. Click **Add All Open Tabs to Favorites**. Open `blanc://bookmarks/` — confirm exactly one new favorite was added (the new URL), the already-favorited one wasn't duplicated, and the private tab's URL is absent.
4. Manually add (via the address bar + `⌘D`) more favorites until there are more than 20 total. Reopen the **Favorites** menu — confirm the dynamic list shows only 20 entries (newest first) and a **Show All Favorites…** item appears below it; click it and confirm `blanc://bookmarks/` opens.
5. Click any favorite in the dynamic list — confirm it opens in a new tab.

- [ ] **Step 5: Commit**

```bash
git add src/main/main.js
git commit -m "$(cat <<'EOF'
Rewrite native Favorites menu: dynamic label, bulk add, dynamic list

Add to Favorites now flips to "Remove from Favorites" based on the
active tab's actual bookmark state (and disables on non-favoritable
pages, matching the panel heart button's own guard), and the menu
lists real favorites (capped at 20, newest first) instead of only
static actions.
EOF
)"
```

---

## Task 6: Pill — pinned shelf capsule

**Files:**
- Modify: `src/renderer/renderer.js` (`clusterTabs` — exclude pinned tabs; `render` — add the pinned shelf)
- Modify: `src/renderer/styles.css` (new `.pinned-shelf` rule)

**Interfaces:**
- Consumes: `state.tabs[].pinned` (already present in every `tabs:updated` payload as of Task 2), `tabDot(t)` (existing).

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
3. Restart the app — confirm the pinned tab is still in the shelf capsule (persistence from Task 2 showing up visually now).

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
- Consumes: `window.browserAPI.toggleTabPinned`/`toggleTabMuted` (Task 2), `state.tabs[].pinned`/`.muted` (Task 2's broadcast payload).

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
/* .row-mute-badge's svg is inside a <span>, not a <button>, so it does
   NOT inherit the global `button svg { fill: none; stroke: currentColor;
   ... }` rule — set the same properties explicitly here, or it renders
   as a filled black shape instead of a stroked icon. */
.row-mute-badge svg {
  width: 7px;
  height: 7px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
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
2. Open the panel (⌘L). Confirm: a "pinned" section header appears above the pinned tab's row, separate from the "work" group header further down; the pinned tab's row shows an accent-filled pin icon persistently (no hover needed); the muted tab's row shows an accent-filled mute icon persistently AND a small badge on its favicon's corner, rendered as a clean stroked icon (not a filled black blob); hovering a row with neither pinned nor muted reveals faint pin/mute icon buttons (matching the existing close/group-chip hover reveal).
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
to a busy row's available title space. Mute favicon badge gets
explicit stroke/fill styling since its svg isn't inside a <button>
and doesn't inherit the global icon rule.
EOF
)"
```
