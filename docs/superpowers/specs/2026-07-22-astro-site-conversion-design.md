# Astro Site Conversion — Design

**Date:** 2026-07-22
**Status:** Approved
**Scope:** Convert the marketing site (`site/`) from hand-maintained static HTML to an Astro project. Faithful port plus agreed modernizations: self-hosted fonts, hashed CSS/JS bundling, auto-generated sitemap, offline image compression. Same look, same deployed URLs, same SEO/meta output — plus exactly one narrow copy change: the privacy policy's website-fonts disclosure, which self-hosting makes false (see §3).

## Goals

1. **Kill the duplication.** Header/nav, footer, consent banner, favicon links, fonts, and the full OG/Twitter meta block are pasted into 14 HTML pages (plus a 15th copy inside the changelog generator's template string). One layout should own all of it.
2. **Modernize the delivery** without changing what visitors or crawlers see: self-hosted fonts (drop the Google Fonts CDN dependency), content-hashed CSS/JS (drop hand-bumped `?v=` cache busting), generated sitemap (drop the `release.sh` sed), recompressed images.
3. **Zero URL/SEO change.** Every deployed file path, canonical, OG image URL, and the `/sitemap.xml` + `/changelog.xml` URLs stay exactly as they are.

## Non-goals

- No redesign, no copy changes (sole exception: the privacy-policy fonts disclosure, §3), no new pages.
- No content collections / blog scaffolding (the "foundation for growth" option was explicitly not chosen).
- No change to the Cloudflare Pages project, domain, or direct-upload deployment model.

## Current state (what we're converting)

- 14 pages: `index`, `download`, `features`, `about`, `privacy`, `terms`, `changelog` (generated), and `features/{island,ad-blocking,private-tabs,command-palette,tab-groups,sync,security}`. (`site/CLAUDE.md`'s page list is stale — it's missing `sync` and `security`.)
- `styles.css` (783 lines), `site.js` (release-link resolution + consent-gated GA), `demo.js` (self-playing Island demo, **loaded only by `index.html`**; feature pages have static `<picture>` shots only).
- No build step. Deploy: `npx wrangler pages deploy site --project-name=blancbrowser`.
- `scripts/generate-site-changelog.mjs` renders finished `changelog.html` + `changelog.xml` from GitHub releases (via `gh`), with a `--check` freshness mode, unit-tested in `test/unit/site-changelog.test.js`, run non-fatally by `release.sh`.
- `release.sh` also seds the JSON-LD `softwareVersion` in `site/index.html` and `<lastmod>` in `site/sitemap.xml`.
- Canonicals are extensionless (`https://blancbrowser.com/features/island`) while files are `.html`; Cloudflare Pages serves both. Internal links are relative with `.html` extensions.
- `demo.js` computes shot URLs at runtime: `'shots/' + (MOBILE ? 'mobile' : 'desktop') + '/' + id + '.jpg'` — these and all `feature-*.png` (OG images referenced by absolute URL) require stable, unhashed paths.

## Decisions made

| Decision | Choice |
|---|---|
| Scope | Faithful port + modernization |
| URL layout | `build.format: 'file'` — emit `features/island.html` etc., byte-identical deployed layout; internal links normalized to root-relative extensionless (`/features/island`) |
| Changelog | Generator emits committed `releases.json`; Astro renders the page and RSS |
| Project layout | Self-contained `site/package.json`; Electron app's root dependency tree untouched |
| Componentization | One BaseLayout + verbatim-ish page bodies; only truly-shared chrome extracted |
| Modernizations | Self-hosted fonts, hashed CSS/JS, generated sitemap (custom endpoint, see below), offline image recompression |

## Design

### 1. Project shape

```
site/
  package.json            astro + fontsource packages; scripts: dev, build, preview
  package-lock.json       committed (npm ci in CI requires it)
  astro.config.mjs        site: 'https://blancbrowser.com', build: { format: 'file',
                          inlineStylesheets: 'never' }, vite.build.assetsInlineLimit: 0
  src/
    layouts/BaseLayout.astro
    components/BrandMark.astro   the brand SVG (currently pasted verbatim ~16 places)
    components/Header.astro      site header/nav with current-page highlighting
    components/Footer.astro      compact footer
    components/Consent.astro     analytics consent banner
    pages/index.astro
    pages/download.astro
    pages/features.astro
    pages/about.astro
    pages/privacy.astro
    pages/terms.astro
    pages/changelog.astro        renders src/data/releases.json
    pages/changelog.xml.js       RSS endpoint, same JSON
    pages/sitemap.xml.js         sitemap endpoint (see §5)
    pages/features/{island,ad-blocking,private-tabs,command-palette,tab-groups,sync,security}.astro
    data/releases.json           committed, written by generate-site-changelog.mjs
    styles/site.css              ex styles.css, imported by BaseLayout → bundled + hashed
    scripts/site.js              ex site.js, logic verbatim
    scripts/demo.js              ex demo.js, shotSrc made root-relative (/shots/…)
  public/
    favicon.ico favicon.svg favicon-16x16.png favicon-32x32.png apple-touch-icon.png
    og-image.png logo.png feature-*.png      stable URLs — OG/JSON-LD reference these absolutely
    robots.txt
    shots/{desktop,mobile}/*.jpg             stable URLs — demo.js builds these at runtime
```

- `build.format: 'file'`: `src/pages/features/island.astro` → `dist/features/island.html`, matching today's deployed layout exactly. No redirects, no Search Console churn.
- Internal links: root-relative extensionless (`/features/island`, `/download`, `/`) — matches the canonicals Cloudflare Pages already serves today. (Today's links are relative `.html`; both work, extensionless is the cleanup.)
- Root `package.json` proxy scripts: `site:dev` → `npm --prefix site run dev`, `site:build` → `npm --prefix site run build`, `site:deploy` → build + `npx wrangler pages deploy site/dist --project-name=blancbrowser`.
- The old committed `site/changelog.html`, `site/changelog.xml`, `site/sitemap.xml` are deleted (all three become build outputs); `releases.json` replaces `changelog.html` as the committed generated artifact.

### 2. BaseLayout, variants & head contract

Today's pages are **not** uniform — the layout must model three existing profiles explicitly so the differences stay intentional, not accidental:

| Pages | Header | Footer | `site.js` + consent | `data-page` | OG/Twitter |
|---|---|---|---|---|---|
| `index` | `site-header` (non-solid) | full `<footer>` (social icons) | yes (+ `demo.js`) | `home` | **rich**: adds `og:image:secure_url`/`type`/`width`/`height`, `og:locale` |
| `download`, `features`, `about`, `changelog`, `features/*` | `site-header--solid` | `compact-footer` | yes | per-page | **standard**: title/description/url/image/alt + twitter card |
| `privacy`, `terms` | `legal-top` (mark + wordmark link home, no nav) | full `<footer>` (social icons) | **no** | none (plain `<body>`) | **none**; `robots` is plain `index,follow` (no `max-image-preview:large`), no `theme-color` companions beyond what those pages carry today |

`BaseLayout.astro` props:

- `title`, `description` — required.
- `path` — the canonical path (`/`, `/features/island`, …). Drives `<link rel="canonical">`, `og:url`, and nav current-page highlighting.
- `page` — `data-page` value on `<body>`; optional (legal pages omit it).
- `header` — `'island' | 'solid' | 'legal'` (naming indicative), selecting the three header treatments above.
- `footer` — `'full' | 'compact'`.
- `analytics` — boolean; gates the consent banner **and** the `site.js` include (legal pages ship neither today).
- `social` — `'rich' | 'standard' | 'none'`, selecting the OG/Twitter profile. `ogTitle`/`ogDescription` default to `title`/`description` (today's values sometimes differ; preserve exact current values per page); `ogImage`/`ogImageAlt` default to `og-image.png` + its alt, feature pages pass their `feature-*.png`.
- `robots` — defaults to `index,follow,max-image-preview:large`; legal pages pass `index,follow`.
- A named `head` slot for page-specific extras: index's JSON-LD `@graph`, feature pages' JSON-LD, changelog's `<link rel="alternate" type="application/rss+xml">`.

The layout renders: charset/viewport, title/description/robots/theme-color/application-name/apple-mobile-web-app-title (the latter two only where present today), canonical, the selected OG/Twitter profile, favicon links, font imports, stylesheet, the selected `<Header/>` variant, `<slot/>` (page body), the selected `<Footer/>` variant, and — when `analytics` — `<Consent/>` and the `site.js` script. Each variant's markup is ported verbatim from the current pages; the head-diff verification (§7) must confirm *absence* as well as presence (e.g. no OG block may appear on `privacy`/`terms`).

**JSON-LD `softwareVersion`** on index is read from the **root** `package.json` at build time (`import pkg from '../../../package.json'`). `release.sh`'s sed of `site/index.html` is deleted; the routine post-release site redeploy picks up the new version by rebuilding.

Every page's `<head>` output must match today's modulo the intended deltas (font links, hashed asset URLs). Preserve exact current per-page title/description/OG values — they were individually SEO-tuned; this is a port, not a rewrite.

### 3. Styles, fonts, scripts

- **CSS:** `src/styles/site.css` imported in BaseLayout frontmatter → one bundled, content-hashed stylesheet. Hand-bumped `?v=` query strings die.
- **Fonts:** `@fontsource-variable/inter` + `@fontsource/jetbrains-mono` (400/500/700), imported in CSS. **Family-name caveat:** the fontsource variable package declares `Inter Variable`, not `Inter` — so `--font-ui` in `site.css` is updated to `"Inter Variable", "Inter", -apple-system, …` (keeping `"Inter"` as a fallback). Without this the site silently falls back to system fonts. `site/styles.css` is *not* under the `tokens/` substrate guard (that covers the app's renderer CSS), so this edit needs no `tokens.json` change. JetBrains Mono's static package declares `JetBrains Mono` as-is; `--font-mono` is untouched. The variable Inter also preserves today's rendering exactly — the current Google link serves variable `wght@100..900`. Google Fonts `<link>`s and preconnects removed.
- **Privacy-policy copy (the one allowed copy change):** self-hosting makes the website-section disclosure in `privacy.html` ("**Fonts** load from Google Fonts, so Google may see your IP address…") false. Replace that bullet with an accurate self-hosted statement and bump the `legal-updated` date. The **app**-section disclosure ("it loads its interface fonts from Google Fonts") stays — the Electron UI still loads Google Fonts.
- **No inlining — explicit asset contract:** Astro inlines processed scripts/styles below Vite's 4096-byte `assetsInlineLimit`, and `site.js` is 4,023 bytes — "bundled and hashed" would silently become "inlined". Set `vite: { build: { assetsInlineLimit: 0 } }` and `build: { inlineStylesheets: 'never' }` in `astro.config.mjs`; verification (§7) asserts `dist/` contains external hashed `.css`/`.js` files that pages reference.
- **Scripts:** `site.js` included by BaseLayout (when `analytics`, per §2), `demo.js` only by `index.astro`, both as Astro-processed `<script>` (bundled, hashed, module semantics — both files are IIFE-wrapped and order-independent, so module deferral is equivalent to today's `defer`). Only code change: `demo.js` `shotSrc` becomes `'/shots/…'`. The changelog search script stays inline (`is:inline`) on `changelog.astro`. GA consent logic verbatim, including the `G-MN8BLY6GE9` id and `data-track` delegation.
- **Images:** everything stays in `public/` at stable paths. Modernization = one-time offline recompression (lossless/near-lossless — e.g. `oxipng`/`jpegtran`-class tools) of `shots/*.jpg` and the PNGs. No Astro image pipeline: OG images and runtime-computed shot URLs cannot be hashed, and nothing else references images statically.

### 4. Changelog pipeline

`scripts/generate-site-changelog.mjs` (stays in root `scripts/` — it shells out to `gh` and is unit-tested from root):

- **Keeps:** `fetchReleases`, `parseJsonDocuments`, `parseGeneratedNotes`, `normalizeReleases`, `scrubLegacyName`, `blancGithubUrl`, the timezone-correct date rendering (`humanDate`/`machineDate` — move the formatting into the emitted JSON so the Astro page doesn't re-implement timezone logic), `--check`, `--input`, `--output-dir`.
- **Changes:** emits `site/src/data/releases.json` — the normalized release array (tag, version, name, publishedAt, url, anchor, changes, compareUrl, extraParagraphs, humanDate, machineDate). Deletes `renderChangelog`/`renderRss` and the embedded HTML template (including its pasted brand SVG and duplicated header/footer). `--check` compares the JSON file against freshly-fetched-and-normalized releases.
- `changelog.astro` renders the same release-article DOM as today (`.release` articles with anchor ids, search input, empty-state row) inside BaseLayout.
- `changelog.xml.js` emits the same RSS 2.0 shape (20 newest items, `lastBuildDate`, same escaping) at the same `/changelog.xml` URL.
- `release.sh`: the `npm run site:changelog` call is unchanged in name, position, and non-fatality; its message ("commit and redeploy site/ after this release") still applies — the commit is now `releases.json`.
- `test/unit/site-changelog.test.js`: parse/normalize/scrub tests carry over; HTML/XML string-rendering assertions are replaced by JSON-output assertions. Page/RSS rendering correctness is covered by the build-output verification (§7).

### 5. Sitemap & robots

`@astrojs/sitemap` is **not** used — it emits a fixed-name `sitemap-index.xml`, changing the URL Search Console already knows. Instead, a small custom `src/pages/sitemap.xml.js` endpoint:

- Is driven by an **explicit route manifest** carrying the fields today's sitemap actually has: `{ path, changefreq, priority }` per route (today: `/` is `weekly`/`1.0`, `/download` `monthly`/`0.9`, feature pages `monthly`/`0.8`, etc. — copy every current value exactly).
- **Asserts at build time** that the manifest and the discovered Astro pages (`src/pages/**/*.astro`) match exactly — a page missing from the manifest or a manifest entry with no page fails the build loudly; the sitemap can never silently shrink or drift.
- Serves at the existing `/sitemap.xml` URL with extensionless `<loc>` URLs exactly as today.
- `<lastmod>` = build date, replacing the `release.sh` sed.

Both generated XML endpoints (`sitemap.xml`, `changelog.xml`) must be served with an XML content type — as `.xml` build outputs Cloudflare Pages does this by extension; post-deploy verification (§7) confirms the `Content-Type` headers.

`robots.txt` stays in `public/` unchanged (it already points at `/sitemap.xml`).

### 6. Tooling, CI & docs impact

- **`release.sh`:** delete the "Syncing site metadata" block (both seds and the associated `git diff` check/message). Changelog step untouched.
- **Lockfile:** `site/package-lock.json` is committed — `npm ci` requires it.
- **CI:** a **dedicated workflow** (e.g. `.github/workflows/site.yml`), not a bolt-on to `parity-guards.yml`. Path filters: `site/**`, **root `package.json`** (a build input — the JSON-LD `softwareVersion` imports it), and `scripts/generate-site-changelog.mjs` (part of the `releases.json` contract). Job: `npm ci` + `npm run build` in `site/`, with `actions/setup-node` npm caching keyed on `cache-dependency-path: site/package-lock.json`. `site:changelog:check` is *not* added to CI (it needs `gh` auth and live GitHub data; it remains a release-time/manual guard, as today).
- **`site/CLAUDE.md`:** rewritten — build step now exists (`site:dev`/`site:build`), deploy is `wrangler pages deploy site/dist`, changelog data flow (`releases.json` → Astro), corrected page list (add `sync`, `security`), note that `release.sh` no longer seds site files. Root `CLAUDE.md`/`AGENTS.md` untouched (site guidance already delegated to `site/CLAUDE.md`).
- **Other live deploy commands:** the old `wrangler pages deploy site` command also appears in `README.md` (rename-status section, ~line 234) and `docs/polar-setup.md` (step 6) — both updated to the new `site/dist` form (or the `npm run site:deploy` proxy), not just `site/CLAUDE.md`.
- **Deploy:** `npx wrangler pages deploy site/dist --project-name=blancbrowser` (only the path changes).

### 7. Verification

Faithfulness is the whole game; verify before deploying:

1. **Head diff:** script that renders old and new versions of every page and diffs `<head>` metadata (title, description, canonical, robots, full OG/Twitter set, JSON-LD). Only intended deltas allowed: font links, hashed asset URLs, removed `?v=` params, the privacy-policy copy change. The diff must confirm **absence as well as presence** — e.g. `privacy`/`terms` must still carry no OG/Twitter block, no `site.js`, no consent markup (§2's variant table is the contract).
2. **Visual diff:** Playwright screenshots of all 14 pages at desktop and ≤560px mobile widths, old vs. new, compared for regressions (fonts self-hosted vs. CDN may cause sub-pixel metric shifts; judge those by eye once).
3. **Behavior:** Island demo plays on index (shots load from `/shots/…`), consent banner allow/deny + GA load, download-link resolution against the GitHub API, changelog search, `data-track` attributes present.
4. **Machine outputs:** `/changelog.xml` validates as RSS 2.0 with identical item shape; `/sitemap.xml` entries compared **field-by-field** against today's file — `loc`, `changefreq`, and `priority` all identical per route (`lastmod` = build date is the one allowed delta); `dist/` contains external content-hashed `.css`/`.js` files referenced by the pages (nothing inlined, per §3); `dist/` file layout matches today's deployed layout (`diff <(find …)`).
5. **Repo checks:** `npm run test:unit` green (updated changelog tests), `npm --prefix site run build` green, `release.sh` dry-read to confirm the deleted block isn't referenced elsewhere.
6. **Post-deploy:** `/sitemap.xml` and `/changelog.xml` served with an XML `Content-Type`; spot-check canonicals and one feature page's OG tags on the live domain.

## Risks & mitigations

- **Font swap shifts metrics** (CDN Inter vs. fontsource Inter are the same upstream files, but subsetting differs) → visual diff in §7 catches it; worst case, pin the same unicode ranges.
- **Astro HTML compression changes markup whitespace** → default `compressHTML` is fine (whitespace-only), but if the head diff flags anything semantic, disable it. Note: inline scripts and `<pre>` are untouched by it.
- **Search Console notices the CSS/JS URL changes** → irrelevant; only HTML URLs matter, and those are unchanged.
- **A future release runs old muscle memory** (`wrangler pages deploy site`) → deploying the source dir instead of `dist/` would ship raw `.astro` files; mitigated by the root `site:deploy` script + `site/CLAUDE.md` rewrite. Consider a `site/_headers`-style tripwire unnecessary — the deploy would visibly 404 immediately.

## Implementation order (for the plan)

1. Scaffold Astro project in `site/` (config incl. the no-inlining options, package.json + committed lockfile, root proxy scripts) with one page ported end-to-end (`about.html` — simplest) to prove layout + build format + deploy layout.
2. BaseLayout with the three variants (§2) + components; port remaining static pages, including the legal pages' no-analytics/no-OG profile.
3. Fonts (incl. the `Inter Variable` token fix and the privacy-policy copy change) + asset bundling + link normalization.
4. Changelog: generator → JSON, `changelog.astro`, `changelog.xml.js`, unit-test updates.
5. `sitemap.xml.js` with route manifest + build-time assertion; delete `release.sh` metadata block.
6. Image recompression pass.
7. Verification suite (§7), dedicated CI workflow, `site/CLAUDE.md` rewrite + README/polar-setup deploy-command updates.
8. Deploy + post-deploy spot checks.
