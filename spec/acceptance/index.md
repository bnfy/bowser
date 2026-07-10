# Acceptance Checklist & Traceability

Every acceptance scenario, its feature/divergence trace, and its per-platform
status. This is the grid you tick during the per-release **parity audit** — a
feature's row in [`../parity-matrix.md`](../parity-matrix.md) shouldn't reach
`SHIPPED` on a platform until its scenarios pass there.

**Status:** ✅ verified/passing · ⬜ not built / not run · ➖ N/A on this platform.

> Desktop is the shipped reference, so its `@all` cells are ✅ (behaviour verified
> in the shipping app; automated step-defs are a separate track). iOS/Android are
> greenfield → ⬜. Scenario count: **50** across 12 `.feature` files.

## Files

| Domain | File | Features |
|--------|------|----------|
| Island / palette / slash | `island-and-commands.feature` | F1, F6, F7 |
| Tabs & groups | `tabs-and-groups.feature` | F2, F3 |
| Private tabs | `private-tabs.feature` | F4 |
| Navigation & context menu | `navigation-and-context-menu.feature` | F5, F19 |
| Find / favorites / history | `find-favorites-history.feature` | F8, F9, F10 |
| Downloads | `downloads.feature` | F11 |
| Ad/tracker blocking | `ad-blocking.feature` | F12 |
| Settings & theming | `settings-and-theming.feature` | F14, F15 |
| Permissions & auth | `permissions-and-auth.feature` | F13, F20 |
| Internal pages | `internal-pages.feature` | F16 |
| Supporter & session | `supporter-and-session.feature` | F17, F18 |
| Platform services | `platform-services.feature` | F21, F22, F23, F24 |

## Grid

| ID | Scenario | Diverge | Desktop | iOS | Android |
|----|----------|---------|:-------:|:---:|:-------:|
| F1-1 | Resting pill reflects tab, group, shield | — | ✅ | ⬜ | ⬜ |
| F1-2 | Palette floats command bar + tab switcher | — | ✅ | ⬜ | ⬜ |
| F2-1 | Reopen closed restores URL | — | ✅ | ⬜ | ⬜ |
| F2-2 | Duplicate tab | — | ✅ | ⬜ | ⬜ |
| F2-3 | Pin orders ahead of unpinned | — | ✅ | ⬜ | ⬜ |
| F2-4 | Plain new tab is ungrouped | — | ✅ | ⬜ | ⬜ |
| F3-1 | `/group` creates + moves | — | ✅ | ⬜ | ⬜ |
| F3-2 | Pill shows only active group | — | ✅ | ⬜ | ⬜ |
| F3-3 | Collapse tucks tabs away | — | ✅ | ⬜ | ⬜ |
| F3-4 | Last tab prunes group | — | ✅ | ⬜ | ⬜ |
| F3-5 | Grouped pin stays in group | — | ✅ | ⬜ | ⬜ |
| F4-1 | Private not recorded / not reopenable | — | ✅ | ⬜ | ⬜ |
| F4-2 | Private styling + quick exit | — | ✅ | ⬜ | ⬜ |
| F4-3 | Child tabs inherit privacy | — | ✅ | ⬜ | ⬜ |
| F4-4 | Private session isolated from ordinary tabs | — | ✅ | ⬜ | ⬜ |
| F5-1 | Domain navigates | — | ✅ | ⬜ | ⬜ |
| F5-2 | Query searches (4 engines) | — | ✅ | ⬜ | ⬜ |
| F5-3 | `mailto:` hands off to OS | D4 | ✅ | ⬜ | ⬜ |
| F6-1 | Quick Switcher matches tabs + favorites | — | ✅ | ⬜ | ⬜ |
| F6-2 | Quick Switcher matches + focuses group | — | ✅ | ⬜ | ⬜ |
| F7-1 | Slash prefix filters commands | — | ✅ | ⬜ | ⬜ |
| F7-2 | Running a slash command acts | — | ✅ | ⬜ | ⬜ |
| F8-1 | Find count + page stays interactive | — | ✅ | ⬜ | ⬜ |
| F9-1 | Favorite surfaces on newtab + list | — | ✅ | ⬜ | ⬜ |
| F9-2 | Add all open tabs to favorites | — | ✅ | ⬜ | ⬜ |
| F10-1 | Visit recorded with final title | — | ✅ | ⬜ | ⬜ |
| F10-2 | `/clear` empties history | — | ✅ | ⬜ | ⬜ |
| F11-1 | Download shows progress + completes | — | ✅ | ⬜ | ⬜ |
| F11-2 | Completed download is retrievable | D3 | ✅ | ⬜ | ⬜ |
| F12-1 | Blocking increments shield count | D1 | ✅ | ⬜ | ⬜ |
| F12-2 | Allow-ads drops count + persists | D2 | ✅ | ⬜ | ⬜ |
| F12-3 | Global toggle off/on | — | ✅ | ⬜ | ⬜ |
| F13-1 | Geolocation prompt + deny persists | — | ✅ | ⬜ | ⬜ |
| F14-1 | Invalid search engine rejected | — | ✅ | ⬜ | ⬜ |
| F14-2 | Unlicensed supporter icon → default | D5 | ✅ | ⬜ | ⬜ |
| F14-3 | Exception hostnames normalized | — | ✅ | ⬜ | ⬜ |
| F15-1 | Dark recolors chrome + page live | — | ✅ | ⬜ | ⬜ |
| F15-2 | Private theme scope | — | ✅ | ⬜ | ⬜ |
| F16-1 | Newtab ledger contents | — | ✅ | ⬜ | ⬜ |
| F16-2 | Internal nav stays in scheme | — | ✅ | ⬜ | ⬜ |
| F16-3 | Privileged chrome rejects web navigation | D11 | ✅ | ➖ | ➖ |
| F17-1 | Supporter unlock enables colorways | D6 | ✅ | ⬜ | ⬜ |
| F17-2 | Non-supporter locked + fallback | — | ✅ | ⬜ | ⬜ |
| F18-1 | Relaunch restores groups, not private | D8 | ✅ | ⬜ | ⬜ |
| F19-1 | Background tab inherits group | D4, D7 | ✅ | ⬜ | ⬜ |
| F20-1 | Basic-auth prompt | — | ✅ | ⬜ | ⬜ |
| F21-1 | Usage ping off by default / single | — | ✅ | ⬜ | ⬜ |
| F22-1 | Desktop in-app updater | D9 | ✅ | ➖ | ➖ |
| F22-2 | Mobile ships no self-updater | D9 | ➖ | ⬜ | ⬜ |
| F23-1 | Page scales + resets | D10 | ✅ | ⬜ | ⬜ |
| F24-1 | AutoFill + passkeys in a tab | D12 | ➖ | ⬜ | ⬜ |

> **M0–M1 note (2026-07-08):** F5 (address/search + OS hand-off) and F1 (minimal
> address surface) are implemented and unit-tested on iOS, but the iOS acceptance
> cells remain ⬜ — automated iOS step-def binding (S6) is a separate track.

## Coverage check

- Every feature `F1–F24` has ≥1 scenario. ✅
- Every divergence `D1–D14` is exercised by ≥1 scenario **except** `D11` (window
  model), `D13` (shield-count fidelity), and `D14` (cosmetic depth) — these have no
  discrete behavioural assertion. D11 is verified implicitly wherever island
  scenarios (F1) run on each platform's windowing; D13/D14 are covered within the
  F12 contract (F12-1's shield assertion is relaxed on iOS per D13 — see
  [`../blocking-backends.md`](../blocking-backends.md)). Add dedicated scenarios if
  concrete assertions emerge.
- Mobile-gained / platform-specific outcomes (F22, F24) correctly carry platform
  tags rather than `@all`.
