#!/usr/bin/env node
// Re-runnable, LOSSLESS-only: optimize public/ images in place. A file is
// replaced only when the optimized version is smaller AND decodes to
// pixel-identical RGBA AND carries a byte-identical ICC profile (several
// assets are Display P3 — stripping or converting the profile is a shipped
// rendering change that pixel comparison in sRGB space cannot see).
//
// JPEGs: jpegtran (libjpeg-turbo, e.g. `brew install jpeg-turbo`) with
// `-copy all` so ICC/markers survive. PNGs: oxipng (`brew install oxipng`),
// a STRUCTURAL optimizer that preserves ancillary chunks — a sharp re-encode
// was tried first and silently dropped the cICP chunk, which outranks the
// iCCP profile in modern browsers (these screenshots carry cICP=Display P3
// over an iCCP "Color LCD" profile, so dropping cICP changes rendering).
// Either tool being absent skips that format with a notice.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

function findTool(name, candidates) {
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
}
const JPEGTRAN = findTool('jpegtran', ['/opt/homebrew/opt/jpeg-turbo/bin/jpegtran', '/usr/local/opt/jpeg-turbo/bin/jpegtran']);
const OXIPNG = findTool('oxipng', ['/opt/homebrew/bin/oxipng', '/usr/local/bin/oxipng']);
if (!JPEGTRAN) console.warn('no jpegtran found — JPEGs will be skipped (brew install jpeg-turbo)');
if (!OXIPNG) console.warn('no oxipng found — PNGs will be skipped (brew install oxipng)');

// PNG color chunks whose loss would change rendering even with identical
// pixels and ICC payload: cICP outranks iCCP in modern browsers.
function pngChunk(buf, wanted) {
  let off = 8;
  while (off < buf.length - 8) {
    const len = buf.readUInt32BE(off);
    const name = buf.toString('ascii', off + 4, off + 8);
    if (name === wanted) return buf.subarray(off + 8, off + 8 + len);
    if (name === 'IEND') break;
    off += 12 + len;
  }
  return null;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(jpe?g|png)$/i.test(entry.name)) out.push(p);
  }
  return out;
}

async function iccOf(buf) {
  return (await sharp(buf).metadata()).icc ?? null;
}

async function sameImage(bufA, bufB, isPng) {
  const [a, b] = await Promise.all([
    sharp(bufA).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(bufB).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return 'size mismatch';
  if (!a.data.equals(b.data)) return 'PIXEL MISMATCH';
  const [iccA, iccB] = await Promise.all([iccOf(bufA), iccOf(bufB)]);
  if ((iccA === null) !== (iccB === null) || (iccA !== null && !iccA.equals(iccB))) return 'ICC PROFILE MISMATCH';
  if (isPng) {
    const cicpA = pngChunk(bufA, 'cICP');
    const cicpB = pngChunk(bufB, 'cICP');
    if ((cicpA === null) !== (cicpB === null) || (cicpA !== null && !cicpA.equals(cicpB))) return 'cICP CHUNK MISMATCH';
  }
  return null; // identical
}

let before = 0; let after = 0;
for (const file of walk(PUB)) {
  const src = fs.readFileSync(file);
  before += src.length;
  const isPng = /\.png$/i.test(file);
  let out = null;
  if (!isPng) {
    if (JPEGTRAN) {
      const tmp = path.join(os.tmpdir(), `blanc-jpg-${path.basename(file)}`);
      execFileSync(JPEGTRAN, ['-copy', 'all', '-optimize', '-progressive', '-outfile', tmp, file]);
      out = fs.readFileSync(tmp);
      fs.rmSync(tmp);
    }
  } else if (OXIPNG) {
    const tmp = path.join(os.tmpdir(), `blanc-png-${path.basename(file)}`);
    // -o max, no --strip: every ancillary chunk (cICP, eXIf, iTXt) survives.
    execFileSync(OXIPNG, ['-o', 'max', '--out', tmp, file]);
    out = fs.readFileSync(tmp);
    fs.rmSync(tmp);
  }
  if (out === null) { after += src.length; console.log(`${path.relative(PUB, file)}: skipped (no tool)`); continue; }
  const mismatch = out.length < src.length ? await sameImage(src, out, isPng) : 'no gain';
  if (mismatch === null) {
    fs.writeFileSync(file, out);
    after += out.length;
    console.log(`${path.relative(PUB, file)}: ${src.length} -> ${out.length} (identical pixels + profile)`);
  } else {
    after += src.length;
    console.log(`${path.relative(PUB, file)}: kept (${mismatch})`);
  }
}
console.log(`total: ${(before / 1024).toFixed(0)}KiB -> ${(after / 1024).toFixed(0)}KiB`);
