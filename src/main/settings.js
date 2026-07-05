const { JsonStore } = require('./store');

const SEARCH_ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  google: { label: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  bing: { label: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  brave: { label: 'Brave Search', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
};

const THEMES = ['system', 'light', 'dark'];

// Dock icon colorways — each id maps to src/renderer/pages/icon-<id>.png.
const APP_ICONS = ['default', 'midnight', 'cream', 'forest', 'sage'];

const DEFAULTS = {
  searchEngine: 'duckduckgo',
  adblockEnabled: true,
  // Empty string = the built-in blanc://newtab page.
  homePage: '',
  theme: 'system',
  appIcon: 'default',
  // Lowercased hostnames, no protocol/path/www. prefix.
  adblockExceptions: [],
  // Opt-in, anonymous "app launched" ping — see main/telemetry.js. Off by default.
  usagePing: false,
};

let store = null;
const listeners = new Set();

function ensureStore() {
  if (!store) store = new JsonStore('settings', DEFAULTS);
  return store;
}

function getSettings() {
  return { ...ensureStore().data };
}

function setSettings(partial) {
  const s = ensureStore();
  const clean = {};
  if (typeof partial.searchEngine === 'string' && SEARCH_ENGINES[partial.searchEngine]) {
    clean.searchEngine = partial.searchEngine;
  }
  if (typeof partial.adblockEnabled === 'boolean') clean.adblockEnabled = partial.adblockEnabled;
  if (typeof partial.usagePing === 'boolean') clean.usagePing = partial.usagePing;
  if (typeof partial.homePage === 'string') clean.homePage = partial.homePage.trim();
  if (THEMES.includes(partial.theme)) clean.theme = partial.theme;
  if (APP_ICONS.includes(partial.appIcon)) clean.appIcon = partial.appIcon;
  if (Array.isArray(partial.adblockExceptions)) {
    clean.adblockExceptions = [
      ...new Set(
        partial.adblockExceptions
          .filter((h) => typeof h === 'string')
          .map((h) => h.trim().toLowerCase().replace(/^www\./, ''))
      ),
    ];
  }
  s.update((data) => Object.assign(data, clean));
  for (const fn of listeners) fn(getSettings());
  return getSettings();
}

function onSettingsChanged(fn) {
  listeners.add(fn);
}

function searchUrlFor(query) {
  const { searchEngine } = getSettings();
  const engine = SEARCH_ENGINES[searchEngine] ?? SEARCH_ENGINES.duckduckgo;
  return engine.url(query);
}

module.exports = { SEARCH_ENGINES, APP_ICONS, getSettings, setSettings, onSettingsChanged, searchUrlFor };
