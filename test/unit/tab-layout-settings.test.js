const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const settingsSchema = require('../../settings-schema/schema.json');

const electronId = require.resolve('electron');
const originalElectron = require.cache[electronId];
let activeUserData = null;
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: {
    app: {
      getPath: () => activeUserData,
      on: () => {},
    },
  },
};

function loadSettings(userData) {
  activeUserData = userData;
  delete require.cache[require.resolve('../../src/main/settings')];
  delete require.cache[require.resolve('../../src/main/store')];
  return require('../../src/main/settings');
}

test.after(() => {
  delete require.cache[require.resolve('../../src/main/settings')];
  delete require.cache[require.resolve('../../src/main/store')];
  if (originalElectron) require.cache[electronId] = originalElectron;
  else delete require.cache[electronId];
});

test('tab layout defaults, validates, persists, and stays out of Profile Sync', async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-tab-layout-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));

  let settings = loadSettings(userData);
  assert.deepEqual(settings.TAB_LAYOUTS, ['island', 'vertical']);
  assert.deepEqual(settingsSchema.tabLayouts, settings.TAB_LAYOUTS);
  assert.equal(settingsSchema.internalDefaults.includes('tabLayout'), true);
  assert.equal(settings.getSettings().tabLayout, 'island');

  assert.equal(settings.setSettings({ tabLayout: 'vertical' }).tabLayout, 'vertical');
  assert.equal(
    Object.prototype.hasOwnProperty.call(settings.exportForSync().values, 'tabLayout'),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(settings.getSettings()._syncMeta, 'tabLayout'),
    false
  );

  settings.mergeFromSync({
    values: { tabLayout: 'island' },
    meta: { tabLayout: Date.now() + 10_000 },
  });
  assert.equal(settings.getSettings().tabLayout, 'vertical');
  assert.equal(settings.setSettings({ tabLayout: 'diagonal' }).tabLayout, 'vertical');

  await new Promise((resolve) => setTimeout(resolve, 300));
  settings = loadSettings(userData);
  assert.equal(settings.getSettings().tabLayout, 'vertical');

  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ onboardingVersion: 1, tabLayout: 'diagonal' })
  );
  settings = loadSettings(userData);
  assert.equal(settings.getSettings().tabLayout, 'island');
});

test('settings page presents the two tab layouts as an Appearance choice', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../../src/renderer/pages/settings.html'),
    'utf8'
  );
  const renderer = fs.readFileSync(
    path.join(__dirname, '../../src/renderer/pages/settings.js'),
    'utf8'
  );

  assert.match(html, /<span>Tab layout<\/span>/);
  assert.match(html, /<option value="island">Island<\/option>/);
  assert.match(html, /<option value="vertical">Vertical tabs<\/option>/);
  assert.match(html, /search and commands always stay in the Island/);
  assert.match(renderer, /settings\.set\(\{ tabLayout: tabLayout\.value \}\)/);
});
