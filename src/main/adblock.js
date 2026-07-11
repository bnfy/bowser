const { app, ipcMain, webContents } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const { installScriptletIsolation } = require('./adblock-scriptlets');
const {
  isWebContentsExcepted,
  installCosmeticExceptionHandlers,
} = require('./adblock-exceptions');

// Cache the compiled filter engine on disk so we don't re-fetch and
// re-parse EasyList/EasyPrivacy on every launch. The engine validates the
// cache against its own format version and rebuilds automatically when the
// library updates; delete the file to force a refresh of the block lists.
const CACHE_VERSION = 2;
const cachePath = () =>
  path.join(app.getPath('userData'), `adblock-engine.v${CACHE_VERSION}.bin`);

/** @type {ElectronBlocker | null} */
let blocker = null;
/** Every browsing session protected by the shared blocker engine. */
const attachedSessions = new Set();

/** Read live (not cached) so edits to the exception list apply immediately. */
function isExcepted(details) {
  if (typeof details.webContentsId !== 'number') return false;
  return isWebContentsExcepted(
    webContents.fromId(details.webContentsId),
    settings.getSettings().adblockExceptions
  );
}

/**
 * Electron only allows ONE webRequest listener per event per session —
 * `enableBlockingInSession` registers its own onBeforeRequest/onHeadersReceived
 * listeners, and `disableBlockingInSession` clears them outright. So instead
 * of letting the blocker own those events directly, we re-register our own
 * wrapper right after every `enableBlockingInSession` call: it checks the
 * per-site exception list first, and only delegates to the blocker's own
 * public `onBeforeRequest`/`onHeadersReceived` methods (exposed by the
 * library specifically for this kind of layering) when the site isn't
 * excepted. This must be redone every time blocking is (re-)enabled, since
 * enabling replaces whatever listeners were there before.
 *
 * @param {Electron.Session} session
 */
function applyBlockingWithExceptions(session) {
  // `enableBlockingInSession` registers the library's cosmetic-filter IPC
  // handlers via the process-global `ipcMain.handle`, which throws if a
  // handler for the channel already exists. We attach the same blocker to
  // more than one session (default + the isolated private-browsing session),
  // so a second enable would otherwise crash startup with "Attempted to
  // register a second handler". Clear any prior registration first: the
  // handlers always dispatch to this one shared blocker instance, so which
  // session's enable call owns them is irrelevant. Removing when none is
  // registered is a safe no-op.
  ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
  ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
  blocker.enableBlockingInSession(session);
  installCosmeticExceptionHandlers(
    ipcMain,
    blocker,
    (wc) => isWebContentsExcepted(wc, settings.getSettings().adblockExceptions)
  );
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (isExcepted(details)) return callback({});
    blocker.onBeforeRequest(details, callback);
  });
  session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    if (isExcepted(details)) return callback({});
    blocker.onHeadersReceived(details, callback);
  });
}

/**
 * Loads (or builds + caches) the blocking engine, then attaches it to a
 * session so every request made through that session — from any tab —
 * is filtered. Because this runs at the network layer instead of through
 * Chrome's extension APIs, it isn't subject to Manifest V3's
 * declarativeNetRequest rule caps or the loss of the webRequest API.
 *
 * Cosmetic filtering (hiding leftover ad *elements*, not just blocking
 * requests) is handled by the library: `enableBlockingInSession` registers
 * a session preload script that reports DOM state, and the engine responds
 * by calling `insertCSS`/`executeJavaScript` on the page's webContents. Our
 * replacement IPC handlers apply the same per-site exception before either
 * kind of cosmetic injection is allowed.
 *
 * @param {Electron.Session} session - typically session.defaultSession
 * @param {{ enabled?: boolean }} [options]
 * @returns {Promise<ElectronBlocker>}
 */
async function setupAdBlocker(session, { enabled = true } = {}) {
  blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path: cachePath(),
    read: fs.promises.readFile,
    write: fs.promises.writeFile,
  });

  // Cosmetic filters can contain multiple uBO scriptlets for one page.
  // Ghostery executes each in the page's global scope; isolating their
  // declarations prevents one scriptlet from corrupting another's live
  // Proxy closures while preserving network blocking and cosmetic CSS.
  installScriptletIsolation(blocker);

  attachAdBlockerToSession(session, { enabled });
  return blocker;
}

/** Attach the already-built blocker to another session (private browsing). */
function attachAdBlockerToSession(session, { enabled = true } = {}) {
  if (!blocker || !session) return;
  attachedSessions.add(session);
  if (enabled && !blocker.isBlockingEnabled(session)) applyBlockingWithExceptions(session);
}

/** Toggle blocking at runtime (used by the settings page). */
function setAdBlockEnabled(enabled) {
  if (!blocker) return;
  for (const session of attachedSessions) {
    const isEnabled = blocker.isBlockingEnabled(session);
    if (enabled && !isEnabled) applyBlockingWithExceptions(session);
    if (!enabled && isEnabled) blocker.disableBlockingInSession(session);
  }
}

function getBlocker() {
  return blocker;
}

module.exports = { setupAdBlocker, attachAdBlockerToSession, setAdBlockEnabled, getBlocker };
