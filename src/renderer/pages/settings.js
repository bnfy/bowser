(async () => {
  const { settings, searchEngines, appIcons, supporterIcons, capabilities } =
    await window.bowserPages.settings.get();

  // Desktop sends no `capabilities` field → every feature is supported and this
  // file behaves exactly as before. A platform that DOES send the list (iOS)
  // gets each unsupported feature skipped ENTIRELY — no child getElementById, no
  // bridge call to an unimplemented method, no listener — then its control is
  // removed. Guarding (not merely removing) matters because several sections
  // `await` a bridge method on load; an unimplemented one rejects and would
  // abort this whole IIFE, and removing a container first makes its children
  // un-findable by id (getElementById → null → `.addEventListener` throws).
  const cap = capabilities ? new Set(capabilities) : null;
  const supports = (feature) => !cap || cap.has(feature);

  // --- Core: theme / search engine / adblock (always supported) ---
  const theme = document.getElementById('theme');
  const searchEngine = document.getElementById('searchEngine');
  const adblockEnabled = document.getElementById('adblockEnabled');

  for (const [key, label] of Object.entries(searchEngines)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    searchEngine.append(opt);
  }
  theme.value = settings.theme ?? 'system';
  searchEngine.value = settings.searchEngine;
  adblockEnabled.checked = settings.adblockEnabled;

  theme.addEventListener('change', () =>
    window.bowserPages.settings.set({ theme: theme.value }));
  searchEngine.addEventListener('change', () =>
    window.bowserPages.settings.set({ searchEngine: searchEngine.value }));
  adblockEnabled.addEventListener('change', () =>
    window.bowserPages.settings.set({ adblockEnabled: adblockEnabled.checked }));

  // --- Home page ---
  if (supports('homePage')) {
    const homePage = document.getElementById('homePage');
    homePage.value = settings.homePage;
    homePage.addEventListener('change', () =>
      window.bowserPages.settings.set({ homePage: homePage.value }));
  } else {
    document.getElementById('homePage')?.closest('.setting')?.remove();
  }

  // --- WebRTC IP-handling policy ---
  if (supports('webrtcPolicy')) {
    const webrtcPolicy = document.getElementById('webrtcPolicy');
    webrtcPolicy.value = settings.webrtcPolicy ?? 'standard';
    webrtcPolicy.addEventListener('change', () =>
      window.bowserPages.settings.set({ webrtcPolicy: webrtcPolicy.value }));
  } else {
    document.getElementById('webrtcPolicy')?.closest('.setting')?.remove();
  }

  // --- Encrypted DNS (DoH) ---
  if (supports('secureDns')) {
    const secureDns = document.getElementById('secureDns');
    const secureDnsRow = document.getElementById('secureDnsCustomRow');
    const secureDnsTemplate = document.getElementById('secureDnsTemplate');
    const secureDnsError = document.getElementById('secureDnsError');

    // Reflect an ACCEPTED persisted snapshot into the controls (clears any error).
    const showAccepted = (s) => {
      secureDns.value = s.secureDns ?? 'auto';
      secureDnsTemplate.value = s.secureDnsTemplate ?? '';
      secureDnsRow.hidden = secureDns.value !== 'custom';
      secureDnsError.hidden = true;
      secureDnsTemplate.setAttribute('aria-invalid', 'false');
    };

    // The main process is the sole validator. Send the change, then render from the
    // ACTUAL persisted result (set() returns the settings). A custom write is REJECTED
    // when the store didn't take it — either the provider isn't custom, OR (Custom
    // already active) the submitted template wasn't stored because it was invalid and
    // sanitize dropped it, leaving the previous valid template in place. Comparing only
    // the provider would miss that second case: keep the draft visible (dropdown on
    // custom, row OPEN, typed text intact) and show the error — never snap back.
    const commit = async (partial, attempted) => {
      const next = await window.bowserPages.settings.set(partial);
      const rejected = attempted === 'custom' &&
        (next.secureDns !== 'custom' || next.secureDnsTemplate !== partial.secureDnsTemplate);
      if (rejected) {
        secureDns.value = 'custom';
        secureDnsRow.hidden = false;
        secureDnsError.hidden = false;
        secureDnsTemplate.setAttribute('aria-invalid', 'true');
        return; // leaves secureDnsTemplate.value (the rejected text) untouched
      }
      showAccepted(next);
    };

    showAccepted(settings); // initial render from the get() payload

    secureDns.addEventListener('change', () => {
      if (secureDns.value === 'custom') {
        secureDnsRow.hidden = false; // reveal the field so they can type
        secureDnsError.hidden = true; // don't error before they've entered anything
        const t = secureDnsTemplate.value.trim();
        if (t) commit({ secureDns: 'custom', secureDnsTemplate: t }, 'custom');
        // else: wait for the template's own change event to commit + validate
      } else {
        commit({ secureDns: secureDns.value }, secureDns.value);
      }
    });
    secureDnsTemplate.addEventListener('change', () =>
      commit({ secureDns: 'custom', secureDnsTemplate: secureDnsTemplate.value.trim() }, 'custom'));
  } else {
    document.getElementById('secureDns')?.closest('.setting')?.remove();
    document.getElementById('secureDnsCustomRow')?.remove();
  }

  // --- Usage ping ---
  if (supports('usagePing')) {
    const usagePing = document.getElementById('usagePing');
    usagePing.checked = settings.usagePing;
    usagePing.addEventListener('change', () =>
      window.bowserPages.settings.set({ usagePing: usagePing.checked }));

    const resetInstallId = document.getElementById('resetInstallId');
    const resetInstallIdStatus = document.getElementById('resetInstallIdStatus');
    resetInstallId.addEventListener('click', async () => {
      const ok = await window.bowserPages.resetInstallId();
      resetInstallIdStatus.textContent = ok
        ? 'Reset — this install now counts as brand new.'
        : 'Couldn’t save the reset — check disk space and try again.';
      setTimeout(() => { resetInstallIdStatus.textContent = ''; }, 3000);
    });
  } else {
    document.getElementById('usagePing')?.closest('.setting')?.remove();
    document.getElementById('resetInstallId')?.closest('.toolbar-row')?.remove();
  }

  // --- Default browser (live OS state, nothing stored) ---
  const defaultBrowserSetting = document.getElementById('defaultBrowserSetting');
  if (!supports('defaultBrowser') || navigator.platform.includes('Linux')) {
    defaultBrowserSetting.remove();
  } else {
    const defaultBrowserBtn = document.getElementById('defaultBrowserBtn');
    const defaultBrowserState = document.getElementById('defaultBrowserState');
    const defaultBrowserHint = document.getElementById('defaultBrowserHint');
    const applyDefaultBrowser = ({ isDefault, canSet }) => {
      defaultBrowserBtn.hidden = isDefault;
      defaultBrowserState.hidden = !isDefault;
      defaultBrowserBtn.disabled = !canSet;
      if (!canSet && !isDefault) defaultBrowserHint.textContent = 'Available in the installed app';
    };
    defaultBrowserBtn.addEventListener('click', async () => {
      applyDefaultBrowser(await window.bowserPages.defaultBrowser.set());
    });
    // The macOS confirmation dialog happens outside the app — re-check
    // whenever the user comes back to this page.
    window.addEventListener('focus', async () => {
      applyDefaultBrowser(await window.bowserPages.defaultBrowser.get());
    });
    applyDefaultBrowser(await window.bowserPages.defaultBrowser.get());
  }

  // --- App icon colorways (Dock icon is macOS-only) ---
  // These four bindings stay in IIFE scope unconditionally because the Supporter
  // section below reads `supporterActive` and calls `renderAppIconGrid`. The
  // function/const definitions are inert until called; only the executable tail
  // (render vs. remove) is gated.
  const appIconSetting = document.getElementById('appIconSetting');
  let supporterActive = settings.supporterActive ?? false;
  const appIconGrid = document.getElementById('appIconGrid');
  // Tracked directly rather than re-derived from the DOM on every render —
  // ids/labels come from main (settings.js APP_ICON_LABELS/SUPPORTER_ICON_LABELS)
  // so there's one source of truth instead of a hand-typed second copy.
  let selectedIcon = settings.appIcon ?? 'paper';

  const selectAppIcon = (id) => {
    selectedIcon = id;
    for (const btn of appIconGrid.children) {
      btn.classList.toggle('active', btn.dataset.icon === id);
      btn.setAttribute('aria-checked', String(btn.dataset.icon === id));
    }
  };

  function renderAppIconGrid() {
    appIconGrid.replaceChildren();
    const entries = [
      ...Object.entries(appIcons).map(([id, label]) => [id, label, false]),
      ...Object.entries(supporterIcons).map(([id, label]) => [id, label, !supporterActive]),
    ];
    for (const [id, label, locked] of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = locked ? 'icon-swatch locked' : 'icon-swatch';
      btn.dataset.icon = id;
      btn.setAttribute('role', 'radio');
      const img = document.createElement('img');
      img.src = `icon-${id}.png`;
      img.alt = '';
      const name = document.createElement('span');
      name.textContent = label;
      btn.append(img, name);
      if (locked) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'supporter';
        btn.append(tag);
        // A locked tile points at the Supporter section instead of
        // silently failing (main would reject the id anyway).
        btn.addEventListener('click', () => {
          document.getElementById('supporterTitle').scrollIntoView({ behavior: 'smooth' });
          document.getElementById('supporterKey').focus({ preventScroll: true });
        });
      } else {
        btn.addEventListener('click', async () => {
          await window.bowserPages.settings.set({ appIcon: id });
          selectAppIcon(id);
        });
      }
      appIconGrid.append(btn);
    }
    selectAppIcon(selectedIcon);
    updateIconCarets();
  }

  // The scroller hides its scrollbar; these carets are the only visible
  // affordance, so they dim out at either end of the scroll range.
  const iconPrev = document.getElementById('appIconPrev');
  const iconNext = document.getElementById('appIconNext');
  const CARET_SCROLL_STEP = 3 * (58 + 14); // three tiles per click

  function updateIconCarets() {
    const max = appIconGrid.scrollWidth - appIconGrid.clientWidth;
    iconPrev.disabled = appIconGrid.scrollLeft <= 1;
    iconNext.disabled = appIconGrid.scrollLeft >= max - 1;
  }

  if (!supports('appIcon') || !navigator.platform.startsWith('Mac')) {
    appIconSetting.remove();
  } else {
    iconPrev.addEventListener('click', () =>
      appIconGrid.scrollBy({ left: -CARET_SCROLL_STEP, behavior: 'smooth' }));
    iconNext.addEventListener('click', () =>
      appIconGrid.scrollBy({ left: CARET_SCROLL_STEP, behavior: 'smooth' }));
    appIconGrid.addEventListener('scroll', updateIconCarets);
    window.addEventListener('resize', updateIconCarets);
    renderAppIconGrid();
  }

  // --- Supporter activation ---
  if (supports('supporter')) {
    const supporterActivateRow = document.getElementById('supporterActivateRow');
    const supporterKey = document.getElementById('supporterKey');
    const supporterActivateBtn = document.getElementById('supporterActivate');
    const supporterStatus = document.getElementById('supporterStatus');

    function renderSupporterState() {
      if (!supporterActive) return;
      supporterActivateRow.hidden = true;
      const when = settings.supporterActivatedAt
        ? new Date(settings.supporterActivatedAt).toLocaleDateString()
        : null;
      supporterStatus.textContent = when
        ? `You’re a supporter — thank you. Activated ${when}.`
        : 'You’re a supporter — thank you.';
    }
    renderSupporterState();

    async function activateSupporter() {
      // Also guards the Enter-keydown listener below — without this, OS
      // key-repeat while holding Enter fires concurrent activation requests.
      if (supporterActivateBtn.disabled) return;
      supporterActivateBtn.disabled = true;
      supporterStatus.textContent = 'Activating…';
      const result = await window.bowserPages.settings.activateSupporter(supporterKey.value);
      supporterActivateBtn.disabled = false;
      if (result.ok) {
        supporterActive = true;
        settings.supporterActivatedAt = result.activatedAt;
        renderSupporterState();
        if (navigator.platform.startsWith('Mac')) renderAppIconGrid();
      } else {
        supporterStatus.textContent = result.message;
      }
    }
    supporterActivateBtn.addEventListener('click', activateSupporter);
    supporterKey.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') activateSupporter();
    });
  } else {
    document.getElementById('group-supporter')?.remove();
  }

  // --- Site permissions ---
  if (supports('permissions')) {
    const permissionList = document.getElementById('permissionList');
    const PERMISSION_LABELS = { media: 'Camera/microphone', geolocation: 'Location', notifications: 'Notifications' };

    async function refreshPermissions() {
      const decisions = await window.bowserPages.permissions.list();
      permissionList.replaceChildren();

      const entries = Object.entries(decisions);
      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No saved decisions. Sites ask the first time they need something.';
        permissionList.append(empty);
        return;
      }

      for (const [key, decision] of entries.sort(([a], [b]) => a.localeCompare(b))) {
        const [origin, permission, mediaType] = key.split('|');
        const row = document.createElement('div');
        row.className = 'row';

        const main = document.createElement('div');
        main.className = 'main';
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = new URL(origin).host;
        main.append(title);

        const meta = document.createElement('div');
        meta.className = 'meta';
        const permissionLabel = permission === 'media' && mediaType
          ? ({ audio: 'Microphone', video: 'Camera' }[mediaType] ?? PERMISSION_LABELS.media)
          : (PERMISSION_LABELS[permission] ?? permission);
        meta.textContent = `${permissionLabel} — ${decision === 'allow' ? 'Allowed' : 'Blocked'}`;

        const actions = document.createElement('div');
        actions.className = 'actions';
        const remove = document.createElement('button');
        remove.className = 'danger';
        remove.textContent = 'Remove';
        remove.addEventListener('click', async () => {
          await window.bowserPages.permissions.remove(key);
          refreshPermissions();
        });
        actions.append(remove);

        row.append(main, meta, actions);
        permissionList.append(row);
      }
    }

    refreshPermissions();
  } else {
    document.getElementById('permissionList')?.closest('.group-subsection')?.remove();
  }

  // --- Ad-block exceptions ---
  if (supports('adblockExceptions')) {
    const exceptionInput = document.getElementById('exceptionInput');
    const exceptionAdd = document.getElementById('exceptionAdd');
    const exceptionList = document.getElementById('exceptionList');

    function normalizeHostname(input) {
      try {
        return new URL(input.includes('://') ? input : `https://${input}`).hostname
          .toLowerCase()
          .replace(/^www\./, '');
      } catch {
        return null;
      }
    }

    async function refreshExceptions() {
      const { settings: current } = await window.bowserPages.settings.get();
      const exceptions = current.adblockExceptions ?? [];
      exceptionList.replaceChildren();

      if (exceptions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No exceptions added.';
        exceptionList.append(empty);
        return;
      }

      for (const hostname of [...exceptions].sort()) {
        const row = document.createElement('div');
        row.className = 'row';

        const main = document.createElement('div');
        main.className = 'main';
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = hostname;
        main.append(title);

        const actions = document.createElement('div');
        actions.className = 'actions';
        const remove = document.createElement('button');
        remove.className = 'danger';
        remove.textContent = 'Remove';
        remove.addEventListener('click', async () => {
          await window.bowserPages.settings.set({
            adblockExceptions: exceptions.filter((h) => h !== hostname),
          });
          refreshExceptions();
        });
        actions.append(remove);

        row.append(main, actions);
        exceptionList.append(row);
      }
    }

    async function addException() {
      const hostname = normalizeHostname(exceptionInput.value.trim());
      if (!hostname) return;
      const { settings: current } = await window.bowserPages.settings.get();
      const exceptions = new Set(current.adblockExceptions ?? []);
      exceptions.add(hostname);
      await window.bowserPages.settings.set({ adblockExceptions: [...exceptions] });
      exceptionInput.value = '';
      refreshExceptions();
    }

    exceptionAdd.addEventListener('click', addException);
    exceptionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addException();
    });

    refreshExceptions();
  } else {
    document.getElementById('exceptionInput')?.closest('.group-subsection')?.remove();
  }

  // --- Clear browsing data ---
  if (supports('clearBrowsingData')) {
    const clearBrowsingData = document.getElementById('clearBrowsingData');
    const clearBrowsingDataStatus = document.getElementById('clearBrowsingDataStatus');

    clearBrowsingData.addEventListener('click', async () => {
      if (!confirm('Clear all cookies, cache, and site data? You will be logged out of everything.')) return;
      await window.bowserPages.clearBrowsingData();
      clearBrowsingDataStatus.textContent = 'Cleared.';
      setTimeout(() => { clearBrowsingDataStatus.textContent = ''; }, 2000);
    });
  } else {
    const clearRow = document.getElementById('clearBrowsingData')?.closest('.toolbar-row');
    if (clearRow) {
      let prev = clearRow.previousElementSibling;
      if (prev && prev.tagName === 'P') { const p = prev; prev = p.previousElementSibling; p.remove(); }
      if (prev && prev.tagName === 'H3') prev.remove();
      clearRow.remove();
    }
  }

  // --- Sync ---
  if (supports('sync')) {
    (function initSync() {
      const setup = document.getElementById('syncSetup');
      const active = document.getElementById('syncActive');
      const handleEl = document.getElementById('syncHandle');
      const passEl = document.getElementById('syncPassphrase');
      const enableBtn = document.getElementById('syncEnable');
      const setupStatus = document.getElementById('syncSetupStatus');
      const activeStatus = document.getElementById('syncActiveStatus');
      const nowBtn = document.getElementById('syncNow');
      const disableBtn = document.getElementById('syncDisable');
      const wipeEl = document.getElementById('syncWipe');

      const when = (ts) => (ts ? new Date(ts).toLocaleString() : 'never');
      function render(status, note) {
        const on = !!status.enabled;
        setup.hidden = on;
        active.hidden = !on;
        if (on) {
          const base = status.lastError
            ? `Sync is on (${status.handle}). ${status.lastError}`
            : `Sync is on (${status.handle}). Last synced ${when(status.lastSyncedAt)}.`;
          activeStatus.textContent = note ? `${note} ${base}` : base;
        } else {
          setupStatus.textContent = note || '';
        }
      }

      window.bowserPages.settings.syncGet().then(render).catch(() => {});

      async function enable() {
        if (enableBtn.disabled) return;
        enableBtn.disabled = true;
        setupStatus.textContent = 'Turning on sync…';
        const res = await window.bowserPages.settings.syncEnable({ handle: handleEl.value, passphrase: passEl.value });
        enableBtn.disabled = false;
        passEl.value = '';
        // Sync can be ON even when the first sync failed (offline), so always
        // reflect the real status. A brand-new account gets a heads-up in case
        // the passphrase was mistyped — a wrong one silently starts a new one.
        const note = res.created
          ? `Started a new sync account for “${handleEl.value.trim()}”. If you have data on another device, turn sync off and check the name and passphrase match exactly.`
          : (res.ok ? null : res.message);
        render(res.status, note);
      }
      enableBtn.addEventListener('click', enable);
      passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') enable(); });

      nowBtn.addEventListener('click', async () => {
        nowBtn.disabled = true;
        activeStatus.textContent = 'Syncing…';
        render(await window.bowserPages.settings.syncNow());
        nowBtn.disabled = false;
      });

      disableBtn.addEventListener('click', async () => {
        const res = await window.bowserPages.settings.syncDisable({ wipeRemote: wipeEl.checked });
        // A failed remote wipe keeps sync ON (the accountId is the only handle
        // on the server copy) — leave the checkbox set for the retry and say why.
        wipeEl.checked = res.ok ? false : wipeEl.checked;
        render(res.status, res.ok ? null : res.message);
      });
    })();
  } else {
    document.getElementById('group-sync')?.remove();
  }

  // --- Settings sidebar: scroll-spy + click-to-scroll ---
  (function initSettingsNav() {
    // Drop nav links whose group was removed above (unsupported on this platform).
    for (const link of [...document.querySelectorAll('.settings-nav a')]) {
      if (!document.getElementById(`group-${link.dataset.group}`)) link.remove();
    }

    const links = [...document.querySelectorAll('.settings-nav a')];
    const activeGroups = links.map((link) => document.getElementById(`group-${link.dataset.group}`)).filter(Boolean);

    const setCurrent = (group) => {
      for (const link of links) link.classList.toggle('current', link.dataset.group === group);
    };

    // Score each group by how much of *itself* is on screen, highest wins.
    // (A fixed trigger line — the usual scroll-spy trick — fails here:
    // Privacy & Security's card is taller than Sync + Supporter combined, so
    // near the page bottom there's no scroll room left for their headers to
    // ever cross the line, and they'd be skipped.) On a positive tie (two
    // short trailing sections both fully visible) the later one wins, so
    // scrolling down keeps advancing; a zero-tie leaves `best` on the first
    // group rather than cascading to the last.
    function updateCurrent() {
      let best = null;
      let bestRatio = -1;
      for (const group of activeGroups) {
        const rect = group.getBoundingClientRect();
        const visible = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        const ratio = rect.height > 0 ? visible / rect.height : 0;
        if (ratio > bestRatio || (ratio > 0 && ratio === bestRatio)) { bestRatio = ratio; best = group; }
      }
      if (best) setCurrent(best.id.replace('group-', ''));
    }

    // A sidebar click pins its target through the smooth-scroll animation.
    // Otherwise clicking a short trailing section (Sync) — whose scrollIntoView
    // clamps at the page bottom, leaving it tied with Supporter — would let the
    // scorer settle the highlight on Supporter instead.
    let pinnedUntil = 0;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        if (Date.now() >= pinnedUntil) updateCurrent();
        ticking = false;
      });
    });
    updateCurrent();

    for (const link of links) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        setCurrent(link.dataset.group);
        pinnedUntil = Date.now() + 800; // outlasts the smooth-scroll animation
        document.getElementById(`group-${link.dataset.group}`)?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  })();
})();
