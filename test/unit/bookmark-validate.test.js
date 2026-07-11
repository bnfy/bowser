const assert = require('node:assert/strict');
const test = require('node:test');
const { validFavicon, validFolder, folderKey } = require('../../src/main/bookmark-validate');

test('validFavicon accepts http(s) and data:image, rejects others and over-long', () => {
  assert.equal(validFavicon('https://x.com/f.ico'), 'https://x.com/f.ico');
  assert.equal(validFavicon('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(validFavicon('javascript:alert(1)'), null);
  assert.equal(validFavicon('data:text/html,x'), null);
  assert.equal(validFavicon('data:image/png;base64,' + 'A'.repeat(3000)), null);
  assert.equal(validFavicon(42), null);
});

test('validFolder trims, caps at 100 chars, else null', () => {
  assert.equal(validFolder('  Work  '), 'Work');
  assert.equal(validFolder(''), null);
  assert.equal(validFolder('   '), null);
  assert.equal(validFolder('x'.repeat(100)), 'x'.repeat(100));
  assert.equal(validFolder('x'.repeat(101)), null);
  assert.equal(validFolder(null), null);
});

test('folderKey lowercases and trims; non-string is empty', () => {
  assert.equal(folderKey('  Work '), 'work');
  assert.equal(folderKey('WORK'), 'work');
  assert.equal(folderKey(null), '');
});
