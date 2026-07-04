(async () => {
  const theme = document.getElementById('theme');
  const searchEngine = document.getElementById('searchEngine');
  const adblockEnabled = document.getElementById('adblockEnabled');
  const homePage = document.getElementById('homePage');

  const { settings, searchEngines } = await window.bowserPages.settings.get();

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

  theme.addEventListener('change', () =>
    window.bowserPages.settings.set({ theme: theme.value }));
  searchEngine.addEventListener('change', () =>
    window.bowserPages.settings.set({ searchEngine: searchEngine.value }));
  adblockEnabled.addEventListener('change', () =>
    window.bowserPages.settings.set({ adblockEnabled: adblockEnabled.checked }));
  homePage.addEventListener('change', () =>
    window.bowserPages.settings.set({ homePage: homePage.value }));

  // --- Extensions ---
  const extensionList = document.getElementById('extensionList');

  async function refreshExtensions() {
    const items = await window.bowserPages.extensions.list();
    extensionList.replaceChildren();

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No extensions installed.';
      extensionList.append(empty);
      return;
    }

    for (const ext of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const row = document.createElement('div');
      row.className = 'row';

      const main = document.createElement('div');
      main.className = 'main';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = ext.name;
      main.append(title);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `v${ext.version}`;

      const actions = document.createElement('div');
      actions.className = 'actions';
      const remove = document.createElement('button');
      remove.className = 'danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        await window.bowserPages.extensions.remove(ext.id);
        refreshExtensions();
      });
      actions.append(remove);

      row.append(main, meta, actions);
      extensionList.append(row);
    }
  }

  refreshExtensions();

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
