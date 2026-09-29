import XCTest
@testable import GradeCore
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var contentType = "application/json"
    nonisolated(unsafe) static var body = "[]"
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": Self.contentType, "Retry-After": "30"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: Data(Self.body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
final class HTTPTests: XCTestCase {
    func client() throws -> ReadOnlyHTTP { let c = URLSessionConfiguration.ephemeral; c.protocolClasses = [StubURLProtocol.self]; return try ReadOnlyHTTP(origin: URL(string: "https://example.com/campus/")!, configuration: c) }
    override func setUp() { StubURLProtocol.status = 200; StubURLProtocol.contentType = "application/json"; StubURLProtocol.body = "[]" }
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
}
