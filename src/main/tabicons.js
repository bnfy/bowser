// Optional E2EE tab-icon sidecar. The primary `session` sync schema stays
// unchanged for mixed-version compatibility; this module rasterizes favicon
// resources on the device that already has the page open and synchronizes
// only small PNG data URLs. Receiving chrome never contacts remote sites just
// to render another device's tab list.

const { nativeImage } = require('electron');
const { JsonStore } = require('./store');
const { validFavicon } = require('./bookmark-validate');
const model = require('./tabicons-model');

const FETCH_TIMEOUT_MS = 3000;
const MAX_SOURCE_CACHE = 256;
const MAX_REFRESH_ICONS = 256;
const CAPTURE_CONCURRENCY = 4;
const MAX_PENDING_CAPTURES = 64;

let store = null;
const ensureStore = () => (store ??= new JsonStore('tab-icons', { accountId: '', devices: {} }));

let snapshotProvider = null; // () => ({ tabList })
let localContextKey = '';
const localIcons = new Map(); // page URL -> PNG data URL
// Favicon source URL -> { promise, settled }. Pending entries are never
// evicted: eviction would let duplicate live events start unbounded work.
const sourceCache = new Map();
const captureQueue = [];
// Stable tab identity -> pending cache entry. A tab can rotate its URL or
// favicon repeatedly while earlier work is pending; replacing this link keeps
// one consumer/predicate and one queue slot for that tab's latest state.
const pendingByTab = new Map();
const activeEntries = new Set();
let activeCaptures = 0;
let captureGeneration = 0;

const changeListeners = new Set();
const remoteListeners = new Set();
const onChanged = (fn) => changeListeners.add(fn);
const onRemoteChanged = (fn) => remoteListeners.add(fn);

function setSnapshotProvider(fn) {
  snapshotProvider = fn;
}

function bindContext(ctx) {
  const s = ensureStore();
  const bound = model.rebindDevices(s.data, ctx.accountId);
  if (bound !== s.data) {
    s.update((data) => {
      data.accountId = bound.accountId;
      data.devices = bound.devices;
    });
  }
  const key = `${ctx.accountId}:${ctx.deviceId}`;
  if (key !== localContextKey) {
    localContextKey = key;
    localIcons.clear();
    const own = s.data.devices[ctx.deviceId];
    if (own && !own.retracted) {
      for (const icon of own.icons ?? []) {
        const clean = model.sanitizeIcon(icon);
        if (clean) localIcons.set(clean.url, clean.data);
      }
    }
  }
  return s;
}

function currentSnapshot(ctx) {
  bindContext(ctx);
  const tabs = snapshotProvider?.().tabList ?? [];
  pruneLocalIcons(tabs);
  const seen = new Set();
  const icons = [];
  for (const tab of tabs) {
    if (
      !tab || tab.private ||
      typeof tab.url !== 'string' ||
      !/^https?:\/\//.test(tab.url) ||
      tab.url.length > model.MAX_URL ||
      seen.has(tab.url)
    ) continue;
    seen.add(tab.url);
    const data = model.validIconData(localIcons.get(tab.url));
    if (data) icons.push({ url: tab.url, data });
    if (icons.length >= model.MAX_ICONS) break;
  }
  return { icons };
}

async function readBounded(response) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > model.MAX_SOURCE_BYTES) return null;
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength <= model.MAX_SOURCE_BYTES ? bytes : null;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > model.MAX_SOURCE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

function pngData(image) {
  if (!image || image.isEmpty()) return null;
  const resized = image.resize({ width: model.ICON_SIZE, height: model.ICON_SIZE, quality: 'best' });
  if (resized.isEmpty()) return null;
  const data = `data:image/png;base64,${resized.toPNG().toString('base64')}`;
  return model.validIconData(data);
}

async function rasterizeSource(source, browsingSession, signal) {
  try {
    if (signal?.aborted) return null;
    if (source.toLowerCase().startsWith('data:image/')) {
      const bytes = model.sourcePngFromDataUrl(source);
      if (signal?.aborted) return null;
      return bytes ? pngData(nativeImage.createFromBuffer(bytes)) : null;
    }
    if (!browsingSession?.fetch || !model.isPublicHttpSource(source)) return null;
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;
    try {
      const response = await browsingSession.fetch(source, {
        // This is a best-effort cosmetic copy, not a page request. Never send
        // cookies or a referring page while resolving it, even when the
        // favicon URL points at another origin.
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: requestSignal,
      });
      if (!response.ok || requestSignal.aborted) return null;
      const contentType = response.headers?.get?.('content-type')?.split(';', 1)[0]?.trim()?.toLowerCase();
      if (contentType !== 'image/png') return null;
      const bytes = await readBounded(response);
      if (requestSignal.aborted) return null;
      const png = model.validSourcePngBytes(bytes);
      return png ? pngData(nativeImage.createFromBuffer(png)) : null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

function predicateIsCurrent(predicate) {
  try {
    return predicate();
  } catch {
    return false;
  }
}

const entryIsNeeded = (entry) =>
  entry.generation === captureGeneration &&
  [...entry.consumers.values()].some(predicateIsCurrent);

function unlinkPendingTabs(entry) {
  for (const tabKey of entry.consumers.keys()) {
    if (pendingByTab.get(tabKey) === entry) pendingByTab.delete(tabKey);
  }
}

function settleEntry(entry, data) {
  if (entry.settled) return;
  entry.settled = true;
  entry.state = 'settled';
  entry.controller = null;
  unlinkPendingTabs(entry);
  entry.consumers.clear();
  if (!data && sourceCache.get(entry.source) === entry) {
    sourceCache.delete(entry.source);
  }
  entry.resolve(data);
}

function discardQueuedEntry(entry) {
  if (entry.settled || entry.state !== 'queued') return false;
  const index = captureQueue.findIndex((job) => job.entry === entry);
  if (index < 0) return false;
  captureQueue.splice(index, 1);
  settleEntry(entry, null);
  return true;
}

function discardIfUnused(entry) {
  if (entry.settled || entry.consumers.size > 0) return;
  if (discardQueuedEntry(entry)) return;
  if (entry.state === 'active') {
    if (sourceCache.get(entry.source) === entry) sourceCache.delete(entry.source);
    entry.controller?.abort();
  }
}

function detachPendingTab(tabKey, except = null) {
  const prior = pendingByTab.get(tabKey);
  if (!prior || prior === except) return;
  pendingByTab.delete(tabKey);
  prior.consumers.delete(tabKey);
  discardIfUnused(prior);
}

function compactCaptureQueue() {
  for (let index = captureQueue.length - 1; index >= 0; index -= 1) {
    const entry = captureQueue[index].entry;
    if (entryIsNeeded(entry)) continue;
    captureQueue.splice(index, 1);
    settleEntry(entry, null);
  }
}

function trimSourceCache() {
  const settled = [];
  for (const [source, entry] of sourceCache) {
    if (entry.settled) settled.push(source);
  }
  while (settled.length > MAX_SOURCE_CACHE) {
    sourceCache.delete(settled.shift());
  }
}

function pumpCaptureQueue() {
  while (activeCaptures < CAPTURE_CONCURRENCY && captureQueue.length > 0) {
    const job = captureQueue.shift();
    if (!entryIsNeeded(job.entry)) {
      settleEntry(job.entry, null);
      continue;
    }
    activeCaptures += 1;
    activeEntries.add(job.entry);
    job.entry.state = 'active';
    job.entry.controller = new AbortController();
    rasterizeSource(job.source, job.browsingSession, job.entry.controller.signal)
      .then((data) => {
        settleEntry(job.entry, data);
      }, () => {
        settleEntry(job.entry, null);
      })
      .finally(() => {
        activeCaptures -= 1;
        activeEntries.delete(job.entry);
        trimSourceCache();
        pumpCaptureQueue();
      });
  }
}

function cachedRaster(source, browsingSession, tabKey, isCurrent) {
  const existing = sourceCache.get(source);
  detachPendingTab(tabKey, existing);
  if (existing) {
    if (existing.settled) {
      // Refresh insertion order so completed cache eviction is approximate LRU.
      sourceCache.delete(source);
      sourceCache.set(source, existing);
    } else {
      existing.consumers.set(tabKey, isCurrent);
      pendingByTab.set(tabKey, existing);
    }
    return existing.promise;
  }
  compactCaptureQueue();
  // Aborted/superseded requests still occupy a physical concurrency slot
  // until their promise settles, but they no longer consume the logical work
  // budget. This leaves room for the current source that replaced them.
  const currentActive = [...activeEntries].filter(entryIsNeeded).length;
  if (currentActive + captureQueue.length >= MAX_PENDING_CAPTURES) {
    return Promise.resolve(null);
  }
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const entry = {
    source,
    promise,
    resolve,
    settled: false,
    state: 'queued',
    controller: null,
    generation: captureGeneration,
    consumers: new Map([[tabKey, isCurrent]]),
  };
  sourceCache.set(source, entry);
  pendingByTab.set(tabKey, entry);
  captureQueue.push({ source, browsingSession, entry });
  pumpCaptureQueue();
  return promise;
}

/** Strand every capture from the previous account/consent generation. Queued
 * work resolves without starting, and active network requests are aborted.
 * Completed pixel-only cache entries may remain reusable. */
function cancelCaptures() {
  captureGeneration += 1;
  for (const job of captureQueue.splice(0)) settleEntry(job.entry, null);
  pendingByTab.clear();
  for (const entry of sourceCache.values()) {
    if (entry.settled) continue;
    entry.consumers.clear();
    if (sourceCache.get(entry.source) === entry) sourceCache.delete(entry.source);
    entry.controller?.abort();
  }
}

function notifyChanged() {
  for (const fn of changeListeners) fn();
}

function syncablePageUrl(tab) {
  return (
    tab &&
    !tab.private &&
    typeof tab.url === 'string' &&
    /^https?:\/\//.test(tab.url) &&
    tab.url.length <= model.MAX_URL
  ) ? tab.url : null;
}

/** Keep the device-local working set aligned with actual open tabs. This
 * bounds memory independently of the serialized sidecar budget and removes
 * navigation/closed-tab residue before any subsequent publish. */
function pruneLocalIcons(tabs = snapshotProvider?.().tabList ?? []) {
  const live = new Set();
  for (const tab of tabs) {
    const url = syncablePageUrl(tab);
    if (url) live.add(url);
  }
  let changed = false;
  for (const url of localIcons.keys()) {
    if (!live.has(url)) {
      localIcons.delete(url);
      changed = true;
    }
  }
  while (localIcons.size > model.MAX_ICONS) {
    localIcons.delete(localIcons.keys().next().value);
    changed = true;
  }
  return { live, changed };
}

function setLocalIcon(url, data) {
  const existing = localIcons.get(url);
  if (existing === data) return false;
  if (existing !== undefined) localIcons.delete(url);
  while (localIcons.size >= model.MAX_ICONS) {
    localIcons.delete(localIcons.keys().next().value);
  }
  localIcons.set(url, data);
  return true;
}

async function captureTab(tab, ctx, { isCurrent = () => true } = {}) {
  if (!syncablePageUrl(tab)) return false;

  const pageUrl = tab.url;
  const source = validFavicon(tab.favicon);
  if (!source) {
    if (!isCurrent()) return false;
    bindContext(ctx);
    const pruned = pruneLocalIcons();
    const changed = localIcons.delete(pageUrl) || pruned.changed;
    if (changed) notifyChanged();
    return changed;
  }

  const captureIsCurrent = () =>
    isCurrent() &&
    tab.url === pageUrl &&
    validFavicon(tab.favicon) === source;
  // Production tabs have stable UUIDs. The object fallback keeps direct
  // module callers/tests bounded without conflating distinct tab objects that
  // happen to show the same page URL.
  const tabKey = tab.id ?? tab;
  const data = await cachedRaster(
    source,
    tab.view?.webContents?.session,
    tabKey,
    captureIsCurrent
  );
  // A later page-favicon-updated event may supersede this source while its
  // bounded fetch is still queued or running. Never let the older completion
  // overwrite the newer icon for the same page.
  if (
    !data ||
    !isCurrent() ||
    tab.url !== pageUrl ||
    validFavicon(tab.favicon) !== source
  ) return false;
  bindContext(ctx);
  const pruned = pruneLocalIcons();
  if (snapshotProvider && !pruned.live.has(pageUrl)) {
    if (pruned.changed) notifyChanged();
    return pruned.changed;
  }
  const changed = setLocalIcon(pageUrl, data) || pruned.changed;
  if (!changed) return false;
  notifyChanged();
  return true;
}

async function refreshCurrent(ctx, { isCurrent = () => true } = {}) {
  if (!isCurrent()) return false;
  bindContext(ctx);
  const allTabs = snapshotProvider?.().tabList ?? [];
  const pruned = pruneLocalIcons(allTabs);
  if (pruned.changed) notifyChanged();
  const tabs = allTabs
    .filter((tab) => tab && !tab.private && /^https?:\/\//.test(tab.url) && tab.favicon)
    // A cold enable must not fan out hundreds of duplicate favicon reads at
    // once. Live favicon events still fill later rows opportunistically.
    .slice(0, MAX_REFRESH_ICONS);
  let cursor = 0;
  let changed = pruned.changed;
  const worker = async () => {
    while (cursor < tabs.length && isCurrent()) {
      const tab = tabs[cursor++];
      changed = (await captureTab(tab, ctx, { isCurrent })) || changed;
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(CAPTURE_CONCURRENCY, tabs.length) },
    () => worker()
  ));
  return changed;
}

function exportForSync(ctx) {
  const s = bindContext(ctx);
  const { store: next, upload } = model.exportDevices({
    devices: s.data.devices,
    deviceId: ctx.deviceId,
    syncTabs: ctx.syncTabs,
    snapshot: snapshotProvider ? currentSnapshot(ctx) : null,
    now: Date.now(),
  });
  s.update((data) => { data.devices = next; });
  return { devices: upload };
}

function mergeFromSync(remote, ctx) {
  const s = bindContext(ctx);
  const before = model.canonical(s.data.devices);
  s.update((data) => {
    data.devices = model.mergeDevices(data.devices, remote?.devices, {
      now: Date.now(),
      ownId: ctx.deviceId,
    });
  });
  if (model.canonical(s.data.devices) !== before) {
    for (const fn of remoteListeners) fn();
  }
}

const equalsRemote = (exported, remote) =>
  model.devicesEqual(exported?.devices, remote?.devices);

const getRemoteIcons = (ctx) =>
  model.displayDevices(bindContext(ctx).data.devices, ctx.deviceId, { now: Date.now() });

const attachToRemoteDevices = (devices, ctx) =>
  model.attachIcons(devices, getRemoteIcons(ctx));

const heartbeatDue = (ctx) =>
  model.heartbeatDue(bindContext(ctx).data.devices[ctx.deviceId], Date.now());

function onSyncDisabled() {
  cancelCaptures();
  const s = ensureStore();
  const hadDevices = Object.keys(s.data.devices).length > 0;
  s.update((data) => {
    data.accountId = '';
    data.devices = {};
  });
  localContextKey = '';
  localIcons.clear();
  if (hadDevices) for (const fn of remoteListeners) fn();
}

module.exports = {
  setSnapshotProvider,
  onChanged,
  onRemoteChanged,
  cancelCaptures,
  captureTab,
  refreshCurrent,
  exportForSync,
  mergeFromSync,
  equalsRemote,
  getRemoteIcons,
  attachToRemoteDevices,
  heartbeatDue,
  onSyncDisabled,
};
