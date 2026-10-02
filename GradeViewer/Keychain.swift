import Foundation
import Security
import GradeCore

enum KeychainError: Error { case status(OSStatus) }
enum SecureStore {
    // Preserve the existing service for an unchanged bundle ID, while isolating clones.
    private static let service = Bundle.main.bundleIdentifier ?? "org.gradeviewer.GradeViewer"
    static func save<T: Encodable>(_ value: T, account: String) throws {
        let data = try JSONEncoder().encode(value)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecItemNotFound {
            var item = query; item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            let status = SecItemAdd(item as CFDictionary, nil); guard status == errSecSuccess else { throw KeychainError.status(status) }
        } else if update != errSecSuccess { throw KeychainError.status(update) }
    }
    static func load<T: Decodable>(_ type: T.Type, account: String) throws -> T? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var value: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw KeychainError.status(status) }
        return try JSONDecoder().decode(T.self, from: data)
    }
    static func delete(account: String) throws {
        let status = SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError.status(status) }
    }
}
struct StoredCookie: Codable, Sendable {
    var name: String; var value: String; var domain: String; var path: String; var expires: Date?; var secure: Bool
    var httpOnly: Bool? = nil // Optional for existing Keychain payloads.
    var sameSite: String? = nil
    init(_ cookie: HTTPCookie) { name = cookie.name; value = cookie.value; domain = cookie.domain; path = cookie.path; expires = cookie.expiresDate; secure = cookie.isSecure; httpOnly = cookie.isHTTPOnly; sameSite = cookie.sameSitePolicy?.rawValue }
    var cookie: HTTPCookie? {
        var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: domain, .path: path]
        if secure { properties[.secure] = "TRUE" }
        if let expires { properties[.expires] = expires }
        if httpOnly == true { properties[HTTPCookiePropertyKey(rawValue: "HttpOnly")] = "TRUE" }
        if let sameSite { properties[.sameSitePolicy] = sameSite }
        return HTTPCookie(properties: properties)
    }
}
struct CampusSession: Codable, Sendable {
    var portal: URL; var base: URL; var cookies: [StoredCookie]
    var sso: CampusSSO? = nil // Older connections have only Campus cookies.
    init(portal: URL, cookies: [HTTPCookie]) throws {
        guard portal.scheme == "https", portal.user == nil, portal.password == nil, portal.port == nil || portal.port == 443, portal.host != nil else { throw ProviderError.unsafeURL }
        let range: Range<String.Index>
        if portal.path.contains("/portal/students/"), let found = portal.path.range(of: "/portal/") { range = found }
        else if portal.path.contains("/nav-wrapper/student/portal/student/"), let found = portal.path.range(of: "/nav-wrapper/") { range = found }
        else { throw ProviderError.unsafeURL }
        var components = URLComponents(url: portal, resolvingAgainstBaseURL: false)!
        // Keep only a reusable page location, never transient SAML material.
        components.queryItems = components.queryItems?.filter { !["samlrequest", "samlresponse", "relaystate"].contains($0.name.lowercased()) }
        if components.queryItems?.isEmpty == true { components.query = nil }
        components.fragment = nil
        guard let savedPortal = components.url else { throw ProviderError.unsafeURL }
        self.portal = savedPortal
        components.path = String(portal.path[..<range.lowerBound]) + "/"; components.query = nil
        guard let base = components.url else { throw ProviderError.unsafeURL }; self.base = base
        // The grade transport receives Campus cookies only. Browser SSO is separate.
        self.cookies = []
        replaceCookies(cookies)
    }
    mutating func replaceCookies(_ cookies: [HTTPCookie]) {
        guard let host = base.host?.lowercased() else { self.cookies = []; return }
        self.cookies = cookies.filter {
            let domain = $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
            return (host == domain || host.hasSuffix("." + domain)) && ($0.expiresDate.map { $0 > Date() } ?? true)
        }.map(StoredCookie.init)
    }
}

/// The reusable Campus entry and cookies from hosts visited during normal SSO.
/// Assertions, redirect queries, passwords and page content are never retained.
struct CampusSSO: Codable, Sendable {
    var entry: URL
    var hosts: Set<String>
    var cookies: [StoredCookie]
    var needsSignIn: Bool? = nil

    init(base: URL, entry: URL, hosts: Set<String>, cookies: [HTTPCookie]) throws {
        guard Self.validEntry(entry, base: base) else { throw ProviderError.unsafeURL }
        self.entry = entry
        let selectedHosts = hosts.filter { $0 != base.host?.lowercased() && $0.contains(".") && !$0.hasSuffix(".") }
        self.hosts = selectedHosts
        self.cookies = cookies.filter { cookie in
            Self.matches(cookie, hosts: selectedHosts) && (cookie.expiresDate.map { $0 > Date() } ?? true)
        }.map(StoredCookie.init)
    }

    func browserCookies(base: URL) -> [HTTPCookie] {
        guard Self.validEntry(entry, base: base) else { return [] }
        return cookies.compactMap(\.cookie).filter {
            Self.matches($0, hosts: hosts) && ($0.expiresDate.map { $0 > Date() } ?? true)
        }
    }
    func canRenew(base: URL) -> Bool { needsSignIn != true && !browserCookies(base: base).isEmpty }
    static func returnedToCampus(_ url: URL, base: URL, visitedIdp: Bool) -> Bool {
        visitedIdp && url.scheme == "https" && url.user == nil && url.password == nil &&
        (url.port == nil || url.port == 443) && url.host?.lowercased() == base.host?.lowercased() &&
        (url.path == base.path || url.path.hasPrefix(base.path.hasSuffix("/") ? base.path : base.path + "/"))
    }
    static func matches(_ cookie: HTTPCookie, hosts: Set<String>) -> Bool {
        let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        guard domain.contains(".") else { return false }
        return hosts.contains { $0 == domain || $0.hasSuffix("." + domain) }
    }
    static func validEntry(_ entry: URL, base: URL) -> Bool {
        let prefix = base.appendingPathComponent("SSO").path + "/"
        guard entry.scheme == "https", entry.user == nil, entry.password == nil,
              entry.port == nil || entry.port == 443, entry.host?.lowercased() == base.host?.lowercased(),
              entry.fragment == nil, entry.path.hasPrefix(prefix) else { return false }
        let suffix = String(entry.path.dropFirst(prefix.count)).split(separator: "/", omittingEmptySubsequences: false)
        guard suffix.count == 3, !suffix[0].isEmpty, suffix[0] != ".", suffix[0] != "..",
              suffix[1] == "portal", suffix[2] == "students" else { return false }
        let query = URLComponents(url: entry, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return query.isEmpty || (query.count == 1 && query[0].name == "configID" && query[0].value?.isEmpty == false && query[0].value!.allSatisfy { $0.isASCII && $0.isNumber })
    }
}
