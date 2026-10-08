import Foundation
import CryptoKit

public struct SchoologyCredentials: Codable, Sendable {
    public var key: String; public var secret: String; public var token: String; public var tokenSecret: String
    /// Bound after users/me succeeds and reverified on refresh. Replacing keys
    /// starts without an identity; an active account change requires disconnect.
    public var userID: String? = nil
    public init(key: String, secret: String, token: String = "", tokenSecret: String = "") { self.key = key; self.secret = secret; self.token = token; self.tokenSecret = tokenSecret }
}
public struct SchoologySnapshot: Sendable {
    public let userID: String
    public let courses: [SourceCourse]
    /// An optional metadata throttle can coexist with a complete fresh snapshot.
    /// The caller must retain the server's cooldown before its next refresh.
    public let retryAfter: Date?
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
    /// Numeric URL error only; never include NSError descriptions or userInfo.
    public var networkErrorCode: Int? = nil
    static func structure(_ data: Data) -> [String: String] {
        guard let json = try? JSONSerialization.jsonObject(with: data) else { return ["root": "non-JSON"] }
        let allowed: Set<String> = ["folder-item", "self", "available", "data", "id", "weight", "grade", "error", "errors", "message", "uid", "section", "section_id", "period", "period_id", "period_title", "assignment", "final_grade", "grading_category", "links", "next", "total", "title", "options", "weighted_grading_categories", "assignment_id", "grade_item_id", "category_id", "type", "max_points", "scale_id", "scale_type", "exception", "timestamp", "calculation_type", "drop_lowest", "grading_period", "due", "factor", "count_in_grade", "teacher_display", "course_title", "section_title", "start", "end"]
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
    private var schoologyThrottleUntil: Date?
    public init(origin: URL, credentials: SchoologyCredentials? = nil, configuration: URLSessionConfiguration? = nil, diagnosticsEnabled: Bool = false) throws {
        guard origin.scheme == "https", origin.host != nil, origin.user == nil, origin.password == nil, origin.port == nil || origin.port == 443 else { throw ProviderError.unsafeURL }
        self.origin = origin; self.credentials = credentials; self.diagnosticsEnabled = diagnosticsEnabled
        let config = configuration ?? URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 60
        config.urlCache = nil; config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpMaximumConnectionsPerHost = 4
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }
    public func get(_ url: URL, retryThrottles: Bool = true) async throws -> Data { try await read(url, retryThrottles: retryThrottles) }
    private func read(_ url: URL, retryThrottles: Bool = true) async throws -> Data {
        var current = url
        var redirects = 0, throttleRetries = 0
        while redirects < 5 {
            let path = current.path
            let root = origin.path.hasSuffix("/") ? origin.path : origin.path + "/"
            guard current.scheme == "https", current.host?.lowercased() == origin.host?.lowercased(),
                  (current.port ?? 443) == (origin.port ?? 443), current.user == nil, current.password == nil,
                  current.fragment == nil, path == origin.path || path.hasPrefix(root),
                  !path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else { throw ProviderError.unsafeURL }
            try Task.checkCancellation()
            if credentials != nil {
                // A large first snapshot can hit a short server cooldown. Pause
                // all queued reads, retain completed work, and retry a GET once.
                // Longer/repeated throttles return to the app's normal backoff.
                while let until = schoologyThrottleUntil, until > Date() {
                    let seconds = until.timeIntervalSinceNow
                    guard retryThrottles, seconds <= 30 else { throw ProviderError.throttled(seconds) }
                    try await Task.sleep(for: .seconds(max(0, seconds)))
                }
            }
            var request = URLRequest(url: current); request.httpMethod = "GET"; request.setValue("application/json", forHTTPHeaderField: "Accept")
            if let credentials { request.setValue(OAuth1.header(url: current, credentials: credentials), forHTTPHeaderField: "Authorization") }
            request.httpShouldHandleCookies = false
            let requestStarted = Date()
            let data: Data, rawResponse: URLResponse
            do { (data, rawResponse) = try await session.data(for: request) }
            catch {
                if diagnosticsEnabled {
                    var record = HTTPDiagnostic(route: diagnosticRoute(current), status: 0, contentType: "connection failure", responseBytes: 0, structure: [:], redirect: nil)
                    record.elapsedMilliseconds = Date().timeIntervalSince(requestStarted) * 1000
                    record.networkErrorCode = (error as? URLError)?.code.rawValue
                    records.append(record)
                    if records.count > 200 { records.remove(at: 1) }
                }
                throw error // A network failure is not an authentication rejection.
            }
            let response = rawResponse
            guard let response = response as? HTTPURLResponse else { throw ProviderError.unavailable }
            if diagnosticsEnabled {
                let mime = response.mimeType ?? "unknown"
                let route = diagnosticRoute(current)
                var redirect: String?
                if let location = response.value(forHTTPHeaderField: "Location"), let target = URL(string: location, relativeTo: current)?.absoluteURL {
                    redirect = target.host?.lowercased() == origin.host?.lowercased() ? (target.scheme == "https" ? "same host HTTPS" : "same host other scheme") : "other host"
                }
                var record = HTTPDiagnostic(route: route, status: response.statusCode, contentType: mime, responseBytes: data.count, structure: HTTPDiagnostic.structure(data), redirect: redirect)
                record.elapsedMilliseconds = Date().timeIntervalSince(requestStarted) * 1000
                record.retryAfterSeconds = response.value(forHTTPHeaderField: "Retry-After").map(Self.retryAfter)
                records.append(record)
                if records.count > 200 { records.remove(at: 1) }
            }
            switch response.statusCode {
            case 401: throw ProviderError.reconnect
            case 403: throw ProviderError.forbidden
            case 429:
                let seconds = Self.retryAfter(response.value(forHTTPHeaderField: "Retry-After"))
                if credentials != nil {
                    schoologyThrottleUntil = max(schoologyThrottleUntil ?? .distantPast, Date().addingTimeInterval(seconds))
                    if retryThrottles, throttleRetries == 0, seconds <= 30 { throttleRetries += 1; continue }
                }
                throw ProviderError.throttled(seconds)
            case 301, 302, 303, 307, 308:
                guard let location = response.value(forHTTPHeaderField: "Location"), let next = URL(string: location, relativeTo: current)?.absoluteURL else { throw ProviderError.reconnect }
                current = next; redirects += 1; continue // Generate a fresh signature/nonce for users/me redirects.
            case 200..<300:
                let type = response.value(forHTTPHeaderField: "Content-Type")?.lowercased() ?? ""
                guard type.contains("json") else { throw type.contains("html") ? ProviderError.reconnect : ProviderError.malformed }
                return data
            default: throw ProviderError.unavailable
            }
        }
        throw ProviderError.unavailable
    }
    private func diagnosticRoute(_ url: URL) -> String {
        if url.path.hasSuffix("/users/me") { return "current user" }
        else if url.path.hasSuffix("/sections") { return "enrolled sections" }
        else if url.path.hasSuffix("/grades") { return "student grades" }
        else if url.path.hasSuffix("/grade_items") { return "assignments" }
        else if url.path.hasSuffix("/assignments") { return "assignment title list" }
        else if url.path.contains("/folder/") { return "course folder metadata" }
        else if url.path.hasSuffix("/grading_categories") { return "categories" }
        else if url.path.hasSuffix("/grading_periods") { return "grading periods" }
        else if url.path.contains("/assignments/") { return "assignment metadata" }
        else if url.path.contains("/sections/") { return "section" }
        else if url.path.contains("/users/") { return "user" }
        else { return "request" }
    }
    public func diagnostics() -> [HTTPDiagnostic] { records }
    func throttleDeadline() -> Date? { schoologyThrottleUntil.flatMap { $0 > Date() ? $0 : nil } }
    func recordTiming(_ stage: String, started: Date, counts: [String: Int] = [:]) {
        guard diagnosticsEnabled else { return }
        var record = HTTPDiagnostic(route: stage, status: 0, contentType: "local timing", responseBytes: 0, structure: counts.mapValues(String.init), redirect: nil)
        record.elapsedMilliseconds = Date().timeIntervalSince(started) * 1000
        records.append(record)
        if records.count > 200 { records.remove(at: 1) }
    }
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
private struct SchoologyPeriodMetadata: Sendable { let data: Data; let fetched: Date }
private struct SchoologyMetadataBatch: Sendable {
    let enrollment: String
    let courses: [SourceCourse]
    let fingerprint: String
    let reused: Bool
}
public struct SchoologyProvider: Sendable {
    let http: ReadOnlyHTTP
    private let userID: String?
    init(http: ReadOnlyHTTP, userID: String? = nil) { self.http = http; self.userID = userID }
    public init(credentials: SchoologyCredentials, diagnosticsEnabled: Bool = false) throws { http = try ReadOnlyHTTP(origin: URL(string: "https://api.schoology.com/v1/")!, credentials: credentials, diagnosticsEnabled: diagnosticsEnabled); userID = credentials.userID }
    public func diagnostics() async -> [HTTPDiagnostic] { await http.diagnostics() }
    public func fetch(previous: [SourceCourse] = [], refreshMetadata: Bool = false) async throws -> [SourceCourse] {
        try await fetchSnapshot(previous: previous, refreshMetadata: refreshMetadata).courses
    }
    public func fetchSnapshot(previous: [SourceCourse] = [], refreshMetadata: Bool = false) async throws -> SchoologySnapshot {
        // Authentication does not prove that cached student identity is still the
        // credential owner. Recheck users/me before requesting a student's grades.
        let me = try ProviderParsing.object(await http.get(URL(string: "https://api.schoology.com/v1/users/me")!))
        guard let userID = ProviderParsing.nonempty(me["uid"] ?? me["id"]) else { throw ProviderError.malformed }
        if let saved = self.userID, saved != userID { throw ProviderError.accountChanged }
        let previous = previous.filter { $0.source.provider == .schoology && ($0.source.fields["user_id"] == nil || $0.source.fields["user_id"] == userID) }
        // Enrollment discovery and the fresh user-grade snapshot are independent
        // once identity is established. Owner aliases are validated after both.
        async let sectionRows = paged(path: "users/\(OAuth1.encode(userID))/sections", key: "section")
        async let bulkRows = bulkGradeRows(userID: userID, previous: previous)
        let (sections, combined) = try await (sectionRows, bulkRows)
        let ids = try sections.map { row in
            guard let id = ProviderParsing.nonempty(row["id"]) else { throw ProviderError.malformed }
            return id
        }
        var seen = Set<String>()
        // Resolve grade-owner aliases before requesting metadata from enrollment IDs.
        let gradeRows: [SchoologySectionGrades]
        if let bulk = try resolveBulkGrades(combined, enrollmentIDs:ids, previous:previous) {
            gradeRows = bulk
        } else {
        let attempts = try await concurrentMap(ids.filter { seen.insert($0).inserted }, limit: 3) { id in
            do {
            let data = try await http.get(URL(string: "https://api.schoology.com/v1/users/\(OAuth1.encode(userID))/grades?section_id=\(OAuth1.encode(id))")!)
            let payload = try ProviderParsing.object(data)
            guard let rows = payload["section"] as? [[String: Any]] else { throw ProviderError.malformed }
            if rows.isEmpty { return SchoologySectionAttempt(id: id, result: .success(SchoologySectionGrades(id: id, owner: nil, data: data))) }
            let row = rows.first { ProviderParsing.text($0["section_id"]) == id } ?? (rows.count == 1 ? rows[0] : nil)
            guard let owner = row.flatMap({ ProviderParsing.nonempty($0["section_id"]) }) else { throw ProviderError.malformed }
            return SchoologySectionAttempt(id: id, result: .success(SchoologySectionGrades(id: id, owner: owner, data: data)))
            } catch { return SchoologySectionAttempt(id: id, result: .failure(error)) }
        }
        gradeRows = attempts.compactMap { try? $0.result.get() }
        let resolvedOwners = Set(gradeRows.compactMap(\.owner))
        for attempt in attempts {
            if case let .failure(error) = attempt.result {
                // An inaccessible alias is safe to skip only when another successful
                // enrolled section explicitly supplied that very same grade owner.
                guard resolvedOwners.contains(attempt.id), error as? ProviderError == .forbidden else { throw error }
            }
        }
        }
        var owners = Set<String>()
        let unique = gradeRows.filter { row in row.owner.map { owners.insert($0).inserted } ?? false }
        let batches = try await concurrentMap(unique, limit: 3) { row in
            let fingerprint = try gradeFingerprint(row)
            if !refreshMetadata, let cached = cachedMetadata(row, fingerprint: fingerprint, userID: userID, previous: previous) {
                // Identity, enrollments and complete grades were just read fresh.
                // Reuse metadata only for a byte-equivalent normalized grade row.
                return SchoologyMetadataBatch(enrollment: row.id, courses: cached.map { original in
                    var source = original; source.fetched = Date(); return source
                }, fingerprint: fingerprint, reused: true)
            }
            let escaped = OAuth1.encode(row.id)
            async let sectionData = http.get(URL(string: "https://api.schoology.com/v1/sections/\(escaped)")!)
            async let itemData = pagedData(path: "sections/\(escaped)/grade_items", key: "assignment")
            async let categoryData = pagedData(path: "sections/\(escaped)/grading_categories", key: "grading_category")
            async let periodData = periodMetadata(enrollment: escaped, owner:row.owner!, grades:row.data, previous:previous)
            let (section, items, categories, periods) = try await (sectionData, itemData, categoryData, periodData)
            guard ProviderParsing.text(try ProviderParsing.object(section)["id"]) == row.id else { throw ProviderError.malformed }
            do {
                let started = Date()
                let courses = try ProviderParsing.schoology(section: section, grades: row.data, items: items, categories: categories, periods: periods.data, periodsFetched: periods.fetched, gradeSectionID: row.owner)
                await http.recordTiming("grade parsing", started: started, counts: ["periods": courses.count, "rows": courses.reduce(0) { $0 + $1.assignments.count }])
                return SchoologyMetadataBatch(enrollment: row.id, courses: courses, fingerprint: fingerprint, reused: false)
            } catch {
                await http.recordSchoologyChecks(section: section, grades: row.data, requestedID: row.id)
                throw error
            }
        }
        // Finish every required read before optional recovery. Otherwise a title
        // 429 can put other sections' still-queued grade metadata into cooldown.
        let enriched = try await concurrentMap(batches, limit: 3) { batch in
            if batch.reused { return batch.courses }
            let courses = try await enrichTitles(batch.courses, enrollment: batch.enrollment, previous: previous)
            let stamp = String(Date().timeIntervalSince1970)
            return courses.map { original in
                var source = original
                source.source.fields["grade_snapshot_hash"] = batch.fingerprint
                source.source.fields["section_metadata_fetched"] = stamp
                source.source.fields["section_metadata_course_count"] = String(courses.count)
                source.source.fields["section_metadata_version"] = "3"
                return source
            }
        }
        let retryAfter = await http.throttleDeadline()
        let courses = enriched.flatMap { $0 }.map { original in
            var source = original
            source.source.fields["user_id"] = userID
            source.source.fields["provider_retry_after"] = retryAfter.map { String($0.timeIntervalSince1970) }
            return source
        }
        return SchoologySnapshot(userID: userID, courses: courses, retryAfter: retryAfter)
    }
    private func gradeFingerprint(_ row: SchoologySectionGrades) throws -> String {
        let sections = try ProviderParsing.collection(ProviderParsing.object(row.data)["section"])
        let matches = sections.filter { ProviderParsing.nonempty($0["section_id"]) == row.owner }
        guard matches.count == 1 else { throw ProviderError.malformed }
        let normalized = try JSONSerialization.data(withJSONObject: matches[0], options: [.sortedKeys])
        return SHA256.hash(data: normalized).map { String(format: "%02x", $0) }.joined()
    }
    private func cachedMetadata(_ row: SchoologySectionGrades, fingerprint: String, userID: String, previous: [SourceCourse]) -> [SourceCourse]? {
        let cached = previous.filter { $0.source.provider == .schoology && $0.source.fields["grade_section_id"] == row.owner && $0.source.fields["section_id"] == row.id }
        let now = Date().timeIntervalSince1970
        guard !cached.isEmpty, cached.allSatisfy({ source in
            let fields = source.source.fields
            guard fields["section_metadata_version"] == "3", fields["user_id"] == userID, fields["grade_snapshot_hash"] == fingerprint,
                  fields["section_metadata_course_count"] == String(cached.count),
                  let stamp = fields["section_metadata_fetched"].flatMap(Double.init), stamp <= now, now - stamp < 300 else { return false }
            if let periodStamp = fields["period_metadata_fetched"].flatMap(Double.init), periodStamp > now || now - periodStamp >= 3600 { return false }
            return !source.assignments.contains { row in
                !row.hasTitle && row.source.fields["title_lookup_retry_after"].flatMap(Double.init).map { $0 <= now } == true
            }
        }) else { return nil }
        return cached
    }
    /// On subsequent refreshes, the documented user-grade list plus saved,
    /// verified owner/enrollment aliases avoids one grade request per enrollment.
    /// First connections and newly unresolved owners use the original section
    /// reads to establish aliases without matching numeric IDs heuristically.
    private func bulkGradeRows(userID: String, previous: [SourceCourse]) async throws -> Data? {
        guard previous.contains(where: { $0.source.provider == .schoology }) else { return nil }
        do { return try await pagedData(path:"users/\(OAuth1.encode(userID))/grades",key:"section") }
        catch ProviderError.forbidden { return nil }
        catch ProviderError.malformed { return nil }
    }
    private func resolveBulkGrades(_ data: Data?, enrollmentIDs: [String], previous: [SourceCourse]) throws -> [SchoologySectionGrades]? {
        let old = previous.filter { $0.source.provider == .schoology }
        guard !old.isEmpty, let data else { return nil }
        let rows = try ProviderParsing.collection(ProviderParsing.object(data)["section"])
        let enrolled = Set(enrollmentIDs)
        var owners = Set<String>(), result: [SchoologySectionGrades] = []
        for row in rows {
            guard let owner = ProviderParsing.nonempty(row["section_id"]), row["period"] != nil, owners.insert(owner).inserted else { throw ProviderError.malformed }
            let known = Set(old.filter { $0.source.fields["grade_section_id"] == owner }.compactMap { $0.source.fields["section_id"] }).intersection(enrolled)
            let enrollment: String
            if known.count == 1 { enrollment = known.first! }
            else if known.isEmpty, enrolled.contains(owner) { enrollment = owner }
            else { return nil }
            result.append(SchoologySectionGrades(id:enrollment,owner:owner,data:try JSONSerialization.data(withJSONObject:["section":[row]])))
        }
        return result
    }
    private func periodMetadata(enrollment: String, owner: String, grades: Data, previous: [SourceCourse]) async throws -> SchoologyPeriodMetadata {
        let ownerSources = previous.filter { $0.source.provider == .schoology && $0.source.fields["grade_section_id"] == owner }
        let cached = ownerSources.filter { $0.source.fields["period_metadata_id"] != nil }
        let complete = ownerSources.allSatisfy { source in
            source.source.fields["section_metadata_course_count"].map { $0 == String(ownerSources.count) } ?? true
        }
        let stamp = cached.compactMap { $0.source.fields["period_metadata_fetched"].flatMap(Double.init) }.min().map(Date.init(timeIntervalSince1970:))
        let payload = try ProviderParsing.object(grades)
        let section = ProviderParsing.rows(payload["section"]).first { ProviderParsing.text($0["section_id"]) == owner } ?? [:]
        let gradeIDs = Set(ProviderParsing.rows(section["period"]).compactMap { ProviderParsing.text($0["period_id"]) })
        if let stamp, Date().timeIntervalSince(stamp) >= 0, Date().timeIntervalSince(stamp) < 3600,
           complete, !cached.isEmpty, gradeIDs.isSubset(of:Set(ownerSources.map { $0.term.id })) {
            let formatter = ISO8601DateFormatter()
            let rows: [[String:Any]] = cached.map { source in
                var row: [String:Any] = ["id":source.source.fields["period_metadata_id"]!, "title":source.term.name]
                if let date = source.term.start { row["start"] = formatter.string(from:date) }
                if let date = source.term.end { row["end"] = formatter.string(from:date) }
                if let weight = source.term.weight { row["weight"] = weight }
                return row
            }
            return SchoologyPeriodMetadata(data:try JSONSerialization.data(withJSONObject:["grading_period":rows]),fetched:stamp)
        }
        do { return SchoologyPeriodMetadata(data:try await pagedData(path:"sections/\(enrollment)/grading_periods", key:"grading_period"),fetched:Date()) }
        catch {
            if let error = error as? ProviderError {
                switch error { case .reconnect, .throttled: throw error; default: break }
            }
            if error is CancellationError { throw error }
            return SchoologyPeriodMetadata(data:Data("{\"grading_period\":[]}".utf8),fetched:Date())
        }
    }
    private func enrichTitles(_ courses: [SourceCourse], enrollment: String, previous: [SourceCourse]) async throws -> [SourceCourse] {
        let started = Date()
        let cached = Dictionary(previous.flatMap(\.assignments).map { ($0.id, $0) }, uniquingKeysWith: { a,_ in a })
        let unresolved = Dictionary(courses.flatMap(\.assignments).filter { !$0.hasTitle && $0.score.isGraded }.map { ($0.id, $0) }, uniquingKeysWith: { a,_ in a }).values.sorted { $0.id < $1.id }
        let periods = Dictionary(courses.flatMap { course in course.assignments.map { ($0.id, course.term.id) } }, uniquingKeysWith: { a,_ in a })
        var metadata = try await concurrentMap(unresolved, limit: 3) { row -> SourceAssignment in
            if let old = cached[row.id], old.hasTitle { return old }
            if let old = cached[row.id], old.score == row.score,
               old.source.fields["timestamp"] == row.source.fields["timestamp"],
               old.source.fields["category_id"] == row.source.fields["category_id"],
               let until = old.source.fields["title_lookup_retry_after"].flatMap(Double.init), until > Date().timeIntervalSince1970 {
                var result = row; result.source.fields["title_lookup_retry_after"] = String(until); return result
            }
            guard let id = row.source.fields["assignment_id"], (row.source.fields["type"] ?? "assignment") == "assignment" else { return row }
            let url = URL(string:"https://api.schoology.com/v1/sections/\(OAuth1.encode(enrollment))/assignments/\(OAuth1.encode(id))")!
            do {
                let item = try ProviderParsing.object(await http.get(url, retryThrottles: false))
                return ProviderParsing.assignmentMetadata(item, for: row, period: periods[row.id]) ?? row
            } catch {
                // Optional inaccessible/deleted metadata must not discard valid scores.
                if error is CancellationError { throw error }
                if let failure = error as? ProviderError {
                    switch failure {
                    case .reconnect: throw error
                    case .throttled(let seconds): return deferTitleLookup(row, seconds: seconds)
                    default: break
                    }
                }
                return row
            }
        }
        let missing = metadata.indices.filter { !metadata[$0].hasTitle && metadata[$0].source.fields["title_lookup_retry_after"] == nil && (metadata[$0].source.fields["type"] ?? "assignment") == "assignment" }
        var recoveredFromList = 0
        var primaryMatches = 0, wrapperMatches = 0
        if !missing.isEmpty {
            // A student may read the scoped list even when an individual resource
            // refuses its detail read. Recover only a unique, compatible explicit
            // node/wrapper identity; never match titles using scores or positions.
            do {
                let items = try await paged(path: "sections/\(OAuth1.encode(enrollment))/assignments", key: "assignment", retryThrottles: false)
                for index in missing {
                    let row = metadata[index]
                    guard let id = row.source.fields["assignment_id"] else { continue }
                    let primary = items.filter { ProviderParsing.itemID($0) == id }
                    let candidates = primary.isEmpty ? items.filter { ProviderParsing.nonempty($0["id"]) == id } : primary
                    primaryMatches += primary.count
                    wrapperMatches += candidates.count
                    guard candidates.count == 1, let item = candidates.first,
                          let recovered = ProviderParsing.assignmentMetadata(item, for: row, period: periods[row.id]) else { continue }
                    metadata[index] = recovered; recoveredFromList += 1
                }
            } catch {
                if error is CancellationError { throw error }
                if let failure = error as? ProviderError {
                    switch failure {
                    case .reconnect: throw error
                    case .throttled(let seconds):
                        for index in missing { metadata[index] = deferTitleLookup(metadata[index], seconds: seconds) }
                    default: break
                    }
                }
            }
        }
        var recoveredFromFolders = 0
        if metadata.contains(where: { !$0.hasTitle && $0.source.fields["title_lookup_retry_after"] == nil }) {
            do {
                let items = try await folderItems(enrollment: enrollment, wanted: Set(metadata.filter { !$0.hasTitle && $0.source.fields["title_lookup_retry_after"] == nil }.compactMap { $0.source.fields["assignment_id"] }))
                for index in metadata.indices where !metadata[index].hasTitle && metadata[index].source.fields["title_lookup_retry_after"] == nil {
                    let row = metadata[index]
                    let candidates = items.filter { ProviderParsing.itemID($0) == row.source.fields["assignment_id"] }
                    guard candidates.count == 1, let item = candidates.first,
                          let recovered = ProviderParsing.assignmentMetadata(item, for: row, period: periods[row.id]) else { continue }
                    metadata[index] = recovered; recoveredFromFolders += 1
                }
            } catch {
                if error is CancellationError { throw error }
                if let failure = error as? ProviderError {
                    switch failure {
                    case .reconnect: throw error
                    case .throttled(let seconds):
                        for index in metadata.indices where !metadata[index].hasTitle { metadata[index] = deferTitleLookup(metadata[index], seconds: seconds) }
                    default: break
                    }
                }
            }
        }
        // Only unsuccessful optional title lookups back off. Grades, catalog,
        // categories, and enrollment are still fetched fresh every refresh. A
        // changed score/timestamp or a newly titled catalog entry bypasses this.
        for index in metadata.indices where !metadata[index].hasTitle && metadata[index].source.fields["title_lookup_retry_after"] == nil {
            metadata[index].source.fields["title_lookup_retry_after"] = String(Date().addingTimeInterval(900).timeIntervalSince1970)
        }
        let owners = Set(courses.compactMap { $0.source.fields["grade_section_id"] })
        await http.recordTiming("title recovery", started: started, counts: ["missing before": unresolved.count, "list recovered": recoveredFromList, "folder recovered": recoveredFromFolders, "missing after": metadata.filter { !$0.hasTitle }.count, "list primary matches": primaryMatches, "list identity matches": wrapperMatches, "distinct grade owner": owners.contains(enrollment) ? 0 : 1])
        let byID = Dictionary(uniqueKeysWithValues: metadata.map { ($0.id, $0) })
        return courses.map { original in
            var source = original
            source.assignments = original.assignments.map { row in
                guard let item = byID[row.id] else { return row }
                var result = row; result.title = item.title
                result.due = row.due ?? item.due; result.score.possible = row.score.possible ?? item.score.possible
                result.source.fields["title_lookup_retry_after"] = item.hasTitle ? nil : item.source.fields["title_lookup_retry_after"]
                return result
            }
            return source
        }
    }
    private func deferTitleLookup(_ row: SourceAssignment, seconds: TimeInterval) -> SourceAssignment {
        var result = row
        result.source.fields["title_lookup_retry_after"] = String(Date().addingTimeInterval(max(900, seconds)).timeIntervalSince1970)
        return result
    }
    /// Only explicit contents of this enrolled course are read. Never follow a
    /// response location URL, cross courses, infer IDs, or request student writes.
    private func folderItems(enrollment: String, wanted: Set<String>) async throws -> [[String: Any]] {
        var pending = ["0"], visited = Set<String>(), matches: [[String: Any]] = []
        while !pending.isEmpty && visited.count < 32 {
            let batch = Array(pending.prefix(min(3, 32 - visited.count))); pending.removeFirst(batch.count)
            visited.formUnion(batch)
            // Data crosses task boundaries; untyped JSON remains local to each task.
            let pages = try await concurrentMap(batch, limit: 3) { id in
                try await http.get(URL(string: "https://api.schoology.com/v1/courses/\(OAuth1.encode(enrollment))/folder/\(OAuth1.encode(id))")!, retryThrottles: false)
            }
            for data in pages {
                let rows = try ProviderParsing.collection(ProviderParsing.object(data)["folder-item"])
                for row in rows {
                    if let itemID = ProviderParsing.itemID(row), wanted.contains(itemID) { matches.append(row) }
                    if ProviderParsing.nonempty(row["type"]) == "folder", let folder = ProviderParsing.nonempty(row["id"]),
                       !visited.contains(folder), !pending.contains(folder) { pending.append(folder) }
                }
            }
            if wanted.isSubset(of: Set(matches.compactMap(ProviderParsing.itemID))) { break }
        }
        return matches
    }
    private func pagedData(path: String, key: String) async throws -> Data {
        try await JSONSerialization.data(withJSONObject: [key: paged(path: path, key: key)])
    }
    private func paged(path: String, key: String, retryThrottles: Bool = true) async throws -> [[String: Any]] {
        var next: URL? = URL(string: "https://api.schoology.com/v1/\(path)?limit=200"), seen = Set<URL>(), all: [[String: Any]] = []
        while let url = next {
            guard seen.insert(url).inserted, seen.count <= 100 else { throw ProviderError.tooManyPages }
            let payload = try ProviderParsing.object(await http.get(url, retryThrottles: retryThrottles))
            all += try ProviderParsing.collection(payload[key])
            if let value = payload["links"], !(value is [String: Any]) { throw ProviderError.malformed }
            let links = payload["links"] as? [String: Any]
            if let value = links?["next"], !(value is NSNull), !(value is String) { throw ProviderError.malformed }
            if let s = links?["next"] as? String, !s.isEmpty {
                guard let candidate = URL(string: s, relativeTo: url)?.absoluteURL else { throw ProviderError.malformed }
                // Some Schoology examples return HTTP links: upgrade only this same provider host.
                var c = URLComponents(url: candidate, resolvingAgainstBaseURL: false)!
                if c.host == "api.schoology.com" { c.scheme = "https" }
                guard c.url?.path == url.path else { throw ProviderError.malformed }
                next = c.url
            } else {
                if let total = ProviderParsing.number(payload["total"]), Double(all.count) < total { throw ProviderError.malformed }
                next = nil
            }
        }
        return all
    }
}
private struct SchoologySectionAttempt: Sendable { let id: String; let result: Result<SchoologySectionGrades, Error> }
private struct SchoologySectionGrades: Sendable { let id: String; let owner: String?; let data: Data }

/// Bounded concurrency, stable input order, and cancellation on a failed snapshot.
func concurrentMap<Input: Sendable, Output: Sendable>(_ input: [Input], limit: Int, operation: @escaping @Sendable (Input) async throws -> Output) async throws -> [Output] {
    try await withThrowingTaskGroup(of: (Int, Output).self) { group in
        var next = 0, completed: [(Int, Output)] = []
        func submit() {
            let index = next; next += 1
            group.addTask { (index, try await operation(input[index])) }
        }
        for _ in 0..<min(max(1, limit), input.count) { submit() }
        while let result = try await group.next() {
            completed.append(result)
            if next < input.count { submit() }
        }
        return completed.sorted { $0.0 < $1.0 }.map { $0.1 }
    }
}
