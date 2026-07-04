const { contextBridge, ipcRenderer } = require('electron');

// Registers the <browser-action-list> custom element that renders
// extension toolbar icons and anchors their popups.
try {
  const { injectBrowserAction } = require('electron-chrome-extensions/browser-action');
  injectBrowserAction();
} catch (err) {
  console.warn('[preload] browser action UI unavailable:', err.message);
}

contextBridge.exposeInMainWorld('browserAPI', {
  platform: process.platform,

  createTab: (url) => ipcRenderer.invoke('tabs:create', url),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  switchTab: (id) => ipcRenderer.invoke('tabs:switch', id),
  navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', id, url),
  goBack: (id) => ipcRenderer.invoke('tabs:back', id),
  goForward: (id) => ipcRenderer.invoke('tabs:forward', id),
  reload: (id) => ipcRenderer.invoke('tabs:reload', id),
  stop: (id) => ipcRenderer.invoke('tabs:stop', id),
  reorderTab: (id, toIndex) => ipcRenderer.invoke('tabs:reorder', id, toIndex),
  toggleBookmark: () => ipcRenderer.invoke('tabs:toggle-bookmark'),
  openPage: (name) => ipcRenderer.invoke('tabs:open-page', name),
  getAllTabs: () => ipcRenderer.invoke('tabs:get-all'),
  getDownloadsSummary: () => ipcRenderer.invoke('downloads:summary'),
  getExtensions: () => ipcRenderer.invoke('extensions:list'),

  reportChromeLayout: (height) => ipcRenderer.send('chrome:layout', { height }),

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  onTabsUpdated: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('tabs:updated', listener);
    return () => ipcRenderer.removeListener('tabs:updated', listener);
  },
  onDownloadsUpdated: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('downloads:updated', listener);
    return () => ipcRenderer.removeListener('downloads:updated', listener);
  },
  onFocusAddressBar: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('chrome:focus-address-bar', listener);
    return () => ipcRenderer.removeListener('chrome:focus-address-bar', listener);
  },
});
