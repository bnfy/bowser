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

    func testStrongMatchBeatsWeak() {
        let strong = makeTab(title: "gmail inbox", url: "https://gmail.com")
        let weak = makeTab(title: "game library", url: "https://games.example.com")
        // "gmail" is a substring of "gmail inbox" → score 2.2
        // "gmail" does not in-order match "game library games.example.com" (missing 'i' after 'a') → excluded (score 0)
        let results = QuickSwitcher.search(query: "gmail", tabs: [weak, strong])
        XCTAssertEqual(results[0].tab.id, strong.id)
    }

    func testEqualScorePreservesTabOrder() {
        let first = makeTab(title: "game library", url: "https://games.example.com")
        let second = makeTab(title: "good morning list", url: "https://list.example.com")
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

    func testQueryStringNotSearchable() {
        let tab = makeTab(title: "Login", url: "https://auth.example.com/callback?token=abc123")
        let tokenResults = QuickSwitcher.search(query: "abc123", tabs: [tab])
        XCTAssertTrue(tokenResults.isEmpty)
        let hostResults = QuickSwitcher.search(query: "auth", tabs: [tab])
        XCTAssertEqual(hostResults.count, 1)
    }
}
