(async () => {
  const theme = document.getElementById('theme');
  const searchEngine = document.getElementById('searchEngine');
  const adblockEnabled = document.getElementById('adblockEnabled');
  const homePage = document.getElementById('homePage');
  const usagePing = document.getElementById('usagePing');

  const { settings, searchEngines, appIcons, supporterIcons } = await window.bowserPages.settings.get();

  for (const [key, label] of Object.entries(searchEngines)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    searchEngine.append(opt);
  }
  theme.value = settings.theme ?? 'system';
  searchEngine.value = settings.searchEngine;
  adblockEnabled.checked = settings.adblockEnabled;
  homePage.value = settings.homePage;
  usagePing.checked = settings.usagePing;

  theme.addEventListener('change', () =>
    window.bowserPages.settings.set({ theme: theme.value }));
  searchEngine.addEventListener('change', () =>
    window.bowserPages.settings.set({ searchEngine: searchEngine.value }));
  adblockEnabled.addEventListener('change', () =>
    window.bowserPages.settings.set({ adblockEnabled: adblockEnabled.checked }));
  homePage.addEventListener('change', () =>
    window.bowserPages.settings.set({ homePage: homePage.value }));
  usagePing.addEventListener('change', () =>
    window.bowserPages.settings.set({ usagePing: usagePing.checked }));

  // --- Default browser (live OS state, nothing stored) ---
  const defaultBrowserSetting = document.getElementById('defaultBrowserSetting');
  if (navigator.platform.includes('Linux')) {
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

  if (!navigator.platform.startsWith('Mac')) {
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

  // --- Site permissions ---
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
      const [origin, permission] = key.split('|');
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
      meta.textContent = `${PERMISSION_LABELS[permission] ?? permission} — ${decision === 'allow' ? 'Allowed' : 'Blocked'}`;

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

  // --- Ad-block exceptions ---
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

  // --- Clear browsing data ---
  const clearBrowsingData = document.getElementById('clearBrowsingData');
  const clearBrowsingDataStatus = document.getElementById('clearBrowsingDataStatus');

  clearBrowsingData.addEventListener('click', async () => {
    if (!confirm('Clear all cookies, cache, and site data? You will be logged out of everything.')) return;
    await window.bowserPages.clearBrowsingData();
    clearBrowsingDataStatus.textContent = 'Cleared.';
    setTimeout(() => { clearBrowsingDataStatus.textContent = ''; }, 2000);
  });
})();
