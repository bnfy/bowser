// Tab-sync orchestration: owns tab-sync.json (the last-merged device map,
// bound to the sync account it came from) and bridges live tab state into
// the pure logic in tabsync-model.js. sync.js drives exportForSync/
// mergeFromSync via its STORES table and passes ctx = { accountId, deviceId,
// syncTabs, deviceName, platform } from sync.json — no circular require.
// See the tab-sync design spec §4–§6.
const os = require('os');
const { JsonStore } = require('./store');
const model = require('./tabsync-model');
const { syncSnapshot } = require('./session-snapshot');

let store = null;
const ensureStore = () => (store ??= new JsonStore('tab-sync', { accountId: '', devices: {} }));

/** main.js hands us live tab state once the window exists. */
let snapshotProvider = null; // () => ({ tabList, groups })

const changeListeners = new Set();
const onChanged = (fn) => changeListeners.add(fn);
const remoteListeners = new Set();
const onRemoteChanged = (fn) => remoteListeners.add(fn);
let lastFingerprint = null;

const currentSnapshot = () => {
  const { tabList, groups } = snapshotProvider();
  return syncSnapshot(tabList, groups);
};

/** The complete publishable content — spec §6's fingerprint includes device
 * name and platform, so a hostname rename counts as a change too. */
const ownContent = () => {
  const { tabs, groups } = currentSnapshot();
  return { name: os.hostname(), platform: process.platform, tabs, groups };
};

/** Registering the provider seeds the baseline explicitly, so noteTabsChanged
 * needs no first-call special case and never misses an early real change. */
function setSnapshotProvider(fn) {
  snapshotProvider = fn;
  lastFingerprint = model.fingerprint(ownContent());
}

/** Called from broadcastTabs (~10/s while a page loads): fires listeners only
 * when the publishable snapshot actually changed — blocked-count ticks and
 * loading-flag flips schedule nothing (spec §6). */
function noteTabsChanged() {
  if (!snapshotProvider) return;
  const fp = model.fingerprint(ownContent());
  if (fp === lastFingerprint) return;
  lastFingerprint = fp;
  for (const fn of changeListeners) fn();
}

/** Cross-account leak guard (spec §4): entering under a different accountId
 * discards every cached entry before anything is exported or merged. */
function rebind(accountId) {
  const s = ensureStore();
  const bound = model.rebindDevices(s.data, accountId);
  if (bound !== s.data) s.update((d) => { d.accountId = bound.accountId; d.devices = bound.devices; });
  return s;
}

function exportForSync(ctx) {
  const s = rebind(ctx.accountId);
  // Persist the FULL merged map; upload the budget-trimmed copy. The split
  // lives in the pure, regression-tested model.exportDevices — persisting
  // the trimmed copy would PUT on every refresh (spec §7).
  const { store: next, upload } = model.exportDevices({
    devices: s.data.devices,
    deviceId: ctx.deviceId,
    syncTabs: ctx.syncTabs,
    snapshot: snapshotProvider ? currentSnapshot() : null,
    name: ctx.deviceName,
    platform: ctx.platform,
    now: Date.now(),
  });
  s.update((d) => { d.devices = next; });
  return { devices: upload };
}

function mergeFromSync(remote, ctx) {
  const s = rebind(ctx.accountId);
  const before = model.canonical(s.data.devices);
  s.update((d) => {
    d.devices = model.mergeDevices(d.devices, remote?.devices, { now: Date.now() });
  });
  // Tell the UI surfaces (overlay panel, open start pages) when a pull
  // actually changed what they'd render — they read a cache, and a
  // focus/panel-open refresh completes AFTER they first painted.
  if (model.canonical(s.data.devices) !== before) {
    for (const fn of remoteListeners) fn();
  }
}

/** Skip-PUT repair check (spec §6): true only for a genuine no-op. */
const equalsRemote = (exported, remote) => model.devicesEqual(exported?.devices, remote?.devices);

const getRemoteDevices = (ctx) =>
  model.displayDevices(ensureStore().data.devices, ctx.deviceId, { now: Date.now() });

const heartbeatDue = (ctx) =>
  model.heartbeatDue(ensureStore().data.devices[ctx.deviceId], Date.now());

/** Sync turned off entirely: the UI must stop showing other devices, and a
 * later re-enable (possibly under new credentials) starts clean. deviceId
 * lives in sync.json and survives. */
function onSyncDisabled() {
  const s = ensureStore();
  const hadDevices = Object.keys(s.data.devices).length > 0;
  s.update((d) => { d.accountId = ''; d.devices = {}; });
  if (hadDevices) for (const fn of remoteListeners) fn(); // surfaces must clear
}

module.exports = {
  setSnapshotProvider, onChanged, onRemoteChanged, noteTabsChanged,
  exportForSync, mergeFromSync, equalsRemote,
  getRemoteDevices, heartbeatDue, onSyncDisabled,
};
