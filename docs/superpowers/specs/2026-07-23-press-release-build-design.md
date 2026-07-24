# Blanc v1.0 — 14-Day Press-Release Build Specification

**Date:** 2026-07-23

**Status:** Revised fast-track launch contract

**Target:** Blanc `v1.0.0`

**Launch window:** 14 calendar days from scope freeze

---

## 1. Decision

Blanc does not need a long maturity program before a formal press release.
Forty-seven version tags and the current `v0.22.0` product already establish
the maturity base.

The press build is a **two-week packaging and presentation sprint**, not a
rewrite of the browser:

- six days to finish the visible launch slice and produce a signed RC;
- seven days for active dogfood, embargoed reviewer access, and press
  production in parallel;
- final publication on Day 14.

The date moves only for a true launch blocker: an advertised platform cannot
install safely, first launch fails, a core browsing regression exists, public
claims are materially false, or the release candidate exposes a security/data
loss issue.

Everything else moves to the post-launch hardening backlog.

## 2. Positioning

### Lead

> **Blanc puts the browser in one small Island.**
>
> Search, tabs, groups, and page controls appear when needed and leave the page
> alone when they are not.

### Launch contrast

When vertical tabs pass the Day 3 cutoff:

> **No horizontal tab strip. Keep tabs inside the Island, or pin them
> vertically.**

Fallback if vertical tabs are cut:

> **No horizontal tab strip. Tabs stay inside the Island until you need them.**

Privacy, blocking, encrypted sync, no built-in AI, and independent ownership
are proof. They are not the lead: those claims are now shared by Brave Origin,
Helium, Orion, Zen, and Vivaldi. Blanc's recognizable advantage is its
interaction model.

### Claim guardrails

Do not say:

- zero telemetry or “nothing leaves your device”;
- most private, fastest, or lightest;
- blocks every ad;
- full Chrome replacement;
- supports extensions or password import;
- artifact downloads equal active users.

The press story is Island-first and evidence-backed.

## 3. Non-waivable launch scope

Only six workstreams are in the press build.

### 3.0 Criticality order

Work is pulled in this order even when separate owners execute it in parallel:

| Priority | Meaning | Included work |
|---|---|---|
| P0 — release safety | Must be green before an RC is distributed | first-launch availability and privacy gating; truthful public claims; signed/tested packages; exact-artifact verification; migration, security, and core regression smoke |
| P1 — press-build promise | Must be accepted for the intended product story, but never displaces P0 work | optional vertical tabs; reviewer guide, fact sheet, limitations, representative screenshots, and stable reviewer URL |
| P2 — launch polish | Use remaining capacity; never moves the date | demo video, extra media variants, screenshot replacement where the accepted RC did not visibly change |
| P3 — post-launch | Explicitly excluded from this build | the backlog in section 4 |

If a P1 feature misses its Day 3 acceptance cutoff, remove that feature and
its public claim cleanly instead of weakening a P0 gate or extending the
implementation sprint. P0 failures stop the RC or narrow the distributed
platform matrix. P2 omissions do not stop publication.

### 3.1 Optional vertical tabs

Vertical tabs are a presentation of the existing main-owned tab model, not a
second workspace system.

Contract:

- `tabLayout`: `island | vertical`, device-local, default `island`;
- fixed 248px left rail below the 64px strip;
- rendered in the existing trusted BrowserWindow chrome document;
- Island remains the only address/search/command surface;
- guest tabs and utility sheet use the remaining page pane;
- panel/palette exclude the rail horizontally but retain `y=0` so the Island
  expands in place;
- find width clamps to the available page pane;
- resting and expanded Island share the page-pane center;
- current pins, named groups, group collapse, private styling, loading/audio
  state, and tab ordering remain visible;
- switch, close, middle-close, new tab, group fold/unfold, and same-bucket drag
  reorder work;
- pin/unpin, mute, duplicate, and group-membership editing remain available
  through the Island and native menus for this first rail release;
- rail activation dismisses floating surfaces and focuses the selected tab,
  including when it is already active;
- keyboard switching and accessible row/action structure work;
- remote-device tabs remain in Quick Switcher/start page.

Deferred:

- right-side rail;
- resizing;
- compact/hover expansion;
- cross-group drag;
- synced layout preference;
- mobile geometry;
- new workspace/split-view concepts.

### 3.2 First-launch fail-safe

The current app awaits the ad-block list build before creating the window. A
failed fetch can therefore produce no UI.

Press-build behavior:

- create and show local chrome before remote list initialization;
- on a truly fresh profile, show one compact local welcome/privacy card on the
  start page; it contains the search-suggestion and usage-ping toggles and
  commits them before either feature sends data;
- existing profiles skip that card; while a fresh profile is incomplete,
  suggestion requests return no result and the launch ping is deferred;
- queue restored/external guest navigation while enabled blocking initializes;
- on success, attach blocking and release queued navigation;
- on failure, show a local recovery state with Retry and explicit “Continue
  without blocking”;
- never silently continue as if blocking were active;
- catch the startup promise so an outage cannot terminate the ready chain;
- keep acceptance mode's explicit blocker skip;
- self-host the chrome/internal-page fonts and remove their external CSP hosts.

A reproducibly packaged blocker seed is useful, but it is not required for the
two-week release if the fail-safe above is reliable.

### 3.3 Public truth

Before RC:

- private-tabs copy describes the current isolated, in-memory session;
- privacy copy includes eligible search-suggestion prefixes and guards;
- privacy/sync copy includes optional open-tab and encrypted favicon sync;
- telemetry is described as default-on/opt-out with the exact fields;
- update checks, filter refreshes, optional sync, supporter activation, and
  other app-initiated network classes are accounted for;
- marketing fixtures do not make undeclared third-party favicon requests;
- repository grant drafts do not call proprietary Blanc open source or
  telemetry opt-in;
- README no longer describes the shipped product as a pre-release shell;
- download counts are not labelled installs;
- the Mac download page offers an explicit link for every distributed
  architecture; when only one architecture ships, it names that limitation
  instead of implying universal Mac support.

No new machine-readable product-fact system is required before the press
release. The checked-in fact sheet and a focused stale-phrase test are enough
for this sprint.

### 3.4 Trusted advertised packages

For every platform and architecture kept in the distributed release, the final
release contains the applicable artifacts below:

- macOS arm64 DMG/ZIP, Developer ID signed and notarized;
- macOS x64 DMG/ZIP, Developer ID signed and notarized;
- Windows x64 NSIS installer only when code-signed;
- Linux x86_64 AppImage;
- required updater metadata/blockmaps;
- SHA-256 checksums.

Windows decision on Day 2:

- Azure Trusted Signing is preferred;
- a valid Authenticode `CSC_LINK` build may be called Stable only if a clean
  Windows 11 test shows the expected publisher without a SmartScreen
  reputation warning;
- a signed build that still shows a reputation warning may be distributed only
  as Preview with plain disclosure and is excluded from stable-platform press
  claims;
- an unsigned Windows installer is not distributed in the press release;
- if signing cannot be completed by the RC cutoff, the Windows artifact is
  omitted rather than delaying the whole launch indefinitely.

Release mechanics:

- macOS notarization cannot silently degrade;
- platform jobs build from the same source tag/commit;
- all advertised assets stage in a draft before publication;
- workflow/signing failure is fatal before publication;
- draft assets are verified while authenticated;
- publication is followed immediately by logged-out download/update smoke;
- the staged website is promoted only after release smoke succeeds.

### 3.5 Targeted verification

The press build does not attempt to automate the entire future acceptance
backlog.

Required:

- existing `substrate:check`;
- all unit tests;
- existing live runnable desktop acceptance;
- deterministic OAuth;
- DNS smoke;
- targeted vertical-tabs geometry/action tests when the feature is included;
- targeted first-launch failure/retry tests;
- public-copy stale-claim test;
- packaged launch smoke on every distributed platform/architecture;
- clean install on every distributed platform/architecture;
- current-stable data/session migration smoke;
- current Electron/Chromium and production-dependency security check.

A known P0/P1 failure blocks launch. Missing automation for an unrelated
backlog scenario does not.

### 3.6 Press package

Required when RC is distributed:

- `/press` page or equivalent stable press-kit URL;
- one-page fact sheet;
- five-minute reviewer guide;
- known limitations;
- press contact and studio bio;
- representative RC screenshots sufficient to follow the reviewer guide.

Required by final staging on Day 13:

- final Island, search/panel, and private/blocking screenshots, plus vertical
  tabs when the feature is included;
- a 30–60 second captioned product demo when P0/P1 work leaves capacity;
- final download and checksum links;
- concise launch announcement.

This is not a 47-release changelog. The announcement tells one story:

1. the Island;
2. optional vertical tabs without a horizontal strip, when included;
3. blocking/private/security foundations;
4. encrypted continuity and desktop availability.

## 4. Explicit post-launch backlog

The following work is valuable but **must not hold the press date** unless a
real defect turns one item into a blocker:

- full three-step onboarding/import/default-browser/layout-preview flow beyond
  the compact privacy card;
- packaged/reproducible blocker seed;
- atomic `JsonStore` rewrite and backup recovery;
- diagnostics exporter and crash ledger;
- unclean-exit session recovery UI;
- complete `@release` acceptance conversion;
- dedicated N−1 staging update feed;
- exhaustive dependency/license/SBOM program;
- full accessibility audit beyond changed surfaces;
- performance benchmark program;
- 10+ tester / 30 tester-day study;
- right/compact/resizable vertical tabs;
- press-kit automation and extended media variants;
- a deferred demo video if it was cut as P2;
- source-of-truth rendering for every public fact;
- expanded vulnerability handling beyond the simple `SECURITY.md` contact and
  forward-fix process required for launch.

These become the first post-launch roadmap, not forgotten work.

## 5. Release gates

All gates below are non-waivable.

| Gate | Pass condition |
|---|---|
| Core | No known regression in navigation, tabs/groups, private isolation, Favorites/history/downloads/settings, blocking toggle, or session restore |
| Vertical tabs | If included at the Day 3 P1 cutoff, Island remains default and rail switching/actions/groups/private state/keyboard/narrow-window geometry pass |
| Startup | Cold online and offline/failing-filter launch always shows usable local UI; queued guest navigation never races expected blocker attachment |
| Public truth | Privacy, private-tab, sync, telemetry, platform, license, and limitation claims match shipped behavior |
| macOS | Every distributed architecture is signed, notarized, installed, launched, and checked on real hardware or an explicitly documented native test source |
| Windows | If distributed, the installer is signed, tested, and shows the expected publisher; a build with a SmartScreen reputation warning is labelled Preview and removed from stable-platform press claims |
| Linux | If distributed, the AppImage launches on the documented x86_64 target |
| Automation | Existing regression suites plus targeted launch tests green at the release commit |
| Candidate | At least one active tester per distributed platform/architecture, including Preview; no open P0/P1 and seven consecutive quiet days |
| Press | Fact sheet, guide, limitations, representative screenshots, contact, release notes, checksums, and working links ready; P2 media may follow |

## 6. Fourteen-day cadence

### Day 0 — Scope freeze

- lock this specification;
- assign one owner per workstream;
- stop unrelated feature work;
- confirm Apple credentials, Windows signing route, Linux runner, site access,
  and test hardware.

### Days 1–2 — Parallel foundations

- vertical-tabs geometry and setting;
- public/privacy/repository corrections;
- window-first startup fail-safe;
- signing and draft-release preflight;
- press fact sheet and page scaffold.

Day 2 go/no-go:

- if a platform's required signing or verification route is unavailable, omit
  it from press distribution;
- Preview is permitted only for a tested, signed Windows build whose remaining
  issue is SmartScreen reputation—not as a substitute for package testing;
- do not expand the schedule with unrelated hardening.

### Day 3 — Finish the product slice

- vertical-tab rows/actions/groups/keyboard;
- targeted unit/desktop acceptance;
- startup failure/retry/offline tests;
- release workflow draft staging;
- real RC screenshots begin only after UI integration.

### Day 4 — Package rehearsal

- clean builds for every distributed platform/architecture;
- signature/notarization verification;
- packaged launch/install smoke;
- resolve only release blockers.

### Day 5 — RC1

- tag and publish signed `v1.0.0-rc.1` as a prerelease;
- verify logged-out downloads and hashes;
- distribute to active testers and embargoed reviewers;
- freeze visual assets unless a blocker changes the UI.

### Days 6–12 — Seven-day candidate window

- at least one active tester per distributed platform/architecture completes
  the five-minute guide and uses the build during the window;
- produce final screenshots/demo/announcement;
- triage daily;
- any P0/P1 fix produces immutable `rc.N`.
- seven consecutive days with no open P0/P1; a blocking fix resets the clock
  and moves launch rather than broadening scope;
- final fact check, links, checksums, support path, and release rehearsal;

### Day 13 — Final staging

- build final `v1.0.0` from the accepted source with version/release metadata
  only;
- stage and verify the complete draft.

### Day 14 — Publish

1. publish GitHub release;
2. run logged-out artifact and stable-update discovery smoke;
3. promote and verify the staged website/press page;
4. lift reviewer embargo and send outreach;
5. enter a 72-hour rapid forward-fix window.

If a blocker appears after Day 5, fix it, issue a new immutable RC, and restart
the seven-day quiet clock. Do not revert to a multi-month program.

## 7. Success

The launch succeeds when coverage describes Blanc first as the browser with
the Island—not merely another minimal private browser—and when a new user can
install, see the product, try every included tab layout, and understand its
privacy tradeoffs without encountering a trust warning or false promise on an
advertised stable platform.
