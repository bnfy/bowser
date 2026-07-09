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
        XCTAssertEqual(n.searchURL(for: "a & b!").absoluteString,
                       "https://duckduckgo.com/?q=a%20%26%20b!")
    }
    func testGoogleEngineUrl() {
        let g = AddressNormalizer(searchEngine: .google)
        XCTAssertEqual(g.searchURL(for: "cats").absoluteString,
                       "https://www.google.com/search?q=cats")
    }
    func testSingleCharTldIsSearchNotDomain() {
        XCTAssertEqual(n.normalize("example.c").absoluteString,
                       "https://duckduckgo.com/?q=example.c")
    }
}
