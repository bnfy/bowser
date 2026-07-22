// Test-only main-process surface, installed ONLY when process.env.BLANC_TEST
// is set (see main.js). It exposes a small, explicit set of state readers and
// actions on globalThis.__blanc so the desktop acceptance harness can drive the
// real tab/group/store logic via Playwright's electronApp.evaluate() — no
// production code path depends on this, and it is never wired in a normal run.
//
// It deliberately reaches into the same functions the app itself uses
// (createTab, groupTabByName, the settings/history/bookmarks stores), so the
// scenarios exercise real behaviour rather than a reimplementation.

const settings = require('./settings');
const history = require('./history');
const bookmarks = require('./bookmarks');

/**
 * @param {object} refs - live references from main.js's module scope.
 */
function install(refs) {
  const {
    tabs,
    getTabOrder,
    getGroups,
    getActiveTabId,
    clusterSlots,
    createTab,
    setActiveTab,
    closeTab,
    duplicateTab,
    toggleTabPinned,
    groupTabByName,
    reopenClosedTab,
    newTabUrl,
    normalizeAddressInput,
    handoffProtocols,
    openInternalPage,
    openFindBar,
    getOverlayMode,
    showOverlay,
    showUtilityPage,
    hideUtilitySheet,
    getUtilitySheetState,
    getUtilitySheetWebContents,
    getPrivateBrowsingSession,
    attemptChromeNavigation,
    getChromeUrl,
  } = refs;

  // The tab model's committed .url is the app's own source of truth (see
  // openInternalPage) and is set synchronously, so it is more reliable in
  // tests than webContents.getURL(), which lags until a navigation commits.
  const urlOf = (t) => {
    if (typeof t.url === 'string' && t.url) return t.url;
    try { return t.view.webContents.getURL(); } catch { return ''; }
  };
  // The ACTUAL committed WebContents URL — not the model's stored .url, which
  // can still read blanc://newtab after a load fails and the page is blank.
  // Regression checks for "did this page really load" must use this.
  const committedUrlOf = (t) => { try { return t.view.webContents.getURL(); } catch { return ''; } };
  const isLoadingOf = (t) => { try { return t.view.webContents.isLoadingMainFrame(); } catch { return false; } };
  const sessionPersistentOf = (t) => { try { return t.view.webContents.session.isPersistent(); } catch { return null; } };
  const lc = (s) => String(s).trim().toLowerCase();

  globalThis.__blanc = {
    // ---- state ----
    state() {
      const list = [];
      for (const [id, t] of tabs) {
        list.push({
          id,
          url: urlOf(t),
          loadedUrl: committedUrlOf(t),
          loading: isLoadingOf(t),
          groupId: t.groupId ?? null,
          pinned: !!t.pinned,
          muted: !!t.muted,
          private: !!t.private,
          sessionKind: t.view.webContents.session === getPrivateBrowsingSession() ? 'private' : 'default',
          sessionPersistent: sessionPersistentOf(t),
        });
      }
      return {
        tabs: list,
        tabOrder: [...getTabOrder()],
        clusters: clusterSlots().map((slot) => ({
          key: slot.key,
          groupId: slot.group?.id ?? null,
          tabIds: [...slot.tabIds],
        })),
        groups: getGroups().map((g) => ({ id: g.id, name: g.name, collapsed: !!g.collapsed })),
        activeTabId: getActiveTabId(),
      };
    },

    // ---- tab / group actions ----
    openTab(url, opts) {
      const id = createTab(url, opts || {});
      setActiveTab(id, { focusContent: false });
      return id;
    },
    newTab() {
      const id = createTab(newTabUrl());
      setActiveTab(id, { focusContent: false });
      return id;
    },
    duplicateActive() { duplicateTab(getActiveTabId()); },
    pinTab(id) { toggleTabPinned(id); },
    closeTab(id) { closeTab(id); },
    reopenClosed() { reopenClosedTab(); },
    groupActiveByName(name) { groupTabByName(getActiveTabId(), name); },
    closeTabsInGroupName(name) {
      const g = getGroups().find((x) => x.name === lc(name));
      if (!g) return;
      for (const [id, t] of tabs) if (t.groupId === g.id) closeTab(id);
    },

    // ---- favorites (bookmarks store) ----
    favoriteActive() {
      const t = tabs.get(getActiveTabId());
      if (!t) return;
      // Favorite the tab MODEL's url — what the real app's favorite action uses
      // and what state()/the F9 wait observe — so the wait and the action agree
      // (getURL() lags until navigation commits, which made this race/flake).
      const url = urlOf(t);
      if (!bookmarks.isBookmarked(url)) bookmarks.toggleBookmark(url, t.title || url);
    },
    favoriteAllTabs() {
      for (const t of tabs.values()) {
        const url = urlOf(t);
        if (/^https?:/.test(url) && !bookmarks.isBookmarked(url)) {
          bookmarks.toggleBookmark(url, t.view.webContents.getTitle() || url);
        }
      }
    },
    activeFavorited() { const t = tabs.get(getActiveTabId()); return !!t && bookmarks.isBookmarked(urlOf(t)); },
    bookmarkUrls() { return bookmarks.listBookmarks().map((b) => b.url); },

    // ---- history store ----
    seedHistory() { history.addVisit('http://seed.local/', 'Seed'); },
    clearHistory() { history.clearHistory(); },
    historyCount() { return history.listHistory({ limit: 5000 }).length; },

    // ---- settings ----
    setAdblock(on) { settings.setSettings({ adblockEnabled: !!on }); },
    toggleAdblock() { settings.setSettings({ adblockEnabled: !settings.getSettings().adblockEnabled }); },
    adblockEnabled() { return settings.getSettings().adblockEnabled; },
    setSearchEngine(x) { settings.setSettings({ searchEngine: x }); },
    searchEngine() { return settings.getSettings().searchEngine; },
    setAppIcon(x) { settings.setSettings({ appIcon: x }); },
    appIcon() { return settings.getSettings().appIcon; },
    secureDns() { return settings.getSettings().secureDns; },
    secureDnsTemplate() { return settings.getSettings().secureDnsTemplate; },
    webrtcPolicy() { return settings.getSettings().webrtcPolicy; },
    setSecureDns(dns, template = '') { settings.setSettings({ secureDns: dns, secureDnsTemplate: template }); },
    clearSupporter() { settings.setSupporter(null); },
    addException(h) {
      const cur = settings.getSettings().adblockExceptions;
      settings.setSettings({ adblockExceptions: [...cur, h] });
    },
    exceptions() { return settings.getSettings().adblockExceptions; },
    setSupporterActive() { settings.setSupporter({ key: 'test', activationId: 'test', activatedAt: 0 }); },

    // ---- address routing / overlay ----
    resolveAddress(input) { return normalizeAddressInput(input); },
    wouldHandOff(url) {
      try { return handoffProtocols.has(new URL(url).protocol); } catch { return false; }
    },
    openDownloads() { openInternalPage('blanc://downloads/'); },
    openFind() { openFindBar(); },
    openPalette() { showOverlay('palette'); },
    overlayMode() { return getOverlayMode(); },
    utilitySurface() { return getUtilitySheetState(); },
    attemptChromeNavigation(url) { return attemptChromeNavigation(String(url)); },
    chromeUrl() { return getChromeUrl(); },

    // ---- isolation between scenarios ----
    reset() {
      // No scenario inherits another's open surface.
      hideUtilitySheet();
      // A fresh tab first so closing the rest never empties the window.
      const keep = createTab(newTabUrl());
      setActiveTab(keep, { focusContent: false });
      for (const id of [...tabs.keys()]) if (id !== keep) closeTab(id);
      getGroups().length = 0;
      history.clearHistory();
      for (const b of bookmarks.listBookmarks()) bookmarks.removeBookmark(b.id);
      settings.setSettings({
        searchEngine: 'duckduckgo',
        adblockEnabled: true,
        homePage: '',
        theme: 'system',
        appIcon: 'paper',
        adblockExceptions: [],
      });
      settings.setSupporter(null);
    },
  };
}

module.exports = { install };
