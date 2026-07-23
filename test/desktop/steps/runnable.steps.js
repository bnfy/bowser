const assert = require('node:assert');
const { Given, When, Then } = require('@cucumber/cucumber');
const ctx = require('./../support/context');

// Step definitions for the desktop-runnable scenario set (see the `runnable`
// profile in cucumber.mjs). Every step is intent-level and drives the app
// through the test hook; where a WebContentsView navigation settles async, the
// assertion polls via world.waitForState(). Steps asserting "appears on the
// <page>" check the store the page renders from — a store-level proxy for the
// DOM, documented in test/desktop/README.md.

// ---------- Given (setup) ----------

async function openNamed(world, name) {
  const url = world.fixtureUrl(name);
  const id = await world.call('openTab', url);
  ctx.tabByName[name] = id;
  ctx.activeExpectedUrl = url;
  return id;
}

Given('a tab open on {string}', async function (name) { await openNamed(this, name); });
Given('the active tab is on {string}', async function (name) { await openNamed(this, name); });

Given('tabs open on {string} and {string}', async function (a, b) {
  await openNamed(this, a);
  await openNamed(this, b);
});

Given('the active tab has no group', async function () { await openNamed(this, 'plain'); });

Given('the active tab is in a group named {string}', async function (name) {
  await openNamed(this, 'anchor');
  await this.call('groupActiveByName', name);
});

Given('a group {string} with 1 tab', async function (name) {
  await openNamed(this, `${name}-1`);
  await this.call('groupActiveByName', name);
});

Given('history has at least one entry', async function () { await this.call('seedHistory'); });

Given('there is no active supporter license', async function () { await this.call('clearSupporter'); });

Given('the active tab is private', async function () {
  ctx.privateTabId = await this.call('openTab', 'blanc://newtab/?private=1', { private: true });
});

// "ad/tracker blocking is enabled" is BOTH a Background precondition and a final
// assertion (F12-3). A step is matched by text regardless of keyword, so it is
// defined once, as an assertion. reset() leaves blocking enabled, so it holds
// as a precondition too. (See the Then section.)

// ---------- When (actions) ----------

When('I close that tab', async function () {
  const names = Object.keys(ctx.tabByName);
  const id = ctx.tabByName[names[names.length - 1]];
  await this.call('closeTab', id);
});

When('I reopen the last closed tab', async function () { await this.call('reopenClosed'); });
When('I duplicate the active tab', async function () { await this.call('duplicateActive'); });
When('I pin {string}', async function (name) { await this.call('pinTab', ctx.tabByName[name]); });
When('I open a new tab', async function () { ctx.lastNewTabId = await this.call('newTab'); });
When('I close the last tab in {string}', async function (name) { await this.call('closeTabsInGroupName', name); });

When('I run the slash command {string}', async function (cmd) {
  const [head, ...rest] = String(cmd).trim().split(/\s+/);
  if (head === '/group') return this.call('groupActiveByName', rest.join(' '));
  if (head === '/clear') return this.call('clearHistory');
  if (head === '/block-ads') return this.call('toggleAdblock');
  if (head === '/new') { ctx.lastNewTabId = await this.call('newTab'); return; }
  if (head === '/downloads') return this.call('openDownloads');
  if (head === '/find') return this.call('openFind');
  return 'pending'; // other commands not in the runnable set yet
});

When('I add the active page to favorites', async function () {
  if (ctx.activeExpectedUrl) {
    await this.waitForState((s) => s.tabs.some((t) => t.id === s.activeTabId && t.url === ctx.activeExpectedUrl));
  }
  await this.call('favoriteActive');
});

When('I add all open tabs to favorites', async function () {
  const ids = Object.values(ctx.tabByName);
  await this.waitForState((s) => ids.every((id) => {
    const t = s.tabs.find((x) => x.id === id);
    return t && /^https?:/.test(t.url);
  }));
  await this.call('favoriteAllTabs');
});

When('I attempt to set the search engine to {string}', async function (x) { await this.call('setSearchEngine', x); });
When('settings contain the app icon {string}', async function (x) { await this.call('setAppIcon', x); });
When('I add {string} to the ad-block exceptions', async function (h) { await this.call('addException', h); });

When('browser chrome attempts to navigate to {string}', async function (url) {
  await this.call('attemptChromeNavigation', url);
});

// ---------- Then (assertions) ----------

Then('a tab open on {string} is present', async function (name) {
  const url = this.fixtureUrl(name);
  await this.waitForState((s) => s.tabs.some((t) => t.url === url));
});

Then('a second tab open on {string} is present', async function (name) {
  const url = this.fixtureUrl(name);
  await this.waitForState((s) => s.tabs.filter((t) => t.url === url).length >= 2);
});

Then('{string} is marked pinned', async function (name) {
  const s = await this.state();
  const t = s.tabs.find((x) => x.id === ctx.tabByName[name]);
  assert.ok(t && t.pinned === true, `${name} should be pinned`);
});

Then('{string} is shown inside the group {string}', async function (tabName, groupName) {
  const s = await this.state();
  const group = s.groups.find((g) => g.name === groupName.toLowerCase());
  const cluster = s.clusters.find((c) => c.groupId === group?.id);
  assert.ok(group && cluster?.tabIds.includes(ctx.tabByName[tabName]), `${tabName} should render inside ${groupName}`);
});

Then('{string} is ordered before {string}', async function (a, b) {
  const s = await this.state();
  const displayedOrder = s.clusters.flatMap((cluster) => cluster.tabIds);
  const ia = displayedOrder.indexOf(ctx.tabByName[a]);
  const ib = displayedOrder.indexOf(ctx.tabByName[b]);
  assert.ok(ia >= 0 && ib >= 0 && ia < ib, `${a} (${ia}) should be before ${b} (${ib})`);
});

Then('the new tab has no group', async function () {
  const s = await this.state();
  const t = s.tabs.find((x) => x.id === ctx.lastNewTabId);
  assert.ok(t && t.groupId == null, 'new tab should be ungrouped');
});

Then('the new tab is on the new-tab page', async function () {
  await this.waitForState((s) => {
    const t = s.tabs.find((x) => x.id === ctx.lastNewTabId);
    return t && t.url.startsWith('blanc://newtab');
  });
});

Then('the private tab uses a different web session from ordinary tabs', async function () {
  const s = await this.state();
  const privateTab = s.tabs.find((t) => t.id === ctx.privateTabId);
  assert.equal(privateTab?.sessionKind, 'private');
  assert.ok(
    s.tabs.some((t) => !t.private && t.sessionKind === 'default'),
    'an ordinary tab should remain on the persistent default session'
  );
});

// Regression guard for the blanc:// scheme being registered only on the
// default session: a private new tab would open blank (committed URL empty)
// while its tab-model .url still read blanc://newtab. Assert the ACTUAL
// committed WebContents URL (loadedUrl), not the model's stored url.
Then("the private tab's start page loads in the non-persistent session", async function () {
  const s = await this.waitForState((st) => {
    const t = st.tabs.find((x) => x.id === ctx.privateTabId);
    return t && t.loadedUrl === 'blanc://newtab/?private=1' && t.loading === false;
  });
  const t = s.tabs.find((x) => x.id === ctx.privateTabId);
  assert.equal(t.sessionKind, 'private', 'private tab must use the private session');
  assert.equal(t.sessionPersistent, false, 'the private session must be non-persistent');
  assert.equal(
    t.loadedUrl,
    'blanc://newtab/?private=1',
    'the committed WebContents URL must be the private start page, not a blank load'
  );
});

Then('a group named {string} exists', async function (name) {
  const s = await this.state();
  assert.ok(s.groups.some((g) => g.name === name.toLowerCase()), `group ${name} should exist`);
});

Then('the active tab is in {string}', async function (name) {
  const s = await this.state();
  const g = s.groups.find((x) => x.name === name.toLowerCase());
  const t = s.tabs.find((x) => x.id === s.activeTabId);
  assert.ok(g && t && t.groupId === g.id, `active tab should be in ${name}`);
});

Then('the group {string} no longer exists', async function (name) {
  const s = await this.state();
  assert.ok(!s.groups.some((g) => g.name === name.toLowerCase()), `group ${name} should be pruned`);
});

Then('the favorite control shows as active', async function () {
  assert.strictEqual(await this.call('activeFavorited'), true);
});

Then('{string} appears on the new-tab page', async function (name) {
  const urls = await this.call('bookmarkUrls');
  assert.ok(urls.includes(this.fixtureUrl(name)), `${name} should be a favorite`);
});

Then('{string} appears on the favorites page', async function (name) {
  const urls = await this.call('bookmarkUrls');
  assert.ok(urls.includes(this.fixtureUrl(name)), `${name} should be a favorite`);
});

Then('history is empty', async function () {
  assert.strictEqual(await this.call('historyCount'), 0);
});

// NOTE: `/` is the alternation operator in Cucumber Expressions, so the literal
// slash in "ad/tracker" must be escaped (\\/) for these to match the step text.
Then('ad\\/tracker blocking is enabled', async function () {
  assert.strictEqual(await this.call('adblockEnabled'), true);
});

Then('ad\\/tracker blocking is disabled', async function () {
  assert.strictEqual(await this.call('adblockEnabled'), false);
});

Then('the search engine remains unchanged', async function () {
  assert.strictEqual(await this.call('searchEngine'), 'duckduckgo');
});

Then('the effective app icon is {string}', async function (x) {
  assert.strictEqual(await this.call('appIcon'), x);
});

Then('the ad-block exceptions contain {string}', async function (h) {
  const ex = await this.call('exceptions');
  assert.ok(ex.includes(h.toLowerCase()), `exceptions ${JSON.stringify(ex)} should contain ${h.toLowerCase()}`);
});

Then('the ad-block exceptions do not contain {string}', async function (h) {
  const ex = await this.call('exceptions');
  assert.ok(!ex.includes(h.toLowerCase()), `exceptions ${JSON.stringify(ex)} should not contain ${h.toLowerCase()}`);
});

Then('browser chrome remains on its trusted local document', async function () {
  assert.match(await this.call('chromeUrl'), /^file:\/\/.*\/src\/renderer\/index\.html$/);
});

// ---------- Utility sheet (F16-2, F16-4, F16-5) ----------

/** Poll the sheet state — fixed sleeps turn slow CI into flakes; a missing
 * state change must time out loudly. */
async function untilSurface(world, predicate, what, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const surf = await world.call('utilitySurface');
    if (predicate(surf)) return surf;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(surf)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const sheetHostFor = (name) => (name === 'favorites' ? 'bookmarks' : name);

Given('the new-tab page is open', async function () {
  await this.call('newTab'); // opens blanc://newtab as the active tab
});

Given('a favorite for {string} exists', async function (host) {
  await this.call('seedFavorite', `https://${host}/`, host);
});

Given('the favorites page is open in the utility sheet', async function () {
  await this.call('openFavoritesSheet');
  await untilSurface(this, (s) => s.visible, 'favorites sheet to open');
  this.tabStateBefore = await this.call('state');
});

When('I follow its {string} navigation link', async function (label) {
  assert.strictEqual(label, 'Favorites', 'the ledger has exactly one nav link');
  this.tabStateBefore = await this.call('state');
  await this.call('followNewtabFavoritesLink');
  await untilSurface(this, (s) => s.visible, 'sheet to open from ledger link');
});

When('I open the downloads page', async function () {
  this.tabStateBefore = await this.call('state');
  await this.call('openDownloads');
  await untilSurface(this, (s) => s.visible, 'downloads sheet to open');
});

When('I activate that favorite', async function () {
  await this.call('clickFirstSheetLink');
  await this.waitForState((s) => s.tabs.length === this.tabStateBefore.tabs.length + 1);
});

Then('the {word} page opens in the utility sheet', async function (name) {
  const surf = await untilSurface(this, (s) => s.visible, `${name} sheet`);
  assert.strictEqual(surf.url, `blanc://${sheetHostFor(name)}/`);
});

Then('the {word} page opens in the utility sheet under the blanc scheme', async function (name) {
  const surf = await untilSurface(this, (s) => s.visible, `${name} sheet`);
  assert.ok(surf.url.startsWith(`blanc://${sheetHostFor(name)}/`),
    `sheet url ${surf.url} should be blanc://${sheetHostFor(name)}/`);
});

Then('no new tab is created', async function () {
  const now = await this.call('state');
  assert.strictEqual(now.tabs.length, this.tabStateBefore.tabs.length);
});

Then('the active tab and tab order are unchanged', async function () {
  const now = await this.call('state');
  assert.strictEqual(now.activeTabId, this.tabStateBefore.activeTabId);
  assert.deepStrictEqual(now.tabOrder, this.tabStateBefore.tabOrder);
});

Then('exactly one new tab opens on {string}', async function (host) {
  const now = await this.call('state');
  assert.strictEqual(now.tabs.length, this.tabStateBefore.tabs.length + 1);
  assert.ok(now.tabs.some((t) => t.url.includes(host)),
    `a tab should be on ${host}: ${JSON.stringify(now.tabs.map((t) => t.url))}`);
});

Then('the utility sheet is dismissed', async function () {
  await untilSurface(this, (s) => !s.visible, 'sheet to dismiss');
});

// F16-6: the P1 regression class this guards — utility routing running
// BEFORE the web→blanc denial in a navigation handler — is an ordering
// bug, so the coverage must drive the real handlers from a real committed
// web document, with execution PROOF: the test-hook attack drivers resolve
// only after the hostile expression ran in the page (a scenario must never
// pass because an inline script silently failed to load).

/** Negative assertions can't poll for success — give a mis-routed summon a
 * bounded window to land before declaring the sheet stayed closed. */
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// A data: URL is an OPAQUE origin — the vector that actually reaches the
// blanc:// navigation handlers. http content cannot: Chromium blocks
// http→blanc:// upstream, so will-navigate never fires from it (verified by
// mutation — an http-origin attack can't summon the sheet even with the
// trust gate removed, so an http fixture would make this test vacuous).
const UNTRUSTED_DOC = 'data:text/html,<title>untrusted</title><body>x</body>';

Given('a tab open on untrusted web content', async function () {
  const id = await this.call('openTab', UNTRUSTED_DOC);
  ctx.tabByName.hostile = id;
  // The attack only exercises the handlers if the document actually
  // committed — gate on the tab's committed URL, not just creation.
  await this.waitForState((s) => {
    const t = s.tabs.find((x) => x.id === id);
    return t && t.loadedUrl.startsWith('data:') && !t.loading;
  });
});

When('the page navigates itself to the settings page', async function () {
  await this.call('attemptNavigateActiveTab', 'blanc://settings/');
  await settle(500);
});

When('the page window-opens the settings page', async function () {
  await this.call('attemptWindowOpenActiveTab', 'blanc://settings/');
  await settle(500);
});

Then('the utility sheet remains closed', async function () {
  const surf = await this.call('utilitySurface');
  assert.strictEqual(surf.visible, false,
    `web content summoned the sheet: ${JSON.stringify(surf)}`);
});

// F16-7: toggle must compare page identity, not URL spelling — typed
// addresses arrive without the trailing slash the menu items carry.
Given('the settings page is open in the utility sheet via a typed address', async function () {
  await this.call('openTab', 'blanc://settings'); // typed spelling, no trailing slash
  await untilSurface(this, (s) => s.visible, 'settings sheet (typed spelling)');
});

When('the settings page is invoked again by the menu', async function () {
  await this.call('openTab', 'blanc://settings/'); // canonical menu spelling
});
