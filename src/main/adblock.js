const { app, webContents } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

// Cache the compiled filter engine on disk so we don't re-fetch and
// re-parse EasyList/EasyPrivacy on every launch. The engine validates the
// cache against its own format version and rebuilds automatically when the
// library updates; delete the file to force a refresh of the block lists.
const CACHE_VERSION = 2;
const cachePath = () =>
  path.join(app.getPath('userData'), `adblock-engine.v${CACHE_VERSION}.bin`);

/** @type {ElectronBlocker | null} */
let blocker = null;
/** @type {Set<Electron.Session>} */
const attachedSessions = new Set();

/**
 * Resolves the hostname of the tab a request came from, for per-site
 * exception checks. `getURL()` can return an empty string before the tab's
 * first navigation has committed, hence the try/catch.
 *
 * @param {number} id - Electron.OnBeforeRequestListenerDetails#webContentsId
 * @returns {string | null}
 */
function hostnameForWebContentsId(id) {
  // Not every request is tied to a tab (extension background workers,
  // preconnects, etc.) — webContentsId is genuinely optional, and
  // webContents.fromId() throws rather than returning undefined if handed
  // anything but a number.
  if (typeof id !== 'number') return null;
  const wc = webContents.fromId(id);
  if (!wc) return null;
  try {
    return new URL(wc.getURL()).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Read live (not cached) so edits to the exception list apply immediately. */
function isExcepted(details) {
  const hostname = hostnameForWebContentsId(details.webContentsId);
  return !!hostname && settings.getSettings().adblockExceptions.includes(hostname);
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
  blocker.enableBlockingInSession(session);
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
 * by calling `insertCSS`/`executeJavaScript` on the page's webContents. Note
 * that per-site ad-block exceptions (see below) only cover network-level
 * blocking — cosmetic element-hiding is driven by a separate internal IPC
 * channel the library owns and isn't scoped per-site here.
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

  attachedSessions.add(session);
  if (enabled) applyBlockingWithExceptions(session);
  return blocker;
}

/** Toggle blocking at runtime (used by the settings page). */
function setAdBlockEnabled(enabled) {
  if (!blocker) return;
  for (const ses of attachedSessions) {
    const isEnabled = blocker.isBlockingEnabled(ses);
    if (enabled && !isEnabled) applyBlockingWithExceptions(ses);
    if (!enabled && isEnabled) blocker.disableBlockingInSession(ses);
  }
}

function enableBlockingForSession(ses) {
  if (!blocker) return;
  attachedSessions.add(ses);
  applyBlockingWithExceptions(ses);
}

function getBlocker() {
  return blocker;
}

module.exports = { setupAdBlocker, setAdBlockEnabled, enableBlockingForSession, getBlocker };
