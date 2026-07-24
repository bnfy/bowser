const assert = require('node:assert/strict');
const test = require('node:test');

const { UTILITY_PAGES, isUtilityUrl } = require('../../src/main/utility-pages');

test('isUtilityUrl: utility hosts match, with paths and queries', () => {
  assert.equal(isUtilityUrl('blanc://bookmarks/'), true);
  assert.equal(isUtilityUrl('blanc://history/'), true);
  assert.equal(isUtilityUrl('blanc://downloads/'), true);
  assert.equal(isUtilityUrl('blanc://settings/'), true);
  assert.equal(isUtilityUrl('blanc://shortcuts/'), true);
  assert.equal(isUtilityUrl('blanc://settings/?section=sync'), true);
});

test('isUtilityUrl: non-utility internal pages and other schemes do not match', () => {
  assert.equal(isUtilityUrl('blanc://newtab/'), false);
  assert.equal(isUtilityUrl('blanc://newtab/?private=1'), false);
  assert.equal(isUtilityUrl('blanc://error/?url=x'), false);
  assert.equal(isUtilityUrl('blanc://auth/'), false);
  assert.equal(isUtilityUrl('https://settings/'), false);
  assert.equal(isUtilityUrl('https://example.com/blanc://settings/'), false);
  assert.equal(isUtilityUrl('not a url'), false);
  assert.equal(isUtilityUrl(''), false);
  assert.equal(isUtilityUrl(undefined), false);
});

test('UTILITY_PAGES is exactly the five sheet pages', () => {
  assert.deepEqual([...UTILITY_PAGES].sort(),
    ['bookmarks', 'downloads', 'history', 'settings', 'shortcuts']);
});
