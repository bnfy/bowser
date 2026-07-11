const assert = require('node:assert/strict');
const test = require('node:test');
const {
  COSMETIC_FILTER_CHANNEL,
  MUTATION_OBSERVER_CHANNEL,
  hostnameForWebContents,
  isWebContentsExcepted,
  installCosmeticExceptionHandlers,
} = require('../../src/main/adblock-exceptions');

function fakeWebContents(url) {
  return { getURL: () => url };
}

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    removeHandler(channel) { handlers.delete(channel); },
    handle(channel, fn) { handlers.set(channel, fn); },
  };
}

test('ad-block exceptions normalize the top-level webContents hostname', () => {
  const wc = fakeWebContents('https://www.AllRecipes.com/article');
  assert.equal(hostnameForWebContents(wc), 'allrecipes.com');
  assert.equal(isWebContentsExcepted(wc, ['allrecipes.com']), true);
  assert.equal(isWebContentsExcepted(wc, ['example.com']), false);
  assert.equal(isWebContentsExcepted(fakeWebContents('not a url'), ['allrecipes.com']), false);
});

test('cosmetic filtering is skipped for an excepted tab', async () => {
  const ipcMain = fakeIpcMain();
  const calls = [];
  const blocker = {
    onInjectCosmeticFilters(...args) { calls.push(['inject', ...args]); return 'injected'; },
    onIsMutationObserverEnabled(...args) { calls.push(['mutation', ...args]); return true; },
  };
  const excepted = fakeWebContents('https://www.allrecipes.com/article');
  installCosmeticExceptionHandlers(
    ipcMain,
    blocker,
    (wc) => isWebContentsExcepted(wc, ['allrecipes.com'])
  );

  const inject = ipcMain.handlers.get(COSMETIC_FILTER_CHANNEL);
  const mutation = ipcMain.handlers.get(MUTATION_OBSERVER_CHANNEL);
  assert.equal(await inject({ sender: excepted }, excepted.getURL(), undefined), undefined);
  assert.equal(await mutation({ sender: excepted }), false);
  assert.deepEqual(calls, []);
});

test('cosmetic filtering still delegates for a protected tab', async () => {
  const ipcMain = fakeIpcMain();
  const calls = [];
  const blocker = {
    onInjectCosmeticFilters(...args) { calls.push(['inject', ...args]); return 'injected'; },
    onIsMutationObserverEnabled(...args) { calls.push(['mutation', ...args]); return true; },
  };
  const protectedTab = fakeWebContents('https://example.com/');
  installCosmeticExceptionHandlers(
    ipcMain,
    blocker,
    (wc) => isWebContentsExcepted(wc, ['allrecipes.com'])
  );

  const event = { sender: protectedTab };
  assert.equal(
    await ipcMain.handlers.get(COSMETIC_FILTER_CHANNEL)(event, protectedTab.getURL(), { ids: ['ad'] }),
    'injected'
  );
  assert.equal(await ipcMain.handlers.get(MUTATION_OBSERVER_CHANNEL)(event), true);
  assert.equal(calls.length, 2);
});
