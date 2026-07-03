const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, nativeTheme } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { setupAdBlocker, setAdBlockEnabled, getBlocker } = require('./adblock');
const { createExtensionHost, initWebStore } = require('./extensions');
const { registerPagesScheme, setupPages } = require('./pages');
const { setupPermissionPolicy } = require('./permissions');
const { setupAutoUpdater, checkForUpdatesManually } = require('./updater');
const { setupDownloads, activeCount } = require('./downloads');
const settings = require('./settings');
const bookmarks = require('./bookmarks');
const history = require('./history');

const NEW_TAB_URL = 'bowser://newtab/';
const newTabUrl = () => settings.getSettings().homePage || NEW_TAB_URL;

// Must happen before app 'ready'.
registerPagesScheme();

// Strip the app and Electron tokens from the UA so sites (and the Chrome
// Web Store in particular) treat us as a plain Chrome build.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sbrowser-starter\/[\d.]+/i, '')
  .replace(/\sElectron\/[\d.]+/, '');

/** @type {BrowserWindow | null} */
let win = null;

/** @type {import('electron-chrome-extensions').ElectronChromeExtensions | null} */
let extensionHost = null;

// Window background behind everything, matching the CSS --bg tokens so
// resizes and load flashes stay in-theme.
const chromeBackgroundColor = () => (nativeTheme.shouldUseDarkColors ? '#1c1b1a' : '#e9e6e0');

// nativeTheme.themeSource drives prefers-color-scheme in every renderer —
// chrome UI, internal pages, and the web content itself see one theme.
function applyTheme() {
  nativeTheme.themeSource = settings.getSettings().theme;
}

function findTabByWebContents(wc) {
  for (const tab of tabs.values()) {
    if (tab.view.webContents.id === wc.id) return tab;
  }
  return null;
}

/** @type {Map<string, { id: string, view: WebContentsView, title: string, url: string, isLoading: boolean, canGoBack: boolean, canGoForward: boolean, favicon: string | null, bookmarked: boolean, blockedCount: number }>} */
const tabs = new Map();
/** Display order of tab ids — the single source of truth for the strip. */
let tabOrder = [];
let activeTabId = null;

// Height (in CSS px) the renderer's chrome (title/tab row + toolbar) takes
// up. The renderer measures its own layout and reports it here, so this
// is just a sane default before the first report arrives.
let chromeHeight = 88;

function normalizeAddressInput(input) {
  const trimmed = input.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed; // has a scheme
  if (/^localhost(:\d+)?(\/|$)/.test(trimmed)) return `http://${trimmed}`;
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

function broadcastTabs() {
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
    tab.blockedCount = 0;
    syncNavState();
    history.addVisit(url, wc.getTitle());
    broadcastTabs();
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    syncNavState();
    if (isMainFrame) history.addVisit(url, wc.getTitle());
    broadcastTabs();
  });

  // Open target="_blank" / window.open() as a new managed tab instead of a
  // separate, unmanaged Electron window.
  wc.setWindowOpenHandler(({ url: targetUrl }) => {
    const newId = createTab(targetUrl);
    setActiveTab(newId);
    return { action: 'deny' };
  });

  wc.loadURL(url);
  return id;
}

function setActiveTab(id) {
  const next = tabs.get(id);
  if (!next) return;

  const prev = activeTabId ? tabs.get(activeTabId) : null;
  if (prev) win.contentView.removeChildView(prev.view);

  activeTabId = id;
  win.contentView.addChildView(next.view);
  resizeActiveView();
  next.view.webContents.focus();
  extensionHost?.selectTab(next.view.webContents);
  broadcastTabs();
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  const wasActive = id === activeTabId;
  if (wasActive) win.contentView.removeChildView(tab.view);

  const closedIndex = tabOrder.indexOf(id);
  tabs.delete(id);
  tabOrder = tabOrder.filter((tid) => tid !== id);
  tab.view.webContents.close();

  if (wasActive) {
    if (tabOrder.length > 0) {
      // Prefer the tab that was to the right of the closed one.
      setActiveTab(tabOrder[Math.min(closedIndex, tabOrder.length - 1)]);
    } else {
      activeTabId = null;
      setActiveTab(createTab());
    }
    return; // setActiveTab already broadcasts
  }
  broadcastTabs();
}

function reorderTab(id, toIndex) {
  const from = tabOrder.indexOf(id);
  if (from === -1) return;
  const clamped = Math.max(0, Math.min(tabOrder.length - 1, toIndex));
  tabOrder.splice(from, 1);
  tabOrder.splice(clamped, 0, id);
  broadcastTabs();
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

function focusAddressBar() {
  if (win && !win.isDestroyed()) win.webContents.send('chrome:focus-address-bar');
}

function registerIpcHandlers() {
  ipcMain.handle('tabs:create', (_e, url) => {
    const id = createTab(url || newTabUrl());
    setActiveTab(id);
    return id;
  });
  ipcMain.handle('tabs:close', (_e, id) => closeTab(id));
  ipcMain.handle('tabs:switch', (_e, id) => setActiveTab(id));
  ipcMain.handle('tabs:navigate', (_e, id, url) => {
    const tab = tabs.get(id);
    if (tab) tab.view.webContents.loadURL(normalizeAddressInput(url));
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
  ipcMain.handle('downloads:summary', () => ({ activeCount: activeCount() }));

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
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => setActiveTab(createTab()) },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => activeTabId && closeTab(activeTabId) },
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
        { label: 'Reload Tab', accelerator: 'CmdOrCtrl+R', click: () => activeTabId && tabs.get(activeTabId)?.view.webContents.reload() },
        { type: 'separator' },
        { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: () => openInternalPage('bowser://downloads/') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => openInternalPage('bowser://settings/') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
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
  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;

  applyTheme();
  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) win.setBackgroundColor(chromeBackgroundColor());
  });

  setupPermissionPolicy(ses);
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

  registerIpcHandlers();
  buildMenu();
  createMainWindow();

  const firstTabId = createTab();
  win.webContents.once('did-finish-load', () => setActiveTab(firstTabId));

  // Web store + preinstalled extensions load in the background — network
  // installs on first run shouldn't block the window.
  initWebStore(ses).catch((err) => console.warn('[extensions] web store init failed:', err.message));

  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
