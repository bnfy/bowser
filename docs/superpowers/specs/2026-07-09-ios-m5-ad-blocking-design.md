# iOS M5: Minimal Ad-Blocking — Design Spec

> Milestone 5 of the [iOS port roadmap](2026-07-07-ios-port-roadmap-design.md).
> Maps to F12 (PARTIAL), D1, D13, D14. Builds on M0–M4.

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
      "url-filter": "<regex>"
    },
    "action": { "type": "block" }
  }
  ```
  Trigger fields are populated from the filter's `$`-options:
  - `$third-party` → `"load-type": ["third-party"]`
  - `$~third-party` → `"load-type": ["first-party"]`
  - No party option → `load-type` omitted (matches all).
  - `$image`, `$script`, `$stylesheet`, etc. → mapped to the corresponding
    `resource-type` values. No type option → `resource-type` omitted
    (matches all).
- Map filter syntax to `url-filter` regex: `||domain^` → domain anchor,
  `*` → `.*`, `^` → `[^a-zA-Z0-9_.%-]`, plain `|` anchors → `^`/`$`.
- **Exception rules** (`@@`) are converted to
  `{ "action": { "type": "ignore-previous-rules" } }` with the same
  trigger-mapping logic. The converter emits all block rules first, then
  all exception rules — `ignore-previous-rules` only overrides rules
  evaluated before it in the array, so ordering matters.
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

`blocklist.json` and `blocklist.meta.json` ship inside the app bundle. The
Xcode project gets a folder reference to `adblock/generated/` (relative path
`../../adblock/generated`, `lastKnownFileType = folder`) added to the root
PBXGroup and the app target's Resources build phase — same pattern as the
`pages/` folder reference from M4. At runtime, files are resolved via
`Bundle.main.url(forResource:withExtension:subdirectory:)` with subdirectory
`"generated"`.

## 2. Runtime — `ContentBlocker`

New file: `ios/Blanc/Blanc/ContentBlocker.swift`.

### 2.1 Lifecycle

```
App start
  → read blocklist.json + meta.json from Bundle.main
  → look up WKContentRuleListStore for identifier == meta.version (async)
  → if found: store it, attach to any waiting tabs
  → if not found: compile asynchronously, store on completion, attach
```

Both the lookup and compile paths are async (`WKContentRuleListStore`'s APIs
are callback-based), so the enqueue-and-attach-later path can fire on any
launch — not just the first. In practice the cache lookup returns fast enough
that tabs created after `init()` almost always find the rule list ready, but
the code must not assume synchrony.

`ContentBlocker` is `@Observable` but the compilation plumbing
(`WKContentRuleListStore`, the compiled `WKContentRuleList`, the pending-tabs
queue) is `@ObservationIgnored` — only `isReady: Bool` drives UI.

### 2.2 Attaching to tabs

`WebViewConfiguration.make` gains a `contentBlocker: ContentBlocker?`
parameter. If the blocker has a compiled rule list, it's added to the
config's `userContentController` immediately. If the lookup/compile is still
in flight, the tab's `WKWebView` is enqueued and the rule list attached on
completion via `webView.configuration.userContentController.add(ruleList)`.

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

## 4. Newtab `blockedThisWeek` — deferred under D13

The M4 spec listed "the blocked count at M5" as the milestone where
`start.data`'s `blockedThisWeek` becomes real. Under D13 (WKContentRuleList
blocks silently, no per-request callback), iOS has no way to count blocked
requests. The bridge keeps returning `blockedThisWeek: 0`, and the newtab
footer continues to read "0 ads blocked this week." This is the correct D13
behaviour — the footer is deferred until a counting mechanism is designed
(if ever; binary "protected" may be the permanent iOS answer per D13).

## 5. Parity matrix

`spec/parity-matrix.md`: F12 iOS → `PARTIAL`.

## 6. What M5 does NOT include

- **Toggle** (M6): `/block-ads`, settings switch, the "paused" shield state.
- **Per-site exceptions** (M15): `/allow-ads`, the `ignore-previous-rules`
  dynamic list, recompile-on-change.
- **Cosmetic rules** (M15, D14): `css-display-none` entries — iOS can only
  do static element hiding, and even that is deferred past M5.
- **Remote updates** (M15): the full S1 pipeline, daily pull, lazy recompile.
- **Multi-list partitioning** (M15): single list is sufficient at M5 because
  we're curating to well under 150k rules.
- **`adblock:check`** (M15): no desktop-drift guard yet — this substrate is
  iOS-only at M5.
- **Newtab blocked count** (deferred under D13): `blockedThisWeek` stays `0`;
  see §4.

## 7. Test plan

- **Converter** (`adblock/build.mjs`): run it; verify `blocklist.json` is
  valid JSON, rule count < 150k, meta version is a hex string, skipped-rule
  log is non-empty (proves cosmetic rules were dropped, not silently included).
- **ContentBlocker** (`BlancTests/ContentBlockerTests.swift`): unit tests for
  cache-hit vs. cache-miss paths, the enqueue/attach flow, and `isReady`
  state transitions.
- **Integration**: load a page with known ad resources in the simulator;
  verify they're blocked (network inspector shows no requests to ad domains).
  Manual, not automated at M5.
