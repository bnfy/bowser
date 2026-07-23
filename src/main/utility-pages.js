// The single source of truth for "belongs in the utility sheet" (design:
// docs/superpowers/specs/2026-07-22-utility-sheet-design.md §4). Every
// route into a tab checks this; pages.js's KNOWN_PAGES stays the superset
// of all internal pages and is deliberately separate.
const UTILITY_PAGES = new Set(['bookmarks', 'history', 'downloads', 'settings', 'shortcuts']);

/** Exact-host blanc:// match: true only for the five sheet pages. */
function isUtilityUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'blanc:' && UTILITY_PAGES.has(u.host);
  } catch {
    return false;
  }
}

module.exports = { UTILITY_PAGES, isUtilityUrl };
