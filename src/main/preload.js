const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  platform: process.platform,

  createTab: (url, opts) => ipcRenderer.invoke('tabs:create', url, opts),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  switchTab: (id) => ipcRenderer.invoke('tabs:switch', id),
  navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', id, url),
  search: (id, query, engine) => ipcRenderer.invoke('tabs:search', id, query, engine),
  goBack: (id) => ipcRenderer.invoke('tabs:back', id),
  goForward: (id) => ipcRenderer.invoke('tabs:forward', id),
  reload: (id) => ipcRenderer.invoke('tabs:reload', id),
  stop: (id) => ipcRenderer.invoke('tabs:stop', id),
  reorderTab: (id, toIndex) => ipcRenderer.invoke('tabs:reorder', id, toIndex),
  setTabGroup: (id, groupId) => ipcRenderer.invoke('tabs:set-group', id, groupId),
  groupTabByName: (id, name) => ipcRenderer.invoke('tabs:group-by-name', id, name),
  toggleGroupCollapsed: (groupId) => ipcRenderer.invoke('tabs:toggle-group-collapsed', groupId),
  focusGroup: (groupId) => ipcRenderer.invoke('tabs:focus-group', groupId),
  closeGroup: (groupId) => ipcRenderer.invoke('tabs:close-group', groupId),
  toggleBookmark: () => ipcRenderer.invoke('tabs:toggle-bookmark'),
  saveFavorite: (folder) => ipcRenderer.invoke('tabs:save-favorite', folder),
  toggleTabPinned: (id) => ipcRenderer.invoke('tabs:toggle-pinned', id),
  toggleTabMuted: (id) => ipcRenderer.invoke('tabs:toggle-muted', id),
  duplicateTab: (id) => ipcRenderer.invoke('tabs:duplicate', id),
  openPage: (name) => ipcRenderer.invoke('tabs:open-page', name),
  getAllTabs: () => ipcRenderer.invoke('tabs:get-all'),
  findInPage: (id, query, options) => ipcRenderer.invoke('tabs:find', id, query, options),
  stopFindInPage: (id) => ipcRenderer.invoke('tabs:find-stop', id),

  respondPermission: (id, allow) => ipcRenderer.send('permissions:respond', { id, allow }),
  onPermissionPrompt: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('permissions:prompt', listener);
    return () => ipcRenderer.removeListener('permissions:prompt', listener);
  },

  reportChromeLayout: (height) => ipcRenderer.send('chrome:layout', { height }),

  openIsland: () => ipcRenderer.send('chrome:open-island'),
  openFindBar: () => ipcRenderer.send('chrome:open-find'),
  closeOverlay: () => ipcRenderer.send('overlay:close'),

  listHistory: (opts) => ipcRenderer.invoke('chrome:history-list', opts),
  listFavorites: () => ipcRenderer.invoke('chrome:favorites-list'),
  listRemoteTabs: () => ipcRenderer.invoke('chrome:remote-tabs-list'),
  searchSuggestions: (query) => ipcRenderer.invoke('chrome:search-suggestions', query),
  onRemoteTabsUpdated: (callback) => {
    const listener = (_event, devices) => callback(devices);
    ipcRenderer.on('chrome:remote-tabs-updated', listener);
    return () => ipcRenderer.removeListener('chrome:remote-tabs-updated', listener);
  },
  clearHistory: () => ipcRenderer.invoke('chrome:history-clear'),
  toggleAdblock: () => ipcRenderer.invoke('chrome:adblock-toggle'),
  allowAdsOnActiveSite: () => ipcRenderer.invoke('chrome:adblock-exempt-active'),
  cycleTheme: (theme) => ipcRenderer.invoke('chrome:cycle-theme', theme),
  onThemeAppearance: (callback) => {
    const listener = (_event, appearance) => callback(appearance);
    ipcRenderer.on('chrome:theme-appearance', listener);
    return () => ipcRenderer.removeListener('chrome:theme-appearance', listener);
  },

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  onTabsUpdated: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('tabs:updated', listener);
    return () => ipcRenderer.removeListener('tabs:updated', listener);
  },
  onDownloadsActivity: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('chrome:downloads', listener);
    return () => ipcRenderer.removeListener('chrome:downloads', listener);
  },
  acknowledgeDownloads: () => ipcRenderer.send('chrome:downloads-ack'),
  onOverlayShow: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('overlay:show', listener);
    return () => ipcRenderer.removeListener('overlay:show', listener);
  },
  onOverlayHide: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('overlay:hide', listener);
    return () => ipcRenderer.removeListener('overlay:hide', listener);
  },
  onIslandState: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('chrome:island-state', listener);
    return () => ipcRenderer.removeListener('chrome:island-state', listener);
  },
  onFindResult: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('chrome:find-result', listener);
    return () => ipcRenderer.removeListener('chrome:find-result', listener);
  },
});
