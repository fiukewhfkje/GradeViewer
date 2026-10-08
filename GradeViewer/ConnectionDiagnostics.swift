import Foundation
import GradeCore

/// The report contains only fixed error labels, response types, and schema shape.
struct ConnectionDiagnostics: Codable {
    let provider: ProviderID
    let result: String
    let responses: [HTTPDiagnostic]

    static func result(_ error: Error?) -> String {
        guard let error else { return "success" }
        if let error = error as? ProviderError {
            switch error {
            case .reconnect: return "sign-in required"
            case .accountChanged: return "account changed"
            case .forbidden: return "access denied"
            case .throttled: return "rate limited"
            case .malformed: return "unexpected JSON structure"
            case .unavailable: return "request failed"
            case .unsafeURL: return "redirect outside allowed origin"
            case .tooManyPages: return "pagination limit"
            }
        }
        if let error = error as? URLError { return "network error \(error.code.rawValue)" }
        if error is KeychainError { return "Keychain error" }
        if (error as NSError).domain == NSCocoaErrorDomain { return "JSON or local storage error" }
        return "connection error"
    }

    var summary: String {
        guard let response = responses.last else { return result }
        if response.status == 0 { return "\(response.route.capitalized): \(result)." }
        return "\(response.route.capitalized): HTTP \(response.status), \(response.contentType). \(result.capitalized)."
    }

    func save() {
        guard let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let url = directory.appendingPathComponent("connection-\(provider.rawValue).json")
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        // A report failure must never replace the original connection result.
        if let data = try? encoder.encode(self) { try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
}
