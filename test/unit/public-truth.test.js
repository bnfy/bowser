const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('app chrome and internal pages have no live Google Fonts dependency', () => {
  const files = [
    'src/renderer/index.html',
    'src/renderer/overlay.html',
    ...fs.readdirSync(path.join(root, 'src/renderer/pages'))
      .filter((name) => name.endsWith('.html'))
      .map((name) => `src/renderer/pages/${name}`),
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /fonts\.(?:googleapis|gstatic)\.com/, file);
  }
  for (const font of ['inter-latin.woff2', 'jetbrains-mono-latin.woff2']) {
    assert.ok(fs.statSync(path.join(root, 'src/renderer/pages', font)).size > 1_000, font);
  }
});

test('privacy copy accounts for suggestions, telemetry, tab/icon sync, and service requests', () => {
  const privacy = read('site/src/pages/privacy.astro');
  assert.doesNotMatch(privacy, /exactly three things/i);
  assert.doesNotMatch(privacy, /nothing else leaves your device/i);
  assert.match(privacy, /Search suggestions \(optional\)/);
  assert.match(privacy, /random per-launch session ID/);
  assert.match(privacy, /open HTTP\(S\) tabs/);
  assert.match(privacy, /source-rasterized PNG favicons/);
  assert.match(privacy, /checks GitHub for app updates/);
  assert.match(privacy, /secure-DNS provider/);
});

test('private-tab copy matches the isolated in-memory session', () => {
  const page = read('site/src/pages/features/private-tabs.astro');
  assert.doesNotMatch(page, /shared with regular tabs/i);
  assert.match(page, /separate in-memory browsing session/i);
  assert.match(page, /files you explicitly save remain on disk/i);
});

test('marketing fixtures use bundled favicon assets only', () => {
  const marketingFiles = [
    ...fs.readdirSync(path.join(root, 'site/src/pages/features'))
      .filter((name) => name.endsWith('.astro'))
      .map((name) => `site/src/pages/features/${name}`),
    'site/src/pages/index.astro',
    'site/src/scripts/demo.js',
  ];
  for (const file of marketingFiles) {
    assert.doesNotMatch(read(file), /icons\.duckduckgo\.com/, file);
  }
  for (const icon of ['github.com.ico', 'notion.so.ico', 'netflix.com.ico']) {
    assert.ok(fs.statSync(path.join(root, 'site/public/favicons', icon)).size > 100, icon);
  }
});

test('downloads distinguish both Mac architectures without guessing from user agent', () => {
  const page = read('site/src/pages/download.astro');
  const script = read('site/src/scripts/site.js');
  assert.match(page, /data-platform="mac-arm64"/);
  assert.match(page, /data-platform="mac-x64"/);
  assert.match(script, /if \(kind === 'mac'\) return null/);
  assert.doesNotMatch(script, /\|\| dmgs\[0\]/);
  assert.match(script, /link\.hidden = true/);
});

test('grant drafts and metrics labels do not overclaim licensing or installs', () => {
  const nlnet = read('docs/grants/nlnet-commons-fund.md');
  const futo = read('docs/grants/futo-pitch.md');
  const stats = read('scripts/stats.sh');
  const readme = read('README.md');

  assert.doesNotMatch(nlnet, /Blanc is an independent, open-source/i);
  assert.match(nlnet, /currently proprietary/);
  assert.doesNotMatch(futo, /an open-source desktop/i);
  assert.doesNotMatch(futo, /only network call/i);
  assert.doesNotMatch(futo, /launch ping,\s*off by default/i);
  assert.match(stats, /artifact-downloads/);
  assert.doesNotMatch(stats, /tag\\tinstalls/);
  assert.doesNotMatch(readme, /else\s+builds unsigned/i);
});

test('platform specs match the shipped first-run telemetry contract', () => {
  const matrix = read('spec/parity-matrix.md');
  const services = read('spec/acceptance/platform-services.feature');
  const telemetryRow = matrix.split('\n').find((line) => line.startsWith('| F21 |')) || '';
  assert.doesNotMatch(telemetryRow, /Opt-in, off by default/i);
  assert.doesNotMatch(services, /usage ping is off by default/i);
  assert.match(matrix, /commit its on\/off choice before any ping/i);
  assert.match(matrix, /\{installId,sessionId,version,platform,arch\}/);
  assert.match(services, /no telemetry install id exists/i);
});
