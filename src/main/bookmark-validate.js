// Pure, Electron-free validators shared by bookmark-import.js, bookmark-data.js
// and bookmarks.js. Kept out of bookmarks.js so importing them can't drag in
// the JsonStore singleton (which needs Electron's app at construction), which
// would make these untestable under `node --test`.

/** Same allow-list/length cap as the async-refined favicon path in main.js. */
function validFavicon(favicon) {
  return typeof favicon === 'string' && favicon.length <= 2048 && /^(https?:|data:image\/)/i.test(favicon)
    ? favicon
    : null;
}

/** A storable folder name, or null (= ungrouped). null is ONLY ever an
 * explicit ungroup — callers must treat a null result from a non-null input
 * as "reject", not "ungroup". */
function validFolder(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 100 ? trimmed : null;
}

/** Case-insensitive folder identity key. Work and work are one folder. */
function folderKey(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

module.exports = { validFavicon, validFolder, folderKey };
