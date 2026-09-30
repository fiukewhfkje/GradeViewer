import Foundation

public enum AssignmentOrdering {
    /// A scored date is evidence of recent grading; a future due date is not.
    public static func graded<S: Sequence>(_ rows: S) -> [Assignment] where S.Element == Assignment {
        rows.filter { $0.display.score.isGraded }.sorted {
            let a = $0.display, b = $1.display
            if a.updated != b.updated { return (a.updated ?? .distantPast) > (b.updated ?? .distantPast) }
            if a.due != b.due { return (a.due ?? .distantPast) > (b.due ?? .distantPast) }
            let titleA = Reconciler.normalize(a.title), titleB = Reconciler.normalize(b.title)
            return titleA == titleB ? $0.id < $1.id : titleA < titleB
        }
    }
}

/// Static presentation rounding. This does not schedule a timer or alter source dates.
public struct GradeUpdateAge: Sendable {
    public let text: String
    public let fresh: Bool
    public init(date: Date, now: Date = Date()) {
        let elapsed = max(0, now.timeIntervalSince(date)), hours = elapsed / 3600
        fresh = hours < 24
        if hours < 0.5 { text = "updated recently" }
        else if hours < 23.5 {
            let count = Int(hours.rounded())
            text = "updated \(count) \(count == 1 ? "hour" : "hours") ago"
        } else {
            let count = max(1, Int((elapsed / 86400).rounded()))
            text = "updated \(count) \(count == 1 ? "day" : "days") ago"
        }
    }
}
