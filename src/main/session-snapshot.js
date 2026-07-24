// Pure session-snapshot helpers shared by persistSession (main.js) and tab
// sync (tabsync.js). No electron imports — main.js isn't loadable under
// node --test, so the shared entry-building logic lives here instead
// (sync-wipe.js is the precedent). See the tab-sync design spec §4.

const MAX_SYNC_TABS = 500;
const MAX_SYNC_URL = 2048;
const MAX_SYNC_TITLE = 200;

/** The address worth persisting for a tab: the real destination behind our
 * error page (so the next launch retries it), else the url as-is. Null for
 * a tab with no committed url yet. */
function persistableUrl(url) {
  if (!url) return null;
  if (url.startsWith('blanc://error')) {
    try {
      return new URL(url).searchParams.get('url') || url;
    } catch {
      return url;
    }
  }
  return url;
}

/** Exactly persistSession's session.json semantics: private tabs excluded,
 * error urls unwrapped, url-less tabs dropped. Order preserved. */
function persistableEntries(tabList) {
  return (tabList ?? [])
    .filter((t) => t && !t.private)
    .map((t) => {
      const url = persistableUrl(t.url);
      return url ? { id: t.id, url, groupId: t.groupId ?? null, pinned: !!t.pinned } : null;
    })
    .filter(Boolean);
}

/** The synced copy of the session: additionally http(s)-only (file:// paths
 * don't exist on other machines; blanc:// pages aren't worth a row) and
 * bounded. Groups reduced to those the surviving tabs reference, in display
 * order, without device-local presentation state (collapsed). */
function syncSnapshot(tabList, groups) {
  const tabs = (tabList ?? [])
    .filter((t) => t && !t.private)
    .map((t) => {
      const url = persistableUrl(t.url);
      if (!url || !/^https?:\/\//.test(url) || url.length > MAX_SYNC_URL) return null;
      return {
        url,
        title: typeof t.title === 'string' ? t.title.slice(0, MAX_SYNC_TITLE) : '',
        groupId: t.groupId ?? null,
        pinned: !!t.pinned,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_SYNC_TABS);
  const referenced = new Set(tabs.map((t) => t.groupId).filter(Boolean));
  return {
    tabs,
    groups: (groups ?? []).filter((g) => referenced.has(g.id)).map(({ id, name }) => ({ id, name })),
  };
}

module.exports = { persistableEntries, syncSnapshot, MAX_SYNC_TABS, MAX_SYNC_URL, MAX_SYNC_TITLE };
