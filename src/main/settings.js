const { JsonStore } = require('./store');

const SEARCH_ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  google: { label: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  bing: { label: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  brave: { label: 'Brave Search', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
};

const THEMES = ['system', 'light', 'dark'];

// Dock icon colorways — id maps to src/renderer/pages/icon-<id>.png; order
// here is also the tile order Settings renders. 'default' is the original
// green colorway — the id (and file name) is frozen for saved settings,
// only the label moved on when Paper became the default.
const APP_ICON_LABELS = {
  paper: 'Paper',
  ink: 'Ink',
  graphite: 'Graphite',
  default: 'Evergreen',
  midnight: 'Midnight',
  cream: 'Cream',
  forest: 'Forest',
  sage: 'Sage',
};
const APP_ICONS = Object.keys(APP_ICON_LABELS);

// Supporter-only colorways — same geometry, unlocked by a Polar license
// key (see main/supporter.js). Gated at validation time, not render time.
const SUPPORTER_ICON_LABELS = { ember: 'Ember', plum: 'Plum', gold: 'Gold' };
const SUPPORTER_ICONS = Object.keys(SUPPORTER_ICON_LABELS);

const DEFAULTS = {
  searchEngine: 'duckduckgo',
  adblockEnabled: true,
  // Empty string = the built-in blanc://newtab page.
  homePage: '',
  theme: 'system',
  appIcon: 'paper',
  // Lowercased hostnames, no protocol/path/www. prefix.
  adblockExceptions: [],
  // Opt-in, anonymous "app launched" ping — see main/telemetry.js. Off by default.
  usagePing: false,
  // Blanc Supporter license — null, or { key, activationId, activatedAt }.
  // Written only by setSupporter() (the Polar activation flow), never by
  // the generic setSettings() path. Once set, trusted forever — offline OK.
  supporter: null,
};

let store = null;
const listeners = new Set();

function ensureStore() {
  if (!store) store = new JsonStore('settings', DEFAULTS);
  return store;
}

// The appIcon read back is sanitized the same way setSettings() validates
// writes — a stale/hand-edited supporter icon id with no active license
// must never reach a renderer or applyAppIcon() as if it were still valid.
function getSettings() {
  const data = { ...ensureStore().data };
  if (!isAppIconAllowed(data.appIcon)) data.appIcon = DEFAULTS.appIcon;
  return data;
}

function isAppIconAllowed(id) {
  return APP_ICONS.includes(id) || (SUPPORTER_ICONS.includes(id) && isSupporterActive());
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
  if (isAppIconAllowed(partial.appIcon)) clean.appIcon = partial.appIcon;
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

function isSupporterActive() {
  return !!ensureStore().data.supporter;
}

/** The activation flow's private write path — the generic setSettings()
 * whitelist deliberately has no `supporter` entry. */
function setSupporter(record) {
  ensureStore().update((data) => {
    data.supporter = record;
  });
  for (const fn of listeners) fn(getSettings());
}

function searchUrlFor(query) {
  const { searchEngine } = getSettings();
  const engine = SEARCH_ENGINES[searchEngine] ?? SEARCH_ENGINES.duckduckgo;
  return engine.url(query);
}

module.exports = {
  SEARCH_ENGINES,
  APP_ICONS,
  APP_ICON_LABELS,
  SUPPORTER_ICONS,
  SUPPORTER_ICON_LABELS,
  getSettings,
  setSettings,
  onSettingsChanged,
  searchUrlFor,
  isSupporterActive,
  isAppIconAllowed,
  setSupporter,
};
