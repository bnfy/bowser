# Acceptance Scenarios (S6)

The **executable definition of "at parity."** These are the platform-neutral
`Acceptance` lines from [`../features.md`](../features.md), expanded into runnable
scenarios. When the same scenario passes on desktop, iOS, and Android, that
feature is at parity *by construction*; when it fails on one platform, that is
exactly where the drift is.

## Format: Gherkin `.feature` files

One shared source, many platform runners — the same substrate pattern as the
filter lists and design tokens. Each `.feature` file is plain
[Gherkin](https://cucumber.io/docs/gherkin/); each platform binds the steps to
**native step definitions**:

| Platform | Suggested runner | Drives |
|----------|------------------|--------|
| Desktop (Electron) | CucumberJS + Playwright/Spectron | the real chrome + tabs |
| iOS (Swift) | XCTest-Gherkin or Cucumberish + XCUITest | the SwiftUI chrome + `WKWebView` |
| Android (Kotlin) | Cucumber-JVM + Espresso/UIAutomator | the Compose chrome + `WebView` |

The **same `.feature` files** live here and are consumed by all three; only the
step-definition bindings are per-platform. That is what keeps them at parity — you
cannot change the expected behaviour for one platform without editing the shared
scenario.

## The intent-level step convention (important)

Steps describe **user intent / capability**, never a platform-specific trigger.
Write:

- ✅ `When I open the command palette`
- ❌ `When I press Cmd+L`

Each platform's step definitions map the intent to its native gesture (the palette
is ⌘L on desktop, a pill tap / pull-down on mobile — divergence **D7**). This is
deliberate: it forces the scenarios to assert *what the user achieves*, which is
the thing that must be identical, and pushes platform mechanics into the bindings.

**Corollary — divergences live in the step definitions, not the scenario text.**
Where a divergence (`D#`) is invisible to the user (e.g. the ad-block *engine* D1,
or per-site exception *latency* D2), the scenario stays `@all` and asserts only the
user-observable outcome. Only where the observable outcome itself legitimately
differs (e.g. F24 AutoFill is mobile-only; F22 self-updater is desktop-only) does a
scenario carry a platform tag instead of `@all`.

## Tags

| Tag | Meaning |
|-----|---------|
| `@F12`, `@D1` | Traceability to a feature / divergence (see `../features.md`, `../divergence-register.md`). |
| `@F12-2` | Stable **scenario id** (`F<feature>-<n>`). Used in the checklist grid ([`index.md`](./index.md)). Never renumber. |
| `@all` | Must pass identically on every platform. |
| `@desktop` `@ios` `@android` `@mobile` | Applies only to the tagged platform(s); `@mobile` = iOS + Android. |
| domain tag (e.g. `@island`) | Feature-file level, for running a whole file. |

## Running a subset

```
# every parity scenario that must match across platforms
cucumber-js --tags @all
# just the differentiator
cucumber-js --tags @F12
# everything touching a divergence you're about to change
cucumber-js --tags @D1
```
(Equivalent tag expressions exist for the iOS/Android runners.)

## Recording results

[`index.md`](./index.md) is the **checklist grid** — every scenario id × platform,
with a status cell. Update it as scenarios are automated/verified; walk it at every
release boundary as part of the parity audit (see [`../README.md`](../README.md)).
A feature's row in [`../parity-matrix.md`](../parity-matrix.md) should not move to
`SHIPPED` on a platform until that feature's scenarios pass there.

## Scope of this first cut

- Every feature `F1–F24` has at least one scenario; the differentiators and the
  most divergence-heavy features have several.
- Scenarios are written; **step definitions are not** — those are the first
  per-platform task, and writing the desktop bindings first (against the shipping
  app) is the cheapest way to validate that the scenarios are phrased correctly.
</content>
