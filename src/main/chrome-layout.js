// Pure child-view geometry for Blanc's two desktop tab layouts. Keeping this
// outside main.js makes the 640px minimum-window edge case testable without
// Electron and gives the renderer one authoritative rail-width constant.

const VERTICAL_TABS_WIDTH = 248;
const FIND_OVERLAY_MAX_WIDTH = 560;
const FIND_OVERLAY_HEIGHT = 160;
// #findBar is 480px wide and uses max-width: calc(100vw - 24px). Exposing the
// resulting visible maximum in the geometry result lets tests cover the
// narrow vertical pane without duplicating that arithmetic at call sites.
const FIND_CAPSULE_WIDTH = 480;
const FIND_CAPSULE_HORIZONTAL_GUTTER = 24;

const TAB_LAYOUTS = new Set(['island', 'vertical']);

function normalizeTabLayout(value) {
  return TAB_LAYOUTS.has(value) ? value : 'island';
}

function dimension(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/**
 * @param {{width: number, height: number, chromeHeight: number, tabLayout?: string}} input
 */
function calculateChromeLayout({ width, height, chromeHeight, tabLayout = 'island' }) {
  const windowWidth = dimension(width);
  const windowHeight = dimension(height);
  const stripHeight = Math.min(dimension(chromeHeight), windowHeight);
  const layout = normalizeTabLayout(tabLayout);
  // BrowserWindow enforces a 640px minimum width, so the vertical rail is
  // always the full 248px in production. The min() is a defensive guard for
  // unit callers and transient zero-sized content bounds during teardown.
  const railWidth = layout === 'vertical'
    ? Math.min(VERTICAL_TABS_WIDTH, windowWidth)
    : 0;
  const pageWidth = Math.max(0, windowWidth - railWidth);
  const pageHeight = Math.max(0, windowHeight - stripHeight);

  const pageBounds = {
    x: railWidth,
    y: stripHeight,
    width: pageWidth,
    height: pageHeight,
  };
  const panelBounds = {
    x: railWidth,
    y: 0,
    width: pageWidth,
    height: windowHeight,
  };
  const findWidth = Math.min(FIND_OVERLAY_MAX_WIDTH, pageWidth);
  const findBounds = {
    x: railWidth + Math.round((pageWidth - findWidth) / 2),
    y: stripHeight,
    width: findWidth,
    height: Math.min(FIND_OVERLAY_HEIGHT, pageHeight),
  };

  return {
    tabLayout: layout,
    verticalTabsWidth: VERTICAL_TABS_WIDTH,
    railWidth,
    railBounds: {
      x: 0,
      y: stripHeight,
      width: railWidth,
      height: pageHeight,
    },
    // Guest tabs and the utility sheet intentionally share exact bounds.
    pageBounds,
    utilityBounds: { ...pageBounds },
    // Panel and palette both retain y=0 so the Island expands in place.
    panelBounds,
    paletteBounds: { ...panelBounds },
    findBounds,
    // The root chrome renderer uses this pane to center the resting Island.
    islandBounds: {
      x: railWidth,
      y: 0,
      width: pageWidth,
      height: stripHeight,
    },
    findCapsuleMaxWidth: Math.max(
      0,
      Math.min(FIND_CAPSULE_WIDTH, findWidth - FIND_CAPSULE_HORIZONTAL_GUTTER)
    ),
  };
}

module.exports = {
  VERTICAL_TABS_WIDTH,
  FIND_OVERLAY_MAX_WIDTH,
  FIND_OVERLAY_HEIGHT,
  FIND_CAPSULE_WIDTH,
  FIND_CAPSULE_HORIZONTAL_GUTTER,
  normalizeTabLayout,
  calculateChromeLayout,
};
