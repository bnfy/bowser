import XCTest
import SwiftUI
@testable import Blanc

final class SubstrateTests: XCTestCase {
    func testGeneratedSubstrateIsLinked() {
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
        XCTAssertNil(Color(blancHex: "#fff"))
        XCTAssertNil(Color(blancHex: ""))
    }

    func testTokenBackgroundIsParseable() {
        XCTAssertNotNil(Color(blancHex: BlancTokens.bg(.light)))
    }
}
