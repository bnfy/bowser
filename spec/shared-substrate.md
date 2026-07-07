# Shared Substrate

The parity trick: **reimplement as little as possible.** Anything two platforms
would otherwise hand-copy is generated/shipped from **one source** and consumed by
all three builds, so it *can't* drift. This file lists those artifacts, their
single source, and each platform's consumer.

Rule of thumb: if a change would need to be made identically in both the Swift and
Kotlin repos, it belongs here instead.

---

## S1 — Filter-rule pipeline (highest value)

**Source:** EasyList + EasyPrivacy (upstream), plus any Blanc-curated additions,
in one repo/pipeline.

**Emits, from that single source:**
- **iOS:** compiled `WKContentRuleList` JSON, curated to fit the ~150k-rule cap
  (D1). Possibly two variants: base and "with per-site exceptions applied" (D2).
- **Android:** a normalized rule table the `shouldInterceptRequest` interceptor
  reads (can carry the *full* rule set — D1).
- **Desktop:** already handled by the Ghostery engine; can converge onto the same
  source lists so all three track the same upstream + version.

**Shipped via** the same remote-config/CDN channel so every platform updates in
lockstep (and can refresh lists without an app update). Version the emitted
artifacts together.

**Why shared:** blocking is simultaneously the differentiator *and* the most
divergent implementation (D1/D2). You neutralize the drift by sharing the *input*
even though the *runtime* differs. Two platforms blocking different trackers on the
same page is the single most visible parity failure — this prevents it.

---

## S2 — Design tokens

**Source:** one tokens definition (e.g. a Style-Dictionary-style JSON): colors,
spacing, typography, the island geometry, and the three theme scopes
(light / dark / **private**).

**Emits:** Swift (`Color`/constants) for iOS, Kotlin/Compose for Android, and CSS
custom properties for desktop + internal pages.

**Why shared:** desktop today hand-syncs the same token *names and values* across
`styles.css` and `pages.css` (a known smell called out in `CLAUDE.md`). Do **not**
inherit that by hand-copying palettes into two more languages — generate them.
Theming parity (F15) depends on the palettes never forking.

---

## S3 — Copy / string catalog

**Source:** one localization catalog of all user-facing text: slash-command names
+ hints (F7), settings labels (F14), newtab copy ("Where to?"), empty states,
permission prompts (F13), the "private" chip, colorway labels (F17), etc.

**Emits:** platform string resources (`.strings` / `.xcstrings` for iOS,
`strings.xml` for Android) + desktop's inline strings.

**Why shared:** the lowercase-mono voice is part of the brand identity. Copy drift
is the most common silent parity failure and the easiest to prevent.

---

## S4 — Internal `blanc://` pages as a shared web bundle

**Source:** the existing `pages/*` HTML/CSS/JS (newtab ledger, favorites, history,
downloads, settings, shortcuts, error, auth).

**Consumed by:** a web view on **every** platform, served over the privileged
internal scheme, backed by a thin native data bridge (the `bowserPages`-equivalent)
per platform.

**Why shared:** these pages are already web tech; rendering the *same bundle*
everywhere makes F16 **pixel-identical for free** and is the single biggest
parity win per unit effort. The only per-platform work is the native data bridge
(live group state, blocked counters, list data) behind a shared JS API.

**Caveat:** native screens feel better for some of these (e.g. Settings). If a
page goes native on one platform, it must still match the shared bundle's content
and copy, and that becomes a tracked decision (not a silent fork).

---

## S5 — Settings schema & validation

**Source:** one schema: keys, defaults, allowed values, and the validation/sanitize
rules (the `DEFAULTS` table and predicates like `isAppIconAllowed`, hostname
normalization for `adblockExceptions`) from F14.

**Emits / informs:** each platform's settings store and its read/write validation.

**Why shared:** settings keys and defaults drifting is a subtle, corrosive parity
failure (e.g. a different default search engine, or one platform accepting an icon
id another rejects). The **sanitize-on-read == validate-on-write** rule for
`appIcon` must be identical everywhere.

---

## S6 — Acceptance scenarios

**Source:** the platform-neutral **Acceptance** lines in
[`features.md`](./features.md), expanded into runnable **Gherkin** `.feature`
files in [`acceptance/`](./acceptance/) with a checklist grid in
[`acceptance/index.md`](./acceptance/index.md).

**Consumed by:** QA / automated UI tests on every platform, run identically —
one shared set of `.feature` files, per-platform step definitions (CucumberJS on
desktop, XCTest-Gherkin/Cucumberish on iOS, Cucumber-JVM on Android). Steps are
written at the level of user *intent* so the same scenario binds to each
platform's native gesture (D7); divergences live in the step definitions, not the
scenario text.

**Why shared:** these are the executable definition of "at parity." When the same
scenario passes on all platforms, the feature is at parity by construction; when it
fails on one, that's exactly where the drift is.

---

## Priority order for building the substrate

1. **S3 copy** and **S5 settings schema** — cheapest, prevent the most common
   silent drift, needed by nearly every feature.
2. **S2 design tokens** — unblocks native chrome (F1/F15) on both platforms and
   pays down desktop's existing duplication.
3. **S4 internal pages bundle** — biggest single parity win; do it before
   reimplementing any `blanc://` page natively.
4. **S1 filter pipeline** — the differentiator; more involved (per-platform
   compile targets) but the most visible failure if skipped.
5. **S6 acceptance scenarios** — first cut written (`acceptance/`); writing the
   desktop step-definitions against the shipping app is the cheapest way to
   validate the phrasing, then iOS/Android bindings follow.
</content>
