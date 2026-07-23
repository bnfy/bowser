const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, nativeTheme, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { setupAdBlocker, attachAdBlockerToSession, setAdBlockEnabled, getBlocker } = require('./adblock');
const { webrtcPolicyFor, hostResolverOptionsFor } = require('./network-privacy');
const {
  chromeClientHintPlatform,
  chromeClientHintArchitecture,
  chromeClientHintBitness,
  chromeClientHintPlatformVersion,
} = require('./chrome-client-hints');
const { registerPagesScheme, setupPages } = require('./pages');
const { setupPermissionPolicy, setPermissionPrompter } = require('./permissions');
const { setupAutoUpdater, checkForUpdatesManually } = require('./updater');
const { sendLaunchPing } = require('./telemetry');
const sync = require('./sync');
const tabsync = require('./tabsync');
const { setupDownloads, downloadsActivity, acknowledgeDownloads } = require('./downloads');
const { attachContextMenu } = require('./context-menu');
const { promptForCredentials } = require('./auth-dialog');
const settings = require('./settings');
const bookmarks = require('./bookmarks');
const { groupFavoritesForMenu } = require('./bookmark-data');
const history = require('./history');
const { JsonStore } = require('./store');
const { persistableEntries } = require('./session-snapshot');
const { filterRestoredSession } = require('./session-restore');
const { isUtilityUrl } = require('./utility-pages');
const { shouldClearFaviconOnNavigate } = require('./favicon-policy');
const { setupWebAuthn } = require('./webauthn');
const { HANDOFF_PROTOCOLS, classifyExternalNavigation } = require('./external-protocols');
const { isTrustedSender } = require('./ipc-trust');
const { applyDockAppIcon } = require('./app-icon');

const NEW_TAB_URL = 'blanc://newtab/';
const newTabUrl = () => settings.getSettings().homePage || NEW_TAB_URL;
// The query flag tells the newtab page to show private copy + theme.
const PRIVATE_NEW_TAB_URL = 'blanc://newtab/?private=1';

// Dev runs (`npm start`) get their own userData so a dev instance never
// shares — and corrupts — the installed app's profile: two Chromium
// browser processes writing one profile's LevelDB/extension state
// SIGSEGVs both (observed 2026-07-04, identical CrBrowserMain crashes in
// dev and installed builds within seconds of each other).
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-Dev`);
}

// One-time migration for existing installs: userData's location is
// derived from productName, so the Bowser -> Blanc rename would otherwise
// start every existing user on an empty profile. Copy the old directory
// forward exactly once, before anything (JsonStores, adblock cache,
// single-instance lock) touches the new one.
if (app.isPackaged) {
  const oldUserDataDir = path.join(app.getPath('appData'), 'Bowser');
  const newUserDataDir = app.getPath('userData');
  if (!fs.existsSync(newUserDataDir) && fs.existsSync(oldUserDataDir)) {
    fs.cpSync(oldUserDataDir, newUserDataDir, { recursive: true });
  }
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

// URLs handed over by the OS when Blanc is the default browser. macOS
// delivers them via 'open-url' (which can fire before 'ready' — those queue
// until the window and session restore are up); Windows/Linux pass them on
// the command line, at startup or through 'second-instance'.
const pendingExternalUrls = [];
let externalUrlsFlushable = false;

/** Best-effort path -> file:// URL. Electron's 'open-file' contract types
 * the path as always a non-empty absolute string, but nothing else calling
 * this guards a raw filesystem string before handing it to Node — fail
 * closed (null) rather than let a malformed path crash the main process. */
function toFileUrl(filePath) {
  try {
    return pathToFileURL(filePath).href;
  } catch {
    return null;
  }
}

/** Local document paths: bare filenames/paths ending in .htm/.html/.xhtml
 * that exist on disk and aren't already a URI (so "https://x/a.html" isn't
 * mistaken for a bare path). The scheme check requires "://", not just
 * ":", so a Windows drive letter ("C:\...") isn't misread as a URI scheme
 * and silently rejected — matches normalizeAddressInput's own scheme
 * regex below, which this function is also called from. The extension
 * list must stay in sync with package.json's mac.extendInfo.
 * CFBundleDocumentTypes (public.html/public.xhtml) by hand — JSON can't
 * carry a comment pointing back here. */
function localDocumentUrl(input) {
  if (!/\.(x?html?)$/i.test(input)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return null;
  if (!fs.existsSync(input)) return null;
  return toFileUrl(input);
}

// http(s) links, plus local document paths (Windows/Linux file
// associations and `blanc file.html` pass a bare path on the command
// line; macOS double-clicks arrive via 'open-file' below instead).
const urlsFromArgv = (argv) =>
  argv.map((a) => (/^https?:\/\//.test(a) ? a : localDocumentUrl(a))).filter(Boolean);

function openExternalUrl(url) {
  if (!externalUrlsFlushable || !hasLiveWindow()) {
    pendingExternalUrls.push(url);
    return;
  }
  setActiveTab(createTab(url));
  if (win.isMinimized()) win.restore();
  win.focus();
}

// Protocols handed off to the OS instead of navigated — a mailto: click
// should open the user's mail app, not die silently (Chromium has no
// external-protocol UI in Electron). Deliberately a small allowlist:
// launching arbitrary registered URL schemes is a run-anything vector.
// Checked at every point a URL becomes a navigation target: page-initiated
// navigation (will-navigate), window.open children (setWindowOpenHandler),
// the context menu's "Open Link" actions, and typed address-bar input.
// The allowlist and trusted/confirm policy live in external-protocols.js
// (pure, unit-tested); this wrapper owns the side effects only.
let externalProtocolPromptOpen = false;
function handOffToOs(url, { trusted = false } = {}) {
  const decision = classifyExternalNavigation(url, { trusted });
  if (decision.action === 'none') return false;

  // Address-bar input is an explicit user instruction. Page-initiated
  // navigations/window.open and context-menu targets are untrusted URL data,
  // so require confirmation before launching another application. One prompt
  // at a time prevents a hostile page from flooding the desktop with dialogs.
  if (decision.action === 'open') {
    shell.openExternal(url).catch(() => {});
  } else if (!externalProtocolPromptOpen && hasLiveWindow()) {
    externalProtocolPromptOpen = true;
    const label = decision.protocol.slice(0, -1);
    dialog.showMessageBox(win, {
      type: 'question',
      title: 'Open external application?',
      message: `Open this ${label} link in another application?`,
      buttons: ['Open Link', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0) shell.openExternal(url).catch(() => {});
    }).finally(() => {
      externalProtocolPromptOpen = false;
    });
  }
  return true;
}

function flushExternalUrls() {
  externalUrlsFlushable = true;
  for (const url of pendingExternalUrls.splice(0)) openExternalUrl(url);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  openExternalUrl(url);
});

// Double-clicked local files (Blanc is declared as an HTML viewer via
// CFBundleDocumentTypes) arrive as 'open-file', not 'open-url'. Same
// queueing as links: pre-ready events wait for the window + session
// restore, then land as the active tab.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  const url = toFileUrl(filePath);
  if (url) openExternalUrl(url);
});

// Must happen before app 'ready'.
registerPagesScheme();

const chromeMajor = process.versions.chrome?.split('.')[0];
const chromeFull = process.versions.chrome;
const chromeReducedVersion = chromeMajor ? `${chromeMajor}.0.0.0` : null;

function chromeLikeUserAgent(ua) {
  let next = ua
    .replace(/\sblanc\/[\d.]+/i, '')
    .replace(/\sElectron\/[\d.]+/, '');
  if (chromeReducedVersion) {
    next = next.replace(/Chrome\/[\d.]+/, `Chrome/${chromeReducedVersion}`);
  }
  return next;
}

// Strip Electron/app tokens and use Chrome's reduced UA form so sites see
// the same low-entropy UA shape as desktop Chrome.
app.userAgentFallback = chromeLikeUserAgent(app.userAgentFallback);

// Hide the FedCM API. Must happen before app 'ready', and silently no-ops
// if Chromium ever retires the "FedCm" feature name (an Electron bump that
// brings back Google-login 400s should recheck here first — also see the
// CDP client-hints override and onBeforeSendHeaders fallback below). Chromium ships
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

// Override client-hints branding at the Chromium level via CDP so both HTTP
// Sec-CH-UA headers AND navigator.userAgentData.brands report Chrome.
// Google Identity Services checks brands client-side before opening the
// OAuth popup; onBeforeSendHeaders only patches HTTP headers and can't
// reach the JS-visible API under contextIsolation. The debugger session is
// lightweight, invisible (no infobar in Electron), and coexists with
// DevTools. Must be registered before app 'ready' so the very first
// webContents (the chrome window) is caught.
if (chromeMajor) {
  const greaseBrand = { brand: 'Not;A=Brand', version: '8' };
  const chromeBrands = [
    greaseBrand,
    { brand: 'Chromium', version: chromeMajor },
    { brand: 'Google Chrome', version: chromeMajor },
  ];
  const chromeFullVersionList = [
    { brand: greaseBrand.brand, version: `${greaseBrand.version}.0.0.0` },
    { brand: 'Chromium', version: chromeFull },
    { brand: 'Google Chrome', version: chromeFull },
  ];
  const uaMetadata = {
    brands: chromeBrands,
    fullVersionList: chromeFullVersionList,
    platform: chromeClientHintPlatform(),
    platformVersion: chromeClientHintPlatformVersion(),
    architecture: chromeClientHintArchitecture(),
    bitness: chromeClientHintBitness(),
    model: '',
    mobile: false,
    wow64: false,
  };
  app.on('web-contents-created', (_event, wc) => {
    try { wc.debugger.attach('1.3'); } catch { return; }
    wc.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: app.userAgentFallback,
      userAgentMetadata: uaMetadata,
    }).catch(() => {});
    wc.debugger.on('detach', () => {});
  });
}

/** @type {BrowserWindow | null} */
let win = null;
/** Non-persistent session shared by all private tabs for this app run. */
let privateBrowsingSession = null;
const PRIVATE_PARTITION = 'private-browsing'; // no `persist:` prefix = memory only
const getPrivateBrowsingSession = () =>
  (privateBrowsingSession ??= session.fromPartition(PRIVATE_PARTITION));

const CHROME_INDEX_FILE = path.join(__dirname, '../renderer/index.html');
const CHROME_OVERLAY_FILE = path.join(__dirname, '../renderer/overlay.html');
const CHROME_INDEX_URL = pathToFileURL(CHROME_INDEX_FILE).href;
const CHROME_OVERLAY_URL = pathToFileURL(CHROME_OVERLAY_FILE).href;

/** Privileged chrome must never become a general-purpose browser surface. */
function lockPrivilegedNavigation(wc, trustedUrl) {
  wc.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== trustedUrl) event.preventDefault();
  });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// Window background behind everything so resizes and load flashes stay
// in-theme. The renderer gets the resolved appearance at the same time: a
// nativeTheme source change reaches prefers-color-scheme asynchronously, and
// without the push the untinted strip behind the Island visibly trails the
// Settings control.
const chromeBackgroundColor = (
  appearance = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
) =>
  (appearance === 'dark' ? '#0e0e0e' : '#f4f4f1');
const resolvedThemeAppearance = () =>
  (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
let lastNativeThemeAppearance = resolvedThemeAppearance();
let appliedThemeSource = null;
let themeTintRefreshGeneration = 0;

function applyChromeThemeAppearance(appearance) {
  if (!hasLiveWindow()) return;
  const resolved = appearance === 'dark' || appearance === 'light'
    ? appearance
    : resolvedThemeAppearance();
  win.setBackgroundColor(chromeBackgroundColor(resolved));
  win.webContents.send(
    'chrome:theme-appearance',
    resolved
  );
}

function beginChromeThemeAppearance(appearance) {
  if (!hasLiveWindow()) return;
  // An explicit target can paint immediately. "system" has no trustworthy
  // cross-platform resolved value until Electron removes the prior override,
  // but the renderer can still disable its transition before that happens.
  if (appearance === 'dark' || appearance === 'light') {
    win.setBackgroundColor(chromeBackgroundColor(appearance));
  }
  win.webContents.send('chrome:theme-appearance', appearance ?? 'pending');
}

function refreshActivePageTintForThemeChange() {
  const generation = ++themeTintRefreshGeneration;
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.private || !/^https?:\/\//.test(tab.url)) return;

  // The captured top-edge pixels and meta theme-color both describe the old
  // color scheme. Drop them before the page repaints so the strip cannot keep
  // showing a stale site color during the handoff.
  const hadTint = !!(tab.pageBg || tab.themeColor);
  tab.pageBg = null;
  tab.themeColor = null;
  if (hadTint) broadcastTabs();

  // Color-scheme media queries repaint asynchronously in the tab renderer.
  // Sample across the likely repaint/transition window: the first gets the
  // common case quickly, while later passes let a site with its own CSS
  // transition settle. The generation guard prevents an older theme change's
  // captures from winning after a newer one.
  for (const delay of [32, 160, 400, 800]) {
    setTimeout(() => {
      if (generation !== themeTintRefreshGeneration) return;
      samplePageTint(tab, {
        immediate: true,
        shouldApply: () => generation === themeTintRefreshGeneration,
      });
    }, delay);
  }
}

// nativeTheme.themeSource drives prefers-color-scheme in every renderer —
// chrome UI, internal pages, and the web content itself see one theme.
function applyTheme() {
  const source = settings.getSettings().theme;
  // The settings listener runs for every preference write. Only a real theme
  // source change should invalidate and re-sample the active website tint.
  if (source === appliedThemeSource) return;
  appliedThemeSource = source;
  // Explicit choices are known before Electron does any native-theme work:
  // push them first so the strip can paint in the same interaction frame.
  // "system" must be resolved after removing the prior override.
  const explicitAppearance = source === 'dark' || source === 'light' ? source : null;
  beginChromeThemeAppearance(explicitAppearance);
  refreshActivePageTintForThemeChange();
  nativeTheme.themeSource = source;
  if (!explicitAppearance) applyChromeThemeAppearance();
}

function handleNativeThemeUpdated() {
  const appearance = resolvedThemeAppearance();
  applyChromeThemeAppearance(appearance);
  if (appearance === lastNativeThemeAppearance) return;
  lastNativeThemeAppearance = appearance;
  // Covers live OS appearance changes while the setting is "system". Explicit
  // app theme changes already invalidated before assigning themeSource; doing
  // it again here is harmless and keeps this path self-contained.
  refreshActivePageTintForThemeChange();
}

// Swap the macOS Dock icon to the chosen colorway. Packaged macOS 26+ builds
// use a named Icon Composer stack, leaving Default/Dark/Clear/Tinted rendering
// (and tint color) to macOS. Dev/older systems retain the flat PNG fallback.
function applyAppIcon() {
  // getSettings() already falls back an unauthorized/stale supporter icon
  // (hand-edited or copied settings.json) to the default — nothing further
  // to validate here.
  const { appIcon } = settings.getSettings();
  applyDockAppIcon({ app, nativeImage, appIcon });
}

const hasLiveWindow = () => !!win && !win.isDestroyed();

/** @type {Map<string, { id: string, view: WebContentsView, title: string, url: string, isLoading: boolean, canGoBack: boolean, canGoForward: boolean, favicon: string | null, bookmarked: boolean, blockedCount: number, private: boolean, pinned: boolean, muted: boolean, audible: boolean, pageBg: string | null, themeColor: string | null }>} */
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
// is just a sane default before the first report arrives — keep it in step
// with the `--strip-h` token (styles.css) so the initial web-view offset
// doesn't jump on the first layout report.
let chromeHeight = 64;

// The island's expanded states (command bar, ⌘L palette, find capsule)
// render in a separate always-on-top WebContentsView so they float OVER
// the web content instead of growing the strip and shifting content down.
// It is attached to win.contentView only while something is showing.
/** @type {WebContentsView | null} */
let overlayView = null;
/** @type {null | 'panel' | 'palette' | 'find'} */
let overlayMode = null;
/** Companion to overlayMode, replayed alongside it below if the overlay's
 * first load hadn't finished when showOverlay was called. */
let overlayPrefill = null;

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
  lockPrivilegedNavigation(overlayView.webContents, CHROME_OVERLAY_URL);
  overlayView.webContents.loadFile(CHROME_OVERLAY_FILE);

  // A show requested before the overlay document finished its first load
  // would be lost — leaving an invisible view blocking clicks. Replay it.
  overlayView.webContents.once('did-finish-load', () => {
    if (overlayMode) {
      overlayView.webContents.send('overlay:show', { mode: overlayMode, prefill: overlayPrefill });
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

function showOverlay(mode, { prefill } = {}) {
  if (!hasLiveWindow() || !overlayView) return;
  // One floating layer at a time: summoning the island dismisses the sheet
  // (the overlay takes focus itself — no tab refocus in between).
  hideUtilitySheet({ refocusContent: false });
  // Opening the panel is a freshness signal: pull other devices' tabs
  // (throttled to 1/min inside refreshSession — tab-sync spec §6).
  if (mode === 'panel' || mode === 'palette') sync.refreshSession();
  overlayMode = mode;
  overlayPrefill = prefill ?? null;
  // (Re-)adding moves the overlay to the top of the child-view stack.
  win.contentView.addChildView(overlayView);
  overlayView.setBounds(overlayBounds());
  overlayView.webContents.send('overlay:show', { mode, prefill });
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
  // Default-deny (design §4): utility→utility stays in-sheet; http(s)
  // opens a real tab (createTab's dismissal covers the sheet); approved
  // handoff protocols go to the OS; everything else — and every
  // window.open — dies.
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
}

/** Page identity, not URL spelling: each utility page is one document per
 * blanc:// host, and accepted spellings differ (typed "blanc://settings"
 * vs the menu's "blanc://settings/"). */
function sameUtilityPage(a, b) {
  try { return new URL(a).host === new URL(b).host; } catch { return false; }
}

function showUtilityPage(url) {
  if (!hasLiveWindow()) return;
  // Toggle: a direct re-invocation (menu/accelerator) of the shown page
  // closes it. Overlay-hosted entry points can never hit this — summoning
  // the overlay already dismissed the sheet.
  if (utilitySheetUrl && sameUtilityPage(utilitySheetUrl, url)) return hideUtilitySheet();
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
  // A local filename ("notes.html") looks exactly like a domain to the
  // regex below — check disk first so typing one opens it, the same way
  // double-clicking it (via urlsFromArgv/open-file) already does.
  const localDoc = localDocumentUrl(trimmed);
  if (localDoc) return localDoc;
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
const ensureSessionStore = () => (sessionStore ??= new JsonStore('session', { urls: [], activeIndex: 0, groups: [], groupIds: [], pinned: [] }));

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
  ensureSessionStore().update((d) => {
    // Private tabs leave no trail, error pages persist their real
    // destination, url-less tabs drop — all in session-snapshot.js so tab
    // sync shares the exact same filter.
    const entries = persistableEntries(tabOrder.map((id) => tabs.get(id)));
    d.urls = entries.map((e) => e.url);
    d.groupIds = entries.map((e) => e.groupId);
    d.pinned = entries.map((e) => e.pinned);
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
  tabsync.noteTabsChanged();
  if (!win || win.isDestroyed()) return;
  const payload = { tabs: serializeTabs(), activeTabId, groups };
  win.webContents.send('tabs:updated', payload);
  overlayView?.webContents.send('tabs:updated', payload);
}

function broadcastDownloadsActivity() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('chrome:downloads', downloadsActivity());
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
  if (utilitySheetUrl && utilitySheetView) {
    const b = win.getContentBounds();
    utilitySheetView.setBounds({ x: 0, y: chromeHeight, width: b.width, height: Math.max(0, b.height - chromeHeight) });
  }
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
      if (tab.bookmarked) bookmarks.updateFavicon(tab.url, best);
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
async function samplePageTint(tab, { immediate = false, shouldApply = () => true } = {}) {
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
    if (shouldApply() && color && color !== tab.pageBg) {
      tab.pageBg = color;
      if (immediate) broadcastTabs();
      else scheduleBroadcastTabs();
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
 * trailing pseudo-cluster of ungrouped, unpinned tabs. Pinned members stay
 * inside their named group and lead that group's rows; only ungrouped pins
 * use the standalone pinned shelf. Cmd/Ctrl+1–9 jump by this. */
function clusterList() {
  const list = [];
  for (const g of groups) {
    const members = tabOrder.filter((id) => tabs.get(id)?.groupId === g.id);
    const tabIds = [
      ...members.filter((id) => tabs.get(id)?.pinned),
      ...members.filter((id) => !tabs.get(id)?.pinned),
    ];
    if (tabIds.length) list.push({ group: g, tabIds });
  }
  const loose = tabOrder.filter((id) => tabs.get(id) && !tabs.get(id).groupId && !tabs.get(id).pinned);
  if (loose.length) list.push({ group: null, tabIds: loose });
  return list;
}

/** clusterList() plus a leading pseudo-cluster for ungrouped pinned tabs,
 * each slot tagged with a stable key — the one definition of "cluster order"
 * shared by Cmd/Ctrl+1–9 and the ⌥⌘ arrow navigation. */
function clusterSlots() {
  const slots = clusterList().map(({ group, tabIds }) => ({
    key: group ? group.id : 'loose',
    group,
    tabIds,
  }));
  const pinnedIds = tabOrder.filter((id) => tabs.get(id)?.pinned && !tabs.get(id)?.groupId);
  if (pinnedIds.length) slots.unshift({ key: 'pinned', group: null, tabIds: pinnedIds });
  return slots;
}

/** Cluster key → most recently active tab id there, so ⌥⌘↑/↓ lands back
 * where you were in each group. In-memory only — a remembered tab that
 * closed or moved simply fails the lookup and the first tab wins. */
const lastActiveByCluster = new Map();

function clusterKeyForTab(tab) {
  return tab.groupId ?? (tab.pinned ? 'pinned' : 'loose');
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
  scheduleMenuRebuild();
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
  scheduleMenuRebuild();
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
  const first = clusterList().find(({ group: g }) => g?.id === groupId)?.tabIds[0];
  // setActiveTab broadcasts, but no-ops when the tab is already active —
  // the unfold still has to reach the renderers.
  if (first && first !== activeTabId) setActiveTab(first);
  else broadcastTabs();
}

function closeGroup(groupId) {
  const ids = tabOrder.filter((id) => tabs.get(id)?.groupId === groupId);
  for (const id of ids) closeTab(id);
}

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
    muted: source.muted,
    // Only worth restoring if there's more than just the current page.
    restoreHistory: entries.length > 1 ? { entries, index: history.getActiveIndex() } : null,
  });
  reorderTab(newId, insertAt);
  return newId;
}

const TAB_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // Chromium's built-in PDF viewer is a plugin; without this flag
  // PDFs download instead of rendering inline.
  plugins: true,
  // Exposes a data API to our own blanc:// pages ONLY — see the guards in
  // tab-preload.js and pages.js. Ordinary web content gets only the
  // unprivileged, session-wide Chrome compatibility surface.
  preload: path.join(__dirname, 'tab-preload.js'),
};

function createTab(url = newTabUrl(), { private: isPrivate = false, groupId = null, view = null, pinned = false, muted = false, restoreHistory = null } = {}) {
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
  const id = crypto.randomUUID();
  // An adopted view (window.open child, see the window-open handler) arrives
  // already constructed by Chromium with the opener relationship wired up;
  // everything else gets a fresh one.
  const adopted = !!view;
  view ??= new WebContentsView({
    webPreferences: isPrivate
      ? { ...TAB_WEB_PREFERENCES, session: getPrivateBrowsingSession() }
      : TAB_WEB_PREFERENCES,
  });

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
    muted,
    audible: false,
    groupId: groupId && groups.some((g) => g.id === groupId) ? groupId : null,
    // Strip tint ("faux header"): the page's top-edge color, so the chrome
    // strip can paint itself as a continuation of the site's own header.
    pageBg: null, // sampled from rendered pixels — authoritative
    themeColor: null, // the page's <meta name="theme-color"> — fallback
    // Set by did-navigate from the response code; gates BOTH addVisit
    // there and updateTitle below, so a URL recorded during an earlier
    // valid visit can't have its title silently rewritten to reflect a
    // later dead reload (page-title-updated has no response code of its
    // own to check). Starts true — the split-second before a tab's first
    // real navigation shouldn't behave differently from before this flag
    // existed.
    historyEligible: true,
  };
  tabs.set(id, tab);
  tabOrder.push(id);

  const wc = view.webContents;
  // WebRTC IP-handling policy applies per-webContents; this is the single choke
  // point every tab (fresh or adopted window.open child) passes through.
  wc.setWebRTCIPHandlingPolicy(webrtcPolicyFor(settings.getSettings().webrtcPolicy));
  if (muted) wc.setAudioMuted(true); // keep the actual audio state in sync with tab.muted
  const syncNavState = () => {
    tab.canGoBack = wc.navigationHistory.canGoBack();
    tab.canGoForward = wc.navigationHistory.canGoForward();
    tab.url = wc.getURL();
    tab.bookmarked = bookmarks.isBookmarked(tab.url);
  };

  wc.on('audio-state-changed', () => {
    // Coalesced like did-change-theme-color: audio transitions aren't urgent,
    // and a media that flips audible/silent needn't rebuild the session synchronously.
    tab.audible = wc.isCurrentlyAudible();
    scheduleBroadcastTabs();
  });

  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    if (tab.historyEligible) history.updateTitle(tab.url, title);
    broadcastTabs();
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = favicons[0] ?? null; // immediate, possibly low-res
    if (tab.bookmarked) bookmarks.updateFavicon(tab.url, tab.favicon);
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
    // Only clear on a genuine CROSS-ORIGIN navigation. Chromium doesn't
    // re-fire page-favicon-updated for a same-origin navigation whose favicon
    // is unchanged/already cached (e.g. apple.com/ -> apple.com/mac/), and a
    // favicon.ico-only site has no <link> for upgradeFavicon to restore from —
    // so blanking on same-origin (or on an identical-URL soft reload, as
    // cnn.com fires) would leave a correct favicon permanently cleared. See
    // favicon-policy.js + test/unit/favicon-policy.test.js.
    if (shouldClearFaviconOnNavigate(tab.url, url)) tab.favicon = null;
    syncNavState();
    // Error responses stay out of history — a dead one-shot OAuth URL
    // recorded here resurfaces in the Quick Switcher as a destination.
    tab.historyEligible = !tab.private && (httpResponseCode ?? 200) < 400;
    if (tab.historyEligible) history.addVisit(url, wc.getTitle());
    broadcastTabs();
    // did-navigate fires once per real top-level navigation (redirect
    // chains fire it per hop, but that's a bounded burst the debounce
    // already coalesces) — not the sustained-frequency case Task 1 exists
    // to avoid. The menu's Favorites label/dynamic list depend on
    // tab.url/.bookmarked, which this event just changed via syncNavState.
    scheduleMenuRebuild();
    if (shouldReclaimChromeFocus) reclaimAddressBarFocus(id);
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    syncNavState();
    if (isMainFrame && tab.historyEligible) history.addVisit(url, wc.getTitle());
    broadcastTabs();
    // Deliberately no scheduleMenuRebuild() here — unlike did-navigate,
    // this fires on every hash change/pushState and can be sustained and
    // frequent on SPA-heavy sites (exactly the rebuild-storm case Task 1
    // avoids). The menu may lag slightly behind in-page route changes;
    // it catches up on the next real navigation or tab-lifecycle event.
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

  // Web content must never navigate a tab into the privileged blanc://
  // scheme (Chrome blocks web → chrome:// identically). Main-initiated
  // loads (address bar, commands, error pages) go through loadURL, which
  // doesn't fire will-navigate, so only page-initiated hops are caught.
  wc.on('will-navigate', (event, targetUrl) => {
    // Utility pages never load in a tab — the newtab ledger links to
    // blanc://bookmarks/ and blanc:→blanc: hops are otherwise legal. Only
    // an INTERNAL page may summon the sheet: for web content this is a
    // plain denial, same as any other web → blanc:// attempt below —
    // otherwise any page could pop (and focus-steal via) privileged chrome
    // with location.href = "blanc://settings/".
    if (isUtilityUrl(targetUrl)) {
      event.preventDefault();
      if (wc.getURL().startsWith('blanc://')) openInternalPage(targetUrl);
      return;
    }
    if (/^blanc:/i.test(targetUrl) && !wc.getURL().startsWith('blanc://')) {
      event.preventDefault();
    }
    if (handOffToOs(targetUrl)) event.preventDefault();
  });

  // Show a real error page instead of leaving a blank/stale view.
  // errorCode -3 (ERR_ABORTED) fires for cancelled loads (stop button,
  // rapid re-navigation) and must not be treated as a failure.
  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !validatedURL) return;
    const q = new URLSearchParams({ url: validatedURL, code: String(errorCode), desc: errorDescription });
    wc.loadURL(`blanc://error/?${q}`).catch(() => {});
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
    wc.loadURL(`blanc://error/?${q}`).catch(() => {});
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
  // matters on blanc:// pages, and the guards below keep web content
  // from opening or navigating into blanc:// at all.
  // Cmd/Ctrl+click arrives as 'background-tab' — open it without stealing
  // focus (browser convention). Children of a private tab stay private —
  // a popup must not silently start recording history again. Applied
  // recursively via did-create-window so a popup's own window.open
  // children (a "Terms" link inside an OAuth popup) land back in managed
  // tabs instead of falling through to bare Electron windows.
  const applyWindowOpenPolicy = (targetWc) => {
    targetWc.setWindowOpenHandler(({ url: targetUrl, disposition }) => {
      // Utility pages never become tabs — and an adopted child must never
      // reach createTab's guard: by createWindow time the guest webContents
      // already exists, and a null return would leave it half-built and
      // unmanaged. Deny the child outright, and route to the sheet ONLY
      // for an internal opener — web content asking for a blanc:// child
      // gets the same silent denial it always did, never a focused sheet.
      if (isUtilityUrl(targetUrl)) {
        if (targetWc.getURL().startsWith('blanc://')) openInternalPage(targetUrl);
        return { action: 'deny' };
      }
      // Web content must not mint privileged internal pages (Chrome blocks
      // web → chrome:// the same way). Only blanc:// pages themselves may
      // open blanc:// children.
      if (/^blanc:/i.test(targetUrl) && !targetWc.getURL().startsWith('blanc://')) {
        return { action: 'deny' };
      }
      // target="_blank" mailto:/tel: links otherwise spawn a dead child
      // tab — hand them to the OS like the will-navigate path does.
      if (handOffToOs(targetUrl)) return { action: 'deny' };
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
    // "Open Link in New Tab"/"Open Link" on a mailto:/tel: link otherwise
    // creates a dead tab — createTab() has no chance to check, since it
    // never sees the raw link URL as a page navigation.
    openBackgroundTab: (targetUrl) => {
      if (handOffToOs(targetUrl)) return;
      createTab(targetUrl, { private: tab.private, groupId: tab.groupId });
    },
    openTab: (targetUrl) => {
      if (handOffToOs(targetUrl)) return;
      setActiveTab(createTab(targetUrl, { private: tab.private, groupId: tab.groupId }));
    },
  });

  // Load failures surface via the did-fail-load handler above; the
  // rejected promise here is the same event and must not crash main.
  // Adopted window.open children are loaded by Chromium itself as part of
  // the window-open dance — a competing loadURL here would cancel it.
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

function setActiveTab(id, { focusContent = true, focusAddress = false } = {}) {
  const next = tabs.get(id);
  if (!next) return;
  // A script-closed adopted tab prunes itself via its 'destroyed' handler,
  // but a deferred activation (the window-open setImmediate) can race the
  // event — never attach or focus a dead webContents.
  if (next.view.webContents.isDestroyed()) return;

  // Re-selecting the active tab is a no-op.
  if (id === activeTabId) return;

  // Tab switches dismiss the sheet; the switched-to tab takes focus via
  // the existing flow below.
  hideUtilitySheet({ refocusContent: false });

  lastActiveByCluster.set(clusterKeyForTab(next), id);

  // No window to attach to (quitting, or macOS with all windows closed):
  // just track the selection so window recreation attaches the right tab.
  // The menu bar persists on macOS even with no windows open, so it still
  // needs to reflect the new activeTabId.
  if (!hasLiveWindow()) {
    activeTabId = id;
    scheduleMenuRebuild();
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
  // The freshly attached tab view must not stack above an open overlay —
  // nor above the sheet (defensive: §5 means they shouldn't coexist here,
  // but a race must never paint a tab over either floating layer).
  if (utilitySheetUrl && utilitySheetView) win.contentView.addChildView(utilitySheetView);
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
  scheduleMenuRebuild();
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
  if (tab.url && !tab.private && !tab.url.startsWith('blanc://newtab')) {
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
    if (hasLiveWindow()) return; // setActiveTab already broadcasts and schedules a menu rebuild
  }
  broadcastTabs();
  scheduleMenuRebuild();
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
  scheduleMenuRebuild();
}

/** Cmd/Ctrl+1–9. With groups: n jumps to the nth cluster — a group's
 * first tab, unfolding it (Island Tab Groups design). Without groups the
 * browser convention stands: 1–8 jump to that tab, 9 to the last. */
function selectTabAtIndex(index) {
  // clusterSlots() surfaces ungrouped pins as a leading slot. Grouped pins
  // remain reachable through their group's own slot.
  const slots = clusterSlots();
  if (groups.length && slots.length) {
    const slot = slots[index];
    if (!slot) return;
    if (slot.group) focusGroup(slot.group.id);
    else setActiveTab(slot.tabIds[0]);
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

/** ⌥⌘←/→: previous/next tab within the active tab's cluster, wrapping.
 * With no groups and no pins everything is one loose cluster, so this
 * degrades to plain tab cycling (same result as Ctrl+Tab). */
function cycleTabInCluster(direction) {
  if (!activeTabId) return;
  const slot = clusterSlots().find((s) => s.tabIds.includes(activeTabId));
  if (!slot) return cycleTab(direction);
  if (slot.tabIds.length < 2) return;
  const i = slot.tabIds.indexOf(activeTabId);
  setActiveTab(slot.tabIds[(i + direction + slot.tabIds.length) % slot.tabIds.length]);
}

/** ⌥⌘↑/↓: previous/next cluster in ⌘1–9 order (ungrouped pinned
 * shelf → groups → loose), wrapping. Lands on the cluster's last-active
 * tab and unfolds a collapsed group, consistent with focusGroup(). */
function cycleCluster(direction) {
  if (!activeTabId) return;
  const slots = clusterSlots();
  if (slots.length < 2) return;
  const from = slots.findIndex((s) => s.tabIds.includes(activeTabId));
  if (from === -1) return;
  const target = slots[(from + direction + slots.length) % slots.length];
  if (target.group) target.group.collapsed = false;
  const remembered = lastActiveByCluster.get(target.key);
  setActiveTab(target.tabIds.includes(remembered) ? remembered : target.tabIds[0]);
}

/** Focus an existing tab already on this internal page, or open one. */
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

function toggleBookmarkForActiveTab() {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.private || !/^https?:\/\//.test(tab.url)) return;
  tab.bookmarked = bookmarks.toggleBookmark(tab.url, tab.title, tab.favicon);
  broadcastTabs();
  scheduleMenuRebuild();
}

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

/** "Add All Open Tabs to Favorites" — mirrors toggleBookmarkForActiveTab's
 * own URL guard. Skips private tabs (favorites never populate from private
 * browsing) and anything already favorited (idempotent). */
function addAllTabsToFavorites() {
  for (const id of tabOrder) {
    const tab = tabs.get(id);
    if (!tab || tab.private) continue;
    if (!/^https?:\/\//.test(tab.url)) continue;
    if (bookmarks.isBookmarked(tab.url)) continue;
    tab.bookmarked = bookmarks.toggleBookmark(tab.url, tab.title, tab.favicon);
  }
  broadcastTabs();
  scheduleMenuRebuild();
}

/** Bookmark state can change from the bookmarks page; re-derive per tab. */
function refreshBookmarkFlags() {
  for (const tab of tabs.values()) tab.bookmarked = bookmarks.isBookmarked(tab.url);
  broadcastTabs();
  scheduleMenuRebuild();
}

const ZOOM_STEP = 0.5;
const ZOOM_MIN = -8;
const ZOOM_MAX = 8;

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

// The predicate itself lives in ipc-trust.js (pure, unit-tested); this
// wrapper only supplies the live trusted surfaces.
function isTrustedChromeSender(event) {
  return isTrustedSender(event, [
    hasLiveWindow() ? { webContents: win.webContents, url: CHROME_INDEX_URL } : null,
    overlayView && !overlayView.webContents.isDestroyed()
      ? { webContents: overlayView.webContents, url: CHROME_OVERLAY_URL }
      : null,
  ]);
}

function chromeHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedChromeSender(event)) throw new Error(`${channel}: denied for untrusted sender`);
    return handler(event, ...args);
  });
}

function chromeOn(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedChromeSender(event)) {
      console.warn(`[ipc] ${channel}: denied for untrusted sender`);
      return;
    }
    handler(event, ...args);
  });
}

function registerIpcHandlers() {
  chromeHandle('tabs:create', (_e, url, opts) => {
    const isPrivate = !!opts?.private;
    // A plain new tab is deliberately ungrouped — createTab defaults groupId
    // to null and we intentionally don't pass one. Only window.open/context-
    // menu children inherit the opener's group (see CLAUDE.md → Tab groups);
    // don't copy that `groupId: tab.groupId` pattern into new-tab entry points.
    const id = createTab(url || (isPrivate ? PRIVATE_NEW_TAB_URL : newTabUrl()), {
      private: isPrivate,
    });
    // A blank "New Tab" (no explicit url) is normally a launchpad — keep OS
    // focus on the chrome so the address bar can take it. A url means the
    // caller has somewhere specific to go, so focus the page content. The
    // island footer's New-tab/Private buttons opt out with focusAddress:false:
    // they close the panel and land the user directly on the fresh tab rather
    // than re-summoning the launchpad.
    const blank = !url;
    const focusAddress = opts?.focusAddress ?? blank;
    setActiveTab(id, { focusContent: !focusAddress, focusAddress });
    return id;
  });
  chromeHandle('tabs:close', (_e, id) => closeTab(id));
  chromeHandle('tabs:switch', (_e, id) => setActiveTab(id));
  chromeHandle('tabs:navigate', (_e, id, url) => {
    const tab = tabs.get(id);
    if (!tab) return;
    // Checked against the raw address-bar text, before normalizeAddressInput
    // — a bare mailto:/tel: URI has no "://" and would otherwise fall
    // through its domain-guessing heuristic into an unreachable https:// URL.
    if (handOffToOs(url, { trusted: true })) return;
    const target = normalizeAddressInput(url);
    // A typed utility address opens the sheet, never navigates the tab.
    if (isUtilityUrl(target)) return openInternalPage(target);
    tabsWantingAddressBarFocus.delete(id);
    tab.view.webContents.loadURL(target);
  });
  chromeHandle('tabs:back', (_e, id) => tabs.get(id)?.view.webContents.navigationHistory.goBack());
  chromeHandle('tabs:forward', (_e, id) => tabs.get(id)?.view.webContents.navigationHistory.goForward());
  chromeHandle('tabs:reload', (_e, id) => tabs.get(id)?.view.webContents.reload());
  chromeHandle('tabs:stop', (_e, id) => tabs.get(id)?.view.webContents.stop());
  chromeHandle('tabs:reorder', (_e, id, toIndex) => reorderTab(id, toIndex));
  chromeHandle('tabs:set-group', (_e, id, groupId) => setTabGroup(id, groupId ?? null));
  chromeHandle('tabs:group-by-name', (_e, id, name) => groupTabByName(id, name));
  chromeHandle('tabs:toggle-group-collapsed', (_e, groupId) => toggleGroupCollapsed(groupId));
  chromeHandle('tabs:focus-group', (_e, groupId) => focusGroup(groupId));
  chromeHandle('tabs:close-group', (_e, groupId) => closeGroup(groupId));
  chromeHandle('tabs:toggle-bookmark', () => toggleBookmarkForActiveTab());
  chromeHandle('tabs:save-favorite', (_e, folder) => saveActiveTabAsFavorite(folder));
  chromeHandle('tabs:toggle-pinned', (_e, id) => toggleTabPinned(id));
  chromeHandle('tabs:toggle-muted', (_e, id) => toggleTabMuted(id));
  chromeHandle('tabs:duplicate', (_e, id) => duplicateTab(id));
  chromeHandle('tabs:open-page', (_e, name) => {
    if (['bookmarks', 'history', 'downloads', 'settings'].includes(name)) {
      openInternalPage(`blanc://${name}/`);
    }
  });
  chromeHandle('tabs:get-all', () => ({ tabs: serializeTabs(), activeTabId, groups }));
  chromeHandle('tabs:find', (_e, id, query, options) => tabs.get(id)?.view.webContents.findInPage(query, options));
  chromeHandle('tabs:find-stop', (_e, id) => tabs.get(id)?.view.webContents.stopFindInPage('clearSelection'));

  chromeOn('chrome:layout', (_e, { height }) => {
    if (typeof height === 'number' && height > 0) {
      chromeHeight = height;
      resizeActiveView();
    }
  });

  chromeOn('chrome:open-island', () => showOverlay('panel'));
  chromeOn('chrome:open-find', () => showOverlay('find'));
  chromeOn('overlay:close', () => hideOverlay());
  chromeOn('chrome:downloads-ack', () => {
    acknowledgeDownloads();
    broadcastDownloadsActivity();
  });

  // Data + actions behind the island's slash commands and Quick Switcher.
  chromeHandle('chrome:history-list', (_e, opts) => history.listHistory(opts ?? {}));
  chromeHandle('chrome:favorites-list', () => bookmarks.listBookmarks());
  chromeHandle('chrome:remote-tabs-list', () => sync.listRemoteDevices());
  chromeHandle('chrome:history-clear', () => history.clearHistory());
  chromeHandle('chrome:adblock-toggle', () => {
    const next = !settings.getSettings().adblockEnabled;
    settings.setSettings({ adblockEnabled: next });
    return next;
  });
  // "/allow-ads" — allow ads on the active tab's site, then reload it so
  // the exception actually takes effect on what's shown.
  chromeHandle('chrome:adblock-exempt-active', () => {
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
  chromeHandle('chrome:cycle-theme', () => {
    const order = ['system', 'light', 'dark'];
    const current = settings.getSettings().theme;
    const next = order[(order.indexOf(current) + 1) % order.length];
    settings.setSettings({ theme: next });
    return next;
  });

  chromeOn('window:minimize', () => win?.minimize());
  chromeOn('window:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  chromeOn('window:close', () => win?.close());
}

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

/** Native-menu items for every open tab in cluster order (matching the pill
 * and panel switcher), with pins first within their own cluster. Clicking jumps to it.
 * Titles/domains reflect state as of the last menu rebuild, not the
 * current instant — see the Global Constraints note on this. */
function tabMenuItems() {
  // Private tabs leave no trace anywhere else in the app (history, session,
  // favorites) — the native menu must not be the one place that leaks a
  // private tab's real title/domain.
  const orderedIds = clusterSlots()
    .flatMap((slot) => slot.tabIds)
    .filter((id) => !tabs.get(id)?.private);
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
      label: escapeMenuLabel(label.length > 120 ? `${label.slice(0, 119)}…` : label),
      type: 'checkbox',
      checked: id === activeTabId,
      click: () => setActiveTab(id),
    };
  });
}

/** Double a literal '&' so native menus on Windows/Linux don't swallow it as
 * an Alt-mnemonic (macOS has no mnemonics). Apply to every menu label built
 * from user content — tab/favorite titles and folder names. */
const escapeMenuLabel = (label) => (process.platform === 'darwin' ? label : label.replace(/&/g, '&&'));

/** Native Favorites-menu items: folder submenus first (alphabetical), then
 * ungrouped favorites inline — mirroring the Favorites page. */
function favoritesMenuItems() {
  const label = (b) => {
    const t = b.title || b.url;
    return t.length > 120 ? `${t.slice(0, 119)}…` : t;
  };
  const open = (b) => ({ label: escapeMenuLabel(label(b)), click: () => setActiveTab(createTab(b.url)) });
  // Folders as submenus first (alphabetical), then ungrouped favorites inline —
  // mirroring the Favorites page. Everything is shown; folders keep the menu
  // navigable regardless of favorite count (no flat cap on ungrouped either).
  const { folders, ungrouped } = groupFavoritesForMenu(bookmarks.listBookmarks());
  const items = folders.map((f) => ({ label: escapeMenuLabel(f.name), submenu: f.items.map(open) }));
  if (folders.length && ungrouped.length) items.push({ type: 'separator' });
  items.push(...ungrouped.map(open));
  return items;
}

// --- Keyboard shortcuts inventory (Help → Keyboard Shortcuts page) ---

/** 'Alt+CmdOrCtrl+Left' → '⌥⌘←' on macOS, 'Alt+Ctrl+Left' elsewhere —
 * same per-platform glyph convention the overlay uses. */
function formatAccelerator(accelerator) {
  const parts = String(accelerator).split('+');
  const key = parts.pop();
  const KEYS = { Left: '←', Right: '→', Up: '↑', Down: '↓', Plus: '+' };
  const label = KEYS[key] ?? key;
  if (process.platform !== 'darwin') {
    return [...parts.map((m) => (m === 'CmdOrCtrl' || m === 'CommandOrControl' ? 'Ctrl' : m)), label].join('+');
  }
  const MAC = { CmdOrCtrl: '⌘', CommandOrControl: '⌘', Cmd: '⌘', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' };
  const order = ['⌃', '⌥', '⇧', '⌘'];
  const mods = parts.map((m) => MAC[m] ?? m).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...mods, label].join('');
}

/** Rows for blanc://shortcuts/, read from the LIVE application menu so the
 * page can never drift from the real bindings, plus static extras for the
 * island's non-menu keys. Hidden items (silent aliases like ⌘=) are
 * skipped; the nine ⌘1–9 items collapse into one row. */
function listShortcuts() {
  const rows = [];
  let collapsedTabJumps = false;
  // Walk each top-level menu's whole tree, not just its first level, so an
  // accelerator nested inside a submenu (e.g. Help → Keyboard Shortcuts →
  // Show All Shortcuts…, ⌘/) is still catalogued.
  const collect = (items, category) => {
    for (const item of items ?? []) {
      if (item.submenu) { collect(item.submenu.items, category); continue; }
      if (!item.accelerator || item.visible === false) continue;
      if (/^CmdOrCtrl\+[1-9]$/.test(item.accelerator)) {
        if (!collapsedTabJumps) {
          collapsedTabJumps = true;
          rows.push({ category, label: 'Tab or Group 1–9', keys: `${formatAccelerator('CmdOrCtrl+1')}–9` });
        }
        continue;
      }
      rows.push({ category, label: item.label, keys: formatAccelerator(item.accelerator) });
    }
  };
  for (const top of Menu.getApplicationMenu()?.items ?? []) {
    collect(top.submenu?.items, top.label);
  }
  const mod = process.platform === 'darwin' ? '⌘' : 'Ctrl+';
  rows.push(
    { category: 'Island', label: 'Dismiss island panel / find bar', keys: 'Esc' },
    { category: 'Island', label: 'Open address or run command (in command bar)', keys: 'Return' },
    { category: 'Island', label: 'Open link in background tab', keys: `${mod}click` },
  );
  return rows;
}

// Also listed in overlay.js's COMMANDS and pages/shortcuts.js's
// SLASH_COMMANDS — keep all three in sync when adding or changing a command.
const SLASH_COMMANDS = [
  ['/favorites', 'Open favorites'],
  ['/save [folder]', 'Save this page to favorites, into a folder if you name one'],
  ['/history', 'Open browsing history'],
  ['/downloads', 'Open downloads'],
  ['/settings', 'Open settings'],
  ['/clear', 'Clear browsing history'],
  ['/new', 'Open a new tab'],
  ['/private', 'Open a private tab (history stays untouched)'],
  ['/close', 'Close this tab'],
  ['/pin', 'Pin or unpin this tab'],
  ['/mute', 'Mute or unmute this tab'],
  ['/group <name>', 'Move this tab into a group, creating it on first use'],
  ['/ungroup', 'Take this tab out of its group'],
  ['/close-group', 'Close every tab in this group'],
  ['/find', 'Find in page'],
  ['/block-ads', 'Toggle ad & tracker blocking'],
  ['/allow-ads', 'Allow ads on this site'],
  ['/theme', 'Cycle appearance (system → light → dark)'],
];

// A hand-picked subset of the full inventory (blanc://shortcuts/, via
// listShortcuts()) for a quick reference right in the Help menu — not
// exhaustive by design, "Show All Shortcuts…" links to the rest.
const COMMON_KEYSTROKES = [
  ['New Tab', 'CmdOrCtrl+T'],
  ['New Private Tab', 'CmdOrCtrl+Shift+N'],
  ['Close Tab', 'CmdOrCtrl+W'],
  ['Reopen Closed Tab', 'CmdOrCtrl+Shift+T'],
  ['Search & Commands', 'CmdOrCtrl+L'],
  ['Find in Page', 'CmdOrCtrl+F'],
  ['Next Tab', 'Ctrl+Tab'],
  ['Previous Tab', 'Ctrl+Shift+Tab'],
  ['Next Tab in Group', 'Alt+CmdOrCtrl+Right'],
  ['Previous Tab in Group', 'Alt+CmdOrCtrl+Left'],
  ['Next Group', 'Alt+CmdOrCtrl+Down'],
  ['Previous Group', 'Alt+CmdOrCtrl+Up'],
];

function buildMenu() {
  const isMac = process.platform === 'darwin';
  // On Windows/Linux native menus a lone "&" marks the next char as an Alt
  // mnemonic and is swallowed; a literal ampersand must be doubled. macOS
  // has no mnemonics, so leave labels untouched there.
  const mn = escapeMenuLabel; // literal '&' → '&&' on Win/Linux; see helper
  const favItems = favoritesMenuItems(); // computed once; drives the separator below
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
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => setActiveTab(createTab(newTabUrl()), { focusContent: false, focusAddress: true }) },
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
        { label: mn('Search & Commands'), accelerator: 'CmdOrCtrl+L', click: () => { if (hasLiveWindow()) { win.focus(); showOverlay('palette'); } } },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: openFindBar },
        { label: 'Reload Tab', accelerator: 'CmdOrCtrl+R', click: () => activeTabId && tabs.get(activeTabId)?.view.webContents.reload() },
        { label: 'Hard Reload Tab (Bypass Cache)', accelerator: 'CmdOrCtrl+Shift+R', click: () => activeTabId && tabs.get(activeTabId)?.view.webContents.reloadIgnoringCache() },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => zoomActiveTab(ZOOM_STEP) },
        // Plus requires Shift on most keyboards; Cmd/Ctrl+= is the common alternate, bound silently to the same action.
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, click: () => zoomActiveTab(ZOOM_STEP) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoomActiveTab(-ZOOM_STEP) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: resetZoomForActiveTab },
        { type: 'separator' },
        { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: () => openInternalPage('blanc://downloads/') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => openInternalPage('blanc://settings/') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => cycleTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycleTab(-1) },
        { label: 'Next Tab in Group', accelerator: 'Alt+CmdOrCtrl+Right', click: () => cycleTabInCluster(1) },
        { label: 'Previous Tab in Group', accelerator: 'Alt+CmdOrCtrl+Left', click: () => cycleTabInCluster(-1) },
        { label: 'Next Group', accelerator: 'Alt+CmdOrCtrl+Down', click: () => cycleCluster(1) },
        { label: 'Previous Group', accelerator: 'Alt+CmdOrCtrl+Up', click: () => cycleCluster(-1) },
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
          enabled: tabOrder.some((id) => {
            const tab = tabs.get(id);
            return tab && !tab.private && /^https?:\/\//.test(tab.url) && !bookmarks.isBookmarked(tab.url);
          }),
          click: addAllTabsToFavorites,
        },
        { type: 'separator' },
        ...favItems,
        // Only divide the favorites list from Show Favorites when there ARE
        // favorites — otherwise the two separators would collapse into one gap.
        ...(favItems.length ? [{ type: 'separator' }] : []),
        { label: 'Show Favorites', accelerator: isMac ? 'Cmd+Alt+B' : 'Ctrl+Shift+O', click: () => openInternalPage('blanc://bookmarks/') },
        { label: 'Show History', accelerator: 'CmdOrCtrl+Y', click: () => openInternalPage('blanc://history/') },
      ],
    },
    {
      label: 'Help',
      ...(isMac ? { role: 'help' } : {}),
      submenu: [
        {
          label: 'Slash Commands',
          // Plain reference rows, not disabled — legible at a glance, and a
          // stray click just closes the menu since none of them has a handler.
          submenu: SLASH_COMMANDS.map(([cmd, hint]) => ({ label: mn(`${cmd} — ${hint}`) })),
        },
        {
          label: 'Keyboard Shortcuts',
          submenu: [
            ...COMMON_KEYSTROKES.map(([label, accelerator]) => ({ label: mn(`${label} — ${formatAccelerator(accelerator)}`) })),
            { label: `Tab or Group 1–9 — ${formatAccelerator('CmdOrCtrl+1')}–9` },
            { type: 'separator' },
            { label: 'Show All Shortcuts…', accelerator: 'CmdOrCtrl+/', click: () => openInternalPage('blanc://shortcuts/') },
          ],
        },
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

  lockPrivilegedNavigation(win.webContents, CHROME_INDEX_URL);
  win.loadFile(CHROME_INDEX_FILE);
  createOverlay();
  win.on('resize', resizeActiveView);
  win.on('focus', refocusAddressBarIfWanted);
  win.on('closed', () => {
    win = null;
    // Unlike tabs, the overlay doesn't outlive its window — recreated fresh.
    overlayMode = null;
    if (overlayView && !overlayView.webContents.isDestroyed()) overlayView.webContents.close();
    overlayView = null;
    // The sheet doesn't outlive its window either — dropping the reference
    // without closing would leak the webContents.
    if (utilitySheetView && !utilitySheetView.webContents.isDestroyed()) utilitySheetView.webContents.close();
    utilitySheetView = null;
    utilitySheetUrl = null;
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

// Re-apply the current WebRTC policy to every open tab (used when the setting changes).
function applyWebrtcPolicyToAllTabs() {
  const policy = webrtcPolicyFor(settings.getSettings().webrtcPolicy);
  for (const tab of tabs.values()) {
    tab.view.webContents.setWebRTCIPHandlingPolicy(policy);
  }
}

// Last-applied encrypted-DNS values, so onSettingsChanged only reconfigures the
// resolver + clears its cache when DNS actually changes — the listener fires on
// every settings write, and clearing the cache mid-session isn't free.
let lastSecureDns = null;
let lastSecureDnsTemplate = null;

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  const privateSes = getPrivateBrowsingSession();
  const browsingSessions = [ses, privateSes];
  // Encrypted DNS (DoH). app.configureHostResolver is process-wide in Electron 43
  // (an App method) and must run after 'ready'. ONE call covers every session,
  // including the private-browsing session, so private tabs inherit it by
  // construction. Deliberately no enableBuiltInResolver — forcing it would move the
  // Off position off the system resolver on Win/Linux.
  {
    lastSecureDns = settings.getSettings().secureDns;
    lastSecureDnsTemplate = settings.getSettings().secureDnsTemplate;
    app.configureHostResolver(hostResolverOptionsFor(lastSecureDns, lastSecureDnsTemplate));
  }

  // Enables device-bound Touch ID passkeys in signed macOS builds. Existing
  // iCloud Passwords passkeys remain gated on Apple's browser entitlement.
  setupWebAuthn({
    app,
    session: browsingSessions,
    dialog,
    getParentWindow: () => (hasLiveWindow() ? win : null),
  });

  // Unlike a webPreferences preload, a session preload also reaches adopted
  // target=_blank children without replacing the Chromium-created opener
  // context. Google Identity Services can use either a popup or tab-style
  // child depending on the relying site, so the Chrome compatibility surface
  // must cover both paths.
  for (const browsingSession of browsingSessions) {
    browsingSession.registerPreloadScript({
      type: 'frame',
      filePath: path.join(__dirname, 'chrome-compat-preload.js'),
    });
  }

  // Fallback: patch Sec-CH-UA HTTP headers for webContents where the CDP
  // debugger couldn't attach (e.g. already in use). The CDP override above
  // handles both HTTP and navigator.userAgentData; this catches leftovers.
  // Replaces the entire value to match Chrome's exact brand format, and
  // adds the header if absent (Electron may omit it on first request to
  // an origin before the server's Accept-CH response arrives). Electron
  // only allows ONE listener per webRequest event per session (same
  // constraint adblock.js documents for onBeforeRequest) — if a future
  // feature also needs onBeforeSendHeaders, compose inside this handler
  // rather than registering a second one.
  if (chromeMajor) {
    const chUa = `"Not;A=Brand";v="8", "Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}"`;
    const chUaFull = `"Not;A=Brand";v="8.0.0.0", "Chromium";v="${chromeFull}", "Google Chrome";v="${chromeFull}"`;
    const setHeader = (headers, name, value, { add = false } = {}) => {
      const existing = Object.keys(headers).find((key) => key.toLowerCase() === name);
      if (existing || add) headers[existing || name] = value;
    };
    for (const browsingSession of browsingSessions) {
      browsingSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
        const h = details.requestHeaders;
        setHeader(h, 'sec-ch-ua', chUa, { add: true });
        // High-entropy hint: only rewrite it when Chromium already decided to
        // send it (i.e. the server negotiated it via Accept-CH), matching real
        // Chrome — don't force it onto every request like the low-entropy hints.
        setHeader(h, 'sec-ch-ua-full-version-list', chUaFull);
        setHeader(h, 'sec-ch-ua-platform', `"${chromeClientHintPlatform()}"`);
        setHeader(h, 'sec-ch-ua-platform-version', `"${chromeClientHintPlatformVersion()}"`);
        setHeader(h, 'sec-ch-ua-arch', `"${chromeClientHintArchitecture()}"`);
        setHeader(h, 'sec-ch-ua-bitness', `"${chromeClientHintBitness()}"`);
        setHeader(h, 'sec-ch-ua-model', '""');
        setHeader(h, 'sec-ch-ua-mobile', '?0');
        setHeader(h, 'sec-ch-ua-wow64', '?0');
        callback({ requestHeaders: h });
      });
    }
  }

  applyTheme();
  lastNativeThemeAppearance = resolvedThemeAppearance();
  applyAppIcon();
  if (settings.getSettings().usagePing) sendLaunchPing();
  // Also follow a live OS appearance change while the preference is "system".
  nativeTheme.on('updated', handleNativeThemeUpdated);

  setupPermissionPolicy(ses);
  setupPermissionPolicy(privateSes, { persistDecisions: false });
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
  chromeOn('permissions:respond', (_e, { id, allow }) => {
    pendingPermissionPrompts.get(id)?.(!!allow);
    pendingPermissionPrompts.delete(id);
  });

  setupDownloads(ses, broadcastDownloadsActivity);
  setupDownloads(privateSes, broadcastDownloadsActivity);
  setupPages({
    sessions: browsingSessions,
    onDataChanged: refreshBookmarkFlags,
    // Parent for the favorites-import file dialog (evaluated lazily at click).
    getMainWindow: () => (hasLiveWindow() ? win : undefined),
    // Utility sheet: only the sheet view itself may close the sheet — the
    // strict pages:surface:close guard verifies the sender against this.
    utilitySheet: {
      isSheetSender: (wc) => !!utilitySheetView && wc === utilitySheetView.webContents,
      close: () => hideUtilitySheet(),
    },
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
      remoteDevices: () => sync.listRemoteDevices(),
    },
    shortcuts: { list: listShortcuts },
  });

  // The acceptance harness launches offline: skip the network ad-engine build
  // (getBlocker() stays null, and the listener below is null-safe) and install
  // the test-only main-process surface instead. Gate is airtight — only an
  // UNPACKAGED dev run with BLANC_TEST exactly "1"; never a packaged build, and
  // BLANC_TEST=0/false stays off.
  const isAcceptanceTest = !app.isPackaged && process.env.BLANC_TEST === '1';
  if (isAcceptanceTest) {
    require('./test-hook').install({
      tabs, getTabOrder: () => tabOrder, getGroups: () => groups, getActiveTabId: () => activeTabId, clusterSlots,
      createTab, setActiveTab, closeTab, duplicateTab, toggleTabPinned, groupTabByName, reopenClosedTab, newTabUrl,
      normalizeAddressInput, handoffProtocols: HANDOFF_PROTOCOLS, openInternalPage, openFindBar,
      getOverlayMode: () => overlayMode, showOverlay, getPrivateBrowsingSession,
      showUtilityPage, hideUtilitySheet,
      getUtilitySheetState: () => ({ visible: !!utilitySheetUrl, url: utilitySheetUrl }),
      getUtilitySheetWebContents: () => utilitySheetView?.webContents ?? null,
      attemptChromeNavigation: (url) => win?.webContents.executeJavaScript(
        `location.href = ${JSON.stringify(String(url))}`
      ),
      getChromeUrl: () => win?.webContents.getURL() ?? '',
    });
  } else {
    await setupAdBlocker(ses, { enabled: settings.getSettings().adblockEnabled });
    attachAdBlockerToSession(privateSes, { enabled: settings.getSettings().adblockEnabled });
  }

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
    // WebRTC reapply is unconditional — setWebRTCIPHandlingPolicy is a cheap,
    // idempotent per-tab call and settings writes are infrequent/user-initiated.
    applyWebrtcPolicyToAllTabs();
    if (s.secureDns !== lastSecureDns || s.secureDnsTemplate !== lastSecureDnsTemplate) {
      lastSecureDns = s.secureDns;
      lastSecureDnsTemplate = s.secureDnsTemplate;
      app.configureHostResolver(hostResolverOptionsFor(s.secureDns, s.secureDnsTemplate));
      // Clear cached lookups on both sessions so the new resolver takes effect without
      // a restart. clearHostResolverCache returns a promise; Promise.allSettled collects
      // any rejection so a failed clear can't surface as an unhandled rejection.
      Promise.allSettled(browsingSessions.map((sess) => sess.clearHostResolverCache()));
    }
  });

  // Live tab state for tab sync's snapshot builder. Must be registered
  // before sync.init() so the launch sync can publish.
  tabsync.setSnapshotProvider(() => ({
    tabList: tabOrder.map((id) => tabs.get(id)).filter(Boolean),
    groups,
  }));
  // A pull changed the cached device map: push the fresh list to the open
  // surfaces (overlay panel; any tab currently on the start page).
  tabsync.onRemoteChanged(() => {
    const devices = sync.listRemoteDevices();
    overlayView?.webContents.send('chrome:remote-tabs-updated', devices);
    for (const tab of tabs.values()) {
      if (tab.url?.startsWith('blanc://newtab')) {
        tab.view.webContents.send('pages:start:remote-tabs', devices);
      }
    }
  });
  // Profile sync: sync-on-launch if configured, then follow local changes.
  // Runs after stores + setupPages so its triggers see a live app; failures
  // are swallowed and surfaced only in Settings (never block startup).
  sync.init();
  // Freshness pull when Blanc regains focus (tab-sync spec §6; throttled inside).
  app.on('browser-window-focus', () => sync.refreshSession());
  // Best-effort final push — fire-and-forget, never blocks quit (spec §6).
  app.on('before-quit', () => { sync.syncNow().catch(() => {}); });
  // A sync pull that merged in favorites from another device refreshes the
  // pill's favorite state; open internal pages still pull on their next load,
  // as with any cross-surface bookmark change.
  bookmarks.onMerged(refreshBookmarkFlags);

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
  // Stale sessions from before the utility sheet may hold utility-page
  // tabs; drop them (zipped — groupIds/pinned/activeIndex stay aligned)
  // so the createTab replay never routes through the sheet guard.
  const cleaned = filterRestoredSession(saved, isUtilityUrl);
  saved.urls = cleaned.urls;
  saved.groupIds = cleaned.groupIds;
  saved.pinned = cleaned.pinned;
  saved.activeIndex = cleaned.activeIndex;
  // Groups first, so createTab's groupId validation sees them.
  groups = (Array.isArray(saved.groups) ? saved.groups : [])
    .filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string')
    .map((g) => ({ id: g.id, name: g.name, collapsed: !!g.collapsed }));
  const restoredIds = saved.urls.map((u, i) => createTab(u, { groupId: saved.groupIds?.[i] ?? null, pinned: !!saved.pinned?.[i] }));
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
