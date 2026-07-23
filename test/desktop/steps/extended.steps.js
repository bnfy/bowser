const assert = require('node:assert');
const { Given, When, Then } = require('@cucumber/cucumber');
const ctx = require('./../support/context');

// Second batch of desktop step definitions, all drivable through pure app logic
// or observable main-process state (so they are reliable without a live GUI run):
//   F5  address normalization / search routing / OS hand-off
//   F7-2 slash-command effects (/new, /downloads, /find)
//   F17-1 supporter unlock -> app icon
//
// The F5 steps assert the app's *routing decision* (what it would navigate to /
// hand off) via the real normalizeAddressInput + handoff predicate, rather than
// performing an external navigation — external hosts don't load offline, and the
// routing heuristic is the substantive, deterministic part. Documented in the
// README as a resolution-level proxy.

const SEARCH_PREFIX = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
};

// ---------- F5: address input & search ----------

Given('the search engine is {string}', async function (engine) {
  await this.call('setSearchEngine', engine);
});

When('I enter {string} in the command bar', function (input) {
  ctx.enteredInput = input;
});

Then('the active tab navigates to {string}', async function (target) {
  const resolved = await this.call('resolveAddress', ctx.enteredInput);
  const expected = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `https://${target}`;
  assert.strictEqual(resolved, expected);
});

Then('the active tab navigates to a {string} search for {string}', async function (engine, query) {
  const resolved = await this.call('resolveAddress', ctx.enteredInput);
  assert.strictEqual(resolved, SEARCH_PREFIX[engine] + encodeURIComponent(query));
});

Then('the OS mail handler is invoked', async function () {
  assert.strictEqual(await this.call('wouldHandOff', ctx.enteredInput), true);
});

Then('no tab treats {string} as a search query', async function (uri) {
  // Hand-off is checked before normalization, so the URI never reaches search.
  assert.strictEqual(await this.call('wouldHandOff', uri), true);
});

// ---------- F7-2: slash-command effects ----------
// (The `When I run the slash command` step lives in runnable.steps.js.)

// The harness drives command effects through the main process, so opening the
// palette is the real showOverlay('palette') action, not palette-DOM automation.
When('I open the command palette', async function () { await this.call('openPalette'); });

Then('a new ungrouped tab opens on the new-tab page', async function () {
  await this.waitForState((s) => {
    const t = s.tabs.find((x) => x.id === ctx.lastNewTabId);
    return t && t.groupId == null && t.url.startsWith('blanc://newtab');
  });
});

// "the downloads page opens in the utility sheet" is bound by the generic
// `the {word} page opens in the utility sheet` step in runnable.steps.js —
// utility pages present as the sheet, never as tabs (utility-sheet design).

Then('the find bar is shown', async function () {
  assert.strictEqual(await this.call('overlayMode'), 'find');
});

// ---------- F17-1: supporter unlock ----------

Given('an active supporter unlock', async function () { await this.call('setSupporterActive'); });
When('I choose the app icon {string}', async function (id) { await this.call('setAppIcon', id); });
Then('the app icon {string} is applied', async function (id) {
  assert.strictEqual(await this.call('appIcon'), id);
});
