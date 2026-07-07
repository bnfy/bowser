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

Then('{string} is ordered before {string}', async function (a, b) {
  const s = await this.state();
  const ia = s.tabOrder.indexOf(ctx.tabByName[a]);
  const ib = s.tabOrder.indexOf(ctx.tabByName[b]);
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
