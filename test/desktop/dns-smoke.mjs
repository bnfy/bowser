// Cross-platform DoH launch smoke. Proves: the app starts (no configureHostResolver
// throw), defaults are live, Cloudflare secure DoH resolves, and an unreachable strict
// custom resolver fails closed (no plaintext fallback). Isolated profile — never reads
// the developer's real settings. Run by .github/workflows/prerelease-smoke.yml.
import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-dns-smoke-'));
const app = await _electron.launch({
  args: [path.resolve('.'), `--user-data-dir=${userDataDir}`],
  env: { ...process.env, BLANC_TEST: '1' },
});

// Resolve a host through the default session's Chromium resolver, which honors the
// process-wide app.configureHostResolver config. Playwright passes the Electron module
// as the FIRST callback arg and the supplied value SECOND (so no require() needed).
// true = resolved, false = failed.
const canResolve = (host) => app.evaluate(async ({ session }, h) => {
  try { await session.defaultSession.resolveHost(h); return true; } catch { return false; }
}, host);
// After a DNS setting change, app.configureHostResolver has already run synchronously
// inside the settings listener; await a cache clear (deterministic — not a fixed sleep)
// so the next probe uses the new resolver.
const clearDnsCache = () => app.evaluate(async ({ session }) => {
  await session.defaultSession.clearHostResolverCache();
});

try {
  await app.firstWindow(); // startup didn't crash (a ready-handler throw would prevent this)

  assert.equal(await app.evaluate(() => globalThis.__blanc.secureDns()), 'auto', 'default secureDns should be auto');
  assert.equal(await app.evaluate(() => globalThis.__blanc.webrtcPolicy()), 'standard', 'default webrtcPolicy should be standard');

  // Secure mode WORKS here without enableBuiltInResolver (the Linux question).
  await app.evaluate(() => globalThis.__blanc.setSecureDns('cloudflare'));
  await clearDnsCache();
  assert.ok(await canResolve('example.com'), 'Cloudflare secure DoH should resolve example.com');

  // Strict custom FAILS CLOSED — unreachable resolver, distinct host to dodge any cache.
  await app.evaluate(() => globalThis.__blanc.setSecureDns('custom', 'https://127.0.0.1:9/dns-query'));
  await clearDnsCache();
  assert.ok(!(await canResolve('cloudflare.com')), 'unreachable strict custom DoH must fail closed');

  console.log(`dns-smoke OK on ${process.platform}`);
} finally {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
