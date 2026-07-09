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
