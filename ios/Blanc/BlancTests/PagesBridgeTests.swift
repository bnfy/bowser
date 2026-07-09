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
