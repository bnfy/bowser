const assert = require('node:assert/strict');
const test = require('node:test');

const { reorderWithinBucket } = require('../../src/main/tab-order');

const tabs = (entries) => new Map(entries.map(([id, groupId, pinned = false]) => [
  id,
  { id, groupId, pinned },
]));

test('moves a tab before another tab in the same group and pin bucket', () => {
  const model = tabs([
    ['a', 'work'],
    ['b', 'other'],
    ['c', 'work'],
    ['d', null],
  ]);

  assert.deepEqual(
    reorderWithinBucket(['a', 'b', 'c', 'd'], model, 'c', 'a'),
    ['c', 'a', 'b', 'd']
  );
});

test('rejects a beforeId in another group or pin bucket', () => {
  const model = tabs([
    ['a', 'work'],
    ['b', 'other'],
    ['c', 'work', true],
  ]);
  const order = ['a', 'b', 'c'];

  assert.equal(reorderWithinBucket(order, model, 'a', 'b'), null);
  assert.equal(reorderWithinBucket(order, model, 'a', 'c'), null);
  assert.equal(reorderWithinBucket(order, model, 'missing', 'a'), null);
  assert.equal(reorderWithinBucket(order, model, 'a', undefined), null);
  assert.deepEqual(order, ['a', 'b', 'c'], 'rejected requests never mutate the input');
});

test('beforeId:null moves to the end of the validated source bucket', () => {
  const model = tabs([
    ['a', 'work'],
    ['loose', null],
    ['b', 'work'],
    ['other', 'other'],
    ['c', 'work'],
  ]);

  assert.deepEqual(
    reorderWithinBucket(['a', 'loose', 'b', 'other', 'c'], model, 'a', null),
    ['loose', 'b', 'other', 'c', 'a']
  );
});

test('reordering preserves every non-source tab relative to every other one', () => {
  const model = tabs([
    ['a', 'work'],
    ['x', null],
    ['b', 'work'],
    ['y', 'other'],
  ]);

  const result = reorderWithinBucket(['a', 'x', 'b', 'y'], model, 'b', 'a');
  assert.deepEqual(result, ['b', 'a', 'x', 'y']);
  assert.deepEqual(result.filter((id) => id !== 'b'), ['a', 'x', 'y']);
});

test('a same-id target and a single-member bucket are accepted no-ops', () => {
  const model = tabs([
    ['a', 'work'],
    ['b', 'other'],
  ]);
  const order = ['a', 'b'];

  assert.deepEqual(reorderWithinBucket(order, model, 'a', 'a'), order);
  assert.deepEqual(reorderWithinBucket(order, model, 'a', null), order);
});
