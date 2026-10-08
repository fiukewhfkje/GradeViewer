import Foundation
import Security
import GradeCore

enum KeychainError: Error { case status(OSStatus) }
enum SecureStore {
    static func removeRetiredConnections() throws {
        // Upgrade cleanup only. Never load or decode these retired cookie items.
        try delete(account: "campus")
        try delete(account: "campus-pending")
    }
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
