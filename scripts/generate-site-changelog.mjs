#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
// The normalized release data lands in the Astro site's src tree, where
// src/pages/changelog.astro and src/pages/changelog.xml.js render it.
// HTML/XML escaping happens there (Astro auto-escapes; the RSS renderer in
// site/src/lib/rss.mjs escapes itself) — this script only produces data.
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'site', 'src', 'data');
const REPOSITORY_URL = 'https://github.com/bnfy/blanc';

// The app shipped as "Bowser" through v0.15.x, so old release notes still carry
// the former name and its `getbowser.com` domain. The marketing site must only
// ever present the current name — scrub the legacy name out of any release-note
// text before it reaches a visitor.
function scrubLegacyName(text) {
  return String(text)
    .replace(/getbowser\.com/gi, 'blancbrowser.com')
    .replace(/\bbowser\b/gi, 'Blanc');
}

// Accepts bnfy/blanc and bnfy/bowser: releases up to v0.15.x were published
// while the repo was still named "bowser", so their generated notes carry the
// old path. Rewrite it to the current name so no "bowser" URL ever reaches a
// visitor — GitHub 301s renamed-repo URLs and PR/tag numbers survive a rename,
// so the rewritten link resolves to the same place.
function blancGithubUrl(value, allowedKinds = ['pull', 'compare', 'releases']) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/bnfy\/(?:blanc|bowser)\/(pull|compare|releases)(?:\/|$)/);
    if (!match || !allowedKinds.includes(match[1])) return null;
    url.pathname = url.pathname.replace('/bnfy/bowser/', '/bnfy/blanc/');
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

  if (!body) return { changes, compareUrl, extraParagraphs };

  for (const rawLine of String(body).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^#{1,6}\s+(?:What(?:'|’)?s Changed|New Contributors)$/i.test(line)) continue;

    const compare = line.match(/^\*\*Full Changelog\*\*:\s*(\S+)$/i);
    if (compare) {
      compareUrl = blancGithubUrl(compare[1], ['compare']);
      if (!compareUrl) extraParagraphs.push(scrubLegacyName(line.replace(/\*\*/g, '')));
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const bullet = line.replace(/^[-*]\s+/, '');
      const generated = bullet.match(/^(.*?)\s+by\s+@[^\s]+\s+in\s+(https:\/\/\S+)$/i);
      const contributor = bullet.match(/^(@[^\s]+) made their first contribution in (https:\/\/\S+)$/i);
      if (generated) {
        changes.push({ text: scrubLegacyName(generated[1].trim()), url: blancGithubUrl(generated[2], ['pull']) });
      } else if (contributor) {
        changes.push({ text: scrubLegacyName(`${contributor[1]} made their first contribution`), url: blancGithubUrl(contributor[2], ['pull']) });
      } else {
        changes.push({ text: scrubLegacyName(bullet), url: null });
      }
      continue;
    }

    extraParagraphs.push(scrubLegacyName(line.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '')));
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
      const publishedIso = publishedAt.toISOString();
      return {
        tag,
        version: tag.replace(/^v/i, ''),
        name: String(release.name || tag),
        publishedAt: publishedIso,
        humanDate: humanDate(publishedIso),
        machineDate: machineDate(publishedIso),
        url: releaseUrl,
        anchor: tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        ...parseGeneratedNotes(release.body),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

// Releases are cut by the maker in New York, but GitHub's published_at is UTC — an
// evening-EDT release lands on the next UTC day, so a UTC-rendered date reads as
// "tomorrow". Render changelog dates in the project's home timezone so they match
// the date the release was actually cut (America/New_York handles EDT/EST for us).
const RELEASE_TZ = 'America/New_York';

function humanDate(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: RELEASE_TZ, year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(iso));
}

// Machine-readable YYYY-MM-DD for <time datetime>, in the same timezone as humanDate
// so the two never disagree (en-CA yields ISO-style YYYY-MM-DD).
function machineDate(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: RELEASE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function renderReleasesJson(releases) {
  return JSON.stringify(releases, null, 2) + '\n';
}

function outputPaths(outputDir = DEFAULT_OUTPUT_DIR) {
  return { json: path.join(outputDir, 'releases.json') };
}

function writeOutputs(releases, outputDir = DEFAULT_OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
  const paths = outputPaths(outputDir);
  fs.writeFileSync(paths.json, renderReleasesJson(releases));
  return paths;
}

function checkOutputs(releases, outputDir = DEFAULT_OUTPUT_DIR) {
  const paths = outputPaths(outputDir);
  const expected = renderReleasesJson(releases);
  const stale = [];
  if (!fs.existsSync(paths.json) || fs.readFileSync(paths.json, 'utf8') !== expected) stale.push(paths.json);
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
      console.error(`Release data is stale or missing:\n${stale.map((file) => `- ${file}`).join('\n')}\nRun: npm run site:changelog`);
      return 1;
    }
    console.log(`Release data is current (${releases.length} releases).`);
    return 0;
  }

  const paths = writeOutputs(releases, options.outputDir);
  console.log(`Rendered ${releases.length} releases to ${paths.json}.`);
  return 0;
}

export {
  checkOutputs,
  fetchReleases,
  normalizeReleases,
  parseGeneratedNotes,
  parseJsonDocuments,
  renderReleasesJson,
  run,
  scrubLegacyName,
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
