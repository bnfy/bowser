const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('cosmetic icon churn never postpones the primary session timer', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-sync-timers-'));
  fs.writeFileSync(path.join(tmp, 'sync.json'), JSON.stringify({
    enabled: true,
    handle: 'timer-test',
    accountId: 'a'.repeat(64),
    key: Buffer.alloc(32, 3).toString('base64'),
    lastSyncedAt: 0,
    lastError: null,
    deviceId: 'timer-device',
    syncTabs: true,
  }));

  let tabChanged;
  let iconChanged;
  const stub = (request, exports) => {
    const id = require.resolve(request);
    require.cache[id] = { id, filename: id, loaded: true, exports };
    return id;
  };
  const cached = [
    stub('electron', {
      app: { getPath: () => tmp, on: () => {}, isPackaged: false },
      net: { fetch: async () => ({ status: 404, ok: false }) },
    }),
    stub('../../src/main/settings', {
      exportForSync: () => ({}),
      mergeFromSync: () => {},
      onSettingsChanged: () => {},
    }),
    stub('../../src/main/bookmarks', {
      exportForSync: () => ({}),
      mergeFromSync: () => {},
      onChanged: () => {},
    }),
    stub('../../src/main/tabsync', {
      exportForSync: () => ({ devices: {} }),
      mergeFromSync: () => {},
      equalsRemote: () => true,
      onSyncDisabled: () => {},
      onChanged: (fn) => { tabChanged = fn; },
      heartbeatDue: () => false,
      getRemoteDevices: () => [],
    }),
    stub('../../src/main/tabicons', {
      exportForSync: () => ({ devices: {} }),
      mergeFromSync: () => {},
      equalsRemote: () => true,
      onSyncDisabled: () => {},
      onChanged: (fn) => { iconChanged = fn; },
      refreshCurrent: async () => false,
      heartbeatDue: () => false,
      attachToRemoteDevices: (devices) => devices,
      captureTab: async () => false,
    }),
  ];

  const original = {
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
  };
  let nextId = 0;
  const timers = [];
  const cleared = [];
  global.setTimeout = (fn, delay) => {
    const timer = { id: ++nextId, fn, delay };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer?.id) cleared.push(timer.id);
  };
  global.setInterval = () => ({ id: ++nextId });
  global.clearInterval = () => {};

  t.after(() => {
    Object.assign(global, original);
    for (const id of cached) delete require.cache[id];
    delete require.cache[require.resolve('../../src/main/sync')];
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const sync = require('../../src/main/sync');
  sync.init();
  assert.equal(typeof tabChanged, 'function');
  assert.equal(typeof iconChanged, 'function');

  tabChanged();
  const scheduled = timers.filter(({ delay }) => delay === 15_000);
  assert.equal(scheduled.length, 2, 'tab change schedules session and icon stores');
  const [sessionTimer, firstIconTimer] = scheduled;

  iconChanged();
  assert.ok(cleared.includes(firstIconTimer.id), 'new icon work replaces its cosmetic timer');
  assert.ok(!cleared.includes(sessionTimer.id), 'the required session deadline stays intact');
});
