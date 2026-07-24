// Vertical-tabs presentation for the trusted chrome document. Main remains
// the sole owner of tab state; renderer.js feeds each tabs:updated payload to
// the single render() entry point below.
(() => {
  'use strict';

  const api = window.browserAPI;
  const rail = document.getElementById('verticalTabsRail');
  const list = document.getElementById('verticalTabsList');
  const useIslandButton = document.getElementById('verticalTabsUseIsland');
  const newTabButton = document.getElementById('verticalTabsNew');
  const newTabShortcut = document.getElementById('verticalTabsNewShortcut');
  const announcer = document.getElementById('verticalTabsAnnouncer');
  if (!api || !rail || !list || !useIslandButton || !newTabButton) return;

  const ICONS = {
    close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5"/></svg>',
    pin: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.2 2.75 5.6 5.6M9.9 3.65l2.45 2.45-2.1 2.1.35 2.25-1.05 1.05-2.3-2.3-3.5 3.5-.45-.45 3.5-3.5-2.3-2.3 1.05-1.05 2.25.35z"/></svg>',
    audible: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6.25h2L8 3.5v9L5 9.75H3zM10.25 6a3 3 0 0 1 0 4M11.75 4.5a5 5 0 0 1 0 7"/></svg>',
    muted: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6.25h2L8 3.5v9L5 9.75H3zM10.25 6.25l3.5 3.5M13.75 6.25l-3.5 3.5"/></svg>',
    caret: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.75 4 4.25-4 4.25"/></svg>',
  };

  // Derived render bookkeeping and pointer/focus interaction state only.
  // The authoritative tab/group model is never copied out of renderer.js.
  let lastSignature = null;
  let pendingFocusKey = null;
  let dragState = null;
  let suppressFocusRestore = false;

  newTabShortcut.textContent = api.platform === 'darwin' ? '⌘T' : 'Ctrl T';

  function titleFor(tab) {
    return tab.title || (tab.private ? 'Private Tab' : 'New Tab');
  }

  function bucketKey(tab) {
    return JSON.stringify([tab.groupId ?? null, !!tab.pinned]);
  }

  function railSignature(payload) {
    return JSON.stringify({
      activeTabId: payload.activeTabId,
      groups: (payload.groups || []).map(({ id, name, collapsed }) => ({ id, name, collapsed })),
      tabs: (payload.tabs || []).map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favicon: tab.favicon,
        isLoading: tab.isLoading,
        private: tab.private,
        pinned: tab.pinned,
        muted: tab.muted,
        audible: tab.audible,
        groupId: tab.groupId ?? null,
      })),
    });
  }

  function invoke(label, action) {
    try {
      Promise.resolve(action()).catch((error) => {
        console.error(`Vertical tabs: ${label} failed`, error);
      });
    } catch (error) {
      console.error(`Vertical tabs: ${label} failed`, error);
    }
  }

  // Actions that hand keyboard focus to the Island or page must not have a
  // closely-following tabs:updated render restore focus back into the rail.
  function invokeLeavingRail(label, action) {
    pendingFocusKey = null;
    suppressFocusRestore = true;
    invoke(label, action);
  }

  function announce(message) {
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = message; });
  }

  function faviconFor(tab) {
    const favicon = document.createElement('span');
    favicon.className = `favicon vertical-tab-favicon${tab.isLoading ? ' loading' : ''}`;
    favicon.setAttribute('aria-hidden', 'true');
    if (tab.isLoading) return favicon;
    if ((tab.url || '').startsWith('blanc://')) {
      favicon.classList.add('internal');
    } else if (tab.favicon) {
      favicon.classList.add('has-icon');
      favicon.style.backgroundImage = `url("${tab.favicon.replace(/[\\"]/g, '\\$&')}")`;
    }
    return favicon;
  }

  function makeMarker(className, html, label) {
    const marker = document.createElement('span');
    marker.className = className;
    marker.innerHTML = html;
    marker.title = label;
    marker.setAttribute('aria-hidden', 'true');
    return marker;
  }

  function visiblePrimaryButtons() {
    return [...list.querySelectorAll('.vertical-tab-primary')];
  }

  function setRovingPrimary(target) {
    for (const button of visiblePrimaryButtons()) {
      button.tabIndex = button === target ? 0 : -1;
    }
  }

  function movePrimaryFocus(current, destination) {
    const buttons = visiblePrimaryButtons();
    if (!buttons.length) return;
    const currentIndex = Math.max(0, buttons.indexOf(current));
    let next;
    if (destination === 'first') next = buttons[0];
    else if (destination === 'last') next = buttons[buttons.length - 1];
    else {
      const offset = destination === 'previous' ? -1 : 1;
      next = buttons[(currentIndex + offset + buttons.length) % buttons.length];
    }
    setRovingPrimary(next);
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }

  function focusKeyFor(element) {
    return rail.contains(element) ? element.closest('[data-focus-key]')?.dataset.focusKey ?? null : null;
  }

  function clearDropIndicators() {
    for (const row of list.querySelectorAll('.drop-before, .drop-after')) {
      row.classList.remove('drop-before', 'drop-after');
    }
  }

  function closeTabFromRail(tab, keepFocus) {
    if (keepFocus) {
      const buttons = visiblePrimaryButtons();
      const current = buttons.findIndex((button) => button.dataset.tabId === tab.id);
      const fallback = buttons[current + 1] || buttons[current - 1];
      pendingFocusKey = fallback?.dataset.focusKey ?? null;
    }
    invoke('close tab', () => api.closeTab(tab.id));
  }

  function activateTab(tab) {
    invokeLeavingRail('activate tab', () => api.activateTabFromRail(tab.id));
  }

  function primaryKeydown(event, tab, primary, closeButton) {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      movePrimaryFocus(primary, 'previous');
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePrimaryFocus(primary, 'next');
    } else if (event.key === 'Home') {
      event.preventDefault();
      movePrimaryFocus(primary, 'first');
    } else if (event.key === 'End') {
      event.preventDefault();
      movePrimaryFocus(primary, 'last');
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      closeButton.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateTab(tab);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      closeTabFromRail(tab, true);
    }
  }

  function beforeIdForDrop(tab, bucketTabs, afterTarget) {
    if (!dragState || dragState.id === tab.id) return undefined;
    const withoutSource = bucketTabs.filter((candidate) => candidate.id !== dragState.id);
    const targetIndex = withoutSource.findIndex((candidate) => candidate.id === tab.id);
    if (targetIndex === -1) return undefined;
    const insertionIndex = targetIndex + (afterTarget ? 1 : 0);
    return withoutSource[insertionIndex]?.id ?? null;
  }

  function addDragBehavior(row, primary, tab, bucketTabs) {
    const tabBucket = bucketKey(tab);
    primary.draggable = true;

    primary.addEventListener('dragstart', (event) => {
      dragState = { id: tab.id, bucket: tabBucket, title: titleFor(tab) };
      row.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', tab.id);
      }
    });

    primary.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      dragState = null;
      clearDropIndicators();
    });

    row.addEventListener('dragover', (event) => {
      if (!dragState || dragState.bucket !== tabBucket || dragState.id === tab.id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const afterTarget = event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2;
      clearDropIndicators();
      row.classList.add(afterTarget ? 'drop-after' : 'drop-before');
    });

    row.addEventListener('dragleave', (event) => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('drop-before', 'drop-after');
    });

    row.addEventListener('drop', (event) => {
      if (!dragState || dragState.bucket !== tabBucket || dragState.id === tab.id) return;
      event.preventDefault();
      const source = dragState;
      const afterTarget = event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2;
      const beforeId = beforeIdForDrop(tab, bucketTabs, afterTarget);
      dragState = null;
      clearDropIndicators();
      if (beforeId === undefined) return;
      const reorderFocusKey = `tab:${source.id}`;
      pendingFocusKey = reorderFocusKey;
      invoke('reorder tab', () => Promise.resolve(
        api.reorderTabWithinBucket(source.id, beforeId)
      ).then((accepted) => {
        if (accepted) announce(`Moved ${source.title}`);
      }).finally(() => {
        // A changed order broadcasts and consumes this key immediately.
        // Accepted no-ops and rejected/stale requests do not broadcast; clear
        // their otherwise-stale intent after the IPC round trip.
        window.setTimeout(() => {
          if (pendingFocusKey === reorderFocusKey) pendingFocusKey = null;
        }, 100);
      }));
    });
  }

  function tabRow(tab, bucketTabs, activeTabId) {
    const title = titleFor(tab);
    const active = tab.id === activeTabId;
    const row = document.createElement('div');
    row.className =
      'vertical-tab-row' +
      (active ? ' active' : '') +
      (tab.private ? ' private' : '') +
      (tab.isLoading ? ' loading' : '');
    row.setAttribute('role', 'listitem');
    row.dataset.tabId = tab.id;
    row.dataset.bucket = bucketKey(tab);

    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'vertical-tab-primary';
    primary.dataset.tabId = tab.id;
    primary.dataset.focusKey = `tab:${tab.id}`;
    primary.tabIndex = -1;
    const states = [
      active && 'active',
      tab.private && 'private',
      tab.pinned && 'pinned',
      tab.isLoading && 'loading',
      tab.muted ? 'muted' : tab.audible && 'playing audio',
    ].filter(Boolean);
    primary.setAttribute(
      'aria-label',
      `${active ? 'Current tab' : 'Switch to'} ${title}${states.length ? `, ${states.join(', ')}` : ''}`
    );
    if (active) primary.setAttribute('aria-current', 'page');
    primary.title = title;

    primary.appendChild(faviconFor(tab));
    const titleEl = document.createElement('span');
    titleEl.className = 'vertical-tab-title';
    titleEl.textContent = title;
    primary.appendChild(titleEl);

    if (tab.private) {
      const privateMarker = document.createElement('span');
      privateMarker.className = 'vertical-tab-private';
      privateMarker.textContent = 'private';
      privateMarker.setAttribute('aria-hidden', 'true');
      primary.appendChild(privateMarker);
    }
    if (tab.pinned) {
      primary.appendChild(makeMarker('vertical-tab-state vertical-tab-pin', ICONS.pin, 'Pinned'));
    }
    if (tab.muted) {
      primary.appendChild(makeMarker('vertical-tab-state vertical-tab-audio muted', ICONS.muted, 'Muted'));
    } else if (tab.audible) {
      primary.appendChild(makeMarker('vertical-tab-state vertical-tab-audio', ICONS.audible, 'Playing audio'));
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vertical-tab-close';
    close.innerHTML = ICONS.close;
    close.title = `Close ${title}`;
    close.setAttribute('aria-label', `Close ${title}`);
    close.dataset.focusKey = `close:${tab.id}`;
    // ArrowRight from the row primary reaches this sibling without placing
    // every close action into the document's sequential Tab order.
    close.tabIndex = -1;

    primary.addEventListener('focus', () => setRovingPrimary(primary));
    primary.addEventListener('click', () => activateTab(tab));
    primary.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      closeTabFromRail(tab, false);
    });
    primary.addEventListener('keydown', (event) => primaryKeydown(event, tab, primary, close));
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTabFromRail(tab, event.detail === 0);
    });
    close.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setRovingPrimary(primary);
        primary.focus();
      }
    });
    addDragBehavior(row, primary, tab, bucketTabs);

    row.append(primary, close);
    return row;
  }

  function staticBucket(label, tabs, activeTabId) {
    if (!tabs.length) return null;
    const section = document.createElement('section');
    section.className = 'vertical-tabs-section';
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', label);

    const heading = document.createElement('h2');
    heading.className = 'vertical-tabs-section-heading';
    heading.textContent = label;
    const count = document.createElement('span');
    count.textContent = String(tabs.length);
    heading.appendChild(count);
    section.appendChild(heading);
    for (const tab of tabs) section.appendChild(tabRow(tab, tabs, activeTabId));
    return section;
  }

  function groupSection(group, members, activeTabId, index) {
    if (!members.length) return null;
    const section = document.createElement('section');
    section.className = 'vertical-tabs-section vertical-tabs-group';
    section.setAttribute('role', 'group');

    const containsActive = members.some((tab) => tab.id === activeTabId);
    const header = document.createElement('button');
    header.type = 'button';
    header.className =
      'vertical-tabs-group-header' +
      (group.collapsed ? ' collapsed' : '') +
      (containsActive && group.collapsed ? ' contains-active' : '');
    header.dataset.focusKey = `group:${group.id}`;
    header.setAttribute('aria-expanded', String(!group.collapsed));
    header.setAttribute(
      'aria-label',
      `${group.name}, ${members.length} ${members.length === 1 ? 'tab' : 'tabs'}, ` +
        `${group.collapsed ? 'collapsed' : 'expanded'}${containsActive ? ', contains current tab' : ''}`
    );
    const headerId = `vertical-tabs-group-${index}`;
    header.id = headerId;
    section.setAttribute('aria-labelledby', headerId);

    const caret = document.createElement('span');
    caret.className = 'vertical-tabs-group-caret';
    caret.innerHTML = ICONS.caret;
    caret.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'vertical-tabs-group-name';
    name.textContent = group.name;
    const count = document.createElement('span');
    count.className = 'vertical-tabs-group-count';
    count.textContent = String(members.length);
    header.append(caret, name, count);
    if (containsActive && group.collapsed) {
      const activeMarker = document.createElement('span');
      activeMarker.className = 'vertical-tabs-group-active';
      activeMarker.title = 'Contains current tab';
      activeMarker.setAttribute('aria-hidden', 'true');
      header.appendChild(activeMarker);
    }
    const rule = document.createElement('span');
    rule.className = 'vertical-tabs-group-rule';
    rule.setAttribute('aria-hidden', 'true');
    header.appendChild(rule);

    header.addEventListener('click', () => {
      pendingFocusKey = header.dataset.focusKey;
      invoke('toggle group', () => api.toggleGroupCollapsed(group.id));
    });
    header.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' && group.collapsed) {
        event.preventDefault();
        header.click();
      } else if (event.key === 'ArrowLeft' && !group.collapsed) {
        event.preventDefault();
        header.click();
      } else if (event.key === 'ArrowDown' && !group.collapsed) {
        const first = section.querySelector('.vertical-tab-primary');
        if (first) {
          event.preventDefault();
          setRovingPrimary(first);
          first.focus();
        }
      }
    });
    section.appendChild(header);

    if (!group.collapsed) {
      const pinned = members.filter((tab) => tab.pinned);
      const regular = members.filter((tab) => !tab.pinned);
      for (const tab of pinned) section.appendChild(tabRow(tab, pinned, activeTabId));
      for (const tab of regular) section.appendChild(tabRow(tab, regular, activeTabId));
    }
    return section;
  }

  function restoreRovingFocus(payload, focusKey, shouldRestore) {
    const primaries = visiblePrimaryButtons();
    if (!primaries.length) return;
    const requestedPrimary = primaries.find((button) => button.dataset.focusKey === focusKey);
    const activePrimary = primaries.find((button) => button.dataset.tabId === payload.activeTabId);
    setRovingPrimary(requestedPrimary || activePrimary || primaries[0]);

    if (!shouldRestore || !focusKey) return;
    const focusTarget = [...rail.querySelectorAll('[data-focus-key]')]
      .find((element) => element.dataset.focusKey === focusKey);
    if (focusTarget) {
      if (focusTarget.classList.contains('vertical-tab-primary')) setRovingPrimary(focusTarget);
      focusTarget.focus();
    }
  }

  function render(payload = {}) {
    const layout = payload.tabLayout === 'vertical' ? 'vertical' : 'island';
    const width = payload.verticalTabsWidth;
    if (!Number.isFinite(width) || width <= 0) {
      // A vertical payload without main's authoritative width is incomplete;
      // fail closed to Island instead of inventing renderer geometry.
      document.documentElement.dataset.tabLayout = 'island';
      rail.hidden = true;
      lastSignature = null;
      return;
    }
    document.documentElement.dataset.tabLayout = layout;
    document.documentElement.style.setProperty('--vertical-tabs-w', `${width}px`);
    rail.hidden = layout !== 'vertical';
    rail.dataset.activeTabId = payload.activeTabId || '';
    if (layout !== 'vertical') {
      lastSignature = null;
      dragState = null;
      return;
    }

    const signature = railSignature(payload);
    if (signature === lastSignature) return;
    lastSignature = signature;
    dragState = null;

    // A blurred chrome document retains its last activeElement. Never treat
    // that stale element as a restoration request: a later title/favicon/
    // loading broadcast must not pull focus back from page content or an
    // overlay after the explicit handoff has completed.
    const chromeOwnsFocus = document.hasFocus();
    const focusedKey = pendingFocusKey ||
      (chromeOwnsFocus ? focusKeyFor(document.activeElement) : null);
    const shouldRestoreFocus = !suppressFocusRestore && chromeOwnsFocus;
    pendingFocusKey = null;
    const scrollTop = list.scrollTop;
    const tabs = payload.tabs || [];
    const groups = payload.groups || [];
    const activeTabId = payload.activeTabId;
    const knownGroupIds = new Set(groups.map((group) => group.id));
    const fragment = document.createDocumentFragment();

    const standalonePins = tabs.filter((tab) => tab.pinned && (tab.groupId ?? null) === null);
    const pinnedSection = staticBucket('pinned', standalonePins, activeTabId);
    if (pinnedSection) fragment.appendChild(pinnedSection);

    groups.forEach((group, index) => {
      const members = tabs.filter((tab) => tab.groupId === group.id);
      const section = groupSection(group, members, activeTabId, index);
      if (section) fragment.appendChild(section);
    });

    // Invalid orphaned group ids should never escape main's model, but keep
    // their tabs visible if a future migration briefly produces one.
    const looseTabs = tabs.filter((tab) => (
      !tab.pinned &&
      ((tab.groupId ?? null) === null || !knownGroupIds.has(tab.groupId))
    ));
    const looseSection = staticBucket('tabs', looseTabs, activeTabId);
    if (looseSection) fragment.appendChild(looseSection);

    list.replaceChildren(fragment);
    list.scrollTop = scrollTop;
    restoreRovingFocus(payload, focusedKey, shouldRestoreFocus);
  }

  useIslandButton.addEventListener('click', () => {
    invokeLeavingRail('change tab layout', () => api.setTabLayout('island'));
  });
  newTabButton.addEventListener('click', () => {
    invokeLeavingRail('create tab', () => api.createTab(null, { focusAddress: true }));
  });
  rail.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !rail.dataset.activeTabId) return;
    event.preventDefault();
    event.stopPropagation();
    invokeLeavingRail(
      'return focus to active tab',
      () => api.activateTabFromRail(rail.dataset.activeTabId)
    );
  });
  // A rail-originated action hands focus to page/overlay content. Background
  // tab updates stay forbidden from restoring the rail until the user
  // deliberately focuses a rail control again.
  rail.addEventListener('focusin', () => {
    suppressFocusRestore = false;
  });

  window.blancVerticalTabs = Object.freeze({ render });
})();
