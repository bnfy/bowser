const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { FiltersEngine, Request } = require('@ghostery/adblocker');

const SOURCES = path.resolve(__dirname, '../../adblock/sources');
const GENERATED = path.resolve(__dirname, '../../adblock/generated');

function loadEngine() {
  const easylist = fs.readFileSync(path.join(SOURCES, 'easylist.txt'), 'utf8');
  const easyprivacy = fs.readFileSync(path.join(SOURCES, 'easyprivacy.txt'), 'utf8');
  return FiltersEngine.parse(easylist + '\n' + easyprivacy);
}

function match(engine, url, type = 'xmlhttprequest') {
  const req = Request.fromRawDetails({
    url,
    sourceUrl: 'https://www.youtube.com/watch?v=test',
    type,
  });
  return engine.match(req);
}

test('pinned filter lists match YouTube ad endpoints', async (t) => {
  const engine = loadEngine();

  const adUrls = [
    'https://www.youtube.com/pagead/interaction/?ai=abc',
    'https://www.youtube.com/pagead/lvz?foo=1',
    'https://www.youtube.com/youtubei/v1/player/ad_break?key=AIza',
    'https://www.youtube.com/api/stats/ads?ver=2&docid=xyz',
    'https://www.youtube.com/get_midroll_info?v=abc',
  ];

  for (const url of adUrls) {
    await t.test(`blocks ${new URL(url).pathname}`, () => {
      const result = match(engine, url);
      assert.equal(result.match, true, `expected ${url} to be blocked`);
    });
  }
});

test('pinned filter lists do not match normal YouTube playback URLs', async (t) => {
  const engine = loadEngine();

  const normalUrls = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'document'],
    ['https://www.youtube.com/', 'document'],
    ['https://www.youtube.com/youtubei/v1/player?key=AIza', 'xmlhttprequest'],
    ['https://rr1---sn-abc.googlevideo.com/videoplayback?id=xyz', 'media'],
    ['https://www.youtube.com/s/player/abcdef/player_ias.vflset/en_US/base.js', 'script'],
  ];

  for (const [url, type] of normalUrls) {
    await t.test(`allows ${new URL(url).pathname}`, () => {
      const result = match(engine, url, type);
      assert.equal(result.match, false, `expected ${url} to be allowed`);
    });
  }
});

test('WebKit blocklist contains YouTube ad-blocking rules', () => {
  const rules = JSON.parse(
    fs.readFileSync(path.join(GENERATED, 'blocklist.json'), 'utf8')
  );

  const youtubeBlocks = rules.filter(
    (r) =>
      r.action.type === 'block' &&
      /youtube\\?\.com/.test(r.trigger['url-filter'])
  );

  const patterns = youtubeBlocks.map((r) => r.trigger['url-filter']);

  assert.ok(
    patterns.some((p) => /pagead/.test(p)),
    'blocklist should contain a pagead rule for youtube.com'
  );
  assert.ok(
    patterns.some((p) => /ad_break/.test(p)),
    'blocklist should contain an ad_break rule for youtube.com'
  );
  assert.ok(
    patterns.some((p) => /api\/stats\/ads/.test(p)),
    'blocklist should contain an ads stats rule for youtube.com'
  );
});
