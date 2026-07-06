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

  const ICON_BASE = 'https://icons.duckduckgo.com/ip3/';
  const favStyle = (t) => t.fav ? `background-image:url('${ICON_BASE}${t.fav}.ico')` : '';

  /* ---- real page renders for the tabs a scene can land on ----
     mShots serves a small "generating…" placeholder until a screenshot
     exists, so each preload retries until a full-width render comes back;
     until then the skeleton bars stay visible. Some sites use a second
     screenshot provider for more reliable real-site renders. */
  const shotEl = document.getElementById('demoShot');
  // The stage is 900 CSS px wide at desktop; request a 2x mShots render
  // so the real-site backgrounds stay crisp when the service provides it.
  const SHOT_W = 1800;
  // mShots may cap large requests below SHOT_W. Accept a real desktop-sized
  // render instead of holding the skeleton forever.
  const MIN_READY_SHOT_W = 1000;
  const SHOT_PAGES = {
    github: 'https://github.com',
    notion: 'https://www.notion.so',
    scroll: 'https://scrollapp.co',
    netflix: 'https://www.netflix.com',
  };
  const shots = {}; // id -> { src, ready }
  let currentShotId = null;

  function shotSrc(id, tries) {
    if (id === 'github' || id === 'notion' || id === 'scroll') {
      return 'https://image.thum.io/get/width/' + SHOT_W + '/' + SHOT_PAGES[id];
    }
    return 'https://s0.wp.com/mshots/v1/' + encodeURIComponent(SHOT_PAGES[id]) + '?w=' + SHOT_W + (tries ? '&r=' + tries : '');
  }

  function preloadShot(id) {
    if (shots[id]) return;
    const rec = shots[id] = { src: '', ready: false, tries: 0 };
    const attempt = () => {
      const img = new Image();
      const src = shotSrc(id, rec.tries);
      img.onload = () => {
        if (img.naturalWidth >= MIN_READY_SHOT_W) {
          rec.src = src; rec.ready = true;
          showShot(currentShotId); // in case this tab is on screen right now
        } else if (++rec.tries < 8) setTimeout(attempt, 2500);
      };
      img.onerror = () => { if (++rec.tries < 8) setTimeout(attempt, 2500); };
      img.src = src;
    };
    attempt();
  }
  Object.keys(SHOT_PAGES).forEach(preloadShot);

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
  const PLUS_ICON = '<svg viewBox="0 0 16 16"><path d="M8 3.25v9.5M3.25 8h9.5"/></svg>';
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
    const group = activeGroup(lay, opts.current);
    html += `<div class="trow"><span class="plus">${PLUS_ICON}</span><span class="title">${group ? `New tab in ${group.name}` : 'New tab'}</span><span class="kbd">⌘T</span></div>`;
    html += `<div class="trow"><span class="plus">${PLUS_ICON}</span><span class="title">New private tab</span><span class="private-tag">private</span><span class="kbd">⌘⇧N</span></div>`;
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
    const lay = LAYOUTS[layName];
    let dots = '<span class="pin-shelf">' + lay.pinned.map(() => '<span></span>').join('') + '</span>';
    lay.groups.forEach((g) => {
      const active = g.ids.includes(current);
      const folded = g.collapsed && !active;
      dots += `<span class="cluster${active ? ' on' : ''}${folded ? ' folded' : ''}">` +
              g.ids.map((id) => `<span class="${id === current ? 'cur' : ''}"></span>`).join('') + '</span>';
    });
    const looseActive = lay.loose.includes(current);
    dots += `<span class="cluster${looseActive ? ' on' : ''}">` +
            lay.loose.map((id) => `<span class="${id === current ? 'cur' : ''}"></span>`).join('') + '</span>';
    dotsEl.innerHTML = dots;

    const t = TABS[current];
    favEl.style.backgroundImage = t.fav ? `url('${ICON_BASE}${t.fav}.ico')` : 'none';
    const group = activeGroup(lay, current);
    if (group) {
      groupNameEl.textContent = `${group.name} ·`;
      groupNameEl.hidden = false;
    } else {
      groupNameEl.hidden = true;
    }
    domainEl.textContent = t.domain;
    shieldEl.hidden = t.shield === 0;
    shieldEl.textContent = t.shield;
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
    }, 135);
  }

  // ---- scenes: one linear workflow, ~3–4s each ----
  const SCENES = [
    { view: 'rest',  layout: 'base',    current: 'github',  hold: 3200, cap: 'Real pages, just the Blanc Island for browser chrome.' },
    { view: 'rest',  layout: 'base',    current: 'github',  scroll: true, hold: 4200, cap: 'Scroll the page and the Blanc Island stays out of the way.' },
    { view: 'panel', layout: 'base',    current: 'github',  hold: 4300, cap: 'Open it and the whole session is already sorted.' },
    { view: 'panel', layout: 'base',    current: 'github',  panel: 'switcher', typed: 'scr', hold: 3400, cap: 'A few letters jumps from GitHub to Scroll.' },
    { view: 'rest',  layout: 'base',    current: 'scroll',  hold: 2800, cap: 'Scroll fills the window while the Blanc Island stays small.' },
    { view: 'panel', layout: 'pinned',  current: 'scroll',  panel: 'commands', typed: '/pin', justPin: 'scroll', hold: 3800, cap: 'Commands handle the little browser chores.' },
    { view: 'panel', layout: 'grouped', current: 'netflix', justGroup: 'watch', hold: 4200, cap: 'YouTube and Netflix sit together in a watch group.' },
    { view: 'panel', layout: 'folded',  current: 'netflix', hold: 4000, cap: 'Folded groups stay tucked away until you jump back.' },
    { view: 'panel', layout: 'grouped', current: 'netflix', panel: 'switcher', typed: 'No', hold: 4200, cap: 'The same input finds tabs, favorites, and history.' },
    { view: 'rest',  layout: 'grouped', current: 'notion', hold: 3200, cap: 'Enter switches to Notion, with the page back in front.' },
    { view: 'panel', layout: 'grouped', current: 'github',  panel: 'commands', typed: '/allow', hold: 3400, cap: 'Need a site exception? Type /allow-ads.' },
    { view: 'panel', layout: 'grouped', current: 'youtube', panel: 'commands', typed: '/private', hold: 3600, cap: 'A private tab is one command away.' },
    { view: 'rest',  layout: 'grouped', current: 'youtube', priv: true, hold: 3800, cap: 'Private tabs shift the chrome and save nothing to history.' },
  ];

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
    showShot(s.priv ? null : current); // private tabs open Blanc's own dark page
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

  function tick() {
    applyScene(SCENES[idx]);
    timer = setTimeout(() => { idx = (idx + 1) % SCENES.length; tick(); }, SCENES[idx].hold);
  }
  tick();
})();

// ---------- Dynamic download handler ----------
// One fetch resolves the per-OS installer URLs for all three text links,
// and points the main CTA at whichever matches the visitor's OS. Any link
// whose asset is missing keeps its releases-page fallback href.
(function () {
  const cta = document.getElementById('downloadCta');
  const links = {
    mac: document.getElementById('dl-mac'),
    win: document.getElementById('dl-win'),
    linux: document.getElementById('dl-linux'),
  };
  // Detect the visitor's desktop OS. Mobile (Android, iOS) and anything
  // unrecognized resolve to null, so the CTA keeps its releases-page
  // fallback rather than pushing a desktop .dmg at a phone.
  const ua = navigator.userAgent;
  let os = null;
  if (/Windows/i.test(ua)) os = 'win';
  else if (/Android|iPhone|iPad|iPod/i.test(ua)) os = null;
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'mac';
  else if (/Linux/i.test(ua)) os = 'linux';

  const pickAsset = (assets, kind) => {
    if (kind === 'mac') {
      const dmgs = assets.filter(a => a.name.endsWith('.dmg'));
      return dmgs.find(a => a.name.includes('arm64')) || dmgs[0];
    }
    if (kind === 'win') return assets.find(a => a.name.endsWith('.exe'));
    if (kind === 'linux') return assets.find(a => a.name.endsWith('.AppImage'));
  };

  fetch('https://api.github.com/repos/bnfy/blanc/releases/latest')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(rel => {
      Object.keys(links).forEach(kind => {
        const asset = pickAsset(rel.assets, kind);
        if (asset) {
          links[kind].href = asset.browser_download_url;
          if (kind === os) cta.href = asset.browser_download_url;
        }
      });
    })
    .catch(() => { /* keep the releases-page fallback hrefs */ });
})();

// ---------- Consent-gated analytics ----------
// Nothing Google-related loads until the visitor clicks Allow; the choice
// sticks in localStorage so the banner is shown at most once per visitor.
// Wrapped so a failure means no banner and no GA, never a broken page.
try {
  const GA_ID = 'G-MN8BLY6GE9';
  const loadGA = () => {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA_ID);
  };
  const consent = localStorage.getItem('ga-consent');
  if (consent === 'granted') {
    loadGA();
  } else if (consent !== 'denied') {
    const banner = document.getElementById('consent');
    banner.hidden = false;
    document.body.classList.add('has-consent');
    const dismiss = (choice) => {
      localStorage.setItem('ga-consent', choice);
      banner.hidden = true;
      document.body.classList.remove('has-consent');
    };
    document.getElementById('consentAllow').addEventListener('click', () => {
      dismiss('granted');
      loadGA();
    });
    document.getElementById('consentDeny').addEventListener('click', () => {
      dismiss('denied');
    });
  }
} catch (e) { /* no banner, no GA */ }
