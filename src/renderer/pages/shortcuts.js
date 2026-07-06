// The shortcut sections are rendered from the live application menu
// (pages:shortcuts:list), so they can never drift from the real bindings.
// Only SLASH_COMMANDS below is maintained by hand — keep it in sync with
// the command table in overlay.js.
const SLASH_COMMANDS = [
  ['/favorites', 'Open favorites'],
  ['/history', 'Open browsing history'],
  ['/downloads', 'Open downloads'],
  ['/settings', 'Open settings'],
  ['/clear', 'Clear browsing history'],
  ['/new', 'Open a new tab'],
  ['/private', 'Open a private tab (history stays untouched)'],
  ['/close', 'Close this tab'],
  ['/pin', 'Pin or unpin this tab'],
  ['/mute', 'Mute or unmute this tab'],
  ['/group <name>', 'Move this tab into a group, creating it on first use'],
  ['/ungroup', 'Take this tab out of its group'],
  ['/close-group', 'Close every tab in this group'],
  ['/find', 'Find in page'],
  ['/block-ads', 'Toggle ad & tracker blocking'],
  ['/allow-ads', 'Allow ads on this site'],
  ['/theme', 'Cycle appearance (system → light → dark)'],
];

/** One titled section of label/keys rows. */
function section(title, pairs) {
  const wrap = document.createElement('section');
  wrap.className = 'shortcut-section';
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = title;
  wrap.appendChild(heading);
  const list = document.createElement('div');
  list.className = 'shortcut-list';
  for (const [label, keys] of pairs) {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    const name = document.createElement('span');
    name.textContent = label;
    const kbd = document.createElement('kbd');
    kbd.textContent = keys;
    row.append(name, kbd);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

(async () => {
  const rows = await window.bowserPages.shortcuts.list();
  const byCategory = new Map();
  for (const row of rows) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push([row.label, row.keys]);
  }
  const root = document.getElementById('sections');
  for (const [title, pairs] of byCategory) root.appendChild(section(title, pairs));
  root.appendChild(section('Slash Commands', SLASH_COMMANDS.map(([cmd, hint]) => [hint, cmd])));
})();
