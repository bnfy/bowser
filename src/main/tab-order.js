// Pure drag-order validation for the vertical rail. The main process remains
// the sole mutator of tabOrder; this helper only returns a proposed order.

function tabFor(tabs, id) {
  if (tabs instanceof Map) return tabs.get(id);
  return tabs?.[id];
}

function sameBucket(a, b) {
  return !!a && !!b
    && (a.groupId ?? null) === (b.groupId ?? null)
    && !!a.pinned === !!b.pinned;
}

/**
 * Move `id` before `beforeId`, but only inside the source tab's exact
 * {groupId,pinned} bucket. A null beforeId means the end of that bucket.
 *
 * Returns a fresh order for an accepted request (including an accepted
 * no-op), or null when the request is invalid.
 *
 * @param {string[]} order
 * @param {Map<string, object>|Record<string, object>} tabs
 * @param {string} id
 * @param {string|null} beforeId
 * @returns {string[]|null}
 */
function reorderWithinBucket(order, tabs, id, beforeId) {
  if (!Array.isArray(order)) return null;
  const sourceIndex = order.indexOf(id);
  const source = tabFor(tabs, id);
  if (sourceIndex === -1 || !source) return null;

  if (beforeId === id) return [...order];

  if (beforeId !== null) {
    const target = tabFor(tabs, beforeId);
    if (order.indexOf(beforeId) === -1 || !sameBucket(source, target)) return null;
  }

  const next = [...order];
  next.splice(sourceIndex, 1);

  if (beforeId !== null) {
    next.splice(next.indexOf(beforeId), 0, id);
    return next;
  }

  // The source is the bucket's only member: there is no meaningful "end"
  // to move to, so preserve its position instead of crossing other buckets.
  let lastBucketIndex = -1;
  for (let i = 0; i < next.length; i += 1) {
    if (sameBucket(source, tabFor(tabs, next[i]))) lastBucketIndex = i;
  }
  if (lastBucketIndex === -1) return [...order];

  next.splice(lastBucketIndex + 1, 0, id);
  return next;
}

module.exports = { sameBucket, reorderWithinBucket };
