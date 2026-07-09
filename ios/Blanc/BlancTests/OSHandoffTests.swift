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
