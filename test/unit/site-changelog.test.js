const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '../..');
const SCRIPT_PATH = path.join(ROOT, 'scripts/generate-site-changelog.mjs');
const FIXTURE_PATH = path.join(ROOT, 'test/fixtures/site-releases.json');
let changelog;
let fixture;

test.before(async () => {
  changelog = await import(pathToFileURL(SCRIPT_PATH));
  fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
});

test('normalization filters drafts and prereleases without inventing version gaps', () => {
  const releases = changelog.normalizeReleases([...fixture].reverse());
  assert.deepEqual(releases.map((release) => release.tag), ['v0.15.5', 'v0.15.4', 'v0.15.3']);
  assert.ok(!releases.some((release) => release.tag === 'v0.15.2'));
  assert.equal(releases[0].anchor, 'v0-15-5');
});

test('generated GitHub notes become clean labels and validated links', () => {
  const notes = changelog.parseGeneratedNotes(fixture[0].body);
  assert.deepEqual(notes.changes, [{
    text: 'fix(webauthn): Touch ID passkeys — entitlement, provisioning profile, verified signing chain',
    url: 'https://github.com/bnfy/blanc/pull/32',
  }]);
  assert.equal(notes.compareUrl, 'https://github.com/bnfy/blanc/compare/v0.15.4...v0.15.5');
  assert.deepEqual(notes.extraParagraphs, []);
});

test('non-Blanc links never become link URLs in the release data', () => {
  const notes = changelog.parseGeneratedNotes([
    '## What\'s Changed',
    '* fix: <script>alert(1)</script> by @attacker in https://example.com/bnfy/blanc/pull/9',
    '**Full Changelog**: https://example.com/compare/a...b',
  ].join('\n'));
  assert.equal(notes.changes[0].url, null);
  assert.equal(notes.compareUrl, null);

  const release = changelog.normalizeReleases([{
    html_url: 'https://example.com/fake',
    tag_name: 'v1.0.0<script>',
    name: '<script>',
    draft: false,
    prerelease: false,
    published_at: '2026-07-11T00:00:00Z',
    body: '* fix: <script>alert(1)</script> by @attacker in https://example.com/bnfy/blanc/pull/9',
  }]);
  const json = changelog.renderReleasesJson(release);
  const parsed = JSON.parse(json);
  assert.equal(parsed[0].changes[0].url, null);
  assert.equal(parsed[0].changes[0].text, 'fix: <script>alert(1)</script>');
  // HTML-escaping is Astro's job at render time; the data keeps raw text.
});

test('pre-rename bnfy/bowser release links are rewritten to the current repo name', () => {
  const notes = changelog.parseGeneratedNotes([
    '## What\'s Changed',
    '* fix(updater): quit-and-install on Windows by @bnfy in https://github.com/bnfy/bowser/pull/7',
    '**Full Changelog**: https://github.com/bnfy/bowser/compare/v0.9.2...v0.9.3',
  ].join('\n'));
  assert.equal(notes.changes[0].url, 'https://github.com/bnfy/blanc/pull/7');
  assert.equal(notes.compareUrl, 'https://github.com/bnfy/blanc/compare/v0.9.2...v0.9.3');
  assert.deepEqual(notes.extraParagraphs, []);
});

test('the legacy Bowser name is scrubbed from visitor-facing release text', () => {
  assert.equal(changelog.scrubLegacyName('Bowser rebrand release: identity rebrand.'), 'Blanc rebrand release: identity rebrand.');
  assert.equal(changelog.scrubLegacyName('Add getbowser.com marketing site'), 'Add blancbrowser.com marketing site');

  const notes = changelog.parseGeneratedNotes([
    '## What\'s Changed',
    '* Rename Bowser to Blanc by @bnfy in https://github.com/bnfy/bowser/pull/3',
    '',
    'Bowser rebrand release: identity rebrand.',
  ].join('\n'));
  assert.equal(notes.changes[0].text, 'Rename Blanc to Blanc');
  assert.deepEqual(notes.extraParagraphs, ['Blanc rebrand release: identity rebrand.']);
  assert.ok(!changelog.renderReleasesJson(changelog.normalizeReleases([{
    html_url: 'https://github.com/bnfy/bowser/releases/tag/v0.2.0',
    tag_name: 'v0.2.0', name: '0.2.0', draft: false, prerelease: false,
    published_at: '2026-07-04T00:00:00Z',
    body: 'Bowser rebrand release: identity rebrand.',
  }])).toLowerCase().includes('bowser'));
});

test('new-contributor notes become linked text instead of raw URLs', () => {
  const notes = changelog.parseGeneratedNotes([
    '## What\'s Changed',
    '* Add getbowser.com marketing site by @bnfy in https://github.com/bnfy/bowser/pull/1',
    '',
    '## New Contributors',
    '* @bnfy made their first contribution in https://github.com/bnfy/bowser/pull/1',
    '',
    '**Full Changelog**: https://github.com/bnfy/bowser/compare/v0.6.2...v0.7.0',
  ].join('\n'));
  assert.deepEqual(notes.changes[0], {
    text: 'Add blancbrowser.com marketing site',
    url: 'https://github.com/bnfy/blanc/pull/1',
  });
  assert.deepEqual(notes.changes[1], {
    text: '@bnfy made their first contribution',
    url: 'https://github.com/bnfy/blanc/pull/1',
  });
  assert.deepEqual(notes.extraParagraphs, []);
});

test('GitHub-looking URLs with embedded credentials are not trusted', () => {
  const notes = changelog.parseGeneratedNotes(
    '* fix: misleading host by @attacker in https://evil.example@github.com/bnfy/blanc/pull/9'
  );
  assert.deepEqual(notes.changes, [{ text: 'fix: misleading host', url: null }]);
});

test('release data is deterministic and RSS is capped at twenty newest releases', async () => {
  const { renderRss } = await import(pathToFileURL(path.join(ROOT, 'site/src/lib/rss.mjs')));
  const raw = Array.from({ length: 23 }, (_, index) => ({
    html_url: `https://github.com/bnfy/blanc/releases/tag/v1.0.${index}`,
    tag_name: `v1.0.${index}`,
    name: `1.0.${index}`,
    draft: false,
    prerelease: false,
    published_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    body: `* fix: release ${index}`,
  }));
  const releases = changelog.normalizeReleases(raw);
  assert.equal(changelog.renderReleasesJson(releases), changelog.renderReleasesJson(releases));
  const rss = renderRss(releases);
  assert.equal((rss.match(/<item>/g) || []).length, 20);
  assert.match(rss, /<lastBuildDate>Fri, 23 Jan 2026 00:00:00 GMT<\/lastBuildDate>/);
});

test('normalized releases carry pre-rendered New-York dates', () => {
  const releases = changelog.normalizeReleases([{
    html_url: 'https://github.com/bnfy/blanc/releases/tag/v1.0.0',
    tag_name: 'v1.0.0', name: '1.0.0', draft: false, prerelease: false,
    // 01:30 UTC on the 12th is the evening of the 11th in New York.
    published_at: '2026-07-12T01:30:00Z',
    body: '* fix: something',
  }]);
  assert.equal(releases[0].humanDate, 'July 11, 2026');
  assert.equal(releases[0].machineDate, '2026-07-11');
});

test('paginated adjacent JSON arrays are parsed without corrupting strings', () => {
  const pages = '[{"body":"] [ inside a string"}]\n[{"tag_name":"v2"}]\n';
  assert.deepEqual(changelog.parseJsonDocuments(pages), [
    [{ body: '] [ inside a string' }],
    [{ tag_name: 'v2' }],
  ]);
});

test('offline CLI writes release data and --check fails after it goes stale', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-changelog-'));
  const args = ['--input', FIXTURE_PATH, '--output-dir', outputDir];
  const generate = spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: 'utf8' });
  assert.equal(generate.status, 0, generate.stderr);
  const jsonPath = path.join(outputDir, 'releases.json');
  assert.ok(fs.existsSync(jsonPath));
  JSON.parse(fs.readFileSync(jsonPath, 'utf8')); // valid JSON

  const fresh = spawnSync(process.execPath, [SCRIPT_PATH, ...args, '--check'], { encoding: 'utf8' });
  assert.equal(fresh.status, 0, fresh.stderr);

  fs.appendFileSync(jsonPath, '\n');
  const stale = spawnSync(process.execPath, [SCRIPT_PATH, ...args, '--check'], { encoding: 'utf8' });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale or missing/);
});
