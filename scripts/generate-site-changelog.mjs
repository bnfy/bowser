#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'site');
const REPOSITORY_URL = 'https://github.com/bnfy/blanc';
const CHANGELOG_URL = 'https://blancbrowser.com/changelog';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

// Accepts bnfy/blanc and bnfy/bowser: releases up to v0.15.x were published
// while the repo was still named "bowser", so their generated notes carry the
// old path. GitHub 301s renamed-repo URLs, and it is still our repo.
function blancGithubUrl(value, allowedKinds = ['pull', 'compare', 'releases']) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/bnfy\/(?:blanc|bowser)\/(pull|compare|releases)(?:\/|$)/);
    if (!match || !allowedKinds.includes(match[1])) return null;
    return url.href;
  } catch {
    return null;
  }
}

// `gh api --paginate` prints one JSON document per page. For the releases
// endpoint that can be either one array or several adjacent arrays, so parse a
// stream of complete JSON values instead of assuming a single document.
function parseJsonDocuments(input) {
  const documents = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (start === -1) {
      if (/\s/.test(char)) continue;
      if (char !== '[' && char !== '{') throw new Error(`Unexpected JSON token at offset ${i}`);
      start = i;
      depth = 1;
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '[' || char === '{') depth += 1;
    else if (char === ']' || char === '}') depth -= 1;

    if (depth === 0) {
      documents.push(JSON.parse(input.slice(start, i + 1)));
      start = -1;
    }
  }

  if (start !== -1 || inString) throw new Error('Incomplete JSON returned by GitHub');
  return documents;
}

function fetchReleases() {
  const stdout = execFileSync(
    'gh',
    ['api', '--paginate', 'repos/bnfy/blanc/releases?per_page=100'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
  return parseJsonDocuments(stdout).flatMap((document) => Array.isArray(document) ? document : [document]);
}

function parseGeneratedNotes(body = '') {
  const changes = [];
  const extraParagraphs = [];
  let compareUrl = null;

  for (const rawLine of String(body).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^#{1,6}\s+(?:What(?:'|’)?s Changed|New Contributors)$/i.test(line)) continue;

    const compare = line.match(/^\*\*Full Changelog\*\*:\s*(\S+)$/i);
    if (compare) {
      compareUrl = blancGithubUrl(compare[1], ['compare']);
      if (!compareUrl) extraParagraphs.push(line.replace(/\*\*/g, ''));
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const bullet = line.replace(/^[-*]\s+/, '');
      const generated = bullet.match(/^(.*?)\s+by\s+@[^\s]+\s+in\s+(https:\/\/\S+)$/i);
      const contributor = bullet.match(/^(@[^\s]+) made their first contribution in (https:\/\/\S+)$/i);
      if (generated) {
        changes.push({ text: generated[1].trim(), url: blancGithubUrl(generated[2], ['pull']) });
      } else if (contributor) {
        changes.push({ text: `${contributor[1]} made their first contribution`, url: blancGithubUrl(contributor[2], ['pull']) });
      } else {
        changes.push({ text: bullet, url: null });
      }
      continue;
    }

    extraParagraphs.push(line.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, ''));
  }

  return { changes, compareUrl, extraParagraphs };
}

function normalizeReleases(raw) {
  const flattened = Array.isArray(raw) ? raw.flatMap((item) => Array.isArray(item) ? item : [item]) : [];
  return flattened
    .filter((release) => release && !release.draft && !release.prerelease && release.published_at)
    .map((release) => {
      const tag = String(release.tag_name || '').trim();
      if (!tag) return null;
      const publishedAt = new Date(release.published_at);
      if (Number.isNaN(publishedAt.getTime())) return null;
      const releaseUrl = blancGithubUrl(release.html_url, ['releases'])
        || `${REPOSITORY_URL}/releases/tag/${encodeURIComponent(tag)}`;
      return {
        tag,
        version: tag.replace(/^v/i, ''),
        name: String(release.name || tag),
        publishedAt: publishedAt.toISOString(),
        url: releaseUrl,
        anchor: tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        ...parseGeneratedNotes(release.body),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

function humanDate(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(iso));
}

function releaseHtml(release) {
  const notes = release.changes.length
    ? `<ul class="release-changes">${release.changes.map((change) => {
        const text = escapeHtml(change.text);
        return `<li>${change.url ? `<a href="${escapeHtml(change.url)}" target="_blank" rel="noopener">${text}</a>` : text}</li>`;
      }).join('')}</ul>`
    : '';
  const extras = release.extraParagraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');
  const compare = release.compareUrl
    ? `<a href="${escapeHtml(release.compareUrl)}" target="_blank" rel="noopener">full changelog</a><span aria-hidden="true"> · </span>`
    : '';

  return `<article class="release" id="${escapeHtml(release.anchor)}">
  <div class="release-meta"><time datetime="${escapeHtml(release.publishedAt.slice(0, 10))}">${escapeHtml(humanDate(release.publishedAt))}</time></div>
  <div class="release-body">
    <h2><a href="#${escapeHtml(release.anchor)}">Blanc ${escapeHtml(release.version)}</a></h2>
    ${notes}${extras}
    <p class="release-links">${compare}<a href="${escapeHtml(release.url)}" target="_blank" rel="noopener">GitHub release</a></p>
  </div>
</article>`;
}

const BRAND_MARK = '<svg class="site-brand-mark" viewBox="0 0 149.21 199.16" aria-hidden="true"><path fill="currentColor" d="M132.49,99.93c24.35,25.21,21.69,65.88-5.32,88.01-8.6,6.52-18.14,11.22-29.43,11.22H0S.05,0,.05,0l97.73.34c20.2.07,36.1,15.44,41.57,33.81,5.91,21.3-.72,42.38-18.13,56.78,3.89,3.02,7.96,5.58,11.27,9.01ZM123.05,76.28c11.02-13.76,12.6-31.98,4.74-47.57-6.27-10.66-16.79-19.78-29.98-19.81l-89.13-.21.04,134.11c17.74-38.18,51.53-61.94,94.24-58.73,7.99.6,14.76-1.14,20.08-7.79ZM9.18,186.44l95.77-92.67c-20.99-3.85-41.54,1.86-58.47,14.63-24.42,18.43-37.97,47.69-37.31,78.04ZM116.56,184.68c15.98-9.69,24.44-26.82,23.9-45.09s-10.27-34.19-26.36-42.19L17.5,190.42l81.36-.05c6.08,0,12.28-2.41,17.7-5.69Z"></path></svg>';

function renderChangelog(releases) {
  const items = releases.map(releaseHtml).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blanc Browser Changelog — What’s new</title>
<meta name="description" content="See what changed in each Blanc Browser release, from new features to security, privacy, and platform fixes.">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#ffffff">
<meta name="application-name" content="Blanc Browser">
<link rel="canonical" href="${CHANGELOG_URL}">
<meta property="og:site_name" content="Blanc Browser">
<meta property="og:type" content="website">
<meta property="og:title" content="Blanc Browser Changelog — What’s new">
<meta property="og:description" content="See what changed in each Blanc Browser release, from new features to security, privacy, and platform fixes.">
<meta property="og:url" content="${CHANGELOG_URL}">
<meta property="og:image" content="https://blancbrowser.com/og-image.png">
<meta property="og:image:alt" content="Blanc Browser marketing page showing the Blanc Island over real websites.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Blanc Browser Changelog — What’s new">
<meta name="twitter:description" content="See what changed in each Blanc Browser release, from new features to security, privacy, and platform fixes.">
<meta name="twitter:image" content="https://blancbrowser.com/og-image.png">
<link rel="alternate" type="application/rss+xml" title="Blanc Browser Changelog" href="/changelog.xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap">
<link rel="stylesheet" href="styles.css?v=20260711-1">
</head>
<body data-page="changelog">

<header class="site-header site-header--solid">
  <nav class="site-nav" aria-label="Primary navigation">
    <a class="site-brand" href="index.html" aria-label="Blanc Browser home">
      ${BRAND_MARK}
      <span>Blanc</span>
    </a>
    <div class="site-nav-links">
      <a href="features.html">features</a>
      <a href="about.html" class="nav-secondary">about</a>
      <a href="changelog.html" class="is-current" aria-current="page">changelog</a>
    </div>
    <a class="site-nav-cta" href="download.html">download blanc</a>
  </nav>
</header>

<main class="changelog-page">
  <header class="changelog-hero">
    <p class="section-kicker">shipping in public</p>
    <h1>Every Blanc release, in one place.</h1>
    <p>This page mirrors Blanc’s published GitHub releases, newest first. <a href="/changelog.xml">Subscribe via RSS</a>.</p>
  </header>
  <section class="release-list" aria-label="Blanc releases">
${items || '    <p>No published releases yet.</p>'}
  </section>
</main>

<footer class="compact-footer">
  <span>built in Rochester, NY · no investors · © 2026 · <a href="https://bnfy.me" target="_blank" rel="noopener">Bananify</a></span>
  <span><a href="features.html">Features</a> · <a href="about.html">About</a> · <a href="changelog.html">Changelog</a> · <a href="download.html">Download</a> · <a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a></span>
</footer>

<div id="consent" class="consent" hidden>
  <span>Optional analytics help us gauge interest — allow?</span>
  <button id="consentAllow">Allow</button>
  <button id="consentDeny" class="ghost">No thanks</button>
</div>

<script src="site.js" defer></script>
</body>
</html>
`;
}

function renderRss(releases) {
  const newest = releases[0]?.publishedAt;
  const items = releases.slice(0, 20).map((release) => {
    const summary = [
      ...release.changes.map((change) => change.text),
      ...release.extraParagraphs,
    ].join('\n');
    return `    <item>
      <title>${escapeXml(`Blanc ${release.version}`)}</title>
      <link>${escapeXml(release.url)}</link>
      <guid isPermaLink="true">${escapeXml(release.url)}</guid>
      <pubDate>${escapeXml(new Date(release.publishedAt).toUTCString())}</pubDate>
      <description>${escapeXml(summary)}</description>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Blanc Browser Changelog</title>
    <link>${CHANGELOG_URL}</link>
    <description>New features, fixes, and platform updates in Blanc Browser.</description>
    <language>en-us</language>${newest ? `
    <lastBuildDate>${escapeXml(new Date(newest).toUTCString())}</lastBuildDate>` : ''}
${items}
  </channel>
</rss>
`;
}

function outputPaths(outputDir = DEFAULT_OUTPUT_DIR) {
  return {
    html: path.join(outputDir, 'changelog.html'),
    rss: path.join(outputDir, 'changelog.xml'),
  };
}

function writeOutputs(releases, outputDir = DEFAULT_OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
  const paths = outputPaths(outputDir);
  fs.writeFileSync(paths.html, renderChangelog(releases));
  fs.writeFileSync(paths.rss, renderRss(releases));
  return paths;
}

function checkOutputs(releases, outputDir = DEFAULT_OUTPUT_DIR) {
  const paths = outputPaths(outputDir);
  const expected = new Map([
    [paths.html, renderChangelog(releases)],
    [paths.rss, renderRss(releases)],
  ]);
  const stale = [];
  for (const [file, contents] of expected) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents) stale.push(file);
  }
  return stale;
}

function parseArgs(argv) {
  const options = { check: false, input: null, outputDir: DEFAULT_OUTPUT_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--input') options.input = argv[++i];
    else if (arg === '--output-dir') options.outputDir = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
    if ((arg === '--input' || arg === '--output-dir') && !argv[i]) throw new Error(`${arg} requires a value`);
  }
  return options;
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const raw = options.input
    ? JSON.parse(fs.readFileSync(path.resolve(options.input), 'utf8'))
    : fetchReleases();
  const releases = normalizeReleases(raw);

  if (options.check) {
    const stale = checkOutputs(releases, options.outputDir);
    if (stale.length) {
      console.error(`Changelog output is stale or missing:\n${stale.map((file) => `- ${file}`).join('\n')}\nRun: npm run site:changelog`);
      return 1;
    }
    console.log(`Changelog is current (${releases.length} releases).`);
    return 0;
  }

  const paths = writeOutputs(releases, options.outputDir);
  console.log(`Rendered ${releases.length} releases to ${paths.html} and ${paths.rss}.`);
  return 0;
}

export {
  checkOutputs,
  escapeHtml,
  escapeXml,
  fetchReleases,
  normalizeReleases,
  parseGeneratedNotes,
  parseJsonDocuments,
  renderChangelog,
  renderRss,
  run,
  writeOutputs,
};

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(`Could not generate the Blanc changelog: ${error.message}`);
    process.exitCode = 1;
  }
}
