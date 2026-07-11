const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { parseNetscapeBookmarks } = require('../../src/main/bookmark-import');

const FIXED_NOW = 1710000000000; // ms, after all fixture ADD_DATEs, before the "future" one
const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
const byUrl = (entries) => new Map(entries.map((e) => [e.url, e]));

test('chrome: immediate-parent folders, entity decode, icon, non-http dropped', () => {
  const entries = parseNetscapeBookmarks(fixture('chrome-bookmarks.html'), { now: FIXED_NOW });
  const m = byUrl(entries);
  assert.equal(m.get('https://example.com/').folder, 'Bookmarks bar');
  assert.equal(m.get('https://example.com/').favicon, 'data:image/png;base64,AAAA');
  assert.equal(m.get('https://example.com/').addedAt, 1700000000 * 1000);
  // immediate parent is News, not the joined path
  assert.equal(m.get('https://news.example.com/tech?q=a&b=1').folder, 'News');
  assert.equal(m.get('https://news.example.com/tech?q=a&b=1').title, 'Tech & Science');
  assert.equal(m.get('https://plain.example.org/').folder, 'Other bookmarks');
  // javascript: bookmarklet is dropped
  assert.equal([...m.keys()].some((u) => u.startsWith('javascript:')), false);
});

test('firefox: single/bare quotes, place: dropped, future date clamped to now', () => {
  const entries = parseNetscapeBookmarks(fixture('firefox-bookmarks.html'), { now: FIXED_NOW });
  const m = byUrl(entries);
  assert.equal(m.get('https://www.mozilla.org/').folder, 'Mozilla Firefox');
  assert.equal(m.get('https://www.mozilla.org/').addedAt, 1600000000 * 1000);
  assert.equal([...m.keys()].some((u) => u.startsWith('place:')), false);
  assert.equal(m.get('https://future.example.com/').addedAt, FIXED_NOW); // future rejected
});

test('safari: uppercase tags, top-level (no H3) is ungrouped', () => {
  const entries = parseNetscapeBookmarks(fixture('safari-bookmarks.html'), { now: FIXED_NOW });
  const m = byUrl(entries);
  assert.equal(m.get('https://apple.com/').folder, 'Favorites');
  assert.equal(m.get('https://toplevel.example.net/').folder, null);
});

test('over-length ICON is dropped to null favicon', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(3000);
  const html = `<DL><p><DT><A HREF="https://x.com/" ICON="${big}">X</A></DL><p>`;
  const [e] = parseNetscapeBookmarks(html, { now: FIXED_NOW });
  assert.equal(e.favicon, null);
});
