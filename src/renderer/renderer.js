// Renderer for the chrome strip — the slim band the resting island pill
// floats in, plus window controls and permission prompts. The island's
// expanded states live in a separate overlay WebContentsView (overlay.js)
// so they can float over the web content.
(() => {
  const { platform } = window.browserAPI;
  const isMac = platform === 'darwin';
  if (isMac) document.body.classList.add('mac');

  const chromeEl = document.getElementById('chrome');
  const stripEl = document.getElementById('strip');
  const islandPill = document.getElementById('islandPill');
  const pillDots = document.getElementById('pillDots');
  const pillGroupName = document.getElementById('pillGroupName');
  const pillFavicon = document.getElementById('pillFavicon');
  const pillDomain = document.getElementById('pillDomain');
  const pillShield = document.getElementById('pillShield');
  const pillInsecure = document.getElementById('pillInsecure');
  const pillPrivateChip = document.getElementById('pillPrivateChip');
  const windowControls = document.getElementById('windowControls');
  const permissionBar = document.getElementById('permissionBar');
  const permissionText = document.getElementById('permissionText');
  const permAllowBtn = document.getElementById('permAllowBtn');
  const permBlockBtn = document.getElementById('permBlockBtn');

  let state = { tabs: [], activeTabId: null, groups: [] };
  /** Overlay mode mirrored from main — the pill hides while the command
   * bar is expanded in place ('panel'); the palette keeps it visible. */
  let islandMode = null;

  const ICONS = {
    close: '<svg viewBox="0 0 16 16"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5"/></svg>',
    minimize: '<svg viewBox="0 0 16 16"><path d="M3.5 8h9"/></svg>',
    maximize: '<svg viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1"/></svg>',
  };

  // --- Window controls (non-mac only; macOS gets native traffic lights) ---
  if (!isMac) {
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

  function shieldTooltip(blocked) {
    return `Blanc blocked ${blocked} ${blocked === 1 ? 'ad or tracker' : 'ads & trackers'} on this page`;
  }

  /** Short label for a tab's location: host for web pages, page name for
   * internal ones, empty for a blank new tab. */
  function tabDomain(tab) {
    if (!tab?.url || tab.url.startsWith('blanc://newtab')) return '';
    try {
      const u = new URL(tab.url);
      return u.protocol === 'blanc:' ? `blanc://${u.host}` : u.host;
    } catch {
      return tab.url;
    }
  }

  /** Warning-only security check: true just for plain HTTP to a non-loopback
   * host — https, blanc:, file:, and local dev servers show no indicator.
   * (Keep in sync with overlay.js.) */
  function connectionInsecure(url) {
    if (!url?.startsWith('http://')) return false;
    try {
      const host = new URL(url).hostname;
      return !(host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '[::1]');
    } catch {
      return false;
    }
  }

  function setFavicon(el, tab) {
    el.className = 'favicon' + (tab?.isLoading ? ' loading' : '');
    el.style.backgroundImage = '';
    if (!tab || tab.isLoading) return;
    if (tab.favicon) {
      el.classList.add('has-icon');
      el.style.backgroundImage = `url("${tab.favicon.replace(/[\\"]/g, '\\$&')}")`;
    } else if (tab.url.startsWith('blanc://')) {
      el.classList.add('has-icon');
      el.style.backgroundImage = 'url("pages/icon.svg")'; // Blanc mark
    }
  }

  /** Faux header: paint the strip with the active page's own top-edge
   * color so it reads as a continuation of the site, not a chrome bar.
   * Private tabs keep the private theme untinted. */
  function applyStripTint(tab) {
    const tint = (!tab?.private && (tab?.pageBg || tab?.themeColor)) || null;
    if (!tint) {
      stripEl.style.removeProperty('--page-bg');
      stripEl.classList.remove('tint-dark');
      return;
    }
    stripEl.style.setProperty('--page-bg', tint);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16));
    stripEl.classList.toggle('tint-dark', 0.299 * r + 0.587 * g + 0.114 * b < 128);
  }

  /** Pill cluster order: each non-empty group in group order, then the
   * ungrouped tabs. (Keep in sync with overlay.js.) */
  function clusterTabs() {
    const clusters = [];
    for (const g of state.groups) {
      const gtabs = state.tabs.filter((t) => t.groupId === g.id && !t.pinned);
      if (gtabs.length) clusters.push({ group: g, tabs: gtabs });
    }
    const loose = state.tabs.filter((t) => !t.groupId && !t.pinned);
    if (loose.length) clusters.push({ group: null, tabs: loose });
    return clusters;
  }

  function tabDot(t) {
    const dot = document.createElement('button');
    dot.className =
      'island-dot' +
      (t.id === state.activeTabId ? ' active' : '') +
      (t.isLoading ? ' loading' : '') +
      (t.private ? ' private' : '');
    dot.title = t.title || 'New Tab';
    dot.setAttribute('aria-label', `Switch to ${t.title || 'New Tab'}`);
    dot.addEventListener('click', (e) => {
      e.stopPropagation(); // switch without expanding
      window.browserAPI.switchTab(t.id);
    });
    return dot;
  }

  function render() {
    const tab = activeTab();

    const pinnedTabs = state.tabs.filter((t) => t.pinned);
    const pinnedShelf = document.createElement('span');
    pinnedShelf.className = 'pill-cluster pinned-shelf';
    pinnedShelf.title = `${pinnedTabs.length} pinned ${pinnedTabs.length === 1 ? 'tab' : 'tabs'}`;
    pinnedShelf.append(...pinnedTabs.map(tabDot));

    const clusters = clusterTabs();
    pillDots.replaceChildren(
      ...(pinnedTabs.length ? [pinnedShelf] : []),
      ...clusters.map(({ group, tabs: gtabs }) => {
        // A pinned active tab isn't a member of any cluster here (it's
        // excluded into the pinned shelf instead), so no cluster should
        // ever claim to be the active one on its behalf.
        const isActiveCluster = !tab?.pinned && (group ? tab?.groupId === group.id : !tab?.groupId);
        const folded = group && group.collapsed && !isActiveCluster;
        // The folded capsule is a button like the dots, so it stays
        // keyboard-reachable; expanded clusters are plain wrappers.
        const cluster = document.createElement(folded ? 'button' : 'span');
        if (folded) {
          // Folded capsule: a bordered pill of mini-dots; click jumps to
          // the group (activates its first tab and unfolds it).
          cluster.className = 'pill-cluster folded';
          cluster.title = `${group.name} · ${gtabs.length} ${gtabs.length === 1 ? 'tab' : 'tabs'}`;
          cluster.setAttribute('aria-label', `Jump to group ${group.name}`);
          cluster.addEventListener('click', (e) => {
            e.stopPropagation();
            window.browserAPI.focusGroup(group.id);
          });
          cluster.append(
            ...gtabs.slice(0, 4).map(() => {
              const mini = document.createElement('span');
              mini.className = 'dot-mini';
              return mini;
            })
          );
        } else {
          cluster.className = 'pill-cluster' + (isActiveCluster ? '' : ' dim');
          if (group) cluster.title = group.name;
          else if (clusters.length > 1) cluster.title = 'no group';
          cluster.append(...gtabs.map(tabDot));
        }
        return cluster;
      })
    );

    const activeGroup = state.groups.find((g) => g.id === tab?.groupId) || null;
    pillGroupName.hidden = !activeGroup;
    pillGroupName.textContent = activeGroup ? `${activeGroup.name} ·` : '';

    setFavicon(pillFavicon, tab);
    pillDomain.textContent = tab?.isLoading
      ? 'Loading…'
      : tabDomain(tab) || (tab?.private ? 'private tab' : 'new tab');
    pillDomain.classList.toggle('dim', !!tab?.isLoading);

    // Hidden while loading too — the domain says "Loading…" and the old
    // page's security state mustn't linger under it.
    pillInsecure.hidden = !tab || tab.isLoading || !connectionInsecure(tab.url);

    pillPrivateChip.hidden = !tab?.private;

    const blocked = tab?.blockedCount ?? 0;
    pillShield.hidden = blocked === 0;
    pillShield.textContent = String(blocked);
    pillShield.title = shieldTooltip(blocked);

    // The private theme scope follows the active tab.
    if (tab?.private) document.documentElement.dataset.theme = 'private';
    else delete document.documentElement.dataset.theme;

    applyStripTint(tab);

    islandPill.style.visibility = islandMode === 'panel' ? 'hidden' : '';

    // The strip's draggable region is registered at the WINDOW level and
    // hit-tests above every WebContentsView — with the command bar overlay
    // expanded over the strip band, it would swallow clicks meant for the
    // panel's input row (the ✕, nav buttons). Suspend it while overlaid.
    stripEl.classList.toggle('drag-suspended', islandMode === 'panel' || islandMode === 'palette');
  }

  // Quick exit: clicking the pill's private chip closes the private tab.
  pillPrivateChip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.activeTabId) window.browserAPI.closeTab(state.activeTabId);
  });

  islandPill.addEventListener('click', () => window.browserAPI.openIsland());
  islandPill.addEventListener('keydown', (e) => {
    // Only when the pill itself is focused — a focused child button (tab
    // dot, folded group capsule) must keep its own Enter/Space activation.
    if (e.target !== islandPill) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      window.browserAPI.openIsland();
    }
  });

  // Double-click on empty strip area zooms the window (desktop convention).
  stripEl.addEventListener('dblclick', (e) => {
    if (e.target === stripEl) window.browserAPI.maximizeWindow();
  });

  // --- Permission prompts (one visible at a time, FIFO) ---
  const permissionQueue = [];
  let activePermissionPrompt = null;

  function describePermission({ permission, mediaTypes }) {
    if (permission === 'media') {
      const wantsAudio = mediaTypes.includes('audio');
      const wantsVideo = mediaTypes.includes('video');
      if (wantsAudio && wantsVideo) return 'use your camera and microphone';
      if (wantsVideo) return 'use your camera';
      return 'use your microphone';
    }
    if (permission === 'geolocation') return 'know your location';
    if (permission === 'notifications') return 'show notifications';
    return `use “${permission}”`;
  }

  function showNextPermissionPrompt() {
    activePermissionPrompt = permissionQueue.shift() ?? null;
    permissionBar.hidden = !activePermissionPrompt;
    if (activePermissionPrompt) {
      const host = new URL(activePermissionPrompt.origin).host;
      permissionText.textContent = `${host} wants to ${describePermission(activePermissionPrompt)}`;
    }
  }

  function answerPermissionPrompt(allow) {
    if (!activePermissionPrompt) return;
    window.browserAPI.respondPermission(activePermissionPrompt.id, allow);
    showNextPermissionPrompt();
  }

  permAllowBtn.addEventListener('click', () => answerPermissionPrompt(true));
  permBlockBtn.addEventListener('click', () => answerPermissionPrompt(false));

  window.browserAPI.onPermissionPrompt((payload) => {
    permissionQueue.push(payload);
    if (!activePermissionPrompt) showNextPermissionPrompt();
  });

  // --- State sync ---
  window.browserAPI.onTabsUpdated((payload) => {
    state = payload;
    render();
  });
  window.browserAPI.onIslandState(({ mode }) => {
    islandMode = mode;
    render();
  });
  window.browserAPI.getAllTabs().then((payload) => {
    state = payload;
    render();
  });

  // --- Report strip height so main can size tab views below it. ---
  const reportLayout = () => {
    window.browserAPI.reportChromeLayout(chromeEl.getBoundingClientRect().height);
  };
  new ResizeObserver(reportLayout).observe(chromeEl);
  requestAnimationFrame(reportLayout);
})();
