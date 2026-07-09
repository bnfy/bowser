# iOS M2: Multi-Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-tab create/close/switch to the iOS browser, with tab dots in the address pill and an overflow sheet for 9+ tabs.

**Architecture:** Each `TabModel` creates and holds its own `WKWebView` at init (model-owned web views). A `TabNavigationDelegate` is tab-owned — not tied to the SwiftUI representable lifecycle — so background tabs keep their nav delegate alive. `TabsManager` orchestrates the collection. The `WebView` representable becomes a thin wrapper that returns a pre-built `WKWebView`.

**Tech Stack:** Swift, SwiftUI, WebKit (WKWebView, WKNavigationDelegate), Observation framework (@Observable)

## Global Constraints

- iOS 17+ deployment target
- Bundle identifier: `me.bnfy.blanc`
- Xcode 26 filesystem-synchronized groups — files dropped into `ios/Blanc/Blanc/` or `ios/Blanc/BlancTests/` are auto-included in the target. No `project.pbxproj` edits needed.
- Never hand-edit generated substrate files (`Tokens.swift`, `BlancSettings.swift`)
- "Favorites" user-facing, "bookmarks" internal — don't rename
- No UI test target (removed in M0-M1; unit tests only)
- Test command: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -quiet`
- Spec: `docs/superpowers/specs/2026-07-08-ios-m2-multi-tab-design.md`

---

### Task 1: TabNavigationDelegate + TabModel

The foundation. `TabNavigationDelegate` is an `NSObject` conforming to `WKNavigationDelegate` that syncs nav state back to its owning `TabModel`. `TabModel` is the `@Observable` class that owns one tab's `WKWebView`, delegate, and state. OS hand-off (`mailto:`, `tel:`, etc.) is preserved in both the address-bar path and the navigation-policy path.

**Files:**
- Create: `ios/Blanc/Blanc/TabNavigationDelegate.swift`
- Create: `ios/Blanc/Blanc/TabModel.swift`
- Create: `ios/Blanc/BlancTests/TabModelTests.swift`

**Interfaces:**
- Consumes: `AddressNormalizer` (unchanged from M1), `OSHandoff` (unchanged), `BlancSettingsDefaults` (generated substrate)
- Produces: `TabModel` class (`id: UUID`, `addressText: String`, `currentURL: URL`, `canGoBack/canGoForward/isLoading: Bool`, `pageTitle: String`, `webView: WKWebView`, `navigationDelegate: TabNavigationDelegate`, `submitAddress(using:)`, `goBack()`, `goForward()`, `reload()`, `stop()`). `TabNavigationDelegate` class (`tab: TabModel?` weak, `load(_:in:)`).

- [ ] **Step 1: Write TabModelTests**

```swift
// ios/Blanc/BlancTests/TabModelTests.swift
import XCTest
@testable import Blanc

final class TabModelTests: XCTestCase {
    func testInitSetsURL() {
        let tab = TabModel(url: URL(string: "https://example.com")!)
        XCTAssertEqual(tab.currentURL.absoluteString, "https://example.com")
        XCTAssertEqual(tab.addressText, "https://example.com")
    }

    func testInitCreatesWebViewAndDelegate() {
        let tab = TabModel(url: URL(string: "https://example.com")!)
        XCTAssertNotNil(tab.webView)
        XCTAssertNotNil(tab.navigationDelegate)
        XCTAssertTrue(tab.webView.navigationDelegate === tab.navigationDelegate)
    }

    func testSubmitAddressNormalizesQuery() {
        let tab = TabModel(url: URL(string: "https://example.com")!)
        let normalizer = AddressNormalizer(searchEngine: .duckduckgo)
        tab.addressText = "hello world"
        tab.submitAddress(using: normalizer)
        XCTAssertEqual(tab.currentURL.absoluteString,
                       "https://duckduckgo.com/?q=hello%20world")
    }

    func testSubmitAddressNormalizesDomain() {
        let tab = TabModel(url: URL(string: "https://example.com")!)
        let normalizer = AddressNormalizer(searchEngine: .duckduckgo)
        tab.addressText = "apple.com"
        tab.submitAddress(using: normalizer)
        XCTAssertEqual(tab.currentURL.absoluteString, "https://apple.com")
    }

    func testSubmitAddressHandoffDoesNotNavigate() {
        let tab = TabModel(url: URL(string: "https://example.com")!)
        let normalizer = AddressNormalizer(searchEngine: .duckduckgo)
        tab.addressText = "mailto:test@example.com"
        tab.submitAddress(using: normalizer)
        XCTAssertEqual(tab.currentURL.absoluteString, "https://example.com")
    }

    func testUniqueIds() {
        let a = TabModel(url: URL(string: "https://a.test")!)
        let b = TabModel(url: URL(string: "https://b.test")!)
        XCTAssertNotEqual(a.id, b.id)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:BlancTests/TabModelTests -quiet 2>&1 | tail -5`

Expected: build error — `TabModel` not found.

- [ ] **Step 3: Write TabNavigationDelegate**

```swift
// ios/Blanc/Blanc/TabNavigationDelegate.swift
import Foundation
import WebKit
import UIKit

final class TabNavigationDelegate: NSObject, WKNavigationDelegate {
    weak var tab: TabModel?
    private var lastRequested: URL?

    func load(_ url: URL, in webView: WKWebView) {
        guard url != lastRequested else { return }
        lastRequested = url
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView,
                 didStartProvisionalNavigation navigation: WKNavigation!) {
        tab?.isLoading = true
    }

    func webView(_ webView: WKWebView,
                 didFinish navigation: WKNavigation!) {
        sync(webView)
    }

    func webView(_ webView: WKWebView,
                 didFail navigation: WKNavigation!,
                 withError error: Error) {
        sync(webView)
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        sync(webView)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           let scheme = url.scheme?.lowercased(),
           OSHandoff.schemes.contains(scheme) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    private func sync(_ webView: WKWebView) {
        guard let tab else { return }
        tab.isLoading = webView.isLoading
        tab.canGoBack = webView.canGoBack
        tab.canGoForward = webView.canGoForward
        tab.pageTitle = webView.title ?? ""
        if let u = webView.url {
            lastRequested = u
            tab.currentURL = u
            tab.addressText = u.absoluteString
        }
    }
}
```

- [ ] **Step 4: Write TabModel**

```swift
// ios/Blanc/Blanc/TabModel.swift
import Observation
import Foundation
import WebKit

@Observable
final class TabModel: Identifiable {
    let id = UUID()
    var addressText: String
    var currentURL: URL
    var canGoBack = false
    var canGoForward = false
    var isLoading = false
    var pageTitle = ""

    let webView: WKWebView
    let navigationDelegate: TabNavigationDelegate

    init(url: URL) {
        self.currentURL = url
        self.addressText = url.absoluteString
        self.webView = WKWebView()
        self.navigationDelegate = TabNavigationDelegate()
        navigationDelegate.tab = self
        webView.navigationDelegate = navigationDelegate
        navigationDelegate.load(url, in: webView)
    }

    func submitAddress(using normalizer: AddressNormalizer) {
        if OSHandoff.isHandoff(addressText) {
            OSHandoff.open(addressText)
            return
        }
        let dest = normalizer.normalize(addressText)
        currentURL = dest
        addressText = dest.absoluteString
        navigationDelegate.load(dest, in: webView)
    }

    func goBack()    { webView.goBack() }
    func goForward() { webView.goForward() }
    func reload()    { webView.reload() }
    func stop()      { webView.stopLoading() }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:BlancTests/TabModelTests -quiet 2>&1 | tail -20`

Expected: all 6 TabModelTests pass. Existing M1 tests (AddressNormalizerTests, OSHandoffTests, SubstrateTests) still pass.

- [ ] **Step 6: Commit**

```bash
git add ios/Blanc/Blanc/TabNavigationDelegate.swift ios/Blanc/Blanc/TabModel.swift ios/Blanc/BlancTests/TabModelTests.swift
git commit -m "ios: add TabModel + TabNavigationDelegate with tests"
```

---

### Task 2: TabsManager

Tab collection management: create/close/switch. Close-tab picks the right neighbor (or left if rightmost), and closing the last tab creates a fresh one. Owns the shared `AddressNormalizer`.

**Files:**
- Create: `ios/Blanc/Blanc/TabsManager.swift`
- Create: `ios/Blanc/BlancTests/TabsManagerTests.swift`

**Interfaces:**
- Consumes: `TabModel` (from Task 1), `AddressNormalizer`, `BlancSettingsDefaults`
- Produces: `TabsManager` class (`tabs: [TabModel]`, `activeTabId: UUID?`, `activeTab: TabModel?` computed, `createTab(url:) -> UUID`, `closeTab(_:)`, `setActive(_:)`, `submitActiveTabAddress()`)

- [ ] **Step 1: Write TabsManagerTests**

```swift
// ios/Blanc/BlancTests/TabsManagerTests.swift
import XCTest
@testable import Blanc

final class TabsManagerTests: XCTestCase {
    func testInitCreatesOneTab() {
        let m = TabsManager()
        XCTAssertEqual(m.tabs.count, 1)
        XCTAssertNotNil(m.activeTabId)
        XCTAssertNotNil(m.activeTab)
    }

    func testCreateTabAddsAndActivates() {
        let m = TabsManager()
        let before = m.tabs.count
        let id = m.createTab()
        XCTAssertEqual(m.tabs.count, before + 1)
        XCTAssertEqual(m.activeTabId, id)
    }

    func testCloseTabRemoves() {
        let m = TabsManager()
        let id = m.createTab()
        let count = m.tabs.count
        m.closeTab(id)
        XCTAssertEqual(m.tabs.count, count - 1)
    }

    func testCloseActivePicksRightNeighbor() {
        let m = TabsManager()
        // tabs: [tab0]
        let _ = m.createTab(url: URL(string: "https://b.test")!)
        // tabs: [tab0, b], active = b
        let c = m.createTab(url: URL(string: "https://c.test")!)
        // tabs: [tab0, b, c], active = c
        let b = m.tabs[1].id
        m.setActive(b)
        // active = b (index 1)
        m.closeTab(b)
        // b removed → tabs: [tab0, c]. Right neighbor of index 1 → index 1 → c
        XCTAssertEqual(m.activeTabId, c)
    }

    func testCloseRightmostActivePicksLeft() {
        let m = TabsManager()
        let a = m.tabs[0].id
        let b = m.createTab(url: URL(string: "https://b.test")!)
        // tabs: [a, b], active = b (rightmost)
        m.closeTab(b)
        // b removed → tabs: [a]. min(1, 0) = 0 → a
        XCTAssertEqual(m.activeTabId, a)
    }

    func testCloseLastCreatesNew() {
        let m = TabsManager()
        let onlyId = m.tabs[0].id
        m.closeTab(onlyId)
        XCTAssertEqual(m.tabs.count, 1)
        XCTAssertNotNil(m.activeTabId)
        XCTAssertNotEqual(m.activeTabId, onlyId)
    }

    func testSetActive() {
        let m = TabsManager()
        let a = m.tabs[0].id
        let _ = m.createTab()
        m.setActive(a)
        XCTAssertEqual(m.activeTabId, a)
    }

    func testSetActiveIgnoresUnknownId() {
        let m = TabsManager()
        let before = m.activeTabId
        m.setActive(UUID())
        XCTAssertEqual(m.activeTabId, before)
    }

    func testActiveTabMatchesId() {
        let m = TabsManager()
        let id = m.createTab(url: URL(string: "https://test.com")!)
        XCTAssertEqual(m.activeTab?.id, id)
    }

    func testCloseNonActivePreservesActive() {
        let m = TabsManager()
        let a = m.tabs[0].id
        let b = m.createTab()
        // active = b
        m.closeTab(a)
        XCTAssertEqual(m.activeTabId, b)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:BlancTests/TabsManagerTests -quiet 2>&1 | tail -5`

Expected: build error — `TabsManager` not found.

- [ ] **Step 3: Write TabsManager**

```swift
// ios/Blanc/Blanc/TabsManager.swift
import Observation
import Foundation

@Observable
final class TabsManager {
    private(set) var tabs: [TabModel] = []
    var activeTabId: UUID?

    let normalizer = AddressNormalizer(searchEngine: BlancSettingsDefaults.searchEngine)

    var activeTab: TabModel? {
        guard let activeTabId else { return nil }
        return tabs.first { $0.id == activeTabId }
    }

    init() {
        createTab()
    }

    @discardableResult
    func createTab(url: URL = URL(string: "https://example.com")!) -> UUID {
        let tab = TabModel(url: url)
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:BlancTests/TabsManagerTests -quiet 2>&1 | tail -20`

Expected: all 10 TabsManagerTests pass. Task 1 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add ios/Blanc/Blanc/TabsManager.swift ios/Blanc/BlancTests/TabsManagerTests.swift
git commit -m "ios: add TabsManager with create/close/switch tests"
```

---

### Task 3: Migrate WebView + ContentView, retire BrowserModel

Rewrite `WebView` as a thin wrapper (returns the tab-owned `WKWebView`, no
Coordinator). Update `ContentView` to use `TabsManager` instead of
`BrowserModel`. The app still shows one tab with the same pill UI — no dots
yet. Delete `BrowserModel.swift`. All existing tests must still pass.

**Files:**
- Modify: `ios/Blanc/Blanc/WebView.swift` (full rewrite)
- Modify: `ios/Blanc/Blanc/ContentView.swift` (migrate to TabsManager)
- Delete: `ios/Blanc/Blanc/BrowserModel.swift`

**Interfaces:**
- Consumes: `TabModel` (Task 1), `TabsManager` (Task 2), `BlancTokens`, `Color+Hex`
- Produces: updated `WebView(tab:)`, updated `ContentView` (wired to `TabsManager`)

- [ ] **Step 1: Rewrite WebView.swift**

Replace the entire file:

```swift
// ios/Blanc/Blanc/WebView.swift
import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    let tab: TabModel

    func makeUIView(context: Context) -> WKWebView {
        tab.webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
```

- [ ] **Step 2: Update ContentView.swift to use TabsManager**

Replace the entire file. Same single-tab pill UI as M1, but wired through
`TabsManager` instead of `BrowserModel`:

```swift
// ios/Blanc/Blanc/ContentView.swift
import SwiftUI

struct ContentView: View {
    @State private var manager = TabsManager()

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
    }

    private var addressPill: some View {
        HStack(spacing: 10) {
            Button { manager.activeTab?.goBack() } label: {
                Image(systemName: "chevron.left")
            }
            .disabled(!(manager.activeTab?.canGoBack ?? false))

            Button { manager.activeTab?.goForward() } label: {
                Image(systemName: "chevron.right")
            }
            .disabled(!(manager.activeTab?.canGoForward ?? false))

            TextField("Search or enter address", text: addressBinding)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.webSearch)
                .submitLabel(.go)
                .onSubmit { manager.submitActiveTabAddress() }

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
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(blancHex: BlancTokens.surfaceRaised(.light)) ?? .white)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Color(blancHex: BlancTokens.border(.light)) ?? .gray))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var addressBinding: Binding<String> {
        Binding(
            get: { manager.activeTab?.addressText ?? "" },
            set: { manager.activeTab?.addressText = $0 }
        )
    }
}

#Preview { ContentView() }
```

- [ ] **Step 3: Delete BrowserModel.swift**

```bash
rm ios/Blanc/Blanc/BrowserModel.swift
```

- [ ] **Step 4: Run all tests**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -quiet 2>&1 | tail -20`

Expected: all tests pass (TabModelTests, TabsManagerTests, AddressNormalizerTests, OSHandoffTests, SubstrateTests). The app builds. `BrowserModel` is no longer referenced anywhere.

- [ ] **Step 5: Commit**

```bash
git add ios/Blanc/Blanc/WebView.swift ios/Blanc/Blanc/ContentView.swift
git rm ios/Blanc/Blanc/BrowserModel.swift
git commit -m "ios: migrate to TabsManager, retire BrowserModel"
```

---

### Task 4: Tab dots, new-tab button, overflow sheet

Add the multi-tab UI to the pill: a row of dots (active = filled, inactive =
dimmed, capped at 8), long-press to close, a `+` button to create tabs, and a
native `.sheet` for the `+N` overflow (tapping a row switches, swiping
closes).

**Files:**
- Create: `ios/Blanc/Blanc/TabListSheet.swift`
- Modify: `ios/Blanc/Blanc/ContentView.swift`

**Interfaces:**
- Consumes: `TabsManager` (Task 2), `TabModel` (Task 1), `BlancTokens`, `Color+Hex`
- Produces: `TabListSheet` view, updated `ContentView` with dots/overflow/new-tab

- [ ] **Step 1: Write TabListSheet**

```swift
// ios/Blanc/Blanc/TabListSheet.swift
import SwiftUI

struct TabListSheet: View {
    let manager: TabsManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
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
                    for id in ids {
                        manager.closeTab(id)
                    }
                }
            }
            .navigationTitle("Tabs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Add tab dots, + button, and overflow to ContentView**

Replace the entire file:

```swift
// ios/Blanc/Blanc/ContentView.swift
import SwiftUI

struct ContentView: View {
    @State private var manager = TabsManager()
    @State private var showTabList = false

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
        .sheet(isPresented: $showTabList) {
            TabListSheet(manager: manager)
        }
    }

    private var addressPill: some View {
        HStack(spacing: 10) {
            Button { manager.activeTab?.goBack() } label: {
                Image(systemName: "chevron.left")
            }
            .disabled(!(manager.activeTab?.canGoBack ?? false))

            Button { manager.activeTab?.goForward() } label: {
                Image(systemName: "chevron.right")
            }
            .disabled(!(manager.activeTab?.canGoForward ?? false))

            tabDots

            TextField("Search or enter address", text: addressBinding)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.webSearch)
                .submitLabel(.go)
                .onSubmit { manager.submitActiveTabAddress() }

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
        .background(Color(blancHex: BlancTokens.surfaceRaised(.light)) ?? .white)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Color(blancHex: BlancTokens.border(.light)) ?? .gray))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var addressBinding: Binding<String> {
        Binding(
            get: { manager.activeTab?.addressText ?? "" },
            set: { manager.activeTab?.addressText = $0 }
        )
    }

    private var tabDots: some View {
        let maxVisible = 8
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
                    .onTapGesture { manager.setActive(tab.id) }
                    .onLongPressGesture {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        manager.closeTab(tab.id)
                    }
            }
            if overflow {
                Text("+\(overflowCount)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .onTapGesture { showTabList = true }
            }
        }
    }
}

#Preview { ContentView() }
```

- [ ] **Step 3: Build and run all tests**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -quiet 2>&1 | tail -20`

Expected: all tests pass (TabModelTests, TabsManagerTests, AddressNormalizerTests, OSHandoffTests, SubstrateTests).

- [ ] **Step 4: Verify on simulator**

Launch the app on iPhone 17 Pro simulator. Verify:

1. Single tab loads example.com — pill shows one filled dot.
2. Tap `+` — new tab appears, dot count increases, new dot is filled.
3. Tap an inactive dot — switches to that tab.
4. Long-press a dot — haptic fires, tab closes, dot disappears.
5. Close all tabs — a fresh tab appears (never zero tabs).
6. Create 9+ tabs — last dot position shows `+N`. Tap it — sheet opens listing all tabs.
7. In the sheet, tap a row — switches to that tab, sheet dismisses.
8. In the sheet, swipe a row left — deletes that tab.
9. Address bar, back/forward, reload/stop still work as in M1.

- [ ] **Step 5: Commit**

```bash
git add ios/Blanc/Blanc/TabListSheet.swift ios/Blanc/Blanc/ContentView.swift
git commit -m "ios: tab dots, new-tab button, and overflow sheet in pill"
```
