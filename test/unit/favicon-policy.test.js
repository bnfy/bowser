const assert = require('node:assert/strict');
const test = require('node:test');

const { shouldClearFaviconOnNavigate } = require('../../src/main/favicon-policy');

// Regression guard for the recurring "favicon vanishes in the island" bug.
// Root cause: did-navigate blanked tab.favicon on every URL change and relied on
// Chromium re-firing page-favicon-updated to restore it — but that event does
// NOT re-fire on a same-origin navigation whose favicon is already known
// (apple.com/ -> apple.com/mac/), and a favicon.ico-only site has nothing for
// upgradeFavicon to restore. Clearing must therefore be cross-origin ONLY.

test('keeps favicon on a same-origin path change (the apple.com/mac regression)', () => {
  assert.equal(shouldClearFaviconOnNavigate('https://www.apple.com/', 'https://www.apple.com/mac/'), false);
});

test('keeps favicon on an identical-URL soft reload (the cnn.com case, 2c1da79)', () => {
  assert.equal(shouldClearFaviconOnNavigate('https://www.cnn.com/', 'https://www.cnn.com/'), false);
});

test('keeps favicon across same-origin query/hash changes', () => {
  assert.equal(shouldClearFaviconOnNavigate('https://x.com/home', 'https://x.com/search?q=a'), false);
  assert.equal(shouldClearFaviconOnNavigate('https://x.com/a', 'https://x.com/a#section'), false);
});

test('clears favicon on a cross-origin navigation', () => {
  assert.equal(shouldClearFaviconOnNavigate('https://github.com/', 'https://www.apple.com/'), true);
});

test('clears favicon on a cross-subdomain navigation (different origin)', () => {
  assert.equal(shouldClearFaviconOnNavigate('https://apple.com/', 'https://www.apple.com/'), true);
  assert.equal(shouldClearFaviconOnNavigate('https://docs.github.com/', 'https://github.com/'), true);
});

test('clears favicon on a scheme change to the same host', () => {
  assert.equal(shouldClearFaviconOnNavigate('http://example.com/', 'https://example.com/'), true);
});

test('clears when leaving or entering an internal blanc:// page', () => {
  assert.equal(shouldClearFaviconOnNavigate('blanc://newtab/', 'https://www.apple.com/'), true);
  assert.equal(shouldClearFaviconOnNavigate('https://www.apple.com/', 'blanc://newtab/'), true);
});

test('clears between two internal pages (opaque origins are not "same origin")', () => {
  // blanc:// (and data:/about:) serialize to the opaque origin "null"; two
  // different internal pages must not be mistaken for a same-origin nav.
  assert.equal(shouldClearFaviconOnNavigate('blanc://newtab/', 'blanc://history/'), true);
  assert.equal(shouldClearFaviconOnNavigate('about:blank', 'data:text/html,x'), true);
});

test('handles an empty/undefined prior URL (freshly created tab) by clearing', () => {
  assert.equal(shouldClearFaviconOnNavigate('', 'https://www.apple.com/'), true);
});
