const isPrivate = new URLSearchParams(location.search).has('private');
const isMac = navigator.platform.startsWith('Mac');

// Opened as a private tab (blanc://newtab/?private=1): private theme,
// and the ledger's margin copy explains the deal instead of stats.
if (isPrivate) document.documentElement.dataset.theme = 'private';

document.getElementById('dateLine').textContent = isPrivate
  ? 'private tab'
  : new Date()
      .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
      .toLowerCase();

document.getElementById('goAnywhere').textContent = `${isMac ? '⌘' : 'Ctrl+'}L to go anywhere`;

if (isPrivate) {
  document.getElementById('footerLeft').textContent =
    'not saved to history · site data stays in a private in-memory session · passkeys created here are lost on quit';
}

window.bowserPages?.appVersion().then((version) => {
  document.getElementById('version').textContent = `v${version}`;
});

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

window.bowserPages?.bookmarks.list().then((items) => {
  const list = document.getElementById('favoritesList');
  if (!items.length) {
    const hint = document.createElement('div');
    hint.className = 'ledger-empty';
    hint.textContent = '♥ a page to pin it here';
    list.appendChild(hint);
    return;
  }
  for (const b of items.slice(0, 6)) {
    const row = document.createElement('a');
    row.className = 'fav';
    row.href = b.url;
    const host = hostOf(b.url);
    const tile = document.createElement('span');
    tile.className = 'tile';
    // Letter shows immediately and synchronously — never a blank tile
    // while a favicon is (maybe slowly) loading. Private tabs skip the
    // favicon entirely: fetching a bookmarked site's icon on every new
    // private tab would be a live network trace, which private mode
    // otherwise avoids.
    tile.textContent = (host || b.title || '').trim().charAt(0).toLowerCase() || '·';
    if (!isPrivate && b.favicon) {
      const probe = new Image();
      probe.onload = () => {
        tile.textContent = '';
        tile.classList.add('has-icon');
        tile.style.backgroundImage = `url("${b.favicon.replace(/["\\]/g, '\\$&')}")`;
      };
      // A stored favicon URL can go stale (site changed/removed it) —
      // clear it so future loads stop retrying a dead request.
      probe.onerror = () => window.bowserPages?.bookmarks.clearFavicon(b.url);
      probe.src = b.favicon;
    }
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = b.title || b.url;
    const hostEl = document.createElement('span');
    hostEl.className = 'host';
    hostEl.textContent = host;
    row.append(tile, name, hostEl);
    list.appendChild(row);
  }
});

// Tab sync: other devices' tabs, read-only — clicking navigates the current
// tab, same as favorites above. Renders only when snapshots exist so the
// ledger stays quiet otherwise. Re-rendered in place when a pull completes
// after first paint (pages:start:remote-tabs).
function renderRemote(remoteDevices) {
  const section = document.getElementById('remoteSection');
  const list = document.getElementById('remoteList');
  list.replaceChildren();
  section.hidden = !remoteDevices?.length;
  if (section.hidden) return;
  for (const device of remoteDevices) {
    for (const t of device.tabs.slice(0, 4)) {
      const row = document.createElement('a');
      row.className = 'fav';
      row.href = t.url;
      const host = hostOf(t.url);
      const tile = document.createElement('span');
      tile.className = 'tile';
      tile.textContent = (host || t.title || '').trim().charAt(0).toLowerCase() || '·';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = t.title || t.url;
      const hostEl = document.createElement('span');
      hostEl.className = 'host';
      hostEl.textContent = `${host} · ${device.name}`;
      row.append(tile, name, hostEl);
      list.appendChild(row);
    }
  }
}

window.bowserPages?.start.data().then(({ groups, blockedThisWeek, remoteDevices }) => {
  if (!isPrivate) {
    document.getElementById('footerLeft').textContent =
      `${blockedThisWeek.toLocaleString()} ads blocked this week`;
  }
  if (groups.length) {
    document.getElementById('groupsSection').hidden = false;
    const list = document.getElementById('groupsList');
    for (const g of groups) {
      const row = document.createElement('button');
      row.className = 'fav group-row';
      const cluster = document.createElement('span');
      cluster.className = 'cluster';
      for (let i = 0; i < Math.min(g.count, 5); i++) cluster.appendChild(document.createElement('i'));
      const name = document.createElement('span');
      name.className = 'gname';
      name.textContent = g.name;
      const count = document.createElement('span');
      count.className = 'gcount';
      count.textContent = g.count === 1 ? '1 tab' : `${g.count} tabs`;
      row.append(cluster, name, count);
      row.addEventListener('click', () => window.bowserPages.start.focusGroup(g.id));
      list.appendChild(row);
    }
  }
  renderRemote(remoteDevices);
});

window.bowserPages?.start.onRemoteTabs(renderRemote);
