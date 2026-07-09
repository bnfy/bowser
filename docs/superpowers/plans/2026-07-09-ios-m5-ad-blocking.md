# iOS M5: Minimal Ad-Blocking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single bundled WKContentRuleList that blocks ads on iOS, always on, with a binary "protected" shield icon on the pill.

**Architecture:** A Node converter (`adblock/build.mjs`) translates pinned EasyList + EasyPrivacy snapshots into WKContentRuleList JSON. At runtime, `ContentBlocker` compiles/caches the list via `WKContentRuleListStore` and attaches it to each tab's web view. The pill shows a shield icon when the blocker is ready.

**Tech Stack:** Node.js (converter), Swift/WebKit (runtime), SwiftUI (shield UI)

## Global Constraints

- iOS deployment target: 27.0 (Xcode 26).
- `@Observable` classes use `@ObservationIgnored` on non-UI-state properties.
- `me.bnfy.blanc` is the iOS bundle id — don't reconcile with desktop `me.bnfy.bowser`.
- Telemetry defaults opted-in (`usagePing: true` is intentional).
- Use CSS instead of hard-coded inline styles whenever possible.
- Never hand-edit `*/generated/*` files.
- The `pages` folder reference and `pages in Resources` build file already exist in `project.pbxproj` — the new `generated` folder reference follows the same pattern.
- Converter outputs are committed to `adblock/generated/` like other substrate artifacts.
- M5 option allowlist: party (`third-party`, `~third-party`), resource types (`image` → `image`, `script` → `script`, `stylesheet` → `style-sheet`, `font` → `font`, `media` → `media`, `popup` → `popup`). Everything else is skipped.
- Exception rules (`@@`) are emitted after all block rules — `ignore-previous-rules` only overrides rules evaluated before it in the array.
- Rule count hard gate: script exits non-zero if > 150,000 rules.
- `blockedThisWeek` stays `0` on iOS (D13 — WKContentRuleList blocks silently).

---

### Task 1: Converter — sources, script, and generated output

**Files:**
- Create: `adblock/sources/SOURCES.md`
- Create: `adblock/sources/pinned.json`
- Create: `adblock/sources/easylist.txt` (fetched snapshot)
- Create: `adblock/sources/easyprivacy.txt` (fetched snapshot)
- Create: `adblock/build.mjs`
- Create: `adblock/generated/blocklist.json` (generated)
- Create: `adblock/generated/blocklist.meta.json` (generated)
- Modify: `package.json` (add `adblock:build` script)

**Interfaces:**
- Consumes: nothing (standalone)
- Produces: `adblock/generated/blocklist.json` (JSON array of `{trigger, action}` objects), `adblock/generated/blocklist.meta.json` (`{version: string, ruleCount: number, sourceDate: string}`). Task 2 reads these from `Bundle.main` subdirectory `"generated"`.

- [ ] **Step 1: Create source directory with pinned filter lists**

```bash
mkdir -p adblock/sources adblock/generated
curl -L -o adblock/sources/easylist.txt https://easylist.to/easylist/easylist.txt
curl -L -o adblock/sources/easyprivacy.txt https://easylist.to/easylist/easyprivacy.txt
```

Create `adblock/sources/SOURCES.md`:

```markdown
# Filter List Sources

Pinned snapshots, committed verbatim. Run `npm run adblock:build` after updating.

| List | Upstream URL | Pinned |
|------|-------------|--------|
| EasyList | https://easylist.to/easylist/easylist.txt | 2026-07-09 |
| EasyPrivacy | https://easylist.to/easylist/easyprivacy.txt | 2026-07-09 |
```

Create `adblock/sources/pinned.json` (machine-readable date the converter reads
instead of `new Date()`, so `sourceDate` tracks the pin, not the build):

```json
{"date": "2026-07-09"}
```

- [ ] **Step 2: Write the converter script**

Create `adblock/build.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const SOURCES = path.join(ROOT, 'sources');
const OUT = path.join(ROOT, 'generated');
const MAX_RULES = 150_000;

const RESOURCE_TYPE_MAP = {
  image: 'image',
  script: 'script',
  stylesheet: 'style-sheet',
  font: 'font',
  media: 'media',
  popup: 'popup',
};

const SUPPORTED_OPTIONS = new Set([
  'third-party', '~third-party',
  ...Object.keys(RESOURCE_TYPE_MAP),
]);

const skipped = { cosmetic: 0, unsupported: 0, unparseable: 0, empty: 0, comment: 0 };

function parseFilter(raw) {
  let line = raw.trim();
  if (!line || line.startsWith('[')) { skipped.empty++; return null; }
  if (line.startsWith('!')) { skipped.comment++; return null; }
  if (/##|#@#|#\?#/.test(line)) { skipped.cosmetic++; return null; }

  let isException = false;
  if (line.startsWith('@@')) {
    isException = true;
    line = line.slice(2);
  }

  let pattern = line;
  let options = {};
  const dollarIdx = line.lastIndexOf('$');
  if (dollarIdx !== -1) {
    const optStr = line.slice(dollarIdx + 1);
    pattern = line.slice(0, dollarIdx);
    const opts = optStr.split(',');
    for (const opt of opts) {
      const o = opt.trim().toLowerCase();
      if (!SUPPORTED_OPTIONS.has(o)) {
        skipped.unsupported++;
        return null;
      }
      if (o === 'third-party') options.thirdParty = true;
      else if (o === '~third-party') options.firstParty = true;
      else if (RESOURCE_TYPE_MAP[o]) {
        options.resourceTypes = options.resourceTypes || [];
        options.resourceTypes.push(RESOURCE_TYPE_MAP[o]);
      }
    }
  }

  if (!pattern) { skipped.unparseable++; return null; }

  let urlFilter;
  try {
    urlFilter = patternToRegex(pattern);
  } catch {
    skipped.unparseable++;
    return null;
  }

  if (!urlFilter) { skipped.unparseable++; return null; }

  const trigger = { 'url-filter': urlFilter };
  if (options.thirdParty) trigger['load-type'] = ['third-party'];
  else if (options.firstParty) trigger['load-type'] = ['first-party'];
  if (options.resourceTypes?.length) trigger['resource-type'] = options.resourceTypes;

  return {
    rule: { trigger, action: { type: isException ? 'ignore-previous-rules' : 'block' } },
    isException,
  };
}

function patternToRegex(pattern) {
  let p = pattern;

  let prefix = '';
  let suffix = '';

  if (p.startsWith('||')) {
    prefix = '^[^:]+:(//)?([^/?#]*\\.)?';
    p = p.slice(2);
  } else if (p.startsWith('|')) {
    prefix = '^';
    p = p.slice(1);
  }

  if (p.endsWith('|')) {
    suffix = '$';
    p = p.slice(0, -1);
  }

  const escaped = p
    .replace(/[.+?{}()[\]\\]/g, '\\$&')
    .replace(/\^/g, '[^a-zA-Z0-9_.%-]')
    .replace(/\*/g, '.*');

  const result = prefix + escaped + suffix;
  if (!result) return null;

  new RegExp(result);
  return result;
}

const files = ['easylist.txt', 'easyprivacy.txt'];
const blockRules = [];
const exceptionRules = [];

for (const file of files) {
  const content = fs.readFileSync(path.join(SOURCES, file), 'utf8');
  for (const line of content.split('\n')) {
    const parsed = parseFilter(line);
    if (!parsed) continue;
    if (parsed.isException) exceptionRules.push(parsed.rule);
    else blockRules.push(parsed.rule);
  }
}

const rules = [...blockRules, ...exceptionRules];

console.log(`Block rules:     ${blockRules.length}`);
console.log(`Exception rules: ${exceptionRules.length}`);
console.log(`Total rules:     ${rules.length}`);
console.log(`Skipped:`);
console.log(`  Cosmetic:      ${skipped.cosmetic}`);
console.log(`  Unsupported:   ${skipped.unsupported}`);
console.log(`  Unparseable:   ${skipped.unparseable}`);
console.log(`  Comments:      ${skipped.comment}`);
console.log(`  Empty/header:  ${skipped.empty}`);

if (rules.length > MAX_RULES) {
  console.error(`FATAL: ${rules.length} rules exceeds the ${MAX_RULES} ceiling.`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const json = JSON.stringify(rules, null, 2);
fs.writeFileSync(path.join(OUT, 'blocklist.json'), json);

const pinned = JSON.parse(fs.readFileSync(path.join(SOURCES, 'pinned.json'), 'utf8'));

const hash = createHash('sha256').update(json).digest('hex').slice(0, 8);
const meta = {
  version: hash,
  ruleCount: rules.length,
  sourceDate: pinned.date,
};
fs.writeFileSync(path.join(OUT, 'blocklist.meta.json'), JSON.stringify(meta, null, 2));

console.log(`\nWrote ${rules.length} rules to generated/blocklist.json (version: ${hash})`);
```

- [ ] **Step 3: Add npm script**

In `package.json`, add to `"scripts"`:

```json
"adblock:build": "node adblock/build.mjs"
```

- [ ] **Step 4: Run the converter and verify output**

```bash
npm run adblock:build
```

Expected: stdout shows block/exception/skipped counts. `skipped.cosmetic` > 0 (proves cosmetic rules were dropped). Total rules < 150,000. Files `adblock/generated/blocklist.json` and `adblock/generated/blocklist.meta.json` exist.

Verify:

```bash
node -e "const j=require('./adblock/generated/blocklist.json'); console.log('valid JSON, rules:', j.length)"
node -e "const m=require('./adblock/generated/blocklist.meta.json'); console.log(m); if(!/^[0-9a-f]{8}$/.test(m.version)) process.exit(1)"
```

- [ ] **Step 5: Commit**

```bash
git add adblock/ package.json
git commit -m "feat(ios): M5 ad-block converter — EasyList/EasyPrivacy → WKContentRuleList JSON"
```

---

### Task 2: ContentBlocker runtime + test seam + unit tests

**Files:**
- Create: `ios/Blanc/Blanc/ContentBlocker.swift`
- Create: `ios/Blanc/BlancTests/ContentBlockerTests.swift`
- Modify: `ios/Blanc/Blanc/TabsManager.swift:4-32`
- Modify: `ios/Blanc/Blanc.xcodeproj/project.pbxproj` (add `generated` folder reference)

**Interfaces:**
- Consumes: `adblock/generated/blocklist.json` and `blocklist.meta.json` from the app bundle (subdirectory `"generated"`). `TabsManager.createTab` (existing) — calls `contentBlocker.attach(to: tab.webView)` after `TabModel` construction. `WebViewConfiguration.make` (existing, unchanged).
- Produces: `ContentBlocker` class with `prepare(version:jsonString:)`, `attach(to:)`, `isReady: Bool`. `RuleListStoring` protocol, `RuleListAttaching` protocol (both in `ContentBlocker.swift`). Task 3 reads `contentBlocker.isReady` from `TabsManager`.

- [ ] **Step 1: Add `generated` folder reference to pbxproj**

This must happen before unit tests, because the integration compile test
reads `blocklist.json` from `Bundle.main`. Four edits to
`ios/Blanc/Blanc.xcodeproj/project.pbxproj`, following the exact pattern of
the existing `pages` folder reference:

**Edit 1** — add a PBXBuildFile entry in the `PBXBuildFile` section, after the `pages in Resources` line:

```
		502D58422FFED0A000B5B1DE /* generated in Resources */ = {isa = PBXBuildFile; fileRef = 502D58432FFED0A000B5B1DE /* generated */; };
```

**Edit 2** — add a PBXFileReference entry in the `PBXFileReference` section, after the `pages` line:

```
		502D58432FFED0A000B5B1DE /* generated */ = {isa = PBXFileReference; lastKnownFileType = folder; name = generated; path = ../../adblock/generated; sourceTree = "<group>"; };
```

**Edit 3** — add the file reference to the root PBXGroup's children array (after the `pages` entry):

```
				502D58432FFED0A000B5B1DE /* generated */,
```

**Edit 4** — add the build file to the Blanc target's Resources build phase files array (after `pages in Resources`):

```
				502D58422FFED0A000B5B1DE /* generated in Resources */,
```

- [ ] **Step 2: Write unit tests**

Create `ios/Blanc/BlancTests/ContentBlockerTests.swift`:

```swift
import XCTest
@testable import Blanc

final class ContentBlockerTests: XCTestCase {

    // MARK: - Fakes

    final class FakeRuleListStore: RuleListStoring {
        var lookupResult: Bool = false
        var compileResult: Bool = true
        private var lookupCallback: ((Bool) -> Void)?
        private var compileCallback: ((Bool) -> Void)?

        func lookupRuleList(
            forIdentifier identifier: String,
            found: @escaping (Bool) -> Void
        ) {
            if lookupResult {
                found(true)
            } else {
                lookupCallback = found
            }
        }

        func compileRuleList(
            forIdentifier identifier: String,
            encodedContentRuleList: String,
            completed: @escaping (Bool) -> Void
        ) {
            if compileResult {
                completed(true)
            } else {
                compileCallback = completed
            }
        }

        func flushCompile() {
            compileCallback?(true)
            compileCallback = nil
        }

        func flushLookup(found: Bool) {
            lookupCallback?(found)
            lookupCallback = nil
        }
    }

    final class FakeAttachTarget: RuleListAttaching {
        var attachCount = 0
        func attachContentBlockingRules(from blocker: ContentBlocker) {
            attachCount += 1
        }
    }

    // MARK: - Tests

    func testCacheHitSetsReady() {
        let store = FakeRuleListStore()
        store.lookupResult = true
        let blocker = ContentBlocker(store: store)
        blocker.prepare(version: "abc", jsonString: "[]")

        XCTAssertTrue(blocker.isReady)
    }

    func testCacheMissSetsReadyAfterCompile() {
        let store = FakeRuleListStore()
        store.lookupResult = false
        store.compileResult = false
        let blocker = ContentBlocker(store: store)
        blocker.prepare(version: "abc", jsonString: "[]")

        XCTAssertFalse(blocker.isReady)

        store.flushLookup(found: false)
        XCTAssertFalse(blocker.isReady)

        store.flushCompile()
        XCTAssertTrue(blocker.isReady)
    }

    func testAttachImmediatelyWhenReady() {
        let store = FakeRuleListStore()
        store.lookupResult = true
        let blocker = ContentBlocker(store: store)
        blocker.prepare(version: "abc", jsonString: "[]")

        let target = FakeAttachTarget()
        blocker.attach(to: target)

        XCTAssertEqual(target.attachCount, 1)
    }

    func testAttachEnqueuesAndDrainsAfterCompile() {
        let store = FakeRuleListStore()
        store.lookupResult = false
        store.compileResult = false
        let blocker = ContentBlocker(store: store)
        blocker.prepare(version: "abc", jsonString: "[]")

        let target1 = FakeAttachTarget()
        let target2 = FakeAttachTarget()
        blocker.attach(to: target1)
        blocker.attach(to: target2)

        XCTAssertEqual(target1.attachCount, 0)
        XCTAssertEqual(target2.attachCount, 0)

        store.flushLookup(found: false)
        store.flushCompile()

        XCTAssertEqual(target1.attachCount, 1)
        XCTAssertEqual(target2.attachCount, 1)
    }

    func testAttachAfterReadyDoesNotEnqueue() {
        let store = FakeRuleListStore()
        store.lookupResult = true
        let blocker = ContentBlocker(store: store)
        blocker.prepare(version: "abc", jsonString: "[]")

        let target = FakeAttachTarget()
        blocker.attach(to: target)
        blocker.attach(to: target)

        XCTAssertEqual(target.attachCount, 2)
    }
}
```

- [ ] **Step 3: Verify tests fail to compile**

```bash
cd ios/Blanc && xcodebuild test \
  -scheme Blanc \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing BlancTests/ContentBlockerTests \
  2>&1 | tail -20
```

Expected: compile error — `RuleListStoring`, `RuleListAttaching`, `ContentBlocker` not found.

- [ ] **Step 4: Write ContentBlocker implementation**

Create `ios/Blanc/Blanc/ContentBlocker.swift`:

```swift
import Foundation
import Observation
import WebKit

protocol RuleListStoring {
    func lookupRuleList(
        forIdentifier identifier: String,
        found: @escaping (Bool) -> Void
    )
    func compileRuleList(
        forIdentifier identifier: String,
        encodedContentRuleList: String,
        completed: @escaping (Bool) -> Void
    )
}

protocol RuleListAttaching: AnyObject {
    func attachContentBlockingRules(from blocker: ContentBlocker)
}

extension WKWebView: RuleListAttaching {
    func attachContentBlockingRules(from blocker: ContentBlocker) {
        guard let ruleList = blocker.compiledRuleList else { return }
        configuration.userContentController.add(ruleList)
    }
}

final class WKRuleListStoreAdapter: RuleListStoring {
    private let store = WKContentRuleListStore.default()
    weak var blocker: ContentBlocker?

    func lookupRuleList(
        forIdentifier identifier: String,
        found: @escaping (Bool) -> Void
    ) {
        store?.lookUpContentRuleList(forIdentifier: identifier) { [weak self] ruleList, _ in
            if let ruleList {
                self?.blocker?.compiledRuleList = ruleList
                found(true)
            } else {
                found(false)
            }
        }
    }

    func compileRuleList(
        forIdentifier identifier: String,
        encodedContentRuleList: String,
        completed: @escaping (Bool) -> Void
    ) {
        store?.compileContentRuleList(
            forIdentifier: identifier,
            encodedContentRuleList: encodedContentRuleList
        ) { [weak self] ruleList, error in
            if let ruleList {
                self?.blocker?.compiledRuleList = ruleList
                completed(true)
            } else {
                if let error { print("ContentBlocker compile error: \(error)") }
                completed(false)
            }
        }
    }
}

@Observable
final class ContentBlocker {
    var isReady = false

    @ObservationIgnored var compiledRuleList: WKContentRuleList?
    @ObservationIgnored private let store: RuleListStoring
    @ObservationIgnored private var pendingTargets: [RuleListAttaching] = []

    init(store: RuleListStoring = WKRuleListStoreAdapter()) {
        self.store = store
        if let adapter = store as? WKRuleListStoreAdapter {
            adapter.blocker = self
        }
    }

    static func loadBundledBlocklist() -> (version: String, json: String)? {
        guard let metaURL = Bundle.main.url(
            forResource: "blocklist.meta",
            withExtension: "json",
            subdirectory: "generated"
        ) else { return nil }

        guard let metaData = try? Data(contentsOf: metaURL),
              let meta = try? JSONSerialization.jsonObject(with: metaData) as? [String: Any],
              let version = meta["version"] as? String else { return nil }

        guard let jsonURL = Bundle.main.url(
            forResource: "blocklist",
            withExtension: "json",
            subdirectory: "generated"
        ) else { return nil }

        guard let json = try? String(contentsOf: jsonURL, encoding: .utf8) else { return nil }

        return (version, json)
    }

    func prepare(version: String, jsonString: String) {
        store.lookupRuleList(forIdentifier: version) { [weak self] found in
            guard let self else { return }
            if found {
                self.isReady = true
                self.drainPending()
            } else {
                self.compile(version: version, jsonString: jsonString)
            }
        }
    }

    func attach(to target: RuleListAttaching) {
        if isReady {
            target.attachContentBlockingRules(from: self)
        } else {
            pendingTargets.append(target)
        }
    }

    private func compile(version: String, jsonString: String) {
        store.compileRuleList(
            forIdentifier: version,
            encodedContentRuleList: jsonString
        ) { [weak self] success in
            guard let self, success else { return }
            self.isReady = true
            self.drainPending()
        }
    }

    private func drainPending() {
        let targets = pendingTargets
        pendingTargets.removeAll()
        for target in targets {
            target.attachContentBlockingRules(from: self)
        }
    }
}
```

- [ ] **Step 5: Run unit tests and verify they pass**

```bash
cd ios/Blanc && xcodebuild test \
  -scheme Blanc \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing BlancTests/ContentBlockerTests \
  2>&1 | tail -30
```

Expected: all 5 tests pass. Unit tests use `FakeRuleListStore` and
`FakeAttachTarget` — no bundle resources needed, no opaque
`WKContentRuleList` needed.

- [ ] **Step 6: Write the integration compile test**

Add to `ios/Blanc/BlancTests/ContentBlockerTests.swift`:

```swift
func testBundledBlocklistCompilesInWebKit() {
    let expectation = expectation(description: "WKContentRuleList compiles")

    guard let loaded = ContentBlocker.loadBundledBlocklist() else {
        XCTFail("blocklist.json or blocklist.meta.json not found in bundle")
        return
    }

    WKContentRuleListStore.default()?.compileContentRuleList(
        forIdentifier: "integration-test-\(loaded.version)",
        encodedContentRuleList: loaded.json
    ) { ruleList, error in
        XCTAssertNotNil(ruleList, "Compile failed: \(error?.localizedDescription ?? "unknown")")
        expectation.fulfill()
    }

    waitForExpectations(timeout: 30)
}
```

- [ ] **Step 7: Wire ContentBlocker into TabsManager**

Modify `ios/Blanc/Blanc/TabsManager.swift`. Add the `contentBlocker`
property alongside the existing `schemeHandler` and `bridge`, load the
bundled blocklist and call `prepare(version:jsonString:)` in `init()`, and
call `attach(to:)` after tab construction:

```swift
import Observation
import Foundation

@Observable
final class TabsManager {
    private(set) var tabs: [TabModel] = []
    var activeTabId: UUID?

    let normalizer = AddressNormalizer(searchEngine: BlancSettingsDefaults.searchEngine)

    @ObservationIgnored private let schemeHandler = BlancSchemeHandler()
    @ObservationIgnored private lazy var bridge = PagesBridge(manager: self)
    @ObservationIgnored private let contentBlocker = ContentBlocker()

    static let newTabURL = URL(string: "blanc://newtab/")!

    var activeTab: TabModel? {
        guard let activeTabId else { return nil }
        return tabs.first { $0.id == activeTabId }
    }

    init() {
        if let loaded = ContentBlocker.loadBundledBlocklist() {
            contentBlocker.prepare(version: loaded.version, jsonString: loaded.json)
        }
        createTab()
    }

    @discardableResult
    func createTab(url: URL = TabsManager.newTabURL) -> UUID {
        let config = WebViewConfiguration.make(schemeHandler: schemeHandler, bridge: bridge)
        let tab = TabModel(url: url, configuration: config)
        contentBlocker.attach(to: tab.webView)
        tabs.append(tab)
        activeTabId = tab.id
        return tab.id
    }

    func closeTab(_ id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let wasActive = id == activeTabId
        tabs.remove(at: index)

        if tabs.isEmpty {
            createTab()
            return
        }

        if wasActive {
            let nextIndex = min(index, tabs.count - 1)
            activeTabId = tabs[nextIndex].id
        }
    }

    func setActive(_ id: UUID) {
        guard tabs.contains(where: { $0.id == id }) else { return }
        activeTabId = id
    }

    func submitActiveTabAddress() {
        activeTab?.submitAddress(using: normalizer)
    }
}
```

- [ ] **Step 8: Run all tests to verify nothing is broken**

```bash
cd ios/Blanc && xcodebuild test \
  -scheme Blanc \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  2>&1 | grep -E '(Test Suite|Test Case|Executed|error:)'
```

Expected: all existing M0–M4 tests + new ContentBlocker tests pass. The
integration test (`testBundledBlocklistCompilesInWebKit`) compiles the real
bundled JSON and confirms WebKit accepts it.

- [ ] **Step 9: Commit**

```bash
git add ios/Blanc/Blanc/ContentBlocker.swift \
        ios/Blanc/BlancTests/ContentBlockerTests.swift \
        ios/Blanc/Blanc/TabsManager.swift \
        ios/Blanc/Blanc.xcodeproj/project.pbxproj
git commit -m "feat(ios): M5 ContentBlocker — compile, cache, attach WKContentRuleList"
```

---

### Task 3: Shield UI on the pill + parity matrix

**Files:**
- Modify: `ios/Blanc/Blanc/ContentView.swift:25-61`
- Modify: `spec/parity-matrix.md:27`

**Interfaces:**
- Consumes: `ContentBlocker.isReady` (from Task 2, via `TabsManager.contentBlocker`). `TabsManager` (existing) — needs to expose `contentBlocker.isReady` to the view.
- Produces: shield icon visible on the pill when the blocker is ready.

- [ ] **Step 1: Expose blocker readiness from TabsManager**

The `contentBlocker` property on `TabsManager` is currently `private`. Make it accessible to `ContentView` by adding a computed property. Add this to `ios/Blanc/Blanc/TabsManager.swift` after the `activeTab` computed property:

```swift
var isAdBlockReady: Bool {
    contentBlocker.isReady
}
```

- [ ] **Step 2: Add shield icon to the pill**

Modify the `addressPill` in `ios/Blanc/Blanc/ContentView.swift`. Add the shield icon between the domain text and the `Spacer`:

```swift
private var addressPill: some View {
    HStack(spacing: 10) {
        Button { showPalette = true } label: {
            HStack(spacing: 8) {
                tabDots

                Text(displayDomain)
                    .lineLimit(1)
                    .foregroundStyle(.primary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open palette")

        if manager.isAdBlockReady {
            Image(systemName: "shield.checkmark")
                .foregroundStyle(.primary)
                .font(.footnote)
                .accessibilityLabel("Ad blocking active")
        }

        Spacer(minLength: 0)

        Button {
            if manager.activeTab?.isLoading == true {
                manager.activeTab?.stop()
            } else {
                manager.activeTab?.reload()
            }
        } label: {
            Image(systemName:
                manager.activeTab?.isLoading == true ? "xmark" : "arrow.clockwise")
        }

        Button { manager.createTab() } label: {
            Image(systemName: "plus")
        }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .modifier(PillStyle())
    .padding(.horizontal, 12)
    .padding(.bottom, 8)
}
```

- [ ] **Step 3: Update parity matrix**

In `spec/parity-matrix.md`, change the F12 row's iOS column from `PLANNED` to `PARTIAL`:

```
| F12 | Ad/tracker blocking | SHIPPED | PARTIAL | PLANNED | ...
```

- [ ] **Step 4: Build and run in the simulator**

```bash
cd ios/Blanc && xcodebuild build \
  -scheme Blanc \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  2>&1 | tail -5
```

Expected: `BUILD SUCCEEDED`. Launch in the simulator and verify:
- The pill shows a shield.checkmark icon after the domain text.
- The newtab page loads normally (the bridge still returns `blockedThisWeek: 0`).
- Navigating to a real page with ads (e.g. a news site) loads with ad requests blocked.

- [ ] **Step 5: Run all tests**

```bash
cd ios/Blanc && xcodebuild test \
  -scheme Blanc \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  2>&1 | grep -E '(Test Suite|Test Case|Executed|error:)'
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add ios/Blanc/Blanc/ContentView.swift \
        ios/Blanc/Blanc/TabsManager.swift \
        spec/parity-matrix.md
git commit -m "feat(ios): M5 shield icon on pill + F12 parity PARTIAL"
```
