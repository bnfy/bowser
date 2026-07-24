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
  const pillNav = document.getElementById('pillNav');
  const pillActions = document.getElementById('pillActions');
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
  /** Resolved app appearance pushed by main before prefers-color-scheme has
   * propagated. Cleared as soon as the media query catches up so --bg remains
   * the canonical steady-state color. */
  let pendingThemeAppearance = null;
  let themeHandoffPending = false;
  const darkSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const ICONS = {
    close: '<svg viewBox="0 0 16 16"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5"/></svg>',
    minimize: '<svg viewBox="0 0 16 16"><path d="M3.5 8h9"/></svg>',
    maximize: '<svg viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1"/></svg>',
  };

  const PILL_ICONS = {
    back: '<svg viewBox="0 0 16 16"><path d="M9.75 3.5 5.25 8l4.5 4.5"/></svg>',
    forward: '<svg viewBox="0 0 16 16"><path d="M6.25 3.5 10.75 8l-4.5 4.5"/></svg>',
    reload: '<svg viewBox="0 0 16 16"><path d="M12.42 10.35a5 5 0 1 1-4.42-7.35c1.4 0 2.74.56 3.74 1.53L13 5.78"/><path d="M13 3v2.78h-2.78"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"/></svg>',
    heart: '<svg viewBox="0 0 16 16"><path d="M8 13.25C4.6 11 2.75 8.9 2.75 6.6a2.85 2.85 0 0 1 5.25-1.54A2.85 2.85 0 0 1 13.25 6.6c0 2.3-1.85 4.4-5.25 6.65z"/></svg>',
    download: '<svg viewBox="0 0 16 16"><path d="M8 2.5v6.5M5.3 6.3 8 9l2.7-2.7M3.5 12.5h9"/></svg>',
  };

  /** A quiet icon button for the pill. stopPropagation keeps a click on the
   * button from bubbling to the pill (which would open the panel). */
  function pillButton(iconKey, title, onClick) {
    const b = document.createElement('button');
    b.className = 'pill-btn';
    b.innerHTML = PILL_ICONS[iconKey];
    b.title = title;
    b.setAttribute('aria-label', title);
    // Don't let a mouse click focus the button. Reload (and friends) retain
    // focus after a click since they don't navigate away; a later keypress
    // then flips :focus-visible on and paints a stray circular ring
    // (border-radius:50%) in the resting pill. preventDefault on mousedown
    // keeps the focus ring for keyboard (Tab) users only, where it belongs.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  const backBtn = pillButton('back', 'Back', () => state.activeTabId && window.browserAPI.goBack(state.activeTabId));
  const forwardBtn = pillButton('forward', 'Forward', () => state.activeTabId && window.browserAPI.goForward(state.activeTabId));
  pillNav.append(backBtn, forwardBtn);

  const reloadBtn = pillButton('reload', 'Reload', () => {
    const t = activeTab();
    if (!t) return;
    if (t.isLoading) window.browserAPI.stop(t.id);
    else window.browserAPI.reload(t.id);
  });
  const favoriteBtn = pillButton('heart', 'Favorite this page', () => window.browserAPI.toggleBookmark());
  pillActions.append(reloadBtn, favoriteBtn);

  let downloadState = { active: 0, hasRecent: false, receivedBytes: 0, totalBytes: 0 };
  const downloadsBtn = pillButton('download', 'Downloads', () => {
    window.browserAPI.openPage('downloads');
    window.browserAPI.acknowledgeDownloads();
  });
  downloadsBtn.classList.add('pill-download');
  downloadsBtn.hidden = true;
  pillActions.append(downloadsBtn);

  function renderDownloads() {
    const { active, hasRecent, receivedBytes, totalBytes } = downloadState;
    downloadsBtn.hidden = !(active > 0 || hasRecent);
    downloadsBtn.classList.toggle('active', active > 0);
    const pct = active > 0 && totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0;
    downloadsBtn.style.setProperty('--dl-progress', String(pct));
    downloadsBtn.title = active > 0 ? `Downloading — ${active} active` : 'Downloads';
  }
  renderDownloads();

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

  function setFavicon(el, tab, base = 'favicon') {
    el.className = base + (tab?.isLoading ? ' loading' : '');
    el.style.backgroundImage = '';
    if (!tab || tab.isLoading) return;
    if (tab.url.startsWith('blanc://')) {
      // Blanc mark via CSS mask so it follows the theme — the pages' own SVG
      // favicon always rasterizes light-scheme (see .favicon.internal).
      el.classList.add('internal');
    } else if (tab.favicon) {
      el.classList.add('has-icon');
      el.style.backgroundImage = `url("${tab.favicon.replace(/[\\"]/g, '\\$&')}")`;
    }
  }

  /** Faux header: paint the strip with the active page's own top-edge
   * color so it reads as a continuation of the site, not a chrome bar.
   * Private tabs keep the private theme untinted. */
  function applyStripTint(tab) {
    // A theme handoff invalidates the previous website sample. Ignore any
    // stale tabs:updated payload still in flight until main clears/resamples it.
    const tint = (!themeHandoffPending && !tab?.private && (tab?.pageBg || tab?.themeColor)) || null;
    if (!tint) {
      // Private keeps its dedicated token scope. For ordinary tabs, paint the
      // newly selected theme immediately instead of waiting for Electron to
      // propagate prefers-color-scheme into this renderer.
      const optimisticBg = tab?.private
        ? 'var(--bg)'
        : ({ light: '#ffffff', dark: '#0e0e0e' }[pendingThemeAppearance] ?? 'var(--bg)');
      // The normal strip transition is for site-to-site faux-header changes.
      // A theme preview should land in this interaction frame, not animate
      // for another 160ms after the command has already completed.
      stripEl.classList.toggle('theme-optimistic', !tab?.private && themeHandoffPending);
      stripEl.style.setProperty('--page-bg', optimisticBg);
      // On Windows/Linux the window controls use the current theme tokens.
      // Keep their dark-background treatment in step with the early strip
      // paint while those tokens are still catching up.
      stripEl.classList.toggle('tint-dark', pendingThemeAppearance === 'dark');
      return;
    }
    stripEl.classList.remove('theme-optimistic');
    stripEl.style.setProperty('--page-bg', tint);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16));
    stripEl.classList.toggle('tint-dark', 0.299 * r + 0.587 * g + 0.114 * b < 128);
  }

  function themeAppearanceMatchesMedia(appearance) {
    return darkSchemeQuery.matches === (appearance === 'dark');
  }

  function releaseOptimisticThemeAppearance() {
    if (!pendingThemeAppearance || !themeAppearanceMatchesMedia(pendingThemeAppearance)) return;
    pendingThemeAppearance = null;
    themeHandoffPending = false;
    applyStripTint(activeTab());
  }

  window.browserAPI.onThemeAppearance((appearance) => {
    if (appearance === 'pending') {
      // "System" cannot be resolved until main removes an explicit override.
      // Disable the strip transition now; a resolved appearance follows.
      pendingThemeAppearance = null;
      themeHandoffPending = true;
      applyStripTint(activeTab());
      return;
    }
    if (appearance !== 'light' && appearance !== 'dark') return;
    // If Chromium won the race, use the tokenized CSS immediately. Otherwise
    // bridge only the gap until matchMedia's change event below releases it.
    pendingThemeAppearance = themeAppearanceMatchesMedia(appearance) ? null : appearance;
    themeHandoffPending = !!pendingThemeAppearance;
    applyStripTint(activeTab());
  });
  darkSchemeQuery.addEventListener('change', releaseOptimisticThemeAppearance);

  const DOT_CAP = 8;

  /** Dots for the pill: the ACTIVE tab's group only (null groupId = the
   * ungrouped set). Grouped pins stay in that group and lead its dots; the
   * standalone pinned shelf remains only for ungrouped pins. Capped at
   * DOT_CAP with a trailing "+k" that opens the panel; the window slides only
   * when needed to keep the active dot visible. The pill deliberately does
   * NOT map other groups — that lives in ⌘L. */
  /** The windowed dot set: which tabs get a dot, and how many overflow into
   * the trailing "+k". Shared by the node builder and the render-skip
   * signature so the two never disagree. */
  function activeGroupMembers() {
    const tab = activeTab();
    if (!tab) return { shown: [], hidden: 0 };
    const g = tab.groupId ?? null;
    const members = state.tabs
      .filter((t) => (
        (t.groupId ?? null) === g &&
        (g !== null || !t.pinned || t.id === state.activeTabId)
      ))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned));
    if (members.length <= DOT_CAP) return { shown: members, hidden: 0 };

    const activeIdx = Math.max(0, members.indexOf(tab));
    const start = activeIdx < DOT_CAP ? 0 : Math.min(activeIdx - (DOT_CAP - 1), members.length - DOT_CAP);
    return { shown: members.slice(start, start + DOT_CAP), hidden: members.length - DOT_CAP };
  }

  function activeGroupDots() {
    const { shown, hidden } = activeGroupMembers();
    const nodes = shown.map(tabDot);
    if (hidden > 0) {
      const more = document.createElement('button');
      more.className = 'pill-overflow';
      more.textContent = `+${hidden}`;
      more.title = `${hidden} more ${hidden === 1 ? 'tab' : 'tabs'} in this group — open the list`;
      more.setAttribute('aria-label', more.title);
      more.addEventListener('click', (e) => { e.stopPropagation(); window.browserAPI.openIsland(); });
      nodes.push(more);
    }
    return nodes;
  }

  /** Everything the dot row's DOM depends on, as a string. Deliberately omits
   * blockedCount (the shield owns it): tab loads emit ~10 tabs:updated/s that
   * only bump blocked counts, and rebuilding the row on each would restart a
   * hovered peek's reveal and drop keyboard focus off a focused dot. */
  function dotsSignature() {
    const { shown, hidden } = activeGroupMembers();
    return JSON.stringify({
      shown: shown.map((t) => ({
        id: t.id,
        active: t.id === state.activeTabId,
        loading: t.isLoading,
        private: t.private,
        title: t.title || 'New Tab',
        // While loading, setFavicon deliberately ignores both URL and favicon;
        // omit them here too so an irrelevant favicon event cannot churn the
        // row before the loading state changes.
        favicon: t.isLoading
          ? 'loading'
          : t.url?.startsWith('blanc://')
            ? 'internal'
            : t.favicon || 'fallback',
      })),
      hidden,
    });
  }
  let lastDotsSig = null;

  function tabDot(t) {
    const dot = document.createElement('button');
    dot.className =
      'island-dot' +
      (t.id === state.activeTabId ? ' active' : '') +
      (t.isLoading ? ' loading' : '') +
      (t.private ? ' private' : '');
    dot.title = t.title || 'New Tab';
    dot.setAttribute('aria-label', `Switch to ${t.title || 'New Tab'}`);
    // Hover/focus peek: the dot blooms into its tab's favicon so you can tell
    // which site it holds before switching. Reuses the pill favicon rendering
    // (has-icon / internal / loading / fallback); the native title tooltip
    // still carries the exact page title a beat later.
    const peek = document.createElement('span');
    setFavicon(peek, t, 'dot-peek favicon');
    dot.appendChild(peek);
    dot.addEventListener('click', (e) => {
      e.stopPropagation(); // switch without expanding
      window.browserAPI.switchTab(t.id);
    });
    return dot;
  }

  function render() {
    const tab = activeTab();

    backBtn.disabled = !tab?.canGoBack;
    forwardBtn.disabled = !tab?.canGoForward;
    const reloadMode = tab?.isLoading ? 'stop' : 'reload';
    if (reloadBtn.dataset.mode !== reloadMode) {
      reloadBtn.dataset.mode = reloadMode;
      reloadBtn.innerHTML = PILL_ICONS[reloadMode];
      reloadBtn.title = reloadMode === 'stop' ? 'Stop' : 'Reload';
    }
    // Favorites only apply to real web pages (blanc:// and private tabs are
    // no-ops in main), so mirror the overlay and disable the heart otherwise.
    const favoritable = /^https?:\/\//.test(tab?.url || '');
    favoriteBtn.disabled = !favoritable;
    favoriteBtn.classList.toggle('on', favoritable && !!tab?.bookmarked);
    favoriteBtn.title = tab?.bookmarked ? 'Remove favorite' : 'Favorite this page';

    // Only rebuild the dot row when the dots themselves change — not on every
    // blocked-count broadcast (see dotsSignature). Rebuilding tears down each
    // dot's peek span and any keyboard focus on it.
    const dotsSig = dotsSignature();
    if (dotsSig !== lastDotsSig) {
      lastDotsSig = dotsSig;
      pillDots.replaceChildren(...activeGroupDots());
    }

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
  window.browserAPI.onDownloadsActivity((payload) => {
    downloadState = payload;
    renderDownloads();
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
