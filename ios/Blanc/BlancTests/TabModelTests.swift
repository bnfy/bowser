import XCTest
import WebKit
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
