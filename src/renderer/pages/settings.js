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
})();
