# Divergence Register

Every **deliberate** platform split lives here. A divergence is legal only if it
has an entry with a rationale and the **parity contract that still holds** across
it. If you need to diverge in a way not listed, add a `D#` *before* merging.

Format per entry: why it must diverge · the per-platform approach · **what stays
identical anyway** (the parity contract) · status.

---

## D1 — Ad/tracker blocking engine
**Features:** F12
**Why:** The platforms expose fundamentally different network-interception
capabilities, and this is non-negotiable — you cannot ship a common engine.

- **Desktop:** `webRequest` interception via `@ghostery/adblocker-electron` at the
  session layer — programmatic, unconstrained, plus library-driven cosmetic
  filtering.
- **Android:** `WebView.shouldInterceptRequest` in a custom `WebViewClient` —
  **programmatic and comparably powerful** to desktop; can consult the full rule
  set per request. Alternatively a bundled Chromium fork if the app ever ships its
  own engine.
- **iOS:** `WKContentRuleList` — **declarative JSON, ~150k-rule cap per list, no
  programmatic per-request logic.** Requires curating EasyList+EasyPrivacy down to
  fit and compiling to Apple's format. This is structurally the same constraint as
  Manifest V3's `declarativeNetRequest` — the very thing desktop Blanc was built to
  escape. Accept it; it is the platform ceiling.

**Parity contract that still holds:** blocking is on by default; a per-tab shield
count is shown (with the iOS caveat in D13); the trackers blocked come from the
*same source lists* (→ shared substrate) even though the compiled form differs;
`/allow-ads` and `/block-ads` work identically from the user's side.

**Do not** flatten Android down to iOS's declarative model to make the code
"match." Android is where the differentiator survives — let it be powerful.

**Detailed design:** [`blocking-backends.md`](./blocking-backends.md).

**Status:** Accepted, foundational.

---

## D2 — Per-site ad exception mechanism
**Features:** F12, F14 (`adblockExceptions`)
**Why:** Follows from D1.

- **Desktop / Android:** a **live predicate** — check the origin against the
  exceptions list per request; cheap, instant.
- **iOS:** content rule lists are compiled and attached to the web view, so a
  per-site exception means **swapping/recompiling or layering rule lists** — costlier
  and not instant. Recommended pattern (see `blocking-backends.md`): a small,
  separately-recompiled `ignore-previous-rules` list keyed on the allowlist,
  applied last, so the base lists stay cached.

**Parity contract:** adding/removing a site exception has the same *user-visible*
effect (ads allowed/blocked on that origin) and the same persisted
`adblockExceptions` shape everywhere; only the latency/mechanism differs.

**Detailed design:** [`blocking-backends.md`](./blocking-backends.md).

**Status:** Accepted.

---

## D3 — Downloads storage & file access
**Features:** F11
**Why:** iOS sandboxing vs. Android/desktop filesystem access.

- **Desktop:** arbitrary path + reveal-in-folder.
- **Android:** the Downloads directory / scoped storage; open via an intent.
- **iOS:** app sandbox → Files-app integration; "open" via the document
  interaction / share sheet.

**Parity contract:** the **downloads list UI, progress, states, and 200-entry
cap** are identical; only where the bytes land and how you re-open them differ.

**Status:** Accepted.

---

## D4 — Default-browser role & OS link hand-off
**Features:** F5, F19
**Why:** Each OS has its own default-browser mechanism and URI-hand-off model.

- **Desktop:** `handOffToOs()` for `mailto:`/`tel:`/`facetime:`/`sms:`; OS default
  registration via the packaged app.
- **iOS:** default-browser **entitlement** + universal-link/URI handling; hand-off
  via `UIApplication.open`.
- **Android:** intent filters + the default-browser role; hand-off via `Intent`.

**Parity contract:** a bare `mailto:`/`tel:`/etc. is handed to the OS (never
treated as a search query), and Blanc can be set as the default browser, on every
platform that allows it.

**Status:** Accepted.

---

## D5 — Supporter monetization rails
**Features:** F17, F14 (`supporter`)
**Why:** App Store and Play require their own in-app billing for digital unlocks;
the desktop Polar.sh flow cannot be used in-app on mobile (and would violate store
policy).

- **Desktop:** Polar.sh one-time license, activated against Polar's API.
- **iOS:** **StoreKit / In-App Purchase** (Apple's cut applies).
- **Android:** **Google Play Billing.**

**Parity contract:** the unlock is a **one-time purchase** that flips
`supporterActive` and unlocks the same 3 colorways; once unlocked it is
**trusted-forever, offline-OK, cosmetic-only** (no revalidation/DRM) on every
platform. Renderers only ever see the derived boolean, never a key.

**Cross-honor (decided 2026-07-07):** a purchase on **either** platform unlocks the
other (not independent). The activation *mechanism* is non-trivial and deferred to
the iOS **M13** supporter spec: desktop→iOS is a one-time Polar-verification check;
iOS→desktop needs an activation/linking flow (App Store Server API signed
transactions + `appAccountToken`) plus a small Blanc-run entitlement registry, since
Blanc has no cross-platform account. Favour activation-time-only checks to preserve
the trusted-forever/offline-OK posture after unlock. See
[the iOS port roadmap](../docs/superpowers/specs/2026-07-07-ios-port-roadmap-design.md) §5.5.

**Status:** Accepted; **cross-honor both ways** — direction decided 2026-07-07,
activation mechanism TBD @ iOS M13.

---

## D6 — App-icon switching mechanism
**Features:** F17
**Why:** Dynamic app-icon switching differs by OS.

- **Desktop:** Dock/taskbar icon swapped at runtime (`applyAppIcon`).
- **iOS:** `setAlternateIconName` — clean, first-class, supports all colorways.
- **Android:** no first-class dynamic icon API; the usual workaround is
  **`activity-alias` swapping**, which is limited and can relaunch/flicker. The
  colorway feature may therefore be **fuller on iOS than Android**.

**Parity contract:** the *set of colorways offered* and the gating
(`isAppIconAllowed`) are identical; the launcher-icon change may be less seamless
on Android — document the chosen UX rather than hiding the gap.

**Status:** Accepted; Android UX to be finalized.

---

## D7 — Input model (keyboard → touch)
**Features:** F1, F6, F7, F19, and all shortcuts
**Why:** Desktop is keyboard-first; mobile is touch-first.

Desktop bindings and their mobile intent:

| Desktop | Action | Mobile equivalent |
|---------|--------|-------------------|
| ⌘[ / ⌘] (pill buttons) | Back / Forward | edge-swipe gesture (`allowsBackForwardNavigationGestures`) — no pill buttons |
| ⌘L | Search & Commands (palette) | tap the pill / pull-down |
| ⌘T | New Tab | new-tab button |
| ⌘⇧N | New Private Tab | new-private-tab action |
| ⌘W | Close Tab | close affordance / swipe |
| ⌘⇧T | Reopen Closed Tab | menu action |
| ⌘F | Find in Page | menu action / `/find` |
| ⌘R / ⌘⇧R | Reload / hard reload | pull-to-refresh / menu |
| ⌘1–9 | nth Tab or Group | (no direct touch analog; via switcher) |
| Ctrl+Tab / ⇧ | Next/Prev Tab | swipe on the pill |
| ⌥⌘←/→/↑/↓ | Prev/Next tab-in-group / group | swipe / switcher |
| ⌘D | Add to Favorites | heart in action cluster |
| ⌘Y / ⌘⌥B | History / Favorites | menu / `/history` `/favorites` |
| ⌘⇧J | Downloads | menu / `/downloads` |
| ⌘, | Settings | menu / `/settings` |
| ⌘+/-/0 | Zoom | pinch (D10) |
| right-click | Context menu | long-press (F19) |
| ⌘/Ctrl+click | Open link in background tab | long-press → background |
| Esc | Dismiss island/find | back gesture / dismiss |

- **iPad** with a hardware keyboard **may reintroduce** the desktop shortcuts on
  iOS only — a permitted iOS-only enhancement, not an Android obligation.
- **Slash commands (F7) are the cross-platform equalizer:** every keyboard action
  also has a `/command`, so the *capability* stays reachable on touch even where a
  shortcut doesn't.

**Parity contract:** every *capability* is reachable on every platform (via
gesture, menu, or slash command); only the *trigger* differs. iOS and Android
touch affordances should match **each other**.

**Status:** Accepted.

---

## D8 — Tab / web-view lifecycle & memory
**Features:** F2, F18
**Why:** Mobile OSes aggressively evict backgrounded web views; desktop keeps all
tab views alive.

- **Desktop:** every tab's view stays alive; switching is attach/detach.
- **Mobile:** inactive web views may be **snapshotted and torn down**, then
  restored (URL + scroll) on reactivation, to survive memory pressure.

**Parity contract:** from the user's view, a tab retains its identity, title, and
scroll position across backgrounding; restore is seamless. The *eviction strategy*
is an implementation detail per platform.

**Status:** Accepted; a shared "tab restore" acceptance scenario should exercise
this on mobile.

---

## D9 — Auto-update
**Features:** F22
**Why:** Mobile app stores own update delivery; a self-updater is disallowed/
pointless.

- **Desktop:** `electron-updater` against GitHub Releases (packaged only).
- **iOS/Android:** **store-managed** — no in-app updater.

**Parity contract:** users get updates through the platform's normal channel; no
platform ships a self-updater that fights the OS.

**Status:** Accepted.

---

## D10 — Zoom / page scaling
**Features:** F23
**Why:** Desktop discrete zoom vs. mobile native pinch/reflow.

**Parity contract:** pages can be scaled and reset on every platform; the control
is platform-native.

**Status:** Accepted.

---

## D11 — Window model & chrome placement
**Features:** F1
**Why:** Desktop is a resizable window with window controls and a strip + overlay;
mobile is a single full-screen surface with system insets.

- **Desktop:** one `BrowserWindow`, a 56px strip, an always-on-top overlay view,
  traffic-lights / window controls.
- **Mobile:** a single surface; the island adapts to safe-area insets; no window
  controls; multi-window is a tablet/foldable consideration, not a phone one.

**Parity contract:** the island's *contents and states* (F1) are identical; its
*placement/windowing* adapts to the platform.

**Status:** Accepted.

---

## D12 — Password AutoFill & passkeys (divergence in mobile's favor)
**Features:** F24
**Why:** Desktop is blocked from native password managers by vendor
code-signature allowlists (see `CLAUDE.md`); mobile web views participate in the
OS credential system.

- **Desktop:** `N/A` — cannot join the allowlist.
- **iOS:** AutoFill Credential Provider + platform passkeys/WebAuthn work in
  `WKWebView`; consider the `web-browser.public-key-credential` entitlement.
- **Android:** Autofill framework / Credential Manager + passkeys work in `WebView`.

**Parity contract:** on mobile, saved credentials and passkeys are offered on login
forms inside Blanc tabs. This is a feature **mobile gains** over desktop — track it
as such, not as desktop being behind.

**Status:** Accepted; an intentional *positive* divergence.

---

## D13 — Shield count fidelity
**Features:** F12, F1 (the pill's shield count)
**Why:** Surfaced while speccing the backends (`blocking-backends.md`). Whether the
app can observe individual blocked requests depends on the engine model.

- **Desktop:** exact — the Ghostery engine emits a `request-blocked` event per
  block (main.js already counts these per tab).
- **Android:** exact — `shouldInterceptRequest` is programmatic, so a per-tab
  counter increments on each block.
- **iOS:** **not directly available** — `WKContentRuleList` blocks silently with no
  per-request callback. Recommended: show a binary "protected / paused" state
  instead of a live count (an approximate number that disagrees with reality is
  worse than none).

**Parity contract:** protection status is always visible; the *precision* of the
count differs — exact on desktop/Android, a protected-state indicator on iOS. The
F12-1 acceptance step is relaxed on iOS accordingly.

**Detailed design:** [`blocking-backends.md`](./blocking-backends.md).

**Status:** Accepted; **iOS shield UX decided 2026-07-07: binary "protected / paused" state** (no live count — `WKContentRuleList` blocks silently). F12-1 relaxed on iOS.

---

## D14 — Cosmetic filtering fidelity
**Features:** F12
**Why:** Element-hiding (vs. request-blocking) has different ceilings per engine.

- **Desktop:** the library drives full cosmetic filtering (including procedural).
- **Android:** no cosmetic API — inject element-hiding CSS/JS on page load
  (`onPageStarted`/`onPageFinished`); can do procedural hiding, but hand-rolled.
- **iOS:** `css-display-none` rules only — static selectors, a **subset**;
  procedural cosmetics (`:has`, scriptlets) are dropped.

**Parity contract:** obvious ad elements are hidden everywhere; the depth of
cosmetic coverage differs (full desktop / procedural-but-manual Android / static
iOS). Not a bug — a documented ceiling.

**Detailed design:** [`blocking-backends.md`](./blocking-backends.md).

**Status:** Accepted; **iOS cosmetic scope decided 2026-07-07: static `css-display-none` only** (procedural dropped). Android cosmetic depth (procedural via injection) finalized when Android is built.

---

## D15 — Chrome surface material
**Features:** F1
**Why:** iOS 26 introduces Liquid Glass, a platform-native translucent material
with no desktop/Android equivalent.

- **Desktop:** opaque token-defined surface (`--surface-raised` + `--border`
  custom properties in `styles.css`).
- **iOS (26+):** `.glassEffect(.regular.interactive, in: .capsule)` — the
  platform-native translucent material. Falls back to the token surface on
  iOS 17–25 via `#available(iOS 26, *)`.
- **Android:** token-defined surface (same as desktop).

**Parity contract:** the island pill is present and functional on every
platform; the *material treatment* differs — opaque tokens on desktop/Android,
Liquid Glass on iOS 26+. The pill's layout, content, and interaction model
are identical.

**Status:** Accepted; **iOS material decided 2026-07-08: Liquid Glass with token fallback.**
