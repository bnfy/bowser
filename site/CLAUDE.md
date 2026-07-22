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
(bundled + hashed; fonts self-hosted via fontsource — the UI family is `"Inter
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
and writes **`site/src/data/releases.json`** (committed). `src/pages/changelog.astro`
renders it; `src/pages/changelog.xml.js` emits the RSS via `src/lib/rss.mjs`.
`npm run site:changelog` regenerates; `npm run site:changelog:check` is the
freshness guard (release-time/manual — not in CI; needs `gh`). Never hand-edit
`releases.json`. `release.sh` runs the regenerate step (non-fatal) but no
longer seds any site file — the JSON-LD version and sitemap `lastmod` both
resolve at build time, so the routine post-release redeploy picks them up.

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
tag) and `compress-images.mjs` (re-runnable lossless image optimization —
jpegtran + oxipng via Homebrew, with a pixel/ICC/cICP-equality gate; several
PNGs are cICP Display P3, so never optimize them with a tool that drops
ancillary chunks).
