# Blanc v1.0 — Criticality-Ordered 14-Day Press Build Plan

**Goal:** Produce a verified `v1.0.0-rc.1` on Day 5, complete a seven-day
active candidate window, and publish `v1.0.0` on Day 14.

**Specification:**
`docs/superpowers/specs/2026-07-23-press-release-build-design.md`

**Operating rule:** Criticality outranks feature order. P0 work always gets the
next available owner. P2 work never moves the date.

## Priority model

| Priority | Definition | Release consequence |
|---|---|---|
| P0 — safety and trust | Startup, privacy, truth, signing, migration, security, and exact-artifact verification | Stops RC/publication or removes the affected platform |
| P1 — press-build promise | Vertical tabs and the minimum reviewer/press package | The press package must pass; vertical tabs may be cut cleanly with their public claims at the Day 3 cutoff |
| P2 — polish | Demo video, extra media, and nonessential presentation refinements | Ships only if P0/P1 are green |
| P3 — hardening backlog | Larger architecture and maturity projects | Begins after launch |

Rules:

1. Separate owners may run P0 and P1 work in parallel, but no P1 task may
   consume the only person or machine needed for P0.
2. Day 2 is the platform cutoff. A platform without signing and native package
   verification is omitted from press distribution.
3. Day 3 is the vertical-tabs cutoff. The complete MVP passes or the feature,
   setting, screenshots, and claim are removed from `v1.0.0`.
4. After Day 3, product code changes are limited to P0/P1 defects.
5. P2 work is the first thing cut. It never expands the 14-day schedule.

## P0 — Release safety and trust

### P0.1 Prove external release paths — Day 0, hard cutoff Day 2

- [ ] Freeze unrelated work and record one clean source commit.
- [ ] Confirm Apple Developer ID identity, provisioning profile, notarization
      credentials, stapling, and native test access for each Mac architecture
      intended for distribution.
- [ ] Confirm Azure Trusted Signing for Windows. If unavailable, prove the
      `CSC_LINK` publisher path.
- [ ] Treat Windows as Stable only when a clean Windows 11 install shows the
      expected publisher without a SmartScreen reputation warning.
- [ ] A tested, signed Windows build with only a reputation warning may ship as
      Preview with disclosure. Never distribute an unsigned Windows press
      build.
- [ ] Confirm an x86_64 Linux runner and launch-test target if Linux is
      distributed.
- [ ] Confirm GitHub workflow permissions/secrets, site deployment access,
      press/support/security contacts, and one release owner.
- [ ] Publish the final distributed platform/architecture matrix internally by
      the end of Day 2. Omit any unverified target; do not add days.

### P0.2 Make first launch fail safe — Days 1–2

**Modify:**

- `src/main/main.js`
- `src/main/adblock.js`
- `src/main/pages.js`
- `src/main/tab-preload.js`
- `src/main/settings.js`
- `settings-schema/schema.json`
- `src/renderer/pages/newtab.html`
- `src/renderer/pages/newtab.js`
- `src/renderer/pages/pages.css`
- `src/main/test-hook.js`

**Required behavior:**

- [ ] Create and show local BrowserWindow chrome before remote filter
      initialization.
- [ ] Permit the local start/privacy surface immediately while queuing
      restored, command-line, and newly requested `http(s)` guest navigation
      until enabled blocking is ready.
- [ ] Attach blocking and release queued navigation on success.
- [ ] On failure, keep the app usable and show Retry and explicit “Continue
      without blocking” actions.
- [ ] Never show blocking as active when no engine is attached.
- [ ] Catch the startup promise so an offline list fetch cannot terminate the
      ready chain.
- [ ] On a truly fresh profile, show one compact privacy card with
      search-suggestion and usage-ping choices.
- [ ] Send neither suggestions nor the launch ping until those choices are
      committed. Existing/migrated profiles skip the card.
- [ ] Preserve the explicit `BLANC_TEST=1` blocker behavior.
- [ ] Cover success, rejection, offline fetch, corrupt cache, retry, continue,
      and queued-navigation release with targeted tests.

**Remove the undeclared startup request:**

- [ ] Self-host licensed Inter and JetBrains Mono WOFF2 assets in the existing
      chrome and flat internal-page asset locations.
- [ ] Remove Google Fonts links and external font CSP hosts from chrome and
      internal pages.
- [ ] Verify a fresh launch makes no font-host request.

### P0.3 Make every public claim true — Days 1–2

**Audit and correct:**

- `site/src/pages/privacy.astro`
- `site/src/pages/features/private-tabs.astro`
- `site/src/pages/features/sync.astro`
- `site/src/pages/index.astro`
- `site/src/pages/download.astro`
- `site/src/scripts/site.js`
- `README.md`
- `spec/parity-matrix.md`
- `spec/acceptance/platform-services.feature`
- `docs/grants/nlnet-commons-fund.md`
- `docs/grants/futo-pitch.md`
- `scripts/stats.sh`

**Acceptance:**

- [ ] Private-tabs copy describes the shipped isolated, in-memory behavior.
- [ ] Privacy copy discloses suggestion prefixes/guards, default-on opt-out
      usage ping fields, filter refresh, update checks, optional sync, and
      supporter activation.
- [ ] Sync copy includes optional open-tab and encrypted-icon sync.
- [ ] Proprietary Blanc is not called open source.
- [ ] Download counts are not labelled installs.
- [ ] Marketing fixtures make no undeclared favicon requests.
- [ ] Mac downloads provide an explicit link for every distributed
      architecture; if only one ships, name that limitation instead of
      implying universal Mac support.
- [ ] A focused `public-truth` test rejects known stale phrases and
      settings-default mismatches.

### P0.4 Make release staging fail closed — Days 1–4

**Modify/create:**

- `scripts/release.sh`
- `.github/workflows/release-windows-linux.yml`
- `.github/workflows/prerelease-smoke.yml`
- `package.json`
- `scripts/create-checksums.mjs`
- `scripts/verify-release-manifest.mjs`
- `docs/press/release-notes/v1.0.0.md`

**Acceptance:**

- [ ] Candidate and Stable modes are explicit.
- [ ] Every platform builds from one immutable tag/commit.
- [ ] macOS signing/notarization failure is fatal.
- [ ] Windows release rules enforce the Stable/Preview/omitted decision above.
- [ ] Workflow dispatch or registration failure is fatal before publication.
- [ ] All expected artifacts, updater metadata, blockmaps, and SHA-256 hashes
      stage in one draft before publication.
- [ ] Verification runs against the exact staged artifact set. Do not rebuild
      between verification and publication.
- [ ] Stable updater discovery ignores the prerelease.
- [ ] Release notes are checked in rather than hard-coded in the script.

### P0.5 Verify the release, not only the source — Days 3–5

Add `npm run release:verify:press` covering:

```text
substrate:check
test:unit
test:acceptance:dry
test:acceptance:desktop
test:oauth:desktop
test:dns-smoke
targeted startup/privacy/public-truth tests
site:build
artifact/signature/checksum checks
```

- [ ] Confirm current secure Electron/Chromium and review production
      dependency advisories.
- [ ] Review changed privileged IPC, startup queue, navigation policy, and
      first-run IPC sender validation.
- [ ] Run packaged cold-online, cold-offline, and failed-filter launch outside
      acceptance mode.
- [ ] Run clean install/launch on every distributed platform/architecture.
- [ ] Install and launch current Stable `v0.22.0`, create representative
      session/settings data, then install and launch the RC against that same
      profile and verify migration and restore.
- [ ] Produce a short evidence report keyed to the exact source commit and
      staged artifact hashes.

**P0 exit gate:** No known data-loss/security/core-browsing issue; safe first
launch works; claims are true; every distributed package is signed where
required, installed, launched, and verified before publication.

## P1 — Press-build promise

### P1.1 Optional vertical tabs — Days 1–3

This is the highest-priority product feature, but it does not outrank P0.
Island remains the default and sole address/search/command surface.

**Day 1 — geometry and setting**

- [ ] Create `src/main/chrome-layout.js` and table-driven
      `test/unit/chrome-layout.test.js`.
- [ ] Add validated, device-local `tabLayout: 'island' | 'vertical'`; exclude
      it from sync and mobile generation.
- [ ] Define the sole runtime width source as
      `VERTICAL_TABS_WIDTH = 248` in `chrome-layout.js` and pass it in the
      trusted layout payload.
- [ ] Replace guest, utility-sheet, panel/palette, find, and pill ad hoc bounds
      with the pure geometry helper.
- [ ] Add the Settings control, checked View-menu item, and rail control to
      return to Island.

Geometry:

```text
Island guest/sheet      x=0,   y=top, width=W,     height=H-top
Island panel/palette    x=0,   y=0,   width=W,     height=H
Vertical guest/sheet    x=248, y=top, width=W-248, height=H-top
Vertical panel/palette  x=248, y=0,   width=W-248, height=H
Find                    max 560px, centered inside the current page pane
```

**Day 2 — credible rail**

- [ ] Create `src/renderer/vertical-tabs.js`, `src/main/tab-order.js`, and
      `test/unit/tab-order.test.js`.
- [ ] Render from the existing main-owned `tabs:updated` model; do not create
      another tab store or refactor `overlay.js`.
- [ ] Show ungrouped pins, named groups with pins first, loose tabs, and a
      final new-tab action.
- [ ] Show favicon/title, active/loading/private, pinned, audible/muted, and
      collapsed-active-group state.
- [ ] Support switch, close, middle-click close, new tab, group fold/unfold,
      and drag reorder only within an identical `{groupId,pinned}` bucket.
- [ ] Define `beforeId:null` as the end of the validated source bucket.
- [ ] Make row primary and close actions accessible siblings with roving
      primary focus, Arrow/Home/End, Enter/Space, visible focus, and labels.
- [ ] Make rail activation atomically dismiss floating surfaces, activate once,
      and focus content—even for the already-active tab.
- [ ] Keep pin/mute/duplicate/group-membership editing in Island/native menus
      for v1.0 and remote tabs in Quick Switcher/start page.

**Day 3 — acceptance cutoff**

- [ ] Add `F28`, `D19`, parity entries, and
      `spec/acceptance/vertical-tabs.feature`.
- [ ] Cover default/persistence/no-sync, no reload on layout switch, every
      surface's geometry, row actions, groups, private state, reorder, and
      keyboard flow.
- [ ] At 640×480, verify the page pane is 392px and the visible find capsule
      fits within 368px without overlapping the rail.
- [ ] Relaunch Electron to verify chrome changes.

**P1 vertical exit gate:** The whole MVP passes by the end of Day 3. Otherwise
remove the incomplete feature and every vertical-tabs press claim from v1.0;
do not ship a partial rail or delay P0.

### P1.2 Minimum reviewer and press package — Days 2–13

**Create:**

- `site/src/pages/press.astro`
- `site/public/press/`
- `docs/press/fact-sheet.md`
- `docs/press/known-limitations.md`
- `docs/press/reviewer-guide.md`
- `docs/press/press-release.md`
- `SECURITY.md`

**Required by RC distribution on Day 5:**

- [ ] Unlisted stable `/press` URL for embargoed reviewers.
- [ ] One-page fact sheet, five-minute guide, known limitations, pricing,
      platform matrix, studio bio, and press/support/security contacts.
- [ ] Representative RC screenshots covering the Island, search/panel,
      vertical tabs if included, and private or blocking behavior.
- [ ] Working RC download/checksum links.

**Required by final staging on Day 13:**

- [ ] Concise Island-first announcement and final release notes.
- [ ] Final Stable download/checksum links.
- [ ] Screenshot replacement only where the accepted UI changed.
- [ ] Responsive, keyboard, link, social-card, and site-build verification.

## P2 — Launch polish

Do only after P0 and P1 work for the day is green:

- [ ] 30–60 second captioned demo.
- [ ] Additional screenshot sizes and media variants.
- [ ] Extended recipient segmentation and announcement variants.
- [ ] Press-kit generation automation.

Cut unfinished P2 items at Day 13 and add them after launch.

## P3 — Post-launch hardening

- full onboarding/import/default-browser tour;
- packaged blocker seed;
- shared Island/rail tab-list refactor;
- atomic `JsonStore` writes and backup recovery;
- crash ledger, diagnostics exporter, and recovery UI;
- exhaustive acceptance, accessibility, and performance program;
- dedicated N−1 staging update feed;
- full SBOM/license program;
- right, compact, resizable, or synced vertical-tab layouts.

## Calendar and handoffs

### Day 0

Run P0 external checks, freeze scope, assign owners, and publish the internal
platform matrix.

### Days 1–2

P0 owners deliver startup/privacy, public truth, and fail-closed release
foundations. A separate owner builds the P1 vertical-tabs MVP. Press structure
and facts start only after public-truth decisions settle.

### Day 3

- accept or cut vertical tabs;
- freeze product code except P0/P1 defects;
- bump, commit, and push exact `1.0.0-rc.1` candidate source;
- begin representative RC capture.

### Day 4

- build the exact candidate on each distributed target;
- stage the complete artifact set;
- verify signatures, notarization, metadata, hashes, clean installs, and the
  `v0.22.0` profile migration;
- fix only P0/P1 failures.

### Day 5

1. Rebuild only if Day-4 verification found a defect; if so, stage and verify
   the new immutable candidate from the beginning.
2. Run `npm ci` and `release:verify:press` against the exact staged set.
3. Verify authenticated draft downloads, hashes, signatures/notarization, and
   updater metadata.
4. Publish `v1.0.0-rc.1` as a prerelease; Stable update discovery must ignore
   it.
5. Verify logged-out downloads and the unlisted `/press` reviewer URL.
6. Distribute the guide and start the seven-day quiet clock.

Minimum active candidate matrix:

- one tester for each distributed Mac architecture;
- one Windows 11 tester if a Stable or Preview Windows build is distributed;
- one Linux x86_64 tester if Linux is distributed.

### Days 6–12

- triage daily;
- accept only P0/P1 code/package fixes;
- issue every fix as immutable `rc.N`;
- restart the seven-day quiet clock after any P0/P1 code/package fix;
- complete required press copy and available P2 media in parallel;
- keep the public Stable updater on the current release.

Exit requires seven consecutive quiet days, one active tester per distributed
platform/architecture, no open P0/P1, and a press package matching the
accepted RC.

### Day 13

- create `v1.0.0` from accepted RC source with only version/final metadata
  changes;
- build, stage, and verify the exact final artifacts;
- rerun the release gate and packaged smoke;
- verify final site preview, links, claims, contacts, and release sequence;
- cut any unfinished P2 item.

### Day 14

1. Publish the complete GitHub release.
2. Verify logged-out downloads and production Stable-update discovery.
3. Promote and verify the staged site, `/press`, changelog, and social cards.
4. Lift the reviewer embargo and send outreach.
5. Enter a 72-hour rapid forward-fix window.

If release, download, or update smoke fails, stop outreach and fix forward with
a new immutable patch. Never replace published assets.

## Final go/no-go

```text
[ ] P0: safe first launch works online, offline, and on filter failure
[ ] P0: choices commit before suggestion/ping traffic on fresh profiles
[ ] P0: public privacy/product/platform claims match the package
[ ] P0: every distributed artifact is signed where required and natively tested
[ ] P0: exact staged artifacts, migration, regression, and security checks pass
[ ] P1: vertical tabs pass completely, or are cleanly absent with no claim
[ ] P1: reviewer URL, facts, guide, limitations, screenshots, and contacts work
[ ] Candidate: seven quiet active-test days with no open P0/P1
```

P0 determines whether Blanc is safe to announce. P1 determines the strength
of the launch story. P2 determines polish only.
