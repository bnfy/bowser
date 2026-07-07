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
    createTab,
    setActiveTab,
    closeTab,
    duplicateTab,
    toggleTabPinned,
    groupTabByName,
    reopenClosedTab,
    newTabUrl,
  } = refs;

  const activeWc = () => tabs.get(getActiveTabId())?.view?.webContents;
  const urlOf = (t) => {
    try { return t.view.webContents.getURL(); } catch { return ''; }
  };
  const lc = (s) => String(s).trim().toLowerCase();

  globalThis.__blanc = {
    // ---- state ----
    state() {
      const list = [];
      for (const [id, t] of tabs) {
        list.push({
          id,
          url: urlOf(t),
          groupId: t.groupId ?? null,
          pinned: !!t.pinned,
          muted: !!t.muted,
          private: !!t.private,
        });
      }
      return {
        tabs: list,
        tabOrder: [...getTabOrder()],
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
      const wc = activeWc();
      if (!wc) return;
      const url = wc.getURL();
      if (!bookmarks.isBookmarked(url)) bookmarks.toggleBookmark(url, wc.getTitle() || url);
    },
    favoriteAllTabs() {
      for (const t of tabs.values()) {
        const url = urlOf(t);
        if (/^https?:/.test(url) && !bookmarks.isBookmarked(url)) {
          bookmarks.toggleBookmark(url, t.view.webContents.getTitle() || url);
        }
      }
    },
    activeFavorited() { const wc = activeWc(); return !!wc && bookmarks.isBookmarked(wc.getURL()); },
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
    clearSupporter() { settings.setSupporter(null); },
    addException(h) {
      const cur = settings.getSettings().adblockExceptions;
      settings.setSettings({ adblockExceptions: [...cur, h] });
    },
    exceptions() { return settings.getSettings().adblockExceptions; },

    // ---- isolation between scenarios ----
    reset() {
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
