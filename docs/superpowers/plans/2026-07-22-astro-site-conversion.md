# Astro Site Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the marketing site (`site/`) from 14 hand-maintained static HTML pages to a self-contained Astro project with identical deployed URLs, identical SEO/meta output, self-hosted fonts, hashed assets, and a data-driven changelog.

**Architecture:** `site/` becomes an Astro project with its own `package.json`. One `BaseLayout` with three explicit page profiles (island/solid/legal headers, full/compact footers, analytics on/off, rich/standard/none social meta) replaces the duplicated chrome. `build.format: 'file'` reproduces today's exact deployed file layout. The changelog generator emits committed `releases.json` which an Astro page + RSS endpoint render. A parity-comparator script (`verify-parity.mjs`) diffs every built page against a git-tagged baseline and is the test harness for the whole port.

**Tech Stack:** Astro ^5 (static output), `@fontsource-variable/inter`, `@fontsource/jetbrains-mono`, sharp (image recompression script only), Node 22, Cloudflare Pages direct upload via wrangler.

**Spec:** `docs/superpowers/specs/2026-07-22-astro-site-conversion-design.md`

## Global Constraints

- **Baseline is the contract.** The git tag `site-pre-astro` (created in Task 1) is the source of truth for every page's markup and metadata. When this plan says "copy from baseline", run `git show site-pre-astro:site/<file>`.
- **URL layout frozen:** `build.format: 'file'` — `dist/` must contain `index.html`, `about.html`, …, `features/island.html` exactly like today. Never switch to directory format.
- **Stable public URLs:** `favicon*`, `apple-touch-icon.png`, `og-image.png`, `logo.png`, `feature-*.png`, `robots.txt`, `shots/**` live in `site/public/` at their current root-relative paths. Never route them through Astro's hashing pipeline.
- **No inlining:** `vite.build.assetsInlineLimit: 0` and `build.inlineStylesheets: 'never'` stay in `astro.config.mjs`. `site.js` is 4,023 bytes — just under Vite's 4,096 default; without these options it silently inlines.
- **Copy freeze:** no user-visible text changes anywhere, with exactly one exception: the privacy policy's website-fonts bullet + its `legal-updated` date (Task 3).
- **Internal links** become root-relative extensionless (`/features/island`, `/download`, `/`). External links, anchors (`#...`), and `/changelog.xml` are unchanged.
- **Font family caveat:** `@fontsource-variable/inter` declares `Inter Variable`, not `Inter`. `--font-ui` must list `"Inter Variable"` first (Task 1). `site/styles.css` is NOT under the `tokens/` substrate guard — no `tokens.json` change needed.
- **Never hand-edit** `site/src/data/releases.json` — regenerate with `npm run site:changelog`.
- All commits: end the message with `Co-Authored-By:` per repo convention if configured; commit after every task at minimum.

## Link normalization table (used by every page task)

| Old href (top-level pages) | Old href (features/* pages) | New href |
|---|---|---|
| `index.html` | `../index.html` | `/` |
| `features.html` | `../features.html` | `/features` |
| `about.html` | `../about.html` | `/about` |
| `changelog.html` | `../changelog.html` | `/changelog` |
| `download.html` | `../download.html` | `/download` |
| `privacy.html` | `../privacy.html` | `/privacy` |
| `terms.html` | `../terms.html` | `/terms` |
| `features/<x>.html` | `<x>.html` (sibling) | `/features/<x>` |
| `shots/...` (src/srcset) | `../shots/...` | `/shots/...` |
| `styles.css?v=...` | `../styles.css?v=...` | (removed — layout imports CSS) |
| `site.js`, `demo.js?v=...` | `../site.js` | (removed — layout/pages import scripts) |
| `/changelog.xml`, `#anchor`, `https://...`, `mailto:` | same | unchanged |

---

### Task 1: Baseline tag + Astro scaffold + styles/fonts/scripts/assets

**Files:**
- Create: `site/package.json`, `site/package-lock.json` (via npm), `site/astro.config.mjs`
- Create: `site/src/styles/site.css` (moved from `site/styles.css`, one token edit)
- Create: `site/src/scripts/site.js`, `site/src/scripts/demo.js` (moved, one path fix in demo.js)
- Create: `site/src/pages/index.astro` (TEMPORARY smoke page — replaced in Task 4)
- Create: `site/public/` (moved static assets)
- Modify: `.gitignore`, root `package.json` (proxy scripts)

**Interfaces:**
- Produces: git tag `site-pre-astro`; `npm --prefix site run build` → `site/dist/`; root scripts `site:dev` / `site:build` / `site:deploy`; `src/styles/site.css` with `--font-ui: "Inter Variable", "Inter", ...`.

- [ ] **Step 1: Tag the baseline**

```bash
git tag site-pre-astro
```

(If re-running after a reset: `git tag -f site-pre-astro <pre-conversion-commit>` — the tag must point at a commit where `site/*.html` still exist.)

- [ ] **Step 2: Create `site/package.json` and install**

```json
{
  "name": "blanc-site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "^5.0.0",
    "@fontsource-variable/inter": "^5.0.0",
    "@fontsource/jetbrains-mono": "^5.0.0"
  }
}
```

Run: `npm --prefix site install`
Expected: `site/package-lock.json` created, `site/node_modules/` populated. Commit the lockfile (it is required by `npm ci` in CI).

- [ ] **Step 3: Create `site/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  site: 'https://blancbrowser.com',
  // 'file' reproduces the pre-Astro deployed layout exactly: about.html,
  // features/island.html, ... — the URL contract with search engines.
  build: {
    format: 'file',
    // Explicit asset contract: styles and scripts are always external hashed
    // files, never inlined (site.js is 4023 bytes, under Vite's 4096 default).
    inlineStylesheets: 'never',
  },
  vite: {
    build: { assetsInlineLimit: 0 },
    // Dev server: index.astro imports the ROOT package.json (JSON-LD
    // softwareVersion), which sits outside this Vite root.
    server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  },
});
```

- [ ] **Step 4: Add `.astro/` to root `.gitignore`**

Append to `.gitignore` (the existing `dist/` and `node_modules/` entries already cover `site/dist/` and `site/node_modules/` because they have no leading slash):

```
.astro/
```

- [ ] **Step 5: Move static assets to `site/public/`**

```bash
cd site && mkdir -p public && git mv favicon.ico favicon.svg favicon-16x16.png favicon-32x32.png apple-touch-icon.png og-image.png logo.png feature-island.png feature-ad-blocking.png feature-private-tabs.png feature-command-palette.png feature-tab-groups.png robots.txt public/ && git mv shots public/shots && cd ..
```

Note: `feature-*.png` count is 5 (there is no `feature-sync.png`/`feature-security.png` — verify with `ls site/feature-*.png` first and move exactly what exists).

- [ ] **Step 6: Move styles with the Inter Variable fix**

```bash
mkdir -p site/src/styles && git mv site/styles.css site/src/styles/site.css
```

Then edit line 4 of `site/src/styles/site.css`:

```css
  --font-ui: "Inter Variable", "Inter", -apple-system, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
```

(`--font-mono` is untouched — `@fontsource/jetbrains-mono` declares `JetBrains Mono` as-is.)

- [ ] **Step 7: Move scripts with the demo.js path fix**

```bash
mkdir -p site/src/scripts && git mv site/site.js site/src/scripts/site.js && git mv site/demo.js site/src/scripts/demo.js
```

In `site/src/scripts/demo.js`, change the shot URL builder (currently `const shotSrc = (id) => 'shots/' + (MOBILE ? 'mobile' : 'desktop') + '/' + id + '.jpg';`) to:

```js
  const shotSrc = (id) => '/shots/' + (MOBILE ? 'mobile' : 'desktop') + '/' + id + '.jpg';
```

No other changes to either file.

- [ ] **Step 8: Create the TEMPORARY smoke page `site/src/pages/index.astro`**

```astro
---
// TEMPORARY smoke page — proves the build contract (file format, external
// hashed CSS, bundled fonts). Replaced by the real index in Task 4.
import '@fontsource-variable/inter';
import '../styles/site.css';
---
<html lang="en">
<head><title>smoke</title></head>
<body><p>smoke</p></body>
</html>
```

- [ ] **Step 9: Add root proxy scripts**

In root `package.json` `scripts`, after the `site:changelog:check` line, add:

```json
    "site:dev": "npm --prefix site run dev",
    "site:build": "npm --prefix site run build",
    "site:deploy": "npm --prefix site run build && npx wrangler pages deploy site/dist --project-name=blancbrowser",
```

- [ ] **Step 10: Build and verify the asset contract**

Run: `npm run site:build`
Expected: succeeds. Then verify:

```bash
ls site/dist/index.html && ls site/dist/_astro/*.css && grep -c "fonts.googleapis" site/dist/index.html; grep -o '/_astro/[^"]*\.css' site/dist/index.html | head -2 && ls site/dist/_astro/ | grep -c woff2
```

Expected: `index.html` exists; at least one hashed `.css` in `_astro/`; `0` google-fonts references; the page references `/_astro/*.css` externally (not a `<style>` tag); woff2 count > 0 (fonts bundled).

- [ ] **Step 11: Commit**

```bash
git add -A site .gitignore package.json && git commit -m "site: scaffold Astro project (assets to public/, styles/scripts to src/, smoke page)"
```

Old `site/*.html` files intentionally remain in the working tree until Task 9 — they are not part of the Astro build and no longer deployed.

---

### Task 2: BaseLayout + chrome components + about page + parity comparator

**Files:**
- Create: `site/src/components/BrandMark.astro`, `site/src/components/Header.astro`, `site/src/components/Footer.astro`, `site/src/components/Consent.astro`
- Create: `site/src/layouts/BaseLayout.astro`
- Create: `site/src/pages/about.astro`
- Create: `site/scripts/verify-parity.mjs` (the test harness for all page tasks)

**Interfaces:**
- Consumes: Task 1's styles/scripts/public layout, `site-pre-astro` tag.
- Produces: `BaseLayout` props contract used by every page task: `{ title, description, path, page?, header?: 'island'|'solid'|'legal', footer?: 'full'|'compact', analytics?: boolean, social?: 'rich'|'standard'|'none', current?: 'features'|'about'|'changelog'|'download'|null, robots?, ogTitle?, ogDescription?, ogImage?, ogImageAlt? }` plus a named slot `head`. `node site/scripts/verify-parity.mjs` — exits 0 when every ported page matches baseline; not-yet-ported pages are listed as SKIPPED.

- [ ] **Step 1: Create `site/src/components/BrandMark.astro`**

The single source for the brand SVG (today pasted in ~16 places). Copy the exact `<path d="...">` data from the baseline — it appears identically in every page header; take it from `git show site-pre-astro:site/about.html` line 39:

```astro
---
const { class: className, ariaLabel } = Astro.props;
---
<svg class={className} viewBox="0 0 149.21 199.16" aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : 'true'}><path fill="currentColor" d="M132.49,99.93c24.35,25.21,21.69,65.88-5.32,88.01-8.6,6.52-18.14,11.22-29.43,11.22H0S.05,0,.05,0l97.73.34c20.2.07,36.1,15.44,41.57,33.81,5.91,21.3-.72,42.38-18.13,56.78,3.89,3.02,7.96,5.58,11.27,9.01ZM123.05,76.28c11.02-13.76,12.6-31.98,4.74-47.57-6.27-10.66-16.79-19.78-29.98-19.81l-89.13-.21.04,134.11c17.74-38.18,51.53-61.94,94.24-58.73,7.99.6,14.76-1.14,20.08-7.79ZM9.18,186.44l95.77-92.67c-20.99-3.85-41.54,1.86-58.47,14.63-24.42,18.43-37.97,47.69-37.31,78.04ZM116.56,184.68c15.98-9.69,24.44-26.82,23.9-45.09s-10.27-34.19-26.36-42.19L17.5,190.42l81.36-.05c6.08,0,12.28-2.41,17.7-5.69Z"></path></svg>
```

- [ ] **Step 2: Create `site/src/components/Header.astro`**

Encodes all three header treatments and the exact current-page highlighting observed in the baseline (features pages highlight the features link; the download page highlights the CTA and points it at `#download-options`):

```astro
---
import BrandMark from './BrandMark.astro';
const { variant = 'solid', current = null } = Astro.props;
---
{variant === 'legal' ? (
  <header class="legal-top">
    <a class="legal-home" href="/" aria-label="Blanc home">
      <BrandMark class="mark" />
      <span class="wordmark">Blanc</span>
    </a>
  </header>
) : (
  <header class={variant === 'solid' ? 'site-header site-header--solid' : 'site-header'}>
    <nav class="site-nav" aria-label="Primary navigation">
      <a class="site-brand" href="/" aria-label="Blanc Browser home">
        <BrandMark class="site-brand-mark" />
        <span>Blanc</span>
      </a>
      <div class="site-nav-links">
        <a href="/features" class={current === 'features' ? 'is-current' : undefined} aria-current={current === 'features' ? 'page' : undefined}>features</a>
        <a href="/about" class={current === 'about' ? 'is-current nav-secondary' : 'nav-secondary'} aria-current={current === 'about' ? 'page' : undefined}>about</a>
        <a href="/changelog" class={current === 'changelog' ? 'is-current' : undefined} aria-current={current === 'changelog' ? 'page' : undefined}>changelog</a>
      </div>
      <a class={current === 'download' ? 'site-nav-cta is-current' : 'site-nav-cta'} href={current === 'download' ? '#download-options' : '/download'}>download blanc</a>
    </nav>
  </header>
)}
```

- [ ] **Step 3: Create `site/src/components/Footer.astro`**

The compact variant is below in full. For the `full` variant, copy the entire `<footer>…</footer>` block **verbatim** from `git show site-pre-astro:site/index.html` (lines 317–337 — it contains the Threads and Instagram SVG icons), then apply the link table (`features.html` → `/features`, etc.). The privacy/terms footers in the baseline are the same block — confirm with a diff while porting.

```astro
---
const { variant = 'compact' } = Astro.props;
---
{variant === 'compact' ? (
  <footer class="compact-footer">
    <span>built independently · no investors · © 2026 · <a href="https://bnfy.me" target="_blank" rel="noopener">Bananify</a></span>
    <span><a href="/features">Features</a> · <a href="/about">About</a> · <a href="/changelog">Changelog</a> · <a href="/download">Download</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span>
  </footer>
) : (
  <footer>
    <!-- REPLACE THIS COMMENT with the baseline index.html footer children,
         links normalized. Keep foot-copy / foot-links / foot-sep / foot-social
         / foot-ic markup and SVGs byte-identical. -->
  </footer>
)}
```

- [ ] **Step 4: Create `site/src/components/Consent.astro`**

```astro
<div id="consent" class="consent" hidden>
  <span>Optional analytics help us gauge interest — allow?</span>
  <button id="consentAllow">Allow</button>
  <button id="consentDeny" class="ghost">No thanks</button>
</div>
```

- [ ] **Step 5: Create `site/src/layouts/BaseLayout.astro`**

```astro
---
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '../styles/site.css';
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';
import Consent from '../components/Consent.astro';

const SITE = 'https://blancbrowser.com';
const {
  title,
  description,
  path,                 // canonical path: '/', '/about', '/features/island', ...
  page = null,          // <body data-page>; legal pages pass nothing
  header = 'solid',     // 'island' | 'solid' | 'legal'
  footer = 'compact',   // 'full' | 'compact'
  analytics = true,     // consent banner + site.js; false on legal pages
  social = 'standard',  // 'rich' | 'standard' | 'none'
  current = null,       // nav highlight
  robots = 'index,follow,max-image-preview:large',
  ogTitle = title,
  ogDescription = description,
  ogImage = '/og-image.png',
  ogImageAlt = 'Blanc Browser marketing page showing the Blanc Island over real websites.',
} = Astro.props;
const canonical = SITE + path;
const ogImageUrl = SITE + ogImage;
---
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content={description}>
<meta name="robots" content={robots}>
<meta name="theme-color" content="#ffffff">
{social !== 'none' && <meta name="application-name" content="Blanc Browser">}
{social === 'rich' && <meta name="apple-mobile-web-app-title" content="Blanc">}
<link rel="canonical" href={canonical}>
{social !== 'none' && (
  <>
    <meta property="og:site_name" content="Blanc Browser">
    <meta property="og:type" content="website">
    <meta property="og:title" content={ogTitle}>
    <meta property="og:description" content={ogDescription}>
    <meta property="og:url" content={canonical}>
    <meta property="og:image" content={ogImageUrl}>
    {social === 'rich' && (
      <>
        <meta property="og:image:secure_url" content={ogImageUrl}>
        <meta property="og:image:type" content="image/png">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
      </>
    )}
    <meta property="og:image:alt" content={ogImageAlt}>
    {social === 'rich' && <meta property="og:locale" content="en_US">}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content={ogTitle}>
    <meta name="twitter:description" content={ogDescription}>
    <meta name="twitter:image" content={ogImageUrl}>
    {social === 'rich' && <meta name="twitter:image:alt" content={ogImageAlt}>}
  </>
)}
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<slot name="head" />
</head>
<body data-page={page ?? undefined}>
<Header variant={header} current={current} />
<slot />
<Footer variant={footer} />
{analytics && <Consent />}
{analytics && <script src="../scripts/site.js"></script>}
</body>
</html>
```

Notes for the implementer:
- Astro emits the doctype automatically.
- Tag order inside `<head>` deliberately mirrors the baseline pages (title → description → robots → theme-color → application-name → canonical → OG → twitter → icons). The comparator (Step 8) checks tag *sets*, but keep the order anyway for clean diffs.
- The baseline puts `og:image:alt` *after* the width/height on index and after `og:image` elsewhere — the structure above reproduces that.
- `<script src="../scripts/site.js">` is an Astro-processed script: bundled, hashed, emitted as a module. Both `site.js` and `demo.js` are IIFEs with no cross-file ordering requirements, so module semantics ≡ today's `defer`.

- [ ] **Step 6: Create `site/src/pages/about.astro`**

Body content is the baseline `about.html` `<main class="about-page">…</main>` block **verbatim** (get it: `git show site-pre-astro:site/about.html`, lines 51–90), with links normalized per the table (`mailto:` and `https://buy.polar.sh/...` untouched; `changelog.html` → `/changelog`):

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout
  title="About Blanc Browser — Independent by design"
  description="Blanc Browser is built independently by Bananify, without venture funding, investors, or an advertising business."
  path="/about"
  page="about"
  current="about"
  ogTitle="About Blanc Browser — Independent by design"
  ogDescription="Learn how the independent browser is built and funded."
>
<main class="about-page">
  <!-- baseline about.html lines 51–90, links normalized -->
</main>
</BaseLayout>
```

(The `<!-- ... -->` marker above is an instruction to paste the real markup, not something to commit.) Note `ogTitle`/`ogDescription` differ from `title`/`description` on this page — copy each page's OG values from its baseline, never assume they match.

- [ ] **Step 7: Keep the smoke `index.astro`**

Do not delete it in this task — Task 4 replaces it with the real index. (Deleting it now would 404 `/` in dev and add noise.)

- [ ] **Step 8: Create `site/scripts/verify-parity.mjs`**

```js
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
```

- [ ] **Step 9: Build and run the comparator**

Run: `npm run site:build && node site/scripts/verify-parity.mjs --only about.html`
Expected: `OK    about.html`, `1 ok, 0 failed, 0 skipped`, exit 0. Iterate on `about.astro`/layout/components until it passes — the comparator's FAIL output pinpoints the first divergence. (A full run would report the temporary smoke `index.astro` as FAIL — that is exactly why `--only` exists; the smoke page is gone after Task 4.)

- [ ] **Step 10: Commit**

```bash
git add site/src site/scripts/verify-parity.mjs && git commit -m "site: BaseLayout + chrome components, about page, parity comparator"
```

---

### Task 3: Legal pages (privacy incl. the copy change, terms)

**Files:**
- Create: `site/src/pages/privacy.astro`, `site/src/pages/terms.astro`

**Interfaces:**
- Consumes: `BaseLayout` (Task 2) with the legal profile: `header="legal"`, `footer="full"`, `analytics={false}`, `social="none"`, `robots="index,follow"`, no `page` prop.

- [ ] **Step 1: Create `site/src/pages/privacy.astro`**

Frontmatter + wrapper (body = baseline `privacy.html` `<main class="legal-doc">…</main>` verbatim, links normalized):

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout
  title="Privacy Policy — Blanc Browser"
  description="How Blanc — the minimal desktop browser — and blancbrowser.com handle your information. Local-first by design: your browsing stays on your device."
  path="/privacy"
  header="legal"
  footer="full"
  analytics={false}
  social="none"
  robots="index,follow"
>
<main class="legal-doc">
  <!-- baseline privacy.html main content, links normalized, PLUS the two
       copy edits in Step 2 -->
</main>
</BaseLayout>
```

- [ ] **Step 2: Apply the one allowed copy change (exact strings)**

In the ported privacy body, replace:

```html
<li><strong>Fonts</strong> load from Google Fonts, so Google may see your IP address as part of delivering them.</li>
```

with:

```html
<li><strong>Fonts</strong> are bundled with the site and served from our own host — no third-party font service is contacted.</li>
```

and replace `Last updated: July 11, 2026` with `Last updated: July 22, 2026`. Do NOT touch the app section's bullet `<li>it loads its interface fonts from Google Fonts;</li>` — the Electron app still uses Google Fonts. (These exact strings are mirrored in `PRIVACY_REWRITES` in `verify-parity.mjs` — if you word them differently, update both places.)

- [ ] **Step 3: Create `site/src/pages/terms.astro`**

Same profile as privacy; `title`/`description`/body come verbatim from `git show site-pre-astro:site/terms.html` (`path="/terms"`). No copy changes.

- [ ] **Step 4: Build + verify**

Run: `npm run site:build && node site/scripts/verify-parity.mjs --only about.html,privacy.html,terms.html`
Expected: `3 ok, 0 failed, 0 skipped`, exit 0. The privacy check passing proves the copy change is exactly the sanctioned one and nothing else moved.

- [ ] **Step 5: Commit**

```bash
git add site/src/pages && git commit -m "site: port privacy + terms (legal profile); self-hosted-fonts privacy copy"
```

---

### Task 4: Index page (island profile, JSON-LD version from root package.json)

**Files:**
- Create: `site/src/pages/index.astro` (replaces the Task 1 smoke page)

**Interfaces:**
- Consumes: `BaseLayout` rich profile; root `package.json` `version` (build input).
- Produces: `/` with `softwareVersion` sourced at build time — `release.sh`'s sed becomes unnecessary (deleted in Task 8).

- [ ] **Step 1: Write `site/src/pages/index.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { version } from '../../../package.json';

const graph = {
  '@context': 'https://schema.org',
  '@graph': [
    // Copy the three nodes (Organization, WebSite, SoftwareApplication)
    // VERBATIM from the baseline index.html JSON-LD block (lines 40–89),
    // as JS object literals — with one change: softwareVersion below.
  ],
};
// In the SoftwareApplication node use:  softwareVersion: version,
---
<BaseLayout
  title="Blanc — A Minimal, Private Desktop Browser"
  description="Blanc is a minimal desktop browser with one floating control surface, built-in ad and tracker blocking, private tabs, and keyboard-first commands for macOS, Windows, and Linux."
  path="/"
  page="home"
  header="island"
  footer="full"
  social="rich"
  ogTitle="Blanc Browser — A minimal desktop browser with built-in ad blocking"
  ogDescription="One floating control surface, built-in ad and tracker blocking, private tabs, and keyboard-first commands."
>
  <script type="application/ld+json" is:inline set:html={JSON.stringify(graph)} slot="head" />
  <!-- baseline index.html body from <header class="hero"> (line 109) through
       </section> of the "more" block (line 315), verbatim, links + shots/
       srcset normalized per the table. The hero BrandMark <svg class="mark"
       ... aria-label="Blanc"> may stay inline verbatim or use
       <BrandMark class="mark" ariaLabel="Blanc" /> — comparator decides. -->
  <script src="../scripts/demo.js"></script>
</BaseLayout>
```

Notes:
- The JSON-LD comparator does a parsed deep-compare, so `JSON.stringify` formatting differences don't matter — but the *values* must match the baseline exactly, except `softwareVersion` which must equal root `package.json`'s current `version` (today both are `0.20.0`, so the comparator still passes).
- `demo.js` is included only here — no other page loads it.
- The body includes the site-header… no: the `<header class="site-header">` chrome comes from the layout (`header="island"`); the body port starts at `<header class="hero">`.

- [ ] **Step 2: Build + verify**

Run: `npm run site:build && node site/scripts/verify-parity.mjs`
Expected: `OK index.html` joins the OK list (4 OK, 10 SKIP).

- [ ] **Step 3: Spot-check the demo in a browser**

Run: `npm run site:dev`, open `http://localhost:4321/`. The Island demo must self-play with screenshots loading (network tab: `/shots/desktop/*.jpg` 200s). Consent banner appears; "Allow"/"No thanks" both dismiss and persist on reload.

- [ ] **Step 4: Commit**

```bash
git add site/src/pages/index.astro && git commit -m "site: port index (island profile, demo, JSON-LD version from root package.json)"
```

---

### Task 5: Remaining static pages (download, features, 7 feature pages)

**Files:**
- Create: `site/src/pages/download.astro`, `site/src/pages/features.astro`
- Create: `site/src/pages/features/{island,ad-blocking,private-tabs,command-palette,tab-groups,sync,security}.astro`

**Interfaces:**
- Consumes: `BaseLayout` standard profile.

All nine use `header="solid"` (default), `footer="compact"` (default), `analytics` (default true), `social="standard"` (default). Per-page props — every `title`/`description`/`ogTitle`/`ogDescription`/`ogImageAlt` value **must be copied verbatim from that page's baseline head** (they were individually SEO-tuned; the table below only says which knobs to set):

| File | `path` | `page` | `current` | `ogImage` | JSON-LD head slot |
|---|---|---|---|---|---|
| `download.astro` | `/download` | `download` | `download` | default | no |
| `features.astro` | `/features` | `features` | `features` | default | yes |
| `features/island.astro` | `/features/island` | `feature-island` | `features` | `/feature-island.png` | yes |
| `features/ad-blocking.astro` | `/features/ad-blocking` | `feature-ad-blocking` | `features` | `/feature-ad-blocking.png` | yes |
| `features/private-tabs.astro` | `/features/private-tabs` | `feature-private-tabs` | `features` | `/feature-private-tabs.png` | yes |
| `features/command-palette.astro` | `/features/command-palette` | `feature-command-palette` | `features` | `/feature-command-palette.png` | yes |
| `features/tab-groups.astro` | `/features/tab-groups` | `feature-tab-groups` | `features` | `/feature-tab-groups.png` | yes |
| `features/sync.astro` | `/features/sync` | `feature-sync` | `features` | check baseline | yes |
| `features/security.astro` | `/features/security` | `feature-security` | `features` | check baseline | yes |

(`sync`/`security` have no matching `feature-*.png` on disk — read their baseline `og:image` and use whatever URL it declares.)

- [ ] **Step 1: Port `features/island.astro` first (worked example)**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';

const ld = {
  // baseline features/island.html JSON-LD (lines 33–43) verbatim as an object
};
---
<BaseLayout
  title="A Minimal Browser UI That Stays Out of Your Way | Blanc"
  description="Blanc replaces a traditional tab strip and toolbar with one floating Island for tabs, navigation, blocking status, and page actions."
  path="/features/island"
  page="feature-island"
  current="features"
  ogImage="/feature-island.png"
  ogTitle={/* baseline og:title verbatim */}
  ogDescription={/* baseline og:description verbatim */}
  ogImageAlt={/* baseline og:image:alt verbatim */}
>
  <script type="application/ld+json" is:inline set:html={JSON.stringify(ld)} slot="head" />
  <!-- baseline body between </header> (site chrome) and <footer, verbatim,
       links + ../shots/ normalized. Includes breadcrumb nav, sections,
       feature-close CTA. -->
</BaseLayout>
```

Build + run `node site/scripts/verify-parity.mjs` until `features/island.html` is OK before proceeding — this validates the feature-page pattern (breadcrumbs, `../` links, sibling links, `../shots/` srcsets) once.

- [ ] **Step 2: Port the remaining eight pages the same way**

For each: frontmatter per the table, `title`/`description`/OG values verbatim from baseline, body = everything between the baseline's site-header `</header>` and `<footer`, links normalized. Where a page has a JSON-LD block, port it into the frontmatter object + head slot. Build + comparator after each page or after all — comparator output is per-page either way.

- [ ] **Step 3: Full comparator run**

Run: `npm run site:build && node site/scripts/verify-parity.mjs`
Expected: 13 OK, 1 SKIP (`changelog.html` — Task 7), exit 0.

- [ ] **Step 4: Commit**

```bash
git add site/src/pages && git commit -m "site: port download, features index, and all seven feature pages"
```

---

### Task 6: Changelog generator → releases.json (TDD)

**Files:**
- Modify: `scripts/generate-site-changelog.mjs`
- Modify: `test/unit/site-changelog.test.js`
- Create: `site/src/lib/rss.mjs` (pure RSS renderer, shared by the Astro endpoint and unit tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `normalizeReleases(raw)` → array whose entries GAIN `humanDate` (e.g. `"July 11, 2026"`) and `machineDate` (`"2026-07-11"`) fields; `renderReleasesJson(releases)` → `JSON.stringify(releases, null, 2) + '\n'`; CLI writes/checks `site/src/data/releases.json` (default output dir `site/src/data`, `--output-dir` still overrides for tests); `renderRss(releases)` moves to `site/src/lib/rss.mjs` with the byte-identical template. `renderChangelog`, `escapeHtml`, and `BRAND_MARK` are DELETED from the generator.

- [ ] **Step 1: Update the unit tests first**

In `test/unit/site-changelog.test.js`:

1. Replace the `renderChangelog` assertions in the XSS test (`'non-Blanc links are rendered as escaped text, never active links'`) — rename it `'non-Blanc links never become link URLs in the release data'` and end it with:

```js
  const json = changelog.renderReleasesJson(release);
  const parsed = JSON.parse(json);
  assert.equal(parsed[0].changes[0].url, null);
  assert.equal(parsed[0].changes[0].text, 'fix: <script>alert(1)</script>');
  // HTML-escaping is Astro's job at render time; the data keeps raw text.
```

2. In the legacy-name test, replace the final `renderChangelog(...)` assertion with:

```js
  assert.ok(!changelog.renderReleasesJson(changelog.normalizeReleases([{
    html_url: 'https://github.com/bnfy/bowser/releases/tag/v0.2.0',
    tag_name: 'v0.2.0', name: '0.2.0', draft: false, prerelease: false,
    published_at: '2026-07-04T00:00:00Z',
    body: 'Bowser rebrand release: identity rebrand.',
  }])).toLowerCase().includes('bowser'));
```

3. Rewrite the determinism/RSS test to import the moved RSS renderer:

```js
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
```

4. Add a date-fields test:

```js
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
```

5. Update the offline-CLI test to the new artifact:

```js
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
```

All other tests (normalization, parseGeneratedNotes, bowser-link rewriting, credentials, parseJsonDocuments) are untouched.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `renderReleasesJson is not a function`, missing `site/src/lib/rss.mjs`, etc.

- [ ] **Step 3: Create `site/src/lib/rss.mjs`**

Move `escapeXml` and `renderRss` out of the generator **byte-identically** (template strings unchanged — the Task 7 byte-compare against the baseline `changelog.xml` depends on it):

```js
// RSS 2.0 renderer for the Blanc changelog. Pure: releases in, XML out.
// Consumed by src/pages/changelog.xml.js at build and by test/unit/site-changelog.test.js.
const CHANGELOG_URL = 'https://blancbrowser.com/changelog';

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function renderRss(releases) {
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
```

- [ ] **Step 4: Rewrite `scripts/generate-site-changelog.mjs`**

Changes (everything not listed stays exactly as it is):

1. Delete `escapeHtml`, `escapeXml`, `releaseHtml`, `BRAND_MARK`, `renderChangelog`, `renderRss` and the `CHANGELOG_URL` constant.
2. `DEFAULT_OUTPUT_DIR` becomes `path.join(ROOT, 'site', 'src', 'data')`.
3. In `normalizeReleases`, extend the returned object:

```js
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
```

(`humanDate`/`machineDate` helpers and `RELEASE_TZ` stay in the generator, now feeding the JSON instead of the HTML template.)
4. Add and export:

```js
function renderReleasesJson(releases) {
  return JSON.stringify(releases, null, 2) + '\n';
}
```

5. Replace `outputPaths`/`writeOutputs`/`checkOutputs`:

```js
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
```

6. In `run()`, update the check-mode message to `Release data is stale or missing:` (keep the `Run: npm run site:changelog` hint) and the success logs to reference the JSON path. Update the `export { ... }` list: remove the deleted names, add `renderReleasesJson`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS (all files — the other unit tests must be unaffected).

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-site-changelog.mjs test/unit/site-changelog.test.js site/src/lib/rss.mjs && git commit -m "changelog: generator emits releases.json; RSS renderer moves to site lib (TDD)"
```

---

### Task 7: Changelog page + RSS endpoint

**Files:**
- Create: `site/src/data/releases.json` (generated, committed)
- Create: `site/src/pages/changelog.astro`, `site/src/pages/changelog.xml.js`

**Interfaces:**
- Consumes: `releases.json` entry shape from Task 6 (incl. `humanDate`/`machineDate`); `renderRss` from `site/src/lib/rss.mjs`; `BaseLayout` standard profile.

- [ ] **Step 1: Snapshot the raw releases and generate the data (requires authenticated `gh`)**

Releases may have been published after the `site-pre-astro` tag, so the tag's committed `changelog.html`/`changelog.xml` are not a valid expectation. Pin ONE raw-API snapshot and feed it to BOTH generators — the new one (produces `releases.json`) and the old one from the tag (produces the deterministic baseline expectation):

```bash
mkdir -p site/.parity
gh api --paginate 'repos/bnfy/blanc/releases?per_page=100' > site/.parity/raw-releases.json
node scripts/generate-site-changelog.mjs --input site/.parity/raw-releases.json
git show site-pre-astro:scripts/generate-site-changelog.mjs > site/.parity/old-generator.mjs
node site/.parity/old-generator.mjs --input site/.parity/raw-releases.json --output-dir site/.parity/old
```

Expected: `site/src/data/releases.json` written (commit it — it is the committed artifact replacing `changelog.html`), and `site/.parity/old/changelog.html` + `site/.parity/old/changelog.xml` written (the expectations; NOT committed). Add to `.gitignore`:

```
site/.parity/
```

Both generators consumed identical input, so every comparison below is deterministic regardless of release drift.

- [ ] **Step 2: Create `site/src/pages/changelog.xml.js`**

```js
import releases from '../data/releases.json';
import { renderRss } from '../lib/rss.mjs';

export function GET() {
  return new Response(renderRss(releases), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
```

- [ ] **Step 3: Create `site/src/pages/changelog.astro`**

Head extras (RSS alternate link) go through the head slot; the release-article markup reproduces the old generator template; the search script is the old inline IIFE, kept inline:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import releases from '../data/releases.json';
---
<BaseLayout
  title="Blanc Browser Changelog — What’s new"
  description="See what changed in each Blanc Browser release, from new features to security, privacy, and platform fixes."
  path="/changelog"
  page="changelog"
  current="changelog"
>
  <link slot="head" rel="alternate" type="application/rss+xml" title="Blanc Browser Changelog" href="/changelog.xml">
<main class="changelog-page">
  <header class="changelog-hero">
    <p class="section-kicker">shipping in public</p>
    <h1>Every Blanc release, in one place.</h1>
    <p>This page mirrors Blanc’s published GitHub releases, newest first. <a href="/changelog.xml">Subscribe via RSS</a>.</p>
  </header>
  {releases.length > 0 && (
    <div class="changelog-search">
      <input type="search" id="changelog-search" class="changelog-search-input" placeholder={`Search ${releases.length} releases…`} aria-label="Search releases" autocomplete="off" spellcheck="false">
    </div>
  )}
  <section class="release-list" aria-label="Blanc releases">
    {releases.length === 0 && <p>No published releases yet.</p>}
    {releases.map((release) => (
      <article class="release" id={release.anchor}>
        <div class="release-meta"><time datetime={release.machineDate}>{release.humanDate}</time></div>
        <div class="release-body">
          <h2><a href={'#' + release.anchor}>Blanc {release.version}</a></h2>
          {release.changes.length > 0 && (
            <ul class="release-changes">
              {release.changes.map((change) => (
                <li>{change.url ? <a href={change.url} target="_blank" rel="noopener">{change.text}</a> : change.text}</li>
              ))}
            </ul>
          )}
          {release.extraParagraphs.map((paragraph) => <p>{paragraph}</p>)}
          <p class="release-links">{release.compareUrl && <><a href={release.compareUrl} target="_blank" rel="noopener">full changelog</a><span aria-hidden="true"> · </span></>}<a href={release.url} target="_blank" rel="noopener">GitHub release</a></p>
        </div>
      </article>
    ))}
    <p class="release-empty" hidden>No releases match your search.</p>
  </section>
</main>
<script is:inline>
(function () {
  var input = document.getElementById('changelog-search');
  if (!input) return;
  var releases = Array.prototype.slice.call(document.querySelectorAll('.release-list .release'));
  var empty = document.querySelector('.release-empty');
  var haystack = releases.map(function (el) { return el.textContent.toLowerCase(); });
  function apply() {
    var query = input.value.trim().toLowerCase();
    var visible = 0;
    for (var i = 0; i < releases.length; i++) {
      var match = !query || haystack[i].indexOf(query) !== -1;
      releases[i].hidden = !match;
      if (match) visible++;
    }
    if (empty) empty.hidden = visible !== 0;
  }
  input.addEventListener('input', apply);
})();
</script>
</BaseLayout>
```

Note: Astro auto-escapes all interpolations — this is where the old `escapeHtml` responsibility now lives.

- [ ] **Step 4: Build + verify page and RSS deterministically**

Run: `npm run site:build && node site/scripts/verify-parity.mjs --strict --changelog-dir site/.parity/old`
Expected: 14 OK, 0 skipped, exit 0 — `changelog.html` is compared against the old generator's output over the identical release snapshot, so the check is exact with no manual acceptance path.

Then byte-compare RSS against the old generator's output from the same snapshot:

```bash
diff site/.parity/old/changelog.xml site/dist/changelog.xml && echo RSS-IDENTICAL
```

Expected: `RSS-IDENTICAL` — byte-for-byte, deterministic (the Task 6 requirement that `rss.mjs` keeps the template byte-identical is exactly what this proves).

- [ ] **Step 5: Run the check mode against the committed JSON**

Run: `npm run site:changelog:check`
Expected: `Release data is current (N releases).` (message per Task 6 wording).

- [ ] **Step 6: Commit**

```bash
git add site/src/data/releases.json site/src/pages/changelog.astro site/src/pages/changelog.xml.js .gitignore && git commit -m "site: changelog page + RSS endpoint rendered from releases.json"
```

If any later task needs to re-verify after `releases.json` is regenerated, first re-run the Task 7 Step 1 snapshot block so `site/.parity/` matches the committed data.

---

### Task 8: Sitemap endpoint + release.sh cleanup

**Files:**
- Create: `site/src/pages/sitemap.xml.js`
- Modify: `scripts/release.sh` (delete the metadata-sed block)

**Interfaces:**
- Consumes: the full page list (all 14 routes exist after Task 7).
- Produces: `/sitemap.xml` at build; `release.sh` no longer touches `site/`(except the changelog step).

- [ ] **Step 1: Create `site/src/pages/sitemap.xml.js`**

The manifest copies today's exact per-route `changefreq`/`priority` (from the committed `site/sitemap.xml`, shown below). The two-way assertion makes the build fail loudly if pages and manifest ever diverge:

```js
// Explicit route manifest — changefreq/priority preserved from the
// hand-maintained sitemap this endpoint replaced. lastmod is the build date
// (the old file's lastmod was sed-bumped by release.sh; that step is gone).
const MANIFEST = [
  { path: '/',                         changefreq: 'weekly',  priority: '1.0' },
  { path: '/download',                 changefreq: 'monthly', priority: '0.9' },
  { path: '/features',                 changefreq: 'monthly', priority: '0.8' },
  { path: '/features/ad-blocking',     changefreq: 'monthly', priority: '0.8' },
  { path: '/features/island',          changefreq: 'monthly', priority: '0.7' },
  { path: '/features/private-tabs',    changefreq: 'monthly', priority: '0.7' },
  { path: '/features/command-palette', changefreq: 'monthly', priority: '0.7' },
  { path: '/features/tab-groups',      changefreq: 'monthly', priority: '0.7' },
  { path: '/features/sync',            changefreq: 'monthly', priority: '0.7' },
  { path: '/features/security',        changefreq: 'monthly', priority: '0.7' },
  { path: '/changelog',                changefreq: 'weekly',  priority: '0.8' },
  { path: '/about',                    changefreq: 'yearly',  priority: '0.6' },
  { path: '/privacy',                  changefreq: 'monthly', priority: '0.3' },
  { path: '/terms',                    changefreq: 'monthly', priority: '0.3' },
];

const SITE = 'https://blancbrowser.com';

export function GET() {
  // Discover the real pages and assert the manifest matches them exactly.
  const discovered = Object.keys(import.meta.glob('./**/*.astro'))
    .map((file) => file
      .replace(/^\.\//, '/')
      .replace(/\.astro$/, '')
      .replace(/\/index$/, '/')
      .replace(/^\/index$/, '/'));
  const manifestSet = new Set(MANIFEST.map((r) => r.path));
  const discoveredSet = new Set(discovered);
  const missingFromManifest = discovered.filter((p) => !manifestSet.has(p));
  const missingPages = MANIFEST.filter((r) => !discoveredSet.has(r.path)).map((r) => r.path);
  if (missingFromManifest.length || missingPages.length) {
    throw new Error(
      `sitemap manifest out of sync — add to MANIFEST: [${missingFromManifest}] / no page for: [${missingPages}]`
    );
  }

  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = MANIFEST.map((r) => `  <url>
    <loc>${SITE}${r.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
```

- [ ] **Step 2: Build and field-compare against the old sitemap**

Run: `npm run site:build`, then:

```bash
diff <(git show site-pre-astro:site/sitemap.xml | grep -v "<lastmod>") <(grep -v "<lastmod>" site/dist/sitemap.xml) && echo SITEMAP-FIELDS-IDENTICAL
```

Expected: `SITEMAP-FIELDS-IDENTICAL` — every `loc`/`changefreq`/`priority` matches; only `lastmod` differs.

- [ ] **Step 3: Tamper-test the assertion**

Temporarily comment out the `/about` line in `MANIFEST`, run `npm run site:build`.
Expected: build FAILS with `sitemap manifest out of sync`. Restore the line; build passes.

- [ ] **Step 4: Delete the release.sh metadata block**

In `scripts/release.sh`, delete these lines exactly (the comment through the closing `fi`):

```bash
# Keep the marketing site's release metadata in sync: the JSON-LD
# softwareVersion in site/index.html and the sitemap's lastmod are the only
# version-dated bits (download links point at /releases/latest, always fresh).
echo "==> Syncing site metadata to $VERSION"
sed -i '' -E "s/\"softwareVersion\": \"[^\"]*\"/\"softwareVersion\": \"$VERSION\"/" site/index.html
sed -i '' -E "s|<lastmod>[^<]*</lastmod>|<lastmod>$(date +%F)</lastmod>|" site/sitemap.xml
if ! git diff --quiet -- site/index.html site/sitemap.xml; then
  echo "==> site/ metadata updated — commit and redeploy the site after this release."
fi
```

(The JSON-LD version now comes from root `package.json` at site build time; the sitemap lastmod is the build date. Both are picked up by the routine post-release `site:deploy`.) Verify: `bash -n scripts/release.sh` parses; `grep -c "site/index.html" scripts/release.sh` returns 0.

- [ ] **Step 5: Commit**

```bash
git add site/src/pages/sitemap.xml.js scripts/release.sh && git commit -m "site: sitemap endpoint with route-manifest assertion; drop release.sh site seds"
```

---

### Task 9: Delete legacy files + image recompression

**Files:**
- Delete: `site/*.html`, `site/features/` (old HTML), `site/sitemap.xml`, `site/changelog.xml`
- Create: `site/scripts/compress-images.mjs`
- Modify: `site/public/**` images (recompressed in place), `site/package.json` (+sharp devDependency)

- [ ] **Step 1: Remove the legacy files**

```bash
git rm site/index.html site/download.html site/features.html site/about.html site/privacy.html site/terms.html site/changelog.html site/sitemap.xml site/changelog.xml && git rm -r site/features
```

(`site/features/` at this point contains only the old HTML — the new pages live in `site/src/pages/features/`. The baseline tag keeps all of it recoverable.)

- [ ] **Step 2: Build + full comparator (proves nothing depended on the deleted files)**

Run: `npm run site:build && node site/scripts/verify-parity.mjs --strict --changelog-dir site/.parity/old`
Expected: 14 OK, exit 0. (The comparator reads baselines from the git tag and `site/.parity/`, never the working tree — deleting the legacy files cannot affect it.)

- [ ] **Step 3: Add sharp + mozjpeg and the LOSSLESS recompression script**

Run: `npm --prefix site install --save-dev sharp mozjpeg`

The shots are already-compressed JPEGs — a quality re-encode would stack generational loss. So: **lossless only**, with an automatic decoded-pixel-equality gate on every file (objective fidelity check covering all images — desktop and mobile shots, OG assets, everything — no eyeballing as the safety net). JPEGs go through mozjpeg's `jpegtran` (Huffman/progressive optimization — DCT coefficients untouched); PNGs through sharp's max-effort lossless re-encode. `-copy none` strips EXIF/metadata, which these marketing assets don't need.

Create `site/scripts/compress-images.mjs`:

```js
#!/usr/bin/env node
// Re-runnable, LOSSLESS-only: optimize public/ images in place. A file is
// replaced only when the optimized version is BOTH smaller AND decodes to
// pixel-identical RGBA — anything else is kept and reported.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mozjpeg from 'mozjpeg';
import sharp from 'sharp';

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(jpe?g|png)$/i.test(entry.name)) out.push(p);
  }
  return out;
}

async function pixelsEqual(bufA, bufB) {
  const [a, b] = await Promise.all([
    sharp(bufA).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(bufB).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  return a.info.width === b.info.width && a.info.height === b.info.height
    && a.data.equals(b.data);
}

let before = 0; let after = 0;
for (const file of walk(PUB)) {
  const src = fs.readFileSync(file);
  before += src.length;
  let out;
  if (/\.jpe?g$/i.test(file)) {
    const tmp = path.join(os.tmpdir(), `blanc-jpg-${path.basename(file)}`);
    execFileSync(mozjpeg, ['-copy', 'none', '-optimize', '-progressive', '-outfile', tmp, file]);
    out = fs.readFileSync(tmp);
    fs.rmSync(tmp);
  } else {
    out = await sharp(src).png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer();
  }
  if (out.length < src.length && await pixelsEqual(src, out)) {
    fs.writeFileSync(file, out);
    after += out.length;
    console.log(`${path.relative(PUB, file)}: ${src.length} -> ${out.length} (pixel-identical)`);
  } else {
    after += src.length;
    console.log(`${path.relative(PUB, file)}: kept (${out.length >= src.length ? 'no gain' : 'PIXEL MISMATCH — not replaced'})`);
  }
}
console.log(`total: ${(before / 1024).toFixed(0)}KiB -> ${(after / 1024).toFixed(0)}KiB`);
```

- [ ] **Step 4: Run it and sanity-check**

Run: `node site/scripts/compress-images.mjs`
Expected: per-file report; every replaced file says `pixel-identical`, any `PIXEL MISMATCH` line means the file was left untouched (investigate if one appears — it indicates a decoder edge case, not shipped damage). Because replacement requires decoded-pixel equality, no visual review is needed for fidelity; do one quick render check (`npm run site:dev`, load `/` and one feature page) to confirm nothing structural broke, and `git diff --stat site/public` to see the byte savings.

- [ ] **Step 5: Commit**

```bash
git add -A site && git commit -m "site: remove legacy static files; recompress public images"
```

---

### Task 10: Full verification suite (spec §7)

**Files:**
- Create: `site/scripts/shoot-pages.mjs` (visual-diff screenshots)

**Interfaces:**
- Consumes: everything; the `site-pre-astro` tag; root `playwright` devDependency (already present for the desktop acceptance harness — resolution walks up from `site/scripts/`).

- [ ] **Step 1: Head/body/meta parity (§7.1) — strict**

Run: `npm run site:build && node site/scripts/verify-parity.mjs --strict --changelog-dir site/.parity/old`
Expected: 14 OK, 0 failed, 0 skipped, exit 0. (If `site/.parity/` is missing — fresh checkout — re-run Task 7 Step 1's snapshot block first.)

- [ ] **Step 2: dist layout + external hashed assets (§7.4)**

```bash
diff <(git ls-tree -r --name-only site-pre-astro -- site | sed 's|^site/||' | grep '\.html$' | sort) <(cd site/dist && find . -name '*.html' | sed 's|^\./||' | sort) && echo HTML-LAYOUT-IDENTICAL
ls site/dist/_astro/*.css site/dist/_astro/*.js >/dev/null && echo HASHED-ASSETS-PRESENT
grep -L "<style" site/dist/index.html >/dev/null && echo NO-INLINE-STYLES
```

Expected: `HTML-LAYOUT-IDENTICAL`, `HASHED-ASSETS-PRESENT`, `NO-INLINE-STYLES`. Also confirm `dist/robots.txt`, `dist/og-image.png`, `dist/shots/desktop/github.jpg` exist (public passthrough).

- [ ] **Step 3: Machine outputs (§7.4)**

```bash
diff site/.parity/old/changelog.xml site/dist/changelog.xml && echo RSS-IDENTICAL
diff <(git show site-pre-astro:site/sitemap.xml | grep -v lastmod) <(grep -v lastmod site/dist/sitemap.xml) && echo SITEMAP-IDENTICAL
```

Expected: both IDENTICAL lines — deterministic (the RSS expectation comes from the pinned release snapshot, the sitemap fields from the tag).

- [ ] **Step 4: Create and run `site/scripts/shoot-pages.mjs` (§7.2)**

```js
#!/usr/bin/env node
// Screenshots every page from the baseline (git archive) and from dist/,
// at desktop and mobile widths, into site/.parity-shots/{old,new}/ for
// side-by-side human review. Requires the repo root's playwright.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'site/.parity-shots');
const PAGES = ['index.html', 'download.html', 'features.html', 'about.html', 'privacy.html',
  'terms.html', 'changelog.html', 'features/island.html', 'features/ad-blocking.html',
  'features/private-tabs.html', 'features/command-palette.html', 'features/tab-groups.html',
  'features/sync.html', 'features/security.html'];
const SIZES = [{ tag: 'desktop', width: 1280, height: 2400 }, { tag: 'mobile', width: 480, height: 2400 }];

// Materialize the baseline into a temp dir.
const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blanc-site-old-'));
execFileSync('bash', ['-c', `git archive site-pre-astro site | tar -x -C ${oldDir}`], { cwd: ROOT });

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(dir, url.endsWith('/') ? url + 'index.html' : url);
      if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, () => resolve(server));
  });
}

const oldServer = await serve(path.join(oldDir, 'site'));
const newServer = await serve(path.join(ROOT, 'site/dist'));
const browser = await chromium.launch();
for (const [label, server] of [['old', oldServer], ['new', newServer]]) {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce' });
    for (const file of PAGES) {
      const dest = path.join(OUT, label, size.tag, file.replace('/', '__') + '.png');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await page.goto(`http://localhost:${server.address().port}/${file}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: dest, fullPage: true });
    }
    await page.close();
  }
}
await browser.close();
oldServer.close(); newServer.close();
console.log(`Screenshots in ${OUT} — review old/ vs new/ side by side.`);
```

Run: `node site/scripts/shoot-pages.mjs`, then review every old/new pair (e.g. `open site/.parity-shots`). Font rendering may shift sub-pixel (CDN vs. fontsource subsetting); anything structural is a bug — diagnose via the page source, fix, re-run. The demo region on index animates and will differ between shots; judge it by eye. Add `.parity-shots/` to `.gitignore` if it shows up in `git status` (it's inside `site/`, so add a `site/.parity-shots/` line).

- [ ] **Step 5: Behavior checks (§7.3)**

Serve the real build: `npm --prefix site run preview`, open the printed URL and verify:
1. Island demo self-plays on `/` with shots loading (DevTools network: `/shots/...` 200s).
2. Consent: banner appears → Deny → reload: no banner, no GA request. Clear localStorage → Allow → `googletagmanager.com` request fires.
3. `/download`: with a network connection, the platform download links rewrite to versioned GitHub asset URLs (inspect `href` after load).
4. Changelog search filters releases; empty-state row appears for garbage input.
5. `data-track` attributes present on CTAs (`grep -c data-track site/dist/index.html` > 0).

- [ ] **Step 6: Repo checks (§7.5)**

Run: `npm run test:unit && npm run site:changelog:check && npm run substrate:check`
Expected: all green (substrate:check proves the site work didn't disturb the app-side guards). Note `site:changelog:check` compares the committed `releases.json` against LIVE GitHub — if it fails because a release shipped mid-conversion, that's the guard working: re-run Task 7 Step 1's snapshot block, commit the refreshed `releases.json`, rebuild, and re-run this step.

- [ ] **Step 7: Commit**

```bash
git add site/scripts/shoot-pages.mjs .gitignore && git commit -m "site: visual-diff screenshot harness; full parity verification pass"
```

---

### Task 11: CI workflow + docs

**Files:**
- Create: `.github/workflows/site.yml`
- Rewrite: `site/CLAUDE.md`
- Modify: `README.md` (rename-status deploy command), `docs/polar-setup.md` (steps 4 & 6)

- [ ] **Step 1: Create `.github/workflows/site.yml`**

```yaml
name: Site

# Builds the Astro marketing site so a PR can't break it. Root package.json is
# a build input (JSON-LD softwareVersion); the changelog generator is part of
# the releases.json contract.
on:
  push:
    paths:
      - 'site/**'
      - 'package.json'
      - 'scripts/generate-site-changelog.mjs'
      - '.github/workflows/site.yml'
  pull_request:
    paths:
      - 'site/**'
      - 'package.json'
      - 'scripts/generate-site-changelog.mjs'
      - '.github/workflows/site.yml'

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: site/package-lock.json
      - run: npm ci
        working-directory: site
      - run: npm run build
        working-directory: site
```

(`site:changelog:check` is deliberately NOT here — it needs `gh` auth and live GitHub data; it remains a release-time/manual guard.)

- [ ] **Step 2: Rewrite `site/CLAUDE.md`**

Replace the whole file with:

```markdown
# Marketing site (`site/`)

A self-contained **Astro** project (own `package.json` — the Electron app's root
dependency tree is untouched). Pages live in `src/pages/` (`index`, `download`,
`features`, `about`, `privacy`, `terms`, `changelog`, and
`features/{island,ad-blocking,private-tabs,command-palette,tab-groups,sync,security}`),
sharing `src/layouts/BaseLayout.astro` with three explicit page profiles —
island (index: non-solid header, full social footer, rich OG), standard (solid
header, compact footer), legal (privacy/terms: `legal-top` header, full footer,
**no** analytics/consent, **no** OG/Twitter meta). Don't flatten these
differences — they're deliberate. `src/styles/site.css` is the one stylesheet
(bundled + hashed; fonts self-hosted via fontsource — the family is `"Inter
Variable"`, and this file is NOT under the root `tokens/` substrate guard).
`src/scripts/site.js` (release-link resolution + consent-gated GA, all pages
except legal) and `src/scripts/demo.js` (the self-playing Island demo, index
only) are Astro-processed. Anything needing a **stable URL** — favicons,
`og-image.png`, `logo.png`, `feature-*.png` (OG images), `robots.txt`,
`shots/**` (fetched at runtime by demo.js) — lives in `public/`; never hash or
rename these.

**Build contract:** `astro.config.mjs` pins `build.format: 'file'` (dist emits
`about.html`, `features/island.html` … — the exact pre-Astro URL layout; never
switch to directory format) and disables asset inlining
(`assetsInlineLimit: 0`, `inlineStylesheets: 'never'`) so CSS/JS are always
external hashed files. Internal links are root-relative extensionless
(`/features/island`) matching the canonicals Cloudflare Pages serves.

Commands (root proxies): `npm run site:dev`, `npm run site:build`, and
`npm run site:deploy` (build + `npx wrangler pages deploy site/dist
--project-name=blancbrowser` to the Cloudflare Pages project `blancbrowser`,
BNFY account, canonical domain `blancbrowser.com`; `getbowser.com` 301s there).
**Deploy `site/dist`, never `site/`.** CI (`.github/workflows/site.yml`) builds
the site on any change to `site/**`, root `package.json` (a build input — the
JSON-LD `softwareVersion` imports its `version`), or the changelog generator.

**Changelog pipeline:** `scripts/generate-site-changelog.mjs` (root, needs an
authenticated `gh`) fetches GitHub releases, scrubs the legacy "Bowser" name,
and writes **`site/src/data/releases.json`** (committed). `src/pages/
changelog.astro` renders it; `src/pages/changelog.xml.js` emits the RSS via
`src/lib/rss.mjs`. `npm run site:changelog` regenerates; `npm run
site:changelog:check` is the freshness guard (release-time/manual — not in CI;
needs `gh`). Never hand-edit `releases.json`. `release.sh` runs the regenerate
step (non-fatal) but no longer seds any site file — the JSON-LD version and
sitemap `lastmod` both resolve at build time, so the routine post-release
redeploy picks them up.

**Sitemap:** `src/pages/sitemap.xml.js` — an explicit route manifest with
per-route `changefreq`/`priority`, asserted at build time against the real
page list (adding/removing a page without updating the manifest fails the
build; that's the point). Served at `/sitemap.xml` (URL unchanged for Search
Console).

Releases don't deploy the site. After a release: `npm run site:changelog`,
commit `releases.json`, then `npm run site:deploy`. The Windows download page
notes the installer is not yet code-signed; update that copy only when Azure
Trusted Signing actually ships a signed build. The JSON-LD deliberately has
**no `aggregateRating`** — no real user ratings exist yet; fabricating one
violates Google's structured-data policy. `logo.png` (1024², mark at 80%
height) and `apple-touch-icon.png` (180², mark at 66%) are composed from
`brand/4x/B@4x.png` onto solid white — regenerate at the same geometry if the
mark changes. Utility scripts in `site/scripts/`: `verify-parity.mjs` +
`shoot-pages.mjs` (conversion-era comparators against the `site-pre-astro` git
tag) and `compress-images.mjs` (re-runnable image recompression).
```

- [ ] **Step 3: Update `README.md`**

In the "Rebrand cleanup still pending" section, replace:

```
  `blancbrowser` (direct upload: `npx wrangler pages deploy site
  --project-name=blancbrowser`), which serves `blancbrowser.com` and
```

with:

```
  `blancbrowser` (direct upload: `npm run site:deploy`, which builds the
  Astro site and uploads `site/dist`), which serves `blancbrowser.com` and
```

- [ ] **Step 4: Update `docs/polar-setup.md`**

Step 4: change `site/index.html` to `site/src/pages/index.astro`. Step 6: replace `` Deploy the site: `npx wrangler pages deploy site --project-name=blancbrowser`. `` with `` Deploy the site: `npm run site:deploy`. ``

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/site.yml site/CLAUDE.md README.md docs/polar-setup.md && git commit -m "site: CI build workflow; rewrite site/CLAUDE.md; update deploy commands in docs"
```

---

### Task 12: Push, CI gate, deploy + post-deploy checks

**⚠️ Deploying publishes to blancbrowser.com — confirm with the user before running the deploy command. Order matters: push first so the Site workflow validates the exact commit BEFORE anything goes live.**

- [ ] **Step 1: Final pre-flight (local)**

Run: `npm run test:unit && npm run site:build && node site/scripts/verify-parity.mjs --strict --changelog-dir site/.parity/old`
Expected: all green.

- [ ] **Step 2: Clean worktree, then push commits and the baseline tag**

```bash
test -z "$(git status --porcelain)" && echo CLEAN || echo "DIRTY — commit or stash before deploying"
git push origin main && git push origin site-pre-astro
```

Expected: `CLEAN` (a dirty tree means the deploy wouldn't correspond to committed code — stop and commit first), then both pushes succeed. (The tag is referenced by the parity scripts in `site/scripts/`; pushing it keeps them functional for other clones.)

- [ ] **Step 3: Wait for the Site workflow to pass**

```bash
gh run watch "$(gh run list --workflow=site.yml --branch=main --limit=1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Expected: exit 0 (workflow green). If it fails, fix, commit, push, and repeat — do NOT deploy a commit CI hasn't validated.

- [ ] **Step 4: Deploy (after user confirmation)**

```bash
npm run site:deploy
```

Expected: wrangler uploads `site/dist` and prints the deployment URL.

- [ ] **Step 5: Post-deploy spot checks (§7.6)**

```bash
curl -sI https://blancbrowser.com/sitemap.xml | grep -i content-type
curl -sI https://blancbrowser.com/changelog.xml | grep -i content-type
curl -s https://blancbrowser.com/features/island | grep -o '<link rel="canonical"[^>]*>'
curl -s https://blancbrowser.com/ | grep -c '/_astro/'
curl -sI https://blancbrowser.com/shots/desktop/github.jpg | head -1
```

Expected: XML content types on both feeds; canonical `https://blancbrowser.com/features/island`; `/_astro/` asset references > 0; shots return `200`. Then load `https://blancbrowser.com/` in a real browser: fonts render (Inter, not a system fallback — check computed `font-family` resolves to `Inter Variable`), demo plays, consent flow works.
