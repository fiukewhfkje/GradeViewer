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
/// Structural diagnostics only: never record URLs, headers, identifiers, or JSON values.
public struct HTTPDiagnostic: Codable, Sendable {
    public let route: String
    public let status: Int
    public let contentType: String
    public let responseBytes: Int
    public let structure: [String: String]
    public let redirect: String?
    public var elapsedMilliseconds: Double? = nil
    public var retryAfterSeconds: Double? = nil
    static func structure(_ data: Data) -> [String: String] {
        guard let json = try? JSONSerialization.jsonObject(with: data) else { return ["root": "non-JSON"] }
        let allowed: Set<String> = ["data", "schools", "terms", "courses", "gradingTasks", "details", "task", "categories", "assignments", "_id", "id", "sectionID", "termID", "termName", "schoolID", "taskID", "gradingTaskID", "progressPercent", "percent", "progressScore", "score", "courseName", "grade", "assignmentName", "name", "teacherDisplay", "startDate", "endDate", "categoryID", "groupID", "isWeighted", "weight", "scorePoints", "totalPoints", "assignmentID", "objectSectionID", "dueDate", "multiplier", "error", "errors", "message", "uid", "section", "section_id", "period", "period_id", "period_title", "assignment", "final_grade", "grading_category", "links", "next", "total", "title", "options", "weighted_grading_categories", "assignment_id", "grade_item_id", "type", "max_points", "scale_id", "scale_type", "exception", "timestamp", "calculation_type", "drop_lowest", "grading_period", "due", "factor", "modifiedDate", "scoreDate", "scoredDate", "scoreTimestamp", "scoreModifiedDate", "scoreModifiedTimestamp", "scoreUpdateDate", "scoreUpdateTimestamp", "modifiedTimestamp", "lastModifiedDate", "lastModifiedTimestamp", "dateModified", "dateScored", "createdDate", "createdTimestamp", "assignedDate", "lastUpdated", "lastUpdatedDate", "lastUpdatedTimestamp", "lastScoreDate", "scoreDetail", "scoreDetails"]
        var result: [String: String] = [:]
        func visit(_ value: Any, _ path: String, _ depth: Int) {
            guard depth <= 9 else { return }
            if let object = value as? [String: Any] {
                result[path] = "object"
                let unknown = object.keys.filter { !allowed.contains($0) }.count
                if unknown > 0 { result[path + ".otherFields"] = String(unknown) }
                for key in object.keys.sorted() where allowed.contains(key) { visit(object[key]!, path + "." + key, depth + 1) }
            } else if let array = value as? [Any] {
                result[path] = "array (\(array.count))"
                if let first = array.first { visit(first, path + "[]", depth + 1) }
            } else if value is NSNull { result[path] = "null" }
            else if value is String { result[path] = "string" }
            else if value is NSNumber { result[path] = "number or boolean" }
        }
        visit(json, "root", 0); return result
    }
}
public actor ReadOnlyHTTP {
    private let session: URLSession
    private let origin: URL
    private let credentials: SchoologyCredentials?
    private let diagnosticsEnabled: Bool
    private var records: [HTTPDiagnostic] = []
    public init(origin: URL, credentials: SchoologyCredentials? = nil, cookies: [HTTPCookie] = [], configuration: URLSessionConfiguration? = nil, diagnosticsEnabled: Bool = false) throws {
        guard origin.scheme == "https", origin.host != nil, origin.user == nil, origin.password == nil, origin.port == nil || origin.port == 443 else { throw ProviderError.unsafeURL }
        self.origin = origin; self.credentials = credentials; self.diagnosticsEnabled = diagnosticsEnabled
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
            let requestStarted = Date()
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw ProviderError.unavailable }
            if diagnosticsEnabled {
                let mime = response.mimeType ?? "unknown"
                let route: String
                if current.path.contains("/grades/detail/") { route = "grade detail" }
                else if credentials == nil && current.path.hasSuffix("/grades") { route = "grade summary" }
                else if current.path.hasSuffix("/users/me") { route = "current user" }
                else if current.path.hasSuffix("/sections") { route = "enrolled sections" }
                else if current.path.hasSuffix("/grades") { route = "student grades" }
                else if current.path.hasSuffix("/grade_items") { route = "assignments" }
                else if current.path.hasSuffix("/grading_categories") { route = "categories" }
                else if current.path.contains("/sections/") { route = "section" }
                else if current.path.contains("/users/") { route = "user" }
                else { route = "request" }
                var redirect: String?
                if let location = response.value(forHTTPHeaderField: "Location"), let target = URL(string: location, relativeTo: current)?.absoluteURL {
                    redirect = target.host?.lowercased() == origin.host?.lowercased() ? (target.scheme == "https" ? "same host HTTPS" : "same host other scheme") : "other host"
                }
                var record = HTTPDiagnostic(route: route, status: response.statusCode, contentType: mime, responseBytes: data.count, structure: HTTPDiagnostic.structure(data), redirect: redirect)
                record.elapsedMilliseconds = Date().timeIntervalSince(requestStarted) * 1000
                record.retryAfterSeconds = response.value(forHTTPHeaderField: "Retry-After").map(Self.retryAfter)
                records.append(record)
                if records.count > 20 { records.remove(at: 1) }
            }
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
    public func diagnostics() -> [HTTPDiagnostic] { records }
    func recordSchoologyChecks(section: Data, grades: Data, requestedID: String) {
        guard diagnosticsEnabled, let metadata = try? ProviderParsing.object(section), let payload = try? ProviderParsing.object(grades) else { return }
        let rows = ProviderParsing.rows(payload["section"])
        let metadataID = ProviderParsing.text(metadata["id"])
        let checks = [
            "metadata has ID": String(metadataID != nil),
            "metadata matches requested section": String(metadataID == requestedID),
            "grades contain requested section": String(rows.contains { ProviderParsing.text($0["section_id"]) == requestedID }),
            "grades contain metadata section": String(rows.contains { ProviderParsing.text($0["section_id"]) == metadataID }),
            "matching section has periods": String(rows.contains { ProviderParsing.text($0["section_id"]) == metadataID && $0["period"] != nil })
        ]
        records.append(HTTPDiagnostic(route: "section normalization", status: 0, contentType: "local validation", responseBytes: 0, structure: checks, redirect: nil))
    }
    public static func retryAfter(_ value: String?) -> TimeInterval {
        if let value, let seconds = Double(value), seconds >= 0, seconds.isFinite { return seconds }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
        return value.flatMap(formatter.date).map { max(0, $0.timeIntervalSinceNow) } ?? 60
    }
}
public struct SchoologyProvider: Sendable {
    let http: ReadOnlyHTTP
    init(http: ReadOnlyHTTP) { self.http = http }
    public init(credentials: SchoologyCredentials, diagnosticsEnabled: Bool = false) throws { http = try ReadOnlyHTTP(origin: URL(string: "https://api.schoology.com/v1/")!, credentials: credentials, diagnosticsEnabled: diagnosticsEnabled) }
    public func diagnostics() async -> [HTTPDiagnostic] { await http.diagnostics() }
    public func fetch() async throws -> [SourceCourse] {
        let me = try ProviderParsing.object(await http.get(URL(string: "https://api.schoology.com/v1/users/me")!))
        guard let userID = ProviderParsing.text(me["uid"] ?? me["id"]) else { throw ProviderError.malformed }
        let sections = try await paged(path: "users/\(OAuth1.encode(userID))/sections", key: "section")
        var courses: [SourceCourse] = [], resolvedSections = Set<String>()
        for summary in sections {
            guard let id = ProviderParsing.text(summary["id"]) else { throw ProviderError.malformed }
            if resolvedSections.contains(id) { continue }
            let grades = try await http.get(URL(string: "https://api.schoology.com/v1/users/\(OAuth1.encode(userID))/grades?section_id=\(OAuth1.encode(id))")!)
            let payload = try ProviderParsing.object(grades)
            guard let gradeSections = payload["section"] as? [[String: Any]] else { throw ProviderError.malformed }
            // The observed API can return a different section owner for these user's grades.
            // Retain the enrolled section for metadata access, and explicitly retain the grade owner.
            if gradeSections.isEmpty { continue }
            let row = gradeSections.first { ProviderParsing.text($0["section_id"]) == id } ?? (gradeSections.count == 1 ? gradeSections[0] : nil)
            guard let owner = row.flatMap({ ProviderParsing.text($0["section_id"]) }) else { throw ProviderError.malformed }
            if resolvedSections.contains(owner) { continue }
            let escaped = OAuth1.encode(id)
            let section = try await http.get(URL(string: "https://api.schoology.com/v1/sections/\(escaped)")!)
            guard ProviderParsing.text(try ProviderParsing.object(section)["id"]) == id else { throw ProviderError.malformed }
            let items = try await paged(path: "sections/\(escaped)/grade_items", key: "assignment")
            let categories = try await paged(path: "sections/\(escaped)/grading_categories", key: "grading_category")
            do {
                courses += try ProviderParsing.schoology(section: section, grades: grades, items: JSONSerialization.data(withJSONObject: ["assignment": items]), categories: JSONSerialization.data(withJSONObject: ["grading_category": categories]), gradeSectionID: owner)
                resolvedSections.insert(owner)
            } catch {
                await http.recordSchoologyChecks(section: section, grades: grades, requestedID: id)
                throw error
            }
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
    public init(base: URL, cookies: [HTTPCookie], diagnosticsEnabled: Bool = false) throws { self.base = base; http = try ReadOnlyHTTP(origin: base, cookies: cookies, diagnosticsEnabled: diagnosticsEnabled) }
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
    public func diagnostics() async -> [HTTPDiagnostic] { await http.diagnostics() }
}
