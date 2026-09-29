import Foundation
import Security
import GradeCore

enum KeychainError: Error { case status(OSStatus) }
enum SecureStore {
    private static let service = "com.ashtonchang.GradeViewer"
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
struct StoredCookie: Codable {
    var name: String; var value: String; var domain: String; var path: String; var expires: Date?; var secure: Bool
    init(_ cookie: HTTPCookie) { name = cookie.name; value = cookie.value; domain = cookie.domain; path = cookie.path; expires = cookie.expiresDate; secure = cookie.isSecure }
    var cookie: HTTPCookie? {
        var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: domain, .path: path, .secure: secure ? "TRUE" : "FALSE"]
        if let expires { properties[.expires] = expires }
        return HTTPCookie(properties: properties)
    }
}
struct CampusSession: Codable {
    var portal: URL; var base: URL; var cookies: [StoredCookie]
    init(portal: URL, cookies: [HTTPCookie]) throws {
        guard portal.scheme == "https", portal.user == nil, portal.password == nil, portal.port == nil || portal.port == 443, let host = portal.host else { throw ProviderError.unsafeURL }
        let range: Range<String.Index>
        if portal.path.contains("/portal/students/"), let found = portal.path.range(of: "/portal/") { range = found }
        else if portal.path.contains("/nav-wrapper/student/portal/student/"), let found = portal.path.range(of: "/nav-wrapper/") { range = found }
        else { throw ProviderError.unsafeURL }
        self.portal = portal
        var components = URLComponents(url: portal, resolvingAgainstBaseURL: false)!; components.path = String(portal.path[..<range.lowerBound]) + "/"; components.query = nil; components.fragment = nil
        guard let base = components.url else { throw ProviderError.unsafeURL }; self.base = base
        // Only Campus-origin cookies are retained; SSO cookies never leave the login view.
        self.cookies = cookies.filter { let d = $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased(); return host.lowercased() == d || host.lowercased().hasSuffix("." + d) }.map(StoredCookie.init)
    }
}
