# iOS M4: `blanc://` Internal Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the unchanged `src/renderer/pages/` shared web bundle inside `WKWebView` via a `blanc://` scheme handler plus a `window.bowserPages` JS↔native data bridge, so new tabs open to the newtab ledger.

**Architecture:** Three new files, each one responsibility: `BlancSchemeHandler.swift` (a pure `BlancPageResolver` for path→filename/MIME decisions + the thin `WKURLSchemeHandler` that reads the bundle), `PagesBridge.swift` (a pure `response(group:method:appVersion:)` shape builder + a `WKScriptMessageHandler` adapter + the injected JS shim), and `WebViewConfiguration.swift` (a factory that installs both onto a `WKWebViewConfiguration`). `TabModel`/`TabsManager`/`ContentView` are modified to build web views from that configuration and open `blanc://newtab/`. The pages folder is added to the app target as an Xcode **folder reference**.

**Tech Stack:** SwiftUI, `@Observable` (iOS 17+), `WKWebView`, `WKURLSchemeHandler`, `WKScriptMessageHandler`, `WKUserScript`, `JSONSerialization`-free hand-built JSON via a small `JSONValue` enum.

## Global Constraints

- **Shared bundle is never edited.** `src/renderer/pages/*` is the S4 single source of truth; M4 only *serves* it. No edits to any file under `src/renderer/pages/`.
- **Generated files are consumed as-is, never hand-edited:** `ios/Blanc/Tokens.swift`, `ios/Blanc/BlancSettings.swift`.
- **The injected global keeps the name `window.bowserPages`** — an internal identifier the shared bundle depends on; not renamed in the rebrand.
- **Scheme handler follows desktop `path.basename` model:** known-host allowlist `{newtab, bookmarks, history, downloads, settings, error, shortcuts}`; deeper paths reduced to basename and validated against `^[\w.-]+$`; served from one flat directory. `auth` is excluded.
- **Bridge response shapes are exact** (they are what `settings.js` and `newtab.js` read back): `permissions.list()` → `{}` (a record, not `[]`); `settings.syncGet()`/`syncNow()` → `{ enabled: false }`; `syncEnable(...)` → `{ ok: false, created: false, message, status: { enabled: false } }`; `syncDisable(...)` → `{ status: { enabled: false } }`; `activateSupporter(...)` → `{ ok: false, message }`; `defaultBrowser.get()`/`set()` → `{ isDefault: false, canSet: false }`; `start.data()` → `{ groups: [], blockedThisWeek: 0 }`; list reads → `[]`; no-op writes → `null`; unknown group/method → **rejects**.
- **`settings.get()` reads defaults from `BlancSettingsDefaults`** (never hardcode the values), so the stub always reflects the real generated defaults (including `usagePing`, which intentionally defaults `true` — telemetry now defaults opted-in).
- **No iOS 26+ APIs in M4** — `WKURLSchemeHandler`/`WKScriptMessageHandler`/`evaluateJavaScript` are all long-available; no `#available` gates are needed.
- **Xcode 26 filesystem-synchronized groups:** new `.swift` files dropped in `ios/Blanc/Blanc/` or `ios/Blanc/BlancTests/` are auto-included in their target. Only the out-of-tree pages folder needs an explicit `project.pbxproj` edit.
- **Build/test destination:** this environment has an **iPhone 17** simulator, not iPhone 16 (Tasks in M3 used iPhone 17).

---

### Task 1: Scheme handler — path resolver + MIME + `WKURLSchemeHandler`

**Files:**
- Create: `ios/Blanc/Blanc/BlancSchemeHandler.swift`
- Create: `ios/Blanc/BlancTests/BlancSchemeHandlerTests.swift`

**Interfaces:**
- Consumes: `Bundle.main` (reads bundled `pages/` folder at runtime).
- Produces:
  - `enum BlancPageResolver` with `static let knownPages: Set<String>`, `static func resolvedFilename(host: String, path: String) -> String?`, `static func mimeType(forFilename filename: String) -> String`.
  - `final class BlancSchemeHandler: NSObject, WKURLSchemeHandler` (used by Task 3's configuration factory).

- [ ] **Step 1: Write the failing tests**

Create `ios/Blanc/BlancTests/BlancSchemeHandlerTests.swift`:

```swift
import XCTest
@testable import Blanc

final class BlancSchemeHandlerTests: XCTestCase {
    // Root path serves <host>.html for a known host.
    func testKnownHostRootServesPageHtml() {
        XCTAssertEqual(BlancPageResolver.resolvedFilename(host: "newtab", path: "/"), "newtab.html")
        XCTAssertEqual(BlancPageResolver.resolvedFilename(host: "settings", path: ""), "settings.html")
    }

    // Unknown host is rejected outright.
    func testUnknownHostRejected() {
        XCTAssertNil(BlancPageResolver.resolvedFilename(host: "evil", path: "/"))
        XCTAssertNil(BlancPageResolver.resolvedFilename(host: "", path: "/"))
    }

    // A flat asset path resolves to that filename.
    func testFlatAssetResolves() {
        XCTAssertEqual(BlancPageResolver.resolvedFilename(host: "newtab", path: "/pages.css"), "pages.css")
        XCTAssertEqual(BlancPageResolver.resolvedFilename(host: "newtab", path: "/newtab.js"), "newtab.js")
        XCTAssertEqual(BlancPageResolver.resolvedFilename(host: "newtab", path: "/icon.svg"), "icon.svg")
    }

    // Directory components collapse to the basename (desktop path.basename parity).
    func testDirectoryComponentsCollapseToBasename() {
        XCTAssertEqual(BlancPageResolver.resolvedFilename(host: "newtab", path: "/sub/pages.css"), "pages.css")
    }

    // Traversal is defeated by basename: it strips to a filename confined to the
    // flat dir (which then 404s at serve time because it isn't a bundled asset).
    func testTraversalCollapsesToBasename() {
        XCTAssertEqual(BlancPageResolver.resolvedFilename(host: "newtab", path: "/../../etc/passwd"), "passwd")
    }

    // A basename failing the charset allowlist is rejected.
    func testInvalidCharsetRejected() {
        XCTAssertNil(BlancPageResolver.resolvedFilename(host: "newtab", path: "/bad name.css"))
        XCTAssertNil(BlancPageResolver.resolvedFilename(host: "newtab", path: "/weird%00.css"))
    }

    // MIME types for the extensions the bundle uses.
    func testMimeTypes() {
        XCTAssertEqual(BlancPageResolver.mimeType(forFilename: "newtab.html"), "text/html")
        XCTAssertEqual(BlancPageResolver.mimeType(forFilename: "pages.css"), "text/css")
        XCTAssertEqual(BlancPageResolver.mimeType(forFilename: "newtab.js"), "text/javascript")
        XCTAssertEqual(BlancPageResolver.mimeType(forFilename: "icon.svg"), "image/svg+xml")
        XCTAssertEqual(BlancPageResolver.mimeType(forFilename: "icon.png"), "image/png")
    }

    // An unmapped/absent extension falls back to octet-stream.
    func testUnknownExtensionMime() {
        XCTAssertEqual(BlancPageResolver.mimeType(forFilename: "passwd"), "application/octet-stream")
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BlancTests/BlancSchemeHandlerTests 2>&1 | tail -20`
Expected: FAIL — `cannot find 'BlancPageResolver' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/Blanc/Blanc/BlancSchemeHandler.swift`:

```swift
import Foundation
import WebKit

/// Pure path→file decision logic for the `blanc://` scheme, mirroring the
/// desktop `pages.js` model: a known-host allowlist, `path.basename`
/// reduction, a charset allowlist, and a flat serving directory. No I/O —
/// unit-testable without a bundle or a web view.
enum BlancPageResolver {
    /// Hosts that map to a bundled `<host>.html`. `auth` is intentionally
    /// excluded (basic-auth is native on iOS, M12).
    static let knownPages: Set<String> = [
        "newtab", "bookmarks", "history", "downloads", "settings", "error", "shortcuts",
    ]

    private static let filenamePattern = try! NSRegularExpression(pattern: "^[\\w.-]+$")

    /// The flat filename to serve within the bundled `pages/` folder, or
    /// `nil` to reject the request. Traversal is defeated by taking the
    /// basename: `../../etc/passwd` collapses to `passwd`, which then simply
    /// isn't a bundled asset and 404s at serve time.
    static func resolvedFilename(host: String, path: String) -> String? {
        guard knownPages.contains(host) else { return nil }
        if path.isEmpty || path == "/" { return "\(host).html" }
        let basename = (path as NSString).lastPathComponent
        guard !basename.isEmpty else { return nil }
        let range = NSRange(basename.startIndex..., in: basename)
        guard filenamePattern.firstMatch(in: basename, range: range) != nil else { return nil }
        return basename
    }

    /// MIME type by extension, defaulting to octet-stream for anything the
    /// bundle doesn't use.
    static func mimeType(forFilename filename: String) -> String {
        switch (filename as NSString).pathExtension.lowercased() {
        case "html": return "text/html"
        case "css": return "text/css"
        case "js": return "text/javascript"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "json": return "application/json"
        default: return "application/octet-stream"
        }
    }
}

/// Serves the shared web bundle over `blanc://`. Stateless — one instance is
/// safe to install on every tab's configuration.
final class BlancSchemeHandler: NSObject, WKURLSchemeHandler {
    /// The bundled folder-reference name (`src/renderer/pages` copies in as `pages`).
    private static let bundleSubdirectory = "pages"

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let request = urlSchemeTask.request
        guard let url = request.url,
              let host = url.host,
              let filename = BlancPageResolver.resolvedFilename(host: host, path: url.path),
              let fileURL = Bundle.main.url(
                  forResource: (filename as NSString).deletingPathExtension,
                  withExtension: (filename as NSString).pathExtension,
                  subdirectory: Self.bundleSubdirectory),
              let data = try? Data(contentsOf: fileURL)
        else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": BlancPageResolver.mimeType(forFilename: filename)])!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // No async work to cancel — serving is synchronous.
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BlancTests/BlancSchemeHandlerTests 2>&1 | tail -20`
Expected: `** TEST SUCCEEDED **`, 8/8 passing.

- [ ] **Step 5: Commit**

```bash
git add ios/Blanc/Blanc/BlancSchemeHandler.swift ios/Blanc/BlancTests/BlancSchemeHandlerTests.swift
git commit -m "ios: blanc:// scheme handler — path resolver + WKURLSchemeHandler"
```

---

### Task 2: Pages bridge — `JSONValue`, response shapes, shim, message handler

**Files:**
- Create: `ios/Blanc/Blanc/PagesBridge.swift`
- Create: `ios/Blanc/BlancTests/PagesBridgeTests.swift`

**Interfaces:**
- Consumes: `BlancSearchEngine`, `BlancAppIcon`, `BlancSettingsDefaults` (from generated `BlancSettings.swift`); `TabsManager` (held weakly, for future milestones).
- Produces:
  - `indirect enum JSONValue: Equatable` with `.string/.number/.bool/.null/.array/.object([(String, JSONValue)])` and `var serialized: String`.
  - `enum BridgeResult: Equatable { case value(JSONValue); case reject(String) }`.
  - `final class PagesBridge: NSObject, WKScriptMessageHandler` with `init(manager: TabsManager)`, `static let messageHandlerName = "blancPages"`, `static let userScriptSource: String`, and `static func response(group: String?, method: String, appVersion: String) -> BridgeResult` (used by Task 3's configuration factory).

- [ ] **Step 1: Write the failing tests**

Create `ios/Blanc/BlancTests/PagesBridgeTests.swift`:

```swift
import XCTest
@testable import Blanc

final class PagesBridgeTests: XCTestCase {
    private func value(_ group: String?, _ method: String) -> JSONValue {
        guard case .value(let v) = PagesBridge.response(group: group, method: method, appVersion: "9.9") else {
            XCTFail("expected a value for \(group ?? "root").\(method)")
            return .null
        }
        return v
    }

    // JSONValue serializes deterministically (ordered object pairs).
    func testJSONValueSerialization() {
        XCTAssertEqual(JSONValue.array([]).serialized, "[]")
        XCTAssertEqual(JSONValue.object([]).serialized, "{}")
        XCTAssertEqual(JSONValue.bool(false).serialized, "false")
        XCTAssertEqual(JSONValue.null.serialized, "null")
        XCTAssertEqual(
            JSONValue.object([("ok", .bool(false)), ("message", .string("x"))]).serialized,
            "{\"ok\":false,\"message\":\"x\"}")
    }

    // appVersion echoes the passed version as a JSON string.
    func testAppVersion() {
        XCTAssertEqual(value(nil, "appVersion"), .string("9.9"))
    }

    // List reads are empty arrays; permissions is a RECORD ({}), not [].
    func testEmptyReads() {
        XCTAssertEqual(value("bookmarks", "list"), .array([]))
        XCTAssertEqual(value("history", "list"), .array([]))
        XCTAssertEqual(value("downloads", "list"), .array([]))
        XCTAssertEqual(value("permissions", "list"), .object([]))
    }

    // No-op writes resolve to null.
    func testNoOpWrites() {
        XCTAssertEqual(value("bookmarks", "remove"), .null)
        XCTAssertEqual(value("history", "clear"), .null)
        XCTAssertEqual(value("downloads", "clearFinished"), .null)
        XCTAssertEqual(value("settings", "set"), .null)
        XCTAssertEqual(value("start", "focusGroup"), .null)
    }

    // Structured sync/supporter/default-browser shapes match what settings.js reads.
    func testStructuredShapes() {
        XCTAssertEqual(value("settings", "syncGet"), .object([("enabled", .bool(false))]))
        XCTAssertEqual(value("settings", "syncNow"), .object([("enabled", .bool(false))]))
        XCTAssertEqual(value("settings", "syncDisable"),
                       .object([("status", .object([("enabled", .bool(false))]))]))
        XCTAssertEqual(value("settings", "syncEnable"),
                       .object([
                           ("ok", .bool(false)),
                           ("created", .bool(false)),
                           ("message", .string("Sync isn’t available in this build yet.")),
                           ("status", .object([("enabled", .bool(false))])),
                       ]))
        XCTAssertEqual(value("settings", "activateSupporter"),
                       .object([
                           ("ok", .bool(false)),
                           ("message", .string("Supporter activation isn’t available in this build yet.")),
                       ]))
        XCTAssertEqual(value("defaultBrowser", "get"),
                       .object([("isDefault", .bool(false)), ("canSet", .bool(false))]))
        XCTAssertEqual(value("defaultBrowser", "set"),
                       .object([("isDefault", .bool(false)), ("canSet", .bool(false))]))
    }

    // start.data has empty groups and a zero blocked count.
    func testStartData() {
        XCTAssertEqual(value("start", "data"),
                       .object([("groups", .array([])), ("blockedThisWeek", .number(0))]))
    }

    // settings.get returns the full bootstrap payload built from the generated
    // substrate: settings/searchEngines/appIcons/supporterIcons.
    func testSettingsGetShape() {
        guard case .object(let pairs) = value("settings", "get") else {
            return XCTFail("settings.get should be an object")
        }
        let keys = pairs.map(\.0)
        XCTAssertEqual(keys, ["settings", "searchEngines", "appIcons", "supporterIcons"])

        let dict = Dictionary(uniqueKeysWithValues: pairs)
        // 4 search engines, 8 free icons, 3 supporter icons.
        if case .object(let engines)? = dict["searchEngines"] { XCTAssertEqual(engines.count, 4) }
        else { XCTFail("searchEngines must be a record") }
        if case .object(let icons)? = dict["appIcons"] { XCTAssertEqual(icons.count, 8) }
        else { XCTFail("appIcons must be a record") }
        if case .object(let sup)? = dict["supporterIcons"] {
            XCTAssertEqual(sup.map(\.0).sorted(), ["ember", "gold", "plum"])
        } else { XCTFail("supporterIcons must be a record") }

        // usagePing comes from BlancSettingsDefaults, not a hardcode.
        if case .object(let s)? = dict["settings"] {
            let sd = Dictionary(uniqueKeysWithValues: s)
            XCTAssertEqual(sd["usagePing"], JSONValue.bool(BlancSettingsDefaults.usagePing))
            XCTAssertEqual(sd["searchEngine"], JSONValue.string(BlancSettingsDefaults.searchEngine.rawValue))
            XCTAssertEqual(sd["supporterActive"], JSONValue.bool(false))
        } else { XCTFail("settings must be an object") }
    }

    // shortcuts.list is stubbed (typeable via the address bar), not rejected.
    func testShortcutsListStubbed() {
        XCTAssertEqual(value("shortcuts", "list"), .array([]))
    }

    // A genuinely unknown group/method rejects rather than resolving.
    func testUnknownRejects() {
        switch PagesBridge.response(group: "bogus", method: "nope", appVersion: "9.9") {
        case .reject: break
        case .value: XCTFail("unknown method should reject")
        }
        switch PagesBridge.response(group: "settings", method: "teleport", appVersion: "9.9") {
        case .reject: break  // unknown method on a known group still rejects
        case .value: XCTFail("settings.teleport should reject")
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BlancTests/PagesBridgeTests 2>&1 | tail -20`
Expected: FAIL — `cannot find 'PagesBridge' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/Blanc/Blanc/PagesBridge.swift`:

```swift
import Foundation
import WebKit

/// A minimal, order-preserving JSON value. Object pairs keep insertion order
/// so `serialized` is deterministic (unit-testable) and valid for embedding
/// directly into a `window.__blancResolve(...)` call.
indirect enum JSONValue: Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([(String, JSONValue)])

    static func == (lhs: JSONValue, rhs: JSONValue) -> Bool {
        switch (lhs, rhs) {
        case (.string(let a), .string(let b)): return a == b
        case (.number(let a), .number(let b)): return a == b
        case (.bool(let a), .bool(let b)): return a == b
        case (.null, .null): return true
        case (.array(let a), .array(let b)): return a == b
        case (.object(let a), .object(let b)):
            return a.count == b.count && zip(a, b).allSatisfy { pair in
                pair.0.0 == pair.1.0 && pair.0.1 == pair.1.1
            }
        default: return false
        }
    }

    var serialized: String {
        switch self {
        case .string(let s): return Self.encodeString(s)
        case .number(let n):
            if n == n.rounded() && abs(n) < 1e15 { return String(Int(n)) }
            return String(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        case .array(let items): return "[" + items.map(\.serialized).joined(separator: ",") + "]"
        case .object(let pairs):
            return "{" + pairs.map { "\(Self.encodeString($0.0)):\($0.1.serialized)" }.joined(separator: ",") + "}"
        }
    }

    private static func encodeString(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }
}

enum BridgeResult: Equatable {
    case value(JSONValue)
    case reject(String)
}

/// The `window.bowserPages` bridge: a JS shim (injected only into `blanc://`
/// documents) plus a native message handler that answers each call. At M4
/// every reachable page's methods return empty/default data; unknown methods
/// reject.
final class PagesBridge: NSObject, WKScriptMessageHandler {
    static let messageHandlerName = "blancPages"
    private weak var manager: TabsManager?

    init(manager: TabsManager) {
        self.manager = manager
        super.init()
    }

    // MARK: Response shapes (pure — unit-tested)

    static func response(group: String?, method: String, appVersion: String) -> BridgeResult {
        let disabledStatus = JSONValue.object([("enabled", .bool(false))])

        // Switch over a non-optional first element ("" == the null-group,
        // top-level methods) to avoid optional-literal pattern ambiguity.
        switch (group ?? "", method) {
        case ("", "appVersion"): return .value(.string(appVersion))
        case ("", "clearBrowsingData"): return .value(.null)

        case ("bookmarks", "list"): return .value(.array([]))
        case ("bookmarks", "remove"), ("bookmarks", "clearFavicon"): return .value(.null)

        case ("history", "list"): return .value(.array([]))
        case ("history", "remove"), ("history", "clear"): return .value(.null)

        case ("downloads", "list"): return .value(.array([]))
        case ("downloads", "cancel"), ("downloads", "open"),
             ("downloads", "show"), ("downloads", "clearFinished"): return .value(.null)

        case ("settings", "get"): return .value(settingsBootstrap())
        case ("settings", "set"): return .value(.null)
        case ("settings", "syncGet"), ("settings", "syncNow"): return .value(disabledStatus)
        case ("settings", "syncDisable"): return .value(.object([("status", disabledStatus)]))
        case ("settings", "syncEnable"):
            return .value(.object([
                ("ok", .bool(false)),
                ("created", .bool(false)),
                ("message", .string("Sync isn’t available in this build yet.")),
                ("status", disabledStatus),
            ]))
        case ("settings", "activateSupporter"):
            return .value(.object([
                ("ok", .bool(false)),
                ("message", .string("Supporter activation isn’t available in this build yet.")),
            ]))

        case ("permissions", "list"): return .value(.object([]))
        case ("permissions", "remove"): return .value(.null)

        case ("defaultBrowser", "get"), ("defaultBrowser", "set"):
            return .value(.object([("isDefault", .bool(false)), ("canSet", .bool(false))]))

        case ("start", "data"):
            return .value(.object([("groups", .array([])), ("blockedThisWeek", .number(0))]))
        case ("start", "focusGroup"): return .value(.null)

        // `shortcuts` is not linked from any page, but `blanc://shortcuts/` is
        // typeable in the address bar (AddressNormalizer accepts any scheme),
        // so its one read is stubbed rather than left to reject.
        case ("shortcuts", "list"): return .value(.array([]))

        default:
            return .reject("Unknown method: \(group ?? "root").\(method)")
        }
    }

    /// The `{ settings, searchEngines, appIcons, supporterIcons }` payload
    /// `settings.js` reads on load, built from the generated substrate so
    /// values track `BlancSettingsDefaults` (no hardcoded defaults).
    private static func settingsBootstrap() -> JSONValue {
        let settings = JSONValue.object([
            ("theme", .string(BlancSettingsDefaults.theme.rawValue)),
            ("searchEngine", .string(BlancSettingsDefaults.searchEngine.rawValue)),
            ("adblockEnabled", .bool(BlancSettingsDefaults.adblockEnabled)),
            ("homePage", .string(BlancSettingsDefaults.homePage)),
            ("usagePing", .bool(BlancSettingsDefaults.usagePing)),
            ("appIcon", .string(BlancSettingsDefaults.appIcon.rawValue)),
            ("adblockExceptions", .array([])),
            ("supporterActive", .bool(false)),
        ])
        let searchEngines = JSONValue.object(
            BlancSearchEngine.allCases.map { ($0.rawValue, .string($0.label)) })
        let freeIcons = BlancAppIcon.allCases.filter { !$0.isSupporterOnly }
        let supporterIcons = BlancAppIcon.allCases.filter { $0.isSupporterOnly }
        let appIcons = JSONValue.object(freeIcons.map { ($0.rawValue, .string($0.label)) })
        let supporter = JSONValue.object(supporterIcons.map { ($0.rawValue, .string($0.label)) })
        return .object([
            ("settings", settings),
            ("searchEngines", searchEngines),
            ("appIcons", appIcons),
            ("supporterIcons", supporter),
        ])
    }

    // MARK: JS shim

    /// Defines `window.bowserPages` at document-start, gated to `blanc://`
    /// documents (mirrors `tab-preload.js`). Each method posts `{id, group,
    /// method, args}` and returns a promise resolved by `window.__blancResolve`.
    static let userScriptSource = #"""
    (function () {
      if (location.protocol !== 'blanc:') return;
      const pending = new Map();
      let seq = 0;
      window.__blancResolve = function (id, ok, payload) {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        ok ? p.resolve(payload) : p.reject(new Error(payload));
      };
      function call(group, method, args) {
        return new Promise(function (resolve, reject) {
          const id = ++seq;
          pending.set(id, { resolve: resolve, reject: reject });
          window.webkit.messageHandlers.blancPages.postMessage({
            id: id, group: group, method: method, args: args == null ? null : args,
          });
        });
      }
      window.bowserPages = {
        appVersion: function () { return call(null, 'appVersion'); },
        clearBrowsingData: function () { return call(null, 'clearBrowsingData'); },
        bookmarks: {
          list: function () { return call('bookmarks', 'list'); },
          remove: function (id) { return call('bookmarks', 'remove', { id: id }); },
          clearFavicon: function (url) { return call('bookmarks', 'clearFavicon', { url: url }); },
        },
        history: {
          list: function (opts) { return call('history', 'list', opts); },
          remove: function (url, visitedAt) { return call('history', 'remove', { url: url, visitedAt: visitedAt }); },
          clear: function () { return call('history', 'clear'); },
        },
        downloads: {
          list: function () { return call('downloads', 'list'); },
          cancel: function (id) { return call('downloads', 'cancel', { id: id }); },
          open: function (id) { return call('downloads', 'open', { id: id }); },
          show: function (id) { return call('downloads', 'show', { id: id }); },
          clearFinished: function () { return call('downloads', 'clearFinished'); },
        },
        settings: {
          get: function () { return call('settings', 'get'); },
          set: function (patch) { return call('settings', 'set', patch); },
          syncGet: function () { return call('settings', 'syncGet'); },
          syncEnable: function (opts) { return call('settings', 'syncEnable', opts); },
          syncDisable: function (opts) { return call('settings', 'syncDisable', opts); },
          syncNow: function () { return call('settings', 'syncNow'); },
          activateSupporter: function (key) { return call('settings', 'activateSupporter', { key: key }); },
        },
        permissions: {
          list: function () { return call('permissions', 'list'); },
          remove: function (key) { return call('permissions', 'remove', { key: key }); },
        },
        defaultBrowser: {
          get: function () { return call('defaultBrowser', 'get'); },
          set: function () { return call('defaultBrowser', 'set'); },
        },
        start: {
          data: function () { return call('start', 'data'); },
          focusGroup: function (id) { return call('start', 'focusGroup', { id: id }); },
        },
        shortcuts: {
          list: function () { return call('shortcuts', 'list'); },
        },
      };
    })();
    """#

    // MARK: Message handling

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        // Re-verify the sender is a blanc:// document (belt-and-suspenders,
        // matching desktop's pages.js re-check).
        guard let webView = message.webView,
              webView.url?.scheme == "blanc",
              let body = message.body as? [String: Any],
              let id = body["id"] as? Int else { return }

        let group = body["group"] as? String
        let method = body["method"] as? String ?? ""
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"

        let payload: String
        let ok: Bool
        switch Self.response(group: group, method: method, appVersion: version) {
        case .value(let v): payload = v.serialized; ok = true
        case .reject(let message): payload = JSONValue.string(message).serialized; ok = false
        }

        let js = "window.__blancResolve(\(id), \(ok), \(payload));"
        webView.evaluateJavaScript(js)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BlancTests/PagesBridgeTests 2>&1 | tail -20`
Expected: `** TEST SUCCEEDED **`, all passing.

- [ ] **Step 5: Commit**

```bash
git add ios/Blanc/Blanc/PagesBridge.swift ios/Blanc/BlancTests/PagesBridgeTests.swift
git commit -m "ios: bowserPages bridge — response shapes, JS shim, message handler"
```

---

### Task 3: Wire it up — bundle folder reference, configuration factory, newtab

**Files:**
- Create: `ios/Blanc/Blanc/WebViewConfiguration.swift`
- Modify: `ios/Blanc/Blanc/TabModel.swift` (init from a configuration)
- Modify: `ios/Blanc/Blanc/TabsManager.swift` (own handler+bridge; newtab default URL)
- Modify: `ios/Blanc/Blanc/ContentView.swift` (display "New Tab" for `blanc://newtab`)
- Modify: `ios/Blanc/Blanc.xcodeproj/project.pbxproj` (pages folder reference)

**Interfaces:**
- Consumes: `BlancSchemeHandler` (Task 1), `PagesBridge` (Task 2), `TabsManager`, `TabModel`.
- Produces: `enum WebViewConfiguration { static func make(schemeHandler:bridge:) -> WKWebViewConfiguration }`; `TabModel.init(url:configuration:)`.

- [ ] **Step 1: Add the pages folder reference to the Xcode project**

The pages folder lives outside the `ios/` tree, so the filesystem-synchronized group cannot auto-include it — it needs an explicit folder reference (a blue folder that copies verbatim into the app bundle as `pages/`). Make four exact edits to `ios/Blanc/Blanc.xcodeproj/project.pbxproj`.

Edit 1 — add a `PBXBuildFile` (in the `PBXBuildFile` section):

Find:
```
		502D58322FFEC0EE00B5B1DE /* BlancSettings.swift in Sources */ = {isa = PBXBuildFile; fileRef = 502D58312FFEC0EE00B5B1DE /* BlancSettings.swift */; };
/* End PBXBuildFile section */
```
Replace with:
```
		502D58322FFEC0EE00B5B1DE /* BlancSettings.swift in Sources */ = {isa = PBXBuildFile; fileRef = 502D58312FFEC0EE00B5B1DE /* BlancSettings.swift */; };
		502D58412FFED0A000B5B1DE /* pages in Resources */ = {isa = PBXBuildFile; fileRef = 502D58402FFED0A000B5B1DE /* pages */; };
/* End PBXBuildFile section */
```

Edit 2 — add the `PBXFileReference` folder (in the `PBXFileReference` section):

Find:
```
		502D58312FFEC0EE00B5B1DE /* BlancSettings.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = BlancSettings.swift; sourceTree = "<group>"; };
/* End PBXFileReference section */
```
Replace with:
```
		502D58312FFEC0EE00B5B1DE /* BlancSettings.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = BlancSettings.swift; sourceTree = "<group>"; };
		502D58402FFED0A000B5B1DE /* pages */ = {isa = PBXFileReference; lastKnownFileType = folder; name = pages; path = "../../src/renderer/pages"; sourceTree = "<group>"; };
/* End PBXFileReference section */
```

Edit 3 — add the folder to the app target's Resources build phase:

Find:
```
		502D57F52FFEBF0C00B5B1DE /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			files = (
			);
		};
		502D58022FFEBF0D00B5B1DE /* Resources */ = {
```
Replace with:
```
		502D57F52FFEBF0C00B5B1DE /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			files = (
				502D58412FFED0A000B5B1DE /* pages in Resources */,
			);
		};
		502D58022FFEBF0D00B5B1DE /* Resources */ = {
```

Edit 4 — attach the folder reference to the root `PBXGroup`'s children, so its `sourceTree = "<group>"` resolves relative to `SOURCE_ROOT` (`ios/Blanc/`) and it appears in the navigator:

Find:
```
		502D57EE2FFEBF0C00B5B1DE = {
			isa = PBXGroup;
			children = (
				502D58312FFEC0EE00B5B1DE /* BlancSettings.swift */,
				502D582F2FFEC0C300B5B1DE /* Tokens.swift */,
				502D57F92FFEBF0C00B5B1DE /* Blanc */,
```
Replace with:
```
		502D57EE2FFEBF0C00B5B1DE = {
			isa = PBXGroup;
			children = (
				502D58402FFED0A000B5B1DE /* pages */,
				502D58312FFEC0EE00B5B1DE /* BlancSettings.swift */,
				502D582F2FFEC0C300B5B1DE /* Tokens.swift */,
				502D57F92FFEBF0C00B5B1DE /* Blanc */,
```

- [ ] **Step 2: Create the configuration factory**

Create `ios/Blanc/Blanc/WebViewConfiguration.swift`:

```swift
import Foundation
import WebKit

/// Builds a `WKWebViewConfiguration` that serves `blanc://` from the bundle
/// and injects the `window.bowserPages` bridge. The handler and bridge are
/// shared (stateless / keyed off `message.webView`), so the same instances
/// are installed on every tab's configuration.
enum WebViewConfiguration {
    static func make(schemeHandler: BlancSchemeHandler, bridge: PagesBridge) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "blanc")

        let userScript = WKUserScript(
            source: PagesBridge.userScriptSource,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true)
        config.userContentController.addUserScript(userScript)
        config.userContentController.add(bridge, name: PagesBridge.messageHandlerName)
        return config
    }
}
```

- [ ] **Step 3: Update `TabModel` to build from a configuration**

In `ios/Blanc/Blanc/TabModel.swift`, replace the `init(url:)` (currently lines 18–27) so it accepts a configuration:

```swift
    init(url: URL, configuration: WKWebViewConfiguration) {
        self.currentURL = url
        self.addressText = url.absoluteString
        self.webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        self.navigationDelegate = TabNavigationDelegate()
        navigationDelegate.tab = self
        webView.navigationDelegate = navigationDelegate
        navigationDelegate.load(url, in: webView)
    }
```

- [ ] **Step 4: Update `TabsManager` to own the handler/bridge and open newtab**

In `ios/Blanc/Blanc/TabsManager.swift`, add the shared handler + bridge and change `createTab` to build a configuration and default to the newtab page. Replace from the `@Observable` attribute through the closing brace of `createTab` (currently lines 4–26) with the block below — the replacement re-includes `@Observable` and the class declaration, so do not leave the originals in place:

```swift
@Observable
final class TabsManager {
    private(set) var tabs: [TabModel] = []
    var activeTabId: UUID?

    let normalizer = AddressNormalizer(searchEngine: BlancSettingsDefaults.searchEngine)

    @ObservationIgnored private let schemeHandler = BlancSchemeHandler()
    @ObservationIgnored private lazy var bridge = PagesBridge(manager: self)

    static let newTabURL = URL(string: "blanc://newtab/")!

    var activeTab: TabModel? {
        guard let activeTabId else { return nil }
        return tabs.first { $0.id == activeTabId }
    }

    init() {
        createTab()
    }

    @discardableResult
    func createTab(url: URL = TabsManager.newTabURL) -> UUID {
        let config = WebViewConfiguration.make(schemeHandler: schemeHandler, bridge: bridge)
        let tab = TabModel(url: url, configuration: config)
        tabs.append(tab)
        activeTabId = tab.id
        return tab.id
    }
```

Leave `closeTab`, `setActive`, and `submitActiveTabAddress` unchanged.

- [ ] **Step 5: Update `ContentView` to show "New Tab" for `blanc://newtab`**

In `ios/Blanc/Blanc/ContentView.swift`, replace `displayDomain` (currently lines 63–65):

```swift
    private var displayDomain: String {
        guard let url = manager.activeTab?.currentURL else { return "New Tab" }
        if url.scheme == "blanc" {
            return url.host == "newtab" ? "New Tab" : (url.host ?? "New Tab")
        }
        return url.host ?? "New Tab"
    }
```

- [ ] **Step 6: Build and verify it compiles**

Run: `xcodebuild build -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -20`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 7: Run the full test suite (no regressions)**

Run: `xcodebuild test -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -25`
Expected: `** TEST SUCCEEDED **` — all existing suites plus `BlancSchemeHandlerTests` and `PagesBridgeTests` pass.

- [ ] **Step 8: Simulator verification**

Boot the app in the simulator and confirm the newtab ledger renders (this exercises the scheme handler serving the bundle *and* the bridge answering `appVersion()`/`bookmarks.list()`/`start.data()`):

```bash
xcrun simctl boot "iPhone 17" 2>/dev/null || true
xcodebuild -project ios/Blanc/Blanc.xcodeproj -scheme Blanc -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath /tmp/blanc-m4-dd build 2>&1 | tail -5
xcrun simctl install "iPhone 17" "$(find /tmp/blanc-m4-dd/Build/Products -name Blanc.app -maxdepth 3 | head -1)"
xcrun simctl launch "iPhone 17" me.bnfy.blanc
sleep 3
xcrun simctl io "iPhone 17" screenshot /tmp/blanc-m4-newtab.png
```

Open `/tmp/blanc-m4-newtab.png` and confirm the ledger shows: today's date (lowercased), "Where to?", the "♥ a page to pin it here" empty-favorites hint, and a footer reading "0 ads blocked this week" with a `v…` version string. The pill reads "New Tab".

Then verify the reachable pages don't error: tap the pill → not needed; instead tap the on-page **favorites** link to reach `blanc://bookmarks/`, then its nav to Settings / History / Downloads. Each should render its shell (empty states, default-valued settings controls) without a blank/error page. Screenshot `blanc://settings/` as evidence:

```bash
# after tapping through to settings in the simulator UI
xcrun simctl io "iPhone 17" screenshot /tmp/blanc-m4-settings.png
```

Note in the report that interactive tap-through is a manual simulator step (no tap-injection tool), consistent with M3.

- [ ] **Step 9: Update the parity matrix**

In `spec/parity-matrix.md`, change the **F16** row's iOS column from `PLANNED` to `PARTIAL` (newtab ledger renders from the shared bundle; other pages served with empty/default stubs). Leave the Parity contract and Divergence columns unchanged.

- [ ] **Step 10: Commit**

```bash
git add ios/Blanc/Blanc/WebViewConfiguration.swift ios/Blanc/Blanc/TabModel.swift ios/Blanc/Blanc/TabsManager.swift ios/Blanc/Blanc/ContentView.swift ios/Blanc/Blanc.xcodeproj/project.pbxproj spec/parity-matrix.md
git commit -m "ios: serve blanc:// bundle + bowserPages bridge; new tabs open newtab ledger"
```

---

## Notes for the implementer

- **Never edit `src/renderer/pages/*`.** If a page appears broken, the fix is in the Swift bridge or scheme handler, not the shared bundle.
- **The `pages` folder reference copies verbatim.** After a build, confirm the bundle contains `pages/newtab.html` if the scheme handler 404s: `find /tmp/blanc-m4-dd/Build/Products -path '*Blanc.app/pages/newtab.html'`. If the folder isn't bundled, re-check the four `project.pbxproj` edits in Step 1 (a folder reference must be `lastKnownFileType = folder` and wired into the app target's Resources phase).
- **`me.bnfy.blanc`** is the iOS bundle id (from `project.pbxproj`), distinct from the desktop `me.bnfy.bowser` appId — do not "reconcile" them.
- **`settings.get()` reads `BlancSettingsDefaults` for every value** — including `usagePing`, which is intentionally `true` (telemetry now defaults opted-in). Never hardcode settings values in the stub; read them from the generated substrate so the page always reflects the real defaults.
