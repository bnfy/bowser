# Blanc — Cross-Platform Parity Spec

This directory is the **platform-neutral source of truth** for what Blanc *is*,
independent of any one implementation. Desktop (Electron), iOS (Swift), and
Android (Kotlin) are three implementations of the spec in here — none of them is
the reference. The spec is.

It exists so that two (eventually three) native codebases can stay at **feature
parity** without accidentally drifting, while still being allowed to diverge
where the platform genuinely demands it.

> **First-cut status (2026-07):** Desktop is shipped and is the de-facto
> behaviour today, so this first cut was *extracted from the desktop app and
> `CLAUDE.md`*. iOS and Android are not built yet — every mobile cell in the
> matrix is `PLANNED`. The value right now is the **contract** each feature
> must honour and the **divergences** already known, so the mobile builds start
> from a shared target instead of copying desktop's incidental choices.

## The one principle

**Parity means product/behaviour parity, not implementation parity.**

The user-facing surface — what you can do, how it looks and feels, the copy, the
settings, the states — stays identical across platforms. The *implementation* is
allowed, and sometimes required, to diverge. The entire job of this spec is to
make the shared contract explicit and the allowed divergences explicit, so that:

- **unplanned** drift is caught (a feature quietly behaves differently), and
- **planned** divergence is just documented, not re-litigated every release.

"Divergent by design" is a first-class, legal state (see
[`divergence-register.md`](./divergence-register.md)). Silent divergence is the
bug.

## The three pillars

### 1. Source of truth — the contract
- [`features.md`](./features.md) — every feature, defined platform-neutrally:
  behaviour, states, copy, settings keys, and a pointer to any divergence.
- [`parity-matrix.md`](./parity-matrix.md) — the dashboard: feature × platform ×
  status. This is what you scan to see where the three builds stand.
- [`divergence-register.md`](./divergence-register.md) — every deliberate
  platform split, with rationale and the parity contract that still holds across
  the split.

### 2. Shared substrate — ship it from one place so it can't drift
- [`shared-substrate.md`](./shared-substrate.md) — the artifacts (filter-rule
  pipeline, design tokens, copy catalog, internal `blanc://` pages, settings
  schema) that are generated/shipped from a single source and consumed by all
  platforms. The rule of thumb: if two platforms would otherwise hand-copy the
  same thing, it belongs here as a generated artifact.

### 3. Process — keep it true over time
- **Spec-first, paired changes.** A behaviour change edits `features.md` (and the
  matrix) *first*, then spawns an iOS task and an Android task. A feature is not
  "done" until every platform matches the spec **or** carries an approved entry
  in the divergence register.
- **Definition of Done includes "parity matrix updated."** No exceptions.
- **Shared acceptance scenarios.** Platform-neutral Gherkin scenarios in
  [`acceptance/`](./acceptance/) (sourced from each feature's "Acceptance" line)
  run identically on every platform via per-platform step definitions. Drift
  shows up as the same scenario failing on one platform. The checklist grid in
  [`acceptance/index.md`](./acceptance/index.md) is what you tick at each release.
- **Lockstep release train.** Version and ship the platforms together, or gate a
  release on the matrix being green. This is what stops one platform silently
  pulling ahead in features.
- **A named parity owner.** One person (or a shared reviewer across both mobile
  repos) signs off that each feature matches. Fully independent iOS/Android
  owners with no shared reviewer guarantees drift.
- **Per-release parity audit.** Walk the matrix and the apps side-by-side against
  the acceptance scenarios at each release boundary.

## Status legend (used in the matrix)

| Mark | Meaning |
|------|---------|
| `SHIPPED` | Built and matches the spec on this platform. |
| `PARTIAL` | Built but incomplete or not yet matching the spec. |
| `PLANNED` | Specified, not yet built on this platform. |
| `DIVERGENT` | Intentionally differs — see the referenced `D#` in the register. |
| `N/A` | Does not apply to this platform (and that is correct, not a gap). |

## Stable IDs

Features are `F#`, divergences are `D#`. These IDs are permanent and are how the
matrix, the feature spec, and the divergence register cross-reference each other.
Never renumber; retire an ID rather than reuse it.

## How to use this when building a feature

1. Read the feature's entry in `features.md` and any `D#` it points to.
2. Implement to the **contract**, not to what the other platform's code happens
   to do.
3. If you must diverge in a new way, add a `D#` entry *before* merging — with the
   rationale and the parity contract that still holds.
4. Update the feature's row in `parity-matrix.md`.
5. Run the feature's acceptance scenario on your platform; it must pass
   identically to the others.

## Relationship to `CLAUDE.md` and desktop

`CLAUDE.md` at the repo root remains the deep architectural narrative for the
**desktop** implementation (Electron internals, packaging, release, macOS
specifics). This spec is the layer *above* it: the product behaviour desktop
implements and mobile must match. Where the two overlap on behaviour, this spec
wins as the cross-platform contract; where `CLAUDE.md` describes desktop
mechanics, it stays authoritative for desktop. The shared substrate should
eventually feed desktop too (e.g. design tokens and the filter pipeline), which
would retire some of desktop's current hand-synced duplication.
</content>
</invoke>
