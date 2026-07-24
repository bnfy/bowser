const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { _electron } = require('playwright');
const { BeforeAll, AfterAll, Before, setDefaultTimeout } = require('@cucumber/cucumber');
const fixtures = require('./fixtures-server');
const ctx = require('./context');

// Launching Electron + first evaluate is slow; give scenarios generous headroom.
setDefaultTimeout(60_000);

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
let userDataDir;
let fixturesHandle;

async function launchApp() {
  const electronApp = await _electron.launch({
    args: [REPO_ROOT, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, BLANC_TEST: '1' },
  });

  // Wait for whenReady to have installed the test hook.
  await electronApp.evaluate(
    () => new Promise((resolve) => {
      const t = setInterval(() => {
        if (globalThis.__blanc) { clearInterval(t); resolve(); }
      }, 50);
    })
  );
  return electronApp;
}

BeforeAll({ timeout: 120_000 }, async () => {
  fixturesHandle = await fixtures.start();
  ctx.fixturesBase = fixturesHandle.base;

  // Isolated, throwaway profile so no prior session/history/settings leaks in.
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-acceptance-'));

  ctx.app = await launchApp();
  // F28-1 exercises a genuine process relaunch against this same profile,
  // rather than a renderer reload or an in-memory persistence proxy.
  ctx.relaunch = async () => {
    if (ctx.app) await ctx.app.close();
    ctx.app = await launchApp();
  };
});

Before(async function () {
  ctx.tabByName = {};
  ctx.activeExpectedUrl = null;
  ctx.lastNewTabId = null;
  ctx.enteredInput = null;
  await ctx.app.evaluate(() => globalThis.__blanc.reset());
});

AfterAll(async () => {
  if (ctx.app) await ctx.app.close();
  ctx.app = null;
  ctx.relaunch = null;
  if (fixturesHandle) await fixturesHandle.close();
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
});
