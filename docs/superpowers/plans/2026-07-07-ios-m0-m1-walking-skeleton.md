# iOS M0–M1: Walking Skeleton (single-tab browser) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the native iOS app from nothing to a single-tab browser: type a URL or a search and navigate, with back/forward/reload and OS hand-off for `mailto:`/`tel:` — the first two milestones (M0, M1) of the iOS port roadmap.

**Architecture:** A SwiftUI app (`@main App` → `ContentView`) hosting a `WKWebView` through a `UIViewRepresentable` wrapper. An `@Observable BrowserModel` is the single source of truth for the address text and navigation state; a `Coordinator` (the wrapper's `WKNavigationDelegate`) writes web-view state back into the model. Pure logic — address normalization, search-URL building, OS hand-off classification, hex→Color — lives in small, unit-tested value types ported faithfully from the desktop app (F5/D4 parity). No tabs, groups, blocking, or internal pages yet — those are later milestones.

**Tech Stack:** Swift 5.9+, SwiftUI, WebKit (`WKWebView`), the Observation framework (`@Observable`, iOS 17+), XCTest. Consumes the generated substrate `Tokens.swift` and `BlancSettings.swift`.

## Global Constraints

Every task's requirements implicitly include these (exact values, from the roadmap spec `docs/superpowers/specs/2026-07-07-ios-port-roadmap-design.md` and the parity spec `spec/`):

- **Min iOS deployment target: `17.0`** (enables `@Observable`).
- **Bundle identifier: `me.bnfy.blanc`** (all-lowercase — override Xcode's auto-capitalized `me.bnfy.Blanc`).
- **Product / module name: `Blanc`.** Tests use `@testable import Blanc`.
- **Device family: iPhone only.** iPad/Mac deferred (D11).
- **Location: monorepo.** Xcode project at `ios/Blanc.xcodeproj`, sources at `ios/Blanc/`, tests at `ios/BlancTests/`. Nothing outside `ios/` is created or modified by this plan except `docs/…` (this file), the `spec/` parity-tracking files updated by the DoD task (Task 7 — `spec/parity-matrix.md`, `spec/acceptance/index.md`), and, if absent, root ignores.
- **New `.swift` files must join the `Blanc` target.** Create each via Xcode (File → New → File → Swift File) so it's added to the target — or, if created on disk directly, use **Add Files to "Blanc"…** and check the Blanc target. Any task that adds files must `git add ios/Blanc.xcodeproj` too (the project file records target membership; without it the file won't compile).
- **Generated substrate is referenced, never copied or hand-edited.** Add `tokens/generated/Tokens.swift` and `settings-schema/generated/BlancSettings.swift` to the target *in place* (uncheck "Copy items if needed"). They are produced by `npm run tokens:build` / `settings:build`; never edit `*/generated/*`.
- **Search-engine URLs — verbatim, F5 parity** (from `src/main/settings.js` `SEARCH_ENGINES`):
  - `duckduckgo` → `https://duckduckgo.com/?q=<q>`
  - `google` → `https://www.google.com/search?q=<q>`
  - `bing` → `https://www.bing.com/search?q=<q>`
  - `brave` → `https://search.brave.com/search?q=<q>`
  - `<q>` is URL-encoded the way JS `encodeURIComponent` encodes (unescaped set: `A–Z a–z 0–9 - _ . ! ~ * ' ( )`).
- **Default search engine: `duckduckgo`** (from `BlancSettingsDefaults.searchEngine`).
- **Address normalization must match `src/main/main.js` `normalizeAddressInput` exactly** (F5) — script schemes (`javascript`/`data`/`vbscript`) route to search; scheme URLs navigate; `localhost`/bare-IPv4 get `http://`; domain-shaped input gets `https://`; everything else is a search. The desktop on-disk local-document branch is intentionally omitted (no bare local-file navigation from an iOS address bar).
- **OS hand-off schemes (D4): `mailto`, `tel`, `facetime`, `sms`** (from `HANDOFF_PROTOCOLS`). Checked *before* normalization on typed input and in `decidePolicyFor` for page navigations.

---

### Task 0 (M0.1): Xcode project scaffold

Create the app and prove it launches. This is scaffolding — verified by build-and-run, not a unit test.

**Files:**
- Create: `ios/Blanc.xcodeproj` (+ `ios/Blanc/BlancApp.swift`, `ios/Blanc/ContentView.swift`, `ios/BlancTests/BlancTests.swift`) via Xcode's template
- Create: `ios/.gitignore`

**Interfaces:**
- Produces: an app target named `Blanc` (module `Blanc`), a unit-test target `BlancTests`, deployment target 17.0, bundle id `me.bnfy.blanc`.

- [ ] **Step 1: Create the project in Xcode**

Xcode → File → New → Project → **iOS → App**. Set:
- Product Name: `Blanc`
- Organization Identifier: `me.bnfy`
- Interface: **SwiftUI**, Language: **Swift**
- Storage: **None**, **check "Include Tests"** — if Xcode 16+ shows a **Testing System** picker, choose **XCTest** (not Swift Testing; this plan's tests are XCTest)
Click Next, choose the repository's `ios/` directory as the location (create it if the dialog doesn't show it), and **uncheck "Create Git repository"** (this repo already has one). Result: `ios/Blanc.xcodeproj`, `ios/Blanc/`, `ios/BlancTests/`.

- [ ] **Step 2: Fix the three project settings that don't match the constraints**

Select the **Blanc** project → **Blanc** target → General:
- **Minimum Deployments → iOS `17.0`**.
- **Supported Destinations**: remove **iPad** and **Mac** (leave iPhone only).
Then target → Build Settings → search `Bundle Identifier` → set **`me.bnfy.blanc`** (lowercase b).

- [ ] **Step 3: Add an Xcode `.gitignore`**

Create `ios/.gitignore`:

```gitignore
# Xcode / Swift
xcuserdata/
*.xcuserstate
DerivedData/
build/
.DS_Store
*.xcscmblueprint
*.xccheckout
```

- [ ] **Step 4: Build and run**

Select an iPhone simulator (e.g. iPhone 15) and press **Run** (⌘R).
Expected: the app launches in the simulator showing the template's `Text("Hello, world!")`. No build errors.

- [ ] **Step 5: Run the template test to confirm the test target works**

Press **⌘U** (Product → Test). Or CLI:

Run: `xcodebuild test -project ios/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 15'`
Expected: **TEST SUCCEEDED** (the template's placeholder `BlancTests` passes). If the named simulator is missing, list options with `xcrun simctl list devices` and substitute one.

- [ ] **Step 6: Commit**

```bash
git add ios/
git commit -m "ios: scaffold Blanc app (SwiftUI, iOS 17, iPhone, me.bnfy.blanc)"
```

---

### Task 1 (M0.2): Full-screen WKWebView

Show real web content by wrapping `WKWebView` (a UIKit view) for SwiftUI. Verified by build-and-run.

**Files:**
- Create: `ios/Blanc/WebView.swift`
- Modify: `ios/Blanc/ContentView.swift`

**Interfaces:**
- Produces: `struct WebView: UIViewRepresentable` with `init(url: URL)`, loading `url` once and reloading only when a different `url` is passed.

- [ ] **Step 1: Create the WKWebView wrapper**

Create `ios/Blanc/WebView.swift`:

```swift
import SwiftUI
import WebKit

/// SwiftUI wrapper around a UIKit `WKWebView`. The `Coordinator` remembers the
/// last URL it loaded so a re-render doesn't reload the same page (and so the
/// trailing-slash the web view appends after loading doesn't cause a reload).
struct WebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        context.coordinator.load(url, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.load(url, in: webView)
    }

    final class Coordinator {
        private var lastRequested: URL?
        func load(_ url: URL, in webView: WKWebView) {
            guard url != lastRequested else { return }
            lastRequested = url
            webView.load(URLRequest(url: url))
        }
    }
}
```

- [ ] **Step 2: Show it full-screen**

Replace `ios/Blanc/ContentView.swift` body:

```swift
import SwiftUI

struct ContentView: View {
    var body: some View {
        WebView(url: URL(string: "https://example.com")!)
            .ignoresSafeArea()
    }
}

#Preview {
    ContentView()
}
```

- [ ] **Step 3: Build and run**

Run (⌘R). Expected: the simulator fills with the **example.com** page ("Example Domain"). No build errors, no blank white screen.

- [ ] **Step 4: Commit**

```bash
git add ios/Blanc/WebView.swift ios/Blanc/ContentView.swift ios/Blanc.xcodeproj
git commit -m "ios: render a full-screen WKWebView (M0.2)"
```

---

### Task 2 (M0.3): Wire in the generated substrate + hex→Color (TDD)

Link the generated Swift, and add the one bridge the tokens need — a hex-string→`Color` parser — test-first. This establishes the real unit-test workflow.

**Files:**
- Add to target (reference in place): `tokens/generated/Tokens.swift`, `settings-schema/generated/BlancSettings.swift`
- Create: `ios/Blanc/Color+Hex.swift`
- Create/replace: `ios/BlancTests/SubstrateTests.swift`
- Modify: `ios/Blanc/ContentView.swift`

**Interfaces:**
- Consumes: `BlancTokens.bg(_:)` (returns a `#rrggbb` string), `BlancTheme`, `BlancSettingsDefaults.searchEngine`, `BlancSearchEngine`.
- Produces: `extension Color { init?(blancHex: String) }` — parses `#rrggbb` (leading `#` optional), returns `nil` on malformed input.

- [ ] **Step 1: Add the generated files to the target**

In Xcode: right-click the **Blanc** group → **Add Files to "Blanc"…** → select `tokens/generated/Tokens.swift` and `settings-schema/generated/BlancSettings.swift` (navigate up out of `ios/`). **Uncheck "Copy items if needed"**, ensure **Add to targets: Blanc** is checked. They now appear as references (blue-ish) pointing at the generated sources.

- [ ] **Step 2: Write the failing tests**

Replace `ios/BlancTests/SubstrateTests.swift`:

```swift
import XCTest
import SwiftUI
@testable import Blanc

final class SubstrateTests: XCTestCase {
    func testGeneratedSubstrateIsLinked() {
        // Proves BlancSettings.swift compiled into the module.
        XCTAssertEqual(BlancSettingsDefaults.searchEngine, .duckduckgo)
    }

    func testHexParsesSixDigitWithHash() {
        let c = Color(blancHex: "#f4f4f1")
        XCTAssertNotNil(c)
    }

    func testHexParsesWithoutHash() {
        XCTAssertNotNil(Color(blancHex: "0e0e0e"))
    }

    func testHexRejectsMalformed() {
        XCTAssertNil(Color(blancHex: "#zzzzzz"))
        XCTAssertNil(Color(blancHex: "#fff"))     // 3-digit not supported yet
        XCTAssertNil(Color(blancHex: ""))
    }

    func testTokenBackgroundIsParseable() {
        // The token the app actually uses must round-trip through the parser.
        XCTAssertNotNil(Color(blancHex: BlancTokens.bg(.light)))
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `xcodebuild test -project ios/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 15'`
Expected: **FAIL** — compile error "Cannot find 'Color' initializer 'init(blancHex:)'" (the extension doesn't exist yet).

- [ ] **Step 4: Implement the hex parser**

Create `ios/Blanc/Color+Hex.swift`:

```swift
import SwiftUI

extension Color {
    /// Parses a `#rrggbb` (or `rrggbb`) hex string from `BlancTokens`.
    /// Returns nil for anything that isn't exactly 6 hex digits.
    /// (rgba(...) tokens aren't needed yet; add a branch when one is used.)
    init?(blancHex: String) {
        var s = blancHex
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let value = UInt32(s, radix: 16) else { return nil }
        let r = Double((value & 0xFF0000) >> 16) / 255.0
        let g = Double((value & 0x00FF00) >> 8) / 255.0
        let b = Double(value & 0x0000FF) / 255.0
        self = Color(red: r, green: g, blue: b)
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `xcodebuild test -project ios/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 15'`
Expected: **TEST SUCCEEDED** — all five `SubstrateTests` pass.

- [ ] **Step 6: Drive the app background from a token**

In `ios/Blanc/ContentView.swift`, put a token-colored background behind the web view (visible only briefly during load / around safe areas — enough to prove the pipeline):

```swift
import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            (Color(blancHex: BlancTokens.bg(.light)) ?? .white)
                .ignoresSafeArea()
            WebView(url: URL(string: "https://example.com")!)
                .ignoresSafeArea()
        }
    }
}

#Preview {
    ContentView()
}
```

Run (⌘R). Expected: builds and runs; example.com still loads (the token background sits behind it).

- [ ] **Step 7: Commit**

```bash
git add ios/Blanc/Color+Hex.swift ios/BlancTests/SubstrateTests.swift ios/Blanc/ContentView.swift ios/Blanc.xcodeproj
git commit -m "ios: link generated substrate + tested hex->Color bridge (M0.3)"
```

---

### Task 3 (M1.1): Address bar + `AddressNormalizer` (TDD)

Port `normalizeAddressInput` + search-URL building faithfully (F5), test-first, then wire an address field that navigates on submit.

**Files:**
- Create: `ios/Blanc/AddressNormalizer.swift`
- Create: `ios/Blanc/BrowserModel.swift`
- Create: `ios/BlancTests/AddressNormalizerTests.swift`
- Modify: `ios/Blanc/WebView.swift`, `ios/Blanc/ContentView.swift`

**Interfaces:**
- Consumes: `BlancSearchEngine`, `BlancSettingsDefaults.searchEngine`.
- Produces:
  - `struct AddressNormalizer { init(searchEngine: BlancSearchEngine); func normalize(_ input: String) -> URL; func searchURL(for query: String) -> URL }`
  - `@Observable final class BrowserModel { var addressText: String; var currentURL: URL; init(start: URL); func submitAddress() }`

- [ ] **Step 1: Write the failing normalizer tests**

Create `ios/BlancTests/AddressNormalizerTests.swift` (cases mirror `normalizeAddressInput` + the F5 acceptance line):

```swift
import XCTest
@testable import Blanc

final class AddressNormalizerTests: XCTestCase {
    let n = AddressNormalizer(searchEngine: .duckduckgo)

    func testDomainNavigates() {
        XCTAssertEqual(n.normalize("example.com").absoluteString, "https://example.com")
    }
    func testDomainWithPathNavigates() {
        XCTAssertEqual(n.normalize("example.com/a/b").absoluteString, "https://example.com/a/b")
    }
    func testSchemeUrlNavigatesUnchanged() {
        XCTAssertEqual(n.normalize("https://a.test/x").absoluteString, "https://a.test/x")
    }
    func testLocalhostGetsHttp() {
        XCTAssertEqual(n.normalize("localhost:3000").absoluteString, "http://localhost:3000")
    }
    func testBareIPv4GetsHttp() {
        XCTAssertEqual(n.normalize("127.0.0.1:8080").absoluteString, "http://127.0.0.1:8080")
    }
    func testQueryBecomesSearch() {
        XCTAssertEqual(n.normalize("how tall is everest").absoluteString,
                       "https://duckduckgo.com/?q=how%20tall%20is%20everest")
    }
    func testScriptSchemeRoutesToSearchNotNavigation() {
        XCTAssertEqual(n.normalize("javascript:alert(1)").absoluteString,
                       "https://duckduckgo.com/?q=javascript%3Aalert(1)")
    }
    func testSearchEncodingMatchesEncodeURIComponent() {
        // space -> %20, & -> %26, ( ) . ! kept literal (encodeURIComponent set)
        XCTAssertEqual(n.searchURL(for: "a & b!").absoluteString,
                       "https://duckduckgo.com/?q=a%20%26%20b!")
    }
    func testGoogleEngineUrl() {
        let g = AddressNormalizer(searchEngine: .google)
        XCTAssertEqual(g.searchURL(for: "cats").absoluteString,
                       "https://www.google.com/search?q=cats")
    }
    func testSingleCharTldIsSearchNotDomain() {
        // "example.c" has a 1-char TLD; the domain regex requires {2,}, so search.
        XCTAssertEqual(n.normalize("example.c").absoluteString,
                       "https://duckduckgo.com/?q=example.c")
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `xcodebuild test -project ios/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BlancTests/AddressNormalizerTests`
Expected: **FAIL** — "Cannot find 'AddressNormalizer' in scope".

- [ ] **Step 3: Implement `AddressNormalizer`**

Create `ios/Blanc/AddressNormalizer.swift`:

```swift
import Foundation

/// Faithful port of `normalizeAddressInput` + `SEARCH_ENGINES` (F5 parity;
/// see src/main/main.js and src/main/settings.js). The desktop on-disk
/// local-document branch is omitted: iOS has no bare local-file address input.
struct AddressNormalizer {
    let searchEngine: BlancSearchEngine

    // encodeURIComponent's unescaped set: A-Z a-z 0-9 - _ . ! ~ * ' ( )
    private static let queryAllowed: CharacterSet = {
        var s = CharacterSet()
        s.insert(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        return s
    }()

    func searchURL(for query: String) -> URL {
        let q = query.addingPercentEncoding(withAllowedCharacters: Self.queryAllowed) ?? query
        let base: String
        switch searchEngine {
        case .duckduckgo: base = "https://duckduckgo.com/?q=\(q)"
        case .google:     base = "https://www.google.com/search?q=\(q)"
        case .bing:       base = "https://www.bing.com/search?q=\(q)"
        case .brave:      base = "https://search.brave.com/search?q=\(q)"
        }
        return URL(string: base)!
    }

    func normalize(_ input: String) -> URL {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)

        if let scheme = schemePrefix(of: trimmed) {
            if ["javascript", "data", "vbscript"].contains(scheme) {
                return searchURL(for: trimmed)   // never navigate script schemes
            }
            return URL(string: trimmed) ?? searchURL(for: trimmed)
        }
        if matches(trimmed, #"^localhost(:\d+)?(/|$)"#) {
            return URL(string: "http://\(trimmed)") ?? searchURL(for: trimmed)
        }
        if matches(trimmed, #"^(\d{1,3}\.){3}\d{1,3}(:\d+)?(/|$)"#) {   // bare IPv4
            return URL(string: "http://\(trimmed)") ?? searchURL(for: trimmed)
        }
        if matches(trimmed, #"^[^\s]+\.[a-zA-Z]{2,}(/[^\s]*)?$"#) {     // domain-shaped
            return URL(string: "https://\(trimmed)") ?? searchURL(for: trimmed)
        }
        return searchURL(for: trimmed)
    }

    /// The lowercased scheme of "scheme://…" when the text before the first
    /// "://" is a valid URI scheme (letter, then letter/digit/+/-/.), else nil.
    private func schemePrefix(of s: String) -> String? {
        guard let r = s.range(of: "://") else { return nil }
        let prefix = String(s[s.startIndex..<r.lowerBound])
        guard matches(prefix, #"^[a-zA-Z][a-zA-Z0-9+.\-]*$"#) else { return nil }
        return prefix.lowercased()
    }

    private func matches(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }
}
```

- [ ] **Step 4: Run to verify the normalizer tests pass**

Run: `xcodebuild test -project ios/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BlancTests/AddressNormalizerTests`
Expected: **TEST SUCCEEDED** — all 10 cases pass.

- [ ] **Step 5: Add the observable browser model**

Create `ios/Blanc/BrowserModel.swift`:

```swift
import Observation
import Foundation

/// Single source of truth for the address bar and (grown in M1.2) navigation
/// state. `currentURL` is the page the WebView should show.
@Observable
final class BrowserModel {
    var addressText: String
    var currentURL: URL

    private let normalizer = AddressNormalizer(searchEngine: BlancSettingsDefaults.searchEngine)

    init(start: URL) {
        self.currentURL = start
        self.addressText = start.absoluteString
    }

    /// Navigate to whatever is typed in the address bar.
    func submitAddress() {
        let dest = normalizer.normalize(addressText)
        currentURL = dest
        addressText = dest.absoluteString
    }
}
```

- [ ] **Step 6: Point WebView at the model's URL**

In `ios/Blanc/WebView.swift`, change the stored `url` to come from the model. Replace the struct's stored property and both view methods:

```swift
struct WebView: UIViewRepresentable {
    let model: BrowserModel

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        context.coordinator.load(model.currentURL, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.load(model.currentURL, in: webView)
    }
    // Coordinator unchanged from Task 1.
}
```

- [ ] **Step 7: Wire the address field**

Replace `ios/Blanc/ContentView.swift`:

```swift
import SwiftUI

struct ContentView: View {
    @State private var model = BrowserModel(start: URL(string: "https://example.com")!)

    var body: some View {
        ZStack(alignment: .bottom) {
            (Color(blancHex: BlancTokens.bg(.light)) ?? .white)
                .ignoresSafeArea()
            WebView(model: model)
                .ignoresSafeArea(edges: .top)
            addressPill
        }
    }

    private var addressPill: some View {
        TextField("Search or enter address", text: $model.addressText)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.webSearch)
            .submitLabel(.go)
            .onSubmit { model.submitAddress() }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color(blancHex: BlancTokens.surfaceRaised(.light)) ?? .white)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Color(blancHex: BlancTokens.border(.light)) ?? .gray))
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
    }
}

#Preview { ContentView() }
```

- [ ] **Step 8: Build, run, and verify navigation by hand**

Run (⌘R). In the simulator: type `example.com` → **Go** → stays on example.com; clear it, type `how tall is everest` → **Go** → a DuckDuckGo results page loads. Then run the full suite (⌘U) — all tests still pass.

- [ ] **Step 9: Commit**

```bash
git add ios/Blanc/AddressNormalizer.swift ios/Blanc/BrowserModel.swift ios/BlancTests/AddressNormalizerTests.swift ios/Blanc/WebView.swift ios/Blanc/ContentView.swift ios/Blanc.xcodeproj
git commit -m "ios: address bar + tested AddressNormalizer (M1.1)"
```

---

### Task 4 (M1.2): Navigation state + back/forward/reload

Make the `Coordinator` the `WKNavigationDelegate` so the model reflects real page state, and add the nav controls.

**Files:**
- Modify: `ios/Blanc/BrowserModel.swift`, `ios/Blanc/WebView.swift`, `ios/Blanc/ContentView.swift`

**Interfaces:**
- Consumes: `BrowserModel`, `WebView`.
- Produces (added to `BrowserModel`): `var canGoBack: Bool`, `var canGoForward: Bool`, `var isLoading: Bool`, `var pageTitle: String`, `@ObservationIgnored weak var webView: WKWebView?`, `func goBack()`, `func goForward()`, `func reload()`, `func stop()`.

- [ ] **Step 1: Grow the model with nav state and commands**

In `ios/Blanc/BrowserModel.swift`, add `import WebKit` at the top and these members inside the class:

```swift
    var canGoBack = false
    var canGoForward = false
    var isLoading = false
    var pageTitle = ""

    @ObservationIgnored weak var webView: WKWebView?   // imperative handle, not observed state

    func goBack()    { webView?.goBack() }
    func goForward() { webView?.goForward() }
    func reload()    { webView?.reload() }
    func stop()      { webView?.stopLoading() }
```

- [ ] **Step 2: Make the Coordinator the navigation delegate**

In `ios/Blanc/WebView.swift`, replace the whole file:

```swift
import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    let model: BrowserModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        model.webView = webView
        context.coordinator.load(model.currentURL, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.load(model.currentURL, in: webView)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let model: BrowserModel
        weak var webView: WKWebView?
        private var lastRequested: URL?

        init(model: BrowserModel) { self.model = model }

        func load(_ url: URL, in webView: WKWebView) {
            guard url != lastRequested else { return }
            lastRequested = url
            webView.load(URLRequest(url: url))
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            model.isLoading = true
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { sync(webView) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { sync(webView) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { sync(webView) }

        private func sync(_ webView: WKWebView) {
            model.isLoading = webView.isLoading
            model.canGoBack = webView.canGoBack
            model.canGoForward = webView.canGoForward
            model.pageTitle = webView.title ?? ""
            if let u = webView.url {
                // Keep currentURL truthful: link taps and back/forward move the
                // page with no load() call. Set lastRequested *first* so the
                // resulting updateUIView sees currentURL == lastRequested and does
                // NOT reload — and so a view/coordinator recreation reloads where
                // we actually are, not a stale typed URL.
                lastRequested = u
                model.currentURL = u
                model.addressText = u.absoluteString
            }
        }
    }
}
```

- [ ] **Step 3: Add the nav controls to the pill**

In `ios/Blanc/ContentView.swift`, wrap the address field in an HStack with buttons. Replace `addressPill`:

```swift
    private var addressPill: some View {
        HStack(spacing: 10) {
            Button { model.goBack() } label: { Image(systemName: "chevron.left") }
                .disabled(!model.canGoBack)
            Button { model.goForward() } label: { Image(systemName: "chevron.right") }
                .disabled(!model.canGoForward)

            TextField("Search or enter address", text: $model.addressText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.webSearch)
                .submitLabel(.go)
                .onSubmit { model.submitAddress() }

            Button {
                model.isLoading ? model.stop() : model.reload()
            } label: {
                Image(systemName: model.isLoading ? "xmark" : "arrow.clockwise")
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
```

- [ ] **Step 4: Build, run, and verify by hand**

Run (⌘R). Navigate example.com → click a link → **back** returns, **forward** re-advances; the reload button toggles to an ✕ while loading; the address field updates to the loaded page's URL. Run ⌘U — all existing tests still pass (no new unit tests: this task is web-view-delegate behavior, verified by running).

- [ ] **Step 5: Commit**

```bash
git add ios/Blanc/BrowserModel.swift ios/Blanc/WebView.swift ios/Blanc/ContentView.swift
git commit -m "ios: navigation state + back/forward/reload (M1.2)"
```

---

### Task 5 (M1.3): OS hand-off for `mailto:`/`tel:`/etc. (TDD)

Classify hand-off schemes (D4) and route them to the OS instead of navigating — both for typed input and for in-page links.

**Files:**
- Create: `ios/Blanc/OSHandoff.swift`
- Create: `ios/BlancTests/OSHandoffTests.swift`
- Modify: `ios/Blanc/BrowserModel.swift`, `ios/Blanc/WebView.swift`

**Interfaces:**
- Produces: `enum OSHandoff { static let schemes: Set<String>; static func isHandoff(_ text: String) -> Bool; static func open(_ text: String) }`.
- Consumes: `BrowserModel.submitAddress()`, the `WebView.Coordinator`.

- [ ] **Step 1: Write the failing classification tests**

Create `ios/BlancTests/OSHandoffTests.swift`:

```swift
import XCTest
@testable import Blanc

final class OSHandoffTests: XCTestCase {
    func testMailtoIsHandoff()   { XCTAssertTrue(OSHandoff.isHandoff("mailto:a@b.com")) }
    func testTelIsHandoff()      { XCTAssertTrue(OSHandoff.isHandoff("tel:+15551234")) }
    func testFacetimeIsHandoff() { XCTAssertTrue(OSHandoff.isHandoff("facetime:a@b.com")) }
    func testSmsIsHandoff()      { XCTAssertTrue(OSHandoff.isHandoff("sms:+15551234")) }
    func testHttpsIsNotHandoff() { XCTAssertFalse(OSHandoff.isHandoff("https://example.com")) }
    func testBareDomainIsNotHandoff() { XCTAssertFalse(OSHandoff.isHandoff("example.com")) }
    func testSchemeIsCaseInsensitive() { XCTAssertTrue(OSHandoff.isHandoff("MAILTO:a@b.com")) }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `xcodebuild test -project ios/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BlancTests/OSHandoffTests`
Expected: **FAIL** — "Cannot find 'OSHandoff' in scope".

- [ ] **Step 3: Implement `OSHandoff`**

Create `ios/Blanc/OSHandoff.swift`:

```swift
import UIKit

/// Mirrors HANDOFF_PROTOCOLS in src/main/main.js (D4). These URIs have no
/// "://" and would otherwise be misread as a search query; hand them to the OS.
enum OSHandoff {
    static let schemes: Set<String> = ["mailto", "tel", "facetime", "sms"]

    static func isHandoff(_ text: String) -> Bool {
        guard let scheme = URL(string: text)?.scheme?.lowercased() else { return false }
        return schemes.contains(scheme)
    }

    static func open(_ text: String) {
        guard let url = URL(string: text) else { return }
        UIApplication.shared.open(url)
    }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `xcodebuild test -project ios/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BlancTests/OSHandoffTests`
Expected: **TEST SUCCEEDED** — all 7 pass.

- [ ] **Step 5: Hand off typed input before normalizing**

In `ios/Blanc/BrowserModel.swift`, guard `submitAddress()` (this is the desktop rule: hand-off is checked on the raw text before `normalizeAddressInput`):

```swift
    func submitAddress() {
        if OSHandoff.isHandoff(addressText) {
            OSHandoff.open(addressText)
            return
        }
        let dest = normalizer.normalize(addressText)
        currentURL = dest
        addressText = dest.absoluteString
    }
```

- [ ] **Step 6: Hand off in-page link navigations**

In `ios/Blanc/WebView.swift`, add this method to `Coordinator` (matches desktop's will-navigate hook):

```swift
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
```

Add `import UIKit` at the top of `WebView.swift` (below `import WebKit`) so `UIApplication` resolves.

- [ ] **Step 7: Build, run, and verify by hand**

Run (⌘R). Type `mailto:test@example.com` → **Go** → the simulator's Mail compose (or the "no mail account" system alert) appears and the page does **not** navigate to a search. Regular navigation still works. Run ⌘U — full suite green.

- [ ] **Step 8: Commit**

```bash
git add ios/Blanc/OSHandoff.swift ios/BlancTests/OSHandoffTests.swift ios/Blanc/BrowserModel.swift ios/Blanc/WebView.swift ios/Blanc.xcodeproj
git commit -m "ios: OS hand-off for mailto/tel/facetime/sms (M1.3, D4)"
```

---

### Task 6 (parallel logistics — start during M0): Request the default-browser entitlement

Roadmap §7 mandates requesting this *during M0–M1* so Apple has granted it by the M6 beta. It has approval lead time and **no code dependency** — run it in parallel with Task 0. This task is the one exception to "ends in a commit": its deliverable is a submitted request, not a repo artifact.

- [ ] **Step 1: Submit the request**

In the Apple Developer portal (developer.apple.com), request the managed **default-browser** capability (`com.apple.developer.web-browser`). It is **not** self-serve — Apple reviews and grants it, which is exactly why it starts now rather than at M6.

- [ ] **Step 2: Record it and note the deferred wiring**

Note the request date/status in your logistics tracker. The actual wiring — adding `com.apple.developer.web-browser` to the app's `.entitlements` and the default-browser `Info.plist` keys — happens at **M6 once granted**, not here. No commit in this plan.

---

### Task 7 (DoD): Update the parity matrix

Reflect what M0–M1 delivered in the authoritative spec tracking (roadmap §8: "Definition of Done includes parity matrix updated").

**Files:**
- Modify: `spec/parity-matrix.md`, `spec/acceptance/index.md`

- [ ] **Step 1: Set the iOS status cells in `spec/parity-matrix.md`**

- **F5** iOS → `PARTIAL` (address/search implemented + unit-tested; iOS acceptance step-defs are the separate S6 track).
- **F1** iOS → `PARTIAL` (a minimal resting address surface only; the full pill/palette is M3).
- **F23** iOS **stays `DIVERGENT (D10)`** — do *not* relabel; pinch-zoom via `WKWebView` now realizes that divergence.

- [ ] **Step 2: Leave `spec/acceptance/index.md` iOS cells honest**

Keep F5-1/F5-2/F5-3 iOS cells as ⬜ (not run) — automated iOS verification requires the iOS step-definition track (S6), which is **not** in this plan. Do not mark them ✅. (Optional: add a one-line footnote that F5 is implemented pending step-def binding.)

- [ ] **Step 3: Commit**

```bash
git add spec/parity-matrix.md spec/acceptance/index.md
git commit -m "spec: iOS parity matrix — F5/F1 PARTIAL after M0-M1 walking skeleton"
```

---

## Milestone exit criteria (M0–M1)

A single-tab browser that: launches natively; loads web content full-screen; navigates from typed URLs, domains, `localhost`/IPv4, and search queries (DuckDuckGo default, matching desktop `normalizeAddressInput`); supports back/forward/reload with live enabled/disabled state; and hands `mailto:`/`tel:`/`facetime:`/`sms:` to the OS. All `AddressNormalizer`, `OSHandoff`, and hex-parser logic is unit-tested and green. In parallel, the default-browser entitlement request is submitted (Task 6 — Apple lead time).

**Parity-matrix (DoD → Task 7):** F5 iOS → `PARTIAL` (address/search implemented + unit-tested; iOS acceptance step-defs are the separate S6 track), F1 iOS → `PARTIAL` (minimal address surface only; the full pill/palette is M3), and F23 iOS **stays `DIVERGENT (D10)`** — pinch-zoom via `WKWebView` realizes that divergence rather than relabeling it. **Not** in scope here: tabs (F2, M2), the full island/palette (F1, M3), internal pages (F16, M4), ad-blocking (F12, M5).

## Next milestone

M2 (tabs) re-enters brainstorm → spec → plan at its own boundary; it builds directly on `BrowserModel` (one model per tab) and `WebView`.
