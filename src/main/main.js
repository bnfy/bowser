const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, nativeTheme, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { setupAdBlocker, setAdBlockEnabled, getBlocker } = require('./adblock');
const { registerPagesScheme, setupPages } = require('./pages');
const { setupPermissionPolicy, setPermissionPrompter } = require('./permissions');
const { setupAutoUpdater, checkForUpdatesManually } = require('./updater');
const { sendLaunchPing } = require('./telemetry');
const { setupDownloads } = require('./downloads');
const { attachContextMenu } = require('./context-menu');
const { promptForCredentials } = require('./auth-dialog');
const settings = require('./settings');
const bookmarks = require('./bookmarks');
const history = require('./history');
const { JsonStore } = require('./store');

const NEW_TAB_URL = 'bowser://newtab/';
const newTabUrl = () => settings.getSettings().homePage || NEW_TAB_URL;
// The query flag tells the newtab page to show private copy + theme.
const PRIVATE_NEW_TAB_URL = 'bowser://newtab/?private=1';

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
  app.on('second-instance', (_e, commandLine) => {
    for (const url of urlsFromArgv(commandLine)) openExternalUrl(url);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // Chrome-extension support used to live here (electron-chrome-extensions
  // + web store, plus crash-loop recovery for extension profile state). It
  // was removed: the password managers it existed for are blocked from
  // working in any non-allowlisted browser at the OS/vendor level, and the
  // extension runtime was the app's main source of hard crashes. Leftover
  // extension profile state from older versions is cleared below. (The
  // profile's 'Service Worker' dir is left alone — it also holds ordinary
  // websites' service workers, and with no extension runtime a stale
  // extension worker registration in there is inert.)
  const staleExtensionState = [
    'Extensions', 'Extension State', 'Extension Scripts', 'Extension Rules', '.running',
  ];
  try {
    for (const entry of staleExtensionState) {
      fs.rmSync(path.join(app.getPath('userData'), entry), { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('[cleanup] could not clear stale extension state:', err.message);
  }
}

// URLs handed over by the OS when Bowser is the default browser. macOS
// delivers them via 'open-url' (which can fire before 'ready' — those queue
// until the window and session restore are up); Windows/Linux pass them on
// the command line, at startup or through 'second-instance'.
const pendingExternalUrls = [];
let externalUrlsFlushable = false;
const urlsFromArgv = (argv) => argv.filter((a) => /^https?:\/\//.test(a));

function openExternalUrl(url) {
  if (!externalUrlsFlushable || !hasLiveWindow()) {
    pendingExternalUrls.push(url);
    return;
  }
  setActiveTab(createTab(url));
  if (win.isMinimized()) win.restore();
  win.focus();
}

function flushExternalUrls() {
  externalUrlsFlushable = true;
  for (const url of pendingExternalUrls.splice(0)) openExternalUrl(url);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  openExternalUrl(url);
});

// Must happen before app 'ready'.
registerPagesScheme();

// Strip the app and Electron tokens from the UA so sites treat us as a
// plain Chrome build.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sbowser\/[\d.]+/i, '')
  .replace(/\sElectron\/[\d.]+/, '');

// Hide the FedCM API. Must happen before app 'ready', and silently no-ops
// if Chromium ever retires the "FedCm" feature name (an Electron bump that
// brings back Google-login 400s should recheck here first). Chromium ships
// the JS surface (IdentityCredential) but Electron has no account-chooser
// UI behind it, so FedCM calls can only ever fail with "Error retrieving
// a token". Google Identity Services feature-detects the API, commits to
// the FedCM sign-in path, and after its popup completes dies at
// accounts.google.com/gis_transform with a 400 — "Sign in with Google"
// broken on every site using GIS. With the API absent, GIS falls back to
// its legacy popup flow, which works (see setWindowOpenHandler's
// 'new-window' handling). Comma-joined with any existing value: repeated
// disable-features switches replace, not merge, so appending blind would
// clobber argv flags (and a future second appendSwitch would drop FedCm).
const priorDisabledFeatures = app.commandLine.getSwitchValue('disable-features');
app.commandLine.appendSwitch(
  'disable-features',
  priorDisabledFeatures ? `${priorDisabledFeatures},FedCm` : 'FedCm'
);

/** @type {BrowserWindow | null} */
let win = null;

// Window background behind everything, matching the CSS --bg tokens so
// resizes and load flashes stay in-theme.
const chromeBackgroundColor = () => (nativeTheme.shouldUseDarkColors ? '#0e0e0e' : '#f4f4f1');

// nativeTheme.themeSource drives prefers-color-scheme in every renderer —
// chrome UI, internal pages, and the web content itself see one theme.
function applyTheme() {
  nativeTheme.themeSource = settings.getSettings().theme;
}

// Swap the macOS Dock icon to the chosen colorway. Runtime-only by design:
// the bundle's .icns (what Finder shows) is inside the code-signing seal and
// can't be rewritten per-user, so this runs on every launch instead.
function applyAppIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  const id = settings.getSettings().appIcon;
  const file = settings.APP_ICONS.includes(id) ? id : 'default';
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '../renderer/pages', `icon-${file}.png`)
  );
  if (!icon.isEmpty()) app.dock.setIcon(icon);
}

const hasLiveWindow = () => !!win && !win.isDestroyed();

/** @type {Map<string, { id: string, view: WebContentsView, title: string, url: string, isLoading: boolean, canGoBack: boolean, canGoForward: boolean, favicon: string | null, bookmarked: boolean, blockedCount: number, private: boolean, pageBg: string | null, themeColor: string | null }>} */
const tabs = new Map();
/** Display order of tab ids — the single source of truth for the strip. */
let tabOrder = [];
let activeTabId = null;
/** Named tab groups in display order — pill clusters follow this order,
 * ungrouped tabs trail. Groups have no color by design (Island Tab Groups
 * handoff): identity is a lowercase mono name. Empty groups are pruned.
 * @type {{ id: string, name: string, collapsed: boolean }[]} */
let groups = [];
const tabsWantingAddressBarFocus = new Set();

// Outstanding permission prompts awaiting the user's Allow/Block, keyed by
// prompt id → the Promise resolver. Flushed if the window dies mid-prompt
// so the underlying Chromium request never hangs.
const pendingPermissionPrompts = new Map();
function flushPermissionPrompts() {
  for (const resolve of pendingPermissionPrompts.values()) resolve(null); // null = never answered
  pendingPermissionPrompts.clear();
}

// Height (in CSS px) of the chrome strip the resting island pill floats
// in. The renderer measures its own layout and reports it here, so this
// is just a sane default before the first report arrives.
let chromeHeight = 56;

// The island's expanded states (command bar, ⌘L palette, find capsule)
// render in a separate always-on-top WebContentsView so they float OVER
// the web content instead of growing the strip and shifting content down.
// It is attached to win.contentView only while something is showing.
/** @type {WebContentsView | null} */
let overlayView = null;
/** @type {null | 'panel' | 'palette' | 'find'} */
let overlayMode = null;

// Find mode keeps the overlay's bounds tight around the capsule so the
// rest of the page stays clickable while stepping through matches. Sized
// to fit the capsule (top 60 + ~42 tall) plus its full shadow extent.
const FIND_OVERLAY = { width: 560, height: 160 };

function overlayBounds() {
  const { width, height } = win.getContentBounds();
  if (overlayMode === 'find') {
    // Below the strip, so the pill stays clickable while find is open and
    // the strip's drag region can't shadow the capsule.
    return {
      x: Math.round((width - FIND_OVERLAY.width) / 2),
      y: chromeHeight,
      width: FIND_OVERLAY.width,
      height: Math.max(0, Math.min(FIND_OVERLAY.height, height - chromeHeight)),
    };
  }
  return { x: 0, y: 0, width, height };
}

function createOverlay() {
  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlayView.setBackgroundColor('#00000000'); // page shows through around the panel
  overlayView.webContents.loadFile(path.join(__dirname, '../renderer/overlay.html'));

  // A show requested before the overlay document finished its first load
  // would be lost — leaving an invisible view blocking clicks. Replay it.
  overlayView.webContents.once('did-finish-load', () => {
    if (overlayMode) {
      overlayView.webContents.send('overlay:show', { mode: overlayMode });
      overlayView.webContents.focus();
    }
  });

  // Dismiss on Escape at the main-process level so it works no matter
  // which element inside the overlay holds focus.
  overlayView.webContents.on('before-input-event', (event, input) => {
    if (overlayMode && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      hideOverlay();
    }
  });

  // Losing focus (page click, cmd-tab, devtools) with the command bar open
  // would leave a stale panel floating over the page. Find mode survives
  // blur deliberately — users click around the page between matches.
  overlayView.webContents.on('blur', () => {
    if (!overlayMode || overlayMode === 'find') return;
    // A freshly attached blank tab's view can momentarily grab focus while
    // its address-focus reclaim is still pending — that's not a dismissal;
    // the reclaim will re-assert overlay focus on the next tick.
    if (activeTabId && tabsWantingAddressBarFocus.has(activeTabId)) return;
    hideOverlay({ refocusContent: false });
  });
}

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

function hideOverlay({ refocusContent = true } = {}) {
  if (!overlayMode) return;
  overlayMode = null;
  // A dismissed command bar means the user is done addressing — stop any
  // pending blank-tab focus reclaim so a page click can't reopen it.
  if (activeTabId) tabsWantingAddressBarFocus.delete(activeTabId);
  if (hasLiveWindow() && overlayView) {
    win.contentView.removeChildView(overlayView);
    overlayView.webContents.send('overlay:hide');
    win.webContents.send('chrome:island-state', { mode: null });
    if (refocusContent) tabs.get(activeTabId)?.view.webContents.focus();
  }
}

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
// `groupIds` is parallel to `urls` (null = ungrouped); `groups` holds the
// group records those ids point at.
let sessionStore = null;
const ensureSessionStore = () => (sessionStore ??= new JsonStore('session', { urls: [], activeIndex: 0, groups: [], groupIds: [] }));

// Rolling ads-blocked counter for the start page's margin note. Weeks
// start Monday 00:00 local; the count resets lazily on the first touch
// (read or increment) after a week boundary.
let adblockStatsStore = null;
const ensureAdblockStats = () => (adblockStatsStore ??= new JsonStore('adblock-stats', { weekStart: 0, blocked: 0 }));

function currentWeekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function adblockWeekStats() {
  const s = ensureAdblockStats();
  const week = currentWeekStart();
  if (s.data.weekStart !== week) s.update((d) => { d.weekStart = week; d.blocked = 0; });
  return s;
}

let isQuitting = false;
app.on('before-quit', () => { isQuitting = true; });

function persistSession() {
  // Teardown closes tabs one by one; saving then would erode the session
  // file down to whatever closed last before the process exits.
  if (isQuitting || tabs.size === 0) return;
  // Private tabs leave no trail — they never enter the session file.
  const persistable = tabOrder.filter((id) => !tabs.get(id)?.private);
  ensureSessionStore().update((d) => {
    // Build url/groupId pairs before filtering so the two arrays can't
    // fall out of alignment when a tab has no persistable url.
    const entries = persistable
      .map((id) => {
        const tab = tabs.get(id);
        let url = tab?.url;
        // Persist the address that failed, not the error page wrapping it,
        // so the next launch retries the real destination.
        if (url?.startsWith('bowser://error')) {
          try {
            url = new URL(url).searchParams.get('url') || url;
          } catch {
            /* keep the error url */
          }
        }
        return url ? { id, url, groupId: tab.groupId ?? null } : null;
      })
      .filter(Boolean);
    d.urls = entries.map((e) => e.url);
    d.groupIds = entries.map((e) => e.groupId);
    // Groups referenced only by private tabs stay out of the file too.
    d.groups = groups.filter((g) => entries.some((e) => e.groupId === g.id));
    // Only update when the active tab is actually in the persisted list —
    // during startup (no active tab yet) or with a private tab active,
    // indexOf is -1 and writing 0 would corrupt the last good index.
    // Indexed into `entries` (what d.urls is built from), not the wider
    // tab list — a tab with no persistable url (an adopted window.open
    // child before its first navigation commits) is dropped from d.urls,
    // and an index computed on the unfiltered list would restore focus to
    // the wrong tab. -1 (startup, private or url-less active tab) keeps
    // the last good index, as before.
    const idx = entries.findIndex((e) => e.id === activeTabId);
    if (idx >= 0) d.activeIndex = idx;
  });
}

function broadcastTabs() {
  persistSession();
  if (!win || win.isDestroyed()) return;
  const payload = { tabs: serializeTabs(), activeTabId, groups };
  win.webContents.send('tabs:updated', payload);
  overlayView?.webContents.send('tabs:updated', payload);
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

function resizeActiveView() {
  if (!win || win.isDestroyed()) return;
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (tab) {
    const bounds = win.getContentBounds();
    tab.view.setBounds({
      x: 0,
      y: chromeHeight,
      width: bounds.width,
      height: Math.max(0, bounds.height - chromeHeight),
    });
  }
  if (overlayMode && overlayView) overlayView.setBounds(overlayBounds());
}

/** Pick the sharpest favicon from a page's declared icon links. The pill
 * renders icons at 14px CSS (28+ device px on retina), so a 16px .ico —
 * which is what `page-favicon-updated`'s first entry usually is — scales
 * up blurry. Preference: SVG, then declared sizes ≥32 (nearest 64 wins),
 * then apple-touch-icon (~180px, slightly demoted: often has a solid
 * background), then undeclared PNGs over undeclared ICOs. */
function pickBestFavicon(candidates) {
  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    if (!c || typeof c.href !== 'string' || c.href.length > 2048) continue;
    if (!/^(https?:|data:image\/)/i.test(c.href)) continue;
    const sizes = typeof c.sizes === 'string' ? c.sizes.slice(0, 100) : '';
    const appleTouch = typeof c.rel === 'string' && /apple-touch-icon/i.test(c.rel);
    const declared = Math.max(0, ...[...sizes.matchAll(/(\d+)[x×]\d+/gi)].map((m) => Number(m[1])));
    const size = declared || (appleTouch ? 180 : 0);
    let score;
    if (/\.svg(\?|#|$)/i.test(c.href) || /\bany\b/i.test(sizes)) score = 1e6;
    else if (size >= 32) score = 100000 + (10000 - Math.abs(size - 64)) - (appleTouch ? 500 : 0);
    else if (size === 0) score = /\.ico(\?|$)/i.test(c.href) ? 100 : 1000;
    else score = size;
    if (score > bestScore) {
      bestScore = score;
      best = c.href;
    }
  }
  return best;
}

/** Asynchronously refine a tab's favicon beyond Chromium's first-listed
 * URL. Runs in the page context, so everything returned is validated in
 * pickBestFavicon before it touches chrome CSS. */
async function upgradeFavicon(tab) {
  const urlAtStart = tab.url;
  try {
    const candidates = await tab.view.webContents.executeJavaScript(
      `[...document.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"]')]
        .slice(0, 20)
        .map((l) => ({ href: l.href, sizes: l.getAttribute('sizes') || '', rel: l.rel }))`
    );
    if (!Array.isArray(candidates) || candidates.length > 20) return;
    if (!tabs.has(tab.id) || tab.url !== urlAtStart) return; // navigated away meanwhile
    const best = pickBestFavicon(candidates);
    if (best && best !== tab.favicon) {
      tab.favicon = best;
      scheduleBroadcastTabs();
    }
  } catch {
    /* page gone mid-query — Chromium's default pick stands */
  }
}

/** Most common color in a captured image, as #rrggbb (bitmap is BGRA).
 * The top rows of a page are usually a solid header/background color, so
 * the mode is robust where an average would go muddy. */
function dominantColor(image) {
  const { width, height } = image.getSize();
  if (!width || !height) return null;
  const bitmap = image.toBitmap();
  const counts = new Map();
  for (let i = 0; i + 3 < bitmap.length; i += 16) { // every 4th pixel is plenty
    const rgb = (bitmap[i + 2] << 16) | (bitmap[i + 1] << 8) | bitmap[i];
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [rgb, count] of counts) {
    if (count > bestCount) {
      best = rgb;
      bestCount = count;
    }
  }
  return best === null ? null : `#${best.toString(16).padStart(6, '0')}`;
}

/** Sample the top two pixel rows of a tab's rendered page — the edge that
 * visually abuts the chrome strip. Fails harmlessly for hidden views;
 * setActiveTab resamples on activation. */
async function samplePageTint(tab) {
  if (!tabs.has(tab.id) || tab.view.webContents.isDestroyed()) return;
  if (tab.private || !/^https?:\/\//.test(tab.url)) {
    if (tab.pageBg) {
      tab.pageBg = null;
      scheduleBroadcastTabs();
    }
    return;
  }
  const { width } = tab.view.getBounds();
  if (!width || tab.view.webContents.isLoading()) return;
  try {
    const image = await tab.view.webContents.capturePage({ x: 0, y: 0, width, height: 2 });
    const color = dominantColor(image);
    if (color && color !== tab.pageBg) {
      tab.pageBg = color;
      scheduleBroadcastTabs();
    }
  } catch {
    /* view hidden or gone — nothing to paint from */
  }
}

/** Give the page a beat to paint after load before sampling its color. */
function scheduleSampleTint(tab) {
  setTimeout(() => samplePageTint(tab), 150);
}

// --- Tab groups (Island Tab Groups design) ---

/** Pill/panel cluster order: each non-empty group in group order, then a
 * trailing pseudo-cluster of ungrouped tabs. Cmd/Ctrl+1–9 jump by this. */
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

/** A group exists only while it holds tabs — closing or moving out the
 * last one dissolves it (same convention as Chrome's tab groups). */
function pruneEmptyGroups() {
  if (!groups.length) return;
  const used = new Set();
  for (const tab of tabs.values()) if (tab.groupId) used.add(tab.groupId);
  groups = groups.filter((g) => used.has(g.id));
}

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

/** "/group work" — move a tab into the named group, creating it on first
 * use. Names are lowercase mono labels, per the design. */
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

function toggleGroupCollapsed(groupId) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  group.collapsed = !group.collapsed;
  broadcastTabs();
}

/** Jump to a group: activate its first tab and unfold it. */
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

function closeGroup(groupId) {
  const ids = tabOrder.filter((id) => tabs.get(id)?.groupId === groupId);
  for (const id of ids) closeTab(id);
}

const TAB_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // Chromium's built-in PDF viewer is a plugin; without this flag
  // PDFs download instead of rendering inline.
  plugins: true,
  // Exposes a data API to our own bowser:// pages ONLY — see the
  // guards in tab-preload.js and pages.js. Web content gets nothing.
  preload: path.join(__dirname, 'tab-preload.js'),
};

function createTab(url = newTabUrl(), { private: isPrivate = false, groupId = null, view = null } = {}) {
  const id = crypto.randomUUID();
  // An adopted view (window.open child, see the window-open handler) arrives
  // already constructed by Chromium with the opener relationship wired up;
  // everything else gets a fresh one.
  const adopted = !!view;
  view ??= new WebContentsView({ webPreferences: TAB_WEB_PREFERENCES });

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
    // Strip tint ("faux header"): the page's top-edge color, so the chrome
    // strip can paint itself as a continuation of the site's own header.
    pageBg: null, // sampled from rendered pixels — authoritative
    themeColor: null, // the page's <meta name="theme-color"> — fallback
  };
  tabs.set(id, tab);
  tabOrder.push(id);

  const wc = view.webContents;
  const syncNavState = () => {
    tab.canGoBack = wc.navigationHistory.canGoBack();
    tab.canGoForward = wc.navigationHistory.canGoForward();
    tab.url = wc.getURL();
    tab.bookmarked = bookmarks.isBookmarked(tab.url);
  };

  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    if (!tab.private) history.updateTitle(tab.url, title);
    broadcastTabs();
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = favicons[0] ?? null; // immediate, possibly low-res
    broadcastTabs();
    upgradeFavicon(tab); // async refinement to the sharpest declared icon
  });
  wc.on('did-start-loading', () => { tab.isLoading = true; broadcastTabs(); });
  wc.on('did-stop-loading', () => { tab.isLoading = false; syncNavState(); broadcastTabs(); scheduleSampleTint(tab); });
  wc.on('did-change-theme-color', (_e, color) => {
    // Chromium reports '#rrggbb' or null; validated because it feeds chrome CSS.
    tab.themeColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
    scheduleBroadcastTabs();
  });
  wc.on('did-navigate', (_e, url, httpResponseCode) => {
    const shouldReclaimChromeFocus = url === tab.url && tabsWantingAddressBarFocus.has(id) && activeTabId === id;
    if (url !== tab.url) tabsWantingAddressBarFocus.delete(id);
    tab.blockedCount = 0;
    tab.pageBg = null; // a new page's tint mustn't linger from the old one
    tab.themeColor = null;
    syncNavState();
    // Error responses stay out of history — a dead one-shot OAuth URL
    // recorded here resurfaces in the Quick Switcher as a destination.
    if (!tab.private && (httpResponseCode ?? 200) < 400) history.addVisit(url, wc.getTitle());
    broadcastTabs();
    if (shouldReclaimChromeFocus) reclaimAddressBarFocus(id);
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    syncNavState();
    if (isMainFrame && !tab.private) history.addVisit(url, wc.getTitle());
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

  // Web content must never navigate a tab into the privileged bowser://
  // scheme (Chrome blocks web → chrome:// identically). Main-initiated
  // loads (address bar, commands, error pages) go through loadURL, which
  // doesn't fire will-navigate, so only page-initiated hops are caught.
  wc.on('will-navigate', (event, targetUrl) => {
    if (/^bowser:/i.test(targetUrl) && !wc.getURL().startsWith('bowser://')) {
      event.preventDefault();
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

  // Adopted window.open children are script-closable — window.close() by
  // the page, child.close() by the opener — the only tabs whose
  // webContents can die outside closeTab. Route destruction through
  // closeTab so the strip, groups, and active-tab selection stay
  // consistent (re-entry is safe: closeTab removes the map entry before
  // calling wc.close(), so this fires on an id that's already gone).
  wc.once('destroyed', () => closeTab(id));

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
      overlayView?.webContents.send('chrome:find-result', { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches });
    }
  });

  // Open target="_blank"/featureless window.open as managed tabs, but let
  // window.open with explicit features ('new-window': OAuth/SSO popups,
  // payment flows) become a REAL child window. Both paths MUST preserve
  // window.opener: sign-in flows deliver their result back to the opening
  // page via postMessage, and an opener-less child breaks them (observed:
  // GitHub's "Sign in with Google" looping until accounts.google.com 400'd
  // on corrupted state; later, Google auth flows opened as target=_blank
  // dead-ending at accounts.google.com/gis_transform with a 400). So tabs
  // are ADOPTED via createWindow — Chromium constructs the child wired to
  // its opener, and createTab takes the view in as a normal managed tab —
  // never re-created from just the URL. outlivesOpener on both paths:
  // Electron's default destroys children with their opener, but closing a
  // tab must not tear down the tabs (or popups) it spawned — Chrome never
  // does. Electron only inherits the security subset of webPreferences
  // into window.open children, so plugins (inline PDFs) is re-asserted via
  // override — but ONLY plugins: overriding preload forces the child out
  // of its opener's context and severs window.opener, defeating the whole
  // adoption. Adopted tabs therefore lack tab-preload; that bridge only
  // matters on bowser:// pages, and the guards below keep web content
  // from opening or navigating into bowser:// at all.
  // Cmd/Ctrl+click arrives as 'background-tab' — open it without stealing
  // focus (browser convention). Children of a private tab stay private —
  // a popup must not silently start recording history again. Applied
  // recursively via did-create-window so a popup's own window.open
  // children (a "Terms" link inside an OAuth popup) land back in managed
  // tabs instead of falling through to bare Electron windows.
  const applyWindowOpenPolicy = (targetWc) => {
    targetWc.setWindowOpenHandler(({ url: targetUrl, disposition }) => {
      // Web content must not mint privileged internal pages (Chrome blocks
      // web → chrome:// the same way). Only bowser:// pages themselves may
      // open bowser:// children.
      if (/^bowser:/i.test(targetUrl) && !targetWc.getURL().startsWith('bowser://')) {
        return { action: 'deny' };
      }
      if (disposition === 'new-window') {
        return {
          action: 'allow',
          outlivesOpener: true,
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }
      // Children stay in their opener's group, like Chrome's tab groups.
      return {
        action: 'allow',
        outlivesOpener: true,
        overrideBrowserWindowOptions: { webPreferences: { plugins: true } },
        createWindow: (options) => {
          // options.webContents is the guest Chromium already created,
          // wired to its opener. The view must WRAP it — constructing a
          // fresh webContents here throws "Invalid webContents. Created
          // window should be connected to webContents passed with options".
          const view = new WebContentsView({ webContents: options.webContents });
          const newId = createTab(targetUrl, { private: tab.private, groupId: tab.groupId, view });
          // Activation is deferred: createWindow runs mid-window-open,
          // before Chromium has finished wiring the guest, and attaching
          // the view to the window at that point silently fails to take.
          if (disposition !== 'background-tab') setImmediate(() => setActiveTab(newId));
          return view.webContents;
        },
      };
    });
    targetWc.on('did-create-window', (childWindow) => {
      // Adopted children run their own createTab wiring; only real popup
      // windows need the policy grafted on.
      const isManagedTab = [...tabs.values()].some(
        (t) => t.view.webContents.id === childWindow.webContents.id
      );
      if (!isManagedTab) applyWindowOpenPolicy(childWindow.webContents);
    });
  };
  applyWindowOpenPolicy(wc);

  attachContextMenu(wc, {
    openBackgroundTab: (targetUrl) => createTab(targetUrl, { private: tab.private, groupId: tab.groupId }),
    openTab: (targetUrl) => setActiveTab(createTab(targetUrl, { private: tab.private, groupId: tab.groupId })),
  });

  // Load failures surface via the did-fail-load handler above; the
  // rejected promise here is the same event and must not crash main.
  // Adopted window.open children are loaded by Chromium itself as part of
  // the window-open dance — a competing loadURL here would cancel it.
  if (!adopted) wc.loadURL(url).catch(() => {});
  return id;
}

function setActiveTab(id, { focusContent = true, focusAddress = false } = {}) {
  const next = tabs.get(id);
  if (!next) return;
  // A script-closed adopted tab prunes itself via its 'destroyed' handler,
  // but a deferred activation (the window-open setImmediate) can race the
  // event — never attach or focus a dead webContents.
  if (next.view.webContents.isDestroyed()) return;

  // Re-selecting the active tab is a no-op.
  if (id === activeTabId) return;

  // No window to attach to (quitting, or macOS with all windows closed):
  // just track the selection so window recreation attaches the right tab.
  if (!hasLiveWindow()) {
    activeTabId = id;
    return;
  }

  // Find state is per-tab; a stale capsule over a different page misleads.
  if (overlayMode === 'find') hideOverlay({ refocusContent: false });

  const prevId = activeTabId;
  const prev = prevId ? tabs.get(prevId) : null;
  if (prev) {
    win.contentView.removeChildView(prev.view);
    // A detached view's document still reports visibilityState 'visible',
    // so Chromium never background-throttles its timers (the newtab sprite
    // would keep animating at 6fps forever). Hide it explicitly;
    // reactivation always calls setVisible(true).
    prev.view.setVisible(false);
  }

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
  // The freshly attached tab view must not stack above an open overlay.
  if (overlayMode && overlayView) win.contentView.addChildView(overlayView);
  resizeActiveView();
  // Focusing the tab's WebContentsView gives it OS keyboard focus. For a
  // blank new tab we instead want the chrome's address bar, and OS focus
  // can be claimed asynchronously by the attached child view, so blank-tab
  // activation keeps reclaiming focus until the user navigates or switches.
  if (focusContent) next.view.webContents.focus();
  // Background tabs can't be pixel-sampled; catch up when they surface.
  if (!next.pageBg) scheduleSampleTint(next);
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

  // Closed private tabs are gone — reopen-closed-tab must not resurrect them.
  if (tab.url && !tab.private && !tab.url.startsWith('bowser://newtab')) {
    recentlyClosedUrls.push(tab.url);
    if (recentlyClosedUrls.length > 25) recentlyClosedUrls.shift();
  }

  const wasActive = id === activeTabId;
  if (wasActive && hasLiveWindow()) win.contentView.removeChildView(tab.view);

  const closedIndex = tabOrder.indexOf(id);
  tabsWantingAddressBarFocus.delete(id);
  tabs.delete(id);
  tabOrder = tabOrder.filter((tid) => tid !== id);
  pruneEmptyGroups();
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

/** Cmd/Ctrl+1–9. With groups: n jumps to the nth cluster — a group's
 * first tab, unfolding it (Island Tab Groups design). Without groups the
 * browser convention stands: 1–8 jump to that tab, 9 to the last. */
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
  showOverlay('find');
}

function focusAddressBar() {
  if (!win || win.isDestroyed()) return;
  // setActiveTab() may just have handed OS-level keyboard focus to the
  // tab's WebContentsView; showOverlay reclaims it for the overlay's
  // webContents so the address input actually receives keystrokes.
  win.focus();
  // Reasserts must not downgrade an already-summoned palette to a panel.
  showOverlay(overlayMode && overlayMode !== 'find' ? overlayMode : 'panel');
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
  ipcMain.handle('tabs:create', (_e, url, opts) => {
    const isPrivate = !!opts?.private;
    const id = createTab(url || (isPrivate ? PRIVATE_NEW_TAB_URL : newTabUrl()), {
      private: isPrivate,
      // "New tab in <group>": a fresh tab joins the active tab's group.
      groupId: isPrivate ? null : tabs.get(activeTabId)?.groupId ?? null,
    });
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
  ipcMain.handle('tabs:set-group', (_e, id, groupId) => setTabGroup(id, groupId ?? null));
  ipcMain.handle('tabs:group-by-name', (_e, id, name) => groupTabByName(id, name));
  ipcMain.handle('tabs:toggle-group-collapsed', (_e, groupId) => toggleGroupCollapsed(groupId));
  ipcMain.handle('tabs:focus-group', (_e, groupId) => focusGroup(groupId));
  ipcMain.handle('tabs:close-group', (_e, groupId) => closeGroup(groupId));
  ipcMain.handle('tabs:toggle-bookmark', () => toggleBookmarkForActiveTab());
  ipcMain.handle('tabs:open-page', (_e, name) => {
    if (['bookmarks', 'history', 'downloads', 'settings'].includes(name)) {
      openInternalPage(`bowser://${name}/`);
    }
  });
  ipcMain.handle('tabs:get-all', () => ({ tabs: serializeTabs(), activeTabId, groups }));
  ipcMain.handle('tabs:find', (_e, id, query, options) => tabs.get(id)?.view.webContents.findInPage(query, options));
  ipcMain.handle('tabs:find-stop', (_e, id) => tabs.get(id)?.view.webContents.stopFindInPage('clearSelection'));

  ipcMain.on('chrome:layout', (_e, { height }) => {
    if (typeof height === 'number' && height > 0) {
      chromeHeight = height;
      resizeActiveView();
    }
  });

  ipcMain.on('chrome:open-island', () => showOverlay('panel'));
  ipcMain.on('chrome:open-find', () => showOverlay('find'));
  ipcMain.on('overlay:close', () => hideOverlay());

  // Data + actions behind the island's slash commands and Quick Switcher.
  ipcMain.handle('chrome:history-list', (_e, opts) => history.listHistory(opts ?? {}));
  ipcMain.handle('chrome:favorites-list', () => bookmarks.listBookmarks());
  ipcMain.handle('chrome:history-clear', () => history.clearHistory());
  ipcMain.handle('chrome:adblock-toggle', () => {
    const next = !settings.getSettings().adblockEnabled;
    settings.setSettings({ adblockEnabled: next });
    return next;
  });
  // "/off-leash" — allow ads on the active tab's site, then reload it so
  // the exception actually takes effect on what's shown.
  ipcMain.handle('chrome:adblock-exempt-active', () => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return null;
    try {
      const hostname = new URL(tab.url).hostname.replace(/^www\./, '');
      if (!hostname) return null;
      const { adblockExceptions } = settings.getSettings();
      settings.setSettings({ adblockExceptions: [...adblockExceptions, hostname] });
      tab.view.webContents.reload();
      return hostname;
    } catch {
      return null;
    }
  });
  ipcMain.handle('chrome:cycle-theme', () => {
    const order = ['system', 'light', 'dark'];
    const current = settings.getSettings().theme;
    const next = order[(order.indexOf(current) + 1) % order.length];
    settings.setSettings({ theme: next });
    return next;
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
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => setActiveTab(createTab(newTabUrl(), { groupId: tabs.get(activeTabId)?.groupId }), { focusContent: false, focusAddress: true }) },
        { label: 'New Private Tab', accelerator: 'CmdOrCtrl+Shift+N', click: () => setActiveTab(createTab(PRIVATE_NEW_TAB_URL, { private: true }), { focusContent: false, focusAddress: true }) },
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
        { label: 'Search & Commands', accelerator: 'CmdOrCtrl+L', click: () => { if (hasLiveWindow()) { win.focus(); showOverlay('palette'); } } },
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
        // "Tab or Group": with groups these jump to the nth pill cluster.
        ...Array.from({ length: 9 }, (_, i) => ({
          label: i === 8 ? 'Last Tab or Group' : `Tab or Group ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => selectTabAtIndex(i),
        })),
      ],
    },
    {
      label: 'Favorites',
      submenu: [
        { label: 'Add to Favorites', accelerator: 'CmdOrCtrl+D', click: toggleBookmarkForActiveTab },
        { label: 'Show Favorites', accelerator: isMac ? 'Cmd+Alt+B' : 'Ctrl+Shift+O', click: () => openInternalPage('bowser://bookmarks/') },
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
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  createOverlay();
  win.on('resize', resizeActiveView);
  win.on('focus', refocusAddressBarIfWanted);
  win.on('closed', () => {
    win = null;
    // Unlike tabs, the overlay doesn't outlive its window — recreated fresh.
    overlayMode = null;
    if (overlayView && !overlayView.webContents.isDestroyed()) overlayView.webContents.close();
    overlayView = null;
    flushPermissionPrompts();
  });

  // Tabs survive window close (macOS dock-reopen recreates the window);
  // re-attach the active tab's view or the new window sits over nothing.
  // First launch has no activeTabId yet — app.whenReady handles that one.
  win.webContents.once('did-finish-load', () => {
    if (!activeTabId || !tabs.has(activeTabId)) return;
    const id = activeTabId;
    activeTabId = null; // force setActiveTab to treat it as a fresh attach
    setActiveTab(id);
    // An 'open-url' with no window queues; opening it is why the window
    // was recreated (macOS dock-reopen path).
    flushExternalUrls();
  });
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;

  applyTheme();
  applyAppIcon();
  if (settings.getSettings().usagePing) sendLaunchPing();
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

  setupDownloads(ses);
  setupPages({
    onDataChanged: refreshBookmarkFlags,
    // The start page's ledger sections read live tab-group state and the
    // rolling blocked counter, both owned here.
    startPage: {
      // Mirror persistSession's rule: private tabs — and groups only they
      // hold — never surface on a start page.
      groups: () => clusterList()
        .filter((c) => c.group)
        .map(({ group, tabIds }) => ({
          id: group.id,
          name: group.name,
          count: tabIds.filter((id) => !tabs.get(id)?.private).length,
        }))
        .filter((g) => g.count > 0),
      focusGroup,
      blockedThisWeek: () => adblockWeekStats().data.blocked,
    },
  });

  await setupAdBlocker(ses, { enabled: settings.getSettings().adblockEnabled });

  // Per-tab blocked-request counter. `request.tabId` is the webContents id
  // of the frame the request came from.
  getBlocker()?.on('request-blocked', (request) => {
    adblockWeekStats().update((d) => { d.blocked += 1; });
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
    applyAppIcon();
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
  // Snapshot, don't alias: .data is the live store object, and createTab
  // below synchronously triggers persistSession (loadURL emits
  // did-start-loading in the same tick), which would overwrite activeIndex
  // before it's read.
  const saved = structuredClone(ensureSessionStore().data);
  // Groups first, so createTab's groupId validation sees them.
  groups = (Array.isArray(saved.groups) ? saved.groups : [])
    .filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string')
    .map((g) => ({ id: g.id, name: g.name, collapsed: !!g.collapsed }));
  const restoredIds = saved.urls.map((u, i) => createTab(u, { groupId: saved.groupIds?.[i] ?? null }));
  pruneEmptyGroups(); // drop groups none of the restored tabs point at
  const fresh = restoredIds.length === 0;
  const firstTabId = fresh
    ? createTab()
    : restoredIds[Math.min(Math.max(0, saved.activeIndex), restoredIds.length - 1)];
  win.webContents.once('did-finish-load', () => {
    setActiveTab(firstTabId, { focusContent: !fresh, focusAddress: fresh });
    // Cold-start URL handoff: anything queued by pre-ready 'open-url'
    // events, or passed on the command line, opens after session restore
    // so the link lands as the active tab.
    pendingExternalUrls.push(...urlsFromArgv(process.argv.slice(1)));
    flushExternalUrls();
  });

  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    refocusAddressBarIfWanted();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
