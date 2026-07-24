// Preload attached to every ordinary tab WebContentsView. The privileged IPC
// bridge is exposed only when the document is one of our own blanc:// internal
// pages (the check re-runs on every navigation, so a tab that leaves an
// internal page loses the API). The main process additionally verifies the
// sender URL on every pages:* IPC call. Chrome compatibility lives in the
// session-wide chrome-compat-preload.js so adopted OAuth children receive it.
const { contextBridge, ipcRenderer } = require('electron');

if (window.location.protocol === 'blanc:') {
  contextBridge.exposeInMainWorld('bowserPages', {
    appVersion: () => ipcRenderer.invoke('pages:app-version'),
    bookmarks: {
      list: () => ipcRenderer.invoke('pages:bookmarks:list'),
      remove: (id) => ipcRenderer.invoke('pages:bookmarks:remove', id),
      clearFavicon: (url) => ipcRenderer.invoke('pages:bookmarks:clear-favicon', url),
      import: () => ipcRenderer.invoke('pages:bookmarks:import'),
      setFolder: (id, folder) => ipcRenderer.invoke('pages:bookmarks:set-folder', id, folder),
      renameFolder: (oldName, newName) => ipcRenderer.invoke('pages:bookmarks:rename-folder', oldName, newName),
      removeFolder: (name) => ipcRenderer.invoke('pages:bookmarks:remove-folder', name),
    },
    history: {
      list: (opts) => ipcRenderer.invoke('pages:history:list', opts),
      remove: (url, visitedAt) => ipcRenderer.invoke('pages:history:remove', url, visitedAt),
      clear: () => ipcRenderer.invoke('pages:history:clear'),
    },
    downloads: {
      list: () => ipcRenderer.invoke('pages:downloads:list'),
      cancel: (id) => ipcRenderer.invoke('pages:downloads:cancel', id),
      open: (id) => ipcRenderer.invoke('pages:downloads:open', id),
      show: (id) => ipcRenderer.invoke('pages:downloads:show', id),
      clearFinished: () => ipcRenderer.invoke('pages:downloads:clear-finished'),
    },
    start: {
      data: () => ipcRenderer.invoke('pages:start:data'),
      focusGroup: (id) => ipcRenderer.invoke('pages:start:focus-group', id),
      retryStartup: () => ipcRenderer.invoke('pages:start:startup-retry'),
      continueWithoutBlocking: () => ipcRenderer.invoke('pages:start:startup-continue'),
      completePrivacy: (choices) => ipcRenderer.invoke('pages:start:privacy-complete', choices),
      onStatus: (callback) => {
        ipcRenderer.on('pages:start:status', (_event, status) => callback(status));
      },
      // Subscribe-only: main pushes fresh remote-device tabs when a sync
      // pull lands after the page first painted (tab sync).
      onRemoteTabs: (callback) => {
        ipcRenderer.on('pages:start:remote-tabs', (_event, devices) => callback(devices));
      },
    },
    shortcuts: {
      list: () => ipcRenderer.invoke('pages:shortcuts:list'),
    },
    surface: {
      close: () => ipcRenderer.invoke('pages:surface:close'),
    },
    settings: {
      get: () => ipcRenderer.invoke('pages:settings:get'),
      set: (partial) => ipcRenderer.invoke('pages:settings:set', partial),
      activateSupporter: (key) => ipcRenderer.invoke('pages:settings:supporter-activate', key),
      syncGet: () => ipcRenderer.invoke('pages:settings:sync-get'),
      syncEnable: (payload) => ipcRenderer.invoke('pages:settings:sync-enable', payload),
      syncDisable: (opts) => ipcRenderer.invoke('pages:settings:sync-disable', opts),
      syncNow: () => ipcRenderer.invoke('pages:settings:sync-now'),
      syncTabsSet: (on) => ipcRenderer.invoke('pages:settings:sync-tabs-set', on),
    },
    permissions: {
      list: () => ipcRenderer.invoke('pages:permissions:list'),
      remove: (key) => ipcRenderer.invoke('pages:permissions:remove', key),
    },
    defaultBrowser: {
      get: () => ipcRenderer.invoke('pages:default-browser:get'),
      set: () => ipcRenderer.invoke('pages:default-browser:set'),
    },
    clearBrowsingData: () => ipcRenderer.invoke('pages:clear-browsing-data'),
    resetInstallId: () => ipcRenderer.invoke('pages:telemetry:reset-install-id'),
  });
}
