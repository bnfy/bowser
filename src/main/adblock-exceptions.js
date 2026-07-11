const COSMETIC_FILTER_CHANNEL = '@ghostery/adblocker/inject-cosmetic-filters';
const MUTATION_OBSERVER_CHANNEL = '@ghostery/adblocker/is-mutation-observer-enabled';

function hostnameForWebContents(wc) {
  if (!wc) return null;
  try {
    return new URL(wc.getURL()).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function isWebContentsExcepted(wc, exceptions) {
  const hostname = hostnameForWebContents(wc);
  return !!hostname && exceptions.includes(hostname);
}

/**
 * Ghostery's cosmetic filtering uses process-global IPC handlers rather than
 * Electron's webRequest API. Replace the handlers installed by
 * enableBlockingInSession so a per-site exception covers cosmetic CSS and
 * scriptlets as well as network requests.
 */
function installCosmeticExceptionHandlers(ipcMain, blocker, isExcepted) {
  ipcMain.removeHandler(COSMETIC_FILTER_CHANNEL);
  ipcMain.removeHandler(MUTATION_OBSERVER_CHANNEL);

  ipcMain.handle(COSMETIC_FILTER_CHANNEL, (event, url, msg) => {
    if (isExcepted(event.sender)) return undefined;
    return blocker.onInjectCosmeticFilters(event, url, msg);
  });
  ipcMain.handle(MUTATION_OBSERVER_CHANNEL, (event) => {
    if (isExcepted(event.sender)) return false;
    return blocker.onIsMutationObserverEnabled(event);
  });
}

module.exports = {
  COSMETIC_FILTER_CHANNEL,
  MUTATION_OBSERVER_CHANNEL,
  hostnameForWebContents,
  isWebContentsExcepted,
  installCosmeticExceptionHandlers,
};
