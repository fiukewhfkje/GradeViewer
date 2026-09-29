import Foundation
import CryptoKit

public struct SchoologyCredentials: Codable, Sendable {
    public var key: String; public var secret: String; public var token: String; public var tokenSecret: String
    public init(key: String, secret: String, token: String = "", tokenSecret: String = "") { self.key = key; self.secret = secret; self.token = token; self.tokenSecret = tokenSecret }
}
public enum OAuth1 {
    public static func encode(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"))! }
    public static func signature(url: URL, method: String = "GET", parameters: [(String, String)], secret: String, tokenSecret: String = "") -> String {
        var c = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        let query = c.queryItems?.map { ($0.name, $0.value ?? "") } ?? []
        c.query = nil; c.fragment = nil; c.host = c.host?.lowercased(); c.scheme = c.scheme?.lowercased()
        if (c.scheme == "https" && c.port == 443) || (c.scheme == "http" && c.port == 80) { c.port = nil }
        if c.path.isEmpty { c.path = "/" }
        let encoded: [(String, String)] = (query + parameters).map { (encode($0.0), encode($0.1)) }
        let sorted = encoded.sorted { a, b in a.0 == b.0 ? a.1 < b.1 : a.0 < b.0 }
        let normalized = sorted.map { "\($0.0)=\($0.1)" }.joined(separator: "&")
        let base = [method.uppercased(), c.url!.absoluteString, normalized].map(encode).joined(separator: "&")
        let key = SymmetricKey(data: Data("\(encode(secret))&\(encode(tokenSecret))".utf8))
        return Data(HMAC<Insecure.SHA1>.authenticationCode(for: Data(base.utf8), using: key)).base64EncodedString()
    }
    public static func header(url: URL, credentials: SchoologyCredentials, nonce: String = UUID().uuidString, timestamp: Int = Int(Date().timeIntervalSince1970)) -> String {
        var fields = [("oauth_consumer_key", credentials.key), ("oauth_nonce", nonce), ("oauth_signature_method", "HMAC-SHA1"), ("oauth_timestamp", String(timestamp)), ("oauth_token", credentials.token), ("oauth_version", "1.0")]
        let sig = signature(url: url, parameters: fields, secret: credentials.secret, tokenSecret: credentials.tokenSecret)
        fields.sort { $0.0 < $1.0 }; fields.append(("oauth_signature", sig))
        return "OAuth realm=\"Schoology API\", " + fields.map { "\($0.0)=\"\(encode($0.1))\"" }.joined(separator: ", ")
    }
}
final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
public actor ReadOnlyHTTP {
    private let session: URLSession
    private let origin: URL
    private let credentials: SchoologyCredentials?
    public init(origin: URL, credentials: SchoologyCredentials? = nil, cookies: [HTTPCookie] = [], configuration: URLSessionConfiguration? = nil) throws {
        guard origin.scheme == "https", origin.host != nil, origin.user == nil, origin.password == nil, origin.port == nil || origin.port == 443 else { throw ProviderError.unsafeURL }
        self.origin = origin; self.credentials = credentials
        let config = configuration ?? URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest = 25; config.timeoutIntervalForResource = 60
        config.urlCache = nil; config.httpCookieAcceptPolicy = .always
        for cookie in cookies { config.httpCookieStorage?.setCookie(cookie) }
        session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }
    public func get(_ url: URL) async throws -> Data {
        var current = url
        for _ in 0..<5 {
            guard current.scheme == "https", current.host?.lowercased() == origin.host?.lowercased(), current.port == origin.port, current.user == nil, current.password == nil, current.path.hasPrefix(origin.path) else { throw ProviderError.unsafeURL }
            var request = URLRequest(url: current); request.httpMethod = "GET"; request.setValue("application/json", forHTTPHeaderField: "Accept")
            if let credentials { request.setValue(OAuth1.header(url: current, credentials: credentials), forHTTPHeaderField: "Authorization") }
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw ProviderError.unavailable }
            switch response.statusCode {
            case 401: throw ProviderError.reconnect
            case 403: throw ProviderError.forbidden
            case 429: throw ProviderError.throttled(Self.retryAfter(response.value(forHTTPHeaderField: "Retry-After")))
            case 301, 302, 303, 307, 308:
                guard credentials != nil, let location = response.value(forHTTPHeaderField: "Location"), let next = URL(string: location, relativeTo: current)?.absoluteURL else { throw ProviderError.reconnect }
                current = next; continue // Generate a fresh signature/nonce for users/me redirects.
            case 200..<300:
                let type = response.value(forHTTPHeaderField: "Content-Type")?.lowercased() ?? ""
                guard type.contains("json") else { throw ProviderError.reconnect }
                return data
            default: throw ProviderError.unavailable
            }
        }
        throw ProviderError.unavailable
    }
    public func cookies() -> [HTTPCookie] { session.configuration.httpCookieStorage?.cookies ?? [] }
    public static func retryAfter(_ value: String?) -> TimeInterval {
        if let value, let seconds = Double(value), seconds >= 0, seconds.isFinite { return seconds }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
        return value.flatMap(formatter.date).map { max(0, $0.timeIntervalSinceNow) } ?? 60
    }
}
public struct SchoologyProvider: Sendable {
    let http: ReadOnlyHTTP
    public init(credentials: SchoologyCredentials) throws { http = try ReadOnlyHTTP(origin: URL(string: "https://api.schoology.com/v1/")!, credentials: credentials) }
    public func fetch() async throws -> [SourceCourse] {
        let me = try ProviderParsing.object(await http.get(URL(string: "https://api.schoology.com/v1/users/me")!))
        guard let userID = ProviderParsing.text(me["uid"] ?? me["id"]) else { throw ProviderError.malformed }
        let sections = try await paged(path: "users/\(OAuth1.encode(userID))/sections", key: "section")
        var courses: [SourceCourse] = []
        for summary in sections {
            guard let id = ProviderParsing.text(summary["id"]) else { throw ProviderError.malformed }
            let escaped = OAuth1.encode(id)
            let section = try await http.get(URL(string: "https://api.schoology.com/v1/sections/\(escaped)")!)
            let grades = try await http.get(URL(string: "https://api.schoology.com/v1/users/\(OAuth1.encode(userID))/grades?section_id=\(escaped)")!)
            let items = try await paged(path: "sections/\(escaped)/grade_items", key: "assignment")
            let categories = try await paged(path: "sections/\(escaped)/grading_categories", key: "grading_category")
            courses += try ProviderParsing.schoology(section: section, grades: grades, items: JSONSerialization.data(withJSONObject: ["assignment": items]), categories: JSONSerialization.data(withJSONObject: ["grading_category": categories]))
        }
        return courses
    }
    private func paged(path: String, key: String) async throws -> [[String: Any]] {
        var next: URL? = URL(string: "https://api.schoology.com/v1/\(path)?limit=200"), seen = Set<URL>(), all: [[String: Any]] = []
        while let url = next {
            guard seen.insert(url).inserted, seen.count <= 100 else { throw ProviderError.tooManyPages }
            let payload = try ProviderParsing.object(await http.get(url))
            guard payload[key] != nil else { throw ProviderError.malformed }
            all += ProviderParsing.rows(payload[key])
            if let links = payload["links"] as? [String: Any], let s = links["next"] as? String, !s.isEmpty {
                guard let candidate = URL(string: s, relativeTo: url)?.absoluteURL else { throw ProviderError.malformed }
                // Some Schoology examples return HTTP links: upgrade only this same provider host.
                var c = URLComponents(url: candidate, resolvingAgainstBaseURL: false)!
                if c.host == "api.schoology.com" { c.scheme = "https" }
                next = c.url
            } else { next = nil }
        }
        return all
    }
}
public struct InfiniteCampusProvider: Sendable {
    let http: ReadOnlyHTTP; let base: URL
    public init(base: URL, cookies: [HTTPCookie]) throws { self.base = base; http = try ReadOnlyHTTP(origin: base, cookies: cookies) }
    public func fetch() async throws -> [SourceCourse] {
        let grades = try await http.get(base.appendingPathComponent("resources/portal/grades"))
        let summaries = try ProviderParsing.campus(grades: grades)
        var details: [String: Data] = [:]
        for id in Set(summaries.compactMap { $0.source.fields["detail_id"] }).sorted() {
            details[id] = try await http.get(base.appendingPathComponent("resources/portal/grades/detail").appendingPathComponent(id))
        }
        return try ProviderParsing.campus(grades: grades, details: details)
    }
    public func sessionCookies() async -> [HTTPCookie] { await http.cookies() }
}
