import Foundation

/// Editable score text stays ungrouped and unrounded, unlike presentation labels.
public enum ScoreInput {
    public static func number(_ text: String) -> Double? {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "−", with: "-")
            .replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value.isFinite else { return nil }
        return value
    }

    public static func text(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "" }
        let text = String(value)
        return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
    }

    public static func togglingSign(_ text: String) -> String {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "−", with: "-")
        if text.hasPrefix("-") { return String(text.dropFirst()) }
        return "-" + (text.hasPrefix("+") ? String(text.dropFirst()) : text)
    }
}
