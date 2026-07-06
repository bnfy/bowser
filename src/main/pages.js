const { app, protocol, net, ipcMain, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const bookmarks = require('./bookmarks');
const history = require('./history');
const downloads = require('./downloads');
const settings = require('./settings');
const supporter = require('./supporter');
const { listDecisions, removeDecision } = require('./permissions');

// Internal chrome pages (bookmarks, history, downloads, settings, the new
// tab page) are served over a dedicated `blanc://` scheme instead of
// file:// so they get a real origin, and so ordinary web content can never
// link into arbitrary local files.
const PAGES_DIR = path.join(__dirname, '../renderer/pages');
const KNOWN_PAGES = new Set(['newtab', 'bookmarks', 'history', 'downloads', 'settings', 'error', 'auth']);

/** Must run before app 'ready'. */
function registerPagesScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'blanc', privileges: { standard: true, secure: true } },
  ]);
}

/** Call after app 'ready'. `hooks.onDataChanged` re-broadcasts tab state
 * (e.g. so the star button updates when a bookmark is deleted from the
 * bookmarks page). */
function setupPages(hooks = {}) {
  protocol.handle('blanc', (request) => {
    const { host, pathname } = new URL(request.url);
    if (!KNOWN_PAGES.has(host)) return new Response('Not found', { status: 404 });

    // `blanc://bookmarks/` serves the page itself; any deeper path is a
    // shared asset (pages.css, pages.js) resolved inside PAGES_DIR only.
    const name = pathname === '/' ? `${host}.html` : path.basename(pathname);
    if (!/^[\w.-]+$/.test(name)) return new Response('Bad request', { status: 400 });
    return net.fetch(pathToFileURL(path.join(PAGES_DIR, name)).toString());
  });

  // Every handler below double-checks the sender really is an internal
  // page — the preload only exposes the API on blanc:// documents, but
  // IPC channels are reachable by name, so the main process must not
  // trust that alone.
  const handle = (channel, fn) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.sender.getURL().startsWith('blanc://')) {
        throw new Error(`${channel}: denied for ${event.sender.getURL()}`);
      }
      return fn(...args);
    });
  };

  handle('pages:bookmarks:list', () => bookmarks.listBookmarks());
  handle('pages:bookmarks:remove', (id) => {
    bookmarks.removeBookmark(id);
    hooks.onDataChanged?.();
  });
  // The start page reports a stored favicon URL that failed to load, so
  // it's cleared and stops being retried on future loads.
  handle('pages:bookmarks:clear-favicon', (url) => bookmarks.updateFavicon(url, null));

  handle('pages:history:list', (opts) => history.listHistory(opts ?? {}));
  handle('pages:history:remove', (url, visitedAt) => history.removeVisit(url, visitedAt));
  handle('pages:history:clear', () => history.clearHistory());

  handle('pages:downloads:list', () => downloads.listDownloads());
  handle('pages:downloads:cancel', (id) => downloads.cancelDownload(id));
  handle('pages:downloads:open', (id) => downloads.openDownload(id));
  handle('pages:downloads:show', (id) => downloads.showDownloadInFolder(id));
  handle('pages:downloads:clear-finished', () => downloads.clearFinishedDownloads());

  // The renderer never sees the license key or activation id — only the
  // derived booleans. Internal pages are privileged, but least-privilege
  // anyway (same reasoning as the preload's protocol re-check).
  const clientSettings = () => {
    const { supporter: record, ...rest } = settings.getSettings();
    return {
      ...rest,
      supporterActive: !!record,
      supporterActivatedAt: record?.activatedAt ?? null,
    };
  };

  handle('pages:settings:get', () => ({
    settings: clientSettings(),
    searchEngines: Object.fromEntries(
      Object.entries(settings.SEARCH_ENGINES).map(([key, { label }]) => [key, label])
    ),
  }));
  handle('pages:settings:set', (partial) => {
    settings.setSettings(partial ?? {});
    return clientSettings();
  });
  handle('pages:settings:supporter-activate', (key) => supporter.activateSupporter(key));

  handle('pages:app-version', () => app.getVersion());

  // Start page (the ledger new tab): tab groups + the weekly blocked
  // counter live in main.js, reached through hooks rather than a module.
  handle('pages:start:data', () => ({
    groups: hooks.startPage?.groups() ?? [],
    blockedThisWeek: hooks.startPage?.blockedThisWeek() ?? 0,
  }));
  handle('pages:start:focus-group', (id) => hooks.startPage?.focusGroup(String(id)));

  // Default-browser state lives in LaunchServices/the OS, not settings.json.
  // canSet: a dev run must never register the bare Electron binary as a
  // browser, and Linux has no default-protocol-client API in Electron.
  const defaultBrowserStatus = () => ({
    isDefault: app.isDefaultProtocolClient('http'),
    canSet: app.isPackaged && process.platform !== 'linux',
  });
  handle('pages:default-browser:get', () => defaultBrowserStatus());
  handle('pages:default-browser:set', () => {
    if (defaultBrowserStatus().canSet) {
      app.setAsDefaultProtocolClient('http');
      app.setAsDefaultProtocolClient('https');
    }
    return defaultBrowserStatus();
  });

  handle('pages:permissions:list', () => listDecisions());
  handle('pages:permissions:remove', (key) => removeDecision(String(key)));

  // The settings page promises "cookies, cache & site data" — clear both.
  handle('pages:clear-browsing-data', () =>
    Promise.all([session.defaultSession.clearStorageData(), session.defaultSession.clearCache()]));
}

module.exports = { registerPagesScheme, setupPages };
