const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { setupAdBlocker, setAdBlockEnabled, getBlocker } = require('./adblock');
const { createExtensionHost, initWebStore, listExtensions } = require('./extensions');
const { registerPagesScheme, setupPages } = require('./pages');
const { setupPermissionPolicy, setPermissionPrompter } = require('./permissions');
const { setupAutoUpdater, checkForUpdatesManually } = require('./updater');
const { setupDownloads, activeCount } = require('./downloads');
const { attachContextMenu } = require('./context-menu');
const { promptForCredentials } = require('./auth-dialog');
const settings = require('./settings');
const bookmarks = require('./bookmarks');
const history = require('./history');
const { JsonStore } = require('./store');

const NEW_TAB_URL = 'bowser://newtab/';
const newTabUrl = () => settings.getSettings().homePage || NEW_TAB_URL;

// Dev runs (`npm start`) get their own userData so a dev instance never
// shares — and corrupts — the installed app's profile: two Chromium
// browser processes writing one profile's LevelDB/extension state
// SIGSEGVs both (observed 2026-07-04, identical CrBrowserMain crashes in
// dev and installed builds within seconds of each other).
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-Dev`);
}

// One instance per profile: a second launch defers to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // Self-heal an extension-state crash loop caused by an unclean exit.
  //
  // Our extensions run with a sanitized/shimmed service worker (see
  // extensions.js). When the process exits uncleanly (crash, force-quit,
  // OOM), the profile's extension + service-worker state can be left in a
  // shape where, on the next launch, a preinstalled extension's worker
  // fails to start and electron-chrome-extensions faults inside Chromium
  // (V8 traced-reference use-after-free, SIGSEGV at 0x130) — crash-looping
  // until the state is cleared by hand. Clearing ONLY the Service Worker
  // cache is NOT enough (verified): the worker still fails to start against
  // the pre-existing extension registration. Only a full reset of the
  // extension + service-worker state — so everything re-registers cleanly,
  // like a first install — recovers reliably.
  //
  // A sentinel written on start and removed on a clean quit detects the
  // unclean case. Scoped to extension/worker dirs only: cookies, history,
  // bookmarks, downloads and settings (separate files) are untouched. The
  // preinstalled managers reinstall automatically on the next launch.
  //
  // Trade-off: a user-installed (non-preinstalled) extension would need
  // re-adding after an unclean exit. Acceptable versus a hard crash loop,
  // and unclean exits are rare with the single-instance lock and the
  // renderer-freeze fix in place. Must run before app 'ready'.
  const VOLATILE_EXTENSION_DIRS = [
    'Service Worker', 'Extensions', 'Extension State', 'Extension Scripts', 'Extension Rules',
  ];
  const runningSentinel = path.join(app.getPath('userData'), '.running');
  try {
    if (fs.existsSync(runningSentinel)) {
      for (const dir of VOLATILE_EXTENSION_DIRS) {
        fs.rmSync(path.join(app.getPath('userData'), dir), { recursive: true, force: true });
      }
    }
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(runningSentinel, String(process.pid));
  } catch (err) {
    console.warn('[recovery] extension-state sentinel handling failed:', err.message);
  }
  app.on('will-quit', () => {
    try { fs.rmSync(runningSentinel, { force: true }); } catch {}
  });
}

// Must happen before app 'ready'.
registerPagesScheme();

// Strip the app and Electron tokens from the UA so sites (and the Chrome
// Web Store in particular) treat us as a plain Chrome build.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sbowser\/[\d.]+/i, '')
  .replace(/\sElectron\/[\d.]+/, '');

/** @type {BrowserWindow | null} */
let win = null;

/** @type {import('electron-chrome-extensions').ElectronChromeExtensions | null} */
let extensionHost = null;

// Window background behind everything, matching the CSS --bg tokens so
// resizes and load flashes stay in-theme.
const chromeBackgroundColor = () => (nativeTheme.shouldUseDarkColors ? '#0e0e0e' : '#f4f4f1');

// nativeTheme.themeSource drives prefers-color-scheme in every renderer —
// chrome UI, internal pages, and the web content itself see one theme.
function applyTheme() {
  nativeTheme.themeSource = settings.getSettings().theme;
}

function findTabByWebContents(wc) {
  // During app teardown the extension host reports destroyed webContents
  // while other tabs' contents are already gone — view.webContents becomes
  // undefined then, so every access here must tolerate dead tabs.
  if (!wc || wc.isDestroyed?.()) return null;
  for (const tab of tabs.values()) {
    const tabWc = tab.view.webContents;
    if (tabWc && !tabWc.isDestroyed() && tabWc.id === wc.id) return tab;
  }
  return null;
}

const hasLiveWindow = () => !!win && !win.isDestroyed();

/** @type {Map<string, { id: string, view: WebContentsView, title: string, url: string, isLoading: boolean, canGoBack: boolean, canGoForward: boolean, favicon: string | null, bookmarked: boolean, blockedCount: number }>} */
const tabs = new Map();
/** Display order of tab ids — the single source of truth for the strip. */
let tabOrder = [];
let activeTabId = null;
const tabsWantingAddressBarFocus = new Set();

// Outstanding permission prompts awaiting the user's Allow/Block, keyed by
// prompt id → the Promise resolver. Flushed if the window dies mid-prompt
// so the underlying Chromium request never hangs.
const pendingPermissionPrompts = new Map();
function flushPermissionPrompts() {
  for (const resolve of pendingPermissionPrompts.values()) resolve(null); // null = never answered
  pendingPermissionPrompts.clear();
}

// Height (in CSS px) the renderer's chrome (title/tab row + toolbar) takes
// up. The renderer measures its own layout and reports it here, so this
// is just a sane default before the first report arrives.
let chromeHeight = 88;

function normalizeAddressInput(input) {
  const trimmed = input.trim();
  const scheme = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)?.[1]?.toLowerCase();
  if (scheme) {
    // Script-executing schemes must never be navigable from the address bar.
    if (['javascript', 'data', 'vbscript'].includes(scheme)) return settings.searchUrlFor(trimmed);
    return trimmed;
  }
  if (/^localhost(:\d+)?(\/|$)/.test(trimmed)) return `http://${trimmed}`;
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)/.test(trimmed)) return `http://${trimmed}`; // bare IPv4
  const looksLikeDomain = /^[^\s]+\.[a-zA-Z]{2,}(\/[^\s]*)?$/.test(trimmed);
  if (looksLikeDomain) return `https://${trimmed}`;
  return settings.searchUrlFor(trimmed);
}

function serializeTabs() {
  return tabOrder
    .map((id) => tabs.get(id))
    .filter(Boolean)
    .map(({ view, ...rest }) => rest);
}

// Open tabs persist across launches (restored in app.whenReady).
let sessionStore = null;
const ensureSessionStore = () => (sessionStore ??= new JsonStore('session', { urls: [], activeIndex: 0 }));

let isQuitting = false;
app.on('before-quit', () => { isQuitting = true; });

function persistSession() {
  // Teardown closes tabs one by one; saving then would erode the session
  // file down to whatever closed last before the process exits.
  if (isQuitting || tabs.size === 0) return;
  ensureSessionStore().update((d) => {
    d.urls = tabOrder
      .map((id) => {
        const url = tabs.get(id)?.url;
        // Persist the address that failed, not the error page wrapping it,
        // so the next launch retries the real destination.
        if (url?.startsWith('bowser://error')) {
          try {
            return new URL(url).searchParams.get('url') || url;
          } catch {
            return url;
          }
        }
        return url;
      })
      .filter(Boolean);
    d.activeIndex = Math.max(0, tabOrder.indexOf(activeTabId));
  });
}

function broadcastTabs() {
  persistSession();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('tabs:updated', { tabs: serializeTabs(), activeTabId });
}

// The blocked-request counter can tick many times a second during a page
// load; coalesce those into at most ~10 broadcasts/s.
let tabsBroadcastTimer = null;
function scheduleBroadcastTabs() {
  if (tabsBroadcastTimer) return;
  tabsBroadcastTimer = setTimeout(() => {
    tabsBroadcastTimer = null;
    broadcastTabs();
  }, 100);
}

function broadcastDownloads() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('downloads:updated', { activeCount: activeCount() });
}

function resizeActiveView() {
  if (!win || win.isDestroyed() || !activeTabId) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const bounds = win.getContentBounds();
  tab.view.setBounds({
    x: 0,
    y: chromeHeight,
    width: bounds.width,
    height: Math.max(0, bounds.height - chromeHeight),
  });
}

function createTab(url = newTabUrl()) {
  const id = crypto.randomUUID();
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium's built-in PDF viewer is a plugin; without this flag
      // PDFs download instead of rendering inline.
      plugins: true,
      // Exposes a data API to our own bowser:// pages ONLY — see the
      // guards in tab-preload.js and pages.js. Web content gets nothing.
      preload: path.join(__dirname, 'tab-preload.js'),
    },
  });

  const tab = {
    id,
    view,
    wcId: view.webContents.id,
    title: 'New Tab',
    url,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    favicon: null,
    bookmarked: false,
    blockedCount: 0,
  };
  tabs.set(id, tab);
  tabOrder.push(id);
  if (win) extensionHost?.addTab(view.webContents, win);

  const wc = view.webContents;
  const syncNavState = () => {
    tab.canGoBack = wc.navigationHistory.canGoBack();
    tab.canGoForward = wc.navigationHistory.canGoForward();
    tab.url = wc.getURL();
    tab.bookmarked = bookmarks.isBookmarked(tab.url);
  };

  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    history.updateTitle(tab.url, title);
    broadcastTabs();
  });
  wc.on('page-favicon-updated', (_e, favicons) => { tab.favicon = favicons[0] ?? null; broadcastTabs(); });
  wc.on('did-start-loading', () => { tab.isLoading = true; broadcastTabs(); });
  wc.on('did-stop-loading', () => { tab.isLoading = false; syncNavState(); broadcastTabs(); });
  wc.on('did-navigate', (_e, url) => {
    const shouldReclaimChromeFocus = url === tab.url && tabsWantingAddressBarFocus.has(id) && activeTabId === id;
    if (url !== tab.url) tabsWantingAddressBarFocus.delete(id);
    tab.blockedCount = 0;
    syncNavState();
    history.addVisit(url, wc.getTitle());
    broadcastTabs();
    if (shouldReclaimChromeFocus) reclaimAddressBarFocus(id);
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    syncNavState();
    if (isMainFrame) history.addVisit(url, wc.getTitle());
    broadcastTabs();
  });
  wc.once('did-finish-load', () => {
    if (shouldReclaimAddressBarFocus(id)) {
      reclaimAddressBarFocus(id, { consume: true });
    }
  });

  wc.on('focus', () => {
    if (shouldReclaimAddressBarFocus(id)) {
      reclaimAddressBarFocus(id, { consume: true });
    }
  });

  // Show a real error page instead of leaving a blank/stale view.
  // errorCode -3 (ERR_ABORTED) fires for cancelled loads (stop button,
  // rapid re-navigation) and must not be treated as a failure.
  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !validatedURL) return;
    const q = new URLSearchParams({ url: validatedURL, code: String(errorCode), desc: errorDescription });
    wc.loadURL(`bowser://error/?${q}`).catch(() => {});
  });

  // A tab whose renderer dies (OOM, GPU fault, kill -9) otherwise sits
  // blank forever; loadURL spawns a fresh renderer, so route it to the
  // error page with the original URL for one-click retry.
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    const q = new URLSearchParams({ url: tab.url, code: details.reason, desc: 'The page crashed' });
    wc.loadURL(`bowser://error/?${q}`).catch(() => {});
  });

  // A page's beforeunload can block close/navigation; surface Chrome's
  // Leave/Stay choice instead of silently refusing.
  wc.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(hasLiveWindow() ? win : undefined, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 0,
      cancelId: 1,
      message: 'Leave this page?',
      detail: 'Changes you made may not be saved.',
    });
    if (choice === 0) event.preventDefault(); // preventing the prevention lets the unload proceed
  });

  wc.on('found-in-page', (_e, result) => {
    if (id === activeTabId) {
      win.webContents.send('chrome:find-result', { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches });
    }
  });

  // Open target="_blank" / window.open() as a new managed tab instead of a
  // separate, unmanaged Electron window. Cmd/Ctrl+click arrives as
  // 'background-tab' — open it without stealing focus (browser convention).
  wc.setWindowOpenHandler(({ url: targetUrl, disposition }) => {
    const prevActiveTabId = activeTabId;
    const newId = createTab(targetUrl);
    if (disposition !== 'background-tab') {
      setActiveTab(newId);
    } else if (prevActiveTabId && activeTabId !== prevActiveTabId) {
      // createTab() -> extensionHost?.addTab() synchronously runs
      // electron-chrome-extensions' own TabsAPI.observeTab/onActivated,
      // which unconditionally activates every newly-added tab via our
      // `selectTab` delegate — racing ahead of the disposition check above.
      // Snap focus back to whatever was active before this tab was created.
      setActiveTab(prevActiveTabId);
    }
    return { action: 'deny' };
  });

  attachContextMenu(wc, {
    openBackgroundTab: (targetUrl) => createTab(targetUrl),
    openTab: (targetUrl) => setActiveTab(createTab(targetUrl)),
  });

  // Load failures surface via the did-fail-load handler above; the
  // rejected promise here is the same event and must not crash main.
  wc.loadURL(url).catch(() => {});
  return id;
}

function setActiveTab(id, { focusContent = true, focusAddress = false } = {}) {
  const next = tabs.get(id);
  if (!next) return;

  // Re-selecting the active tab must be a no-op: the extension host's
  // selectTab delegate calls back into this function, so without this
  // guard an extension-initiated tab activation recurses through
  // extensionHost.selectTab → onActivated → delegate → here until the
  // stack overflows (crashes the main process).
  if (id === activeTabId) return;

  // No window to attach to (quitting, or macOS with all windows closed):
  // just track the selection so window recreation attaches the right tab.
  if (!hasLiveWindow()) {
    activeTabId = id;
    return;
  }

  const prevId = activeTabId;
  const prev = prevId ? tabs.get(prevId) : null;
  if (prev) win.contentView.removeChildView(prev.view);

  activeTabId = id;
  if (prevId && prevId !== id) tabsWantingAddressBarFocus.delete(prevId);
  const shouldFocusAddress = focusAddress && !focusContent;
  if (shouldFocusAddress) {
    tabsWantingAddressBarFocus.add(id);
  } else {
    tabsWantingAddressBarFocus.delete(id);
    next.view.setVisible(true);
  }
  if (shouldFocusAddress) next.view.setVisible(false);
  win.contentView.addChildView(next.view);
  resizeActiveView();
  // Focusing the tab's WebContentsView gives it OS keyboard focus. For a
  // blank new tab we instead want the chrome's address bar, and OS focus
  // can be claimed asynchronously by the attached child view, so blank-tab
  // activation keeps reclaiming focus until the user navigates or switches.
  if (focusContent) next.view.webContents.focus();
  extensionHost?.selectTab(next.view.webContents);
  broadcastTabs();
  if (shouldFocusAddress) {
    reclaimAddressBarFocus(id);
    setImmediate(() => {
      if (activeTabId !== id || !tabs.has(id)) return;
      next.view.setVisible(true);
      reclaimAddressBarFocus(id);
    });
  }
}

/** URLs of recently closed tabs, oldest first (Cmd/Ctrl+Shift+T pops). */
const recentlyClosedUrls = [];

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  if (tab.url && !tab.url.startsWith('bowser://newtab')) {
    recentlyClosedUrls.push(tab.url);
    if (recentlyClosedUrls.length > 25) recentlyClosedUrls.shift();
  }

  const wasActive = id === activeTabId;
  if (wasActive && hasLiveWindow()) win.contentView.removeChildView(tab.view);

  const closedIndex = tabOrder.indexOf(id);
  tabsWantingAddressBarFocus.delete(id);
  tabs.delete(id);
  tabOrder = tabOrder.filter((tid) => tid !== id);
  const wc = tab.view.webContents;
  if (wc && !wc.isDestroyed()) wc.close();

  if (wasActive) {
    if (tabOrder.length > 0) {
      // Prefer the tab that was to the right of the closed one.
      setActiveTab(tabOrder[Math.min(closedIndex, tabOrder.length - 1)]);
    } else if (hasLiveWindow()) {
      activeTabId = null;
      setActiveTab(createTab());
    } else {
      // Quitting or window already gone — don't spawn replacement tabs.
      activeTabId = null;
    }
    if (hasLiveWindow()) return; // setActiveTab already broadcasts
  }
  broadcastTabs();
}

function reopenClosedTab() {
  const url = recentlyClosedUrls.pop();
  if (url) setActiveTab(createTab(url));
}

function reorderTab(id, toIndex) {
  const from = tabOrder.indexOf(id);
  if (from === -1) return;
  const clamped = Math.max(0, Math.min(tabOrder.length - 1, toIndex));
  tabOrder.splice(from, 1);
  tabOrder.splice(clamped, 0, id);
  broadcastTabs();
}

/** Cmd/Ctrl+1–8 jump to that tab; 9 jumps to the last (browser convention). */
function selectTabAtIndex(index) {
  const id = index >= 8 ? tabOrder[tabOrder.length - 1] : tabOrder[index];
  if (id) setActiveTab(id);
}

function cycleTab(direction) {
  if (!activeTabId || tabOrder.length < 2) return;
  const i = tabOrder.indexOf(activeTabId);
  setActiveTab(tabOrder[(i + direction + tabOrder.length) % tabOrder.length]);
}

/** Focus an existing tab already on this internal page, or open one. */
function openInternalPage(url) {
  const existing = tabOrder.find((id) => tabs.get(id)?.url.startsWith(url));
  if (existing) {
    setActiveTab(existing);
    tabs.get(existing).view.webContents.reload(); // pick up fresh data
  } else {
    setActiveTab(createTab(url));
  }
}

function toggleBookmarkForActiveTab() {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || !/^https?:\/\//.test(tab.url)) return;
  tab.bookmarked = bookmarks.toggleBookmark(tab.url, tab.title);
  broadcastTabs();
}

/** Bookmark state can change from the bookmarks page; re-derive per tab. */
function refreshBookmarkFlags() {
  for (const tab of tabs.values()) tab.bookmarked = bookmarks.isBookmarked(tab.url);
  broadcastTabs();
}

const ZOOM_STEP = 0.5;
const ZOOM_MIN = -8;
const ZOOM_MAX = 8;

function zoomActiveTab(delta) {
  const wc = tabs.get(activeTabId)?.view.webContents;
  if (!wc) return;
  const level = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, wc.getZoomLevel() + delta));
  wc.setZoomLevel(level);
}

function resetZoomForActiveTab() {
  tabs.get(activeTabId)?.view.webContents.setZoomLevel(0);
}

function openFindBar() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('chrome:open-find-bar');
}

function focusAddressBar() {
  if (!win || win.isDestroyed()) return;
  // setActiveTab() just handed OS-level keyboard focus to the tab's
  // WebContentsView; reclaim it for the chrome window's own webContents
  // before asking its renderer to focus the input, or the caret shows in
  // the DOM but keystrokes keep routing to the page.
  win.focus();
  win.blurWebView();
  win.webContents.focus();
  win.webContents.send('chrome:focus-address-bar');
}

function shouldReclaimAddressBarFocus(id) {
  return activeTabId === id && tabsWantingAddressBarFocus.has(id);
}

function reclaimAddressBarFocus(id, { consume = false } = {}) {
  if (!shouldReclaimAddressBarFocus(id)) return;
  // WebContentsView focus can settle after Electron emits focus/navigation
  // callbacks, so reassert once on the next main-process turn as well.
  focusAddressBar();
  setImmediate(() => {
    if (!shouldReclaimAddressBarFocus(id)) return;
    focusAddressBar();
    if (consume) tabsWantingAddressBarFocus.delete(id);
  });
}

function refocusAddressBarIfWanted() {
  if (activeTabId && shouldReclaimAddressBarFocus(activeTabId)) {
    reclaimAddressBarFocus(activeTabId);
  }
}

function registerIpcHandlers() {
  ipcMain.handle('tabs:create', (_e, url) => {
    const id = createTab(url || newTabUrl());
    // A blank "New Tab" (no explicit url) is a launchpad — keep OS focus on
    // the chrome so the address bar can take it. A url means the caller has
    // somewhere specific to go, so focus the page content.
    const blank = !url;
    setActiveTab(id, { focusContent: !blank, focusAddress: blank });
    return id;
  });
  ipcMain.handle('tabs:close', (_e, id) => closeTab(id));
  ipcMain.handle('tabs:switch', (_e, id) => setActiveTab(id));
  ipcMain.handle('tabs:navigate', (_e, id, url) => {
    const tab = tabs.get(id);
    if (tab) {
      tabsWantingAddressBarFocus.delete(id);
      tab.view.webContents.loadURL(normalizeAddressInput(url));
    }
  });
  ipcMain.handle('tabs:back', (_e, id) => tabs.get(id)?.view.webContents.navigationHistory.goBack());
  ipcMain.handle('tabs:forward', (_e, id) => tabs.get(id)?.view.webContents.navigationHistory.goForward());
  ipcMain.handle('tabs:reload', (_e, id) => tabs.get(id)?.view.webContents.reload());
  ipcMain.handle('tabs:stop', (_e, id) => tabs.get(id)?.view.webContents.stop());
  ipcMain.handle('tabs:reorder', (_e, id, toIndex) => reorderTab(id, toIndex));
  ipcMain.handle('tabs:toggle-bookmark', () => toggleBookmarkForActiveTab());
  ipcMain.handle('tabs:open-page', (_e, name) => {
    if (['bookmarks', 'history', 'downloads', 'settings'].includes(name)) {
      openInternalPage(`bowser://${name}/`);
    }
  });
  ipcMain.handle('tabs:get-all', () => ({ tabs: serializeTabs(), activeTabId }));
  ipcMain.handle('tabs:find', (_e, id, query, options) => tabs.get(id)?.view.webContents.findInPage(query, options));
  ipcMain.handle('tabs:find-stop', (_e, id) => tabs.get(id)?.view.webContents.stopFindInPage('clearSelection'));
  ipcMain.handle('downloads:summary', () => ({ activeCount: activeCount() }));
  ipcMain.handle('extensions:list', () => listExtensions(session.defaultSession));

  ipcMain.on('chrome:layout', (_e, { height }) => {
    if (typeof height === 'number' && height > 0) {
      chromeHeight = height;
      resizeActiveView();
    }
  });

  ipcMain.on('window:minimize', () => win?.minimize());
  ipcMain.on('window:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.on('window:close', () => win?.close());
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const appMenu = isMac
    ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { label: 'Check for Updates…', click: checkForUpdatesManually },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }]
    : [];
  const template = [
    ...appMenu,
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => setActiveTab(createTab(), { focusContent: false, focusAddress: true }) },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => activeTabId && closeTab(activeTabId) },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: reopenClosedTab },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => activeTabId && tabs.get(activeTabId)?.view.webContents.print() },
        { type: 'separator' },
        ...(isMac ? [] : [{ label: 'Check for Updates…', click: checkForUpdatesManually }, { type: 'separator' }]),
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' }, // required for copy/paste/undo to work in inputs
    {
      label: 'View',
      submenu: [
        { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: focusAddressBar },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: openFindBar },
        { label: 'Reload Tab', accelerator: 'CmdOrCtrl+R', click: () => activeTabId && tabs.get(activeTabId)?.view.webContents.reload() },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => zoomActiveTab(ZOOM_STEP) },
        // Plus requires Shift on most keyboards; Cmd/Ctrl+= is the common alternate, bound silently to the same action.
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, click: () => zoomActiveTab(ZOOM_STEP) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoomActiveTab(-ZOOM_STEP) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: resetZoomForActiveTab },
        { type: 'separator' },
        { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: () => openInternalPage('bowser://downloads/') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => openInternalPage('bowser://settings/') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => cycleTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycleTab(-1) },
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => ({
          label: i === 8 ? 'Last Tab' : `Tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => selectTabAtIndex(i),
        })),
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: toggleBookmarkForActiveTab },
        { label: 'Show Bookmarks', accelerator: isMac ? 'Cmd+Alt+B' : 'Ctrl+Shift+O', click: () => openInternalPage('bowser://bookmarks/') },
        { label: 'Show History', accelerator: 'CmdOrCtrl+Y', click: () => openInternalPage('bowser://history/') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: chromeBackgroundColor(),
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The chrome UI renders only our own local page, never web content.
      // Unsandboxed so the preload can require() the browser-action module
      // that renders extension toolbar icons/popups.
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.on('resize', resizeActiveView);
  win.on('focus', refocusAddressBarIfWanted);
  win.on('closed', () => { win = null; flushPermissionPrompts(); });

  // Tabs survive window close (macOS dock-reopen recreates the window);
  // re-attach the active tab's view or the new window sits over nothing.
  // First launch has no activeTabId yet — app.whenReady handles that one.
  win.webContents.once('did-finish-load', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return;
    const id = activeTabId;
    activeTabId = null; // force setActiveTab to treat it as a fresh attach
    setActiveTab(id);
  });
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;

  applyTheme();
  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) win.setBackgroundColor(chromeBackgroundColor());
  });

  setupPermissionPolicy(ses);
  let permissionPromptCounter = 0;
  // Resolve null when there's no window to ask through — the policy treats
  // null as "not answered" and denies for now WITHOUT persisting, so a
  // transient no-window moment can't permanently block a site.
  setPermissionPrompter(({ origin, permission, mediaTypes }) =>
    new Promise((resolve) => {
      if (!hasLiveWindow()) return resolve(null);
      const promptId = ++permissionPromptCounter;
      pendingPermissionPrompts.set(promptId, resolve);
      win.webContents.send('permissions:prompt', { id: promptId, origin, permission, mediaTypes });
    })
  );
  ipcMain.on('permissions:respond', (_e, { id, allow }) => {
    pendingPermissionPrompts.get(id)?.(!!allow);
    pendingPermissionPrompts.delete(id);
  });

  setupDownloads(ses, broadcastDownloads);
  setupPages({ onDataChanged: refreshBookmarkFlags });

  // chrome.* API host must exist before any tab is created; the delegate
  // maps extension-initiated tab actions onto our tab model.
  extensionHost = createExtensionHost(ses, {
    createTab: (details) => {
      const id = createTab(details.url || newTabUrl());
      if (details.active !== false) setActiveTab(id);
      return [tabs.get(id).view.webContents, win];
    },
    selectTab: (wc) => {
      const tab = findTabByWebContents(wc);
      if (tab) setActiveTab(tab.id);
    },
    removeTab: (wc) => {
      const tab = findTabByWebContents(wc);
      if (tab) closeTab(tab.id);
    },
  });

  await setupAdBlocker(ses, { enabled: settings.getSettings().adblockEnabled });

  // Per-tab blocked-request counter. `request.tabId` is the webContents id
  // of the frame the request came from.
  getBlocker()?.on('request-blocked', (request) => {
    for (const tab of tabs.values()) {
      if (tab.view.webContents.id === request.tabId) {
        tab.blockedCount += 1;
        scheduleBroadcastTabs();
        break;
      }
    }
  });

  settings.onSettingsChanged((s) => {
    setAdBlockEnabled(s.adblockEnabled);
    applyTheme();
  });

  // HTTP basic/digest auth: without this handler, 401-protected sites
  // (routers, staging servers) simply fail.
  app.on('login', (event, _wc, _details, authInfo, callback) => {
    event.preventDefault();
    promptForCredentials(hasLiveWindow() ? win : null, authInfo).then((creds) => {
      if (creds) callback(creds.username, creds.password);
      else callback(); // no args = cancel the request
    });
  });

  registerIpcHandlers();
  buildMenu();
  createMainWindow();

  // Restore the previous session's tabs; fall back to a single new tab.
  const saved = ensureSessionStore().data;
  const restoredIds = saved.urls.map((u) => createTab(u));
  const fresh = restoredIds.length === 0;
  const firstTabId = fresh
    ? createTab()
    : restoredIds[Math.min(Math.max(0, saved.activeIndex), restoredIds.length - 1)];
  win.webContents.once('did-finish-load', () => {
    setActiveTab(firstTabId, { focusContent: !fresh, focusAddress: fresh });
  });

  // Web store + preinstalled extensions load in the background — network
  // installs on first run shouldn't block the window.
  initWebStore(ses).catch((err) => console.warn('[extensions] web store init failed:', err.message));

  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    refocusAddressBarIfWanted();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
