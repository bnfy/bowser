const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

function loadSettings(userData, existingProfileHint) {
  activeUserData = userData;
  delete require.cache[require.resolve('../../src/main/settings')];
  delete require.cache[require.resolve('../../src/main/store')];
  const settings = require('../../src/main/settings');
  if (existingProfileHint !== undefined) {
    settings.setExistingProfileHint(existingProfileHint);
  }
  return settings;
}

test.after(() => {
  delete require.cache[require.resolve('../../src/main/settings')];
  delete require.cache[require.resolve('../../src/main/store')];
  if (originalElectron) require.cache[electronId] = originalElectron;
  else delete require.cache[electronId];
});

test('a new profile requires first-run while a legacy settings file is promoted', () => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-first-run-fresh-'));
  const existingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-first-run-existing-'));
  fs.writeFileSync(
    path.join(existingDir, 'settings.json'),
    JSON.stringify({ searchSuggestions: false, usagePing: false })
  );

  const fresh = loadSettings(freshDir);
  assert.equal(fresh.isFirstRunComplete(), false);

  const existing = loadSettings(existingDir);
  assert.equal(existing.isFirstRunComplete(), true);
  assert.equal(existing.getSettings().searchSuggestions, false);
  assert.equal(existing.getSettings().usagePing, false);

  fs.rmSync(freshDir, { recursive: true, force: true });
  fs.rmSync(existingDir, { recursive: true, force: true });
});

test('an interrupted first run stays incomplete after session persistence', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-first-run-restart-'));
  let settings = loadSettings(userData, false);
  assert.equal(settings.isFirstRunComplete(), false);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).onboardingVersion,
    0
  );

  fs.writeFileSync(path.join(userData, 'session.json'), JSON.stringify({ urls: [] }));
  settings = loadSettings(userData, true);
  assert.equal(settings.isFirstRunComplete(), false);

  fs.rmSync(userData, { recursive: true, force: true });
});

test('an old profile without settings.json skips first-run when main supplies its marker hint', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-first-run-legacy-'));
  fs.writeFileSync(path.join(userData, 'session.json'), JSON.stringify({ urls: [] }));
  const settings = loadSettings(userData, true);
  assert.equal(settings.isFirstRunComplete(), true);
  fs.rmSync(userData, { recursive: true, force: true });
});

test('first-run choices persist atomically before completion is reported', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-first-run-save-'));
  let settings = loadSettings(userData);

  assert.deepEqual(
    settings.completeFirstRunPrivacyChoices({
      searchSuggestions: false,
      usagePing: true,
    }).completed,
    true
  );
  assert.equal(settings.isFirstRunComplete(), true);

  settings = loadSettings(userData);
  assert.equal(settings.isFirstRunComplete(), true);
  assert.equal(settings.getSettings().searchSuggestions, false);
  assert.equal(settings.getSettings().usagePing, true);

  fs.rmSync(userData, { recursive: true, force: true });
});

test('invalid first-run payloads cannot complete onboarding', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-first-run-invalid-'));
  const settings = loadSettings(userData);

  assert.deepEqual(
    settings.completeFirstRunPrivacyChoices({ searchSuggestions: true }),
    { completed: false, error: 'invalid-choices' }
  );
  assert.equal(settings.isFirstRunComplete(), false);

  fs.rmSync(userData, { recursive: true, force: true });
});
