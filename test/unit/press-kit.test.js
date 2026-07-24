const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function pngSize(relativePath) {
  const bytes = fs.readFileSync(path.join(ROOT, relativePath));
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test('press-kit raster assets exist at their declared editorial dimensions', () => {
  assert.deepEqual(
    pngSize('site/public/press/vertical-tabs.png'),
    { width: 1400, height: 888 }
  );
  assert.deepEqual(
    pngSize('site/public/press/blanc-1.0-social.png'),
    { width: 1200, height: 630 }
  );
});

test('the unlisted press page keeps its release links and discovery boundary explicit', () => {
  const page = fs.readFileSync(path.join(ROOT, 'site/src/pages/press.astro'), 'utf8');
  const sitemap = fs.readFileSync(path.join(ROOT, 'site/src/pages/sitemap.xml.js'), 'utf8');
  const packageVersion = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  ).version;

  assert.equal(packageVersion, '1.0.0-rc.1');
  assert.match(page, new RegExp(`const VERSION = '${packageVersion.replaceAll('.', '\\.')}'`));
  assert.equal(
    fs.existsSync(path.join(ROOT, `docs/press/release-notes/v${packageVersion}.md`)),
    true
  );
  assert.match(page, /robots="noindex,nofollow,noarchive"/);
  assert.match(page, /analytics=\{false\}/);
  assert.match(page, /Blanc-\$\{VERSION\}-arm64\.dmg/);
  assert.match(page, /SHA256SUMS/);
  assert.match(sitemap, /new Set\(\['\/press'\]\)/);
});
