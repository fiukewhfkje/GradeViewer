import XCTest
@testable import GradeCore

final class CampusCookieTests: XCTestCase {
    let origin = URL(string: "https://district.example.org/campus/")!
    func testImportScopesCompleteRequestCookiesWithoutChangingValues() throws {
        let cookies = try CampusCookieHeader.parse(" Cookie: session=fixture==; route=server-1; blank=; quoted=\"fixture\" ", origin: origin)
        XCTAssertEqual(cookies.map(\.name), ["session", "route", "blank", "quoted"])
        XCTAssertEqual(cookies.map(\.value), ["fixture==", "server-1", "", "\"fixture\""])
        XCTAssertTrue(cookies.allSatisfy { $0.domain == "district.example.org" && $0.path == "/campus" && $0.isSecure && $0.expiresDate == nil })
    }
    func testImportRejectsAmbiguousHeadersAttributesAndInjection() {
        for header in ["", "session", "session=a; session=b", "session=a; Path=/", "Set-Cookie: session=a", "session=a\r\nHost: other.example.org", "session=a\n", "bad name=a", "session=one two", "session=\"unterminated", "session=a;", "session=é", String(repeating: "a", count: 65_537)] {
            XCTAssertThrowsError(try CampusCookieHeader.parse(header, origin: origin))
        }
        for url in ["http://district.example.org/campus/", "https://user:password@district.example.org/campus/", "https://district.example.org:8080/campus/"] {
            XCTAssertThrowsError(try CampusCookieHeader.parse("session=fixture", origin: URL(string: url)!))
        }
    }
}
