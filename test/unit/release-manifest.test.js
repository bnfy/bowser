const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const verify = path.join(root, 'scripts/verify-release-manifest.mjs');
const checksums = path.join(root, 'scripts/create-checksums.mjs');
const version = '1.0.0-rc.1';
const macFiles = [
  `Blanc-${version}-arm64-mac.zip`,
  `Blanc-${version}-arm64-mac.zip.blockmap`,
  `Blanc-${version}-arm64.dmg`,
  `Blanc-${version}-arm64.dmg.blockmap`,
  `Blanc-${version}-mac.zip`,
  `Blanc-${version}-mac.zip.blockmap`,
  `Blanc-${version}.dmg`,
  `Blanc-${version}.dmg.blockmap`,
  'latest-mac.yml',
];
const linuxFiles = [`Blanc-${version}.AppImage`, 'latest-linux.yml'];
const armMacFiles = macFiles.filter((name) => name === 'latest-mac.yml' || name.includes('arm64'));

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-release-manifest-'));
  for (const file of files) fs.writeFileSync(path.join(dir, file), `fixture:${file}`);
  return dir;
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('verifies the exact selected platform set and generated checksums', () => {
  const dir = fixture([...macFiles, ...linuxFiles]);
  assert.equal(run(checksums, [dir]).status, 0);
  const result = run(verify, [
    '--dir', dir,
    '--version', version,
    '--platforms', 'mac,linux',
  ]);
  assert.equal(result.status, 0, result.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fails closed on a missing, stale, or unexpected artifact', () => {
  const missing = fixture(macFiles.slice(1));
  assert.equal(run(verify, [
    '--dir', missing,
    '--version', version,
    '--platforms', 'mac',
  ]).status, 1);

  const unexpected = fixture([...macFiles, 'old-release.dmg']);
  assert.equal(run(verify, [
    '--dir', unexpected,
    '--version', version,
    '--platforms', 'mac',
  ]).status, 1);

  fs.rmSync(missing, { recursive: true, force: true });
  fs.rmSync(unexpected, { recursive: true, force: true });
});

test('an explicit arm64-only release rejects unselected Intel assets', () => {
  const armOnly = fixture(armMacFiles);
  assert.equal(run(verify, [
    '--dir', armOnly,
    '--version', version,
    '--platforms', 'mac',
    '--mac-arches', 'arm64',
  ]).status, 0);

  fs.writeFileSync(path.join(armOnly, `Blanc-${version}.dmg`), 'unexpected Intel');
  assert.equal(run(verify, [
    '--dir', armOnly,
    '--version', version,
    '--platforms', 'mac',
    '--mac-arches', 'arm64',
  ]).status, 1);
  fs.rmSync(armOnly, { recursive: true, force: true });
});

test('detects checksum tampering', () => {
  const dir = fixture(macFiles);
  assert.equal(run(checksums, [dir]).status, 0);
  fs.appendFileSync(path.join(dir, macFiles[0]), 'tampered');
  assert.notEqual(run(verify, [
    '--dir', dir,
    '--version', version,
    '--platforms', 'mac',
  ]).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('release policy stages a draft and refuses unsigned or unexpected Windows publishers', () => {
  const releaseScript = fs.readFileSync(path.join(root, 'scripts/release.sh'), 'utf8');
  const releaseWorkflow = fs.readFileSync(
    path.join(root, '.github/workflows/release-windows-linux.yml'),
    'utf8'
  );
  const allWorkflows = fs.readdirSync(path.join(root, '.github/workflows'))
    .filter((name) => name.endsWith('.yml'))
    .map((name) => fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8'))
    .join('\n');

  assert.ok(releaseScript.indexOf('--draft') < releaseScript.indexOf('--draft=false'));
  assert.match(releaseScript, /verify-release-manifest\.mjs/);
  assert.match(releaseScript, /SHA256SUMS/);
  assert.match(releaseWorkflow, /Refusing to build an unsigned press artifact/);
  assert.match(releaseWorkflow, /Unexpected Windows publisher/);
  assert.match(releaseWorkflow, /Get-AuthenticodeSignature/);
  assert.doesNotMatch(allWorkflows, /actions\/(?:checkout|setup-node)@v7/);
  assert.match(allWorkflows, /actions\/checkout@v6/);
  assert.match(allWorkflows, /actions\/setup-node@v6/);
});
