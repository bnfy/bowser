# Network Privacy M1 — Security Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the site-only security messaging milestone (M1) of the network-privacy spec: a `site/features/security.html` page, a features-hub row, two homepage FAQ entries, and a sitemap entry — claiming only what v0.15.5 already ships.

**Architecture:** Static HTML additions to the no-build marketing site in `site/`, following the existing `features/*` page pattern byte-for-byte (same header/footer/consent/site.js blocks, `../`-relative paths, per-page canonical/OG/breadcrumb JSON-LD). No app code. No new CSS — every class used already exists in `styles.css`.

**Tech Stack:** Plain HTML, existing `site/styles.css` (referenced as `styles.css?v=20260711-7`, the version string currently used by every page), existing `site.js`. Deploy via Cloudflare Pages direct upload.

**Spec:** `docs/superpowers/specs/2026-07-11-network-privacy-design.md` (Track 1 / M1 sections).

## Global Constraints

- **Shipped-only claims (hard rule):** No mention of WebRTC hardening, encrypted DNS/DoH, or the shield report anywhere in M1 copy. Those sentences join the site only in the same release cycle that ships M2/M3/M4.
- **Zero app-code changes.** Only files under `site/` (plus this plan's own commits) may change.
- **Telemetry is "pseudonymous", never "anonymous"** — matching `site/privacy.html`'s existing disclosure ("a random install ID — a token that identifies the installation, not you").
- **Site voice:** plain answers, no fear marketing, no contractions in body copy (existing pages write "do not", "cannot", "you are").
- **Standing site rules:** no personal name or home city; attribution to Bananify; footer stays "built independently · no investors · © 2026"; canonical domain `blancbrowser.com`; no `aggregateRating` or other fabricated structured data.
- **No unsupported comparative claims:** nothing about what "most browsers" do or the "main reason" people do anything — state what Blanc does; call ad blocking "a common reason" to install an extension.
- **Concurrency-safe git hygiene (shared checkout):** before Task 1's first commit, mark the base with `git tag m1-base`; every commit stages only that task's explicitly listed files (never `git add site/`), after running `git status --short` and confirming nothing unplanned is staged; Task 4's scope check diffs `m1-base..HEAD`; the tag's job ends with that scope check — delete it (`git tag -d m1-base`) on **every** exit after Task 4, whether the deploy happens, is deferred, or the run aborts. A leftover tag breaks the next run's Task 1 guard.
- **Never edit** `site/changelog.html` / `site/changelog.xml` by hand (generated files, untouched by this plan).
- **Deploy command:** `npx wrangler pages deploy site --project-name=blancbrowser` (BNFY account, already authenticated). Deploying publishes publicly — Task 5 requires the user's explicit go-ahead first.

---

### Task 1: Create `site/features/security.html` + sitemap entry

**Files:**
- Create: `site/features/security.html`
- Modify: `site/sitemap.xml` (insert one `<url>` block after the `features/tab-groups` entry, line 50)

**Interfaces:**
- Produces: the page at path `features/security.html` that Task 2's hub row and Task 3's FAQ link to (`features/security.html` from site root, `security.html` from inside `features/`).

- [ ] **Step 1: Write the page**

Create `site/features/security.html` with exactly this content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blanc Browser Security — Private by Architecture</title>
<meta name="description" content="How Blanc is built for privacy: sandboxed pages, network-level ad and tracker blocking, no extension runtime, encrypted sync, and a usage ping you can switch off.">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#ffffff">
<meta name="application-name" content="Blanc Browser">
<link rel="canonical" href="https://blancbrowser.com/features/security">
<meta property="og:site_name" content="Blanc Browser"><meta property="og:type" content="website">
<meta property="og:title" content="Blanc Browser Security — Private by Architecture">
<meta property="og:description" content="Sandboxed pages, built-in blocking, encrypted sync, and privacy that is structural, not bolted on.">
<meta property="og:url" content="https://blancbrowser.com/features/security"><meta property="og:image" content="https://blancbrowser.com/og-image.png">
<meta property="og:image:alt" content="Blanc Browser marketing page showing the Blanc Island over real websites.">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Blanc Browser Security — Private by Architecture"><meta name="twitter:description" content="Sandboxed pages, built-in blocking, encrypted sync, and privacy that is structural, not bolted on."><meta name="twitter:image" content="https://blancbrowser.com/og-image.png">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap"><link rel="stylesheet" href="../styles.css?v=20260711-7">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://blancbrowser.com/"},{"@type":"ListItem","position":2,"name":"Features","item":"https://blancbrowser.com/features"},{"@type":"ListItem","position":3,"name":"Security","item":"https://blancbrowser.com/features/security"}]}
</script>
</head>
<body data-page="feature-security">
<header class="site-header site-header--solid"><nav class="site-nav" aria-label="Primary navigation"><a class="site-brand" href="../index.html" aria-label="Blanc Browser home"><svg class="site-brand-mark" viewBox="0 0 149.21 199.16" aria-hidden="true"><path fill="currentColor" d="M132.49,99.93c24.35,25.21,21.69,65.88-5.32,88.01-8.6,6.52-18.14,11.22-29.43,11.22H0S.05,0,.05,0l97.73.34c20.2.07,36.1,15.44,41.57,33.81,5.91,21.3-.72,42.38-18.13,56.78,3.89,3.02,7.96,5.58,11.27,9.01ZM123.05,76.28c11.02-13.76,12.6-31.98,4.74-47.57-6.27-10.66-16.79-19.78-29.98-19.81l-89.13-.21.04,134.11c17.74-38.18,51.53-61.94,94.24-58.73,7.99.6,14.76-1.14,20.08-7.79ZM9.18,186.44l95.77-92.67c-20.99-3.85-41.54,1.86-58.47,14.63-24.42,18.43-37.97,47.69-37.31,78.04ZM116.56,184.68c15.98-9.69,24.44-26.82,23.9-45.09s-10.27-34.19-26.36-42.19L17.5,190.42l81.36-.05c6.08,0,12.28-2.41,17.7-5.69Z"></path></svg><span>Blanc</span></a><div class="site-nav-links"><a class="is-current" href="../features.html" aria-current="page">features</a> <a href="../about.html" class="nav-secondary">about</a> <a href="../changelog.html">changelog</a></div><a class="site-nav-cta" href="../download.html">download blanc</a></nav></header>
<main class="feature-page feature-detail-page">
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="../index.html">home</a><span aria-hidden="true">/</span><a href="../features.html">features</a><span aria-hidden="true">/</span><span aria-current="page">security</span></nav>
  <section class="feature-hero feature-hero--detail feature-hero--text" aria-labelledby="security-title"><p class="section-kicker">the quiet parts</p><h1 id="security-title">Private by architecture.</h1><p>Blanc&rsquo;s privacy is structural: what the browser blocks, what it refuses to run, and how it handles the data you care about.</p></section>
  <figure class="product-capture feature-capture">
    <div class="demo-stage island-figure" data-page-tone="github" role="img" aria-label="Blanc's floating Island over the GitHub website, showing the current domain github.com next to a shield count of two blocked items.">
      <div class="demo-page" aria-hidden="true"><div class="bar w1"></div><div class="bar w2"></div><div class="bar w3"></div><div class="bar w4"></div></div>
      <picture>
        <source media="(max-width: 560px)" srcset="../shots/mobile/github.jpg">
        <img class="demo-shot show" src="../shots/desktop/github.jpg" loading="lazy" alt="" aria-hidden="true">
      </picture>
      <div class="demo-island" aria-hidden="true">
        <div class="pill">
          <div class="pnav">
            <span class="pbtn"><svg viewBox="0 0 16 16"><path d="M9.75 3.5 5.25 8l4.5 4.5"/></svg></span>
            <span class="pbtn off"><svg viewBox="0 0 16 16"><path d="M6.25 3.5 10.75 8l-4.5 4.5"/></svg></span>
          </div>
          <div class="dots"><span></span><span class="cur"></span><span></span></div>
          <span class="pill-fav" style="background-image:url('https://icons.duckduckgo.com/ip3/github.com.ico')"></span>
          <span class="domain">github.com</span>
          <span class="shield">2</span>
          <span class="psep"></span>
          <div class="pacts">
            <span class="pbtn"><svg viewBox="0 0 16 16"><path d="M12.42 10.35a5 5 0 1 1-4.42-7.35c1.4 0 2.74.56 3.74 1.53L13 5.78"/><path d="M13 3v2.78h-2.78"/></svg></span>
            <span class="pbtn heart"><svg viewBox="0 0 16 16"><path d="M8 13.25C4.6 11 2.75 8.9 2.75 6.6a2.85 2.85 0 0 1 5.25-1.54A2.85 2.85 0 0 1 13.25 6.6c0 2.3-1.85 4.4-5.25 6.65z"/></svg></span>
          </div>
        </div>
      </div>
    </div>
    <figcaption>The shield on the Island is the visible edge of blocking that runs inside the browser itself.</figcaption>
  </figure>
  <section class="feature-copy-grid feature-copy-grid--top" aria-labelledby="security-runs-title">
    <div><p class="section-kicker">what runs, and what does not</p><h2 id="security-runs-title">The browser itself is the security layer.</h2></div>
    <div class="feature-copy-list">
      <article><h3>Blocking lives in the network layer.</h3><p>Ad and tracker blocking runs inside the browser, not as an extension — so it is not subject to an extension store&rsquo;s rules or Manifest V3&rsquo;s limits. The shield on the Island shows what was blocked on each page. <a href="ad-blocking.html">How blocking works</a>.</p></article>
      <article><h3>Every page runs sandboxed.</h3><p>Web pages run inside Chromium&rsquo;s sandbox, isolated from the browser and from your files. Blanc&rsquo;s own pages — settings, history, favorites — live on a privileged internal scheme that ordinary web content cannot link into, and the browser re-checks who is calling on every internal request.</p></article>
      <article><h3>No extension runtime — on purpose.</h3><p>Extensions are privileged third-party code running inside your browser. Blanc removed the runtime entirely, which removes that class of risk outright — and a common reason to install one, ad blocking, is already built in at a deeper layer. If you need a specific extension, we are honest about it: Blanc is not your browser today.</p></article>
    </div>
  </section>
  <section class="feature-copy-grid" aria-labelledby="security-leaves-title">
    <div><p class="section-kicker">the sensitive parts</p><h2 id="security-leaves-title">How Blanc handles sensitive data.</h2></div>
    <div class="feature-copy-list">
      <article><h3>Sync the server cannot read.</h3><p>Sync is off by default. When you turn it on, favorites and settings are encrypted on your device with a key derived from your passphrase; the server stores ciphertext it cannot read, index, or merge. The passphrase is never stored and never sent.</p></article>
      <article><h3>Passkeys live in the Secure Enclave.</h3><p>On a Mac with Touch ID, Blanc creates device-bound passkeys inside Apple&rsquo;s Secure Enclave. The private key never leaves the chip, and Blanc is signed with an Apple-issued Developer ID and provisioned to hold its own keychain access group. macOS only for now.</p></article>
      <article><h3>Permissions ask first.</h3><p>Camera, microphone, location, notifications — each request raises a Blanc prompt, and each decision is remembered for that site. Decisions made in a private tab are never written to disk.</p></article>
      <article><h3>A ping per launch, and you can turn it off.</h3><p>When the packaged app launches, it sends a small pseudonymous usage ping; the <a href="../privacy.html">privacy policy</a> lists every field. None of them include browsing data, and the random install ID identifies the installation, not you. Settings turns it off with one switch.</p></article>
    </div>
  </section>
  <aside class="truth-note" aria-labelledby="security-note-title"><p class="section-kicker">good to know</p><h2 id="security-note-title">Private by architecture, not by magic.</h2><p>No browser can make you anonymous on its own. Blanc reduces what runs inside the browser and what leaves your device; it does not hide your traffic from your network, your employer, or your internet provider. If you use a VPN you trust, Blanc runs quietly underneath it.</p><a class="text-link" href="../privacy.html" data-track="feature_cta_click" data-feature="security" data-cta-position="truth-note">Read the full privacy policy <span aria-hidden="true">↗</span></a></aside>
  <section class="feature-close" aria-labelledby="security-close-title"><p class="section-kicker">ready when you are</p><h2 id="security-close-title">A quieter browser, with the quiet parts documented.</h2><a class="cta" href="../download.html" data-track="feature_cta_click" data-feature="security" data-cta-position="feature-close">download blanc</a></section>
</main>
<footer class="compact-footer"><span>built independently · no investors · © 2026 · <a href="https://bnfy.me" target="_blank" rel="noopener">Bananify</a></span><span><a href="../features.html">Features</a> · <a href="../about.html">About</a> · <a href="../changelog.html">Changelog</a> · <a href="../download.html">Download</a> · <a href="../privacy.html">Privacy</a> · <a href="../terms.html">Terms</a></span></footer>
<div id="consent" class="consent" hidden><span>Optional analytics help us gauge interest — allow?</span><button id="consentAllow">Allow</button><button id="consentDeny" class="ghost">No thanks</button></div><script src="../site.js" defer></script>
</body>
</html>
```

- [ ] **Step 2: Add the sitemap entry**

In `site/sitemap.xml`, insert after the `features/tab-groups` `</url>` (currently line 50) and before the `changelog` `<url>`:

```xml
  <url>
    <loc>https://blancbrowser.com/features/security</loc>
    <lastmod>2026-07-11</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
```

- [ ] **Step 3: Verify structure and internal links**

```bash
cd "site" && xmllint --noout sitemap.xml && echo SITEMAP-OK
grep -c "features/security" sitemap.xml
```
Expected: `SITEMAP-OK`, then `1`.

```bash
cd "site" && grep -oE '(href|src|srcset)="[^"]*"' features/security.html \
  | sed -E 's/^[a-z]+="//; s/"$//' \
  | grep -vE '^(https?:|mailto:|#|data:)' \
  | while read -r u; do u="${u%%[#?]*}"; case "$u" in /*) p=".$u";; *) p="features/$u";; esac; [ -e "$p" ] || echo "MISSING: $u"; done
```
Expected: no output (every local href/src resolves to a real file).

- [ ] **Step 4: Verify the shipped-only hard rule**

```bash
grep -niE "webrtc|\bdns\b|doh|shield report|anonymous" "site/features/security.html"
```
Expected: exactly one hit — the truth-note line "No browser can make you anonymous on its own" (a disclaimer, not a claim). Zero hits for webrtc/dns/doh/shield report. Any other result is a violation; fix the copy before proceeding.

- [ ] **Step 5: Mark the base and commit**

```bash
git tag -l m1-base   # must print nothing; a leftover tag means an earlier run aborted — investigate, then git tag -d m1-base before proceeding
git tag m1-base
git status --short   # confirm ONLY the two planned files appear as changes to stage
git add site/features/security.html site/sitemap.xml
git commit -m "Add security feature page and sitemap entry (network-privacy M1)"
```

---

### Task 2: Add the security row to the features hub

**Files:**
- Modify: `site/features.html` (hub list ends at line 124 with the tab-groups `</article>`; also the two description metas at lines 7 and 15, and the twitter description at line 21)

**Interfaces:**
- Consumes: `features/security.html` from Task 1 (link target).

- [ ] **Step 1: Insert row 06**

In `site/features.html`, immediately after the closing `</article>` of the `tab-groups` row (line 124) and before the closing `</section>` of `feature-hub-list`, insert:

```html
    <article class="feature-hub-row" id="security">
      <p class="feature-number">06</p>
      <div>
        <p class="feature-label">private by architecture</p>
        <h2>Security that is structural, not bolted on.</h2>
      </div>
      <div class="feature-row-end">
        <p>Sandboxed pages, network-level blocking, end-to-end encrypted sync, and a usage ping you can switch off. The quiet parts, documented.</p>
        <a class="text-link" href="features/security.html" data-track="feature_cta_click" data-feature="security" data-cta-position="feature-hub">Read the security story <span aria-hidden="true">↗</span></a>
      </div>
    </article>
```

- [ ] **Step 2: Update the page's own descriptions to include the new row**

Line 7, replace:
```html
<meta name="description" content="Explore the Blanc Island, built-in ad and tracker blocking, private tabs, command palette, and tab groups in a minimal desktop browser.">
```
with:
```html
<meta name="description" content="Explore the Blanc Island, built-in ad and tracker blocking, private tabs, command palette, tab groups, and the security architecture of a minimal desktop browser.">
```

Line 15 (`og:description`) and line 21 (`twitter:description`), replace the identical value:
```html
content="One floating control surface, built-in blocking, private tabs, tab groups, and keyboard-first commands."
```
with:
```html
content="One floating control surface, built-in blocking, private tabs, tab groups, keyboard-first commands, and structural security."
```

- [ ] **Step 3: Verify**

```bash
grep -c 'feature-hub-row' "site/features.html"
grep -c 'features/security.html' "site/features.html"
grep -niE "webrtc|\bdns\b|doh|shield report|anonymous" "site/features.html"
```
Expected: `6` rows (5 existing + security; note the featured row's class string contains `feature-hub-row` twice on one line — `grep -c` counts lines, so 6 is correct), `1` link, and no output from the hard-rule grep.

- [ ] **Step 4: Commit**

```bash
git status --short   # confirm ONLY site/features.html appears as a change to stage
git add site/features.html
git commit -m "Add security row to features hub (network-privacy M1)"
```

---

### Task 3: Add the two homepage FAQ entries

**Files:**
- Modify: `site/index.html` (FAQ list, lines 264–289)

**Interfaces:**
- Consumes: `features/security.html` from Task 1 (link target).

- [ ] **Step 1: Insert the two entries**

In `site/index.html`, immediately after the closing `</article>` of the "What do private tabs do?" entry (line 276) and before the "Which systems does Blanc support?" article, insert:

```html
      <article>
        <h3>Is Blanc actually private?</h3>
        <p>Blanc blocks ads and trackers at the browser level, keeps history and favorites on your device, and sends a small pseudonymous usage ping each time it launches — you can turn it off in Settings, and the privacy policy lists every field. Optional sync is end-to-end encrypted — the server stores only data it cannot read. The <a href="features/security.html">security page</a> covers the architecture; the <a href="privacy.html">privacy policy</a> is the full accounting.</p>
      </article>
      <article>
        <h3>Why is there no built-in VPN?</h3>
        <p>Running a VPN means becoming a service business with your traffic in the middle — done honestly it takes audits, infrastructure, and a support organization; done halfway it is a proxy wearing a trench coat. Blanc&rsquo;s privacy work goes where the browser actually is: blocking at the network layer, sandboxing every page, and shipping no third-party extension runtime. If you already use a VPN you trust, Blanc runs under it like any other app on your device.</p>
      </article>
```

- [ ] **Step 2: Verify**

```bash
grep -c '<article>' "site/index.html"
grep -c 'features/security.html' "site/index.html"
grep -niE "webrtc|\bdns\b|doh|shield report|anonymous" "site/index.html"
```
Expected: `8` (verified baseline is 6 `<article>` lines today, plus these two), `1` security-page link, and no output from the hard-rule grep (verified: zero pre-existing hits in `index.html` today; the VPN FAQ mentions "VPN" — that is the question itself, allowed, and the grep patterns deliberately do not include the bare word "VPN").

- [ ] **Step 3: Commit**

```bash
git status --short   # confirm ONLY site/index.html appears as a change to stage
git add site/index.html
git commit -m "Add privacy and no-VPN answers to homepage FAQ (network-privacy M1)"
```

---

### Task 4: Visual and cross-page verification

**Files:**
- None created; fixes (if any) land in the three files above.

**Interfaces:**
- Consumes: all three prior tasks' output, rendered together.

- [ ] **Step 1: Serve the site locally**

```bash
cd "site" && python3 -m http.server 8123
```
(Run in the background; stop it when the task ends.)

- [ ] **Step 2: Check the new page in the browser**

Open `http://localhost:8123/features/security.html` in the Browser pane and verify, in this order:
1. Header, breadcrumb (`home / features / security`), hero, island figure over the GitHub shot with shield count `2`, both copy grids (3 + 4 articles), truth-note, close CTA, footer — all render with the site's normal styling (if the page looks unstyled, the `styles.css?v=` path is wrong).
2. The three in-page links work: "How blocking works" → ad-blocking page, both privacy-policy links → privacy page.
3. Dark mode: toggle the Browser pane to dark color scheme; the page must follow like the sibling feature pages do.
4. Mobile: resize to the mobile preset; the figure must swap to `shots/mobile/github.jpg` (560px breakpoint) and nothing overflows horizontally.

- [ ] **Step 3: Check the two modified pages**

- `http://localhost:8123/features.html`: row `06` renders after tab groups, matching the other rows' typography; its link opens the security page.
- `http://localhost:8123/index.html`: the two new FAQ entries render inside the grid without breaking the two-column layout; both links work.

- [ ] **Step 4: Full-scope hard-rule sweep**

```bash
cd "site" && grep -niE "webrtc|\bdns\b|doh|shield report" features/security.html features.html index.html; echo "sweep done"
```
Expected: only `sweep done`. Then confirm the M1 diff touched nothing outside `site/` (measured from the `m1-base` tag set in Task 1, so interleaved commits from other sessions in this shared checkout are visible rather than silently miscounted):

```bash
git diff --stat m1-base..HEAD -- . ':!site' | cat
git log --oneline m1-base..HEAD | cat
```
Expected: the diff is empty, and the log lists only this plan's commits. If a foreign commit appears in the log, stop and reconcile with the user before deploying.

- [ ] **Step 5: Fix, re-verify, then commit**

If steps 2–4 surfaced fixes: apply them, then **repeat Steps 2–4 in full** — links, mobile and dark mode, the forbidden-claim sweep, and the scope check — because a fix can regress any of them. Only when the rerun is fully green, stage only the affected planned files (some subset of `site/features/security.html`, `site/features.html`, `site/index.html`, `site/sitemap.xml` — never `git add site/`):
```bash
git status --short   # confirm only planned files changed
git add <the specific files you fixed>
git commit -m "Fix security-page verification findings (network-privacy M1)"
```
If the rerun surfaces new findings, repeat the fix → re-verify cycle until green. If nothing needed fixing, skip — no empty commits.

---

### Task 5: Deploy (requires user go-ahead)

**Files:** none — publish step.

- [ ] **Step 1: Ask the user for the go-ahead**

Deploying publishes the pages publicly on blancbrowser.com. Confirm with the user before running the deploy. Do not proceed on silence. If the user defers or declines, still run `git tag -d m1-base` now — the tag's job ended with Task 4's scope check — and stop here.

- [ ] **Step 2: Deploy**

```bash
npx wrangler pages deploy site --project-name=blancbrowser
```
Expected: upload succeeds and prints the deployment URL.

- [ ] **Step 3: Verify live**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://blancbrowser.com/features/security
curl -s https://blancbrowser.com/features/security | grep -c "Private by architecture"
curl -s https://blancbrowser.com/sitemap.xml | grep -c "features/security"
```
Expected: `200`, then `1` (or more), then `1`. Spot-check the live page and the homepage FAQ in the Browser pane.

- [ ] **Step 4: Remove the base tag**

```bash
git tag -d m1-base
```

---

## Self-Review Notes

- **Spec coverage:** security page with seven shipped-only sections (Task 1: three under "what runs, and what does not" + four under "the sensitive parts" = seven), features-index tile (Task 2), two FAQ entries with the shipped-only VPN answer (Task 3), sitemap (Task 1), nav/footer parity (Task 1 copies the standard header/footer verbatim — feature pages are not in the top nav by design, so no other file changes), visual/link verification (Task 4), deploy (Task 5, user-gated).
- **Hard rule enforcement is mechanical, not aspirational:** Tasks 1–4 each carry the forbidden-claims grep with expected output stated.
- **The FAQ heading avoids a contraction** ("Why is there no built-in VPN?") to match the site's no-contraction voice; body copy in all new sections follows the same rule.
- **The spec's M1 FAQ boundary is respected:** the VPN answer's last sentence ("runs under it like any other app") describes how system VPNs work for any app — a shipped-true statement, not a Track 2 claim.
