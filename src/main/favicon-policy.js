'use strict';

// When a tab navigates, main.js used to blank `tab.favicon` on every URL change
// and rely on Chromium re-firing `page-favicon-updated` to restore it. That
// event is NOT guaranteed: Chromium skips it on a same-origin navigation whose
// favicon is unchanged/already cached (e.g. apple.com/ -> apple.com/mac/). For a
// site with no declared `<link rel="icon">` (favicon.ico-only), `upgradeFavicon`
// has nothing to restore from either, so the icon is cleared and never comes
// back — a permanent gray box in the pill and the panel rows.
//
// Fix: only clear on a genuine CROSS-ORIGIN navigation. Cross-origin reliably
// re-fires `page-favicon-updated`; same-origin keeps the (correct) current icon
// rather than risking a permanent blank. An identical-URL soft reload (some
// sites fire a second did-navigate for the same URL) also keeps the icon — the
// same case commit 2c1da79 first guarded, now a subset of this rule.

/**
 * A tab's *comparable* web origin, or null when it has none. Only a real
 * tuple origin (http/https/etc.) is comparable; opaque-origin schemes
 * (`blanc://`, `data:`, `about:`) all serialize to the string "null" and
 * must NOT be treated as a shared origin, and an unparseable URL has none.
 */
function webOrigin(url) {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Whether navigating from `fromUrl` to `toUrl` should clear the tab's favicon.
 * Keep it only across a same-origin change (incl. identical-URL soft reloads),
 * where Chromium may not re-fire page-favicon-updated and a favicon.ico-only
 * site would otherwise blank permanently. Clear on a cross-origin change, and
 * on any change involving an opaque/unparseable origin (blanc://, data:,
 * about:) — matching the old clear-on-any-change behavior for those.
 *
 * @param {string} fromUrl - the tab's current (pre-navigation) URL
 * @param {string} toUrl   - the URL being navigated to
 * @returns {boolean}
 */
function shouldClearFaviconOnNavigate(fromUrl, toUrl) {
  if (fromUrl === toUrl) return false; // identical URL: soft reload, keep icon
  const from = webOrigin(fromUrl);
  const to = webOrigin(toUrl);
  if (!from || !to) return true; // opaque/unparseable on either side: clear
  return from !== to; // same web origin keeps; cross-origin clears
}

module.exports = { shouldClearFaviconOnNavigate };
