const assert = require('node:assert/strict');
const test = require('node:test');

const { matchesHost, buildFillScript } = require('../../src/main/onepassword');

test('matchesHost: exact host matches', () => {
  assert.equal(matchesHost(['https://github.com/login'], 'github.com'), true);
});

test('matchesHost: www vs bare host both directions', () => {
  assert.equal(matchesHost(['https://www.github.com'], 'github.com'), true);
  assert.equal(matchesHost(['https://github.com'], 'www.github.com'), true);
});

test('matchesHost: scheme-less stored value matches', () => {
  assert.equal(matchesHost(['github.com'], 'github.com'), true);
});

test('matchesHost: subdomain must NOT match', () => {
  assert.equal(matchesHost(['https://login.github.com'], 'github.com'), false);
});

test('matchesHost: substring trap must NOT match', () => {
  assert.equal(matchesHost(['https://github.com.evil.com'], 'github.com'), false);
});

test('matchesHost: item with multiple urls, one matches', () => {
  assert.equal(matchesHost(['https://example.org', 'github.com'], 'github.com'), true);
});

test('matchesHost: item with no urls does not match', () => {
  assert.equal(matchesHost([], 'github.com'), false);
});

test('matchesHost: malformed stored url is skipped, not thrown', () => {
  assert.doesNotThrow(() => matchesHost(['http://', ':::', 'github.com'], 'github.com'));
  assert.equal(matchesHost(['http://', ':::', 'github.com'], 'github.com'), true);
});

test('buildFillScript: embeds expectedURL and timeOrigin via JSON.stringify', () => {
  const s = buildFillScript({ expectedURL: 'https://github.com/login', expectedTimeOrigin: 1234.5, username: 'u', password: 'p' });
  assert.ok(s.includes(JSON.stringify('https://github.com/login')));
  assert.ok(s.includes('1234.5'));
});

test('buildFillScript: dangerous credential chars are safely escaped', () => {
  const nasty = 'a"b\\c\nd\'e';
  const s = buildFillScript({ expectedURL: 'https://x.test/', expectedTimeOrigin: 0, username: null, password: nasty });
  assert.ok(s.includes(JSON.stringify(nasty)));       // embedded encoded
  assert.ok(!s.includes('"' + nasty + '"'));          // never the raw sequence in double quotes
});

test('buildFillScript: contains identity guard, visibility check, native setter', () => {
  const s = buildFillScript({ expectedURL: 'https://x.test/', expectedTimeOrigin: 0, username: 'u', password: 'p' });
  assert.ok(s.includes('location.href'));
  assert.ok(s.includes('document.hasFocus()'));
  assert.ok(s.includes('performance.timeOrigin'));
  assert.ok(s.includes('offsetParent'));
  assert.ok(s.includes('HTMLInputElement.prototype'));
});

test('buildFillScript: null username still embeds a null literal (fills password only)', () => {
  const s = buildFillScript({ expectedURL: 'https://x.test/', expectedTimeOrigin: 0, username: null, password: 'p' });
  assert.ok(s.includes('null !== null'));  // the USER !== null guard resolves to false at runtime
});

test('requiring onepassword.js does NOT eagerly load the 1Password SDK', () => {
  // The module must stay import-light: `@1password/sdk` is loaded only inside
  // the SDK functions, so a normal packaged startup never pays for it.
  const resolved = require.resolve('../../src/main/onepassword');
  delete require.cache[resolved];
  require('../../src/main/onepassword');
  const sdkLoaded = Object.keys(require.cache).some((p) => p.includes('@1password' + require('path').sep + 'sdk'));
  assert.equal(sdkLoaded, false);
});
