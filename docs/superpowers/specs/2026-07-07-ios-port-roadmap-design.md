# Blanc — iOS Port Roadmap (thin-beta-first, vertical-slice)

**Date:** 2026-07-07
**Status:** Draft — brainstorm converged, not yet approved
**Surfaces:** a new `ios/` Xcode project in **this** monorepo (SwiftUI + `WKWebView`) that consumes the already-generated `settings-schema/generated/BlancSettings.swift` and `tokens/generated/Tokens.swift`; the S4 `blanc://` web bundle and S1 filter pipeline as they land; the shared `spec/acceptance/` scenarios re-bound to iOS step definitions. No desktop runtime changes — at most, promotion of shared substrate the port also consumes.

---

## 1. What this document is (and is not)

This is a **roadmap spec**, not a feature spec. It sits one level above the 11 single-feature designs already in this folder.

- Each existing spec is **one feature**: brainstorm → spec → plan → build, one tight arc.
- The iOS port is **~17 milestones**. So the artifact committed here is the **decomposition + sequencing** of the whole port. Then **each milestone (M0, M1, …) gets its own spec + implementation plan when it is actually built** — the normal per-feature flow, run once per milestone.

This is deliberate, not a shortcut. **You do not write M15's implementation plan today** — its shape depends on what M0–M6 teach you about the stack, so planning it now would be fiction. You plan the *next* milestone in detail and re-plan at each boundary. That is precisely why a port gets "one roadmap spec + per-milestone plans" where a single feature gets "one spec + one plan."

**The contract is already written.** `spec/features.md` (F1–F24), `spec/divergence-register.md` (D1–D14), `spec/parity-matrix.md`, and `spec/blocking-backends.md` define *what* iOS must do. This roadmap defines *the order in which we make it true*, and **recommends** resolutions for the open decisions those documents flagged — to be **ratified into `spec/` on approval** (§5, §11), not resolved unilaterally here. Where this roadmap and `spec/` disagree on behaviour, `spec/` wins — this is only sequencing.

## 2. Where things actually stand (2026-07-07)

**Done and reusable:**
- The full platform-neutral **contract** (F1–F24, D1–D14, parity matrix, `blocking-backends.md`).
- Three substrates that **already emit iOS artifacts**: `Tokens.swift` (design tokens) and `BlancSettings.swift` (settings enums + defaults) as Swift, plus the slash-command copy catalog as an iOS `.strings` resource. These are consumed on day one.
- The shared acceptance suite — **48** Gherkin scenarios across 12 `.feature` files (of which **23** currently execute on desktop via `test/desktop/`; the rest are a tagged backlog) — ready to re-bind to iOS step definitions (S6).

**Missing (what this roadmap builds toward):**
- **Any native app code.** No Xcode project, no app `.swift` files — only the generated substrate files. No iOS implementation exists yet: every *buildable* iOS row is unshipped/unrun (`PLANNED`), while F22 is correctly `N/A` and F23 is `DIVERGENT (D10)` on iOS — those two are contract, not gaps.
- **S1** — the filter-rule pipeline that compiles EasyList/EasyPrivacy → curated `WKContentRuleList` JSON.
- **S4** — the `blanc://` pages extracted into a shared web bundle.
- Recommended resolutions for the four decisions `blocking-backends.md` flagged "close before build," plus the now-decided **D5 cross-honor** direction (all in §5; recorded in §9, ratified into `spec/` on the paired commit).

## 3. Decisions locked (with the user, 2026-07-07)

- **Deliverable: a sequenced roadmap first**, no app code yet. (This document.)
- **Sequencing strategy: A — vertical-slice, thinnest-browser-first.** Always keep a running app; grow it feature by feature. (Rejected: B differentiator-first — a brutal on-ramp for a new-to-iOS build; C substrate-complete-first — no iOS learning or momentum until late.)
- **Near-term target: a thin, usable TestFlight beta**, then iterate to parity. The beta is: native island + tabs + address/search + web content + ad-blocking on by default. Groups/favorites/history/settings may be partial.
- **Pacing: new to Swift/iOS.** Small sessions, heavy scaffolding, reference code, learning ramps folded into early milestones. The stack is introduced easy → hard (load a page → tabs → rule compilation).
- **Repo: monorepo.** The iOS app lives at `ios/` in this repo. The generated substrate, `spec/acceptance/`, and `substrate:check` CI already run here; the parity process assumes co-location.
- **Scope: iPhone-first.** iPad enhancements (hardware-keyboard shortcuts per D7, multi-window per D11) are post-parity, not in this arc.

## 4. The milestone ladder

Maps to `spec/` IDs. "New-to-iOS beat" is the core stack concept each milestone teaches.

### Beta arc — everything at/above the cut line ships to TestFlight

| M | Delivers | Maps to | New-to-iOS beat |
|---|----------|---------|-----------------|
| **M0** | Xcode project (SwiftUI lifecycle, iPhone), a full-screen `WKWebView` loading one hardcoded URL, `Tokens.swift`/`BlancSettings.swift` referenced & compiling, runs on device | foundation | Xcode, `App`/`WindowGroup`, `UIViewRepresentable` wrapper for `WKWebView` |
| **M1** | It becomes a *browser*: address field + back/forward/reload, `normalizeAddressInput` ported to Swift, DuckDuckGo search, `handOffToOs` for `mailto:`/`tel:` | F5, part of F1, F23 (pinch-zoom free), D4 | SwiftUI state, `WKNavigationDelegate` |
| **M2** | Multi-tab: a tabs model (Swift analog of `main.js`'s `tabs` Map + `tabOrder`), create/close/switch, the pill's tab dots (cap 8 + `+N`) | F2 (defer reopen/dup/pin/mute), F1 | managing many web views, view identity |
| **M3** | Island expanded state: tap the pill → palette; tab-switcher at rest, `/` slash-command filtering (subset), Quick Switcher | F1, F6 (basic), F7 (subset), D7 | overlays/sheets, focus, list filtering |
| **M4** | `blanc://` pages via the **S4 shared web bundle** + a `WKURLSchemeHandler` + a thin `WKScriptMessageHandler` data bridge; newtab ledger renders | F16, S4 | custom scheme handler, JS↔native bridge |
| **M5** | Minimal ad-blocking: one curated `WKContentRuleList` (basic curation, *not* the full S1 pipeline), compiled & hash-cached off the launch path, on by default, binary "protected" state | F12 (minimal), D1, D13 | `WKContentRuleList`, async compile, `WKUserContentController` |
| **M6** | Theming (system/light/dark from tokens → island + bundle), settings-lite (engine/adblock/theme), session-restore basics, `paper` app icon, provisioning + first upload | F15, F14 (lite), F18 (basic) | color scheme, App Store Connect, TestFlight |

**═══ TestFlight beta cut line — M0–M6: a themed, multi-tab, ad-blocking browser ═══**

### Parity arc — iterate post-beta toward the App Store release

- **M7** — Favorites + History (F9, F10): Swift `JsonStore` analogs, live data into the `blanc://` pages, heart in the island
- **M8** — Tab groups (F3): groups model, pill renders active group, per-group palette headers, `/group`
- **M9** — Private tabs (F4): private model + theme scope, history/session exclusion
- **M10** — Full slash-command set + Find in page (F7 full, F8)
- **M11** — Downloads (F11, D3): `WKDownloadDelegate`, Files integration
- **M12** — Permissions + basic-auth (F13, F20)
- **M13** — Supporter + app icons (F17, D5, D6): StoreKit IAP, `setAlternateIconName`
- **M14** — Password AutoFill / passkeys (F24, D12) — the mobile-*gained* feature
- **M15** — The real S1 filter pipeline (F12 full, D2, D14): multi-list partition, per-site exceptions, cosmetic `css-display-none`, remote config — *replaces M5's minimal version*
- **M16** — Telemetry, context menu, D8 web-view eviction/restore, polish (F21, F19, D8)

**═══ App Store parity release when the acceptance matrix (`spec/acceptance/index.md`) goes green ═══**

**The load-bearing idea:** M5 blocking is deliberately crude (one bundled list, on/off) so the beta gets its differentiator without you first learning the entire S1 pipeline. That hard work is deferred to **M15**, once the app is real and in hands.

## 5. Open decisions — recommended resolutions

The four `blocking-backends.md` flagged, plus D5. These are **recommendations, not yet ratified**: the authoritative `spec/` still lists them open (the "Open decisions to close before build" list in `blocking-backends.md`, and the `Status:` lines of D5/D13/D14). On approval, a **paired commit updates those `spec/` files** to match the decisions below (spec-first process, §8, §11) — this roadmap does not close them unilaterally. D5 has user sign-off in §9; the mechanism remains deferred to M13.

**5.1 — iOS shield-count UX (D13).** **Recommendation: binary "protected / paused" indicator, not a live count.** `WKContentRuleList` blocks silently — there is no per-request callback — so an exact per-tab count is not readable on iOS. An approximate number that disagrees with reality is worse than none. The pill shows a shield in a protected/paused state; `spec/acceptance` F12-1 relaxes to "protection is active" on iOS (already anticipated in D13). This holds for **both** M5 and M15 — it's the iOS truth, not a beta compromise.

**5.2 — Rule-list partition scheme + budget.** **Recommendation: partition by category, value-ordered** — network-block(ads) → network-block(tracking) → cosmetic(`css-display-none`) last — each compiled list under WebKit's ~150k-rule ceiling; 2–3 lists total attached to one web view. The S1 pipeline (M15) owns the "what got dropped" decision, since only it sees the whole corpus, and **logs the dropped set** — no silent truncation. Total budget is pinned to the min-iOS floor's WebKit ceiling; confirm the exact number at M15 against the shipping target OS. **Beta (M5):** a single bundled list, basic curation — the partition machinery is M15.

**5.3 — Cosmetic scope (D14).** **Recommendation: iOS ships static `css-display-none` only.** Procedural cosmetics (`:has`, scriptlets, JS-driven hiding) are not expressible in `WKContentRuleList` and are dropped — documented ceiling, not a bug. **Beta (M5):** cosmetic minimal or off; network blocking is the 80/20. Full static cosmetic set: M15.

**5.4 — Update cadence.** **Recommendation.** **Beta (M5):** the filter list is **bundled in-app**; updates ride app updates (no remote config yet). **Full (M15):** remote-config pull on a periodic interval (recommend **daily**) + on launch; iOS **recompiles lazily on next launch** when the source version changes — compilation is expensive, so keep it off the launch hot path and reuse `WKContentRuleListStore`'s content-hash cache (the analog of desktop's `adblock-engine.v<N>.bin`).

**5.5 — Supporter cross-honor (D5).** **Decision (user, 2026-07-07): cross-honor both ways.** A supporter who buys on *either* platform — Polar on desktop, StoreKit IAP on iOS — is unlocked on the other. The **direction is locked; the *mechanism* is a non-trivial open sub-decision deferred to the M13 spec**, because the two directions differ sharply:

- **Desktop → iOS is tractable.** The iOS app offers "restore desktop supporter": a **one-time** activation check against a Blanc endpoint that verifies the Polar purchase and returns an entitlement the app then trusts forever locally — consistent with desktop's existing one-time Polar activation, so "trusted-forever / offline-OK *after* unlock" survives.
- **iOS → desktop is harder.** StoreKit purchases can be verified server-side via App Store Server API signed transaction data, and can be associated with a Blanc-side account/link token via `appAccountToken`; the hard part is that Blanc has no cross-platform account. Honoring an IAP on desktop therefore needs an activation/linking flow plus a small **Blanc-run entitlement registry** — a new trust surface and a mild phone-home the brand otherwise avoids.

It also collides with the Profile Sync decision to **exclude `supporter` from sync**: propagating the unlock through the sync account would be the simplest mechanism but reverses that decision and means a shared passphrase unlocks the cosmetic everywhere. The M13 spec resolves the mechanism (favouring activation-time-only checks to preserve the trusted-forever/offline-OK posture after unlock). Lands at **M13**; affects nothing earlier. **Ratifies into D5 as: cross-honor both ways, activation mechanism TBD @ M13.**

## 6. Session-by-session cadence — M0 and M1

Firm only for the first two milestones (new-to-iOS pacing); M2+ get their own `writing-plans` pass at each boundary. Each session is one concept, with reference code and a run-and-see payoff.

**M0 — from zero to "a native app that shows a web page"**
- **M0.1** — Create the Xcode project: SwiftUI `App` lifecycle, iPhone target, bundle id `me.bnfy.blanc` (§7), min-iOS floor (§7). Lay out the `ios/` tree. Build + run the empty app on the simulator and your own device. *Learn:* Xcode navigation, the `App`/`WindowGroup`/`View` skeleton, on-device code-signing.
- **M0.2** — A full-screen `WKWebView` loading one hardcoded URL. `WKWebView` is UIKit, so this is a `UIViewRepresentable` wrapper — the key SwiftUI↔UIKit bridge concept. *Learn:* `UIViewRepresentable`, `WKWebViewConfiguration`, real web content on screen.
- **M0.3** — Wire in the substrate: add `Tokens.swift` + `BlancSettings.swift` to the target (reference the generated files, don't copy), prove they compile, drive one background color from a token end-to-end. Decide where shared/generated code lives in `ios/`. *Learn:* targets/file membership, using the generated enums, the substrate seam.

**M1 — from "shows a page" to "is a browser"**
- **M1.1** — The address field (SwiftUI text field in a minimal pill) + load-on-submit into the `WKWebView`. Port `normalizeAddressInput` from `main.js` to Swift — a small regex heuristic, and a good first "port desktop logic to Swift" exercise. *Learn:* SwiftUI state + text input, keeping logic shape identical to desktop.
- **M1.2** — Back/forward/reload + a `WKNavigationDelegate` feeding title, URL, loading, and `canGoBack`/`canGoForward` back into SwiftUI state that drives the pill. *Learn:* delegates, `@Observable`, driving UI from async web-view callbacks.
- **M1.3** — Search-engine routing (DuckDuckGo default from `BlancSettings`) + `handOffToOs` for `mailto:`/`tel:`/`facetime:`/`sms:` via `UIApplication.open` (D4). Polish single-tab browsing. *Learn:* `UIApplication.open`, wiring settings defaults, the D4 hand-off contract.

## 7. Dependencies & Apple logistics

- **Min-iOS floor: iOS 17** (decided 2026-07-07). Every API needed (`WKContentRuleList`, the SwiftUI surfaces, `setAlternateIconName`) is mature by 17, a conservative floor with broad device reach; 18+ was the alternative (newer SwiftUI conveniences, fewer devices). **Pin `17.0` at M0.1.**
- **Bundle id.** iOS is a separate App Store app → a **fresh** id, `me.bnfy.blanc`. Unlike desktop (whose `me.bnfy.bowser` id is frozen for Gatekeeper/notarization continuity), mobile has no legacy-identity reason to inherit the old name.
- **Apple Developer account.** Already exists (desktop is signed/notarized), so TestFlight is available. Needs a new iOS App ID + provisioning at M6.
- **Long-pole entitlement — start early.** The default-browser entitlement (`com.apple.developer.web-browser`, D4) requires Apple approval with a review lead time. **Request it during M0–M1** so it is granted by the M6 beta. The passkey entitlement (`com.apple.developer.web-browser.public-key-credential`, F24/D12) is later (M14) but also needs a request — note it now.
- **StoreKit IAP.** Configured in App Store Connect for M13 (supporter unlock, D5). Not needed before then.
- **Substrate timing.** S4 (pages bundle) is first needed at **M4**; the full S1 pipeline at **M15**. The beta uses a bundled minimal list, so neither blocks the beta.

## 8. What "parity release" means (the process, from `spec/README.md`)

The port is done when every buildable iOS row in the acceptance matrix is green. Per the parity process:
- Each milestone is **spec-first, paired**: it implements to the `spec/` contract, and any new divergence adds a `D#` *before* merging.
- **Definition of Done includes "parity matrix updated"** — each milestone flips its in-scope F# rows to `SHIPPED` / `PARTIAL` / `DIVERGENT` as appropriate (not a blanket `SHIPPED`).
- **Milestone-scoped, not all-or-nothing.** A milestone's *in-scope* acceptance steps pass on iOS (re-bound via iOS step definitions, S6); a feature whose row is only partly delivered stays `PARTIAL` until *all* its steps pass. Example: M5 ships F12-minimal — **F12-1** (relaxed to "protection active" on iOS per D13) and **F12-3** (global toggle) pass, but **F12-2** (per-site allow, D2) is deferred to M15, so **F12 stays `PARTIAL` from M5 until M15**.

## 9. Decisions taken (2026-07-07)

1. **D5 cross-honor — cross-honor both ways** (§5.5). A purchase on either platform unlocks the other; the activation *mechanism* is deferred to the M13 spec (direction locked, mechanism TBD).
2. **M13 timing — free beta first.** Supporter/IAP stays post-beta as sequenced.
3. **Beta scope — M5 ad-blocking stays above the cut line.** The differentiator ships in the beta.
4. **Min-iOS floor — iOS 17**, pinned at M0.1 (§7).

## 10. Out of scope (deliberate)

- **Android.** A separate track; this roadmap is iOS-only. The shared substrate (Kotlin generation) already anticipates it.
- **iPad polish, multi-window, hardware-keyboard shortcuts** (D7/D11) — post-parity.
- **The full S1 pipeline sophistication** until M15 — the beta blocks with a bundled list.
- **Any app code in this document.** The next artifact is a `writing-plans` implementation plan for **M0–M1 only**.

## 11. Next step

The §9 decisions are taken. On your commit go:
1. **Ratify the §5 decisions into `spec/`** — a paired commit updating the `Status:` lines of **D5** (→ *cross-honor both ways; activation mechanism TBD @ M13*), **D13** (→ binary protected state), and **D14** (→ static `css-display-none`), and closing the "Open decisions to close before build" list in `blocking-backends.md` (shield UX, partition scheme, cosmetic scope, update cadence). The authoritative tree closes the decisions, not just this roadmap (spec-first, §8).
2. **Invoke `writing-plans`** to produce the concrete implementation plan for **M0–M1** (the six sessions in §6).

Every later milestone re-enters brainstorm → spec → plan at its own boundary.
