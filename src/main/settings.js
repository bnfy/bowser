const { JsonStore } = require('./store');
const { isValidDohTemplate, reconcileSecureDnsWrite, coerceSecureDnsRead } = require('./network-privacy');
const APP_ICON_ASSETS = require('./app-icon-assets');

const SEARCH_ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  google: { label: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  bing: { label: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  brave: { label: 'Brave Search', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
};

const THEMES = ['system', 'light', 'dark'];

// Network-privacy enums (bare arrays, like THEMES — build.mjs parses them by name).
const WEBRTC_POLICIES = ['standard', 'strict'];
const SECURE_DNS_OPTIONS = ['auto', 'off', 'cloudflare', 'quad9', 'mullvad', 'custom'];

// Keys that sync across devices (see the profile-sync spec). Deliberately
// excludes appIcon and searchSuggestions (device-local), usagePing
// (per-install consent), and supporter (never — that would be license
// sharing).
const SYNCED_KEYS = ['searchEngine', 'adblockEnabled', 'homePage', 'theme', 'adblockExceptions'];

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

// A selectable id without a packaged native stack would silently fall back to
// Paper on macOS 26+, so fail fast during startup if the two sources drift.
const missingNativeAppIcons = [...APP_ICONS, ...SUPPORTER_ICONS]
  .filter((id) => !APP_ICON_ASSETS[id]);
if (missingNativeAppIcons.length) {
  throw new Error(`Missing native app-icon assets: ${missingNativeAppIcons.join(', ')}`);
}

function normalizeAdblockHostname(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input) return null;
  try {
    return new URL(input.includes('://') ? input : `https://${input}`).hostname
      .toLowerCase()
      .replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

const DEFAULTS = {
  searchEngine: 'duckduckgo',
  // Live address-bar prefixes are sent to the selected search provider.
  // Device-local and user-disableable; private tabs override it off.
  searchSuggestions: true,
  adblockEnabled: true,
  // Empty string = the built-in blanc://newtab page.
  homePage: '',
  theme: 'system',
  appIcon: 'paper',
  // Lowercased hostnames, no protocol/path/www. prefix.
  adblockExceptions: [],
  // Network privacy (device-local — deliberately NOT in SYNCED_KEYS).
  webrtcPolicy: 'standard',
  secureDns: 'auto',
  secureDnsTemplate: '',
  // Anonymous "app launched" ping — see main/telemetry.js. On by default
  // (opt-out in Settings); no browsing data, only version/OS plus a random
  // per-install id used solely to count distinct active users.
  usagePing: true,
  // Blanc Supporter license — null, or { key, activationId, activatedAt }.
  // Written only by setSupporter() (the Polar activation flow), never by
  // the generic setSettings() path. Once set, trusted forever — offline OK.
  supporter: null,
  // Per-key last-write timestamps for sync's LWW merge; only SYNCED_KEYS are
  // ever stamped or transmitted. See exportForSync/mergeFromSync.
  _syncMeta: {},
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
  if (typeof data.searchSuggestions !== 'boolean') {
    data.searchSuggestions = DEFAULTS.searchSuggestions;
  }
  if (!isAppIconAllowed(data.appIcon)) data.appIcon = DEFAULTS.appIcon;
  // Read coercion for a corrupted stored state (hand-edited settings.json): custom
  // without a valid template reads back as the default, never as plaintext-capable
  // custom. The setSettings guard prevents a valid user action from producing this.
  data.secureDns = coerceSecureDnsRead(data.secureDns, data.secureDnsTemplate, DEFAULTS.secureDns);
  return data;
}

function isAppIconAllowed(id) {
  return APP_ICONS.includes(id) || (SUPPORTER_ICONS.includes(id) && isSupporterActive());
}

/** Validate a partial settings patch against the whitelist, returning only
 * the accepted keys. Shared by setSettings (user writes) and mergeFromSync
 * (remote writes) so a tampered sync blob can't inject unvalidated values. */
function sanitize(partial) {
  const clean = {};
  if (typeof partial.searchEngine === 'string' && SEARCH_ENGINES[partial.searchEngine]) {
    clean.searchEngine = partial.searchEngine;
  }
  if (typeof partial.searchSuggestions === 'boolean') {
    clean.searchSuggestions = partial.searchSuggestions;
  }
  if (typeof partial.adblockEnabled === 'boolean') clean.adblockEnabled = partial.adblockEnabled;
  if (typeof partial.usagePing === 'boolean') clean.usagePing = partial.usagePing;
  if (typeof partial.homePage === 'string') clean.homePage = partial.homePage.trim();
  if (THEMES.includes(partial.theme)) clean.theme = partial.theme;
  if (WEBRTC_POLICIES.includes(partial.webrtcPolicy)) clean.webrtcPolicy = partial.webrtcPolicy;
  if (SECURE_DNS_OPTIONS.includes(partial.secureDns)) clean.secureDns = partial.secureDns;
  if (typeof partial.secureDnsTemplate === 'string') {
    // Accept only an empty string or a valid template. An invalid value is DROPPED
    // (key omitted from clean) so it can never overwrite a good stored template; the
    // cross-field guard in setSettings then decides the secureDns transition.
    const t = partial.secureDnsTemplate.trim();
    if (t === '' || isValidDohTemplate(t)) clean.secureDnsTemplate = t;
  }
  if (isAppIconAllowed(partial.appIcon)) clean.appIcon = partial.appIcon;
  if (Array.isArray(partial.adblockExceptions)) {
    clean.adblockExceptions = [
      ...new Set(
        partial.adblockExceptions
          .map(normalizeAdblockHostname)
          .filter(Boolean)
      ),
    ];
  }
  return clean;
}

function setSettings(partial) {
  const s = ensureStore();
  const clean = sanitize(partial);
  // Strict-custom invariant (F25): an invalid custom transition must not degrade to
  // plaintext-capable Automatic. reconcileSecureDnsWrite (unit-tested) rejects such a
  // change, preserving the last valid configuration.
  if ('secureDns' in clean || 'secureDnsTemplate' in clean) {
    const dns = reconcileSecureDnsWrite(
      { secureDns: s.data.secureDns, secureDnsTemplate: s.data.secureDnsTemplate },
      clean,
    );
    clean.secureDns = dns.secureDns;
    clean.secureDnsTemplate = dns.secureDnsTemplate;
  }
  const now = Date.now();
  s.update((data) => {
    Object.assign(data, clean);
    data._syncMeta ??= {};
    for (const k of Object.keys(clean)) if (SYNCED_KEYS.includes(k)) data._syncMeta[k] = now;
  });
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

// Snapshot the synced keys plus their per-key timestamps for the sync engine
// to encrypt. Only SYNCED_KEYS cross the wire — supporter, appIcon,
// searchSuggestions, usagePing, and _syncMeta's non-synced entries never
// leave.
function exportForSync() {
  const d = ensureStore().data;
  const values = {}, meta = {};
  for (const k of SYNCED_KEYS) {
    if (d[k] !== undefined) values[k] = d[k];
    if (d._syncMeta?.[k]) meta[k] = d._syncMeta[k];
  }
  return { values, meta };
}

// Adopt any remote key whose last-write timestamp beats ours (per-key LWW).
// Values route through sanitize() — a tampered blob can't inject unvalidated
// settings — and meta is stamped to the REMOTE time so ordering is preserved
// across devices rather than reset to now.
function mergeFromSync(remote) {
  const s = ensureStore();
  const winners = {};
  for (const k of SYNCED_KEYS) {
    const rt = remote.meta?.[k] ?? 0;
    const lt = s.data._syncMeta?.[k] ?? 0;
    if (rt > lt && remote.values?.[k] !== undefined) winners[k] = rt;
  }
  const keys = Object.keys(winners);
  if (!keys.length) return;
  const clean = sanitize(Object.fromEntries(keys.map((k) => [k, remote.values[k]])));
  s.update((data) => {
    Object.assign(data, clean);
    data._syncMeta ??= {};
    // Advance the clock for EVERY conceded key — including ones sanitize
    // rejected (e.g. an enum value a newer app version introduced) — so a
    // value we can't apply can't re-win every sync and loop forever.
    for (const k of keys) data._syncMeta[k] = winners[k];
  });
  // Notify (→ app re-applies theme/adblock) only when something was adopted.
  if (Object.keys(clean).length) for (const fn of listeners) fn(getSettings());
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
  exportForSync,
  mergeFromSync,
};
