import XCTest
@testable import GradeCore
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var contentType = "application/json"
    nonisolated(unsafe) static var body = "[]"
    nonisolated(unsafe) static var bodies: [String: String] = [:]
    nonisolated(unsafe) static var requests: [String] = []
    nonisolated(unsafe) static var statusSequences: [String: [Int]] = [:]
    nonisolated(unsafe) static var statuses: [String: Int] = [:]
    nonisolated(unsafe) static var extraHeaders: [String: String] = [:]
    static let requestLock = NSLock()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path + (request.url!.query.map { "?" + $0 } ?? "")
        let status = Self.requestLock.withLock {
            Self.requests.append(path)
            if let first = Self.statusSequences[path]?.first { Self.statusSequences[path]?.removeFirst(); return first }
            return Self.statuses[path] ?? Self.status
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": Self.contentType, "Retry-After": "30"].merging(Self.extraHeaders) { _,b in b })!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: Data((Self.bodies[path] ?? Self.body).utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
final class HTTPTests: XCTestCase {
    func client(diagnostics: Bool = false) throws -> ReadOnlyHTTP { let c = URLSessionConfiguration.ephemeral; c.protocolClasses = [StubURLProtocol.self]; return try ReadOnlyHTTP(origin: URL(string: "https://example.com/campus/")!, configuration: c, diagnosticsEnabled: diagnostics) }
    override func setUp() { StubURLProtocol.status = 200; StubURLProtocol.contentType = "application/json"; StubURLProtocol.body = "[]"; StubURLProtocol.bodies = [:]; StubURLProtocol.requests = []; StubURLProtocol.extraHeaders = [:]; StubURLProtocol.statuses = [:]; StubURLProtocol.statusSequences = [:] }
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
            "/v1/users/fixture-user/grades?section_id=100": try fixture("schoology-grades"),
            "/v1/sections/99": try fixture("schoology-section").replacingOccurrences(of: "\"id\":\"100\"", with: "\"id\":\"99\""),
            "/v1/sections/99/grade_items?limit=200": try fixture("schoology-items"),
            "/v1/sections/99/grading_categories?limit=200": try fixture("schoology-categories")
        ]
        StubURLProtocol.statuses["/v1/users/fixture-user/grades?section_id=100"] = 403
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [StubURLProtocol.self]
        let http = try ReadOnlyHTTP(origin: URL(string: "https://api.schoology.com/v1/")!, configuration: configuration)
        let courses = try await SchoologyProvider(http: http).fetch()
        XCTAssertEqual(courses.count, 1); XCTAssertEqual(courses[0].source.fields["section_id"], "99"); XCTAssertEqual(courses[0].source.fields["grade_section_id"], "100")
        XCTAssertEqual(courses[0].assignments.count, 2)
        XCTAssertFalse(StubURLProtocol.requests.contains("/v1/sections/100/grade_items?limit=200"))
        XCTAssertEqual(StubURLProtocol.requests.filter { $0.contains("/grade_items?") }.count, 1)
    }
}

private actor ConcurrencyProbe {
    var active = 0; var maximum = 0
    func run(_ value: Int) async throws -> Int {
        active += 1; maximum = max(maximum, active)
        defer { active -= 1 }
        try await Task.sleep(for: .milliseconds(40))
        return value * 2
    }
}
extension HTTPTests {
    func testBoundedFetchConcurrencyPreservesOrder() async throws {
        let probe = ConcurrencyProbe()
        let values = try await concurrentMap(Array(0..<9), limit: 3) { try await probe.run($0) }
        XCTAssertEqual(values, Array(0..<9).map { $0 * 2 })
        let maximum = await probe.maximum
        XCTAssertEqual(maximum, 3)
    }
    func testPrivateCookieJarsRetainRotationWithoutLeakingToAnotherSession() async throws {
        let url = URL(string: "https://example.com/campus/resources/portal/grades")!
        let configuration = URLSessionConfiguration.ephemeral
        let cookie = HTTPCookie(properties: [.name:"session", .value:"fixture-old", .domain:"example.com", .path:"/campus", .secure:"TRUE"])!
        let http = try ReadOnlyHTTP(origin: URL(string:"https://example.com/campus/")!, cookies: [cookie], configuration: configuration)
        let initial = await http.cookies(); XCTAssertEqual(initial.first?.value, "fixture-old")
        let other = try client(); let otherCookies = await other.cookies(); XCTAssertTrue(otherCookies.isEmpty)
        // Failed HTTP responses can still carry a renewed cookie.
        StubURLProtocol.status = 401; StubURLProtocol.extraHeaders = ["Set-Cookie":"session=fixture-new; Path=/campus; Secure; HttpOnly"]
        let stubConfiguration = URLSessionConfiguration.ephemeral; stubConfiguration.protocolClasses = [StubURLProtocol.self]
        let stub = try ReadOnlyHTTP(origin:URL(string:"https://example.com/campus/")!, cookies:[cookie], configuration:stubConfiguration)
        do { _ = try await stub.get(url); XCTFail() } catch { XCTAssertEqual(error as? ProviderError, .reconnect) }
        let rotated = await stub.cookies(); XCTAssertEqual(rotated.first?.value, "fixture-new")
    }
    func testMalformedPaginationRetainsSnapshotInsteadOfReturningEmptySuccess() async throws {
        StubURLProtocol.bodies = ["/v1/users/me":"{\"uid\":\"fixture\"}", "/v1/users/fixture/sections?limit=200":"{\"section\":[],\"total\":2}"]
        let c = URLSessionConfiguration.ephemeral; c.protocolClasses = [StubURLProtocol.self]
        let http = try ReadOnlyHTTP(origin:URL(string:"https://api.schoology.com/v1/")!, configuration:c)
        do { _ = try await SchoologyProvider(http:http).fetch(); XCTFail() } catch { XCTAssertEqual(error as? ProviderError, .malformed) }
    }
}

extension HTTPTests {
    func testNonHTMLBadContentDoesNotClaimExpiredAuthentication() async throws {
        StubURLProtocol.contentType = "text/plain"
        do { _ = try await client().get(URL(string:"https://example.com/campus/resources/portal/grades")!); XCTFail() }
        catch { XCTAssertEqual(error as? ProviderError, .malformed) }
    }
}

extension HTTPTests {
    func testCampusRevisitsSavedPortalOnceThenRetriesRejectedSession() async throws {
        let path = "/campus/resources/portal/grades"
        StubURLProtocol.statusSequences[path] = [401, 200]
        let http = try client()
        let campus = InfiniteCampusProvider(base: URL(string:"https://example.com/campus/")!, http:http)
        let rows = try await campus.fetch(resuming: URL(string:"https://example.com/campus/portal/students/fixture.jsp")!)
        XCTAssertTrue(rows.isEmpty)
        XCTAssertEqual(StubURLProtocol.requests, [path, "/campus/portal/students/fixture.jsp", path])
        StubURLProtocol.requests = []; StubURLProtocol.status = 401
        do { _ = try await campus.fetch(resuming:URL(string:"https://example.com/campus/portal/students/fixture.jsp")!); XCTFail() }
        catch { XCTAssertEqual(error as? ProviderError, .reconnect) }
        XCTAssertEqual(StubURLProtocol.requests.count, 2)
    }
    func testSchoologyMissingTitlesUseScopedAssignmentMetadata() async throws {
        let fixtures = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures")
        func fixture(_ name: String) throws -> String { try String(contentsOf:fixtures.appendingPathComponent(name + ".json"), encoding:.utf8) }
        StubURLProtocol.bodies = [
            "/v1/users/me":"{\"uid\":\"fixture\"}",
            "/v1/users/fixture/sections?limit=200":"{\"section\":[{\"id\":\"100\"}]}",
            "/v1/users/fixture/grades?section_id=100":try fixture("schoology-grades"),
            "/v1/sections/100":try fixture("schoology-section"),
            "/v1/sections/100/grade_items?limit=200":"{\"assignment\":[]}",
            "/v1/sections/100/grading_categories?limit=200":try fixture("schoology-categories"),
            "/v1/sections/100/assignments/10":"{\"id\":10,\"grade_item_id\":999,\"title\":\"Recovered fixture title\"}"
        ]
        let c = URLSessionConfiguration.ephemeral; c.protocolClasses = [StubURLProtocol.self]
        let http = try ReadOnlyHTTP(origin:URL(string:"https://api.schoology.com/v1/")!, configuration:c)
        let provider = SchoologyProvider(http:http)
        let courses = try await provider.fetch()
        XCTAssertEqual(courses[0].assignments[0].title, "Recovered fixture title")
        XCTAssertEqual(courses[0].assignments[0].score.earned, 0)
        StubURLProtocol.requests = []
        _ = try await provider.fetch(previous:courses)
        XCTAssertFalse(StubURLProtocol.requests.contains("/v1/sections/100/assignments/10"))
        StubURLProtocol.statuses["/v1/sections/100/assignments/10"] = 403
        let inaccessible = try await provider.fetch()
        XCTAssertEqual(inaccessible[0].assignments[0].title, "Untitled assignment")
        XCTAssertEqual(inaccessible[0].assignments[0].score.earned, 0)
    }
}

extension HTTPTests {
    func testSchoologyPeriodMetadataCacheKeepsItsExpiryAndRefreshesForNewPeriods() async throws {
        let fixtures = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures")
        func fixture(_ name: String) throws -> String { try String(contentsOf:fixtures.appendingPathComponent(name + ".json"),encoding:.utf8) }
        StubURLProtocol.bodies = [
            "/v1/users/me":"{\"uid\":\"fixture-user\"}",
            "/v1/users/fixture-user/sections?limit=200":"{\"section\":[{\"id\":\"100\"}]}",
            "/v1/users/fixture-user/grades?section_id=100":try fixture("schoology-grades"),
            "/v1/sections/100":try fixture("schoology-section"),
            "/v1/sections/100/grade_items?limit=200":try fixture("schoology-items"),
            "/v1/sections/100/grading_categories?limit=200":try fixture("schoology-categories"),
            "/v1/sections/100/grading_periods?limit=200":"{\"grading_period\":[{\"id\":1,\"title\":\"Q1\",\"start\":\"2026-08-20\",\"end\":\"2026-10-15\"}]}"
        ]
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubURLProtocol.self]
        let provider = SchoologyProvider(http:try ReadOnlyHTTP(origin:URL(string:"https://api.schoology.com/v1/")!,configuration:config))
        let first = try await provider.fetch()
        let second = try await provider.fetch(previous:first)
        XCTAssertEqual(StubURLProtocol.requests.filter { $0.contains("/grading_periods") }.count,1)
        XCTAssertEqual(first[0].source.fields["period_metadata_fetched"],second[0].source.fields["period_metadata_fetched"])
        XCTAssertEqual(first[0].term.start, second[0].term.start)
        var expired = second
        for i in expired.indices { expired[i].source.fields["period_metadata_fetched"] = String(Date().addingTimeInterval(-3601).timeIntervalSince1970) }
        _ = try await provider.fetch(previous:expired)
        XCTAssertEqual(StubURLProtocol.requests.filter { $0.contains("/grading_periods") }.count,2)
        StubURLProtocol.bodies["/v1/users/fixture-user/grades?section_id=100"] = "{\"section\":[{\"section_id\":100,\"period\":[{\"period_id\":\"p2\",\"assignment\":[]}]}]}"
        _ = try await provider.fetch(previous:second)
        XCTAssertEqual(StubURLProtocol.requests.filter { $0.contains("/grading_periods") }.count,3)
    }
}

extension HTTPTests {
    func testSchoologyBulkRefreshUsesPreviouslyVerifiedEnrollmentAliasAndFreshScores() async throws {
        let fixtures = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures")
        func fixture(_ name: String) throws -> Data { try Data(contentsOf:fixtures.appendingPathComponent(name + ".json")) }
        let section = String(decoding:try fixture("schoology-section"),as:UTF8.self).replacingOccurrences(of:"\"id\":\"100\"",with:"\"id\":\"99\"")
        let previous = try ProviderParsing.schoology(section:Data(section.utf8),grades:fixture("schoology-grades"),items:fixture("schoology-items"),categories:fixture("schoology-categories"),gradeSectionID:"100")
        StubURLProtocol.bodies = [
            "/v1/users/me":"{\"uid\":\"fixture-user\"}",
            "/v1/users/fixture-user/sections?limit=200":"{\"section\":[{\"id\":\"99\"},{\"id\":\"100\"},{\"id\":\"empty-enrollment\"}]}",
            "/v1/users/fixture-user/grades?limit=200":String(decoding:try fixture("schoology-grades"),as:UTF8.self).replacingOccurrences(of:"\"grade\":\"0\"",with:"\"grade\":\"20\""),
            "/v1/sections/99":section,
            "/v1/sections/99/grade_items?limit=200":String(decoding:try fixture("schoology-items"),as:UTF8.self),
            "/v1/sections/99/grading_categories?limit=200":String(decoding:try fixture("schoology-categories"),as:UTF8.self)
        ]
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubURLProtocol.self]
        let provider = SchoologyProvider(http:try ReadOnlyHTTP(origin:URL(string:"https://api.schoology.com/v1/")!,configuration:config))
        let result = try await provider.fetch(previous:previous)
        XCTAssertEqual(result[0].source.fields["section_id"], "99")
        XCTAssertEqual(result[0].assignments[0].score.earned,20)
        XCTAssertFalse(StubURLProtocol.requests.contains { $0.contains("grades?section_id=") })
        XCTAssertFalse(StubURLProtocol.requests.contains { $0.hasPrefix("/v1/sections/100/") })
        StubURLProtocol.statuses["/v1/users/fixture-user/grades?limit=200"] = 429
        do { _ = try await provider.fetch(previous:previous); XCTFail("Must respect bulk throttling") }
        catch { XCTAssertEqual(error as? ProviderError,.throttled(30)) }
        XCTAssertFalse(StubURLProtocol.requests.contains { $0.contains("grades?section_id=") })
    }
}
