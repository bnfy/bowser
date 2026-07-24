import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { _electron } from 'playwright';

const defaultExecutable = process.platform === 'darwin'
  ? path.resolve('dist/mac-arm64/Blanc.app/Contents/MacOS/Blanc')
  : null;
const executablePath = process.env.BLANC_PACKAGED_EXECUTABLE || defaultExecutable;
if (!executablePath || !fs.existsSync(executablePath)) {
  throw new Error(
    'Packaged Blanc executable not found. Set BLANC_PACKAGED_EXECUTABLE or build dist/mac-arm64 first.'
  );
}

const poll = async (read, predicate, message, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${message}; last value: ${JSON.stringify(value)}`);
};

const withPackagedApp = async ({ label, env = {}, launchArgs = [], prepare }, run) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `blanc-${label}-`));
  let app;
  try {
    await prepare?.(userDataDir);
    app = await _electron.launch({
      executablePath,
      args: [`--user-data-dir=${userDataDir}`, ...launchArgs],
      env: { ...process.env, BLANC_TEST: '0', ...env },
    });
    await app.firstWindow();
    await run({ app, userDataDir });
  } finally {
    if (app) await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
};

const readStartPage = (app) => app.evaluate(async ({ webContents }) => {
  const page = webContents.getAllWebContents()
    .find((candidate) => candidate.getURL().startsWith('blanc://newtab'));
  if (!page) return null;
  return page.executeJavaScript(`({
    privacyHidden: document.getElementById('privacyCard')?.hidden,
    startupHidden: document.getElementById('startupCard')?.hidden,
    startupActionsHidden: document.getElementById('startupActions')?.hidden,
    startupTitle: document.getElementById('startupTitle')?.textContent,
    suggestions: document.getElementById('privacySuggestions')?.checked,
    usagePing: document.getElementById('privacyPing')?.checked
  })`);
});

const executeOnStartPage = (app, source) => app.evaluate(
  async ({ webContents }, javascript) => {
    const page = webContents.getAllWebContents()
      .find((candidate) => candidate.getURL().startsWith('blanc://newtab'));
    if (!page) throw new Error('new-tab WebContentsView disappeared');
    return page.executeJavaScript(javascript);
  },
  source
);

await withPackagedApp({ label: 'packaged-first-run' }, async ({ app, userDataDir }) => {
  const initial = await poll(
    () => readStartPage(app),
    (state) => state?.privacyHidden === false,
    'fresh packaged profile did not show the privacy choices'
  );
  assert.equal(initial.suggestions, true, 'search suggestions should reflect their current default');
  assert.equal(initial.usagePing, true, 'usage ping should reflect its current default');
  assert.ok(
    !fs.existsSync(path.join(userDataDir, 'install.json')),
    'telemetry install id must not be created before consent'
  );

  await executeOnStartPage(app, `
    document.getElementById('privacySuggestions').checked = false;
    document.getElementById('privacyPing').checked = false;
    document.getElementById('privacyContinue').click();
  `);
  await poll(
    () => readStartPage(app),
    (state) => state?.privacyHidden === true,
    'saved privacy choices did not dismiss first-run UI'
  );

  const settings = JSON.parse(
    fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8')
  );
  assert.equal(settings.onboardingVersion, 1);
  assert.equal(settings.searchSuggestions, false);
  assert.equal(settings.usagePing, false);
  assert.ok(
    !fs.existsSync(path.join(userDataDir, 'install.json')),
    'declining telemetry must not mint an install id'
  );
  await poll(
    () => readStartPage(app),
    (state) => state?.startupHidden === true,
    'cold-online blocker initialization did not release browsing',
    60_000
  );
});

await withPackagedApp({
  label: 'packaged-filter-retry',
  launchArgs: ['https://example.com/queued-for-retry'],
  env: {
    BLANC_TEST: '1',
    BLANC_TEST_ADBLOCK_FAILURE: 'once',
  },
  prepare: async (userDataDir) => {
    fs.writeFileSync(path.join(userDataDir, 'adblock-engine.v2.bin'), 'corrupt cache');
  },
}, async ({ app, userDataDir }) => {
  await poll(
    () => readStartPage(app),
    (state) => state?.startupActionsHidden === false,
    'one-shot filter failure did not expose Retry',
    30_000
  );
  await executeOnStartPage(app, `document.getElementById('startupRetry').click();`);
  await poll(
    () => readStartPage(app),
    (state) => state?.startupHidden === true,
    'Retry did not rebuild blocking and release startup',
    60_000
  );
  await poll(
    () => app.evaluate(({ webContents }) =>
      webContents.getAllWebContents().map((candidate) => candidate.getURL())
    ),
    (urls) => urls.includes('https://example.com/queued-for-retry'),
    'queued navigation was not released after successful Retry'
  );
  const settings = JSON.parse(
    fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8')
  );
  assert.equal(settings.adblockEnabled, true, 'successful Retry must keep blocking enabled');
});

await withPackagedApp({
  label: 'packaged-filter-failure',
  launchArgs: ['https://example.com/queued-at-startup'],
  env: {
    BLANC_TEST: '1',
    BLANC_TEST_ADBLOCK_FAILURE: 'always',
  },
  prepare: async (userDataDir) => {
    // A corrupt cache must fall back to a rebuild. The injected fetch failure
    // makes that rebuild deterministically offline without changing the
    // machine's network settings.
    fs.writeFileSync(path.join(userDataDir, 'adblock-engine.v2.bin'), 'corrupt cache');
  },
}, async ({ app, userDataDir }) => {
  const failed = await poll(
    () => readStartPage(app),
    (state) => state?.startupActionsHidden === false,
    'corrupt-cache/offline startup did not expose recovery actions',
    30_000
  );
  assert.equal(failed.startupHidden, false);
  assert.equal(failed.startupTitle, 'Blocking could not start.');

  await executeOnStartPage(
    app,
    `document.getElementById('startupContinue').click();`
  );
  await poll(
    () => readStartPage(app),
    (state) => state?.startupHidden === true,
    'Continue without blocking did not release the startup gate'
  );
  await poll(
    () => app.evaluate(({ webContents }) =>
      webContents.getAllWebContents().map((candidate) => candidate.getURL())
    ),
    (urls) => urls.includes('https://example.com/queued-at-startup'),
    'queued command-line navigation was not released after the explicit decision'
  );

  const settingsPath = path.join(userDataDir, 'settings.json');
  const settings = await poll(
    () => fs.existsSync(settingsPath)
      ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      : null,
    (value) => value?.adblockEnabled === false,
    'Continue without blocking did not persist the effective setting'
  );
  assert.equal(settings.adblockEnabled, false);
});

console.log(`packaged-first-run-smoke OK: ${executablePath}`);
