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
  // What Enter acts on — rebuilt on every list render.
  let visibleCommands = [];
  let visibleResults = [];

  const ICONS = {
    reload: '<svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-5-5c1.4 0 2.74.56 3.74 1.53L13 5.78"/><path d="M13 3v2.78h-2.78"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5"/></svg>',
    plus: '<svg viewBox="0 0 16 16"><path d="M8 3.25v9.5M3.25 8h9.5"/></svg>',
  };
  reloadBtn.innerHTML = ICONS.reload;

  function activeTab() {
    return state.tabs.find((t) => t.id === state.activeTabId) || null;
  }

  const groupById = (id) => state.groups.find((g) => g.id === id) || null;

  /** Cluster order: each non-empty group in group order, then the
   * ungrouped tabs. (Keep in sync with renderer.js.) */
  function clusterTabs() {
    const clusters = [];
    for (const g of state.groups) {
      const gtabs = state.tabs.filter((t) => t.groupId === g.id);
      if (gtabs.length) clusters.push({ group: g, tabs: gtabs });
    }
    const loose = state.tabs.filter((t) => !t.groupId);
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
    if (tab.url.startsWith('bowser://newtab') || tab.url.startsWith('file://')) return '';
    // The error page carries the failed URL in its query — show that, so
    // the user sees (and can edit/retry) the address they typed.
    if (tab.url.startsWith('bowser://error')) {
      try {
        return new URL(tab.url).searchParams.get('url') || tab.url;
      } catch {
        return tab.url;
      }
    }
    return tab.url;
  }

  /** Warning-only security check: true just for plain HTTP to a non-loopback
   * host — https, bowser:, file:, and local dev servers show no indicator.
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

  /** Short label for a tab's location: host for web pages, page name for
   * internal ones, empty for a blank new tab. */
  function tabDomain(tab) {
    if (!tab?.url || tab.url.startsWith('bowser://newtab')) return '';
    try {
      const u = new URL(tab.url);
      return u.protocol === 'bowser:' ? `bowser://${u.host}` : u.host;
    } catch {
      return tab.url;
    }
  }

  function setFavicon(el, tab) {
    el.className = 'favicon' + (tab?.isLoading ? ' loading' : '');
    el.style.backgroundImage = '';
    if (!tab || tab.isLoading) return;
    if (tab.favicon) {
      el.classList.add('has-icon');
      el.style.backgroundImage = `url("${tab.favicon.replace(/[\\"]/g, '\\$&')}")`;
    } else if (tab.url.startsWith('bowser://')) {
      el.classList.add('has-icon');
      el.style.backgroundImage = 'url("pages/icon.svg")'; // Bowser mark
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
    row.className = 'island-row' + (tab.id === state.activeTabId ? ' active' : '');
    row.dataset.tabId = tab.id;

    const favicon = document.createElement('span');
    setFavicon(favicon, tab);

    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = tab.isLoading ? 'Loading…' : tab.title || 'New Tab';

    const sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = tabDomain(tab);

    row.append(favicon, title, sub);

    if (tab.private) {
      const tag = document.createElement('span');
      tag.className = 'row-private';
      tag.textContent = 'private';
      row.append(tag);
    }

    if (tab.blockedCount > 0) {
      const shield = document.createElement('span');
      shield.className = 'shield';
      shield.textContent = String(tab.blockedCount);
      shield.title = `Bowser blocked ${tab.blockedCount} ${tab.blockedCount === 1 ? 'ad or tracker' : 'ads & trackers'} on this page`;
      row.append(shield);
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

  function newTabRow() {
    const row = document.createElement('div');
    row.className = 'island-row newtab';
    // A fresh tab joins the active tab's group (main mirrors this).
    const group = groupById(activeTab()?.groupId);
    row.innerHTML = `${ICONS.plus}<span class="row-title"></span><span class="row-kbd">${modKey}T</span>`;
    row.querySelector('.row-title').textContent = group ? `New tab in ${group.name}` : 'New tab';
    row.addEventListener('click', () => {
      window.browserAPI.closeOverlay();
      window.browserAPI.createTab(); // main reopens the panel focused on the blank tab
    });
    return row;
  }

  function newPrivateTabRow() {
    const row = document.createElement('div');
    row.className = 'island-row newtab';
    row.innerHTML = `${ICONS.plus}<span class="row-title">New private tab</span><span class="row-private">private</span><span class="row-kbd">${modShiftKey}N</span>`;
    row.addEventListener('click', () => {
      window.browserAPI.closeOverlay();
      window.browserAPI.createTab(null, { private: true });
    });
    return row;
  }

  // --- Slash commands ---

  const COMMANDS = [
    { cmd: '/favorites', hint: 'Open favorites', run: () => window.browserAPI.openPage('bookmarks') },
    { cmd: '/history', hint: 'Open browsing history', run: () => window.browserAPI.openPage('history') },
    { cmd: '/downloads', hint: 'Open downloads', run: () => window.browserAPI.openPage('downloads') },
    { cmd: '/settings', hint: 'Open settings', run: () => window.browserAPI.openPage('settings') },
    { cmd: '/clear', hint: 'Clear browsing history', run: () => window.browserAPI.clearHistory() },
    { cmd: '/new', hint: 'Open a new tab', run: () => window.browserAPI.createTab() },
    { cmd: '/private', hint: 'Open a private tab — history stays untouched', run: () => window.browserAPI.createTab(null, { private: true }) },
    { cmd: '/close', hint: 'Close this tab', run: () => state.activeTabId && window.browserAPI.closeTab(state.activeTabId) },
    { cmd: '/group', hint: 'Move this tab into a group — /group work', run: (input) => {
      const name = (input ?? '').replace(/^\/group\s*/, '').trim();
      if (name && state.activeTabId) window.browserAPI.groupTabByName(state.activeTabId, name);
    } },
    { cmd: '/ungroup', hint: 'Take this tab out of its group', run: () => state.activeTabId && window.browserAPI.setTabGroup(state.activeTabId, null) },
    { cmd: '/close-group', hint: 'Close every tab in this group', run: () => {
      const groupId = activeTab()?.groupId;
      if (groupId) window.browserAPI.closeGroup(groupId);
    } },
    { cmd: '/find', hint: 'Find in page', run: () => window.browserAPI.openFindBar(), keepOverlay: true },
    { cmd: '/adblock', hint: 'Toggle ad & tracker blocking', run: () => window.browserAPI.toggleAdblock() },
    { cmd: '/off-leash', hint: 'Allow ads on this site', run: () => window.browserAPI.allowAdsOnActiveSite() },
    { cmd: '/theme', hint: 'Cycle appearance (system → light → dark)', run: () => window.browserAPI.cycleTheme() },
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

  const stripUrl = (u) => (u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

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

  function pickResult(result) {
    if (result.kind === 'group') window.browserAPI.focusGroup(result.group.id);
    else if (result.kind === 'tab') window.browserAPI.switchTab(result.tab.id);
    else if (state.activeTabId) window.browserAPI.navigate(state.activeTabId, result.url);
    window.browserAPI.closeOverlay();
  }

  function resultRow(result, isTop) {
    const row = document.createElement('div');
    row.className = 'island-row' + (isTop ? ' active' : '');

    // Group results lead with their dot cluster instead of a favicon.
    const favicon = result.kind === 'group'
      ? miniDotCluster(Math.min(result.count, 4), true)
      : document.createElement('span');
    if (result.kind !== 'group') setFavicon(favicon, result.tab ?? null);

    const title = document.createElement('span');
    title.className = 'row-title' + (result.kind === 'group' ? ' mono' : '');
    title.textContent = result.title || result.url || '';

    const sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = result.sub || '';

    const tag = document.createElement('span');
    tag.className = 'row-tag';
    tag.textContent = result.kind;

    row.append(favicon, title, sub, tag);
    if (isTop) row.append(enterGlyph());
    row.addEventListener('click', () => pickResult(result));
    return row;
  }

  // --- List area: tabs at rest, commands on "/", switcher while typing ---

  function renderList() {
    const value = addressInput.value;
    visibleCommands = [];
    visibleResults = [];

    if (inputTouched && value.startsWith('/')) {
      const slashWord = value.trim().split(/\s+/)[0];
      visibleCommands = COMMANDS.filter((c) => c.cmd.startsWith(slashWord) || slashWord === '/');
      islandList.replaceChildren(
        ...(visibleCommands.length
          ? visibleCommands.map((c, i) => commandRow(c, i === 0))
          : [emptyRow('no matching command')])
      );
    } else if (inputTouched && value.trim()) {
      visibleResults = switcherResults(value.trim().toLowerCase());
      islandList.replaceChildren(
        ...(visibleResults.length
          ? visibleResults.map((r, i) => resultRow(r, i === 0))
          : [emptyRow('no matches — ↵ opens as address or search')])
      );
    } else {
      // The list re-renders on every tabs:updated broadcast (frequent while
      // any tab is loading) — a half-typed group name must survive that.
      const prevPickerInput = islandList.querySelector('.group-picker-input');
      const pickerValue = prevPickerInput?.value ?? '';
      const pickerHadFocus = prevPickerInput && document.activeElement === prevPickerInput;

      const clusters = clusterTabs();
      const rows = [];
      for (const { group, tabs: gtabs } of clusters) {
        if (group) rows.push(groupHeaderRow(group, gtabs.length, clusters.findIndex((c) => c.group === group)));
        else if (clusters.length > 1) rows.push(looseHeaderRow());
        if (group?.collapsed) rows.push(foldedGroupRow(group, gtabs));
        else rows.push(...gtabs.map(tabRow));
      }
      islandList.replaceChildren(...rows, newTabRow(), newPrivateTabRow());

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
      ? 'private · nothing here is saved to history · esc to dismiss'
      : state.groups.length
        ? `esc to dismiss · /group moves this tab · ${modKey}1–9 jumps between groups`
        : `esc to dismiss · ${modKey}L summons · / for commands`;
  }

  function renderPanel() {
    // The private theme scope follows the active tab.
    if (activeTab()?.private) document.documentElement.dataset.theme = 'private';
    else delete document.documentElement.dataset.theme;
    renderPanelChrome();
    renderList();
  }

  // --- Mode switching (driven by main via overlay:show / overlay:hide) ---

  function applyMode(next) {
    const reshow = mode === next;
    mode = next;
    document.body.dataset.mode = next ?? '';
    backdrop.hidden = next !== 'panel' && next !== 'palette';
    panelAnchor.hidden = next !== 'panel' && next !== 'palette';
    findBar.hidden = next !== 'find';

    if (next === 'panel' || next === 'palette') {
      if (!reshow) pickingTabId = null;
      refreshSwitcherData();
      renderPanel();
      // A reassert (main re-focusing the same open panel) must not clobber
      // what the user already typed.
      if (!reshow || !inputTouched) {
        inputTouched = false;
        addressInput.value = addressDisplayValue(activeTab());
      }
      addressInput.focus();
      addressInput.select();
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

  window.browserAPI.onOverlayShow(({ mode: next }) => applyMode(next));
  window.browserAPI.onOverlayHide(() => {
    if (mode === 'find') resetFind();
    mode = null;
    document.body.dataset.mode = '';
    backdrop.hidden = true;
    panelAnchor.hidden = true;
    findBar.hidden = true;
    inputTouched = false;
    pickingTabId = null;
    chipFocusTabId = null;
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

  addressInput.addEventListener('input', () => {
    inputTouched = true;
    renderList();
  });
  addressInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (visibleCommands.length) {
      runCommand(visibleCommands[0]);
    } else if (visibleResults.length) {
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
    [favorites, historyEntries] = await Promise.all([
      window.browserAPI.listFavorites(),
      window.browserAPI.listHistory({ limit: 300 }),
    ]);
  }

  window.browserAPI.onTabsUpdated((payload) => {
    state = payload;
    if (mode === 'panel' || mode === 'palette') {
      renderPanel();
      if (!inputTouched) addressInput.value = addressDisplayValue(activeTab());
    }
  });
  window.browserAPI.getAllTabs().then((payload) => {
    state = payload;
  });
})();
