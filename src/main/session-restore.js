// Pure restore-time filter (design §6 of 2026-07-22-utility-sheet-design):
// session.json holds parallel arrays (urls / groupIds / pinned) plus
// activeIndex, so dropping entries must be zipped or the metadata silently
// misaligns onto the wrong tabs.

/**
 * @param {{urls?: string[], groupIds?: (string|null)[], pinned?: boolean[], activeIndex?: number}} saved
 * @param {(url: string) => boolean} shouldDrop
 */
function filterRestoredSession({ urls = [], groupIds = [], pinned = [], activeIndex = 0 } = {}, shouldDrop) {
  const survivors = [];
  for (const [i, url] of urls.entries()) {
    if (shouldDrop(url)) continue;
    survivors.push({ url, groupId: groupIds[i] ?? null, pinned: !!pinned[i], originalIndex: i });
  }
  const clamped = Math.min(Math.max(0, activeIndex), Math.max(0, urls.length - 1));
  // The survivor at the original index, else the next surviving neighbor
  // (first after, falling back to last before), else 0.
  let next = survivors.findIndex((s) => s.originalIndex >= clamped);
  if (next === -1) next = survivors.length - 1;
  if (next === -1) next = 0;
  return {
    urls: survivors.map((s) => s.url),
    groupIds: survivors.map((s) => s.groupId),
    pinned: survivors.map((s) => s.pinned),
    activeIndex: next,
  };
}

module.exports = { filterRestoredSession };
