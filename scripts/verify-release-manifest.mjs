#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) throw new Error(`unexpected argument: ${value}`);
    const key = value.slice(2);
    args[key] = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const directory = path.resolve(args.dir ?? '');
const version = args.version;
const platforms = new Set((args.platforms ?? 'mac,windows,linux').split(',').filter(Boolean));
const macArches = new Set((args['mac-arches'] ?? 'arm64,x64').split(',').filter(Boolean));
const allowedPlatforms = new Set(['mac', 'windows', 'linux']);
const allowedMacArches = new Set(['arm64', 'x64']);

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('a valid --version is required');
}
if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`artifact directory not found: ${directory}`);
}
for (const platform of platforms) {
  if (!allowedPlatforms.has(platform)) throw new Error(`unknown platform: ${platform}`);
}
if (!platforms.has('mac')) throw new Error('the local release path requires mac');
if (!macArches.size) throw new Error('at least one mac architecture is required');
for (const arch of macArches) {
  if (!allowedMacArches.has(arch)) throw new Error(`unknown mac architecture: ${arch}`);
}

const expected = new Set(['latest-mac.yml']);
if (macArches.has('arm64')) {
  expected.add(`Blanc-${version}-arm64-mac.zip`);
  expected.add(`Blanc-${version}-arm64-mac.zip.blockmap`);
  expected.add(`Blanc-${version}-arm64.dmg`);
  expected.add(`Blanc-${version}-arm64.dmg.blockmap`);
}
if (macArches.has('x64')) {
  expected.add(`Blanc-${version}-mac.zip`);
  expected.add(`Blanc-${version}-mac.zip.blockmap`);
  expected.add(`Blanc-${version}.dmg`);
  expected.add(`Blanc-${version}.dmg.blockmap`);
}
if (platforms.has('windows')) {
  expected.add(`Blanc-Setup-${version}.exe`);
  expected.add(`Blanc-Setup-${version}.exe.blockmap`);
  expected.add('latest.yml');
}
if (platforms.has('linux')) {
  expected.add(`Blanc-${version}.AppImage`);
  expected.add('latest-linux.yml');
}

const actual = fs.readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name);
const allowed = new Set([...expected, 'SHA256SUMS']);
const missing = [...expected].filter((name) => !actual.includes(name));
const unexpected = actual.filter((name) => !allowed.has(name));
if (missing.length || unexpected.length) {
  if (missing.length) console.error(`missing artifacts:\n  ${missing.join('\n  ')}`);
  if (unexpected.length) console.error(`unexpected artifacts:\n  ${unexpected.join('\n  ')}`);
  process.exit(1);
}

for (const name of expected) {
  const size = fs.statSync(path.join(directory, name)).size;
  if (size <= 0) throw new Error(`empty artifact: ${name}`);
}

const sumsFile = path.join(directory, 'SHA256SUMS');
if (fs.existsSync(sumsFile)) {
  const sums = new Map(
    fs.readFileSync(sumsFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
      const match = line.match(/^([0-9a-f]{64})  (.+)$/);
      if (!match) throw new Error(`malformed SHA256SUMS line: ${line}`);
      return [match[2], match[1]];
    })
  );
  for (const name of expected) {
    const bytes = fs.readFileSync(path.join(directory, name));
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (sums.get(name) !== digest) throw new Error(`checksum mismatch: ${name}`);
  }
  const extraSums = [...sums.keys()].filter((name) => !expected.has(name));
  if (extraSums.length) throw new Error(`checksums include unexpected files: ${extraSums.join(', ')}`);
}

console.log(
  `release manifest OK — ${expected.size} artifacts for ${[...platforms].join(', ')} (mac: ${[...macArches].join(', ')})`
);
