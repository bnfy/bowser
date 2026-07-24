const assert = require('node:assert/strict');
const test = require('node:test');

const {
  VERTICAL_TABS_WIDTH,
  normalizeTabLayout,
  calculateChromeLayout,
} = require('../../src/main/chrome-layout');

test('invalid or missing layout values preserve Island as the default', () => {
  assert.equal(normalizeTabLayout(), 'island');
  assert.equal(normalizeTabLayout('horizontal'), 'island');
  assert.equal(normalizeTabLayout('vertical'), 'vertical');
});

test('Island uses the full page width for tabs, sheets, overlays, and pill centering', () => {
  const layout = calculateChromeLayout({
    width: 1280,
    height: 800,
    chromeHeight: 64,
    tabLayout: 'island',
  });

  assert.equal(layout.verticalTabsWidth, 248);
  assert.equal(layout.railWidth, 0);
  assert.deepEqual(layout.pageBounds, { x: 0, y: 64, width: 1280, height: 736 });
  assert.deepEqual(layout.utilityBounds, layout.pageBounds);
  assert.deepEqual(layout.panelBounds, { x: 0, y: 0, width: 1280, height: 800 });
  assert.deepEqual(layout.paletteBounds, layout.panelBounds);
  assert.deepEqual(layout.findBounds, { x: 360, y: 64, width: 560, height: 160 });
  assert.deepEqual(layout.islandBounds, { x: 0, y: 0, width: 1280, height: 64 });
});

test('vertical layout reserves the authoritative rail and centers surfaces in the page pane', () => {
  const layout = calculateChromeLayout({
    width: 1280,
    height: 800,
    chromeHeight: 64,
    tabLayout: 'vertical',
  });

  assert.equal(VERTICAL_TABS_WIDTH, 248);
  assert.equal(layout.railWidth, 248);
  assert.deepEqual(layout.railBounds, { x: 0, y: 64, width: 248, height: 736 });
  assert.deepEqual(layout.pageBounds, { x: 248, y: 64, width: 1032, height: 736 });
  assert.deepEqual(layout.utilityBounds, layout.pageBounds);
  assert.deepEqual(layout.panelBounds, { x: 248, y: 0, width: 1032, height: 800 });
  assert.deepEqual(layout.paletteBounds, layout.panelBounds);
  assert.deepEqual(layout.findBounds, { x: 484, y: 64, width: 560, height: 160 });
  assert.deepEqual(layout.islandBounds, { x: 248, y: 0, width: 1032, height: 64 });
});

test('640x480 vertical layout clamps find to the 392px page pane and 368px visible capsule', () => {
  const layout = calculateChromeLayout({
    width: 640,
    height: 480,
    chromeHeight: 64,
    tabLayout: 'vertical',
  });

  assert.deepEqual(layout.pageBounds, { x: 248, y: 64, width: 392, height: 416 });
  assert.deepEqual(layout.findBounds, { x: 248, y: 64, width: 392, height: 160 });
  assert.equal(layout.findCapsuleMaxWidth, 368);
});

test('dimensions clamp safely during transient zero or undersized window bounds', () => {
  const layout = calculateChromeLayout({
    width: 200,
    height: 40,
    chromeHeight: 64,
    tabLayout: 'vertical',
  });

  assert.deepEqual(layout.pageBounds, { x: 200, y: 40, width: 0, height: 0 });
  assert.deepEqual(layout.findBounds, { x: 200, y: 40, width: 0, height: 0 });
  assert.equal(layout.findCapsuleMaxWidth, 0);
});
