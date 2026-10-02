import Foundation

/// Imports a browser's Cookie request header for one explicitly selected HTTPS
/// Campus origin. It cannot infer expiry, renew a session, or import SSO cookies.
public enum CampusCookieHeader {
    public static func parse(_ header: String, origin: URL) throws -> [HTTPCookie] {
        guard origin.scheme == "https", let host = origin.host, origin.user == nil, origin.password == nil,
              origin.port == nil || origin.port == 443,
              header.utf8.count <= 65_536,
              !header.unicodeScalars.contains(where: { $0.value < 32 || $0.value > 126 }) else { throw ProviderError.malformed }
        var text = header.trimmingCharacters(in: .whitespaces)
        if text.lowercased().hasPrefix("cookie:") { text = String(text.dropFirst(7)).trimmingCharacters(in: .whitespaces) }
        guard !text.isEmpty else { throw ProviderError.malformed }
        let nameCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'*+-.^_`|~")
        let attributes: Set<String> = ["domain", "path", "expires", "max-age", "secure", "httponly", "samesite"]
        var names: Set<String> = []
        return try text.split(separator: ";", omittingEmptySubsequences: false).map { pair in
            let part = pair.trimmingCharacters(in: .whitespaces)
            guard let separator = part.firstIndex(of: "=") else { throw ProviderError.malformed }
            let name = String(part[..<separator]), value = String(part[part.index(after: separator)...])
            guard !name.isEmpty, name.unicodeScalars.allSatisfy({ nameCharacters.contains($0) }),
                  !attributes.contains(name.lowercased()), names.insert(name).inserted else { throw ProviderError.malformed }
            let unquoted = value.hasPrefix("\"") && value.hasSuffix("\"") && value.count >= 2 ? String(value.dropFirst().dropLast()) : value
            guard unquoted.unicodeScalars.allSatisfy({
                $0.value == 0x21 || (0x23...0x2B).contains($0.value) || (0x2D...0x3A).contains($0.value) ||
                    (0x3C...0x5B).contains($0.value) || (0x5D...0x7E).contains($0.value)
            }), let cookie = HTTPCookie(properties: [.name: name, .value: value, .domain: host.lowercased(),
                                                    .path: origin.path.isEmpty ? "/" : origin.path, .secure: "TRUE"])
            else { throw ProviderError.malformed }
            return cookie
        }
    }
}
