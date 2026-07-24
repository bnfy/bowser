#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [directoryArg, outputArg] = process.argv.slice(2);
if (!directoryArg) {
  console.error('usage: node scripts/create-checksums.mjs <artifact-dir> [output-file]');
  process.exit(2);
}

const directory = path.resolve(directoryArg);
const output = path.resolve(outputArg ?? path.join(directory, 'SHA256SUMS'));
const outputName = path.basename(output);
const entries = fs.readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== outputName)
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

if (!entries.length) {
  console.error(`no artifacts found in ${directory}`);
  process.exit(1);
}

const lines = entries.map((name) => {
  const bytes = fs.readFileSync(path.join(directory, name));
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  return `${digest}  ${name}`;
});
fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(`wrote ${path.relative(process.cwd(), output)} (${entries.length} files)`);
