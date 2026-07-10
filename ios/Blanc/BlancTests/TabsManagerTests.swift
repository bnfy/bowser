import XCTest
@testable import Blanc

final class TabsManagerTests: XCTestCase {
    private func tmpDir() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("TabsManagerTests-\(UUID().uuidString)")
    }

    private func makeManager(settingsDir: URL? = nil, sessionDir: URL? = nil) -> TabsManager {
        TabsManager(
            settingsDirectory: settingsDir ?? tmpDir(),
            sessionDirectory: sessionDir ?? tmpDir()
        )
    }

    func testInitCreatesOneTab() {
        let m = makeManager()
        XCTAssertEqual(m.tabs.count, 1)
        XCTAssertNotNil(m.activeTabId)
        XCTAssertNotNil(m.activeTab)
    }

    func testCreateTabAddsAndActivates() {
        let m = makeManager()
        let before = m.tabs.count
        let id = m.createTab()
        XCTAssertEqual(m.tabs.count, before + 1)
        XCTAssertEqual(m.activeTabId, id)
    }

    func testCloseTabRemoves() {
        let m = makeManager()
        let id = m.createTab()
        let count = m.tabs.count
        m.closeTab(id)
        XCTAssertEqual(m.tabs.count, count - 1)
    }

    func testCloseActivePicksRightNeighbor() {
        let m = makeManager()
        let _ = m.createTab(url: URL(string: "https://b.test")!)
        let c = m.createTab(url: URL(string: "https://c.test")!)
        let b = m.tabs[1].id
        m.setActive(b)
        m.closeTab(b)
        XCTAssertEqual(m.activeTabId, c)
    }

    func testCloseRightmostActivePicksLeft() {
        let m = makeManager()
        let a = m.tabs[0].id
        let b = m.createTab(url: URL(string: "https://b.test")!)
        m.closeTab(b)
        XCTAssertEqual(m.activeTabId, a)
    }

    func testCloseLastCreatesNew() {
        let m = makeManager()
        let onlyId = m.tabs[0].id
        m.closeTab(onlyId)
        XCTAssertEqual(m.tabs.count, 1)
        XCTAssertNotNil(m.activeTabId)
        XCTAssertNotEqual(m.activeTabId, onlyId)
    }

    func testSetActive() {
        let m = makeManager()
        let a = m.tabs[0].id
        let _ = m.createTab()
        m.setActive(a)
        XCTAssertEqual(m.activeTabId, a)
    }

    func testSetActiveIgnoresUnknownId() {
        let m = makeManager()
        let before = m.activeTabId
        m.setActive(UUID())
        XCTAssertEqual(m.activeTabId, before)
    }

    func testActiveTabMatchesId() {
        let m = makeManager()
        let id = m.createTab(url: URL(string: "https://test.com")!)
        XCTAssertEqual(m.activeTab?.id, id)
    }

    func testCloseNonActivePreservesActive() {
        let m = makeManager()
        let a = m.tabs[0].id
        let b = m.createTab()
        m.closeTab(a)
        XCTAssertEqual(m.activeTabId, b)
    }

    func testInitReadsStoredSearchEngine() {
        let dir = tmpDir()
        let data = try! JSONSerialization.data(withJSONObject: ["searchEngine": "brave"])
        try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try! data.write(to: dir.appendingPathComponent("settings.json"))

        let m = TabsManager(settingsDirectory: dir)
        XCTAssertEqual(m.normalizer.searchEngine, .brave)
    }

    func testInitReadsStoredAdblockDisabled() {
        let dir = tmpDir()
        let data = try! JSONSerialization.data(withJSONObject: ["adblockEnabled": false])
        try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try! data.write(to: dir.appendingPathComponent("settings.json"))

        let m = TabsManager(settingsDirectory: dir)
        XCTAssertEqual(m.settingsStore.adblockEnabled, false)
        XCTAssertFalse(m.isAdBlockReady)
    }

    // MARK: - applySettingsPatch

    func testPatchThemeUpdatesStore() {
        let m = makeManager()
        m.applySettingsPatch(["theme": "dark"])
        XCTAssertEqual(m.settingsStore.theme, .dark)
    }

    func testPatchSearchEngineUpdatesNormalizer() {
        let m = makeManager()
        m.applySettingsPatch(["searchEngine": "google"])
        XCTAssertEqual(m.settingsStore.searchEngine, .google)
        XCTAssertEqual(m.normalizer.searchEngine, .google)
    }

    func testPatchInvalidEnumIsDropped() {
        let m = makeManager()
        m.applySettingsPatch(["theme": "neon"])
        XCTAssertEqual(m.settingsStore.theme, BlancSettingsDefaults.theme)
    }

    func testPatchUnknownKeyIsDropped() {
        let m = makeManager()
        m.applySettingsPatch(["unknownKey": "value"])
        m.settingsStore.flush()   // `.atomic` write creates the file even on first save
        let data = try! Data(contentsOf: m.settingsStore.testFileURL)
        let dict = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertNil(dict["unknownKey"], "bridge patch must not persist unknown keys")
    }

    func testPatchAdblockDisabledUpdatesStore() {
        let m = makeManager()
        m.applySettingsPatch(["adblockEnabled": false])
        XCTAssertEqual(m.settingsStore.adblockEnabled, false)
    }

    // MARK: - Session restore

    func testRestoresTabsFromSession() {
        let sessionDir = tmpDir()
        let dict: [String: Any] = [
            "urls": ["https://a.test/", "https://b.test/"],
            "activeIndex": 1,
        ]
        let data = try! JSONSerialization.data(withJSONObject: dict)
        try! FileManager.default.createDirectory(at: sessionDir, withIntermediateDirectories: true)
        try! data.write(to: sessionDir.appendingPathComponent("session.json"))

        let m = makeManager(sessionDir: sessionDir)
        XCTAssertEqual(m.tabs.count, 2)
        XCTAssertEqual(m.tabs[0].currentURL.absoluteString, "https://a.test/")
        XCTAssertEqual(m.tabs[1].currentURL.absoluteString, "https://b.test/")
        XCTAssertEqual(m.activeTab?.id, m.tabs[1].id)
    }

    func testEmptySessionCreatesBlankTab() {
        let m = makeManager()
        XCTAssertEqual(m.tabs.count, 1)
        XCTAssertEqual(m.tabs[0].currentURL.absoluteString, "blanc://newtab/")
    }

    func testActiveIndexClampedToRange() {
        let sessionDir = tmpDir()
        let dict: [String: Any] = ["urls": ["https://a.test/"], "activeIndex": 99]
        let data = try! JSONSerialization.data(withJSONObject: dict)
        try! FileManager.default.createDirectory(at: sessionDir, withIntermediateDirectories: true)
        try! data.write(to: sessionDir.appendingPathComponent("session.json"))

        let m = makeManager(sessionDir: sessionDir)
        XCTAssertEqual(m.tabs.count, 1)
        XCTAssertEqual(m.activeTab?.id, m.tabs[0].id)
    }

    func testCorruptSessionCreatesBlankTab() {
        let sessionDir = tmpDir()
        try! FileManager.default.createDirectory(at: sessionDir, withIntermediateDirectories: true)
        try! "broken".data(using: .utf8)!
            .write(to: sessionDir.appendingPathComponent("session.json"))

        let m = makeManager(sessionDir: sessionDir)
        XCTAssertEqual(m.tabs.count, 1)
        XCTAssertEqual(m.tabs[0].currentURL.absoluteString, "blanc://newtab/")
    }

    func testPersistSessionWritesTabURLsToDisk() {
        let sessionDir = tmpDir()
        let m = makeManager(sessionDir: sessionDir)
        m.createTab(url: URL(string: "https://test.com/")!)
        m.flushSession()   // collapse the debounce so the file is on disk to read

        let data = try! Data(contentsOf: sessionDir.appendingPathComponent("session.json"))
        let dict = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["urls"] as? [String], ["blanc://newtab/", "https://test.com/"])
        XCTAssertEqual(dict["activeIndex"] as? Int, 1)
    }

    func testSubmitAddressPersistsNavigation() {
        // Typed-address navigation updates currentURL synchronously in submitAddress,
        // so onURLChange (which fires only on a *change* at load time) is suppressed.
        // submitActiveTabAddress must persist explicitly, or the typed URL is lost on
        // the next launch. Regression test for that P1.
        let sessionDir = tmpDir()
        let m = makeManager(sessionDir: sessionDir)
        m.activeTab?.addressText = "example.com"
        m.submitActiveTabAddress()
        m.flushSession()

        let navigated = m.activeTab!.currentURL.absoluteString
        XCTAssertTrue(navigated.contains("example.com"), "expected navigation to example.com, got \(navigated)")

        let data = try! Data(contentsOf: sessionDir.appendingPathComponent("session.json"))
        let dict = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["urls"] as? [String], [navigated],
                       "typed navigation must be persisted, not the pre-navigation URL")
    }
}
