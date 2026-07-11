# Marketing Site Release 2 — M1 Momentum & Trust Implementation Plan

> **For agentic workers:** implement this plan task-by-task, in order. Each task
> is independently reviewable and ends with a verification gate. Read the
> Release 2 design spec and `site/CLAUDE.md` before editing.

**Goal:** Give visitors concrete proof that Blanc is active, accountable, and
safe to evaluate by shipping a static changelog with RSS, a founder/about page,
accurate download trust copy, and direct answers to the site's missing trust
questions.

**Architecture:** Keep the site as committed static HTML/CSS with no runtime
framework and no deployment build. A dependency-free Node generator reads
published GitHub releases through the already-required `gh` CLI and writes two
committed artifacts: `site/changelog.html` and `site/changelog.xml`. Every other
M1 page remains hand-authored HTML using the existing shared visual shell.
`release.sh` refreshes the changelog after creating a GitHub release, but a site
generation failure must never prevent the Windows/Linux workflow from being
dispatched.

**Tech stack:** static HTML, existing `site/styles.css` and `site/site.js`, Node
built-ins, `gh` CLI, Node's built-in test runner, local HTTP server.

**Spec:** `docs/superpowers/specs/2026-07-11-marketing-site-release-2-design.md`

## Product-truth decisions already resolved

- The current macOS builds are signed and notarized. Preserve the existing
  `signed and notarized` platform-card copy and explain Gatekeeper in the trust
  section without broadening that claim to other platforms.
- Packaged builds use `electron-updater`; development runs do not. Site copy may
  say installed release builds update automatically.
- The launch ping is on by default and can be disabled in Settings. It includes
  a persistent random install ID, a per-launch random session ID, app version,
  platform, and architecture. It contains no browsing data. Do **not** call it
  anonymous or identifier-free.
- The v0.15.5 Windows installer is unsigned. GitHub Actions run `29140212365`
  took the explicit unsigned fallback because the Azure certificate profile and
  `CSC_LINK` were empty. Do not imply Authenticode or Azure Trusted Signing.
- Bootstrapping means founder control and no investor-set product agenda. It
  does not guarantee that a solo-maintained product can never be discontinued.
- Blanc is free; the $19 one-time Supporter purchase unlocks only three cosmetic
  icon colorways. Do not imply paid browser functionality or priority support.
- Keep user-facing `Favorites`; do not rename internal `bookmarks` identifiers.

## Global constraints

- No new npm dependency. Release-note parsing, HTML/XML escaping, CLI execution,
  and file comparison use Node built-ins.
- Generated changelog output is committed, crawlable HTML. The browser must not
  fetch GitHub release data at page load.
- Only published, non-draft, non-prerelease GitHub releases appear. Sort by
  `published_at` descending; never assume semantic versions are contiguous
  (v0.15.2 does not exist).
- The generator must be deterministic: no current timestamp. RSS
  `lastBuildDate` comes from the newest included release.
- Treat release bodies as untrusted text at the renderer boundary. Escape all
  text and only create links from validated `https://github.com/bnfy/blanc/`
  URLs.
- Preserve the site's extensionless canonical URLs while using `.html` hrefs in
  static source, matching Release 1.
- Keep analytics consent-gated. New CTAs reuse existing event names and add
  page-specific `data-*` values; no new tracking system.
- Any new visible page gets canonical, OG, Twitter, favicon, font, consent
  banner, and `site.js` wiring consistent with existing pages.
- Do not edit release notes or generated changelog artifacts by hand; fix the
  release source or generator and rerun it.

---

### Task 1: Build a deterministic GitHub-release normalizer

Create and test the data layer before coupling it to page markup.

**Files:**

- Create: `scripts/generate-site-changelog.mjs`
- Create: `test/fixtures/site-releases.json`
- Create: `test/unit/site-changelog.test.js`
- Modify: `package.json`

**Public interfaces:**

- `fetchReleases(): Array<GitHubRelease>` — invokes `gh api --paginate`.
- `normalizeReleases(raw): Array<Release>` — filters and sorts.
- `parseGeneratedNotes(body): { changes, compareUrl, extraParagraphs }`.
- `renderChangelog(releases): string`.
- `renderRss(releases): string`.
- CLI flags: `--input <json>` for offline fixture input and `--check` for
  committed-output freshness verification.

- [ ] **Step 1: Add fixture data from real Blanc notes**

Include sanitized snapshots of v0.15.5, v0.15.4, and v0.15.3, plus one draft
and one prerelease that must be filtered out. Preserve the real generated-notes
shape:

```text
## What's Changed
* fix(...): description by @bnfy in https://github.com/bnfy/blanc/pull/NN

**Full Changelog**: https://github.com/bnfy/blanc/compare/...
```

- [ ] **Step 2: Implement normalization and escaping**

Use `execFileSync('gh', ['api', '--paginate',
'repos/bnfy/blanc/releases?per_page=100'], ...)` so no shell interpolation is
involved. GitHub pagination can return either one JSON array or concatenated
arrays; normalize both before filtering.

For generated-note bullets, remove the mechanical `by @user in` suffix from
the visible label and retain the PR URL as the link. Keep the conventional
commit prefix (`feat:`, `fix(area):`) because it communicates the type of
change. Extract the `Full Changelog` compare URL separately. Any line outside
the known generated-notes structure becomes escaped plain text, never raw HTML.

- [ ] **Step 3: Implement deterministic HTML and RSS renderers**

The HTML renderer owns the complete `site/changelog.html` document, not just a
fragment. Each release gets:

- a `<article>` with a stable id such as `v0-15-5`;
- `<time datetime="2026-07-11">July 11, 2026</time>`;
- a visible `Blanc 0.15.5` heading;
- a clean change list;
- links to the GitHub release and full compare view.

The RSS renderer writes RSS 2.0 at `site/changelog.xml`, uses
`https://blancbrowser.com/changelog` as the channel link, includes the 20 newest
releases, uses the GitHub release URL as each item GUID, and escapes XML
independently from HTML.

- [ ] **Step 4: Add CLI modes**

Default mode fetches through `gh` and writes both output files. `--input`
reads local JSON instead, allowing offline tests. `--check` renders in memory,
compares exact bytes with both committed artifacts, and exits non-zero with a
clear rerun command when stale.

Add scripts:

```json
"site:changelog": "node scripts/generate-site-changelog.mjs",
"site:changelog:check": "node scripts/generate-site-changelog.mjs --check"
```

- [ ] **Step 5: Test the pure behavior**

Cover filtering, descending dates, missing-version gaps, escaping of a hostile
`<script>` title, rejection of a non-Blanc link, generated-note cleanup,
deterministic output, RSS item limits, and `--check` mismatch behavior.

Run:

```bash
node --test test/unit/site-changelog.test.js
node scripts/generate-site-changelog.mjs --input test/fixtures/site-releases.json
```

Expected: tests pass; both static artifacts are created with no network access.

---

### Task 2: Design and generate the changelog page

Make the generator's full-document template part of the existing site rather
than a generic release feed.

**Files:**

- Modify: `scripts/generate-site-changelog.mjs`
- Modify: `site/styles.css`
- Generate: `site/changelog.html`
- Generate: `site/changelog.xml`

- [ ] **Step 1: Add the changelog page shell**

Use:

- title: `Blanc Browser Changelog — What’s new`;
- description: `See what changed in each Blanc Browser release, from new
  features to security, privacy, and platform fixes.`;
- canonical: `https://blancbrowser.com/changelog`;
- body `data-page="changelog"`;
- `<link rel="alternate" type="application/rss+xml" title="Blanc Browser
  Changelog" href="/changelog.xml">`;
- eyebrow `shipping in public`;
- H1 `Every Blanc release, in one place.`;
- answer-first intro explaining that the page mirrors published GitHub releases;
- a visible `subscribe via RSS` link.

Use the shared solid header, compact footer, consent banner, and `site.js`.
Mark `changelog` current in the header.

- [ ] **Step 2: Add restrained changelog styles**

Add a document-width layout and release timeline to `site/styles.css` using
existing tokens. Keep version/date metadata mono, use borders rather than
cards, and make release anchors easy to scan. Include narrow-screen rules so
the version/date column stacks above the notes without horizontal overflow.

- [ ] **Step 3: Generate from live releases and verify idempotence**

Run:

```bash
npm run site:changelog
npm run site:changelog:check
```

Run `npm run site:changelog` a second time and confirm it produces no further
diff. Inspect v0.15.5, v0.15.4, and v0.15.3; do not fabricate v0.15.2. The
existing `site/robots.txt` already advertises the sitemap, so it needs no M1
change; feed discovery comes from the HTML `<link rel="alternate">`.

---

### Task 3: Add the founder-controlled `/about` page

**Files:**

- Create: `site/about.html`
- Modify: `site/styles.css`

- [ ] **Step 1: Build the page with four factual sections**

Use:

- title: `About Blanc Browser — Independent and built in Rochester`;
- canonical: `https://blancbrowser.com/about`;
- body `data-page="about"`;
- eyebrow `independent by design`;
- H1 focused on direct accountability, not invincibility.

Sections:

1. **Named maker:** Anthony J. Loria builds Blanc through Bananify in
   Rochester, New York. Present the one-person product/design/support role as a
   direct line to the maker.
2. **Lineage:** Bananify established in 2024, with AJLMEDIA work dating to 2006.
   Keep this a short provenance note, not an inflated company timeline.
3. **Funding:** no venture funding, ads business, or investor-set product
   agenda. Say founder-controlled; do not promise no future shutdown,
   acquisition, or change of direction.
4. **Supporter model:** Blanc's browser features are complete and free. A $19
   one-time Polar purchase supports the work and unlocks three cosmetic app
   icons. Reuse the existing Polar checkout URL and `supporter_click` event.

End with `Questions reach a human.` and the existing support email, plus a
secondary changelog link as evidence of ongoing work.

- [ ] **Step 2: Add about-specific layout**

Use the existing page rhythm: centered answer-first hero, then two-column proof
rows with mono labels and plain copy. Do not add founder photography unless a
real approved asset is present. Make the Supporter section visually secondary
to the independence story.

- [ ] **Step 3: Validate claims against repository truth**

Check the checkout URL in `site/index.html`, supporter behavior in
`src/main/supporter.js`/`src/main/settings.js`, and terms in `site/terms.html`.
Do not publish any perk beyond the three supporter icon colorways.

---

### Task 4: Put trust evidence and the Windows warning on `/download`

**Files:**

- Modify: `site/download.html`
- Modify: `site/styles.css`

- [ ] **Step 1: Add a trust section below platform choices**

Create three visible proof rows:

1. `macOS, signed and notarized` — identify Gatekeeper and keep the claim
   macOS-specific.
2. `Updates arrive in place` — installed release builds check GitHub Releases
   and update automatically.
3. `One launch ping, with an off switch` — list the exact fields: random
   install ID, random session ID, version, platform, architecture; explicitly
   say no browsing history, URLs, searches, or page content. Link Privacy and
   mention Settings → Privacy as the off switch.

- [ ] **Step 2: Add the honest Windows FAQ**

Use a visible, non-collapsed answer:

`Why might Windows warn about Blanc?`

Explain that the current installer is not code-signed, so Microsoft Defender
SmartScreen may show `unknown publisher` or `Windows protected your PC`. State
that Windows signing is still being completed, link only to the canonical
`bnfy/blanc` GitHub release, and advise visitors not to install copies from
other sources. Do not describe the warning as harmless and do not claim
SmartScreen trust.

- [ ] **Step 3: Add “what’s new” near the download choices**

Link `See what changed in the latest release` to `changelog.html` and track it
as `feature_cta_click` with `data-feature="changelog"` and
`data-cta-position="download-options"`.

- [ ] **Step 4: Preserve platform selection behavior**

Confirm the added markup does not change `data-download-options`,
`data-download-link`, or `site.js` asset resolution. The Windows card continues
to say only `NSIS installer`; it must not gain a signing claim.

---

### Task 5: Cross-link trust pages across the static shell

Because the static site duplicates its header/footer markup, update every page
in one deliberate pass.

**Files:**

- Modify: `site/index.html`
- Modify: `site/features.html`
- Modify: `site/features/island.html`
- Modify: `site/features/ad-blocking.html`
- Modify: `site/features/private-tabs.html`
- Modify: `site/features/command-palette.html`
- Modify: `site/features/tab-groups.html`
- Modify: `site/download.html`
- Modify: `site/privacy.html`
- Modify: `site/terms.html`
- Modify: `scripts/generate-site-changelog.mjs` (generated shell)
- Modify/Generate: `site/changelog.html`
- Modify: `site/about.html`
- Modify: `site/styles.css`

- [ ] **Step 1: Update primary navigation**

Desktop order: `features`, `about`, `changelog`, then the persistent download
button. Apply `is-current` and `aria-current="page"` on the active page.

At `max-width: 640px`, keep the header usable by showing `features` and
`changelog`, hiding `about` with a semantic utility class (About remains in the
footer). At `max-width: 360px`, continue hiding the brand wordmark. Verify the
download button never wraps or leaves the viewport.

- [ ] **Step 2: Update every footer**

Use the provenance line `built in Rochester, NY · no investors` without
claiming perpetual operation. Add About and Changelog to footer links. Preserve
Privacy, Terms, and existing social/GitHub links where each footer already has
them.

- [ ] **Step 3: Upgrade the home FAQ**

Add visible answers:

- `Who makes Blanc?` — Anthony J. Loria through Bananify in Rochester, with an
  About link.
- `Is Blanc actively developed?` — point to the public changelog and GitHub
  releases.

Keep existing answers and avoid an accordion so the copy remains crawlable.

- [ ] **Step 4: Regenerate changelog shell after shared-copy changes**

Run `npm run site:changelog`; never patch `site/changelog.html` directly.

- [ ] **Step 5: Audit relative links**

Root pages use `about.html` / `changelog.html`; feature-detail pages use
`../about.html` / `../changelog.html`. Confirm every local target exists.

---

### Task 6: Add discovery metadata and release integration

**Files:**

- Modify: `site/sitemap.xml`
- Modify: `scripts/release.sh`
- Modify: `site/CLAUDE.md`

- [ ] **Step 1: Add `/about` and `/changelog` to the sitemap**

Use canonical extensionless `<loc>` values. Suggested settings:

- `/changelog`: `changefreq` weekly, priority `0.8`;
- `/about`: `changefreq` yearly, priority `0.6`.

Use the implementation date for each initial `<lastmod>`. Keep the existing
release metadata sed behavior intact.

- [ ] **Step 2: Integrate generation after GitHub release creation**

Immediately after `gh release create`, run the changelog refresh in a guarded
block:

```bash
if npm run site:changelog; then
  echo "==> Changelog refreshed — commit and redeploy site/ after this release."
else
  echo "==> Warning: changelog refresh failed; continuing with platform builds." >&2
fi
```

This placement lets the generator see the new published release. It must be
non-fatal because the release already exists and Release 2's immutability rule
means aborting here would strand the Windows/Linux dispatch. Do not move it
before `gh release create`, where the new notes do not exist yet.

- [ ] **Step 3: Update release-source dirtiness guard**

Add `scripts/generate-site-changelog.mjs` to `RELEASE_SOURCES` because it is now
part of the release process. The generated `site/` output remains outside the
pre-release dirty guard, matching existing site metadata behavior.

- [ ] **Step 4: Update `site/CLAUDE.md` runbook**

Document:

- `npm run site:changelog` requires authenticated `gh` and writes committed
  HTML/RSS;
- `npm run site:changelog:check` is the freshness guard;
- release automation refreshes the artifacts after release creation;
- the site still requires a separate commit and Cloudflare Pages deployment;
- Windows signing copy must be revisited when Azure Trusted Signing actually
  ships—never merely when configuration is added.

- [ ] **Step 5: Shell syntax check**

Run:

```bash
bash -n scripts/release.sh
npm run site:changelog:check
```

Do not run `npm run release` as a test.

---

### Task 7: Full M1 verification and handoff

**Files:** no intended edits except fixes found during verification.

- [ ] **Step 1: Automated checks**

Run:

```bash
node --test test/unit/site-changelog.test.js
npm run site:changelog:check
bash -n scripts/release.sh
```

- [ ] **Step 2: Static integrity checks**

Verify:

- every local `.html`, stylesheet, script, image, and feed link resolves;
- every canonical/OG URL uses `https://blancbrowser.com`;
- `site/sitemap.xml` is well-formed and contains both routes once;
- `site/changelog.xml` is well-formed RSS;
- no page says the Windows build is signed;
- no page calls the launch ping anonymous;
- no page promises Blanc can never be discontinued;
- no draft/prerelease appears in the changelog.

- [ ] **Step 3: Local visual verification**

Serve the directory over HTTP (not `file://`):

```bash
python3 -m http.server 8080 --directory site
```

Inspect `/`, `/about.html`, `/changelog.html`, and `/download.html` at desktop,
640px, 390px, and 320px widths. Confirm:

- header links and current states;
- no horizontal overflow;
- readable release hierarchy and anchor links;
- Supporter CTA is secondary and consent-gated analytics still works;
- Windows warning is prominent enough to prevent surprise but does not
  visually dominate all downloads;
- reduced-motion and keyboard focus behavior remain intact.

- [ ] **Step 4: Content proofread**

Read the four trust-sensitive passages together: About funding, Supporter
offer, launch-ping disclosure, and Windows warning. Compare them against
`src/main/supporter.js`, `src/main/telemetry.js`, `src/main/settings.js`, and
the v0.15.5 Actions log evidence recorded in the spec.

- [ ] **Step 5: Commit sequence**

Use small commits in this order:

1. `Add static changelog generator and RSS feed`
2. `Add independent founder story to marketing site`
3. `Document download trust and Windows signing status`
4. `Link marketing trust pages across the site`
5. `Refresh changelog during the release workflow`

Keep the deployment itself separate. After review, deploy with the existing
Cloudflare Pages command and smoke-test the extensionless production routes.

## M1 definition of done

- `/changelog` and `/changelog.xml` are generated from real published releases,
  committed, deterministic, and discoverable.
- `/about` names the maker, explains founder control and funding accurately,
  and presents Supporter as optional cosmetic patronage.
- `/download` documents macOS signing/notarization, automatic updates, the exact
  launch-ping fields/off switch, and the unsigned Windows SmartScreen warning.
- Home FAQ, navigation, footer provenance, sitemap, and cross-links make the new
  evidence easy to find on desktop and mobile.
- Release automation refreshes the changelog without risking a partially
  published cross-platform release.
- Automated checks and visual QA pass; no unsupported trust claim remains.
