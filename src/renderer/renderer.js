(() => {
  const { platform } = window.browserAPI;
  if (platform === 'darwin') document.body.classList.add('mac');

  const chromeEl = document.getElementById('chrome');
  const tabStrip = document.getElementById('tabStrip');
  const newTabBtn = document.getElementById('newTabBtn');
  const windowControls = document.getElementById('windowControls');
  const backBtn = document.getElementById('backBtn');
  const fwdBtn = document.getElementById('fwdBtn');
  const reloadBtn = document.getElementById('reloadBtn');
  const addressInput = document.getElementById('addressInput');
  const loadingBar = document.getElementById('loadingBar');
  const shieldBadge = document.getElementById('shieldBadge');
  const starBtn = document.getElementById('starBtn');
  const downloadsBtn = document.getElementById('downloadsBtn');
  const downloadsBadge = document.getElementById('downloadsBadge');
  const historyBtn = document.getElementById('historyBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const extensionsWrap = document.getElementById('extensionsWrap');
  const extensionsBtn = document.getElementById('extensionsBtn');
  const extensionsPopover = document.getElementById('extensionsPopover');
  const extensionsEmpty = document.getElementById('extensionsEmpty');
  const actionList = document.getElementById('actionList');

  let tabIndicator = document.getElementById('tabIndicator');
  if (!tabIndicator) {
    tabIndicator = document.createElement('div');
    tabIndicator.id = 'tabIndicator';
    tabStrip.appendChild(tabIndicator);
  }

  let state = { tabs: [], activeTabId: null };
  let addressBarEditing = false;
  let extensionsOpen = false;
  let installedExtensionCount = 0;
  let actionObserver = null;
  let actionObserveAttempts = 0;

  // Icon set: 16px grid, 1.5px rounded strokes, currentColor (see styles.css).
  const ICONS = {
    reload: '<svg viewBox="0 0 16 16"><path d="M14 8a6 6 0 1 1-6-6c1.68 0 3.29.67 4.49 1.83L14 5.33"/><path d="M14 2v3.33h-3.33"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5"/></svg>',
    minimize: '<svg viewBox="0 0 16 16"><path d="M3.5 8h9"/></svg>',
    maximize: '<svg viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1"/></svg>',
  };
  reloadBtn.innerHTML = ICONS.reload;

  // While a tab is being dragged we own the strip's DOM order; incoming
  // broadcasts are parked and applied when the drag ends.
  let draggedTabId = null;
  let pendingState = null;

  // --- Window controls (non-mac only; macOS gets native traffic lights) ---
  if (platform !== 'darwin') {
    const mk = (icon, title, onClick, extraClass) => {
      const b = document.createElement('button');
      b.innerHTML = icon;
      b.title = title;
      if (extraClass) b.classList.add(extraClass);
      b.addEventListener('click', onClick);
      return b;
    };
    windowControls.append(
      mk(ICONS.minimize, 'Minimize', () => window.browserAPI.minimizeWindow()),
      mk(ICONS.maximize, 'Maximize / Restore', () => window.browserAPI.maximizeWindow()),
      mk(ICONS.close, 'Close', () => window.browserAPI.closeWindow(), 'close-btn')
    );
  }

  function activeTab() {
    return state.tabs.find((t) => t.id === state.activeTabId) || null;
  }

  const isInternalUrl = (url) => url.startsWith('bowser://') || url.startsWith('file://');
  const isBookmarkable = (url) => /^https?:\/\//.test(url);

  function addressDisplayValue(tab) {
    if (!tab) return '';
    if (tab.url.startsWith('bowser://newtab') || tab.url.startsWith('file://')) return '';
    return tab.url;
  }

  function visibleExtensionActionCount() {
    return actionList.shadowRoot?.querySelectorAll('.action').length ?? 0;
  }

  function installExtensionActionStyles(root) {
    if (root.getElementById('bowserExtensionActionStyles')) return;
    const style = document.createElement('style');
    style.id = 'bowserExtensionActionStyles';
    style.textContent = `
:host {
  display: flex;
  flex-flow: row wrap;
  gap: 6px;
}

.action {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background-color: transparent;
  background-size: 20px;
  color: var(--text-dim);
}

.action:hover {
  background-color: var(--accent-dim);
}

.action:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.action.no-icon::after {
  content: none;
  display: none;
}

.fallback-icon {
  width: 18px;
  height: 18px;
  border: 1.5px solid currentColor;
  border-radius: 4px;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  pointer-events: none;
}

.action:hover .fallback-icon {
  color: var(--accent);
}
`;
    root.append(style);
  }

  function normalizeExtensionActions() {
    const root = actionList.shadowRoot;
    if (!root) return;

    for (const action of root.querySelectorAll('.action')) {
      const label = action.getAttribute('aria-label') || action.dataset.label || action.title;
      const hadMissingIconFallback = action.classList.contains('no-icon');
      if (label) {
        action.dataset.label = label;
        action.dataset.letter ||= label.trim().charAt(0);
        action.setAttribute('aria-label', label);
      }
      action.removeAttribute('title');

      if (hadMissingIconFallback) {
        action.classList.remove('no-icon');
        action.style.backgroundImage = '';
      }

      const needsFallback = hadMissingIconFallback || (!action.style.backgroundImage && action.dataset.label);
      let fallback = action.querySelector('.fallback-icon');
      if (needsFallback) {
        if (!fallback) {
          fallback = document.createElement('span');
          fallback.className = 'fallback-icon';
          action.prepend(fallback);
        }
        fallback.textContent = action.dataset.letter || action.dataset.label?.trim().charAt(0) || '';
      } else if (fallback) {
        fallback.remove();
      }
    }
  }

  function syncExtensionActions() {
    const root = actionList.shadowRoot;
    if (root) {
      installExtensionActionStyles(root);
      normalizeExtensionActions();
    }
    renderExtensionsSummary();
  }

  function observeExtensionActions() {
    const root = actionList.shadowRoot;
    if (!root) {
      if (actionObserveAttempts < 20) {
        actionObserveAttempts += 1;
        requestAnimationFrame(observeExtensionActions);
      }
      return;
    }
    if (actionObserver) return;

    installExtensionActionStyles(root);
    actionObserver = new MutationObserver(syncExtensionActions);
    actionObserver.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'style', 'title'],
      childList: true,
      subtree: true,
    });
    root.addEventListener('pointerover', normalizeExtensionActions, true);
    root.addEventListener('focusin', normalizeExtensionActions, true);
    syncExtensionActions();
  }

  function renderExtensionsSummary() {
    const actionCount = visibleExtensionActionCount();
    const hasInstalledExtensions = installedExtensionCount > 0;
    const waitingForActions = hasInstalledExtensions && !actionList.shadowRoot;
    extensionsEmpty.hidden = actionCount > 0 || waitingForActions;
    extensionsEmpty.textContent = hasInstalledExtensions
      ? 'No extension actions available.'
      : 'No extensions installed.';
  }

  async function refreshExtensionsSummary() {
    try {
      const extensions = await window.browserAPI.getExtensions();
      installedExtensionCount = extensions.length;
    } catch {
      installedExtensionCount = 0;
    }
    renderExtensionsSummary();
  }

  function setExtensionsOpen(open) {
    extensionsOpen = open;
    extensionsPopover.hidden = !open;
    extensionsBtn.setAttribute('aria-expanded', String(open));
    extensionsBtn.classList.toggle('active', open);
    chromeEl.classList.toggle('extensions-open', open);
    requestAnimationFrame(reportLayout);

    if (open) {
      refreshExtensionsSummary();
      actionObserveAttempts = 0;
      observeExtensionActions();
      requestAnimationFrame(() => {
        const firstAction = actionList.shadowRoot?.querySelector('.action');
        (firstAction || extensionsPopover).focus();
      });
    }
  }

  function render() {
    // Tab strip
    tabStrip.querySelectorAll('.tab').forEach((el) => el.remove());
    let activeEl = null;

    for (const tab of state.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === state.activeTabId ? ' active' : '');
      el.setAttribute('role', 'tab');
      el.dataset.tabId = tab.id;
      el.draggable = true;
      el.title = tab.url && !tab.url.startsWith('bowser://') ? `${tab.title}\n${tab.url}` : tab.title;

      const favicon = document.createElement('div');
      favicon.className =
        'tab-favicon' + (tab.isLoading ? ' loading' : tab.favicon ? ' has-icon' : '');
      if (tab.favicon && !tab.isLoading) favicon.style.backgroundImage = `url("${tab.favicon}")`;

      const title = document.createElement('div');
      title.className = 'tab-title';
      title.textContent = tab.isLoading ? 'Loading…' : (tab.title || 'New Tab');

      const close = document.createElement('div');
      close.className = 'tab-close';
      close.innerHTML = ICONS.close;
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        window.browserAPI.closeTab(tab.id);
      });

      el.append(favicon, title, close);
      el.addEventListener('click', () => window.browserAPI.switchTab(tab.id));
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) window.browserAPI.closeTab(tab.id); // middle-click closes
      });

      // --- Drag-to-reorder ---
      el.addEventListener('dragstart', (e) => {
        draggedTabId = tab.id;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tab.id);
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        const finalIndex = [...tabStrip.querySelectorAll('.tab')].indexOf(el);
        const id = draggedTabId;
        draggedTabId = null;
        if (id) window.browserAPI.reorderTab(id, finalIndex);
        if (pendingState) {
          state = pendingState;
          pendingState = null;
          render();
        }
      });

      tabStrip.insertBefore(el, tabIndicator);
      if (tab.id === state.activeTabId) activeEl = el;
    }

    // Signature active-tab indicator: slide/resize under the active tab
    if (activeEl) {
      tabIndicator.style.width = `${activeEl.offsetWidth}px`;
      tabIndicator.style.transform = `translateX(${activeEl.offsetLeft}px)`;
    }

    // Toolbar state
    const tab = activeTab();
    backBtn.disabled = !tab?.canGoBack;
    fwdBtn.disabled = !tab?.canGoForward;
    loadingBar.classList.toggle('active', !!tab?.isLoading);
    const wantStop = !!tab?.isLoading;
    if (reloadBtn.dataset.mode !== (wantStop ? 'stop' : 'reload')) {
      reloadBtn.dataset.mode = wantStop ? 'stop' : 'reload';
      reloadBtn.innerHTML = wantStop ? ICONS.stop : ICONS.reload;
      reloadBtn.title = wantStop ? 'Stop' : 'Reload';
    }

    const blocked = tab?.blockedCount ?? 0;
    shieldBadge.hidden = blocked === 0;
    shieldBadge.textContent = String(blocked);

    // Point extension toolbar icons (badge counts, popup targets) at the
    // active tab's webContents.
    if (tab?.wcId != null) actionList.setAttribute('tab', String(tab.wcId));

    starBtn.disabled = !tab || !isBookmarkable(tab.url);
    starBtn.classList.toggle('starred', !!tab?.bookmarked);

    if (!addressBarEditing) {
      addressInput.value = addressDisplayValue(tab);
    }
  }

  // Reordering happens live while dragging over the strip: the dragged tab
  // slots in before whichever tab's midpoint the cursor is left of.
  tabStrip.addEventListener('dragover', (e) => {
    if (!draggedTabId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const draggedEl = tabStrip.querySelector('.tab.dragging');
    if (!draggedEl) return;
    const siblings = [...tabStrip.querySelectorAll('.tab:not(.dragging)')];
    const nextEl = siblings.find((el) => {
      const rect = el.getBoundingClientRect();
      return e.clientX < rect.left + rect.width / 2;
    });
    tabStrip.insertBefore(draggedEl, nextEl ?? tabIndicator);
  });
  tabStrip.addEventListener('drop', (e) => e.preventDefault());

  // Double-click on empty titlebar area zooms the window (desktop convention).
  document.getElementById('titlebar').addEventListener('dblclick', (e) => {
    if (e.target.id === 'titlebar' || e.target.id === 'dragFill' || e.target.id === 'trafficSpacer') {
      window.browserAPI.maximizeWindow();
    }
  });

  // --- Toolbar wiring ---
  newTabBtn.addEventListener('click', () => window.browserAPI.createTab());
  backBtn.addEventListener('click', () => state.activeTabId && window.browserAPI.goBack(state.activeTabId));
  fwdBtn.addEventListener('click', () => state.activeTabId && window.browserAPI.goForward(state.activeTabId));
  reloadBtn.addEventListener('click', () => {
    if (!state.activeTabId) return;
    const tab = activeTab();
    tab?.isLoading ? window.browserAPI.stop(state.activeTabId) : window.browserAPI.reload(state.activeTabId);
  });
  starBtn.addEventListener('click', () => window.browserAPI.toggleBookmark());
  downloadsBtn.addEventListener('click', () => window.browserAPI.openPage('downloads'));
  historyBtn.addEventListener('click', () => window.browserAPI.openPage('history'));
  settingsBtn.addEventListener('click', () => window.browserAPI.openPage('settings'));
  extensionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setExtensionsOpen(!extensionsOpen);
  });
  document.addEventListener('click', (e) => {
    if (extensionsOpen && !extensionsWrap.contains(e.target)) setExtensionsOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && extensionsOpen) {
      setExtensionsOpen(false);
      extensionsBtn.focus();
    }
  });

  addressInput.addEventListener('focus', () => {
    addressBarEditing = true;
    addressInput.select();
  });
  addressInput.addEventListener('blur', () => {
    addressBarEditing = false;
    render();
  });
  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.activeTabId) {
      window.browserAPI.navigate(state.activeTabId, addressInput.value);
      addressInput.blur();
    } else if (e.key === 'Escape') {
      addressInput.blur();
    }
  });

  // --- Downloads badge ---
  function renderDownloads({ activeCount }) {
    downloadsBadge.hidden = activeCount === 0;
    downloadsBadge.textContent = activeCount > 0 ? String(activeCount) : '';
    downloadsBtn.classList.toggle('has-active', activeCount > 0);
  }

  // --- IPC subscriptions ---
  window.browserAPI.onTabsUpdated((payload) => {
    if (draggedTabId) {
      pendingState = payload;
      return;
    }
    state = payload;
    render();
  });
  window.browserAPI.onDownloadsUpdated(renderDownloads);
  window.browserAPI.onFocusAddressBar(() => {
    addressInput.focus();
  });
  window.browserAPI.getAllTabs().then((payload) => {
    state = payload;
    render();
  });
  window.browserAPI.getDownloadsSummary().then(renderDownloads);
  refreshExtensionsSummary();

  customElements.whenDefined('browser-action-list').then(observeExtensionActions);

  // --- Report chrome height so the main process can size the active
  // WebContentsView to fill exactly the remaining space. ---
  const reportLayout = () => {
    window.browserAPI.reportChromeLayout(chromeEl.getBoundingClientRect().height);
  };
  new ResizeObserver(reportLayout).observe(chromeEl);
  requestAnimationFrame(reportLayout);
})();
