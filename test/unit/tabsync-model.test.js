const assert = require('node:assert/strict');
const test = require('node:test');

const m = require('../../src/main/tabsync-model');

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const aTab = (over = {}) => ({ url: 'https://a.example/', title: 'A', groupId: null, pinned: false, ...over });
const entry = (over = {}) => ({
  name: 'MacBook Air', platform: 'darwin', updatedAt: NOW - HOUR,
  tabs: [aTab()], groups: [], ...over,
});

test('canonical is key-order independent and array-order dependent', () => {
  assert.equal(m.canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), m.canonical({ a: [2, { c: 4, d: 3 }], b: 1 }));
  assert.notEqual(m.canonical([1, 2]), m.canonical([2, 1]));
});

test('fingerprint ignores updatedAt; sees title/url change, group move, reorder, rename', () => {
  const base = m.fingerprint(entry());
  assert.equal(base, m.fingerprint(entry({ updatedAt: NOW })));
  assert.notEqual(base, m.fingerprint(entry({ name: 'renamed host' })));
  assert.notEqual(base, m.fingerprint(entry({ tabs: [aTab({ title: 'A2' })] })));
  assert.notEqual(base, m.fingerprint(entry({ tabs: [aTab({ groupId: 'g1' })] })));
  const two = entry({ tabs: [aTab(), aTab({ url: 'https://b.example/' })] });
  const swapped = entry({ tabs: [aTab({ url: 'https://b.example/' }), aTab()] });
  assert.notEqual(m.fingerprint(two), m.fingerprint(swapped));
});

test('sanitizeEntry: drops garbage, enforces http(s)/caps, passes retractions', () => {
  assert.equal(m.sanitizeEntry(null), null);
  assert.equal(m.sanitizeEntry({ tabs: [] }), null); // no updatedAt
  assert.deepEqual(m.sanitizeEntry({ retracted: true, updatedAt: NOW, junk: 1 }), { retracted: true, updatedAt: NOW });
  const dirty = m.sanitizeEntry({
    name: 42, platform: null, updatedAt: NOW,
    tabs: [
      aTab(),
      { url: 'javascript:alert(1)', title: 'x' },
      {
        url: 'https://ok.example/',
        title: 7,
        favicon: 'data:image/png;base64,AAAA',
        pinned: 'yes',
        groupId: 9,
      },
      null,
    ],
    groups: [{ id: 'g1', name: 'work' }, { id: 2, name: 'bad' }, null],
  });
  assert.equal(dirty.name, 'unknown device');
  assert.equal(dirty.platform, '');
  assert.deepEqual(dirty.tabs, [
    aTab(),
    { url: 'https://ok.example/', title: '', groupId: null, pinned: true },
  ]);
  assert.deepEqual(dirty.groups, [{ id: 'g1', name: 'work' }]);
});

test('session compatibility: inline favicon fields are removed from cached and remote entries', () => {
  const withInlineIcon = entry({
    tabs: [aTab({ favicon: 'https://tracker.example/device-specific.png' })],
  });
  const out = m.mergeDevices(
    { cached: withInlineIcon },
    { remote: withInlineIcon },
    { now: NOW, ownId: 'me' }
  );
  for (const device of Object.values(out)) {
    assert.deepEqual(Object.keys(device.tabs[0]).sort(), ['groupId', 'pinned', 'title', 'url']);
  }
  // Once cleaned, the ordinary repair comparison sees a stable deployed
  // shape instead of an add/strip write loop between client versions.
  assert.equal(m.devicesEqual(out, JSON.parse(JSON.stringify(out))), true);
});

test('mergeDevices: union by deviceId, LWW per entry, remote sanitized', () => {
  const local = { d1: entry({ updatedAt: NOW - 2 * HOUR }), d2: entry({ name: 'Local d2', updatedAt: NOW - HOUR }) };
  const remote = {
    d1: entry({ name: 'Remote d1 newer', updatedAt: NOW - HOUR }),
    d2: entry({ name: 'Remote d2 older', updatedAt: NOW - 2 * HOUR }),
    d3: entry({ updatedAt: NOW, tabs: [aTab(), { url: 'file:///x', title: 'no' }] }),
    d4: { junk: true },
  };
  const out = m.mergeDevices(local, remote, { now: NOW });
  assert.equal(out.d1.name, 'Remote d1 newer');
  assert.equal(out.d2.name, 'Local d2');
  assert.deepEqual(out.d3.tabs, [aTab()]);
  assert.equal(out.d4, undefined);
});

test('mergeDevices: a retraction LWW-beats a stale copy and cannot be resurrected by an older entry', () => {
  const retraction = { retracted: true, updatedAt: NOW };
  const stale = entry({ updatedAt: NOW - HOUR });
  const a = m.mergeDevices({ d1: stale }, { d1: retraction }, { now: NOW });
  assert.deepEqual(a.d1, retraction);
  const b = m.mergeDevices({ d1: retraction }, { d1: stale }, { now: NOW });
  assert.deepEqual(b.d1, retraction);
});

test('mergeDevices is commutative on equal-clock ties (deterministic tie-breaker)', () => {
  // Same device id, same clock, different contents — each side must pick the
  // SAME winner or two peers merging the same pair diverge (PR #41, P2).
  const x = { d1: entry({ name: 'Version X', updatedAt: NOW }) };
  const y = { d1: entry({ name: 'Version Y', updatedAt: NOW }) };
  const xy = m.mergeDevices(x, y, { now: NOW });
  const yx = m.mergeDevices(y, x, { now: NOW });
  assert.deepEqual(xy, yx);
  // A same-clock retraction beats a same-clock live entry from either side.
  const live = { d1: entry({ updatedAt: NOW }) };
  const gone = { d1: { retracted: true, updatedAt: NOW } };
  assert.deepEqual(m.mergeDevices(live, gone, { now: NOW }).d1, { retracted: true, updatedAt: NOW });
  assert.deepEqual(m.mergeDevices(gone, live, { now: NOW }).d1, { retracted: true, updatedAt: NOW });
});

test('mergeDevices: own entry wins equal-clock ties — the stored full entry never loses to its trimmed upload copy', () => {
  const full = entry({ tabs: [aTab(), aTab({ url: 'https://b.example/' })], updatedAt: NOW });
  const trimmed = entry({ tabs: [aTab()], updatedAt: NOW }); // budget-trimmed upload shares the clock by design
  const out = m.mergeDevices({ me: full }, { me: trimmed }, { now: NOW, ownId: 'me' });
  assert.deepEqual(out.me, full);
  // ...but a strictly newer remote own entry still wins (restored-backup case)
  const newer = entry({ tabs: [aTab()], updatedAt: NOW + 1 });
  assert.deepEqual(m.mergeDevices({ me: full }, { me: newer }, { now: NOW + 1, ownId: 'me' }).me, newer);
});

test('mergeDevices prunes entries older than 30 days on both sides, retracted included', () => {
  const out = m.mergeDevices(
    { old: entry({ updatedAt: NOW - 31 * DAY }), live: entry({ updatedAt: NOW - HOUR }) },
    { oldRemote: entry({ updatedAt: NOW - 31 * DAY }), oldRetract: { retracted: true, updatedAt: NOW - 31 * DAY } },
    { now: NOW }
  );
  assert.deepEqual(Object.keys(out), ['live']);
});

test('rebindDevices: a changed accountId discards all cached entries; same account keeps them', () => {
  const stored = { accountId: 'acct-a', devices: { d1: entry() } };
  assert.equal(m.rebindDevices(stored, 'acct-a'), stored);
  assert.deepEqual(m.rebindDevices(stored, 'acct-b'), { accountId: 'acct-b', devices: {} });
});

test('buildOwnEntry: clock advances only on content change or heartbeat due', () => {
  const snapshot = { tabs: [aTab()], groups: [] };
  const args = { snapshot, name: 'MacBook Air', platform: 'darwin' };
  const first = m.buildOwnEntry({ prev: null, ...args, now: NOW - 2 * HOUR });
  assert.equal(first.updatedAt, NOW - 2 * HOUR);
  // unchanged content, heartbeat not due — keeps the prior clock (a true
  // no-op stays recognizable to the repair comparison)
  const same = m.buildOwnEntry({ prev: first, ...args, now: NOW });
  assert.equal(same.updatedAt, NOW - 2 * HOUR);
  // content change — clock advances
  const changed = m.buildOwnEntry({ prev: first, snapshot: { tabs: [], groups: [] }, name: 'MacBook Air', platform: 'darwin', now: NOW });
  assert.equal(changed.updatedAt, NOW);
  // unchanged content but 24h old — heartbeat bumps the clock
  const stale = { ...first, updatedAt: NOW - 25 * HOUR };
  assert.equal(m.buildOwnEntry({ prev: stale, ...args, now: NOW }).updatedAt, NOW);
});

test('retractedEntry: null when never published; keeps an existing retraction clock', () => {
  assert.equal(m.retractedEntry(null, NOW), null);
  assert.deepEqual(m.retractedEntry(entry(), NOW), { retracted: true, updatedAt: NOW });
  const existing = { retracted: true, updatedAt: NOW - HOUR };
  assert.deepEqual(m.retractedEntry(existing, NOW), existing);
});

test('ownEntryFor: consent gating — off retracts (or omits), on publishes', () => {
  const snapshot = { tabs: [aTab()], groups: [] };
  const args = { snapshot, name: 'MacBook Air', platform: 'darwin', now: NOW };
  assert.equal(m.ownEntryFor({ syncTabs: false, prev: null, ...args }), null);
  assert.deepEqual(m.ownEntryFor({ syncTabs: false, prev: entry(), ...args }), { retracted: true, updatedAt: NOW });
  const published = m.ownEntryFor({ syncTabs: true, prev: null, ...args });
  assert.deepEqual(published.tabs, snapshot.tabs);
  // no snapshot available (provider not registered yet) → treated as off
  assert.equal(m.ownEntryFor({ syncTabs: true, prev: null, snapshot: null, name: 'x', platform: 'darwin', now: NOW }), null);
});

test('heartbeatDue: 24h threshold, never for retractions or missing entries', () => {
  assert.equal(m.heartbeatDue(entry({ updatedAt: NOW - 25 * HOUR }), NOW), true);
  assert.equal(m.heartbeatDue(entry({ updatedAt: NOW - HOUR }), NOW), false);
  assert.equal(m.heartbeatDue({ retracted: true, updatedAt: NOW - 25 * HOUR }, NOW), false);
  assert.equal(m.heartbeatDue(undefined, NOW), false);
});

test('devicesEqual: repair comparison — a map missing our unchanged entry differs', () => {
  const devices = { d1: entry(), d2: entry({ name: 'Other' }) };
  assert.equal(m.devicesEqual(devices, { d2: devices.d2, d1: devices.d1 }), true);
  assert.equal(m.devicesEqual(devices, { d2: devices.d2 }), false);
  assert.equal(m.devicesEqual({}, undefined), true);
});

test('applyBudget: trims own tabs first, then drops stalest other devices', () => {
  const bigTabs = (n) => Array.from({ length: n }, (_, i) => aTab({ url: `https://a.example/${'p'.repeat(500)}/${i}` }));
  const devices = {
    own: entry({ tabs: bigTabs(200), updatedAt: NOW }),
    staler: entry({ tabs: bigTabs(200), updatedAt: NOW - 2 * HOUR }),
    fresher: entry({ tabs: bigTabs(200), updatedAt: NOW - HOUR }),
  };
  const out = m.applyBudget(devices, 'own', { maxBytes: 120 * 1024 });
  assert.ok(Buffer.byteLength(m.canonical(out), 'utf8') <= 120 * 1024);
  assert.ok(out.own.tabs.length < 200, 'own tabs trimmed first');
  assert.equal(devices.own.tabs.length, 200, 'input not mutated');
  // if a device had to go entirely, the stalest went first
  if (!out.staler) assert.ok(out.fresher || out.own);
  const untouched = m.applyBudget({ own: entry() }, 'own', { maxBytes: 320 * 1024 });
  assert.deepEqual(untouched, { own: entry() });
});

test('applyBudget measures UTF-8 bytes, not JS chars, and drops groups orphaned by trimming', () => {
  // CJK/emoji titles: ~3-4 bytes per char but 1-2 JS chars — a char-based
  // budget would pass locally and still exceed the worker cap.
  const cjkTabs = Array.from({ length: 40 }, (_, i) =>
    aTab({ url: `https://a.example/${i}`, title: '🀄漢字'.repeat(60), groupId: i === 39 ? 'g-last' : null }));
  const devices = { own: entry({ tabs: cjkTabs, groups: [{ id: 'g-last', name: 'last' }], updatedAt: NOW }) };
  const budget = Math.floor(Buffer.byteLength(m.canonical(devices), 'utf8') / 2);
  const out = m.applyBudget(devices, 'own', { maxBytes: budget });
  assert.ok(Buffer.byteLength(m.canonical(out), 'utf8') <= budget);
  // the trailing tab (the only g-last member) was trimmed → its group goes too
  assert.ok(!out.own.tabs.some((t) => t.groupId === 'g-last'));
  assert.deepEqual(out.own.groups, []);
});

test('exportDevices regression: two unchanged exports stay equal even when the budget trims', () => {
  // The store keeps the FULL entry; only the upload copy is trimmed. If the
  // trimmed copy were persisted, the next live snapshot would differ from
  // the stored entry, bump updatedAt, and PUT on every refresh.
  const bigTabs = Array.from({ length: 100 }, (_, i) => aTab({ url: `https://a.example/${'p'.repeat(500)}/${i}` }));
  const snapshot = { tabs: bigTabs, groups: [] };
  const args = { deviceId: 'me', syncTabs: true, snapshot, name: 'MacBook Air', platform: 'darwin', maxBytes: 30 * 1024 };
  const first = m.exportDevices({ devices: {}, ...args, now: NOW });
  assert.equal(first.store.me.tabs.length, 100, 'store keeps the full entry');
  assert.ok(first.upload.me.tabs.length < 100, 'upload is trimmed');
  const second = m.exportDevices({ devices: first.store, ...args, now: NOW + HOUR });
  assert.equal(second.store.me.updatedAt, NOW, 'unchanged content keeps its clock');
  assert.deepEqual(second.store, first.store);
  assert.ok(m.devicesEqual(second.upload, first.upload), 'skip-PUT sees a true no-op');
});

test('displayDevices: excludes own, retracted, empty, stale; newest first; keyed by deviceId', () => {
  const devices = {
    me: entry(),
    b: entry({ name: 'B', updatedAt: NOW - 2 * HOUR }),
    c: entry({ name: 'C', updatedAt: NOW - HOUR }),
    gone: { retracted: true, updatedAt: NOW },
    empty: entry({ tabs: [], updatedAt: NOW }),
  };
  const out = m.displayDevices(devices, 'me', { now: NOW });
  assert.deepEqual(out.map((d) => [d.deviceId, d.name]), [['c', 'C'], ['b', 'B']]);
  assert.ok(out[0].tabs.length && out[0].groups && Number.isFinite(out[0].updatedAt));
});
