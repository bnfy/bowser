# Blocking Backends — concrete design (D1, D2)

Ad/tracker blocking (F12) is Blanc's differentiator **and** its most divergent
implementation. This document specs the two mobile backends concretely, against
the same shared filter data (substrate S1) and the same user-facing contract, so
the divergence is engineered on purpose rather than discovered late.

Read alongside: [`features.md#f12`](./features.md), the divergence register
([D1](./divergence-register.md#d1), [D2](./divergence-register.md#d2),
[D13](./divergence-register.md#d13), [D14](./divergence-register.md#d14)), and
substrate [S1](./shared-substrate.md#s1).

## The contract that must hold on every platform

From F12, unchanged by any backend:

- Blocking is **on by default**.
- Ad/tracker **requests are blocked**, and leftover ad **elements are hidden**.
- A **per-site allow** (`/allow-ads`, the `adblockExceptions` list) and a **global
  toggle** (`/block-ads`) work identically from the user's side.
- The trackers blocked come from the **same source lists** (EasyList + EasyPrivacy
  + Blanc curation), even where the compiled form differs.

Everything below is *how* each platform delivers that — and the two places
(shield count fidelity, cosmetic depth) where the *observable* result legitimately
differs and therefore has its own divergence entry.

## The shared pipeline (S1) → three targets

One pipeline ingests the upstream lists once and emits per-platform artifacts,
versioned together and shipped over the same remote-config channel:

```
EasyList + EasyPrivacy + Blanc curation   (single source, versioned)
        │
        ├─ desktop : consumed by @ghostery/adblocker-electron (unchanged today)
        ├─ android : a normalized rule table (domain / type / third-party / action)
        └─ ios     : compiled WKContentRuleList JSON, split into N lists (see below)
```

The pipeline is where the iOS rule-cap curation happens (it must know the whole
corpus to prioritize), so it — not the app — owns the "what got dropped" decision
and logs it.

---

## iOS backend — `WKContentRuleList`

**Model:** declarative. Rules are a JSON array of `{ "trigger": {...}, "action":
{...} }` objects, compiled by `WKContentRuleListStore.compileContentRuleList(...)`
and attached to the web view's `WKUserContentController`. WebKit evaluates them
in-engine; the app is not in the request path. This is structurally
Manifest-V3-like — the exact constraint desktop Blanc was built to escape (D1).

### The rule cap and the multi-list strategy

A single compiled `WKContentRuleList` is bounded (on the order of ~150k rules,
WebKit-version-dependent). EasyList + EasyPrivacy exceed that. But **multiple
compiled lists can be attached to one web view**, so the pipeline:

1. Converts network filters to `{ "trigger": { "url-filter", "resource-type",
   "load-type": ["third-party"], "if-domain"/"unless-domain" }, "action":
   { "type": "block" } }` — `$domain=a.com|~b.com` maps to `if-domain`/
   `unless-domain`, each entry `*`-prefixed so it matches subdomains too, the
   way ABP's `$domain=` does.
2. **Partitions** into several lists each under the cap, ordered by value:
   network-blocking (ads, then tracking) first, cosmetic (`css-display-none`)
   last.
3. If the corpus exceeds the total practical budget, **drops lowest-value rules
   and logs exactly what was dropped** — no silent truncation (mirrors the spec's
   own no-silent-caps rule). The dropped set is a pipeline output, reviewable.

Compiled lists are cached by content hash in `WKContentRuleListStore` and only
recompiled when the source version changes (compilation is expensive; do it off
the launch path and reuse the cache — the desktop analogue is
`adblock-engine.v<N>.bin`).

### Per-site allow (D2) — the `ignore-previous-rules` list

Base lists stay static. The user allowlist (`adblockExceptions`) is a **separate,
small, dynamically recompiled list applied last**, whose rules are
`{ "trigger": { "url-filter": ".*", "if-domain": ["allowed.example"] },
"action": { "type": "ignore-previous-rules" } }`. Adding/removing a site
recompiles only this tiny list — not the corpus. This is the standard iOS
allowlist pattern and keeps the base lists cached.

> Cost note (D2): unlike desktop/Android's live predicate, an exception change
> means a (small) recompile + re-attach, not an instant in-memory flip. Still
> fast, but not free — budget for it.

### Cosmetic filtering (D14)

`{ "action": { "type": "css-display-none", "selector": "..." } }` covers static
element hiding declaratively — a **subset** of the desktop library's cosmetic
filtering. Procedural cosmetics (`:has`, scriptlets, JS-driven hiding) are **not
expressible** and are dropped. Documented limitation, not a bug.

### Shield count (D13) — the hard part

`WKContentRuleList` blocks **silently**: there is no delegate callback for "this
request was blocked by a content rule." So the exact per-tab blocked count that
the desktop shield shows **cannot be read directly on iOS.** Options, to decide:

- **(a)** Show a binary "protected / paused" state on iOS instead of a live count.
- **(b)** Approximate via a lightweight counting path (e.g. a parallel, sampling
  `WKURLSchemeHandler`/resource-load-stats heuristic) — approximate, never exact.

Recommended: **(a)** for honesty (an approximate number that disagrees with reality
is worse than no number). This is D13; the F12 shield-count acceptance step is
relaxed on iOS accordingly.

---

## Android backend — `WebView` + `shouldInterceptRequest`

**Model:** programmatic, and comparably powerful to desktop. A custom
`WebViewClient.shouldInterceptRequest(view, request)` fires for **every** resource
request (on a background thread) and returns either a blocking
`WebResourceResponse` (empty body) to block, or `null` to allow.

### Matching

Match `request.url` against the normalized rule table from S1 — full network-filter
semantics (host, resource type via `request.isForMainFrame()` + extension/header
hints, third-party by comparing to the document origin). **No rule cap** — the
whole corpus is usable, so Android tracks the same upstream as desktop.

Performance matters: `shouldInterceptRequest` is on the request hot path, so the
matcher must be O(1)-ish — a hostname trie + indexed rule lookup, built once when
the table loads, not a linear scan per request.

### Per-site allow (D2) — live predicate

Check the request's document origin against `adblockExceptions` **before** matching;
if allowed, return `null` immediately. Instant, in-memory, no recompile — same as
desktop.

### Cosmetic filtering (D14)

Android `WebView` has **no** cosmetic-filtering API. Mirror the desktop library's
effect manually: on `onPageStarted`/`onPageFinished`, inject the applicable
element-hiding CSS (and any scriptlets) via `evaluateJavascript`/`WebViewCompat`.
More capable than iOS's declarative `css-display-none` (can do procedural hiding),
but hand-rolled rather than library-driven.

### Shield count (D13) — accurate

Because interception is programmatic, **increment a per-tab counter on each block**
— exact, like desktop. Android has no shield-count caveat.

---

## Cross-platform summary

| Concern | Desktop (Ghostery) | Android (`shouldInterceptRequest`) | iOS (`WKContentRuleList`) |
|---|---|---|---|
| Model | programmatic (webRequest) | programmatic | declarative |
| Rule budget | unbounded | unbounded | ~150k/list, multi-list + curation (D1) |
| Corpus tracked | full | full | curated subset (D1) |
| Per-site allow | live predicate | live predicate | recompiled `ignore-previous-rules` list (D2) |
| Cosmetic | library (full) | injected CSS/JS (procedural) | `css-display-none` (static subset) (D14) |
| Shield count | exact | exact | not directly available → "protected" state (D13) |

## Acceptance mapping (F12)

- **F12-1 (shield count > 0):** desktop/Android assert the exact count; **iOS**
  relaxes to "protection is active" per D13.
- **F12-2 (allow-ads drops count + persists):** all platforms assert the persisted
  `adblockExceptions` and the user-visible effect; the *mechanism* differs (D2).
- **F12-3 (global toggle):** identical everywhere — toggling detaches/attaches the
  rule lists (iOS) / bypasses the interceptor (Android) / disables the session
  blocker (desktop).

## Decisions (closed 2026-07-07 — see roadmap §5)

Resolved in [the iOS port roadmap](../docs/superpowers/specs/2026-07-07-ios-port-roadmap-design.md) §5:

1. **D13 iOS shield UX** — **binary "protected / paused" state** (not an approximate
   count); F12-1 relaxed on iOS.
2. **iOS list partition scheme** — **by category, value-ordered** (network-block ads
   → tracking → cosmetic last), each list under the ~150k-rule ceiling; the pipeline
   logs the dropped set. Total budget pinned to the iOS 17 floor's WebKit ceiling,
   confirmed at M15.
3. **Cosmetic scope on mobile (D14)** — iOS **static `css-display-none` only**;
   procedural dropped. Android procedural-via-injection finalized when Android is built.
4. **Update cadence** — beta (M5) bundles the list in-app; the full pipeline (M15)
   pulls remote-config **daily + on launch** and **recompiles lazily on next launch**
   on version change (reuse the `WKContentRuleListStore` hash cache).

Beta (M5) ships a single bundled list; the full partition / exception / cosmetic /
remote-config machinery lands at M15.
