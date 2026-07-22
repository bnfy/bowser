#!/usr/bin/env node
// Compares built pages (site/dist/) against the pre-Astro baseline
// (git tag site-pre-astro). Head metadata is compared as a normalized tag
// MULTISET with an allowlist of intended deltas; <html>/<body> attributes
// and each page's external-script count are asserted; bodies are compared
// as whitespace-collapsed, link-normalized HTML. Pages not yet ported are
// SKIPPED (later tasks require zero skips).
//
// Flags:
//   --only a.html,b.html   compare only these pages (incremental task gates)
//   --strict               skips are failures (full-conversion gate)
//   --changelog-dir <dir>  read the changelog.html baseline from <dir>
//                          instead of the git tag (deterministic comparison
//                          when releases moved on after the tag — Task 7)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'site/dist');
const PAGES = [
  'index.html', 'download.html', 'features.html', 'about.html',
  'privacy.html', 'terms.html', 'changelog.html',
  'features/island.html', 'features/ad-blocking.html', 'features/private-tabs.html',
  'features/command-palette.html', 'features/tab-groups.html', 'features/sync.html',
  'features/security.html',
];

function flagValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}
const ONLY = flagValue('--only') ? new Set(flagValue('--only').split(',')) : null;
const CHANGELOG_DIR = flagValue('--changelog-dir');

// href/src rewrites the port intentionally makes (old → new).
const LINKS = [
  ['index.html', '/'], ['features.html', '/features'], ['about.html', '/about'],
  ['changelog.html', '/changelog'], ['download.html', '/download'],
  ['privacy.html', '/privacy'], ['terms.html', '/terms'],
];

// The single allowed copy change (privacy policy, Task 3): applied to the
// BASELINE side so old-with-change == new proves nothing else moved.
const PRIVACY_REWRITES = [
  ['<li><strong>Fonts</strong> load from Google Fonts, so Google may see your IP address as part of delivering them.</li>',
   '<li><strong>Fonts</strong> are bundled with the site and served from our own host — no third-party font service is contacted.</li>'],
  ['Last updated: July 11, 2026', 'Last updated: July 22, 2026'],
];

function baseline(file) {
  // Task 7 pins a deterministic changelog expectation (old generator, same
  // release snapshot) because the git tag's changelog predates new releases.
  if (file === 'changelog.html' && CHANGELOG_DIR) {
    const p = path.resolve(ROOT, CHANGELOG_DIR, 'changelog.html');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  try {
    return execFileSync('git', ['show', `site-pre-astro:site/${file}`], { cwd: ROOT, encoding: 'utf8' });
  } catch { return null; }
}

function normalizeUrl(url, fromFeatures) {
  let u = url.replace(/\?v=[\w-]+/, '');
  // Fragment-aware: features.html#ad-blocking and ../privacy.html#anchor
  // exist in the baseline — normalize the path part, reattach the fragment.
  const hashAt = u.indexOf('#');
  const frag = hashAt === -1 ? '' : u.slice(hashAt);
  if (hashAt !== -1) u = u.slice(0, hashAt);
  if (!u) return frag; // same-page anchor link
  const done = (p) => p + frag;
  if (fromFeatures) {
    if (u.startsWith('../shots/')) return done('/' + u.slice(3));
    if (u.startsWith('../')) {
      const target = u.slice(3);
      for (const [oldHref, newHref] of LINKS) if (target === oldHref) return done(newHref);
      return done(u);
    }
    // sibling feature page: island.html → /features/island
    const sibling = u.match(/^([a-z-]+)\.html$/);
    if (sibling) return done(`/features/${sibling[1]}`);
  } else {
    if (u.startsWith('shots/')) return done('/' + u);
    for (const [oldHref, newHref] of LINKS) if (u === oldHref) return done(newHref);
    const feature = u.match(/^features\/([a-z-]+)\.html$/);
    if (feature) return done(`/features/${feature[1]}`);
  }
  return done(u);
}

function rewriteLinks(html, fromFeatures) {
  return html.replace(/\b(href|src|srcset)="([^"]+)"/g,
    (m, attr, url) => `${attr}="${normalizeUrl(url, fromFeatures)}"`);
}

const DROP_OLD = [
  /rel="preconnect" href="https:\/\/fonts\./,
  /href="https:\/\/fonts\.googleapis\.com/,
  /rel="stylesheet" href="(\.\.\/)?styles\.css/,
];
const DROP_NEW = [
  /rel="stylesheet" href="\/_astro\/[^"]+\.css"/,
  /type="module" src="\/_astro\/[^"]+\.js"/,
  /rel="modulepreload"/,
];

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

function headTags(html, drops, fromFeatures) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
  const tags = [];
  const re = /<title>[\s\S]*?<\/title>|<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>|<(?:meta|link)\b[^>]*>/g;
  for (const m of head.match(re) ?? []) {
    if (drops.some((d) => d.test(m))) continue;
    if (m.startsWith('<script')) {
      const json = m.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      // key-sorted deep compare: formatting and key order never matter
      tags.push('ldjson:' + JSON.stringify(sortKeys(JSON.parse(json))));
    } else if (m.startsWith('<title')) {
      tags.push(m.replace(/\s+/g, ' '));
    } else {
      // normalize: tag name + sorted attributes, urls rewritten
      const name = m.match(/^<(\w+)/)[1];
      const attrs = [...m.matchAll(/([\w:-]+)="([^"]*)"/g)]
        .map(([, k, v]) => `${k}="${['href', 'src', 'content'].includes(k) && !v.startsWith('http') ? normalizeUrl(v, fromFeatures) : v}"`)
        .sort();
      tags.push(`${name} ${attrs.join(' ')}`);
    }
  }
  return tags.sort();
}

function bodyText(html, { fromFeatures, isNew }) {
  let body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? '';
  // Old pages load site.js/demo.js at body end; new pages emit processed
  // scripts as <script type="module" src="/_astro/..."> (in place or head,
  // depending on Astro version). Strip script *includes* from both sides
  // wherever they sit, keep inline scripts (changelog search) for comparison.
  // The script PROFILE is asserted separately (scriptCount below), so a
  // missing demo.js or a stray site.js on a legal page still fails.
  body = body.replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*><\/script>\s*/g, '');
  if (!isNew) body = rewriteLinks(body, fromFeatures);
  // XML-style self-closing (<path .../> in inline SVG) and explicit
  // open/close (<path ...></path>, Astro's serialization) parse to the same
  // DOM — normalize to the explicit form on both sides.
  body = body.replace(/<([\w-]+)([^>]*?)\s*\/>/g, '<$1$2></$1>');
  return body.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
}

// External-script profile: legal pages have 0, index has 2 (site.js+demo.js),
// everything else 1. The old page is ground truth; the new page must include
// exactly as many processed scripts (hashed module bundles count 1:1 —
// chunk-splitting shows up as imports inside the JS, not extra tags).
function scriptCount(html) {
  return (html.match(/<script\b[^>]*\bsrc="[^"]*"[^>]*>/g) ?? []).length;
}

// <html>/<body> open-tag attributes (lang, data-page, ...) — normalized,
// sorted. A missing data-page must fail, it feeds site.js analytics payloads.
function openTag(html, tag) {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*>`));
  if (!m) return `<${tag}>`;
  const attrs = [...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => `${k}="${v}"`).sort();
  return `${tag} ${attrs.join(' ')}`;
}

// Multiset diff — duplicated meta tags must not hide behind set semantics.
function diffMultiset(oldTags, newTags) {
  const count = new Map();
  for (const t of oldTags) count.set(t, (count.get(t) ?? 0) + 1);
  for (const t of newTags) count.set(t, (count.get(t) ?? 0) - 1);
  return {
    missing: [...count].filter(([, n]) => n > 0).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)),
    extra: [...count].filter(([, n]) => n < 0).map(([t, n]) => (n < -1 ? `${t} ×${-n}` : t)),
  };
}

let ok = 0; let failed = 0; let skipped = 0;
for (const file of PAGES) {
  if (ONLY && !ONLY.has(file)) continue;
  const distPath = path.join(DIST, file);
  if (!fs.existsSync(distPath)) { console.log(`SKIP  ${file} (not built yet)`); skipped++; continue; }
  const oldHtmlRaw = baseline(file);
  if (!oldHtmlRaw) { console.log(`SKIP  ${file} (no baseline)`); skipped++; continue; }
  let oldHtml = oldHtmlRaw;
  if (file === 'privacy.html') for (const [a, b] of PRIVACY_REWRITES) oldHtml = oldHtml.replace(a, b);
  const newHtml = fs.readFileSync(distPath, 'utf8');
  const fromFeatures = file.startsWith('features/');

  const { missing, extra } = diffMultiset(
    headTags(oldHtml, DROP_OLD, fromFeatures),
    headTags(newHtml, DROP_NEW, false)
  );

  const problems = [];
  for (const t of missing) problems.push(`head missing: ${t}`);
  for (const t of extra) problems.push(`head extra:   ${t}`);
  for (const tag of ['html', 'body']) {
    const oldTag = openTag(oldHtml, tag);
    const newTag = openTag(newHtml, tag);
    if (oldTag !== newTag) problems.push(`<${tag}> attrs: old [${oldTag}] new [${newTag}]`);
  }
  const oldScripts = scriptCount(oldHtml);
  const newScripts = scriptCount(newHtml);
  if (oldScripts !== newScripts) problems.push(`script profile: baseline has ${oldScripts} external script(s), build has ${newScripts}`);

  const oldBody = bodyText(oldHtml, { fromFeatures, isNew: false });
  const newBody = bodyText(newHtml, { fromFeatures: false, isNew: true });
  if (oldBody !== newBody) {
    let i = 0;
    while (i < Math.min(oldBody.length, newBody.length) && oldBody[i] === newBody[i]) i++;
    problems.push(`body diverges at char ${i}:\n    old: …${oldBody.slice(Math.max(0, i - 60), i + 120)}…\n    new: …${newBody.slice(Math.max(0, i - 60), i + 120)}…`);
  }

  if (!problems.length) { console.log(`OK    ${file}`); ok++; continue; }
  failed++;
  console.log(`FAIL  ${file}`);
  for (const p of problems) console.log(`  ${p}`);
}
console.log(`\n${ok} ok, ${failed} failed, ${skipped} skipped`);
if (process.argv.includes('--strict') && (skipped || ONLY)) {
  console.error('STRICT: requires a full run (no --only) with zero skips');
  process.exit(1);
}
process.exit(failed ? 1 : 0);
