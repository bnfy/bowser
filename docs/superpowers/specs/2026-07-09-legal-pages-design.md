# Terms of Service & Privacy Policy — Design Spec

- **Date:** 2026-07-09
- **Status:** Approved (pending spec review)
- **Author:** Anthony (Bananify), with Claude
- **Topic:** Legal pages for the marketing site (`site/`)

## 1. Goal

Add a **Privacy Policy** and **Terms of Service** to the Blanc marketing website
(`blancbrowser.com`). They must be **accurate to what Blanc actually does** — no
boilerplate that over- or under-claims — and match the site's existing minimal,
always-light, monochrome aesthetic. They are linked from the footer of every page.

## 2. Scope

**In scope:** the marketing website (`blancbrowser.com`) **and** the Blanc
**desktop** app (macOS / Windows / Linux) — the launched product surface.

**Explicitly out of scope (and stated as such in the docs):** the future mobile
app (iOS/Android). The `spec/`, `tokens/`, `ios/` scaffolding exists in the repo,
but no mobile product has shipped, so the policies say they cover the desktop app
and will be updated when mobile launches. This keeps expansion cheap later.

## 3. Decisions (locked)

| Decision | Value |
| --- | --- |
| Coverage | One combined Privacy Policy + one Terms, covering website + desktop app |
| Governing law | New York, USA; venue in New York |
| Operating entity name | **Bananify** (no corporate suffix) |
| Copyright line | © 2026 Bananify |
| Voice | Plain & on-brand — human, honest, real headings; **not** all-lowercase |
| Software license framing | **Proprietary freeware** — `package.json` `license: "UNLICENSED"`, no LICENSE file. Limited personal-use grant, all rights reserved. NOT open source. |
| Contact | `anthony@bnfy.me`, **email-only** (no mailing address for now; can add later) |
| Effective / last-updated date | **July 9, 2026** |
| Payment framing | Supporter purchase processed by **Polar** (polar.sh) as payment provider / merchant of record |

## 4. Deliverables

**New files**
- `site/privacy.html` — Privacy Policy (served at `/privacy`)
- `site/terms.html` — Terms of Service (served at `/terms`)

**Edited files**
- `site/styles.css` — add one scoped `.legal` style block (see §5)
- `site/index.html` — add `Terms · Privacy` to the footer
- `site/sitemap.xml` — add `/privacy` and `/terms` (priority `0.3`, `changefreq monthly`)

**No change needed:** `robots.txt` (`Allow: /` already covers new pages). No CSP
`<meta>` tag — the marketing site doesn't use one (unlike the app's internal
pages), so the legal pages match: fonts load from Google Fonts via `<link>`.

## 5. Page build & styling

- Standalone flat HTML mirroring `index.html`'s `<head>` conventions: charset,
  viewport, `theme-color`, canonical (`https://blancbrowser.com/privacy` /
  `/terms`), the favicon `<link>` set, Google Fonts preconnect + stylesheet,
  `styles.css`. Per-page `<title>` and `<meta name="description">`. Add
  `<meta name="robots" content="index,follow">`. No JSON-LD needed.
- **Shared CSS** — reuse `styles.css`; add a `.legal` block using the existing
  `:root` tokens (`--bg`, `--surface`, `--text`, `--text-dim`, `--border`,
  `--accent`, `--font-ui`, `--font-mono`, `--radius`). No inline styles.
  The block provides:
  - a **document header**: the Blanc `.mark` SVG (reuse the path from
    `index.html`) linking home, small mono wordmark/eyebrow.
  - a **readable prose column** — `max-width: ~68ch`, centered, generous line
    height, comfortable vertical rhythm; `h1` (page title) + `h2` (sections) +
    `h3` (sub-points); styled `ul`/`li`, `a` underline-on-hover like the site.
  - a **"last updated" line** (mono, dim) under the title.
  - a **TL;DR / summary callout** box (`--surface` background, `--border`,
    `--radius`) for the Privacy Policy's short version.
  - a **footer** identical in spirit to the homepage footer, with the added
    `Terms · Privacy` cross-links.
  - responsive padding matching the hero's `24px` side padding on mobile.
- **Footer links (all pages):** extend the existing homepage footer line and
  reuse the same markup on both legal pages so they cross-link and link home.

## 6. Privacy Policy — content spec

Order and substance. Each factual claim is grounded in §8.

1. **The short version** (callout) — Blanc keeps your browsing on your device;
   the app collects almost nothing; the site uses analytics only if you allow it.
   One or two sentences, links down to detail.
2. **Who we are** — Blanc is made by Bananify, an independent studio in
   Rochester, New York. Contact `anthony@bnfy.me`. Scope note: this policy covers
   the website and the desktop app; the mobile app isn't out yet and will be
   added when it ships.
3. **What stays on your device** — history (kept locally, capped ~5,000 entries),
   downloads list, favorites, settings, cookies & site data, and site
   permissions live only on your computer in the app's data folder. We never
   receive them. Private tabs aren't written to history at all.
4. **What the app sends — and only when:**
   - **4a. Anonymous usage ping** — *on by default; opt out in Settings → "Help
     improve Blanc."* One ping per launch containing: a random `installId` (a
     per-install token, not tied to you), a per-launch `sessionId`, the app
     version, and your OS platform + architecture. **No browsing data, no
     account, no name, no precise location.** Sent to our own server (a
     Cloudflare Worker); counts may be reflected in aggregate in Google
     Analytics. Only in installed builds. The `installId` is stored in its own
     local file and can be reset by clearing app data.
   - **4b. Profile Sync** — *off by default; opt-in.* If you turn it on with a
     sync name + passphrase, Blanc syncs **only your favorites and settings**
     across your devices. It's **end-to-end encrypted**: a key is derived from
     your passphrase on your device, and we store only ciphertext we cannot
     read, index, or decrypt. Your passphrase never leaves your device and we
     never store it. **Not synced:** history, downloads, permissions, cookies/
     site data, the supporter license, app icon choice, and your telemetry
     setting.
   - **4c. Supporter license** — *optional, only if you buy it.* The one-time $19
     Supporter purchase is processed by **Polar** (polar.sh), our payment
     provider / merchant of record. Polar handles the payment and your email;
     Blanc receives only a license confirmation and stores a local flag marking
     you as a supporter. We never see full card details. Link to Polar's privacy
     policy.
5. **Normal browsing & the requests Blanc makes** — when you browse, Blanc
   connects you directly to the sites you visit; those sites see your requests
   like they would in any browser. Blanc's built-in ad/tracker blocking *reduces*
   third-party tracking but isn't a guarantee. Blanc itself also makes a few
   ordinary requests: it loads its interface fonts from Google Fonts, downloads
   ad/tracker blocklists (EasyList/EasyPrivacy) on first launch and refreshes,
   fetches site icons (favicons) to show your favorites and history, and — in
   installed builds — checks GitHub for app updates. We don't log or monitor
   your browsing.
6. **The website (blancbrowser.com)** —
   - **Analytics:** consent-gated. Nothing analytics-related loads until you
     click **Allow** on the banner; your choice is remembered in your browser's
     local storage. If you allow it, we use Google Analytics to gauge interest.
   - **Fonts:** the site loads fonts from Google Fonts, so Google may see your IP
     as part of serving them.
   - **Downloads:** the download buttons ask GitHub's API for the latest release
     so links point at the right installer; installers are hosted and served by
     GitHub.
   - **Hosting:** the site is hosted on Cloudflare Pages, which keeps standard
     server logs.
   - We run no ad networks and no cross-site trackers, and we don't sell your
     data.
7. **Children** — Blanc isn't directed at children under 13, and we don't
   knowingly collect their data.
8. **Your choices & rights** — turn off the usage ping; leave sync off; reset
   your `installId` by clearing app data; clear local history/downloads/favorites
   any time; decline or reset analytics consent on the site. Brief regional note:
   if you're in the EU/UK or California, you have rights over personal data; we
   don't sell data, and because we hold so little (an anonymous install ping and,
   only if you enable sync, ciphertext we can't read), you can email us to ask
   about access or deletion.
9. **Data retention & security** — usage-ping data is aggregated; sync ciphertext
   is kept until you disable sync or delete it; we use reasonable safeguards.
   Honest note: local data on your device is stored in plain files — the
   protection there is your own device security.
10. **Changes to this policy** — we'll update the date at the top and note
    material changes.
11. **Contact** — `anthony@bnfy.me`.

## 7. Terms of Service — content spec

1. **Acceptance** — using Blanc / the site means you accept these terms.
2. **Your license to use Blanc** — Blanc is provided free of charge for personal
   and business use. Blanc is **proprietary software; all rights reserved by
   Bananify.** You get a limited, non-exclusive, revocable license to use it; you
   may not resell it, or copy/modify/reverse-engineer it except where the law
   says that can't be restricted. (Explicitly not an open-source grant.)
3. **Supporter purchase** — the optional one-time $19 Supporter unlock is sold
   through Polar (our merchant of record) and grants **cosmetic app-icon
   colorways only** — no features are gated behind it. It's a one-time purchase,
   not a subscription. Refunds are handled through Polar per their terms.
4. **Acceptable use** — don't use Blanc to break the law or infringe others'
   rights, and don't misuse the app or site.
5. **Third-party sites & content** — Blanc is a web browser; we don't control and
   aren't responsible for the sites you visit or the content you reach through
   it. Ad/tracker blocking is provided on a best-effort basis and isn't
   guaranteed to block everything.
6. **Software updates** — installed builds may check for and install updates
   automatically (via GitHub Releases). We may add, change, or discontinue
   features over time.
7. **No warranty** — Blanc is provided "as is," without warranties of any kind,
   to the extent the law allows.
8. **Limitation of liability** — to the extent permitted by law, Bananify isn't
   liable for indirect or consequential damages arising from use of Blanc.
9. **Termination** — you can stop using Blanc and uninstall it any time; the
   license ends if you stop using it or breach these terms.
10. **Governing law** — these terms are governed by the laws of the State of New
    York, USA, and disputes are handled in the courts located there.
11. **Changes to these terms** — we'll update the date and note material changes.
12. **Contact** — `anthony@bnfy.me`.

## 8. Grounded-facts reference

Every claim above traces to the codebase / prior context — the drafter should not
re-derive these:

- **Telemetry** — `{installId, sessionId, version, platform, arch}`; on by default
  (`usagePing` default `true`), opt-out label "Help improve Blanc"; packaged
  builds only (`app.isPackaged`); POSTs to the `blanc-ping` Cloudflare Worker;
  may mirror to GA4 using `installId` as client_id; `installId` stored in its own
  device-local `install.json`, not in settings, never synced.
  (`src/main/telemetry.js`; CLAUDE.md "Telemetry.")
- **Profile Sync** — favorites + settings only; AES-256-GCM key via
  scrypt→HKDF from passphrase; server-blind opaque blobs on the `blanc-sync`
  Cloudflare Worker; passphrase discarded after key derivation. Never synced:
  supporter, appIcon, usagePing, cookies/storage, history, downloads,
  permissions. (`src/main/sync.js`, `src/main/sync-crypto.js`; CLAUDE.md
  "Profile Sync.")
- **Supporter** — $19 one-time Polar.sh license; org handle `bnfy`; cosmetic Dock
  colorways only (`ember`/`plum`/`gold`); trusted forever after activation, works
  offline; renderers only ever see a boolean, never the key. (`src/main/
  supporter.js`, `docs/polar-setup.md`; CLAUDE.md "Blanc Supporter.")
- **Local stores** — `settings.json`, `bookmarks.json`, `history.json` (cap
  5000), `downloads.json` (cap 200), `adblock-stats.json`, `install.json`,
  `sync.json`, all in `userData`. (`src/main/store.js`; CLAUDE.md "Persistence.")
- **Ad blocking** — `@ghostery/adblocker-electron`; EasyList + EasyPrivacy fetched
  first launch, cached as `adblock-engine.v<N>.bin`. (`src/main/adblock.js`.)
- **App fonts** — chrome + internal pages load Inter + JetBrains Mono from
  `fonts.googleapis.com` / `fonts.gstatic.com` via `<link>`. (grep of
  `src/renderer/**`.)
- **Favicons** — favorites/history/tabs load site icons over the network
  (`img-src ... https: http:` in internal-page CSP; validated URLs in
  `src/main/bookmarks.js`).
- **Auto-update** — `electron-updater` against GitHub Releases, packaged builds
  only. (CLAUDE.md "Auto-update.")
- **Website** — consent-gated GA4 (`G-MN8BLY6GE9`), consent stored in
  `localStorage` key `ga-consent`, banner copy "Anonymous analytics help us
  gauge interest — allow?"; Google Fonts; a client-side
  `api.github.com/repos/bnfy/blanc/releases/latest` fetch for download links;
  DuckDuckGo favicons in the demo only; hosted on Cloudflare Pages.
  (`site/demo.js`, `site/index.html`, `site/CLAUDE.md`.)
- **License** — `package.json` `"license": "UNLICENSED"`, no LICENSE file →
  proprietary freeware.
- **Company** — Bananify, Rochester NY; contact `anthony@bnfy.me`.

## 9. Verify-while-drafting checklist

Quick confirmations to make during writing (cheap, keep copy honest):
- [ ] Polar merchant-of-record wording — Polar markets itself as MoR; keep
      phrasing "payment provider / merchant of record," link their privacy policy.
- [ ] Confirm the exact Settings opt-out label string ("Help improve Blanc").
- [ ] Confirm the supporter price/copy on `site/index.html` ("$19 once").
- [ ] Don't imply the app is open source anywhere.

## 10. Out of scope

- The mobile app (not launched) — named as future, not covered.
- A cookie-preferences manager beyond the existing allow/deny banner.
- DPA / enterprise agreements, white-label/kiosk contract terms (handled
  privately via the "custom builds" contact line).
- Any change to app behavior — this is website content only.

## 11. Open items

- **Mailing address:** defaulting to email-only. Can add a postal address later
  if desired (some GDPR reviewers prefer one).
