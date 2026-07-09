# iOS M5: Minimal Ad-Blocking — Design Spec

> Milestone 5 of the [iOS port roadmap](2026-07-07-ios-port-roadmap-design.md).
> Maps to F12 (PARTIAL), D1, D13. Builds on M0–M4.

## Goal

Ship the smallest thing that blocks ads on iOS: a single bundled
WKContentRuleList compiled from a curated EasyList + EasyPrivacy snapshot,
always on, with a binary "protected" shield on the pill. No toggle, no
per-site exceptions, no cosmetic rules, no remote updates — those are M6/M15.

## 1. Converter (`adblock/`)

A new repo-root directory mirroring the `tokens/`/`copy/` substrate pattern.

### 1.1 Sources

`adblock/sources/` contains pinned snapshots of EasyList (`easylist.txt`) and
EasyPrivacy (`easyprivacy.txt`), committed verbatim. A `SOURCES.md` records the
upstream URLs and the date pinned.

### 1.2 `adblock/build.mjs`

Node script. `npm run adblock:build` runs it.

**Input:** reads both filter lists from `adblock/sources/`.

**Processing:** for each line:
- Skip comments (`!`), cosmetic rules (`##`, `#@#`, `#?#`), empty lines.
- Skip rules with `$`-options that have no WKContentRuleList equivalent
  (e.g. `$csp`, `$redirect`, `$removeparam`, `$replace`).
- Convert supported network filters to a WKContentRuleList entry:
  ```json
  {
    "trigger": {
      "url-filter": "<regex>",
      "load-type": ["third-party"],
      "resource-type": ["image", "style-sheet", "script", "raw"]
    },
    "action": { "type": "block" }
  }
  ```
- Map filter syntax to `url-filter` regex: `||domain^` → domain anchor,
  `*` → `.*`, `^` → `[^a-zA-Z0-9_.%-]`, plain `|` anchors → `^`/`$`.
  Exception rules (`@@`) are converted to `{ "action": { "type": "ignore-previous-rules" } }`.
- Track and log skipped rules by reason (cosmetic, unsupported option,
  unparseable). No silent truncation.

**Output:**
- `adblock/generated/blocklist.json` — the JSON array of trigger/action
  objects. Committed, never hand-edited.
- `adblock/generated/blocklist.meta.json` — `{ "version": "<sha256-first-8>",
  "ruleCount": <n>, "sourceDate": "<ISO date>" }`. The `version` string becomes
  the `WKContentRuleListStore` identifier for cache invalidation.

The script exits non-zero if the resulting rule count exceeds 150,000 (the
conservative WKContentRuleList ceiling) — a hard gate, not a warning.

### 1.3 Bundling

`blocklist.json` ships inside the app bundle. The Xcode project gets a folder
reference to `adblock/generated/` in the Resources build phase, same pattern
as the `pages/` folder reference from M4.

## 2. Runtime — `ContentBlocker`

New file: `ios/Blanc/Blanc/ContentBlocker.swift`.

### 2.1 Lifecycle

```
App start
  → read blocklist.json + meta.json from Bundle.main
  → check WKContentRuleListStore for identifier == meta.version
  → if cached: store it, attach to any existing tabs
  → if not cached: compile asynchronously, store on completion, attach
```

`ContentBlocker` is `@Observable` but the compilation plumbing
(`WKContentRuleListStore`, the compiled `WKContentRuleList`, the pending-tabs
queue) is `@ObservationIgnored` — only `isReady: Bool` drives UI.

### 2.2 Attaching to tabs

`WebViewConfiguration.make` gains a `contentBlocker: ContentBlocker?`
parameter. If the blocker has a compiled rule list, it's added to the
config's `userContentController` immediately. If compilation is still in
flight, the tab is enqueued and the rule list attached on completion via
`webView.configuration.userContentController.add(ruleList)`.

The enqueue path is safe: on first launch the only tab is `blanc://newtab`,
which has no ads to miss. On subsequent launches the cache hit is synchronous
and no enqueuing happens.

### 2.3 Ownership

`TabsManager` owns the single `ContentBlocker` instance (same pattern as
`schemeHandler` and `bridge`). `ContentBlocker.prepare()` is called in
`TabsManager.init()`. The blocker is passed through `WebViewConfiguration.make`
on every `createTab`.

## 3. Shield UI

### 3.1 Pill

`ContentView`'s pill gains a shield icon between the domain text and the
action cluster:

- **Protected** (blocker ready, blocking active): SF Symbol
  `shield.checkmark`, primary color.
- **Not ready** (compilation in flight): no icon shown. This state lasts < 1s
  on cached launches; on first launch it's a few seconds.

No count, no "paused" state at M5 — the blocker is always on, there's no
toggle yet.

### 3.2 Accessibility

The shield icon gets `.accessibilityLabel("Ad blocking active")`.

## 4. Parity matrix

`spec/parity-matrix.md`: F12 iOS → `PARTIAL`.

## 5. What M5 does NOT include

- **Toggle** (M6): `/block-ads`, settings switch, the "paused" shield state.
- **Per-site exceptions** (M15): `/allow-ads`, the `ignore-previous-rules`
  dynamic list, recompile-on-change.
- **Cosmetic rules** (M15): `css-display-none` entries.
- **Remote updates** (M15): the full S1 pipeline, daily pull, lazy recompile.
- **Multi-list partitioning** (M15): single list is sufficient at M5 because
  we're curating to well under 150k rules.
- **`adblock:check`** (M15): no desktop-drift guard yet — this substrate is
  iOS-only at M5.

## 6. Test plan

- **Converter** (`adblock/build.mjs`): run it; verify `blocklist.json` is
  valid JSON, rule count < 150k, meta version is a hex string, skipped-rule
  log is non-empty (proves cosmetic rules were dropped, not silently included).
- **ContentBlocker** (`BlancTests/ContentBlockerTests.swift`): unit tests for
  cache-hit vs. cache-miss paths, the enqueue/attach flow, and `isReady`
  state transitions.
- **Integration**: load a page with known ad resources in the simulator;
  verify they're blocked (network inspector shows no requests to ad domains).
  Manual, not automated at M5.
