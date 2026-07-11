(async () => {
  const list = document.getElementById('list');
  const importBtn = document.getElementById('importBtn');
  const importStatus = document.getElementById('importStatus');

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function importSummary(added, skipped) {
    if (added === 0 && skipped > 0) return `All ${plural(skipped, 'favorite')} were already saved.`;
    const tail = skipped > 0 ? ` (skipped ${skipped} already saved)` : '';
    return `Imported ${plural(added, 'favorite')}${tail}.`;
  }

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    importStatus.textContent = 'Choose a bookmarks file…';
    const res = await window.bowserPages.bookmarks.import();
    importBtn.disabled = false;
    if (res.cancelled) { importStatus.textContent = ''; return; }
    if (res.error === 'empty') { importStatus.textContent = 'No bookmarks found in that file.'; return; }
    if (res.error === 'unreadable') { importStatus.textContent = "Couldn't read that file."; return; }
    if (res.error === 'too-large') { importStatus.textContent = 'That file is too large to import.'; return; }
    importStatus.textContent = importSummary(res.added, res.skipped);
    refresh();
  });

  const folderKey = (name) => (typeof name === 'string' ? name.trim().toLowerCase() : '');
  const byDateDesc = (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0);

  function group(items) {
    const byKey = new Map();       // key -> { name, items }
    const ungrouped = [];
    for (const b of items) {
      if (b.folder == null) { ungrouped.push(b); continue; }
      const key = folderKey(b.folder);
      if (!byKey.has(key)) byKey.set(key, { name: b.folder, items: [] });
      byKey.get(key).items.push(b);
    }
    const folders = [...byKey.values()].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const f of folders) f.items.sort(byDateDesc);
    ungrouped.sort(byDateDesc);
    return { folders, ungrouped, names: folders.map((f) => f.name) };
  }

  async function refresh() {
    const items = await window.bowserPages.bookmarks.list();
    list.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No favorites yet. Press Ctrl/Cmd+D on a page to add one, or use Import.';
      list.append(empty);
      return;
    }
    const { folders, ungrouped, names } = group(items);
    for (const f of folders) list.append(folderSection(f, names));
    if (ungrouped.length) list.append(ungroupedSection(ungrouped, names));
  }

  function folderSection(folder, allNames) {
    const section = document.createElement('section');
    section.className = 'folder-section';

    const head = document.createElement('div');
    head.className = 'folder-header';
    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = folder.name;
    const count = document.createElement('span');
    count.className = 'folder-count';
    count.textContent = String(folder.items.length);

    const acts = document.createElement('div');
    acts.className = 'folder-actions';
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => startRename(head, folder.name));
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove folder';
    removeBtn.addEventListener('click', async () => {
      await window.bowserPages.bookmarks.removeFolder(folder.name);
      refresh();
    });
    acts.append(renameBtn, removeBtn);
    head.append(name, count, acts);
    section.append(head);
    for (const b of folder.items) section.append(row(b, allNames));
    return section;
  }

  function ungroupedSection(items, allNames) {
    const section = document.createElement('section');
    section.className = 'folder-section';
    if (allNames.length) {
      const head = document.createElement('div');
      head.className = 'folder-header';
      const name = document.createElement('span');
      name.className = 'folder-name folder-name-dim';
      name.textContent = 'Ungrouped';
      head.append(name);
      section.append(head);
    }
    for (const b of items) section.append(row(b, allNames));
    return section;
  }

  function startRename(head, oldName) {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 100;
    input.value = oldName;
    input.className = 'folder-rename-input';
    // One-shot guard shared by Enter/Escape/blur: Escape (and Enter) call
    // refresh(), which detaches the input and fires its own blur handler —
    // without this guard, an Escape-cancel would still commit via that blur.
    let settled = false;
    const commit = async () => {
      if (settled) return;
      settled = true;
      const next = input.value.trim();
      if (next && next !== oldName) await window.bowserPages.bookmarks.renameFolder(oldName, next);
      refresh();
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      refresh();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
    head.replaceChildren(input);
    input.focus();
    input.select();
  }

  function row(b, allNames) {
    const el = document.createElement('div');
    el.className = 'row';

    const main = document.createElement('div');
    main.className = 'main';
    const title = document.createElement('a');
    title.className = 'title';
    title.href = b.url;
    title.textContent = b.title;
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = b.url;
    main.append(title, url);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = new Date(b.addedAt).toLocaleDateString();

    const actions = document.createElement('div');
    actions.className = 'actions bookmark-actions';
    const folderBtn = document.createElement('button');
    folderBtn.type = 'button';
    folderBtn.className = 'folder-chip';
    folderBtn.textContent = b.folder ? `▸ ${b.folder}` : '▸ folder';
    folderBtn.addEventListener('click', () => openPicker(folderBtn, b, allNames));
    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      await window.bowserPages.bookmarks.remove(b.id);
      refresh();
    });
    actions.append(folderBtn, remove);

    el.append(main, meta, actions);
    return el;
  }

  let openMenu = null;
  function closeMenu() { openMenu?.remove(); openMenu = null; }
  document.addEventListener('click', (e) => {
    if (openMenu && !openMenu.contains(e.target) && !e.target.classList.contains('folder-chip')) closeMenu();
  });

  function openPicker(anchor, b, allNames) {
    if (openMenu) { closeMenu(); return; }
    const menu = document.createElement('div');
    menu.className = 'folder-picker';
    const pick = async (fn) => { await fn(); closeMenu(); refresh(); };

    for (const nm of allNames) {
      if (folderKey(nm) === folderKey(b.folder)) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'picker-item';
      item.textContent = `→ ${nm}`;
      item.addEventListener('click', () => pick(() => window.bowserPages.bookmarks.setFolder(b.id, nm)));
      menu.append(item);
    }
    if (b.folder) {
      const none = document.createElement('button');
      none.type = 'button';
      none.className = 'picker-item';
      none.textContent = '→ none';
      none.addEventListener('click', () => pick(() => window.bowserPages.bookmarks.setFolder(b.id, null)));
      menu.append(none);
    }
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 100;
    nameInput.placeholder = 'new folder…';
    nameInput.className = 'picker-new';
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = nameInput.value.trim();
        if (v) pick(() => window.bowserPages.bookmarks.setFolder(b.id, v));
      } else if (e.key === 'Escape') closeMenu();
    });
    menu.append(nameInput);

    anchor.parentElement.append(menu);
    openMenu = menu;
    nameInput.focus();
  }

  refresh();
})();
