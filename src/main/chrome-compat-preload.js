// Session-wide, unprivileged Chrome compatibility surface. This must be a
// session preload rather than part of tab-preload.js: Chromium-created
// target=_blank children need to retain their original opener context, and
// overriding their webPreferences.preload severs that relationship.
const { webFrame } = require('electron');

webFrame.executeJavaScript(`
(() => {
  const define = (target, key, value) => {
    if (target && !Object.prototype.hasOwnProperty.call(target, key)) {
      Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  };
  window.chrome = window.chrome || {};
  define(window.chrome, 'app', {
    isInstalled: false,
    InstallState: {
      DISABLED: 'disabled',
      INSTALLED: 'installed',
      NOT_INSTALLED: 'not_installed',
    },
    RunningState: {
      CANNOT_RUN: 'cannot_run',
      READY_TO_RUN: 'ready_to_run',
      RUNNING: 'running',
    },
    getDetails: () => null,
    getIsInstalled: () => false,
    installState: (callback) => {
      if (typeof callback === 'function') setTimeout(() => callback('not_installed'), 0);
    },
    runningState: () => 'cannot_run',
  });
  define(window.chrome, 'csi', () => {
    const timing = performance.timing || {};
    const navigationStart = timing.navigationStart || performance.timeOrigin || Date.now();
    return {
      onloadT: timing.loadEventStart || 0,
      startE: navigationStart,
      pageT: Math.max(0, Date.now() - navigationStart),
      tran: 15,
    };
  });
  define(window.chrome, 'loadTimes', () => {
    const timing = performance.timing || {};
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    const navigationStart = timing.navigationStart || performance.timeOrigin || Date.now();
    const seconds = (value) => (value || navigationStart) / 1000;
    return {
      requestTime: seconds(navigationStart),
      startLoadTime: seconds(navigationStart),
      commitLoadTime: seconds(timing.responseStart),
      finishDocumentLoadTime: seconds(timing.domContentLoadedEventEnd),
      finishLoadTime: seconds(timing.loadEventEnd || timing.loadEventStart),
      firstPaintTime: 0,
      firstPaintAfterLoadTime: 0,
      navigationType: nav?.type || 'Other',
      wasFetchedViaSpdy: false,
      wasNpnNegotiated: false,
      npnNegotiatedProtocol: 'unknown',
      wasAlternateProtocolAvailable: false,
      connectionInfo: 'unknown',
    };
  });
})();
`, true).catch(() => {});
