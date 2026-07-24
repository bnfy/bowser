const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PNG_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVR42mNgGAWjYBSMglEwCkbBqAABBgAE/wABeV0FzgAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_DATA.split(',')[1], 'base64');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-tabicons-'));
const requests = [];
let decodeCount = 0;

const image = {
  isEmpty: () => false,
  resize: () => image,
  toPNG: () => PNG_BYTES,
};
const electronId = require.resolve('electron');
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: {
    app: { getPath: () => tmp, on: () => {} },
    nativeImage: {
      createFromBuffer: () => {
        decodeCount += 1;
        return image;
      },
      createFromDataURL: () => image,
    },
  },
};

const tabicons = require('../../src/main/tabicons');
const ctx = {
  accountId: 'account-a',
  deviceId: 'device-a',
  syncTabs: true,
};

function response(contentType, bytes = PNG_BYTES) {
  return {
    ok: true,
    headers: {
      get: (name) => name === 'content-type' ? contentType : null,
    },
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

test('capture rasterizes on the source device without cookies or a referrer', async () => {
  const session = {
    fetch: async (url, options) => {
      requests.push({ url, options });
      return response('image/png');
    },
  };
  const tab = {
    url: 'https://page.example/',
    favicon: 'https://cdn.example/icon.png',
    private: false,
    view: { webContents: { session } },
  };
  tabicons.setSnapshotProvider(() => ({ tabList: [tab] }));

  assert.equal(await tabicons.captureTab(tab, ctx), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
  assert.equal(requests[0].options.redirect, 'error');

  const payload = tabicons.exportForSync(ctx);
  assert.deepEqual(payload.devices['device-a'].icons, [{
    url: 'https://page.example/',
    data: PNG_DATA,
  }]);
});

test('capture rejects non-image responses before decoding or serializing them', async () => {
  const before = decodeCount;
  const tab = {
    url: 'https://other.example/',
    favicon: 'https://other.example/not-an-image',
    private: false,
    view: {
      webContents: {
        session: { fetch: async () => response('text/html; charset=utf-8') },
      },
    },
  };

  assert.equal(await tabicons.captureTab(tab, ctx), false);
  assert.equal(decodeCount, before);
  const payload = tabicons.exportForSync(ctx);
  assert.equal(payload.devices['device-a'].icons.some((icon) => icon.url === tab.url), false);
});

test('capture validates PNG format and dimensions before nativeImage decode, including data URLs', async () => {
  const before = decodeCount;
  const huge = Buffer.from(PNG_BYTES);
  huge.writeUInt32BE(1025, 16);
  const cases = [
    {
      favicon: 'https://unsafe.example/vector.svg',
      fetch: async () => response('image/svg+xml', Buffer.from('<svg/>')),
    },
    {
      favicon: 'https://unsafe.example/spoofed.png',
      fetch: async () => response('image/png', Buffer.from('<svg/>')),
    },
    {
      favicon: `data:image/png;base64,${huge.toString('base64')}`,
      fetch: null,
    },
    {
      favicon: 'data:image/svg+xml;base64,PHN2Zy8+',
      fetch: null,
    },
  ];
  for (const [index, item] of cases.entries()) {
    const tab = {
      url: `https://unsafe-page-${index}.example/`,
      favicon: item.favicon,
      private: false,
      view: item.fetch ? { webContents: { session: { fetch: item.fetch } } } : null,
    };
    tabicons.setSnapshotProvider(() => ({ tabList: [tab] }));
    assert.equal(await tabicons.captureTab(tab, ctx), false, item.favicon);
  }
  assert.equal(decodeCount, before);
});

test('capture never fetches obvious localhost, LAN, or link-local sources', async () => {
  let fetched = false;
  const session = {
    fetch: async () => {
      fetched = true;
      return response('image/png');
    },
  };
  for (const [index, favicon] of [
    'http://localhost/icon.png',
    'http://printer.local/icon.png',
    'http://127.0.0.1/icon.png',
    'http://169.254.169.254/icon.png',
    'http://192.168.1.1/icon.png',
    'http://[::1]/icon.png',
    'http://[fd00::1]/icon.png',
  ].entries()) {
    const tab = {
      url: `https://public-${index}.example/`,
      favicon,
      private: false,
      view: { webContents: { session } },
    };
    assert.equal(await tabicons.captureTab(tab, ctx), false, favicon);
  }
  assert.equal(fetched, false);
});

test('live captures share a globally bounded scheduler and queue', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let active = 0;
  let maxActive = 0;
  let started = 0;
  const session = {
    fetch: async () => {
      started += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return response('image/png');
    },
  };
  const tabs = Array.from({ length: 72 }, (_, index) => ({
    url: `https://queue-page-${index}.example/`,
    favicon: `https://queue-icons.example/${index}.png`,
    private: false,
    view: { webContents: { session } },
  }));
  tabicons.setSnapshotProvider(() => ({ tabList: tabs }));

  const captures = tabs.map((tab) => tabicons.captureTab(tab, ctx));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 4, 'only the global concurrency cap starts');
  assert.equal(maxActive, 4);
  release();
  const results = await Promise.all(captures);
  assert.equal(maxActive, 4);
  assert.equal(results.filter(Boolean).length, 64, 'work beyond the hard pending cap is dropped');
});

test('cancelling a capture generation aborts active work and never starts queued requests', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = [];
  const signals = [];
  const session = {
    fetch: async (url, options) => {
      started.push(url);
      signals.push(options.signal);
      await gate;
      return response('image/png');
    },
  };
  const tabs = Array.from({ length: 8 }, (_, index) => ({
    url: `https://cancel-page-${index}.example/`,
    favicon: `https://cancel-icons.example/${index}.png`,
    private: false,
    view: { webContents: { session } },
  }));
  tabicons.setSnapshotProvider(() => ({ tabList: tabs }));
  let current = true;

  const captures = tabs.map((tab) =>
    tabicons.captureTab(tab, ctx, { isCurrent: () => current })
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 4);

  current = false;
  tabicons.cancelCaptures();
  assert.ok(signals.every((signal) => signal.aborted), 'active fetch signals are aborted');
  release();

  assert.deepEqual(await Promise.all(captures), Array(8).fill(false));
  assert.equal(started.length, 4, 'queued work was resolved without issuing a request');
});

test('more than 64 favicon changes retain the final source instead of filling the queue with stale work', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = [];
  const blockerSession = {
    fetch: async (url) => {
      started.push(url);
      await gate;
      return response('image/png');
    },
  };
  const finalSession = {
    fetch: async (url) => {
      started.push(url);
      return response('image/png');
    },
  };
  const blockers = Array.from({ length: 4 }, (_, index) => ({
    url: `https://latest-blocker-${index}.example/`,
    favicon: `https://latest-blocker-icons.example/${index}.png`,
    private: false,
    view: { webContents: { session: blockerSession } },
  }));
  const changing = {
    url: 'https://latest-changing.example/',
    favicon: '',
    private: false,
    view: { webContents: { session: finalSession } },
  };
  tabicons.setSnapshotProvider(() => ({ tabList: [...blockers, changing] }));

  const blockerCaptures = blockers.map((tab) => tabicons.captureTab(tab, ctx));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 4);

  const changingCaptures = [];
  for (let index = 0; index < 70; index += 1) {
    changing.favicon = `https://latest-changing-icons.example/${index}.png`;
    changingCaptures.push(tabicons.captureTab(changing, ctx));
  }
  const finalSource = changing.favicon;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 4, 'changing sources remain queued behind the active cap');

  release();
  await Promise.all(blockerCaptures);
  const changingResults = await Promise.all(changingCaptures);

  assert.ok(started.includes(finalSource), 'the final source was eventually fetched');
  assert.equal(
    started.filter((url) => url.startsWith('https://latest-changing-icons.example/')).length,
    1,
    'superseded queued sources never started'
  );
  assert.equal(changingResults.at(-1), true);
  assert.ok(
    tabicons.exportForSync(ctx).devices['device-a'].icons.some(({ url }) => url === changing.url),
    'the final source produced the stored icon'
  );
});

test('replacing an active source at the exact pending cap preserves the replacement slot', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = [];
  const session = {
    fetch: async (url) => {
      started.push(url);
      await gate;
      return response('image/png');
    },
  };
  const activeChanging = {
    url: 'https://cap-replacement.example/',
    favicon: 'https://cap-replacement-icons.example/old.png',
    private: false,
    view: { webContents: { session } },
  };
  const otherTabs = Array.from({ length: 63 }, (_, index) => ({
    url: `https://cap-load-${index}.example/`,
    favicon: `https://cap-load-icons.example/${index}.png`,
    private: false,
    view: { webContents: { session } },
  }));
  const tabs = [activeChanging, ...otherTabs];
  tabicons.setSnapshotProvider(() => ({ tabList: tabs }));

  const captures = tabs.map((tab) => tabicons.captureTab(tab, ctx));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 4, 'four jobs are active and sixty are queued');

  activeChanging.favicon = 'https://cap-replacement-icons.example/current.png';
  const replacement = tabicons.captureTab(activeChanging, ctx);
  release();

  await Promise.all(captures);
  assert.equal(await replacement, true);
  assert.ok(
    started.includes(activeChanging.favicon),
    'the replacement starts after its superseded active request is aborted'
  );
  assert.ok(
    tabicons.exportForSync(ctx).devices['device-a'].icons.some(({ url }) => url === activeChanging.url),
    'the replacement is retained in the synchronized icon set'
  );
});

test('same-tab pushState churn replaces one pending consumer instead of retaining every URL', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = [];
  const session = {
    fetch: async (url) => {
      started.push(url);
      await gate;
      return response('image/png');
    },
  };
  const changing = {
    id: 'pushstate-tab',
    url: 'https://pushstate.example/0',
    favicon: 'https://pushstate.example/icon.png',
    private: false,
    view: { webContents: { session } },
  };
  const probe = {
    id: 'pushstate-probe',
    url: 'https://pushstate-probe.example/',
    favicon: 'https://pushstate-probe.example/icon.png',
    private: false,
    view: { webContents: { session } },
  };
  tabicons.setSnapshotProvider(() => ({ tabList: [changing, probe] }));

  let predicateChecks = 0;
  const captures = [];
  for (let index = 0; index < 200; index += 1) {
    changing.url = `https://pushstate.example/${index}`;
    captures.push(tabicons.captureTab(changing, ctx, {
      isCurrent: () => {
        predicateChecks += 1;
        return true;
      },
    }));
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 1, 'the shared source is fetched once');

  predicateChecks = 0;
  const probeCapture = tabicons.captureTab(probe, ctx);
  assert.equal(
    predicateChecks,
    1,
    'capacity accounting evaluates only the latest predicate for the changing tab'
  );

  release();
  const results = await Promise.all(captures);
  await probeCapture;
  assert.equal(results.filter(Boolean).length, 1, 'only the final navigated URL stores the icon');
});

test('a superseded live favicon fetch cannot overwrite the newer source', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tab = {
    url: 'https://changing-icon.example/',
    favicon: 'https://changing-icon.example/old.png',
    private: false,
    view: {
      webContents: {
        session: {
          fetch: async () => {
            await gate;
            return response('image/png');
          },
        },
      },
    },
  };
  tabicons.setSnapshotProvider(() => ({ tabList: [tab] }));

  const pending = tabicons.captureTab(tab, ctx);
  await new Promise((resolve) => setImmediate(resolve));
  tab.favicon = 'https://changing-icon.example/new.png';
  release();

  assert.equal(await pending, false);
  const payload = tabicons.exportForSync(ctx);
  assert.equal(
    payload.devices['device-a'].icons.some(({ url }) => url === tab.url),
    false
  );
});

test('local icon cache purges closed tabs and re-captures them if they become live again', async () => {
  const session = { fetch: async () => response('image/png') };
  const first = {
    url: 'https://purge-first.example/',
    favicon: 'https://purge-icons.example/first.png',
    private: false,
    view: { webContents: { session } },
  };
  const second = {
    url: 'https://purge-second.example/',
    favicon: 'https://purge-icons.example/second.png',
    private: false,
    view: { webContents: { session } },
  };
  let tabs = [first];
  tabicons.setSnapshotProvider(() => ({ tabList: tabs }));
  assert.equal(await tabicons.captureTab(first, ctx), true);
  tabs = [second];
  assert.equal(await tabicons.captureTab(second, ctx), true);
  tabs = [first, second];
  assert.equal(
    await tabicons.captureTab(first, ctx),
    true,
    'the first entry was purged rather than retained after its tab closed'
  );
});

test('local icon working set has a hard MAX_ICONS bound', async () => {
  const tabs = Array.from({ length: 501 }, (_, index) => ({
    url: `https://bounded-${index}.example/`,
    favicon: PNG_DATA,
    private: false,
    view: null,
  }));
  tabicons.setSnapshotProvider(() => ({ tabList: tabs }));
  await Promise.all(tabs.map((tab) => tabicons.captureTab(tab, ctx)));

  const icons = tabicons.exportForSync(ctx).devices['device-a'].icons;
  assert.equal(icons.length, 500);
  assert.equal(icons.some(({ url }) => url === tabs[0].url), false, 'oldest working entry is evicted');
  assert.equal(icons.some(({ url }) => url === tabs.at(-1).url), true);
});
