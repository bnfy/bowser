// Renderer for the overlay WebContentsView — the island's expanded states,
// floating over web content: the command bar ('panel', anchored where the
// pill sits), the summoned palette ('palette', centered over a scrim), and
// the find-in-page capsule ('find', tight bounds set by main).
(() => {
  const { platform } = window.browserAPI;
  const isMac = platform === 'darwin';
  const modKey = isMac ? '⌘' : 'ctrl+';
  const modShiftKey = isMac ? '⌘⇧' : 'ctrl+shift+';

  const backdrop = document.getElementById('backdrop');
  const panelAnchor = document.getElementById('panelAnchor');
  const addressInput = document.getElementById('addressInput');
  const panelInsecure = document.getElementById('panelInsecure');
  const islandList = document.getElementById('islandList');
  const islandHint = document.getElementById('islandHint');
  const backBtn = document.getElementById('backBtn');
  const fwdBtn = document.getElementById('fwdBtn');
  const reloadBtn = document.getElementById('reloadBtn');
  const heartBtn = document.getElementById('heartBtn');
  const dismissBtn = document.getElementById('dismissBtn');
  const findBar = document.getElementById('findBar');
  const findInput = document.getElementById('findInput');
  const findCount = document.getElementById('findCount');
  const findPrevBtn = document.getElementById('findPrevBtn');
  const findNextBtn = document.getElementById('findNextBtn');
  const findCloseBtn = document.getElementById('findCloseBtn');
  const footerNewTab = document.getElementById('footerNewTab');
  const footerNewPrivate = document.getElementById('footerNewPrivate');
  const footerFavorites = document.getElementById('footerFavorites');
  const footerHistory = document.getElementById('footerHistory');
  const footerDownloads = document.getElementById('footerDownloads');
  const footerSettings = document.getElementById('footerSettings');

  let state = { tabs: [], activeTabId: null, groups: [] };
  /** @type {null | 'panel' | 'palette' | 'find'} */
  let mode = null;
  /** Tab id whose inline group picker ("→ work · → none") is open. */
  let pickingTabId = null;
  /** After a picker action re-renders the list, put focus back on that
   * tab's "group" chip instead of dropping it on <body>. */
  let chipFocusTabId = null;

  function focusChip(tabId) {
    islandList.querySelector(`.island-row[data-tab-id="${CSS.escape(tabId)}"] .row-grp`)?.focus();
  }
  // The address input's value is only ours to overwrite while untouched;
  // once the user types, incoming tab updates must not clobber it.
  let inputTouched = false;
  let findLastQuery = null;
  // Quick Switcher corpora, refreshed each time the panel opens.
  let favorites = [];
  let historyEntries = [];
  // Other devices' tab snapshots (tab sync). Renderer-local fold state —
  // devices start folded so the panel stays quiet (spec §2).
  let remoteDevices = [];
  const unfoldedDevices = new Set();
  // What Enter acts on — rebuilt on every list render.
  let visibleCommands = [];
  let visibleResults = [];
  // Search-engine autocomplete is best-effort and asynchronous. The query
  // token plus request generation prevent late responses from repainting a
  // newer query (or a panel that was closed and reopened).
  let providerSuggestions = [];
  let providerSuggestionQuery = '';
  let searchProviderId = null;
  let searchProviderLabel = 'search';
  let suggestionDebounce = null;
  let suggestionRequestGeneration = 0;
  let addressInputComposing = false;
  // A paste/drop or text entered while a private tab is active can contain
  // credentials or private prose. Once detected, keep provider autocomplete
  // off for that edit session; Enter still submits the value normally.
  let suppressProviderSuggestions = false;
  // -1 means no explicit ArrowUp/ArrowDown choice; renderList still highlights
  // the result that bare Enter would choose.
  let selectedResultIndex = -1;

  const ICONS = {
    reload: '<svg viewBox="0 0 16 16"><path d="M12.42 10.35a5 5 0 1 1-4.42-7.35c1.4 0 2.74.56 3.74 1.53L13 5.78"/><path d="M13 3v2.78h-2.78"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5"/></svg>',
    pin: '<svg viewBox="0 0 16 16"><path d="M5 3h6l-1 5 2 2v1H4v-1l2-2z"/><path d="M8 11v3"/></svg>',
    mute: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3.5v11L5 10H2z"/><path d="M11 5.5l3 5M14 5.5l-3 5"/></svg>',
    search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3 3"/></svg>',
  };
  reloadBtn.innerHTML = ICONS.reload;

  function activeTab() {
    return state.tabs.find((t) => t.id === state.activeTabId) || null;
  }

  const groupById = (id) => state.groups.find((g) => g.id === id) || null;

  /** Cluster order: each non-empty group in group order, then ungrouped,
   * unpinned tabs. Pins lead their named group; only ungrouped pins use the
   * standalone shelf. (Keep in sync with main.js.) */
  function clusterTabs() {
    const clusters = [];
    for (const g of state.groups) {
      const gtabs = state.tabs
        .filter((t) => t.groupId === g.id)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned));
      if (gtabs.length) clusters.push({ group: g, tabs: gtabs });
    }
    const loose = state.tabs.filter((t) => !t.groupId && !t.pinned);
    if (loose.length) clusters.push({ group: null, tabs: loose });
    return clusters;
  }

  function miniDotCluster(count, accented) {
    const cluster = document.createElement('span');
    cluster.className = 'row-cluster';
    for (let i = 0; i < count; i++) {
      const mini = document.createElement('span');
      mini.className = 'dot-mini' + (accented ? ' accent' : '');
      cluster.append(mini);
    }
    return cluster;
  }

  const isFavoritable = (url) => /^https?:\/\//.test(url || '');

  function addressDisplayValue(tab) {
    if (!tab) return '';
    if (tab.url.startsWith('blanc://newtab') || tab.url.startsWith('file://')) return '';
    // The error page carries the failed URL in its query — show that, so
    // the user sees (and can edit/retry) the address they typed.
    if (tab.url.startsWith('blanc://error')) {
      try {
        return new URL(tab.url).searchParams.get('url') || tab.url;
      } catch {
        return tab.url;
      }
    }
    return tab.url;
  }

  /** Warning-only security check: true just for plain HTTP to a non-loopback
   * host — https, blanc:, file:, and local dev servers show no indicator.
   * (Keep in sync with renderer.js.) */
  function connectionInsecure(url) {
    if (!url?.startsWith('http://')) return false;
    try {
      const host = new URL(url).hostname;
      return !(host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '[::1]');
    } catch {
      return false;
    }
  }

  /** Short label for a tab's location: host for web pages (sans the noise
   * "www." carries in a list this dense), page name for internal ones,
   * empty for a blank new tab. */
  function tabDomain(tab) {
    if (!tab?.url || tab.url.startsWith('blanc://newtab')) return '';
    try {
      const u = new URL(tab.url);
      return u.protocol === 'blanc:' ? `blanc://${u.host}` : u.host.replace(/^www\./, '');
    } catch {
      return tab.url;
    }
  }

  // `base` kept for parity with renderer.js's twin (the dot-peek reuses it
  // there); the overlay only ever needs the default. Keep the two in sync.
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

  // --- Panel rendering ---

  function renderPanelChrome() {
    const tab = activeTab();
    backBtn.disabled = !tab?.canGoBack;
    fwdBtn.disabled = !tab?.canGoForward;
    const wantStop = !!tab?.isLoading;
    if (reloadBtn.dataset.mode !== (wantStop ? 'stop' : 'reload')) {
      reloadBtn.dataset.mode = wantStop ? 'stop' : 'reload';
      reloadBtn.innerHTML = wantStop ? ICONS.stop : ICONS.reload;
      reloadBtn.title = wantStop ? 'Stop' : 'Reload';
    }
    heartBtn.disabled = !tab || !isFavoritable(tab.url);
    heartBtn.classList.toggle('favorited', !!tab?.bookmarked);
    heartBtn.title = tab?.bookmarked ? 'Remove favorite' : 'Favorite this page (Ctrl/Cmd+D)';
    panelInsecure.hidden = !tab || tab.isLoading || !connectionInsecure(tab.url);
  }

  function tabRow(tab) {
    const row = document.createElement('div');
    // .tab-row scopes the at-rest quieting (metadata joins the hover/focus
    // reveal) to list rows — Quick-Switcher/command rows keep their subs.
    row.className = 'island-row tab-row' + (tab.id === state.activeTabId ? ' active' : '');
    row.dataset.tabId = tab.id;

    const faviconWrap = document.createElement('span');
    faviconWrap.className = 'row-favicon-wrap';
    const favicon = document.createElement('span');
    setFavicon(favicon, tab);
    faviconWrap.append(favicon);
    if (tab.muted) {
      const muteBadge = document.createElement('span');
      muteBadge.className = 'row-mute-badge';
      muteBadge.innerHTML = ICONS.mute;
      faviconWrap.append(muteBadge);
    }

    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = tab.isLoading ? 'Loading…' : tab.title || 'New Tab';
    if (tab.title) title.title = tab.title;

    const sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = tabDomain(tab);

    row.append(faviconWrap, title, sub);

    if (tab.private) {
      const tag = document.createElement('span');
      tag.className = 'row-private';
      tag.textContent = 'private';
      row.append(tag);
    }

    const pin = document.createElement('button');
    pin.className = 'row-pin' + (tab.pinned ? ' on' : '');
    pin.title = tab.pinned ? 'Unpin tab' : 'Pin tab';
    pin.setAttribute('aria-label', pin.title);
    pin.innerHTML = ICONS.pin;
    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      window.browserAPI.toggleTabPinned(tab.id);
    });
    row.append(pin);

    if (tab.audible || tab.muted) {
      const mute = document.createElement('button');
      mute.className = 'row-mute' + (tab.muted ? ' on' : '');
      mute.title = tab.muted ? 'Unmute tab' : 'Mute tab';
      mute.setAttribute('aria-label', mute.title);
      mute.innerHTML = ICONS.mute;
      mute.addEventListener('click', (e) => {
        e.stopPropagation();
        window.browserAPI.toggleTabMuted(tab.id);
      });
      row.append(mute);
    }

    const grp = document.createElement('button');
    grp.className = 'row-grp';
    grp.title = 'Move to group';
    grp.textContent = tab.groupId ? groupById(tab.groupId)?.name ?? 'group' : 'group';
    grp.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = pickingTabId !== tab.id;
      pickingTabId = opening ? tab.id : null;
      renderList();
      // Opening hands focus to the name field so a fresh group is one
      // type-and-Enter away; closing puts it back on the re-rendered chip
      // (the click had focused the old one, now replaced).
      if (opening) islandList.querySelector('.group-picker-input')?.focus();
      else focusChip(tab.id);
    });
    row.append(grp);

    const close = document.createElement('button');
    close.className = 'row-close';
    close.title = 'Close tab';
    close.setAttribute('aria-label', 'Close tab');
    close.innerHTML = ICONS.close;
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      window.browserAPI.closeTab(tab.id);
    });
    row.append(close);

    // Inline picker: move to another existing group, or out of the current
    // one. New groups come from the /group command.
    if (pickingTabId === tab.id) {
      const picker = document.createElement('span');
      picker.className = 'group-picker';
      picker.addEventListener('click', (e) => e.stopPropagation());
      for (const g of state.groups.filter((g) => g.id !== tab.groupId)) {
        const btn = document.createElement('button');
        btn.className = 'row-grp open';
        btn.textContent = `→ ${g.name}`;
        btn.addEventListener('click', () => {
          pickingTabId = null;
          chipFocusTabId = tab.id;
          window.browserAPI.setTabGroup(tab.id, g.id);
        });
        picker.append(btn);
      }
      if (tab.groupId) {
        const none = document.createElement('button');
        none.className = 'row-grp open';
        none.textContent = '→ none';
        none.addEventListener('click', () => {
          pickingTabId = null;
          chipFocusTabId = tab.id;
          window.browserAPI.setTabGroup(tab.id, null);
        });
        picker.append(none);
      }
      // First-group creation lives here too, not just behind /group: name
      // a new group inline and Enter moves the tab into it.
      const create = document.createElement('input');
      create.className = 'group-picker-input';
      create.placeholder = 'new group…';
      create.spellcheck = false;
      create.autocomplete = 'off';
      create.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const name = create.value.trim();
          if (!name) return;
          pickingTabId = null;
          chipFocusTabId = tab.id;
          window.browserAPI.groupTabByName(tab.id, name);
        }
        // Typed keys must not reach the row/overlay handlers.
        e.stopPropagation();
      });
      picker.append(create);
      row.append(picker);
    }

    row.addEventListener('click', () => {
      window.browserAPI.switchTab(tab.id);
      window.browserAPI.closeOverlay();
    });
    row.addEventListener('auxclick', (e) => {
      if (e.button === 1) window.browserAPI.closeTab(tab.id); // middle-click closes
    });
    return row;
  }

  const CARET = '<svg class="caret" viewBox="0 0 10 10"><path d="M3.5 2 L7 5 L3.5 8"/></svg>';

  /** "pinned" section header for pins without a named group — same dim-rule
   * visual language as a group header, but static. */
  function pinnedHeaderRow(count) {
    const row = document.createElement('div');
    row.className = 'island-ghead static';
    const name = document.createElement('span');
    name.className = 'ghead-name';
    name.textContent = 'pinned';
    const rule = document.createElement('span');
    rule.className = 'ghead-rule';
    const n = document.createElement('span');
    n.className = 'ghead-n';
    n.textContent = String(count);
    row.append(name, rule, n);
    return row;
  }

  /** "work — 3 ————— ⌘1": click folds/unfolds the group. */
  function groupHeaderRow(group, count, clusterIndex) {
    const row = document.createElement('div');
    row.className = 'island-ghead';
    row.innerHTML = `${CARET}<span class="ghead-name"></span><span class="ghead-n"></span><span class="ghead-rule"></span><span class="ghead-n">${modKey}${clusterIndex + 1}</span>`;
    row.querySelector('.caret').classList.toggle('open', !group.collapsed);
    row.querySelector('.ghead-name').textContent = group.name;
    row.querySelectorAll('.ghead-n')[0].textContent = String(count);
    row.title = group.collapsed ? 'Unfold group' : 'Fold group';
    row.addEventListener('click', () => window.browserAPI.toggleGroupCollapsed(group.id));
    return row;
  }

  /** Dim header above the trailing ungrouped tabs (only when groups exist). */
  function looseHeaderRow() {
    const row = document.createElement('div');
    row.className = 'island-ghead static';
    row.innerHTML = '<span class="ghead-spacer"></span><span class="ghead-name dim">no group</span><span class="ghead-rule"></span>';
    return row;
  }

  /** Collapsed group's stand-in row: mini-dots + "N tabs tucked away". */
  function foldedGroupRow(group, gtabs) {
    const row = document.createElement('div');
    row.className = 'island-row folded-row';
    const label = document.createElement('span');
    label.className = 'row-folded-label';
    label.textContent = `${gtabs.length} ${gtabs.length === 1 ? 'tab' : 'tabs'} tucked away`;
    const hint = document.createElement('span');
    hint.className = 'row-kbd';
    hint.textContent = 'click to unfold';
    row.append(miniDotCluster(Math.min(gtabs.length, 5), false), label, hint);
    row.addEventListener('click', () => window.browserAPI.toggleGroupCollapsed(group.id));
    return row;
  }

  // --- Remote devices (tab sync) ---

  const hostOfUrl = (url) => {
    try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
  };

  function timeAgo(ts) {
    const mins = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  /** Remote presentation mirrors clusterList() (main.js): each group in
   * group order with its pins leading, then loose tabs (pins first) —
   * snapshot order preserved within each cluster (spec §2). */
  function clusterRemoteTabs(device) {
    const rows = [];
    for (const g of device.groups) {
      const members = device.tabs.filter((t) => t.groupId === g.id);
      rows.push(...members.filter((t) => t.pinned), ...members.filter((t) => !t.pinned));
    }
    const loose = device.tabs.filter((t) => !device.groups.some((g) => g.id === t.groupId));
    rows.push(...loose.filter((t) => t.pinned), ...loose.filter((t) => !t.pinned));
    return rows;
  }

  /** "MacBook Air · 5 ——— 2h ago": click folds/unfolds. */
  function remoteHeaderRow(device) {
    const row = document.createElement('div');
    row.className = 'island-ghead';
    const open = unfoldedDevices.has(device.deviceId);
    row.innerHTML = `${CARET}<span class="ghead-name"></span><span class="ghead-n"></span><span class="ghead-rule"></span><span class="ghead-n"></span>`;
    row.querySelector('.caret').classList.toggle('open', open);
    row.querySelector('.ghead-name').textContent = device.name;
    const ns = row.querySelectorAll('.ghead-n');
    ns[0].textContent = String(device.tabs.length);
    ns[1].textContent = timeAgo(device.updatedAt);
    row.title = open ? 'Fold device' : 'Unfold device';
    row.addEventListener('click', () => {
      if (open) unfoldedDevices.delete(device.deviceId);
      else unfoldedDevices.add(device.deviceId);
      renderList();
    });
    return row;
  }

  /** A remote tab row: opens the url as a plain new local tab (ungrouped —
   * no group reconstruction in v1, spec §2). */
  function remoteTabRow(tab, device) {
    const row = document.createElement('div');
    row.className = 'island-row tab-row';
    const favicon = document.createElement('span');
    setFavicon(favicon, tab);
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = tab.title || tab.url;
    if (tab.title) title.title = tab.title;
    const sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = hostOfUrl(tab.url);
    row.append(favicon, title, sub);
    if (tab.pinned) {
      const pin = document.createElement('span');
      pin.className = 'row-remote-pin';
      pin.innerHTML = ICONS.pin;
      row.append(pin);
    }
    const g = device.groups.find((x) => x.id === tab.groupId);
    if (g) {
      const tag = document.createElement('span');
      tag.className = 'row-tag';
      tag.textContent = g.name;
      row.append(tag);
    }
    row.addEventListener('click', () => {
      window.browserAPI.createTab(tab.url, { focusAddress: false });
      window.browserAPI.closeOverlay();
    });
    return row;
  }

  // --- Slash commands ---

  const COMMANDS = [
    // Also listed on blanc://shortcuts/ — update SLASH_COMMANDS in
    // pages/shortcuts.js when adding or changing a command here.
    { cmd: '/favorites', hint: 'Open favorites', run: () => window.browserAPI.openPage('bookmarks') },
    { cmd: '/save', hint: 'Save this page to favorites — name a folder to file it', run: (input) => {
      const folder = (input ?? '').replace(/^\/save\s*/, '').trim();
      window.browserAPI.saveFavorite(folder || null);
    } },
    { cmd: '/history', hint: 'Open browsing history', run: () => window.browserAPI.openPage('history') },
    { cmd: '/downloads', hint: 'Open downloads', run: () => window.browserAPI.openPage('downloads') },
    { cmd: '/settings', hint: 'Open settings', run: () => window.browserAPI.openPage('settings') },
    { cmd: '/clear', hint: 'Clear browsing history', run: () => window.browserAPI.clearHistory() },
    { cmd: '/new', hint: 'Open a new tab', run: () => window.browserAPI.createTab(null, { focusAddress: false }) },
    { cmd: '/private', hint: 'Open a private tab (history stays untouched)', run: () => window.browserAPI.createTab(null, { private: true, focusAddress: false }) },
    { cmd: '/close', hint: 'Close this tab', run: () => state.activeTabId && window.browserAPI.closeTab(state.activeTabId) },
    { cmd: '/pin', hint: 'Pin or unpin this tab', run: () => state.activeTabId && window.browserAPI.toggleTabPinned(state.activeTabId) },
    { cmd: '/mute', hint: 'Mute or unmute this tab', run: () => state.activeTabId && window.browserAPI.toggleTabMuted(state.activeTabId) },
    { cmd: '/group', hint: 'Type a space, then a group name — e.g. "work"', run: (input) => {
      const name = (input ?? '').replace(/^\/group\s*/, '').trim();
      if (name && state.activeTabId) window.browserAPI.groupTabByName(state.activeTabId, name);
    } },
    { cmd: '/ungroup', hint: 'Take this tab out of its group', run: () => state.activeTabId && window.browserAPI.setTabGroup(state.activeTabId, null) },
    { cmd: '/close-group', hint: 'Close every tab in this group', run: () => {
      const groupId = activeTab()?.groupId;
      if (groupId) window.browserAPI.closeGroup(groupId);
    } },
    { cmd: '/find', hint: 'Find in page', run: () => window.browserAPI.openFindBar(), keepOverlay: true },
    { cmd: '/block-ads', hint: 'Toggle ad & tracker blocking', run: () => window.browserAPI.toggleAdblock() },
    { cmd: '/allow-ads', hint: 'Allow ads on this site', run: () => window.browserAPI.allowAdsOnActiveSite() },
    { cmd: '/theme', hint: 'Cycle appearance, or choose system / light / dark', run: (input) => {
      const requested = (input ?? '').replace(/^\/theme\s*/, '').trim();
      window.browserAPI.cycleTheme(requested || null);
    } },
  ];

  function runCommand(command) {
    // Commands like "/group work" read their argument from the typed input.
    const input = addressInput.value;
    // Close first: commands that open something (a page, a fresh tab) rely
    // on main re-showing the overlay in a clean state where needed.
    if (!command.keepOverlay) window.browserAPI.closeOverlay();
    command.run(input);
  }

  function commandRow(command, isTop) {
    const row = document.createElement('div');
    row.className = 'island-row' + (isTop ? ' active' : '');

    const name = document.createElement('span');
    name.className = 'row-cmd';
    name.textContent = command.cmd;

    const hint = document.createElement('span');
    hint.className = 'row-hint';
    hint.textContent = command.hint;

    row.append(name, hint);
    if (isTop) row.append(enterGlyph());
    row.addEventListener('click', () => runCommand(command));
    return row;
  }

  function enterGlyph() {
    const enter = document.createElement('span');
    enter.className = 'row-enter';
    enter.textContent = '↵';
    return enter;
  }

  function emptyRow(text) {
    const empty = document.createElement('div');
    empty.className = 'island-empty';
    empty.textContent = text;
    return empty;
  }

  // --- Quick Switcher ---

  /** Loose matching: substring beats in-order character match; anything
   * else is out. */
  function matchScore(query, text) {
    const t = text.toLowerCase();
    if (t.includes(query)) return 2;
    let i = 0;
    for (const ch of t) {
      if (ch === query[i]) i++;
      if (i === query.length) return 1;
    }
    return 0;
  }

  /** matchScore's genuine-substring tier — the only one confident enough
   * to auto-navigate on bare Enter. The loose in-order fallback (score 1)
   * is too permissive: a long-lived history entry can in-order-match
   * almost any query sharing a few letters, once silently hijacking Enter
   * away from whatever was actually typed. Kind bonuses (below) top out at
   * +0.3, so they can never lift a weak match up to this tier. */
  const STRONG_MATCH_SCORE = 2;

  /** What a candidate is matched against: title + host + a capped path.
   * Query strings and fragments are deliberately excluded — OAuth/token
   * URLs carry kilobytes of base64 that in-order-matches almost any
   * typed query, which turned one dead Google consent URL in history
   * into the top "result" for every address typed. */
  function matchableText(title, url) {
    try {
      const u = new URL(url || '');
      return `${title || ''} ${u.host}${u.pathname.slice(0, 64)}`;
    } catch {
      return `${title || ''} ${(url || '').slice(0, 100)}`;
    }
  }

  const stripUrl = (u) => (u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

  /** True when the typed text is a real navigation target rather than a search
   * query — mirrors the navigate branches of normalizeAddressInput (main.js)
   * and the HANDOFF_PROTOCOLS allowlist (external-protocols.js). When it's an
   * address, bare Enter navigates instead of letting a Quick-Switcher match
   * hijack it — a tab whose *title* merely contains "getbowser.com" must not
   * steal Enter away from actually opening getbowser.com. Kept in hand-sync
   * with those sources.
   *
   * Main can also navigate existing local .htm/.html/.xhtml paths. The
   * extension guard below intentionally errs on the private side even though
   * this sandboxed renderer cannot check whether a whitespace-bearing path
   * actually exists. */
  function looksLikeAddress(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return false;
    const scheme = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)?.[1]?.toLowerCase();
    if (scheme) return !['javascript', 'data', 'vbscript'].includes(scheme);
    if (/^(mailto|tel|facetime|sms):/i.test(trimmed)) return true;       // OS-handoff URIs (no "://")
    if (/^(?:\.{1,2}[\\/]|~[\\/]|[a-z]:[\\/])/i.test(trimmed)) return true;
    if (/\.(?:x?html?)(?:[?#].*)?$/i.test(trimmed)) return true;
    if (/^localhost(:\d+)?([/?#]|$)/.test(trimmed)) return true;
    if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?([/?#]|$)/.test(trimmed)) return true; // bare IPv4
    if (/^\[[0-9a-z:.%_-]+\](?::\d+)?([/?#]|$)/i.test(trimmed)) return true;
    if (/^[0-9a-f]*:[0-9a-f:]+([/?#]|$)/i.test(trimmed)) return true;
    return /^(?!\.)[^\s./?#:]+(?:\.[^\s./?#:]+)+(?::\d+)?([/?#][^\s]*)?$/u.test(trimmed);
  }

  function switcherResults(query) {
    const results = [];
    // Group names rank above their member tabs — "wor" jumps to the whole
    // work cluster, not one tab in it.
    for (const g of state.groups) {
      const count = state.tabs.filter((t) => t.groupId === g.id).length;
      if (!count) continue;
      const s = matchScore(query, g.name);
      if (s) results.push({ kind: 'group', title: g.name, sub: `${count} ${count === 1 ? 'tab' : 'tabs'}`, group: g, count, score: s + 0.3 });
    }
    for (const t of state.tabs) {
      const s = matchScore(query, matchableText(t.title, t.url));
      if (s) results.push({ kind: 'tab', title: t.title || 'New Tab', sub: tabDomain(t), tab: t, score: s + 0.2 });
    }
    for (const f of favorites) {
      const s = matchScore(query, matchableText(f.title, f.url));
      if (s) results.push({ kind: 'favorite', title: f.title, sub: stripUrl(f.url), url: f.url, score: s + 0.1 });
    }
    // Remote tabs rank below local tabs (+0.2) and favorites (+0.1), above
    // history (+0) — spec §2. The url-keyed dedup below keeps the
    // higher-ranked favorite row when both match.
    for (const device of remoteDevices) {
      for (const t of device.tabs) {
        const s = matchScore(query, matchableText(t.title, t.url));
        if (s) results.push({ kind: 'remote', title: t.title || t.url, sub: `${hostOfUrl(t.url)} · ${device.name}`, url: t.url, tab: t, score: s + 0.05 });
      }
    }
    for (const h of historyEntries) {
      const s = matchScore(query, matchableText(h.title, h.url));
      if (s) results.push({ kind: 'history', title: h.title, sub: stripUrl(h.url), url: h.url, score: s });
    }
    const seen = new Set();
    return results
      .sort((a, b) => b.score - a.score)
      .filter((r) => {
        const key = r.kind === 'tab' ? `tab:${r.tab.id}` : r.kind === 'group' ? `group:${r.group.id}` : r.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }

  function searchResults(query) {
    const results = [{
      kind: 'search',
      title: query,
      query,
      // The exact text is a fresh submission, so main must resolve it against
      // the default engine at click/Enter time. Completions retain provider
      // provenance for their label, but main rejects stale routing metadata.
      providerId: null,
      providerLabel: searchProviderLabel,
      exact: true,
    }];
    if (providerSuggestionQuery.toLowerCase() !== query.toLowerCase()) return results;
    const seen = new Set([query.toLowerCase()]);
    for (const suggestion of providerSuggestions) {
      const key = suggestion.toLowerCase();
      if (!suggestion || seen.has(key)) continue;
      seen.add(key);
      results.push({
        kind: 'search',
        title: suggestion,
        query: suggestion,
        providerId: searchProviderId,
        providerLabel: searchProviderLabel,
        exact: false,
      });
    }
    return results;
  }

  /** Keep six rows total. A confident local match retains the established
   * Quick-Switcher top slot; otherwise exact search leads, followed by engine
   * completions and then the weaker local guesses. */
  function blendedResults(query) {
    const local = switcherResults(query.toLowerCase());
    const search = searchResults(query);
    if (local[0]?.score >= STRONG_MATCH_SCORE) {
      return [
        ...local.slice(0, 3),
        ...search.slice(0, 3),
        // Provider suggestions are optional. Let additional local matches fill
        // any of their unused slots instead of leaving the six-row list short.
        ...local.slice(3),
        ...search.slice(3),
      ].slice(0, 6);
    }
    return [
      ...search.slice(0, 4),
      ...local.slice(0, 2),
      // Private/pasted/disabled/offline autocomplete normally leaves only the
      // exact-search row, so backfill the remainder from the local switcher.
      ...local.slice(2),
      ...search.slice(4),
    ].slice(0, 6);
  }

  function resultKey(result) {
    if (!result) return '';
    if (result.kind === 'group') return `group:${result.group.id}`;
    if (result.kind === 'tab') return `tab:${result.tab.id}`;
    if (result.kind === 'search') return `search:${result.query.toLowerCase()}`;
    return `${result.kind}:${result.url}`;
  }

  function pickResult(result) {
    if (result.kind === 'group') window.browserAPI.focusGroup(result.group.id);
    else if (result.kind === 'tab') window.browserAPI.switchTab(result.tab.id);
    else if (result.kind === 'remote') window.browserAPI.createTab(result.url, { focusAddress: false });
    else if (result.kind === 'search' && state.activeTabId) {
      window.browserAPI.search(state.activeTabId, result.query, result.providerId);
    }
    else if (state.activeTabId) window.browserAPI.navigate(state.activeTabId, result.url);
    window.browserAPI.closeOverlay();
  }

  // isActive follows either explicit arrow selection or the bare-Enter target.
  // isEnterTarget controls the ↵ glyph separately so it always tells the truth.
  function resultRow(result, isActive, isEnterTarget) {
    const row = document.createElement('div');
    row.className = 'island-row' + (isActive ? ' active' : '');

    // Groups lead with their dot cluster; search completions use a magnifier;
    // every page-like result keeps the shared favicon treatment.
    let leading;
    if (result.kind === 'group') {
      leading = miniDotCluster(Math.min(result.count, 4), true);
    } else if (result.kind === 'search') {
      leading = document.createElement('span');
      leading.className = 'row-search-icon';
      leading.innerHTML = ICONS.search;
    } else {
      leading = document.createElement('span');
      setFavicon(leading, result.tab ?? null);
    }

    const title = document.createElement('span');
    title.className = 'row-title' + (result.kind === 'group' ? ' mono' : '');
    title.textContent = result.title || result.url || '';

    const sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = result.sub || '';

    const tag = document.createElement('span');
    tag.className = 'row-tag';
    tag.textContent = result.kind === 'search' ? result.providerLabel : result.kind;

    row.append(leading, title, sub, tag);
    if (isEnterTarget) row.append(enterGlyph());
    row.addEventListener('click', () => pickResult(result));
    return row;
  }

  // --- List area: tabs at rest, commands on "/", switcher while typing ---

  function renderList() {
    const value = addressInput.value;
    const selectedKey = selectedResultIndex >= 0
      ? resultKey(visibleResults[selectedResultIndex])
      : '';
    visibleCommands = [];
    visibleResults = [];

    if (inputTouched && value.startsWith('/')) {
      selectedResultIndex = -1;
      const slashWord = value.trim().split(/\s+/)[0];
      visibleCommands = COMMANDS.filter((c) => c.cmd.startsWith(slashWord) || slashWord === '/');
      islandList.replaceChildren(
        ...(visibleCommands.length
          ? visibleCommands.map((c, i) => commandRow(c, i === 0))
          : [emptyRow('no matching command')])
      );
    } else if (inputTouched && value.trim()) {
      const query = value.trim();
      // When the input is itself an address, Enter navigates (see the keydown
      // handler), and no provider request/result should see it.
      const enterNavigates = looksLikeAddress(value);
      visibleResults = enterNavigates
        ? switcherResults(query.toLowerCase())
        : blendedResults(query);

      if (selectedKey) {
        selectedResultIndex = visibleResults.findIndex((result) => resultKey(result) === selectedKey);
      } else if (selectedResultIndex >= visibleResults.length) {
        selectedResultIndex = -1;
      }
      const defaultEnterIndex = !enterNavigates
        && visibleResults.length
        && (visibleResults[0].kind === 'search' || visibleResults[0].score >= STRONG_MATCH_SCORE)
        ? 0
        : -1;
      // An address has no implicit result target: leave every row neutral until
      // the user presses an arrow. Search text and strong local matches retain
      // their truthful bare-Enter highlight.
      const activeIndex = selectedResultIndex >= 0 ? selectedResultIndex : defaultEnterIndex;
      const enterIndex = selectedResultIndex >= 0 ? selectedResultIndex : defaultEnterIndex;
      islandList.replaceChildren(
        ...(visibleResults.length
          ? visibleResults.map((r, i) => resultRow(r, i === activeIndex, i === enterIndex))
          : [emptyRow('no matches — ↵ opens as address or search')])
      );
    } else {
      selectedResultIndex = -1;
      // The list re-renders on every tabs:updated broadcast (frequent while
      // any tab is loading) — a half-typed group name must survive that.
      const prevPickerInput = islandList.querySelector('.group-picker-input');
      const pickerValue = prevPickerInput?.value ?? '';
      const pickerHadFocus = prevPickerInput && document.activeElement === prevPickerInput;

      const pinned = state.tabs.filter((t) => t.pinned && !t.groupId);
      const rows = [];
      if (pinned.length) {
        rows.push(pinnedHeaderRow(pinned.length));
        rows.push(...pinned.map(tabRow));
      }

      const clusters = clusterTabs();
      const shortcutOffset = pinned.length ? 1 : 0;
      for (const [clusterIndex, { group, tabs: gtabs }] of clusters.entries()) {
        if (group) rows.push(groupHeaderRow(group, gtabs.length, clusterIndex + shortcutOffset));
        else if (clusters.length > 1) rows.push(looseHeaderRow());
        if (group?.collapsed) rows.push(foldedGroupRow(group, gtabs));
        else rows.push(...gtabs.map(tabRow));
      }
      for (const device of remoteDevices) {
        rows.push(remoteHeaderRow(device));
        if (unfoldedDevices.has(device.deviceId)) {
          rows.push(...clusterRemoteTabs(device).map((t) => remoteTabRow(t, device)));
        }
      }
      islandList.replaceChildren(...rows);

      const pickerInput = islandList.querySelector('.group-picker-input');
      if (pickerInput && pickerValue) pickerInput.value = pickerValue;
      if (pickerInput && pickerHadFocus) pickerInput.focus();

      // A picker action just re-rendered its row away — land focus on the
      // tab's chip rather than <body>. (Only ever set with the picker
      // closed, so it can't fight the input restore above.)
      if (chipFocusTabId) {
        focusChip(chipFocusTabId);
        chipFocusTabId = null;
      }
    }

    islandHint.textContent = activeTab()?.private
      ? 'private · nothing here is saved to history'
      : state.groups.length
        ? `/group moves this tab · ${modKey}1–9 jumps between sections`
        : `${modKey}L summons · / for commands`;
  }

  function renderPanel() {
    // The private theme scope follows the active tab.
    if (activeTab()?.private) document.documentElement.dataset.theme = 'private';
    else delete document.documentElement.dataset.theme;
    renderPanelChrome();
    renderList();
  }

  function resetSearchSuggestions() {
    if (suggestionDebounce) clearTimeout(suggestionDebounce);
    suggestionDebounce = null;
    suggestionRequestGeneration += 1;
    providerSuggestions = [];
    providerSuggestionQuery = '';
    searchProviderId = null;
    searchProviderLabel = 'search';
  }

  function scheduleSearchSuggestions() {
    resetSearchSuggestions();
    const query = addressInput.value.trim();
    // Provider autocomplete is intentionally off in private tabs: typed
    // prefixes stay local until the user explicitly submits a search.
    if (
      !inputTouched
      || query.length < 2
      || query.startsWith('/')
      || looksLikeAddress(query)
      || activeTab()?.private
      || addressInputComposing
      || suppressProviderSuggestions
    ) return;

    const generation = suggestionRequestGeneration;
    suggestionDebounce = setTimeout(async () => {
      suggestionDebounce = null;
      let response;
      try {
        response = await window.browserAPI.searchSuggestions(query);
      } catch {
        return;
      }
      if (
        generation !== suggestionRequestGeneration
        || (mode !== 'panel' && mode !== 'palette')
        || addressInput.value.trim() !== query
        || activeTab()?.private
      ) return;
      searchProviderId = typeof response?.engine === 'string' ? response.engine : null;
      searchProviderLabel = typeof response?.label === 'string' && response.label
        ? response.label
        : 'search';
      providerSuggestionQuery = query;
      providerSuggestions = Array.isArray(response?.suggestions)
        ? response.suggestions.filter((item) => typeof item === 'string')
        : [];
      renderList();
    }, 200);
  }

  // --- Mode switching (driven by main via overlay:show / overlay:hide) ---

  function applyMode(next, prefill) {
    const reshow = mode === next;
    mode = next;
    document.body.dataset.mode = next ?? '';
    backdrop.hidden = next !== 'panel' && next !== 'palette';
    panelAnchor.hidden = next !== 'panel' && next !== 'palette';
    findBar.hidden = next !== 'find';

    if (next === 'panel' || next === 'palette') {
      if (!reshow) {
        pickingTabId = null;
        addressInputComposing = false;
        suppressProviderSuggestions = false;
      }
      if (!reshow) resetSearchSuggestions();
      if (prefill) {
        // A menu-triggered command (e.g. "New Group…") arrives pre-typed —
        // land the cursor at the end, ready to type the rest, rather than
        // selecting the whole string the way a fresh open does below.
        inputTouched = true;
        addressInput.value = prefill;
      } else if (!reshow || !inputTouched) {
        // A reassert (main re-focusing the same open panel) must not
        // clobber what the user already typed.
        inputTouched = false;
        addressInput.value = addressDisplayValue(activeTab());
      }
      refreshSwitcherData();
      renderPanel();
      addressInput.focus();
      if (prefill) addressInput.setSelectionRange(prefill.length, prefill.length);
      else addressInput.select();
    } else if (next === 'find') {
      findInput.focus();
      findInput.select();
    }
  }

  function resetFind() {
    findInput.value = '';
    findCount.textContent = '';
    if (findLastQuery && state.activeTabId) window.browserAPI.stopFindInPage(state.activeTabId);
    findLastQuery = null;
  }

  window.browserAPI.onOverlayShow(({ mode: next, prefill }) => applyMode(next, prefill));
  window.browserAPI.onOverlayHide(() => {
    if (mode === 'find') resetFind();
    mode = null;
    document.body.dataset.mode = '';
    backdrop.hidden = true;
    panelAnchor.hidden = true;
    findBar.hidden = true;
    inputTouched = false;
    addressInputComposing = false;
    suppressProviderSuggestions = false;
    pickingTabId = null;
    chipFocusTabId = null;
    selectedResultIndex = -1;
    resetSearchSuggestions();
  });

  // Click on the backdrop (anywhere outside the panel) dismisses.
  backdrop.addEventListener('mousedown', () => window.browserAPI.closeOverlay());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.browserAPI.closeOverlay();
  });

  // --- Panel wiring ---

  dismissBtn.addEventListener('click', () => window.browserAPI.closeOverlay());
  backBtn.addEventListener('click', () => state.activeTabId && window.browserAPI.goBack(state.activeTabId));
  fwdBtn.addEventListener('click', () => state.activeTabId && window.browserAPI.goForward(state.activeTabId));
  reloadBtn.addEventListener('click', () => {
    if (!state.activeTabId) return;
    activeTab()?.isLoading
      ? window.browserAPI.stop(state.activeTabId)
      : window.browserAPI.reload(state.activeTabId);
  });
  heartBtn.addEventListener('click', () => window.browserAPI.toggleBookmark());

  // --- Footer action bar (static: new tab / private launchers + quick pages) ---
  // These moved out of the scrollable list so they stay put while it shows
  // slash commands or Quick-Switcher results. Platform-correct shortcut hints.
  document.getElementById('footerNewTabKbd').textContent = `${modKey}T`;
  document.getElementById('footerNewPrivateKbd').textContent = `${modShiftKey}N`;
  footerNewTab.title = `New tab (${modKey}T)`;
  footerNewPrivate.title = `New private tab (${modShiftKey}N)`;

  // focusAddress:false keeps the panel closed and lands the user on the fresh
  // tab, rather than main re-summoning the launchpad (its default for ⌘T).
  footerNewTab.addEventListener('click', () => {
    window.browserAPI.closeOverlay();
    window.browserAPI.createTab(null, { focusAddress: false });
  });
  footerNewPrivate.addEventListener('click', () => {
    window.browserAPI.closeOverlay();
    window.browserAPI.createTab(null, { private: true, focusAddress: false });
  });
  // Each shortcut opens its internal page; close first so main can re-show
  // the overlay cleanly where needed (mirrors runCommand for /favorites etc).
  const openPageFromFooter = (name) => {
    window.browserAPI.closeOverlay();
    window.browserAPI.openPage(name);
  };
  footerFavorites.addEventListener('click', () => openPageFromFooter('bookmarks'));
  footerHistory.addEventListener('click', () => openPageFromFooter('history'));
  footerDownloads.addEventListener('click', () => openPageFromFooter('downloads'));
  footerSettings.addEventListener('click', () => openPageFromFooter('settings'));

  addressInput.addEventListener('compositionstart', () => {
    addressInputComposing = true;
    if (activeTab()?.private) suppressProviderSuggestions = true;
    selectedResultIndex = -1;
    resetSearchSuggestions();
    renderList();
  });
  addressInput.addEventListener('compositionend', () => {
    addressInputComposing = false;
    inputTouched = true;
    selectedResultIndex = -1;
    scheduleSearchSuggestions();
    renderList();
  });
  addressInput.addEventListener('input', (e) => {
    inputTouched = true;
    selectedResultIndex = -1;
    if (!addressInput.value.trim()) {
      // Do not clear a paste/drop taint here. Delete followed by Undo restores
      // the original private text with historyUndo, so provider autocomplete
      // must stay off until this overlay edit session ends.
      resetSearchSuggestions();
    } else if (
      activeTab()?.private
      || e.inputType === 'insertFromPaste'
      || e.inputType === 'insertFromDrop'
    ) {
      suppressProviderSuggestions = true;
      resetSearchSuggestions();
    } else if (!e.isComposing && !addressInputComposing) {
      scheduleSearchSuggestions();
    }
    renderList();
  });
  addressInput.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const unmodifiedArrow = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (
      unmodifiedArrow
      && (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      && visibleResults.length
    ) {
      e.preventDefault();
      if (selectedResultIndex < 0) {
        selectedResultIndex = e.key === 'ArrowDown'
          // Search text already highlights its bare-Enter target, so Down moves
          // past it. Address-shaped input has no such target and starts at row 0.
          ? (looksLikeAddress(addressInput.value) ? 0 : Math.min(1, visibleResults.length - 1))
          : visibleResults.length - 1;
      } else {
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        selectedResultIndex = (selectedResultIndex + delta + visibleResults.length) % visibleResults.length;
      }
      renderList();
      return;
    }
    if (e.key !== 'Enter' || e.isComposing) return;
    if (visibleCommands.length) {
      runCommand(visibleCommands[0]);
    } else if (selectedResultIndex >= 0 && visibleResults[selectedResultIndex]) {
      // Arrow navigation is an explicit choice, so it may select a completion,
      // weak local match, or local result while address-shaped text is typed.
      pickResult(visibleResults[selectedResultIndex]);
    } else if (
      visibleResults.length
      && !looksLikeAddress(addressInput.value)
      && (visibleResults[0].kind === 'search' || visibleResults[0].score >= STRONG_MATCH_SCORE)
    ) {
      // A strong switcher match claims Enter — UNLESS what was typed is itself
      // an address (getbowser.com), in which case navigation wins over a tab
      // that merely mentions it. With no strong local match, the exact-query
      // search row leads and preserves normal typed-search behavior.
      pickResult(visibleResults[0]);
    } else if (inputTouched && addressInput.value.startsWith('/')) {
      // "no matching command" — do nothing rather than search for "/typo"
    } else if (state.activeTabId) {
      const value = addressInput.value.trim();
      if (value) window.browserAPI.navigate(state.activeTabId, value);
      window.browserAPI.closeOverlay();
    }
  });

  // --- Find in page ---

  function runFind(options) {
    const query = findInput.value;
    if (!state.activeTabId || !query) {
      findCount.textContent = '';
      return;
    }
    window.browserAPI.findInPage(state.activeTabId, query, options);
    findLastQuery = query;
  }

  // Search live as the user types; Enter/Shift+Enter step through matches.
  findInput.addEventListener('input', () => {
    if (!findInput.value) {
      findCount.textContent = '';
      findLastQuery = null;
      if (state.activeTabId) window.browserAPI.stopFindInPage(state.activeTabId);
      return;
    }
    runFind({ forward: true, findNext: false });
  });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      runFind({ forward: !e.shiftKey, findNext: findInput.value === findLastQuery });
    }
  });
  findPrevBtn.addEventListener('click', () => runFind({ forward: false, findNext: true }));
  findNextBtn.addEventListener('click', () => runFind({ forward: true, findNext: true }));
  findCloseBtn.addEventListener('click', () => window.browserAPI.closeOverlay());

  window.browserAPI.onFindResult(({ activeMatchOrdinal, matches }) => {
    findCount.textContent = matches > 0 && findInput.value ? `${activeMatchOrdinal}/${matches}` : '';
  });

  // --- State sync ---

  async function refreshSwitcherData() {
    [favorites, historyEntries, remoteDevices] = await Promise.all([
      window.browserAPI.listFavorites(),
      window.browserAPI.listHistory({ limit: 300 }),
      window.browserAPI.listRemoteTabs(),
    ]);
    // Data lands after the panel already rendered — refresh it.
    if (mode === 'panel' || mode === 'palette') renderList();
  }

  window.browserAPI.onTabsUpdated((payload) => {
    const activeTabChanged = payload.activeTabId !== state.activeTabId;
    state = payload;
    if (mode === 'panel' || mode === 'palette') {
      if (!inputTouched) addressInput.value = addressDisplayValue(activeTab());
      if (activeTabChanged) {
        selectedResultIndex = -1;
        scheduleSearchSuggestions();
      }
      renderPanel();
    }
  });
  // Cached-first: the panel renders the cache instantly, and this repaints
  // when the panel-open refresh's pull lands (tab sync).
  window.browserAPI.onRemoteTabsUpdated((devices) => {
    remoteDevices = devices;
    if (mode === 'panel' || mode === 'palette') renderList();
  });
  window.browserAPI.getAllTabs().then((payload) => {
    state = payload;
  });
})();
