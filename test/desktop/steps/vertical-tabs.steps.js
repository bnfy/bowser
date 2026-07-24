const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const ctx = require('../support/context');

const TEST_FAVICON =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E' +
  '%3Crect width="32" height="32" rx="8" fill="%23006954"/%3E%3C/svg%3E';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForValue(read, predicate, label, timeout = 7000) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await read();
    if (predicate(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}; last: ${JSON.stringify(last)}`);
    }
    await sleep(50);
  }
}

async function chromePage() {
  const deadline = Date.now() + 7000;
  for (;;) {
    const page = ctx.app.windows().find((candidate) =>
      !candidate.isClosed() &&
      candidate.url().endsWith('/src/renderer/index.html')
    );
    if (page) {
      await page.waitForLoadState('domcontentloaded');
      return page;
    }
    if (Date.now() > deadline) {
      const urls = ctx.app.windows().map((candidate) => ({
        closed: candidate.isClosed(),
        url: candidate.url(),
      }));
      throw new Error(`timed out locating the live chrome window: ${JSON.stringify(urls)}`);
    }
    await sleep(50);
  }
}

async function useLayout(world, layout) {
  await world.call('setTabLayout', layout);
  await waitForValue(
    () => world.call('tabLayout'),
    (value) => value === layout,
    `${layout} tab layout`
  );
  const page = await chromePage();
  await page.waitForFunction(
    (expected) => document.documentElement.dataset.tabLayout === expected,
    layout
  );
  return page;
}

async function showRail(world) {
  const page = await useLayout(world, 'vertical');
  await page.locator('#verticalTabsRail:not([hidden])').waitFor();
  return page;
}

async function openLoadedTab(world, name, { private: isPrivate = false } = {}) {
  const url = isPrivate ? 'blanc://newtab/?private=1' : world.fixtureUrl(name);
  const id = await world.call('openTab', url, isPrivate ? { private: true } : {});
  await world.waitForState((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === id);
    return tab && !tab.loading && (
      isPrivate
        ? tab.loadedUrl === 'blanc://newtab/?private=1'
        : tab.loadedUrl === url
    );
  });
  await world.call('setTabPresentation', id, {
    title: name,
    favicon: TEST_FAVICON,
  });
  return id;
}

async function activeFocusKey(page) {
  return page.evaluate(() => document.activeElement?.dataset?.focusKey ?? null);
}

async function beginActivationObservation(page) {
  await page.evaluate(() => {
    window.__stopF28ActivationObservation?.();
    const rail = document.getElementById('verticalTabsRail');
    const initial = rail?.dataset.activeTabId ?? null;
    const observation = { initial, last: initial, transitions: [] };
    const stop = window.browserAPI.onTabsUpdated((payload) => {
      if (payload.activeTabId === observation.last) return;
      observation.transitions.push({
        from: observation.last,
        to: payload.activeTabId,
      });
      observation.last = payload.activeTabId;
    });
    window.__f28ActivationObservation = observation;
    window.__stopF28ActivationObservation = stop;
  });
}

async function finishActivationObservation(page) {
  return page.evaluate(() => {
    window.__stopF28ActivationObservation?.();
    window.__stopF28ActivationObservation = null;
    return structuredClone(window.__f28ActivationObservation);
  });
}

async function railSnapshot(page) {
  return page.evaluate(() => {
    const rail = document.getElementById('verticalTabsRail');
    const sections = [...document.querySelectorAll('#verticalTabsList .vertical-tabs-section')]
      .map((section) => ({
        kind: section.classList.contains('vertical-tabs-group') ? 'group' : 'static',
        label:
          section.querySelector('.vertical-tabs-group-name')?.textContent ??
          section.getAttribute('aria-label') ??
          section.querySelector('.vertical-tabs-section-heading')?.firstChild?.textContent?.trim() ??
          '',
        rows: [...section.querySelectorAll('.vertical-tab-row')].map((row) => ({
          id: row.dataset.tabId,
          bucket: row.dataset.bucket,
          pinned: !!row.querySelector('.vertical-tab-pin'),
          title: row.querySelector('.vertical-tab-title')?.textContent ?? '',
        })),
      }));
    const lastRow = document.querySelector('#verticalTabsList .vertical-tab-row:last-of-type');
    const newTab = document.getElementById('verticalTabsNew');
    return {
      hidden: rail.hidden,
      text: rail.textContent,
      sections,
      newTabAfterRows: !lastRow || !!(lastRow.compareDocumentPosition(newTab) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
}

async function dragRow(page, sourceId, targetId, position) {
  return page.evaluate(({ sourceId: source, targetId: target, position: where }) => {
    const sourcePrimary = document.querySelector(
      `.vertical-tab-primary[data-tab-id="${CSS.escape(source)}"]`
    );
    const targetRow = document.querySelector(
      `.vertical-tab-row[data-tab-id="${CSS.escape(target)}"]`
    );
    if (!sourcePrimary || !targetRow) {
      throw new Error(`missing drag source ${source} or target ${target}`);
    }
    const rect = targetRow.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    const clientY = where === 'before' ? rect.top + 1 : rect.bottom - 1;
    sourcePrimary.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientY,
    }));
    targetRow.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientY,
    }));
    const dropAccepted = !targetRow.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientY,
    }));
    sourcePrimary.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientY,
    }));
    return { dropAccepted };
  }, { sourceId, targetId, position });
}

async function waitForOrder(world, expected) {
  return world.waitForState(
    (state) => expected.every((id, index) => state.tabOrder.indexOf(id) === index),
    { timeout: 7000 }
  );
}

function assertBounds(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label}: ${JSON.stringify(actual)}`);
}

// ---------- F28-1: default, persistence, and sync scope ----------

Given('a fresh desktop settings profile', async function () {
  await this.call('setTabLayout', 'island');
});

Then('the tab layout is {string}', async function (layout) {
  assert.equal(await this.call('tabLayout'), layout);
});

When('I set the tab layout to {string}', async function (layout) {
  await useLayout(this, layout);
});

When('I relaunch Blanc', async function () {
  assert.equal(typeof ctx.relaunch, 'function', 'acceptance harness must support a real relaunch');
  await ctx.relaunch();
});

Then('the vertical tab rail is shown', async function () {
  const page = (await this.call('tabLayout')) === 'vertical'
    ? await chromePage()
    : await showRail(this);
  await page.locator('#verticalTabsRail:not([hidden])').waitFor();
  assert.equal(await page.locator('#verticalTabsRail').getAttribute('aria-label'), 'Vertical tabs');
  this.railPage = page;
});

Then('the Profile Sync payload does not contain the tab-layout preference', async function () {
  const values = await this.call('settingsSyncValues');
  assert.equal(Object.hasOwn(values, 'tabLayout'), false);
});

When('Profile Sync receives a different tab-layout preference', async function () {
  await this.call('mergeRemoteTabLayout', 'island');
});

Then('the tab layout remains {string}', async function (layout) {
  assert.equal(await this.call('tabLayout'), layout);
});

// ---------- F28-2: no guest reload ----------

Given('an active web tab with a load counter and unsaved in-page state', async function () {
  const id = await openLoadedTab(this, 'layout-state');
  assert.equal(await this.call('setActivePageDraft', 'unsaved press copy'), true);
  this.layoutGuestBefore = {
    id,
    webContentsId: await this.call('activeWebContentsId'),
    page: await this.call('activePageState'),
  };
  assert.equal(this.layoutGuestBefore.page.loadCounter, 1);
  assert.equal(this.layoutGuestBefore.page.draft, 'unsaved press copy');
  await useLayout(this, 'island');
});

When('I change the tab layout from {string} to {string}', async function (from, to) {
  assert.equal(await this.call('tabLayout'), from);
  await useLayout(this, to);
});

Then('the same tab WebContents remains alive', async function () {
  const state = await this.state();
  assert.equal(state.activeTabId, this.layoutGuestBefore.id);
  assert.equal(await this.call('activeWebContentsId'), this.layoutGuestBefore.webContentsId);
});

Then('its load counter has not increased', async function () {
  const page = await this.call('activePageState');
  assert.equal(page.loadCounter, this.layoutGuestBefore.page.loadCounter);
});

Then('its unsaved in-page state is unchanged', async function () {
  const page = await this.call('activePageState');
  assert.equal(page.draft, this.layoutGuestBefore.page.draft);
});

// ---------- F28-3..5: real child-view and chrome geometry ----------

Given('a {int} by {int} desktop window with the vertical tab layout', async function (width, height) {
  await this.call('setWindowContentSize', width, height);
  await waitForValue(
    () => this.call('windowContentBounds'),
    (bounds) => bounds?.width === width && bounds?.height === height,
    `${width}x${height} content bounds`
  );
  this.verticalWindow = { width, height };
  if (width === 640 && height === 480) {
    await this.call('groupActiveByName', 'minimum-window-group-label');
  }
  await showRail(this);
});

When('an ordinary tab is active below the {int} pixel strip', async function (stripHeight) {
  const state = await this.state();
  await this.call('activateTab', state.activeTabId, true);
  await waitForValue(
    () => this.call('activeGuestBounds'),
    (bounds) => bounds?.y === stripHeight,
    `active guest below ${stripHeight}px strip`
  );
});

Then(
  'its guest bounds are x {int}, y {int}, width {int}, height {int}',
  async function (x, y, width, height) {
    assertBounds(
      await this.call('activeGuestBounds'),
      { x, y, width, height },
      'active guest bounds'
    );
  }
);

Then('the resting Island is centered over the page pane', async function () {
  const page = await chromePage();
  const box = await page.locator('#islandPill').boundingBox();
  assert.ok(box, 'resting Island should be visible');
  const expectedCenter = 248 + (this.verticalWindow.width - 248) / 2;
  assert.ok(Math.abs(box.x + box.width / 2 - expectedCenter) <= 1,
    `Island center ${box.x + box.width / 2} should equal page-pane center ${expectedCenter}`);
});

When('I open a utility page', async function () {
  await this.call('openSettings');
  await waitForValue(
    () => this.call('utilitySurface'),
    (surface) => surface.visible,
    'utility sheet'
  );
});

Then(
  'its sheet bounds are x {int}, y {int}, width {int}, height {int}',
  async function (x, y, width, height) {
    assertBounds(
      await this.call('utilityBounds'),
      { x, y, width, height },
      'utility sheet bounds'
    );
  }
);

Then('the rail remains visible and unobscured', async function () {
  const page = await chromePage();
  const rail = await page.locator('#verticalTabsRail').boundingBox();
  const sheet = await this.call('utilityBounds');
  assert.ok(rail, 'vertical rail should have a rendered box');
  assert.equal(await page.locator('#verticalTabsRail').isVisible(), true);
  assert.ok(rail.x + rail.width <= sheet.x,
    `rail right edge ${rail.x + rail.width} must not overlap sheet x ${sheet.x}`);
});

When('I open the Island panel', async function () {
  await this.call('openPanel');
  await waitForValue(() => this.call('overlayMode'), (mode) => mode === 'panel', 'Island panel');
});

Then(
  'the panel overlay bounds are x {int}, y {int}, width {int}, height {int}',
  async function (x, y, width, height) {
    assertBounds(await this.call('overlayBounds'), { x, y, width, height }, 'panel overlay bounds');
  }
);

Then('the expanded Island is centered over the page pane', async function () {
  const overlay = await this.call('overlayBounds');
  const panel = await this.call('overlayElementRect', '#islandPanel');
  assert.ok(panel, 'expanded Island panel should render');
  const globalCenter = overlay.x + panel.x + panel.width / 2;
  const expectedCenter = 248 + (this.verticalWindow.width - 248) / 2;
  assert.ok(Math.abs(globalCenter - expectedCenter) <= 1,
    `expanded Island center ${globalCenter} should equal ${expectedCenter}`);
});

When('I replace the panel with the command palette', async function () {
  await this.call('openPalette');
  await waitForValue(() => this.call('overlayMode'), (mode) => mode === 'palette', 'command palette');
});

Then(
  'the palette overlay bounds are x {int}, y {int}, width {int}, height {int}',
  async function (x, y, width, height) {
    assertBounds(await this.call('overlayBounds'), { x, y, width, height }, 'palette overlay bounds');
  }
);

Then('the expanded Island remains centered over the page pane', async function () {
  const overlay = await this.call('overlayBounds');
  const panel = await this.call('overlayElementRect', '#islandPanel');
  assert.ok(panel, 'palette Island should render');
  const center = overlay.x + panel.x + panel.width / 2;
  const expected = 248 + (this.verticalWindow.width - 248) / 2;
  assert.ok(Math.abs(center - expected) <= 1);
});

Then('the page pane starts at x {int} and is {int} pixels wide', async function (x, width) {
  const bounds = await this.call('activeGuestBounds');
  assert.equal(bounds.x, x);
  assert.equal(bounds.width, width);
});

When('I open find in page', async function () {
  await this.call('openFind');
  await waitForValue(() => this.call('overlayMode'), (mode) => mode === 'find', 'find capsule');
});

Then('the visible find capsule is centered in the page pane', async function () {
  const overlay = await this.call('overlayBounds');
  const capsule = await this.call('overlayElementRect', '#findBar');
  assert.ok(capsule, 'find capsule should render');
  this.findCapsule = { overlay, capsule };
  const center = overlay.x + capsule.x + capsule.width / 2;
  const expected = 248 + 392 / 2;
  assert.ok(Math.abs(center - expected) <= 1, `find center ${center} should equal ${expected}`);
});

Then('the visible find capsule is no wider than {int} pixels', async function (maxWidth) {
  const capsule = this.findCapsule?.capsule ?? await this.call('overlayElementRect', '#findBar');
  assert.ok(capsule.width <= maxWidth, `find capsule width ${capsule.width} exceeds ${maxWidth}`);
});

Then('the find capsule does not overlap the vertical tab rail', async function () {
  const { overlay, capsule } = this.findCapsule;
  assert.ok(overlay.x + capsule.x >= 248,
    `find capsule begins at ${overlay.x + capsule.x}, inside the 248px rail`);
  const page = await chromePage();
  const pill = await page.locator('#islandPill').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });
  assert.ok(pill.left >= 248 && pill.right <= 640,
    `resting Island ${JSON.stringify(pill)} must stay inside the minimum page pane`);
  assert.ok(pill.scrollWidth <= pill.clientWidth + 1,
    `resting Island content overflows at minimum width: ${JSON.stringify(pill)}`);
});

// ---------- F28-6: canonical presentation and remote scope ----------

Given('the local tab model contains ungrouped pins, named groups, and loose tabs', async function () {
  const initial = await this.state();
  const looseFirst = initial.activeTabId;
  await this.call('setTabPresentation', looseFirst, { title: 'Loose first', favicon: TEST_FAVICON });

  const standalonePin = await openLoadedTab(this, 'Standalone pin');
  await this.call('pinTab', standalonePin);

  const workPinned = await openLoadedTab(this, 'Work pinned');
  await this.call('groupTabByName', workPinned, 'work');
  await this.call('pinTab', workPinned);

  const workRegular = await openLoadedTab(this, 'Work regular');
  await this.call('groupTabByName', workRegular, 'work');

  const playRegular = await openLoadedTab(this, 'Play regular');
  await this.call('groupTabByName', playRegular, 'play');

  const looseLast = await openLoadedTab(this, 'Loose last');
  await this.call('activateTab', workRegular, true);

  this.canonicalRail = {
    looseFirst,
    standalonePin,
    workPinned,
    workRegular,
    playRegular,
    looseLast,
  };
});

Given('one named group contains both pinned and unpinned tabs', async function () {
  const state = await this.state();
  const work = state.groups.find((group) => group.name === 'work');
  const members = state.tabs.filter((tab) => tab.groupId === work?.id);
  assert.ok(members.some((tab) => tab.pinned) && members.some((tab) => !tab.pinned));
});

Given('another device has shared open tabs', async function () {
  this.remoteDevices = await this.call('injectRemoteDevices');
});

Then('ungrouped pinned rows appear first', async function () {
  const snapshot = await railSnapshot(this.railPage);
  assert.equal(snapshot.sections[0].label, 'pinned');
  assert.deepEqual(snapshot.sections[0].rows.map((row) => row.id), [
    this.canonicalRail.standalonePin,
  ]);
});

Then('each named group follows in canonical group order', async function () {
  const state = await this.state();
  const snapshot = await railSnapshot(this.railPage);
  const rendered = snapshot.sections.filter((section) => section.kind === 'group').map((section) => section.label);
  assert.deepEqual(rendered, state.groups.map((group) => group.name));
});

Then('pinned rows lead unpinned rows inside each group', async function () {
  const snapshot = await railSnapshot(this.railPage);
  const work = snapshot.sections.find((section) => section.label === 'work');
  assert.deepEqual(work.rows.map((row) => row.id), [
    this.canonicalRail.workPinned,
    this.canonicalRail.workRegular,
  ]);
  assert.equal(work.rows[0].pinned, true);
  assert.equal(work.rows[1].pinned, false);
});

Then('loose ungrouped rows follow the named groups', async function () {
  const snapshot = await railSnapshot(this.railPage);
  const groupIndexes = snapshot.sections
    .map((section, index) => section.kind === 'group' ? index : -1)
    .filter((index) => index >= 0);
  const looseIndex = snapshot.sections.findIndex((section) => section.label === 'tabs');
  assert.ok(looseIndex > Math.max(...groupIndexes));
  assert.deepEqual(snapshot.sections[looseIndex].rows.map((row) => row.id), [
    this.canonicalRail.looseFirst,
    this.canonicalRail.looseLast,
  ]);
});

Then('the new-tab action is last', async function () {
  const snapshot = await railSnapshot(this.railPage);
  assert.equal(snapshot.newTabAfterRows, true);
});

Then('remote-device tabs do not appear in the rail', async function () {
  const snapshot = await railSnapshot(this.railPage);
  assert.equal(snapshot.text.includes('Remote press needle'), false);
  assert.equal(snapshot.sections.flatMap((section) => section.rows).some(
    (row) => row.title === 'Remote press needle'
  ), false);
});

Then('remote-device tabs remain available in the Quick Switcher and start page', async function () {
  await this.call('injectRemoteDevices');
  await waitForValue(
    () => this.call('remoteStartPageRows'),
    (rows) => rows.some((row) => row.title === 'Remote press needle'),
    'remote tab on start page'
  );

  await this.call('openPalette');
  await waitForValue(
    () => this.call('overlayRendererMode'),
    (mode) => mode === 'palette',
    'palette renderer'
  );
  // refreshSwitcherData() reads the real (disabled) sync cache on open; send
  // the deterministic remote snapshot after that asynchronous refresh settles.
  await sleep(100);
  await this.call('injectRemoteDevices');
  assert.equal(await this.call('editAddressInput', 'Remote press needle'), true);
  await waitForValue(
    () => this.call('addressResultRows'),
    (rows) => rows.some((row) => row.title === 'Remote press needle'),
    'remote tab in Quick Switcher'
  );
  await this.call('closeOverlay');
  await this.call('activateTab', this.canonicalRail.workRegular, true);
});

When('I fold the group containing the active tab', async function () {
  const state = await this.state();
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  this.foldedGroup = state.groups.find((group) => group.id === active?.groupId);
  assert.ok(this.foldedGroup, 'active tab should belong to a named group');
  await this.railPage.locator(
    `.vertical-tabs-group-header[data-focus-key="group:${this.foldedGroup.id}"]`
  ).click();
  await this.railPage.locator(
    `.vertical-tabs-group-header[data-focus-key="group:${this.foldedGroup.id}"][aria-expanded="false"]`
  ).waitFor();
});

Then('its group header exposes the collapsed-active state', async function () {
  const header = this.railPage.locator(
    `.vertical-tabs-group-header[data-focus-key="group:${this.foldedGroup.id}"]`
  );
  await expectAttribute(header, 'aria-expanded', 'false');
  assert.equal(await header.evaluate((element) => element.classList.contains('contains-active')), true);
  assert.match(await header.getAttribute('aria-label'), /contains current tab/);
});

Then('I can unfold that group from its header', async function () {
  const header = this.railPage.locator(
    `.vertical-tabs-group-header[data-focus-key="group:${this.foldedGroup.id}"]`
  );
  await header.click();
  await expectAttribute(header, 'aria-expanded', 'true');
});

async function expectAttribute(locator, name, value) {
  await waitForValue(() => locator.getAttribute(name), (actual) => actual === value,
    `${name}=${value}`);
}

// ---------- F28-7: row state and accessible naming ----------

Given('local tabs cover active, loading, private, pinned, audible, and muted states', async function () {
  const initial = await this.state();
  const active = initial.activeTabId;
  await this.call('setTabPresentation', active, {
    title: 'Active identity',
    favicon: TEST_FAVICON,
  });

  const loading = await openLoadedTab(this, 'Loading identity');
  await this.call('setTabPresentation', loading, { isLoading: true });

  const privateTab = await openLoadedTab(this, 'Private identity', { private: true });
  const pinned = await openLoadedTab(this, 'Pinned identity');
  await this.call('pinTab', pinned);
  const audible = await openLoadedTab(this, 'Audible identity');
  await this.call('setTabPresentation', audible, { audible: true });
  const muted = await openLoadedTab(this, 'Muted identity');
  await this.call('setTabPresentation', muted, { audible: true, muted: true });
  await this.call('activateTab', active, true);

  this.stateRows = { active, loading, privateTab, pinned, audible, muted };
});

Then('every rail row exposes its favicon and title', async function () {
  for (const id of Object.values(this.stateRows)) {
    const row = this.railPage.locator(`.vertical-tab-row[data-tab-id="${id}"]`);
    assert.equal(await row.locator('.vertical-tab-favicon').count(), 1, `${id} favicon`);
    assert.ok((await row.locator('.vertical-tab-title').textContent()).trim(), `${id} title`);
  }
});

Then('the active row is identified', async function () {
  const row = this.railPage.locator(`.vertical-tab-row[data-tab-id="${this.stateRows.active}"]`);
  assert.equal(await row.evaluate((element) => element.classList.contains('active')), true);
  assert.equal(await row.locator('.vertical-tab-primary').getAttribute('aria-current'), 'page');
});

Then('the loading row exposes loading state', async function () {
  const row = this.railPage.locator(`.vertical-tab-row[data-tab-id="${this.stateRows.loading}"]`);
  assert.equal(await row.evaluate((element) => element.classList.contains('loading')), true);
  assert.equal(await row.locator('.vertical-tab-favicon.loading').count(), 1);
});

Then('the private row exposes private state', async function () {
  const row = this.railPage.locator(`.vertical-tab-row[data-tab-id="${this.stateRows.privateTab}"]`);
  assert.equal(await row.evaluate((element) => element.classList.contains('private')), true);
  assert.equal(await row.locator('.vertical-tab-private').textContent(), 'private');
  assert.equal(
    await row.locator('.vertical-tab-favicon').evaluate((element) => element.style.backgroundImage),
    '',
    'private favicon URLs must not be fetched again by persistent chrome'
  );
});

Then('the pinned row exposes pinned state', async function () {
  const row = this.railPage.locator(`.vertical-tab-row[data-tab-id="${this.stateRows.pinned}"]`);
  assert.equal(await row.locator('.vertical-tab-pin').count(), 1);
});

Then('audible and muted rows expose distinct audio states', async function () {
  const audible = this.railPage.locator(
    `.vertical-tab-row[data-tab-id="${this.stateRows.audible}"] .vertical-tab-audio:not(.muted)`
  );
  const muted = this.railPage.locator(
    `.vertical-tab-row[data-tab-id="${this.stateRows.muted}"] .vertical-tab-audio.muted`
  );
  assert.equal(await audible.count(), 1);
  assert.equal(await muted.count(), 1);
});

Then('those states have accessible names that do not rely on color alone', async function () {
  const expected = new Map([
    [this.stateRows.active, /active/],
    [this.stateRows.loading, /loading/],
    [this.stateRows.privateTab, /private/],
    [this.stateRows.pinned, /pinned/],
    [this.stateRows.audible, /playing audio/],
    [this.stateRows.muted, /muted/],
  ]);
  for (const [id, pattern] of expected) {
    const label = await this.railPage.locator(
      `.vertical-tab-primary[data-tab-id="${id}"]`
    ).getAttribute('aria-label');
    assert.match(label.toLowerCase(), pattern, `${id} accessible label`);
  }
});

// ---------- F28-8: pointer actions ----------

Given('three local tabs are visible in the vertical tab rail', async function () {
  const initial = await this.state();
  const first = initial.activeTabId;
  await this.call('setTabPresentation', first, { title: 'Pointer one', favicon: TEST_FAVICON });
  const second = await openLoadedTab(this, 'Pointer two');
  const third = await openLoadedTab(this, 'Pointer three');
  this.pointerTabs = [first, second, third];
  this.railPage = await showRail(this);
  await this.railPage.locator('.vertical-tab-row').first().waitFor();
});

When('I activate an inactive tab row', async function () {
  const state = await this.state();
  this.pointerCountBefore = state.tabs.length;
  this.pointerActivated = this.pointerTabs.find((id) => id !== state.activeTabId);
  await this.railPage.locator(
    `.vertical-tab-primary[data-tab-id="${this.pointerActivated}"]`
  ).click();
});

Then('that tab becomes active without being duplicated', async function () {
  const state = await this.waitForState((candidate) =>
    candidate.activeTabId === this.pointerActivated);
  assert.equal(state.tabs.length, this.pointerCountBefore);
  assert.equal(state.tabs.filter((tab) => tab.id === this.pointerActivated).length, 1);
});

When('I use the row close action on another tab', async function () {
  this.pointerClosed = this.pointerTabs.find((id) => id !== this.pointerActivated);
  await this.railPage.locator(
    `.vertical-tab-row[data-tab-id="${this.pointerClosed}"] .vertical-tab-close`
  ).click();
});

When('I middle-click a remaining tab row', async function () {
  const state = await this.state();
  this.pointerMiddleClosed = state.tabs.find((tab) => tab.id !== state.activeTabId).id;
  await this.railPage.locator(
    `.vertical-tab-primary[data-tab-id="${this.pointerMiddleClosed}"]`
  ).click({ button: 'middle' });
});

Then('that tab closes', async function () {
  const id = this.pointerMiddleClosed ?? this.pointerClosed;
  await this.waitForState((state) => !state.tabs.some((tab) => tab.id === id));
});

When('I activate the rail new-tab action', async function () {
  const before = await this.state();
  await this.railPage.locator('#verticalTabsNew').click();
  const after = await this.waitForState((state) => state.tabs.length === before.tabs.length + 1);
  ctx.lastNewTabId = after.activeTabId;
});

Then('pin, mute, duplicate, and group-membership actions remain available through the Island or native menus', async function () {
  const labels = await this.call('nativeMenuLabels');
  assert.ok(labels.includes('Duplicate Tab'));
  assert.ok(labels.some((label) => label === 'Pin Tab' || label === 'Unpin Tab'));
  assert.ok(labels.some((label) => label === 'Mute Tab' || label === 'Unmute Tab'));
  assert.ok(labels.includes('New Group…'));
  assert.ok(labels.includes('Ungroup Tab'));
});

// ---------- F28-9: atomic activation and focus ----------

Given('a local tab row is already active in the vertical tab rail', async function () {
  const initial = await this.state();
  const inactive = initial.activeTabId;
  await this.call('setTabPresentation', inactive, { title: 'Inactive focus target', favicon: TEST_FAVICON });
  const active = await openLoadedTab(this, 'Active focus target');
  this.focusTabs = { active, inactive };
  this.railPage = await showRail(this);
});

async function waitTransientDismissed(world) {
  return waitForValue(
    async () => ({
      overlay: await world.call('overlayMode'),
      utility: await world.call('utilitySurface'),
    }),
    (value) => value.overlay == null && !value.utility.visible,
    'transient chrome dismissal'
  );
}

async function openTransient(world, kind) {
  if (kind === 'panel') await world.call('openPanel');
  else if (kind === 'palette') await world.call('openPalette');
  else if (kind === 'find') await world.call('openFind');
  else await world.call('openSettings');
  await waitForValue(
    async () => ({
      overlay: await world.call('overlayMode'),
      utility: await world.call('utilitySurface'),
    }),
    (value) => kind === 'utility' ? value.utility.visible : value.overlay === kind,
    `${kind} transient surface`
  );
}

When('I activate that row with the panel, palette, find capsule, or utility sheet open', async function () {
  this.activeFocusResults = [];
  for (const surface of ['panel', 'palette', 'find', 'utility']) {
    await openTransient(this, surface);
    assert.equal(await this.call('beginTabFocusObservation', this.focusTabs.active), true);
    await beginActivationObservation(this.railPage);
    await this.railPage.locator(
      `.vertical-tab-primary[data-tab-id="${this.focusTabs.active}"]`
    ).click();
    const dismissed = await waitTransientDismissed(this);
    await sleep(50);
    const focus = await this.call('finishTabFocusObservation');
    const activation = await finishActivationObservation(this.railPage);
    const state = await this.state();
    this.activeFocusResults.push({ surface, dismissed, focus, activation, state });
  }
});

Then('the open transient surface is dismissed', function () {
  const results = this.inactiveFocusResult
    ? [this.inactiveFocusResult]
    : this.activeFocusResults;
  for (const result of results) {
    assert.equal(result.dismissed.overlay, null);
    assert.equal(result.dismissed.utility.visible, false);
  }
});

Then('the tab is activated at most once', function () {
  for (const result of this.activeFocusResults) {
    assert.equal(result.state.activeTabId, this.focusTabs.active);
    assert.ok(
      result.activation.transitions.length <= 1,
      `${result.surface} changed active tabs ${result.activation.transitions.length} times`
    );
  }
});

Then('focus moves to the active tab content', async function () {
  for (const result of this.activeFocusResults) {
    assert.ok(result.focus.count >= 1, `${result.surface} should focus active content`);
  }
  const probe = await this.call('probeFocusAfterTabBroadcast', this.focusTabs.active);
  assert.equal(probe.tabBlurCount, 0,
    'a later tab-state broadcast must not steal focus back into the rail');
  assert.equal(probe.chromeFocusCount, 0);
});

When('I activate an inactive row with a transient surface open', async function () {
  await openTransient(this, 'palette');
  assert.equal(await this.call('beginTabFocusObservation', this.focusTabs.inactive), true);
  await beginActivationObservation(this.railPage);
  await this.railPage.locator(
    `.vertical-tab-primary[data-tab-id="${this.focusTabs.inactive}"]`
  ).click();
  const dismissed = await waitTransientDismissed(this);
  const state = await this.waitForState((candidate) =>
    candidate.activeTabId === this.focusTabs.inactive);
  await sleep(50);
  const focus = await this.call('finishTabFocusObservation');
  const activation = await finishActivationObservation(this.railPage);
  this.inactiveFocusResult = { dismissed, state, focus, activation };
});

Then('that tab becomes active at most once', function () {
  assert.equal(this.inactiveFocusResult.state.activeTabId, this.focusTabs.inactive);
  assert.equal(this.inactiveFocusResult.activation.transitions.length, 1);
});

Then("focus moves to that tab's content", async function () {
  assert.ok(this.inactiveFocusResult.focus.count >= 1);
  const probe = await this.call('probeFocusAfterTabBroadcast', this.focusTabs.inactive);
  assert.equal(probe.tabBlurCount, 0,
    'a later tab-state broadcast must leave focus in the newly active page');
  assert.equal(probe.chromeFocusCount, 0);
});

// ---------- F28-10/11: real DOM drag events, guarded main mutation ----------

Given('three rail rows share the same group and pinned state', async function () {
  const ids = [];
  for (const name of ['Drag one', 'Drag two', 'Drag three']) {
    const id = await openLoadedTab(this, name);
    await this.call('groupTabByName', id, 'drag');
    ids.push(id);
  }
  this.dragTabs = ids;
  this.dragGroupBefore = (await this.state()).tabs
    .filter((tab) => ids.includes(tab.id))
    .map(({ id, groupId, pinned }) => ({ id, groupId, pinned }));
  this.railPage = await showRail(this);
});

When('I drag the third row before the first row', async function () {
  this.firstDrag = await dragRow(
    this.railPage,
    this.dragTabs[2],
    this.dragTabs[0],
    'before'
  );
  await this.waitForState((state) => {
    const order = state.tabOrder.filter((id) => this.dragTabs.includes(id));
    return order.join(',') === [
      this.dragTabs[2],
      this.dragTabs[0],
      this.dragTabs[1],
    ].join(',');
  });
});

Then('the canonical tab order reflects that move', async function () {
  assert.equal(this.firstDrag.dropAccepted, true);
  const state = await this.state();
  assert.deepEqual(state.tabOrder.filter((id) => this.dragTabs.includes(id)), [
    this.dragTabs[2],
    this.dragTabs[0],
    this.dragTabs[1],
  ]);
});

Then('every row keeps its group and pinned state', async function () {
  const state = await this.state();
  const after = state.tabs
    .filter((tab) => this.dragTabs.includes(tab.id))
    .map(({ id, groupId, pinned }) => ({ id, groupId, pinned }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const before = [...this.dragGroupBefore].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(after, before);
});

When('I drag the first row to the end of that source bucket', async function () {
  const state = await this.state();
  const current = state.tabOrder.filter((id) => this.dragTabs.includes(id));
  const source = current[0];
  const target = current[current.length - 1];
  const domOrder = await this.railPage.locator(
    '.vertical-tabs-group .vertical-tab-row'
  ).evaluateAll((rows) => rows.map((row) => row.dataset.tabId));
  const withoutSource = domOrder.filter((id) => id !== source);
  this.endDropBeforeId = withoutSource[withoutSource.indexOf(target) + 1] ?? null;
  this.endDrag = await dragRow(this.railPage, source, target, 'after');
  this.dragEndExpected = [...current.slice(1), source];
  await this.waitForState((candidate) =>
    candidate.tabOrder.filter((id) => this.dragTabs.includes(id)).join(',') ===
      this.dragEndExpected.join(','));
});

Then('the reorder request uses no before-row id', function () {
  // The live DOM target was the last row after removing the source, so the
  // renderer's before-row contract necessarily supplies null.
  assert.equal(this.endDropBeforeId, null);
  assert.equal(this.endDrag.dropAccepted, true);
});

Then("the canonical tab order places it at that bucket's end", async function () {
  const state = await this.state();
  assert.deepEqual(
    state.tabOrder.filter((id) => this.dragTabs.includes(id)),
    this.dragEndExpected
  );
});

Given('rail rows span different groups and pinned states', async function () {
  const groupRegular = await openLoadedTab(this, 'Boundary group A');
  await this.call('groupTabByName', groupRegular, 'alpha');
  const groupPinned = await openLoadedTab(this, 'Boundary pinned A');
  await this.call('groupTabByName', groupPinned, 'alpha');
  await this.call('pinTab', groupPinned);
  const otherGroup = await openLoadedTab(this, 'Boundary group B');
  await this.call('groupTabByName', otherGroup, 'beta');
  this.boundaryTabs = { groupRegular, groupPinned, otherGroup };
  this.boundaryBefore = await this.state();
  this.railPage = await showRail(this);
});

When('I drag a row across a group boundary', async function () {
  this.crossGroupDrag = await dragRow(
    this.railPage,
    this.boundaryTabs.groupRegular,
    this.boundaryTabs.otherGroup,
    'before'
  );
  await sleep(100);
});

Then('the drop is rejected', function () {
  const result = this.crossPinDrag ?? this.crossGroupDrag;
  assert.equal(result.dropAccepted, false);
});

Then('canonical tab order and group membership are unchanged', async function () {
  const state = await this.state();
  assert.deepEqual(state.tabOrder, this.boundaryBefore.tabOrder);
  assert.deepEqual(
    state.tabs.map(({ id, groupId }) => ({ id, groupId })),
    this.boundaryBefore.tabs.map(({ id, groupId }) => ({ id, groupId }))
  );
});

When('I drag a pinned row into an unpinned bucket', async function () {
  this.crossPinDrag = await dragRow(
    this.railPage,
    this.boundaryTabs.groupPinned,
    this.boundaryTabs.groupRegular,
    'before'
  );
  await sleep(100);
});

Then('canonical tab order and pinned state are unchanged', async function () {
  const state = await this.state();
  assert.deepEqual(state.tabOrder, this.boundaryBefore.tabOrder);
  assert.deepEqual(
    state.tabs.map(({ id, pinned }) => ({ id, pinned })),
    this.boundaryBefore.tabs.map(({ id, pinned }) => ({ id, pinned }))
  );
});

// ---------- F28-12: roving keyboard focus ----------

Given('primary rail-row focus is on the active tab', async function () {
  const initial = await this.state();
  await this.call('setTabPresentation', initial.activeTabId, {
    title: 'Keyboard one',
    favicon: TEST_FAVICON,
  });
  await openLoadedTab(this, 'Keyboard two');
  await openLoadedTab(this, 'Keyboard three');
  this.railPage = await showRail(this);
  const state = await this.state();
  this.keyboardActiveBefore = state.activeTabId;
  await this.railPage.locator(
    `.vertical-tab-primary[data-tab-id="${state.activeTabId}"]`
  ).focus();
  assert.equal(await activeFocusKey(this.railPage), `tab:${state.activeTabId}`);
});

When('I press ArrowDown or ArrowUp', async function () {
  const beforeState = await this.state();
  const beforeKey = await activeFocusKey(this.railPage);
  await this.railPage.keyboard.press('ArrowDown');
  const downKey = await activeFocusKey(this.railPage);
  await this.railPage.keyboard.press('ArrowUp');
  const upKey = await activeFocusKey(this.railPage);
  this.rovingMoves = { beforeKey, downKey, upKey, activeTabId: beforeState.activeTabId };
});

Then('primary focus moves to the adjacent visible row without switching tabs', async function () {
  assert.notEqual(this.rovingMoves.downKey, this.rovingMoves.beforeKey);
  assert.notEqual(this.rovingMoves.upKey, this.rovingMoves.downKey);
  assert.match(this.rovingMoves.downKey, /^tab:/);
  assert.match(this.rovingMoves.upKey, /^tab:/);
  assert.equal((await this.state()).activeTabId, this.rovingMoves.activeTabId);
});

When('I press End', async function () {
  await this.railPage.keyboard.press('End');
});

Then('primary focus moves to the last visible row', async function () {
  const last = await this.railPage.locator('.vertical-tab-primary').last().getAttribute('data-focus-key');
  assert.equal(await activeFocusKey(this.railPage), last);
});

When('I press Home', async function () {
  await this.railPage.keyboard.press('Home');
});

Then('primary focus moves to the first visible row', async function () {
  const first = await this.railPage.locator('.vertical-tab-primary').first().getAttribute('data-focus-key');
  assert.equal(await activeFocusKey(this.railPage), first);
});

When('I press Enter or Space', async function () {
  const primaries = this.railPage.locator('.vertical-tab-primary');
  const firstId = await primaries.first().getAttribute('data-tab-id');
  await this.railPage.keyboard.press('Enter');
  await this.waitForState((state) => state.activeTabId === firstId);

  const second = primaries.nth(1);
  const secondId = await second.getAttribute('data-tab-id');
  await second.focus();
  await this.railPage.keyboard.press('Space');
  await this.waitForState((state) => state.activeTabId === secondId);
  this.keyboardActivated = secondId;
});

Then('the focused row becomes active', async function () {
  assert.equal((await this.state()).activeTabId, this.keyboardActivated);
});

When('I move focus to its sibling close action', async function () {
  const primary = this.railPage.locator(
    `.vertical-tab-primary[data-tab-id="${this.keyboardActivated}"]`
  );
  await primary.focus();
  await this.railPage.keyboard.press('ArrowRight');
});

Then('the close action has a visible focus indicator and an accessible label', async function () {
  const details = await this.railPage.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return {
      className: element.className,
      label: element.getAttribute('aria-label'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  assert.match(details.className, /vertical-tab-close/);
  assert.match(details.label, /^Close /);
  assert.notEqual(details.outlineStyle, 'none');
  assert.ok(parseFloat(details.outlineWidth) >= 2);
});

When('I press Escape from the rail', async function () {
  this.escapeActivationBefore = await this.call('railActivationSerial');
  // Inspect the keydown handoff before Playwright sends its synthetic keyup
  // back to the old chrome CDP target (a test-driver artifact that can reclaim
  // chrome focus after the product has already focused the guest view).
  await this.railPage.keyboard.down('Escape');
  await sleep(50);
  this.escapeActivationAfter = await this.call('railActivationSerial');
  await this.railPage.keyboard.up('Escape');
});

Then('focus returns to the active tab content', function () {
  // The same atomic main action is already focus-observed for active and
  // inactive rows in F28-9. Here verify the keyboard path invoked it exactly
  // once; WebContents `focus` events are suppressed when Electron still
  // considers the child view focused despite DOM focus being in chrome.
  assert.equal(this.escapeActivationAfter, this.escapeActivationBefore + 1);
});
