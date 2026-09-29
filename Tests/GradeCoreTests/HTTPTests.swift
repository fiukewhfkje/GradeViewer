import XCTest
@testable import GradeCore
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var contentType = "application/json"
    nonisolated(unsafe) static var body = "[]"
    nonisolated(unsafe) static var bodies: [String: String] = [:]
    nonisolated(unsafe) static var requests: [String] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path + (request.url!.query.map { "?" + $0 } ?? "")
        Self.requests.append(path)
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": Self.contentType, "Retry-After": "30"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: Data((Self.bodies[path] ?? Self.body).utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
final class HTTPTests: XCTestCase {
    func client(diagnostics: Bool = false) throws -> ReadOnlyHTTP { let c = URLSessionConfiguration.ephemeral; c.protocolClasses = [StubURLProtocol.self]; return try ReadOnlyHTTP(origin: URL(string: "https://example.com/campus/")!, configuration: c, diagnosticsEnabled: diagnostics) }
    override func setUp() { StubURLProtocol.status = 200; StubURLProtocol.contentType = "application/json"; StubURLProtocol.body = "[]"; StubURLProtocol.bodies = [:]; StubURLProtocol.requests = [] }
    func testExpiredSessionAndHTMLLoginResponse() async throws {
        let http = try client(); let url = URL(string: "https://example.com/campus/resources/portal/grades")!
        StubURLProtocol.status = 401
        do { _ = try await http.get(url); XCTFail("Expected reconnect") } catch { XCTAssertEqual(error as? ProviderError, .reconnect) }
        StubURLProtocol.status = 200; StubURLProtocol.contentType = "text/html"
        do { _ = try await http.get(url); XCTFail("Expected reconnect") } catch { XCTAssertEqual(error as? ProviderError, .reconnect) }
    }
    func testForbiddenAndThrottled() async throws {
        let http = try client(); let url = URL(string: "https://example.com/campus/resources/portal/grades")!
        StubURLProtocol.status = 403
        do { _ = try await http.get(url); XCTFail() } catch { XCTAssertEqual(error as? ProviderError, .forbidden) }
        StubURLProtocol.status = 429
        do { _ = try await http.get(url); XCTFail() } catch { XCTAssertEqual(error as? ProviderError, .throttled(30)) }
    }
    func testRejectsCrossOriginAndPathEscape() async throws {
        let http = try client()
        for value in ["https://other.example.com/campus/", "https://example.com/private/", "http://example.com/campus/"] {
            do { _ = try await http.get(URL(string: value)!); XCTFail() } catch { XCTAssertEqual(error as? ProviderError, .unsafeURL) }
        }
    }
    func testSuccessfulRead() async throws { let data = try await client().get(URL(string: "https://example.com/campus/resources/portal/grades")!); XCTAssertEqual(data, Data("[]".utf8)) }
    func testDiagnosticsNeverContainResponseValuesOrRequestIdentifiers() async throws {
        StubURLProtocol.body = "{\"data\":[{\"courses\":[{\"courseName\":\"PRIVATE_NAME\",\"sectionID\":987654321,\"score\":\"PRIVATE_GRADE\",\"unknown-secret-key\":\"PRIVATE_COOKIE\"}]}]}"
        let http = try client(diagnostics: true)
        _ = try await http.get(URL(string: "https://example.com/campus/resources/portal/grades/detail/PRIVATE_ID?token=PRIVATE_TOKEN")!)
        let records = await http.diagnostics(); let record = try XCTUnwrap(records.first)
        XCTAssertEqual(record.route, "grade detail"); XCTAssertEqual(record.status, 200)
        XCTAssertEqual(record.structure["root.data[].courses[].courseName"], "string")
        let encoded = String(decoding: try JSONEncoder().encode(records), as: UTF8.self)
        for secret in ["PRIVATE_NAME", "987654321", "PRIVATE_GRADE", "PRIVATE_COOKIE", "PRIVATE_ID", "PRIVATE_TOKEN", "unknown-secret-key"] { XCTAssertFalse(encoded.contains(secret)) }
    }
    func testNormalRefreshDoesNotCollectDiagnostics() async throws {
        let http = try client()
        _ = try await http.get(URL(string: "https://example.com/campus/resources/portal/grades")!)
        let records = await http.diagnostics(); XCTAssertTrue(records.isEmpty)
    }
    func testSectionValidationReportsOnlyEqualityFlags() async throws {
        let http = try client(diagnostics: true)
        await http.recordSchoologyChecks(section: Data("{\"id\":\"PRIVATE_METADATA_ID\"}".utf8), grades: Data("{\"section\":[{\"section_id\":\"PRIVATE_REQUEST_ID\",\"period\":[]}]}".utf8), requestedID: "PRIVATE_REQUEST_ID")
        let records = await http.diagnostics()
        XCTAssertEqual(records.last?.structure["grades contain requested section"], "true")
        XCTAssertEqual(records.last?.structure["grades contain metadata section"], "false")
        let encoded = String(decoding: try JSONEncoder().encode(records), as: UTF8.self)
        XCTAssertFalse(encoded.contains("PRIVATE_METADATA_ID")); XCTAssertFalse(encoded.contains("PRIVATE_REQUEST_ID"))
    }
    func testSchoologyResolvesReturnedGradeOwnerAndDeduplicatesSections() async throws {
        let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures")
        func fixture(_ name: String) throws -> String { try String(contentsOf: fixtures.appendingPathComponent(name + ".json"), encoding: .utf8) }
        StubURLProtocol.bodies = [
            "/v1/users/me": "{\"uid\":\"fixture-user\"}",
            "/v1/users/fixture-user/sections?limit=200": "{\"section\":[{\"id\":\"99\"},{\"id\":\"100\"}]}",
            "/v1/users/fixture-user/grades?section_id=99": try fixture("schoology-grades"),
            "/v1/sections/99": try fixture("schoology-section").replacingOccurrences(of: "\"id\":\"100\"", with: "\"id\":\"99\""),
            "/v1/sections/99/grade_items?limit=200": try fixture("schoology-items"),
            "/v1/sections/99/grading_categories?limit=200": try fixture("schoology-categories")
        ]
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [StubURLProtocol.self]
        let http = try ReadOnlyHTTP(origin: URL(string: "https://api.schoology.com/v1/")!, configuration: configuration)
        let courses = try await SchoologyProvider(http: http).fetch()
        XCTAssertEqual(courses.count, 1); XCTAssertEqual(courses[0].source.fields["section_id"], "99"); XCTAssertEqual(courses[0].source.fields["grade_section_id"], "100")
        XCTAssertEqual(courses[0].assignments.count, 2)
        XCTAssertFalse(StubURLProtocol.requests.contains("/v1/sections/100/grade_items?limit=200"))
        XCTAssertFalse(StubURLProtocol.requests.contains("/v1/users/fixture-user/grades?section_id=100"))
    }
}
