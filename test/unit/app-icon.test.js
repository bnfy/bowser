const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP_ICON_ASSETS = require('../../src/main/app-icon-assets');
const {
  applyDockAppIcon,
  macOSMajorVersion,
  nativeIconNameFor,
} = require('../../src/main/app-icon');

const image = (empty = false) => ({ isEmpty: () => empty });
const root = path.join(__dirname, '../..');

function harness({ packaged = true, namedEmpty = false, pathEmpty = false } = {}) {
  const calls = [];
  return {
    calls,
    app: {
      isPackaged: packaged,
      dock: { setIcon: (icon) => calls.push(['setIcon', icon]) },
    },
    nativeImage: {
      createFromNamedImage: (name) => {
        calls.push(['named', name]);
        return image(namedEmpty);
      },
      createFromPath: (file) => {
        calls.push(['path', file]);
        return image(pathEmpty);
      },
    },
  };
}

test('every selectable colorway has a named native icon stack', () => {
  const selectable = [
    'paper', 'ink', 'graphite', 'default', 'midnight', 'cream', 'forest', 'sage',
    'ember', 'plum', 'gold',
  ].sort();
  assert.deepEqual(Object.keys(APP_ICON_ASSETS).sort(), selectable);
  assert.equal(new Set(Object.values(APP_ICON_ASSETS).map((x) => x.nativeName)).size, selectable.length);
});

test('packaging wires the Icon Composer source and multi-colorway compiler', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.build.mac.icon, 'build/app-icons/Icon.icon');
  assert.equal(pkg.build.afterPack, 'scripts/after-pack-app-icons.js');

  const source = JSON.parse(fs.readFileSync(
    path.join(root, 'build/app-icons/Icon.icon/icon.json'),
    'utf8',
  ));
  const appearances = source.groups[0].layers[0]['fill-specializations']
    .map(({ appearance }) => appearance ?? 'default');
  assert.deepEqual(appearances, ['default', 'dark', 'tinted']);
});

test('uses the adaptive named icon in a packaged macOS 26+ build', () => {
  const h = harness();
  const result = applyDockAppIcon({
    ...h,
    appIcon: 'default',
    platform: 'darwin',
    systemVersion: '26.5.1',
  });
  assert.deepEqual(result, { source: 'native', nativeName: 'Evergreen' });
  assert.equal(h.calls[0][0], 'named');
  assert.equal(h.calls[0][1], 'Evergreen');
  assert.equal(h.calls.some(([kind]) => kind === 'path'), false);
});

test('uses the flat PNG in dev and on pre-Tahoe macOS', () => {
  for (const [packaged, version] of [[false, '27.0'], [true, '15.7']]) {
    const h = harness({ packaged });
    const result = applyDockAppIcon({
      ...h,
      appIcon: 'ink',
      platform: 'darwin',
      systemVersion: version,
      iconsDirectory: '/icons',
    });
    assert.deepEqual(result, { source: 'png', appIcon: 'ink' });
    assert.deepEqual(h.calls[0], ['path', '/icons/icon-ink.png']);
  }
});

test('falls back to the PNG if the packaged asset catalog cannot resolve a name', () => {
  const h = harness({ namedEmpty: true });
  const result = applyDockAppIcon({
    ...h,
    appIcon: 'plum',
    platform: 'darwin',
    systemVersion: '27.0',
    iconsDirectory: '/icons',
  });
  assert.deepEqual(result, { source: 'png', appIcon: 'plum' });
  assert.deepEqual(h.calls.slice(0, 2), [
    ['named', 'Plum'],
    ['path', '/icons/icon-plum.png'],
  ]);
});

test('unknown ids safely resolve to Paper', () => {
  assert.equal(nativeIconNameFor('not-an-icon'), 'Icon');
  assert.equal(macOSMajorVersion('26.4.1'), 26);
  assert.equal(macOSMajorVersion('n/a'), 0);
});
