/* ---- rotating hero messages ---- */
(function () {
  const messageEl = document.getElementById('heroMessage');
  const messages = Array.from(document.querySelectorAll('[data-hero-message]'));
  if (!messageEl || messages.length < 2) return;

  const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ROTATION_MS = 6000;
  const FADE_MS = 180;
  let index = 0;
  let rotationTimer = null;
  let fadeTimer = null;

  function scheduleRotation() {
    clearTimeout(rotationTimer);
    if (document.hidden) return;
    rotationTimer = setTimeout(() => showMessage((index + 1) % messages.length), ROTATION_MS);
  }

  function renderMessage(nextIndex) {
    index = nextIndex;
    messages.forEach((message, messageIndex) => {
      const active = messageIndex === index;
      message.classList.toggle('is-active', active);
      message.setAttribute('aria-hidden', String(!active));
    });
    messageEl.classList.remove('is-changing');
    scheduleRotation();
  }

  function showMessage(nextIndex) {
    clearTimeout(fadeTimer);
    if (nextIndex === index) {
      messageEl.classList.remove('is-changing');
      scheduleRotation();
      return;
    }
    if (motionMq.matches) {
      renderMessage(nextIndex);
      return;
    }
    messageEl.classList.add('is-changing');
    fadeTimer = setTimeout(() => renderMessage(nextIndex), FADE_MS);
  }

  document.addEventListener('visibilitychange', scheduleRotation);

  scheduleRotation();
})();

/* ---- large live demo: data-driven, self-playing on a fixed loop ----
   Each scene declares the full workspace state (which sites are pinned,
   grouped, or loose) plus the caption, so pinning and grouping read as
   real state changes rather than flashing option lists. */
(function () {
  const stage = document.getElementById('demoStage');
  const demo = document.getElementById('demoIsland');
  const dotsEl = document.getElementById('demoDots');
  const favEl = document.getElementById('demoFav');
  const groupNameEl = document.getElementById('demoGroupName');
  const domainEl = document.getElementById('demoDomain');
  const shieldEl = document.getElementById('demoShield');
  const typedEl = document.getElementById('demoTyped');
  const listEl = document.getElementById('demoList');
  const footEl = document.getElementById('demoFoot');
  const capEl = document.getElementById('demoCaption');
  const heartEl = document.getElementById('demoHeart');

  const NORMAL_FOOT = 'esc to dismiss · ⌘L summons · / for commands';
  const GROUP_FOOT = 'esc to dismiss · /group moves this tab · ⌘1–9 jumps groups';
  const PRIVATE_FOOT = 'private · nothing here is saved to history · esc to dismiss';

  // Real sites. `fav` is the domain whose favicon we fetch (a couple differ
  // from the display domain); a missing icon falls back to a neutral square,
  // so the demo never shows a broken image.
  const TABS = {
    gmail:    { title: 'Gmail',     domain: 'mail.google.com', fav: 'gmail.com',    shield: 2 },
    notion:   { title: 'Notion',    domain: 'notion.so',       fav: 'notion.so',    shield: 1 },
    youtube:  { title: 'YouTube',   domain: 'youtube.com',     fav: 'youtube.com',  shield: 9 },
    threads:  { title: 'Threads',   domain: 'threads.net',     fav: 'threads.net',  shield: 6 },
    scroll:   { title: 'Scroll',    domain: 'scrollapp.co',    fav: 'scrollapp.co', shield: 0 },
    nintendo: { title: 'Nintendo',  domain: 'nintendo.com',    fav: 'nintendo.com', shield: 4 },
    msnow:    { title: 'MS NOW',    domain: 'msnow.com',       fav: 'msnbc.com',    shield: 14 },
    netflix:  { title: 'Netflix',   domain: 'netflix.com',     fav: 'netflix.com',  shield: 3 },
    github:   { title: 'GitHub',    domain: 'github.com',      fav: 'github.com',   shield: 0 },
  };

  const ICON_BASE = '/favicons/';
  const favStyle = (t) => t.fav ? `background-image:url('${ICON_BASE}${t.fav}.ico')` : '';

  /* ---- real page renders for the tabs a scene can land on ----
     Desktop and mobile layouts are pre-captured and bundled under
     site/shots/{desktop,mobile}/ rather than pulled live. The live services
     were unreliable in both directions: mobile-viewport requests 403'd, and a
     live desktop render silently drifts (and letterboxes) when a site
     redesigns. Bundling ships a controlled crop that always loads instantly;
     until an image loads the skeleton bars stay visible. */
  const shotEl = document.getElementById('demoShot');
  // Which render set to use tracks the SAME 560px breakpoint as the compact-
  // pill CSS, and stays reactive (change listener below) so a rotation across
  // it never leaves the pill and its background render from different modes.
  const mobileMq = window.matchMedia('(max-width: 560px)');
  let MOBILE = mobileMq.matches;
  const SHOT_IDS = ['github', 'notion', 'scroll', 'netflix']; // sites with a bundled render
  const PRIVATE_SHOT = 'private'; // page shown behind the private-tab scene
  const PRELOAD_IDS = [...SHOT_IDS, PRIVATE_SHOT];
  // Sampled top-edge color of each bundled render, so the Island's top strip
  // blends into the page below it (the CSS reads --demo-strip-bg). A scene with
  // no bundled shot falls back to the theme surface (matches the skeleton); the
  // private scene keeps Blanc's own dark strip regardless of the page behind it.
  const SHOT_TOP = { github: '#030442', notion: '#ffffff', scroll: '#ffffff', netflix: '#080706' };
  const PRIVATE_TOP = '#0a0a0a';
  const shots = {}; // id -> { src, ready }
  let currentShotId = null;

  const shotSrc = (id) => '/shots/' + (MOBILE ? 'mobile' : 'desktop') + '/' + id + '.jpg';

  function preloadShot(id) {
    if (shots[id]) return;
    const rec = shots[id] = { src: '', ready: false };
    const img = new Image();
    const src = shotSrc(id);
    img.onload = () => { rec.src = src; rec.ready = true; showShot(currentShotId); };
    img.src = src;
  }
  PRELOAD_IDS.forEach(preloadShot);

  // Crossing the 560px breakpoint (mainly a phone rotation) swaps the desktop
  // renders for the mobile ones and vice versa. Drop the cached other-mode
  // shots, re-preload for the new mode, and refresh the on-screen tab so the
  // background never disagrees with the pill the CSS is now showing.
  mobileMq.addEventListener('change', (e) => {
    MOBILE = e.matches;
    PRELOAD_IDS.forEach((id) => delete shots[id]);
    PRELOAD_IDS.forEach(preloadShot);
    showShot(currentShotId);
  });

  function showShot(id) {
    currentShotId = id;
    const rec = id && shots[id];
    if (rec && rec.ready) {
      if (shotEl.getAttribute('src') !== rec.src) shotEl.src = rec.src;
      shotEl.classList.add('show');
    } else {
      shotEl.classList.remove('show');
    }
  }

  const PIN_ICON = '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M5 3h6l-1 5 2 2v1H4v-1l2-2z"/><path d="M8 11v3"/></svg>';
  const CARET_ICON = '<svg class="caret" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2 L7 5 L3.5 8"/></svg>';
  const COMMANDS = [
    { cmd: '/favorites', hint: 'Open favorites' },
    { cmd: '/history', hint: 'Open browsing history' },
    { cmd: '/downloads', hint: 'Open downloads' },
    { cmd: '/settings', hint: 'Open settings' },
    { cmd: '/new', hint: 'Open a new tab' },
    { cmd: '/private', hint: 'Open a private tab' },
    { cmd: '/pin', hint: 'Pin or unpin this tab' },
    { cmd: '/group', hint: 'Move this tab into a named group' },
    { cmd: '/close-group', hint: 'Close every tab in this group' },
    { cmd: '/find', hint: 'Find in page' },
    { cmd: '/block-ads', hint: 'Toggle ad & tracker blocking' },
    { cmd: '/allow-ads', hint: 'Allow ads on this site' },
    { cmd: '/theme', hint: 'Cycle appearance' },
  ];
  const SEARCH_TAGS = {
    notion: 'favorite',
    scroll: 'favorite',
    nintendo: 'history',
    msnow: 'history',
  };

  // Workspace layouts. The loop progresses base → pinned → grouped as the
  // demo pins a site and then forms a new group.
  const LAYOUTS = {
    base: {
      pinned: ['gmail', 'notion'],
      groups: [{ name: 'social', ids: ['youtube', 'threads'] }],
      loose: ['scroll', 'nintendo', 'msnow', 'netflix', 'github'],
    },
    pinned: {
      pinned: ['gmail', 'notion', 'scroll'],
      groups: [{ name: 'social', ids: ['youtube', 'threads'] }],
      loose: ['nintendo', 'msnow', 'netflix', 'github'],
    },
    grouped: {
      pinned: ['gmail', 'notion', 'scroll'],
      groups: [
        { name: 'social', ids: ['threads'] },
        { name: 'watch', ids: ['youtube', 'netflix'] },
      ],
      loose: ['nintendo', 'msnow', 'github'],
    },
    folded: {
      pinned: ['gmail', 'notion', 'scroll'],
      groups: [
        { name: 'social', ids: ['threads'], collapsed: true },
        { name: 'watch', ids: ['youtube', 'netflix'] },
      ],
      loose: ['nintendo', 'msnow', 'github'],
    },
  };

  const allIds = (lay) => [...lay.pinned, ...lay.groups.flatMap((g) => g.ids), ...lay.loose];
  const activeGroup = (lay, current) => lay.groups.find((g) => g.ids.includes(current));

  function rowDots(count, accented) {
    return '<span class="row-dots' + (accented ? ' accent' : '') + '">' +
      Array.from({ length: Math.min(count, 5) }, () => '<span></span>').join('') +
      '</span>';
  }

  function tabRow(id, opts) {
    opts = opts || {};
    const t = TABS[id];
    const cls = 'trow' + (opts.hl ? ' hl' : '') + (opts.just ? ' just' : '');
    const tag = opts.tag ? `<span class="tag">${opts.tag}</span>` : '';
    const enter = opts.enter ? '<span class="enter">↵</span>' : '';
    return `<div class="${cls}"><span class="fav" style="${favStyle(t)}"></span>` +
           `<span class="title">${t.title}</span><span class="dom">${t.domain}</span>${tag}${enter}</div>`;
  }

  function secHead(label, count, icon, just, collapsed) {
    const cls = 'sec-head' + (just ? ' just' : '') + (collapsed ? ' collapsed' : '');
    return `<div class="${cls}">${icon || ''}<span>${label}</span>` +
           `<span class="rule"></span>${count != null ? `<span class="count">${count}</span>` : ''}</div>`;
  }

  function renderTabsPanel(layName, opts) {
    opts = opts || {};
    const lay = LAYOUTS[layName];

    let html = secHead('pinned', null, PIN_ICON, false);
    lay.pinned.forEach((id) => { html += tabRow(id, { hl: id === opts.current, just: id === opts.justPin }); });

    lay.groups.forEach((g) => {
      const gjust = g.name === opts.justGroup;
      html += secHead(g.name, g.ids.length, CARET_ICON, gjust, g.collapsed);
      if (g.collapsed) {
        html += `<div class="trow folded">${rowDots(g.ids.length, false)}<span class="title">${g.ids.length} tabs tucked away</span><span class="kbd">click to unfold</span></div>`;
      } else {
        g.ids.forEach((id) => { html += tabRow(id, { hl: id === opts.current, just: gjust }); });
      }
    });

    if (lay.loose.length) {
      html += secHead('no group', null, null, false);
      lay.loose.forEach((id) => { html += tabRow(id, { hl: id === opts.current }); });
    }
    // New-tab / private launchers live in the panel's footer bar (static
    // markup), not as list rows — mirrors the app's #islandFooter.
    listEl.innerHTML = html;
  }

  function commandRows(input) {
    const word = input.trim().split(/\s+/)[0] || '/';
    const matches = COMMANDS.filter((c) => c.cmd.startsWith(word) || word === '/').slice(0, 6);
    listEl.innerHTML = matches.length
      ? matches.map((c, i) => `<div class="trow command${i === 0 ? ' hl' : ''}"><span class="cmd">${c.cmd}</span><span class="hint">${c.hint}</span>${i === 0 ? '<span class="enter">↵</span>' : ''}</div>`).join('')
      : '<div class="trow"><span class="empty">No matching command</span></div>';
  }

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

  function switcherResults(layName, query) {
    const lay = LAYOUTS[layName];
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const results = [];

    lay.groups.forEach((g) => {
      const nameScore = matchScore(q, g.name);
      const memberScore = nameScore ? 0 : matchScore(q, g.ids.map((id) => `${TABS[id].title} ${TABS[id].domain}`).join(' '));
      if (nameScore || memberScore) {
        results.push({ kind: 'group', title: g.name, domain: `${g.ids.length} tabs`, count: g.ids.length, score: (nameScore || memberScore) + (nameScore ? 0.35 : 0.05) });
      }
    });

    allIds(lay).forEach((id) => {
      const t = TABS[id];
      const score = matchScore(q, `${t.title} ${t.domain}`);
      if (!score) return;
      const kind = SEARCH_TAGS[id] || 'tab';
      const weight = kind === 'favorite' ? 0.3 : kind === 'history' ? 0.2 : 0.1;
      results.push({ kind, id, title: t.title, domain: t.domain, score: score + weight });
    });

    return results.sort((a, b) => b.score - a.score).slice(0, 6);
  }

  function resultRow(result, i) {
    if (result.kind === 'group') {
      return `<div class="trow${i === 0 ? ' hl' : ''}">${rowDots(result.count, true)}<span class="title">${result.title}</span><span class="dom">${result.domain}</span><span class="tag">group</span>${i === 0 ? '<span class="enter">↵</span>' : ''}</div>`;
    }
    return tabRow(result.id, { hl: i === 0, tag: result.kind, enter: i === 0 });
  }

  function switcherRows(layName, input) {
    const rows = switcherResults(layName, input);
    listEl.innerHTML = rows.length
      ? rows.map(resultRow).join('')
      : '<div class="trow"><span class="empty">No matches — enter searches the web</span></div>';
  }

  function renderPill(layName, current, opts) {
    opts = opts || {};
    const DOT_CAP = 8;
    const lay = LAYOUTS[layName];
    const group = activeGroup(lay, current);
    // The pill shows only the active tab's group (or the ungrouped set) as
    // dots — pins and other groups live in the panel now, matching the app.
    // Capped at DOT_CAP with a quiet "+N" for the rest.
    const members = group ? group.ids : lay.loose;
    const shown = members.slice(0, DOT_CAP);
    let dots = shown.map((id) => `<span class="${id === current ? 'cur' : ''}"></span>`).join('');
    if (members.length > DOT_CAP) dots += `<span class="dot-more">+${members.length - DOT_CAP}</span>`;
    dotsEl.innerHTML = dots;

    const t = TABS[current];
    favEl.style.backgroundImage = t.fav ? `url('${ICON_BASE}${t.fav}.ico')` : 'none';
    if (group) {
      groupNameEl.textContent = `${group.name} ·`;
      groupNameEl.hidden = false;
    } else {
      groupNameEl.hidden = true;
    }
    domainEl.textContent = t.domain;
    shieldEl.hidden = t.shield === 0;
    shieldEl.textContent = t.shield;
    // Favorite (heart) fills for the sites the demo treats as favorites.
    heartEl.classList.toggle('on', SEARCH_TAGS[current] === 'favorite');
  }

  function setCap(text) {
    capEl.textContent = text;
    capEl.classList.remove('show');
    void capEl.offsetWidth; // restart the fade animation
    capEl.classList.add('show');
  }

  function stopTyping() {
    clearInterval(typeTimer);
    typeTimer = null;
  }

  const TYPE_MS = 85;        // per-character typing cadence — snappy, still legible
  const POST_TYPE_HOLD = 1900; // linger after typing finishes, to read the result + caption

  function typeInput(text, renderPartial, renderBeforeTyping) {
    stopTyping();
    typedEl.textContent = '';
    renderBeforeTyping();
    let i = 0;
    typeTimer = setInterval(() => {
      i++;
      const partial = text.slice(0, i);
      typedEl.textContent = partial;
      renderPartial(partial);
      if (i >= text.length) stopTyping();
    }, TYPE_MS);
  }

  // ---- scenes: one linear workflow, ~3–4s each ----
  const SCENES = [
    { view: 'rest',  layout: 'base',    current: 'github',  hold: 3200, cap: 'No tab strip, no toolbar — just one small island.' },
    { view: 'rest',  layout: 'base',    current: 'github',  scroll: true, hold: 4200, cap: 'Scroll the page and the island stays out of the way.' },
    { view: 'panel', layout: 'base',    current: 'github',  hold: 3300, cap: 'Open it and the whole session is already sorted.' },
    { view: 'panel', layout: 'base',    current: 'github',  panel: 'switcher', typed: 'scr', hold: 3400, cap: 'A few letters jumps from GitHub to Scroll.' },
    { view: 'rest',  layout: 'base',    current: 'scroll',  hold: 2800, cap: 'Scroll fills the window while the island stays small.' },
    { view: 'panel', layout: 'pinned',  current: 'scroll',  panel: 'commands', typed: '/pin', justPin: 'scroll', hold: 3800, cap: 'Commands handle the little browser chores.' },
    { view: 'panel', layout: 'grouped', current: 'netflix', justGroup: 'watch', hold: 4200, cap: 'YouTube and Netflix sit together in a watch group.' },
    { view: 'panel', layout: 'folded',  current: 'netflix', hold: 3300, cap: 'Folded groups stay tucked away until you jump back.' },
    { view: 'panel', layout: 'grouped', current: 'netflix', panel: 'switcher', typed: 'No', hold: 4200, cap: 'The same input finds tabs, favorites, and history.' },
    { view: 'rest',  layout: 'grouped', current: 'notion', hold: 3200, cap: 'Enter switches to Notion, with the page back in front.' },
    { view: 'panel', layout: 'grouped', current: 'github',  panel: 'commands', typed: '/allow', hold: 3400, cap: 'Need a site exception? Type /allow-ads.' },
    { view: 'panel', layout: 'grouped', current: 'youtube', panel: 'commands', typed: '/private', hold: 3600, cap: 'A private tab is one command away.' },
    { view: 'rest',  layout: 'grouped', current: 'youtube', priv: true, hold: 3800, cap: 'Private tabs shift the chrome and save nothing to history.' },
  ];

  // Chapters group the scenes into the demo's topics; each scrub-bar marker sits
  // at the start of one and jumps playback there.
  const CHAPTERS = [
    { label: 'the island', scene: 0 },
    { label: 'command bar', scene: 2 },
    { label: 'tab groups', scene: 6 },
    { label: 'ad blocking', scene: 10 },
    { label: 'private tabs', scene: 11 },
  ];
  // A scene's on-screen duration: typing scenes run for the keystrokes plus a
  // read beat, everything else uses its authored hold. The scrub fill and the
  // scene timer share this so the bar tracks playback exactly.
  const sceneDuration = (s) => s.typed ? s.typed.length * TYPE_MS + POST_TYPE_HOLD : s.hold;
  const DUR = SCENES.map(sceneDuration);
  const TOTAL = DUR.reduce((sum, d) => sum + d, 0);
  const START = []; DUR.reduce((acc, d, i) => (START[i] = acc, acc + d), 0);

  let idx = 0, timer = null, typeTimer = null;

  function applyScene(s) {
    stopTyping();
    const open = s.view === 'panel';
    const lay = LAYOUTS[s.layout];
    const current = s.current || allIds(lay)[0];
    demo.classList.toggle('open', open);
    demo.classList.toggle('private', !!s.priv);
    stage.classList.remove('scrolling');
    void stage.offsetWidth; // restart the scroll animation when the scene repeats
    stage.classList.toggle('scrolling', !!s.scroll);
    stage.setAttribute('data-theme', s.priv ? 'private' : 'light');
    footEl.textContent = s.priv ? PRIVATE_FOOT : lay.groups.length > 1 ? GROUP_FOOT : NORMAL_FOOT;

    renderPill(s.layout, current, s);
    showShot(s.priv ? PRIVATE_SHOT : current); // private scene shows a page browsed privately
    // Color-match the top strip to the page now behind it, so the Island reads
    // as floating in the page's top margin rather than on a browser bar.
    stage.style.setProperty('--demo-strip-bg', s.priv ? PRIVATE_TOP : (SHOT_TOP[current] || ''));
    setCap(s.cap);

    if (open) {
      if (s.typed && s.panel === 'commands') {
        typeInput(s.typed, commandRows, () => renderTabsPanel(s.layout, s));
      } else if (s.typed && s.panel === 'switcher') {
        typeInput(s.typed, (partial) => switcherRows(s.layout, partial), () => renderTabsPanel(s.layout, s));
      } else {
        typedEl.textContent = '';
        renderTabsPanel(s.layout, s);
      }
    } else {
      typedEl.textContent = '';
    }
  }

  // ---- scrub bar: progress fill + clickable chapter markers ----
  const trackEl = document.getElementById('demoScrubTrack');
  const fillEl = document.getElementById('demoScrubFill');
  const markerEls = trackEl ? CHAPTERS.map((ch) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'demo-scrub-marker';
    b.style.left = (START[ch.scene] / TOTAL * 100) + '%';
    b.setAttribute('aria-label', 'Jump to ' + ch.label);
    const lbl = document.createElement('span');
    lbl.className = 'demo-scrub-label';
    lbl.textContent = ch.label;
    b.appendChild(lbl);
    b._scene = ch.scene;
    b.addEventListener('click', () => jumpTo(ch.scene));
    trackEl.appendChild(b);
    return b;
  }) : [];

  // Fill the bar linearly over the current scene's duration. The fill is snapped
  // back to the scene's start with the transition disabled (so a loop wrap
  // doesn't animate backwards), then transitions to the scene's end.
  function updateScrub() {
    if (fillEl) {
      const from = START[idx] / TOTAL * 100;
      const to = (START[idx] + DUR[idx]) / TOTAL * 100;
      fillEl.style.transition = 'none';
      fillEl.style.width = from + '%';
      void fillEl.offsetWidth; // reflow so the snap-back applies before animating
      fillEl.style.transition = 'width ' + DUR[idx] + 'ms linear';
      fillEl.style.width = to + '%';
    }
    let activeScene = 0;
    for (const ch of CHAPTERS) if (ch.scene <= idx) activeScene = ch.scene;
    markerEls.forEach((m) => m.classList.toggle('active', m._scene === activeScene));
  }

  function jumpTo(sceneIndex) {
    clearTimeout(timer);
    stopTyping();
    idx = sceneIndex;
    tick();
  }

  function tick() {
    applyScene(SCENES[idx]);
    updateScrub();
    timer = setTimeout(() => { idx = (idx + 1) % SCENES.length; tick(); }, DUR[idx]);
  }
  tick();
})();
