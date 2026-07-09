const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const CANARIES = [
  {
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    hosts: ['chatgpt.com', 'auth.openai.com'],
    steps: [/^log in$/i, /^(continue|sign in|log in) with google$/i],
  },
  {
    name: 'Instacart',
    url: 'https://www.instacart.com/',
    hosts: ['instacart.com'],
    steps: [/^log in$/i, /^(google|(continue|sign in|log in) with google)$/i],
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shortUrl(raw) {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw;
  }
}

async function googleWebContentsIds(app) {
  return app.evaluate((electron) => electron.webContents.getAllWebContents()
    .filter((wc) => {
      try { return new URL(wc.getURL()).hostname === 'accounts.google.com'; }
      catch { return false; }
    })
    .map((wc) => wc.id));
}

async function waitForSite(app, canary, timeout = 60_000) {
  return app.evaluate(async (electron, { canary, timeout }) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = electron.webContents.getAllWebContents().find((wc) => {
        try {
          const hostname = new URL(wc.getURL()).hostname;
          return canary.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
        } catch {
          return false;
        }
      });
      if (found && !found.isLoading()) return { id: found.id, url: found.getURL() };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }, { canary, timeout });
}

async function clickVisibleText(app, canary, pattern, timeout = 30_000) {
  return app.evaluate(async (electron, { canary, pattern, timeout }) => {
    const deadline = Date.now() + timeout;
    let last = [];
    while (Date.now() < deadline) {
      for (const wc of electron.webContents.getAllWebContents()) {
        let hostname;
        try { hostname = new URL(wc.getURL()).hostname; }
        catch { continue; }
        if (!canary.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) continue;
        if (wc.isLoading()) continue;
        try {
          const result = await wc.executeJavaScript(`(() => {
            const matcher = new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)});
            const candidates = [...document.querySelectorAll('button, a, [role="button"]')];
            const visible = candidates.filter((element) => {
              if (element.getClientRects().length === 0) return false;
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              if (rect.width <= 0 || rect.height <= 0) return false;
              if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return false;
              if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
              const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
              const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
              const hit = document.elementFromPoint(x, y);
              return !!hit && (hit === element || element.contains(hit) || hit.contains(element));
            });
            const labels = visible
              .map((element) => (element.innerText || element.textContent || '').trim())
              .filter(Boolean);
            const target = visible.find((element) =>
              matcher.test((element.innerText || element.textContent || '').trim())
            );
            if (!target) return { clicked: false, labels: labels.slice(0, 40) };
            target.scrollIntoView({ block: 'center', inline: 'center' });
            const rect = target.getBoundingClientRect();
            const label = (target.innerText || target.textContent || '').trim();
            return {
              clicked: true,
              label,
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
            };
          })()`);
          last = result.labels || last;
          if (result.clicked) {
            wc.focus();
            wc.sendInputEvent({ type: 'mouseMove', x: result.x, y: result.y });
            wc.sendInputEvent({ type: 'mouseDown', x: result.x, y: result.y, button: 'left', clickCount: 1 });
            wc.sendInputEvent({ type: 'mouseUp', x: result.x, y: result.y, button: 'left', clickCount: 1 });
            return { clicked: true, label: result.label, url: wc.getURL() };
          }
        } catch {
          // Navigation can replace a renderer between selection and execution.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { clicked: false, labels: last };
  }, { canary, pattern: { source: pattern.source, flags: pattern.flags }, timeout });
}

async function waitForNewGooglePage(app, excludedIds, timeout) {
  return app.evaluate(async (electron, { excludedIds, timeout }) => {
    const excluded = new Set(excludedIds);
    const deadline = Date.now() + timeout;
    const errorPatterns = [
      /this browser or app may not be secure/i,
      /400\. that(?:'|’)s an error/i,
      /access blocked/i,
      /error retrieving a token/i,
    ];
    while (Date.now() < deadline) {
      for (const wc of electron.webContents.getAllWebContents()) {
        if (excluded.has(wc.id) || wc.isLoading()) continue;
        let url;
        try { url = new URL(wc.getURL()); }
        catch { continue; }
        if (url.hostname !== 'accounts.google.com') continue;
        if (url.pathname.includes('gis_transform')) {
          return { ok: false, page: `${url.origin}${url.pathname}`, error: 'FedCM gis_transform failure' };
        }
        try {
          const page = await wc.executeJavaScript(`({
            title: document.title,
            text: document.body?.innerText || '',
            readyState: document.readyState
          })`);
          const error = errorPatterns.find((pattern) => pattern.test(page.text) || pattern.test(page.title));
          if (error) {
            return { ok: false, page: `${url.origin}${url.pathname}`, error: error.source };
          }
          if (page.readyState === 'complete' && /sign in|choose an account|welcome|email|password|continue/i.test(`${page.title}\n${page.text}`)) {
            return { ok: true, page: `${url.origin}${url.pathname}`, title: page.title };
          }
        } catch {
          // The OAuth renderer may redirect again while it settles.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }, { excludedIds, timeout });
}

async function runCanary(app, canary) {
  const site = await waitForSite(app, canary);
  if (!site) throw new Error(`${canary.name}: site did not finish loading`);

  const excludedGoogleIds = await googleWebContentsIds(app);
  const preferredActions = [...canary.steps].reverse();
  for (let attempt = 0; attempt < canary.steps.length; attempt += 1) {
    const alreadyAtGoogle = await waitForNewGooglePage(app, excludedGoogleIds, 2_000);
    if (alreadyAtGoogle) return alreadyAtGoogle;

    let action = null;
    let attemptedPattern = null;
    for (const pattern of preferredActions) {
      attemptedPattern = pattern;
      const candidate = await clickVisibleText(app, canary, pattern, 3_000);
      if (candidate.clicked) {
        action = candidate;
        break;
      }
      action = candidate;
    }
    if (!action.clicked) {
      throw new Error(
        `${canary.name}: could not find any Google-login action (last tried ${attemptedPattern}); visible controls: ${JSON.stringify(action.labels)}`
      );
    }
    process.stdout.write(`  ${canary.name}: clicked “${action.label}” on ${shortUrl(action.url)}\n`);

    const google = await waitForNewGooglePage(
      app,
      excludedGoogleIds,
      attempt === canary.steps.length - 1 ? 30_000 : 5_000
    );
    if (google) return google;
  }

  return waitForNewGooglePage(app, excludedGoogleIds, 30_000);
}

async function main() {
  const requested = process.argv.slice(2).map((value) => value.toLowerCase());
  const canaries = requested.length === 0
    ? CANARIES
    : CANARIES.filter(({ name }) => requested.includes(name.toLowerCase()));
  const missing = requested.filter((name) => !canaries.some((canary) => canary.name.toLowerCase() === name));
  if (missing.length > 0) {
    throw new Error(`Unknown canary ${missing.join(', ')}; choose ${CANARIES.map(({ name }) => name.toLowerCase()).join(', ')}`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-oauth-live-'));
  let app;
  try {
    for (const canary of canaries) {
      process.stdout.write(`Launching Blanc for ${canary.name} with an isolated profile and normal ad blocking…\n`);
      app = await _electron.launch({
        args: [REPO_ROOT, `--user-data-dir=${userDataDir}`, canary.url],
        env: { ...process.env, BLANC_TEST: '0' },
        timeout: 120_000,
      });
      process.stdout.write(`Checking ${canary.name} → Google…\n`);
      const result = await runCanary(app, canary);
      if (!result) throw new Error(`${canary.name}: Google did not render before timeout`);
      if (!result.ok) throw new Error(`${canary.name}: ${result.error} at ${result.page}`);
      process.stdout.write(`✓ ${canary.name}: ${result.title} rendered at ${result.page}\n`);
      await app.close();
      app = null;
      await sleep(250);
    }
  } finally {
    if (app) await app.close();
    if (process.env.BLANC_OAUTH_KEEP_PROFILE === '1') {
      process.stdout.write(`Kept temporary profile at ${userDataDir}-Dev\n`);
    } else {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      fs.rmSync(`${userDataDir}-Dev`, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
