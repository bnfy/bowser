const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { _electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLIENT_HINTS = [
  'Sec-CH-UA-Full-Version-List',
  'Sec-CH-UA-Platform-Version',
  'Sec-CH-UA-Arch',
  'Sec-CH-UA-Bitness',
  'Sec-CH-UA-Model',
  'Sec-CH-UA-WoW64',
].join(', ');

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function sendHtml(res, body, headers = {}) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`);
}

async function waitForWebContents(app, matcher, timeout = 20_000) {
  return app.evaluate(async (electron, { matcher, timeout }) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = electron.webContents.getAllWebContents().find((wc) => {
        try {
          const url = new URL(wc.getURL());
          return (!matcher.hostname || url.hostname === matcher.hostname) &&
            (!matcher.port || url.port === matcher.port) &&
            (!matcher.pathname || url.pathname === matcher.pathname) &&
            (!matcher.search || url.search.includes(matcher.search));
        } catch {
          return false;
        }
      });
      if (found && !found.isLoading()) return { id: found.id, url: found.getURL() };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }, { matcher, timeout });
}

function evaluateWebContents(app, id, source) {
  return app.evaluate((electron, { id, source }) => {
    const wc = electron.webContents.fromId(id);
    if (!wc) throw new Error(`webContents ${id} no longer exists`);
    return wc.executeJavaScript(source);
  }, { id, source });
}

function clickWebContents(app, id, selector) {
  return app.evaluate(async (electron, { id, selector }) => {
    const wc = electron.webContents.fromId(id);
    if (!wc) throw new Error(`webContents ${id} no longer exists`);
    const point = await wc.executeJavaScript(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) return null;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = target.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    })()`);
    if (!point) throw new Error(`Could not find ${selector}`);
    wc.focus();
    wc.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
    wc.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }, { id, selector });
}

async function waitForOAuthResult(app, relyingId, mode, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluateWebContents(
      app,
      relyingId,
      `window.oauthResults?.[${JSON.stringify(mode)}] ?? null`
    );
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

test('Google OAuth compatibility holds across popup and tab-style flows', { timeout: 120_000 }, async (t) => {
  let relyingBase;
  const identity = await listen((req, res) => {
    const url = new URL(req.url, 'http://identity.test');
    if (url.pathname === '/signals') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.headers));
      return;
    }

    if (url.pathname !== '/google') {
      res.writeHead(404).end('Not found');
      return;
    }

    const mode = url.searchParams.get('mode');
    const callbackUrl = `${relyingBase}/oauth/callback`;
    sendHtml(res, `<p>Google provider fixture</p><script>
      setTimeout(async () => {
        const requestHeaders = await fetch('/signals').then((response) => response.json());
        const highEntropy = await navigator.userAgentData?.getHighEntropyValues([
          'architecture',
          'bitness',
          'fullVersionList',
          'model',
          'platformVersion',
          'wow64',
        ]);
        const payload = {
          mode: ${JSON.stringify(mode)},
          userActivationTrusted: ${JSON.stringify(url.searchParams.get('trusted'))} === 'true',
          openerAtProvider: !!window.opener,
          userAgent: navigator.userAgent,
          brands: navigator.userAgentData?.brands || [],
          identityCredential: typeof IdentityCredential,
          chromeApp: typeof window.chrome?.app === 'object',
          chromeCsi: typeof window.chrome?.csi === 'function',
          chromeLoadTimes: typeof window.chrome?.loadTimes === 'function',
          highEntropy,
          requestHeaders,
        };
        const target = new URL(${JSON.stringify(callbackUrl)});
        target.searchParams.set('mode', ${JSON.stringify(mode)});
        target.searchParams.set('payload', JSON.stringify(payload));
        location.replace(target);
      }, 100);
    </script>`, { 'Accept-CH': CLIENT_HINTS });
  });

  const relying = await listen((req, res) => {
    const url = new URL(req.url, 'http://relying.test');
    if (url.pathname === '/oauth/callback') {
      sendHtml(res, `<p>OAuth callback</p><script>
        const params = new URLSearchParams(location.search);
        const mode = params.get('mode');
        const payload = JSON.parse(params.get('payload'));
        payload.openerAtCallback = !!window.opener;
        payload.callbackOrigin = location.origin;
        window.opener?.postMessage({ kind: 'oauth-result', mode, payload }, location.origin);
        document.body.dataset.delivered = 'true';
      </script>`);
      return;
    }

    if (url.pathname !== '/relying') {
      res.writeHead(404).end('Not found');
      return;
    }

    const provider = `${identity.base}/google`;
    sendHtml(res, `
      <button id="popup-login">Popup Google login</button>
      <button id="tab-login">Tab Google login</button>
      <output id="result"></output>
      <script>
        window.oauthResults = {};
        const provider = ${JSON.stringify(provider)};
        document.getElementById('popup-login').addEventListener('click', (event) => {
          window.open(provider + '?mode=popup&trusted=' + event.isTrusted, 'google-oauth', 'popup,width=520,height=680');
        });
        document.getElementById('tab-login').addEventListener('click', (event) => {
          window.open(provider + '?mode=tab&trusted=' + event.isTrusted, '_blank');
        });
        window.addEventListener('message', (event) => {
          if (event.origin !== location.origin || event.data?.kind !== 'oauth-result') return;
          window.oauthResults[event.data.mode] = event.data.payload;
          document.getElementById('result').textContent = JSON.stringify(window.oauthResults);
        });
      </script>`);
  });
  relyingBase = relying.base;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-oauth-'));
  let app;
  t.after(async () => {
    if (app) await app.close();
    await relying.close();
    await identity.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(`${userDataDir}-Dev`, { recursive: true, force: true });
  });

  app = await _electron.launch({
    args: [REPO_ROOT, `--user-data-dir=${userDataDir}`, `${relying.base}/relying`],
    env: { ...process.env, BLANC_TEST: '1' },
  });

  const relyingUrl = new URL(relying.base);
  const relyingWc = await waitForWebContents(app, {
    hostname: relyingUrl.hostname,
    port: relyingUrl.port,
    pathname: '/relying',
  });
  assert.ok(relyingWc, 'relying-party tab should load');

  for (const mode of ['popup', 'tab']) {
    await clickWebContents(app, relyingWc.id, `#${mode}-login`);

    const callbackWc = await waitForWebContents(app, {
      hostname: relyingUrl.hostname,
      port: relyingUrl.port,
      pathname: '/oauth/callback',
      search: `mode=${mode}`,
    });
    assert.ok(callbackWc, `${mode} flow should reach the callback`);

    const result = await waitForOAuthResult(app, relyingWc.id, mode);
    assert.ok(result, `${mode} flow should post its result to the opener`);
    assert.equal(result.mode, mode);
    assert.equal(result.userActivationTrusted, true, `${mode} flow should start from trusted input`);
    assert.equal(result.openerAtProvider, true, `${mode} provider should retain window.opener`);
    assert.equal(result.openerAtCallback, true, `${mode} callback should retain window.opener`);
    assert.equal(result.callbackOrigin, relying.base);
    assert.doesNotMatch(result.userAgent, /Electron|blanc/i);
    assert.ok(
      result.brands.some(({ brand }) => brand === 'Google Chrome'),
      `${mode} navigator.userAgentData should advertise Google Chrome`
    );
    assert.equal(result.identityCredential, 'undefined', 'FedCM should be hidden in Electron');
    assert.equal(result.chromeApp, true, `${mode} provider should expose window.chrome.app`);
    assert.equal(result.chromeCsi, true, `${mode} provider should expose window.chrome.csi`);
    assert.equal(result.chromeLoadTimes, true, `${mode} provider should expose window.chrome.loadTimes`);

    const headers = result.requestHeaders;
    assert.match(headers['sec-ch-ua'], /Google Chrome/);
    assert.equal(headers['sec-ch-ua-mobile'], '?0');
    assert.equal(headers['sec-ch-ua-platform'], process.platform === 'darwin' ? '"macOS"' : process.platform === 'win32' ? '"Windows"' : '"Linux"');

    const highEntropy = result.highEntropy;
    assert.ok(highEntropy.fullVersionList.some(({ brand }) => brand === 'Google Chrome'));
    assert.equal(highEntropy.architecture, process.arch === 'arm64' ? 'arm' : process.arch === 'x64' || process.arch === 'ia32' ? 'x86' : process.arch);
    assert.equal(highEntropy.bitness, process.arch.includes('64') ? '64' : '32');
    assert.equal(highEntropy.model, '');
    assert.equal(highEntropy.wow64, false);
    if (process.platform === 'darwin') {
      assert.match(highEntropy.platformVersion, /^\d+\.\d+\.\d+$/);
    }

    await app.evaluate((electron, id) => electron.webContents.fromId(id)?.close(), callbackWc.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});
