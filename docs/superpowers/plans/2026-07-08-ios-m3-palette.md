# iOS M3: Island Palette & Quick Switcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the M2 interactive address pill + standalone tab-list sheet with a display-only pill that opens a half-sheet palette (combined address bar, tab switcher, slash commands, Quick Switcher).

**Architecture:** Three new files, each with a single responsibility: `QuickSwitcher.swift` (pure matching logic, no UI), `SlashCommand.swift` (command model referencing the generated `.strings` copy), `PaletteSheet.swift` (the half-sheet view that composes them). `ContentView.swift` is rewritten to a display-only pill with Liquid Glass; `TabListSheet.swift` is deleted. `TabModel.swift` gains one line to enable edge-swipe back/forward gestures.

**Tech Stack:** SwiftUI, `@Observable` (iOS 17+), `WKWebView`, `NSLocalizedString`, `#available(iOS 26, *)` for `.glassEffect`

## Global Constraints

- Deployment target: iOS 17. Any iOS 26+ API must be gated with `#available(iOS 26, *)`.
- Generated files (`Tokens.swift`, `BlancSettings.swift`, `copy/generated/SlashCommands.strings`) are never hand-edited — consume as-is.
- Slash-command hints come from `SlashCommands.strings` via `NSLocalizedString`, not hardcoded strings.
- No UI tests. Unit tests for pure logic; visual verification on simulator.
- The project uses Xcode 26 with filesystem-synchronized groups — new `.swift` files dropped into `ios/Blanc/Blanc/` or `ios/Blanc/BlancTests/` are auto-included in their target.

---

### Task 1: QuickSwitcher — matching logic + tests

**Files:**
- Create: `ios/Blanc/Blanc/QuickSwitcher.swift`
- Create: `ios/Blanc/BlancTests/QuickSwitcherTests.swift`

**Interfaces:**
- Consumes: `TabModel` (reads `id`, `pageTitle`, `currentURL`)
- Produces: `QuickSwitcher.search(query:tabs:) -> [SwitcherResult]`, `QuickSwitcher.strongMatchScore` (used by Task 3's submit handler)

- [ ] **Step 1: Write the tests**

Create `ios/Blanc/BlancTests/QuickSwitcherTests.swift`:

```swift
import XCTest
@testable import Blanc

final class QuickSwitcherTests: XCTestCase {
    private func makeTab(title: String, url: String) -> TabModel {
        let tab = TabModel(url: URL(string: url)!)
        tab.pageTitle = title
        return tab
    }

    func testSubstringMatchScores2PlusKindBonus() {
        let tab = makeTab(title: "Gmail", url: "https://mail.google.com/inbox")
        let results = QuickSwitcher.search(query: "gmail", tabs: [tab])
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].score, 2.2)
    }

    func testInOrderMatchScores1PlusKindBonus() {
        let tab = makeTab(title: "Gmail", url: "https://mail.google.com/inbox")
        let results = QuickSwitcher.search(query: "gml", tabs: [tab])
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].score, 1.2)
    }

    func testNoMatchExcluded() {
        let tab = makeTab(title: "Gmail", url: "https://mail.google.com")
        let results = QuickSwitcher.search(query: "xyz123", tabs: [tab])
        XCTAssertTrue(results.isEmpty)
    }

    func testCaseInsensitive() {
        let tab = makeTab(title: "GitHub", url: "https://github.com")
        let results = QuickSwitcher.search(query: "GITHUB", tabs: [tab])
        XCTAssertEqual(results.count, 1)
    }

    func testMatchableTextStripsQueryString() {
        let text = QuickSwitcher.matchableText(
            title: "OAuth",
            url: URL(string: "https://accounts.google.com/o/oauth2?token=abc123xyz")!
        )
        XCTAssertFalse(text.contains("abc123xyz"))
        XCTAssertTrue(text.contains("accounts.google.com"))
    }

    func testStrongMatchBeatsWeak() {
        let strong = makeTab(title: "gmail inbox", url: "https://gmail.com")
        let weak = makeTab(title: "game library", url: "https://games.example.com")
        // "gmail" is a substring of "gmail inbox" → score 2.2
        // "gmail" in-order matches "game library" (g...a...m...l...) → score 1.2
        let results = QuickSwitcher.search(query: "gmail", tabs: [weak, strong])
        XCTAssertEqual(results[0].tab.id, strong.id)
    }

    func testEqualScorePreservesTabOrder() {
        let first = makeTab(title: "game library", url: "https://games.example.com")
        let second = makeTab(title: "good morning list", url: "https://gml.example.com")
        // Both in-order match "gml" → score 1.2 each; first wins by tab position
        let results = QuickSwitcher.search(query: "gml", tabs: [first, second])
        XCTAssertEqual(results[0].tab.id, first.id)
        XCTAssertEqual(results[1].tab.id, second.id)
    }

    func testCapAt6() {
        let tabs = (0..<10).map { makeTab(title: "Tab \($0)", url: "https://tab\($0).test") }
        let results = QuickSwitcher.search(query: "tab", tabs: tabs)
        XCTAssertEqual(results.count, 6)
    }

    func testDedupByTabId() {
        let tab = makeTab(title: "test", url: "https://test.com")
        let results = QuickSwitcher.search(query: "test", tabs: [tab, tab])
        XCTAssertEqual(results.count, 1)
    }

    func testEmptyQueryReturnsEmpty() {
        let tab = makeTab(title: "test", url: "https://test.com")
        let results = QuickSwitcher.search(query: "", tabs: [tab])
        XCTAssertTrue(results.isEmpty)
    }
}
```

- [ ] **Step 2: Verify tests fail**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 16' -only-testing:BlancTests/QuickSwitcherTests 2>&1 | tail -20`

Expected: build failure — `QuickSwitcher` not found.

- [ ] **Step 3: Implement QuickSwitcher**

Create `ios/Blanc/Blanc/QuickSwitcher.swift`:

```swift
import Foundation

struct SwitcherResult {
    let tab: TabModel
    let score: Double
    let index: Int
    let title: String
    let subtitle: String
}

enum QuickSwitcher {
    static let strongMatchScore: Double = 2.0

    static func search(query: String, tabs: [TabModel]) -> [SwitcherResult] {
        let q = query.lowercased()
        guard !q.isEmpty else { return [] }

        var results: [SwitcherResult] = []
        var seen = Set<UUID>()

        for (index, tab) in tabs.enumerated() {
            guard !seen.contains(tab.id) else { continue }
            let text = matchableText(title: tab.pageTitle, url: tab.currentURL)
            let s = matchScore(query: q, text: text)
            guard s > 0 else { continue }
            seen.insert(tab.id)
            results.append(SwitcherResult(
                tab: tab,
                score: s + 0.2,
                index: index,
                title: tab.pageTitle.isEmpty ? "New Tab" : tab.pageTitle,
                subtitle: tab.currentURL.host ?? tab.currentURL.absoluteString
            ))
        }

        return Array(results
            .sorted { $0.score != $1.score ? $0.score > $1.score : $0.index < $1.index }
            .prefix(6))
    }

    static func matchScore(query: String, text: String) -> Double {
        let t = text.lowercased()
        if t.contains(query) { return 2 }
        var qi = query.startIndex
        for ch in t {
            if ch == query[qi] {
                qi = query.index(after: qi)
                if qi == query.endIndex { return 1 }
            }
        }
        return 0
    }

    static func matchableText(title: String, url: URL) -> String {
        let host = url.host ?? ""
        let path = String(url.path.prefix(64))
        return "\(title) \(host)\(path)"
    }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 16' -only-testing:BlancTests/QuickSwitcherTests 2>&1 | tail -20`

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add ios/Blanc/Blanc/QuickSwitcher.swift ios/Blanc/BlancTests/QuickSwitcherTests.swift
git commit -m "ios: add QuickSwitcher matching logic with tests"
```

---

### Task 2: SlashCommand — command model + copy integration + tests

**Files:**
- Symlink: `ios/Blanc/Blanc/SlashCommands.strings` → `copy/generated/SlashCommands.strings`
- Create: `ios/Blanc/Blanc/SlashCommand.swift`
- Create: `ios/Blanc/BlancTests/SlashCommandTests.swift`

**Interfaces:**
- Consumes: `TabsManager` (passed to `execute` closures: `createTab()`, `closeTab(_:)`, `activeTabId`)
- Produces: `SlashCommand.available: [SlashCommand]`, `SlashCommand.filter(prefix:) -> [SlashCommand]`

- [ ] **Step 1: Symlink the generated strings file into the iOS project**

```bash
ln -s ../../../copy/generated/SlashCommands.strings ios/Blanc/Blanc/SlashCommands.strings
```

A symlink, not a copy — the single source of truth stays in
`copy/generated/` where `copy/build.mjs` writes it. Xcode 26's
filesystem-synchronized groups auto-include the symlink target in the app
bundle as a resource. Verify:

```bash
ls -la ios/Blanc/Blanc/SlashCommands.strings
```

Expected: symlink pointing to `../../../copy/generated/SlashCommands.strings`.

- [ ] **Step 2: Write the tests**

Create `ios/Blanc/BlancTests/SlashCommandTests.swift`:

```swift
import XCTest
@testable import Blanc

final class SlashCommandTests: XCTestCase {
    func testAvailableContainsNewAndClose() {
        let names = SlashCommand.available.map(\.command)
        XCTAssertTrue(names.contains("/new"))
        XCTAssertTrue(names.contains("/close"))
    }

    func testAvailableCountIsTwo() {
        XCTAssertEqual(SlashCommand.available.count, 2)
    }

    func testFilterEmptyReturnsAll() {
        let results = SlashCommand.filter(prefix: "")
        XCTAssertEqual(results.count, SlashCommand.available.count)
    }

    func testFilterSlashAloneReturnsAll() {
        let results = SlashCommand.filter(prefix: "/")
        XCTAssertEqual(results.count, SlashCommand.available.count)
    }

    func testFilterMatchesPrefix() {
        let results = SlashCommand.filter(prefix: "/n")
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].command, "/new")
    }

    func testFilterNoMatch() {
        let results = SlashCommand.filter(prefix: "/xyz")
        XCTAssertTrue(results.isEmpty)
    }
}
```

- [ ] **Step 3: Verify tests fail**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 16' -only-testing:BlancTests/SlashCommandTests 2>&1 | tail -20`

Expected: build failure — `SlashCommand` not found.

- [ ] **Step 4: Implement SlashCommand**

Create `ios/Blanc/Blanc/SlashCommand.swift`:

```swift
import Foundation

struct SlashCommand: Identifiable {
    var id: String { command }
    let command: String
    let hintKey: String
    let execute: (TabsManager) -> Void

    var hint: String {
        NSLocalizedString(hintKey, tableName: "SlashCommands", bundle: .main, comment: "")
    }

    static let available: [SlashCommand] = [
        SlashCommand(command: "/new", hintKey: "slash_new") { manager in
            manager.createTab()
        },
        SlashCommand(command: "/close", hintKey: "slash_close") { manager in
            if let id = manager.activeTabId {
                manager.closeTab(id)
            }
        },
    ]

    static func filter(prefix: String) -> [SlashCommand] {
        guard !prefix.isEmpty else { return available }
        return available.filter { $0.command.hasPrefix(prefix) }
    }
}
```

- [ ] **Step 5: Verify tests pass**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 16' -only-testing:BlancTests/SlashCommandTests 2>&1 | tail -20`

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add ios/Blanc/Blanc/SlashCommand.swift ios/Blanc/Blanc/SlashCommands.strings ios/Blanc/BlancTests/SlashCommandTests.swift
git commit -m "ios: add SlashCommand model with copy-catalog integration and tests"
```

---

### Task 3: PaletteSheet + display-only pill + Liquid Glass

**Files:**
- Create: `ios/Blanc/Blanc/PaletteSheet.swift`
- Modify: `ios/Blanc/Blanc/ContentView.swift` (rewrite pill, swap sheet)
- Modify: `ios/Blanc/Blanc/TabModel.swift:21` (enable swipe gestures)
- Delete: `ios/Blanc/Blanc/TabListSheet.swift`

**Interfaces:**
- Consumes: `QuickSwitcher.search(query:tabs:)`, `QuickSwitcher.strongMatchScore`, `SlashCommand.available`, `SlashCommand.filter(prefix:)`, `TabsManager` (all methods), `TabModel` (reads properties), `BlancTokens` (fallback surface), `Color(blancHex:)`

- [ ] **Step 1: Enable edge-swipe back/forward in TabModel**

In `ios/Blanc/Blanc/TabModel.swift`, add one line after
`self.webView = WKWebView()` (line 21):

```swift
        self.webView = WKWebView()
        webView.allowsBackForwardNavigationGestures = true
```

- [ ] **Step 2: Create PaletteSheet**

Create `ios/Blanc/Blanc/PaletteSheet.swift`:

```swift
import SwiftUI

struct PaletteSheet: View {
    let manager: TabsManager
    @Environment(\.dismiss) private var dismiss
    @State private var input = ""
    @FocusState private var inputFocused: Bool

    private enum Mode {
        case tabs, slash, switcher
    }

    private var mode: Mode {
        if input.isEmpty { return .tabs }
        if input.hasPrefix("/") { return .slash }
        return .switcher
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TextField("Search, enter address, or / for commands", text: $input)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.webSearch)
                    .submitLabel(.go)
                    .focused($inputFocused)
                    .onSubmit { handleSubmit() }
                    .padding()

                Divider()

                listContent
            }
            .navigationTitle("Palette")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { inputFocused = true }
    }

    @ViewBuilder
    private var listContent: some View {
        switch mode {
        case .tabs:
            tabList
        case .slash:
            slashList
        case .switcher:
            switcherList
        }
    }

    private var tabList: some View {
        List {
            ForEach(manager.tabs) { tab in
                Button {
                    manager.setActive(tab.id)
                    dismiss()
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(tab.pageTitle.isEmpty ? "New Tab" : tab.pageTitle)
                                .lineLimit(1)
                            Text(tab.currentURL.absoluteString)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        if tab.id == manager.activeTabId {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.tint)
                        }
                    }
                }
            }
            .onDelete { offsets in
                let ids = offsets.map { manager.tabs[$0].id }
                for id in ids { manager.closeTab(id) }
            }
        }
    }

    private var slashList: some View {
        let slashWord = String(input.trimmingCharacters(in: .whitespaces)
            .split(separator: " ").first ?? Substring(input))
        let matches = SlashCommand.filter(prefix: slashWord)
        return List {
            if matches.isEmpty {
                Text("No matching command")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(matches) { cmd in
                    Button {
                        cmd.execute(manager)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading) {
                            Text(cmd.command)
                                .fontWeight(.medium)
                            Text(cmd.hint)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private var switcherList: some View {
        let results = QuickSwitcher.search(
            query: input.trimmingCharacters(in: .whitespacesAndNewlines),
            tabs: manager.tabs
        )
        return List {
            if results.isEmpty {
                Text("No matches — tap Go to open as address or search")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(results, id: \.tab.id) { result in
                    Button {
                        manager.setActive(result.tab.id)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading) {
                            Text(result.title)
                                .lineLimit(1)
                            Text(result.subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
    }

    private func handleSubmit() {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if trimmed.hasPrefix("/") {
            let slashWord = String(trimmed.split(separator: " ").first ?? Substring(trimmed))
            let matches = SlashCommand.filter(prefix: slashWord)
            if let first = matches.first {
                first.execute(manager)
                dismiss()
            }
            return
        }

        let results = QuickSwitcher.search(query: trimmed, tabs: manager.tabs)
        if let top = results.first, top.score >= QuickSwitcher.strongMatchScore {
            manager.setActive(top.tab.id)
            dismiss()
            return
        }

        manager.activeTab?.addressText = trimmed
        manager.submitActiveTabAddress()
        dismiss()
    }
}
```

- [ ] **Step 3: Rewrite ContentView — display-only pill, Liquid Glass, PaletteSheet**

Replace the contents of `ios/Blanc/Blanc/ContentView.swift` with:

```swift
import SwiftUI

struct ContentView: View {
    @State private var manager = TabsManager()
    @State private var showPalette = false

    var body: some View {
        ZStack(alignment: .bottom) {
            (Color(blancHex: BlancTokens.bg(.light)) ?? .white)
                .ignoresSafeArea()

            if let tab = manager.activeTab {
                WebView(tab: tab)
                    .id(tab.id)
                    .ignoresSafeArea(edges: .top)
            }

            addressPill
        }
        .sheet(isPresented: $showPalette) {
            PaletteSheet(manager: manager)
        }
    }

    private var addressPill: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                tabDots

                Text(displayDomain)
                    .lineLimit(1)
                    .foregroundStyle(.primary)
            }
            .contentShape(Rectangle())
            .onTapGesture { showPalette = true }

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

    private var displayDomain: String {
        manager.activeTab?.currentURL.host ?? "New Tab"
    }

    private var tabDots: some View {
        let maxVisible = 3
        let overflow = manager.tabs.count > maxVisible
        let visible = overflow ? Array(manager.tabs.prefix(maxVisible - 1)) : manager.tabs
        let overflowCount = manager.tabs.count - visible.count

        return HStack(spacing: 6) {
            ForEach(visible) { tab in
                Circle()
                    .fill(tab.id == manager.activeTabId
                          ? Color.primary
                          : Color.secondary.opacity(0.4))
                    .frame(width: 7, height: 7)
            }
            if overflow {
                Text("+\(overflowCount)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct PillStyle: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.glassEffect(.regular.interactive, in: .capsule)
        } else {
            content
                .background(Color(blancHex: BlancTokens.surfaceRaised(.light)) ?? .white)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(Color(blancHex: BlancTokens.border(.light)) ?? .gray))
        }
    }
}

#Preview { ContentView() }
```

- [ ] **Step 4: Delete TabListSheet**

```bash
rm ios/Blanc/Blanc/TabListSheet.swift
```

- [ ] **Step 5: Build and verify**

Run: `xcodebuild build -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | tail -10`

Expected: build succeeds with no errors. If `.glassEffect` has a different
API shape in Xcode 26, adjust the `PillStyle` modifier — the
`#available` gate ensures the fallback branch compiles on all targets.

- [ ] **Step 6: Run all tests**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | tail -30`

Expected: all tests pass (QuickSwitcherTests, SlashCommandTests,
TabModelTests, TabsManagerTests, AddressNormalizerTests, OSHandoffTests,
SubstrateTests).

- [ ] **Step 7: Visual verification on simulator**

Launch the app on the simulator (`npm start` equivalent — open in Xcode,
⌘R). Verify:

1. Pill shows dots + domain + reload + plus (no back/forward buttons, no text field).
2. On iOS 26 simulator: pill has Liquid Glass effect. On older: opaque surface.
3. Swipe from left edge on a page with history → navigates back.
4. Tap the dot/domain area → palette sheet slides up at medium detent.
5. Sheet input is auto-focused, keyboard appears.
6. Empty input → tab list shows (active tab has checkmark).
7. Tap a tab row → switches to it, sheet dismisses.
8. Swipe a row left → deletes the tab.
9. Type `/` → slash command list appears (`/new`, `/close` with hints).
10. Type `/n` → only `/new` shown. Tap it → new tab created, sheet dismisses.
11. Reopen palette, type `/close` → tap it → active tab closed, sheet dismisses.
12. Type any text (e.g. "example") → Quick Switcher results appear.
13. Type a URL (e.g. "apple.com") and tap Go → navigates, sheet dismisses.
14. Type `/xyz` and tap Go → nothing happens (unmatched slash no-op).
15. Swipe sheet down → dismisses without action.

- [ ] **Step 8: Commit**

```bash
git add ios/Blanc/Blanc/PaletteSheet.swift ios/Blanc/Blanc/ContentView.swift ios/Blanc/Blanc/TabModel.swift
git rm ios/Blanc/Blanc/TabListSheet.swift
git commit -m "ios: palette sheet, display-only pill with Liquid Glass, delete TabListSheet"
```

- [ ] **Step 9: Update parity matrix**

In `spec/parity-matrix.md`, update the F1 iOS column from `PARTIAL` — it
stays `PARTIAL` (palette is in, but find-in-page and full command set are
later milestones). Update F6 and F7:

| ID | iOS status |
|----|-----------|
| F6 | `PARTIAL` (open tabs only; favorites/history/groups later) |
| F7 | `PARTIAL` (`/new` + `/close` only; full set at M10) |

```bash
git add spec/parity-matrix.md
git commit -m "spec: iOS parity matrix — F6/F7 PARTIAL after M3 palette"
```
