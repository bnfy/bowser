const assert = require('node:assert/strict');
const test = require('node:test');

const { persistableEntries, syncSnapshot } = require('../../src/main/session-snapshot');

const tab = (over = {}) => ({
  id: 't1', url: 'https://a.example/x', title: 'A',
  groupId: null, pinned: false, private: false, ...over,
});

test('persistableEntries: private and url-less tabs drop; error urls unwrap; local schemes stay', () => {
  const entries = persistableEntries([
    tab(),
    tab({ id: 't2', private: true }),
    tab({ id: 't3', url: '' }),
    tab({ id: 't4', url: 'blanc://error/?url=' + encodeURIComponent('https://fail.example/') }),
    tab({ id: 't5', url: 'file:///Users/me/doc.html' }),
    tab({ id: 't6', url: 'blanc://settings/' }),
  ]);
  assert.deepEqual(entries.map((e) => e.id), ['t1', 't4', 't5', 't6']);
  assert.equal(entries[1].url, 'https://fail.example/');
  // session.json keeps file:// and blanc:// — portability is the sync filter's job
  assert.equal(entries[2].url, 'file:///Users/me/doc.html');
  assert.equal(entries[3].url, 'blanc://settings/');
});

test('persistableEntries keeps id/groupId/pinned aligned per entry', () => {
  const entries = persistableEntries([
    tab({ id: 'a', groupId: 'g1', pinned: true }),
    tab({ id: 'b', private: true }),
    tab({ id: 'c' }),
  ]);
  assert.deepEqual(entries, [
    { id: 'a', url: 'https://a.example/x', groupId: 'g1', pinned: true },
    { id: 'c', url: 'https://a.example/x', groupId: null, pinned: false },
  ]);
});

test('syncSnapshot: http(s)-only, url-length skip, title truncation, private excluded', () => {
  const snap = syncSnapshot([
    tab({ title: 'x'.repeat(500), favicon: 'https://a.example/icon.svg' }),
    tab({ id: 'b', url: 'file:///etc/hosts' }),
    tab({ id: 'c', url: 'blanc://settings/' }),
    tab({ id: 'd', private: true }),
    tab({ id: 'e', url: 'https://long.example/' + 'p'.repeat(2100) }),
    tab({
      id: 'f',
      url: 'blanc://error/?url=' + encodeURIComponent('https://fail.example/'),
      favicon: 'javascript:alert(1)',
    }),
  ], []);
  assert.deepEqual(snap.tabs.map((t) => t.url), ['https://a.example/x', 'https://fail.example/']);
  assert.equal(snap.tabs[0].title.length, 200);
  // Mixed-version contract: icon metadata lives in the optional sidecar and
  // must never change the deployed session-tab shape.
  assert.deepEqual(Object.keys(snap.tabs[0]).sort(), ['groupId', 'pinned', 'title', 'url']);
});

test('syncSnapshot caps at 500 tabs and keeps only referenced groups, order preserved, collapsed stripped', () => {
  const many = Array.from({ length: 520 }, (_, i) =>
    tab({ id: `t${i}`, url: `https://a.example/${i}`, groupId: i === 0 ? 'g2' : null }));
  const snap = syncSnapshot(many, [
    { id: 'g1', name: 'unreferenced', collapsed: false },
    { id: 'g2', name: 'work', collapsed: true },
  ]);
  assert.equal(snap.tabs.length, 500);
  assert.deepEqual(snap.groups, [{ id: 'g2', name: 'work' }]);
});
