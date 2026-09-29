import Foundation

/// Presentation-only points. Calculated prefixes are never persisted as observed history.
public struct GradeProgressionPoint: Identifiable, Sendable {
    public let id: String
    public let date: Date
    public let grade: OverallGrade
    public let calculated: Bool
    public let usesDueDate: Bool
    public init(_ snapshot: GradeHistorySnapshot) {
        id = snapshot.id.uuidString; date = snapshot.date; grade = snapshot.grade; calculated = false; usesDueDate = false
    }
    init(date: Date, percent: Double, usesDueDate: Bool) {
        id = "calculated:\(date.timeIntervalSince1970)"; self.date = date; grade = OverallGrade(percent: percent); calculated = true; self.usesDueDate = usesDueDate
    }
}
public enum GradeProgression {
    public static func calculated(_ source: SourceCourse, before firstObservation: Date) -> [GradeProgressionPoint] {
        guard GradeCalculator.isReliable(source) else { return [] }
        let scored = source.assignments.filter { $0.score.earned != nil }
        guard scored.count > 1, scored.allSatisfy({ ($0.updated ?? $0.due).map { $0 <= source.fetched } == true }) else { return [] }
        let groups = Dictionary(grouping: scored, by: { $0.updated ?? $0.due! })
        var prefix = source, included: [SourceAssignment] = [], result: [GradeProgressionPoint] = []
        for date in groups.keys.sorted() where date < firstObservation {
            let rows = groups[date]!
            included += rows; prefix.assignments = included
            guard let value = try? GradeCalculator.percent(course: prefix) else { continue }
            result.append(GradeProgressionPoint(date: date, percent: value, usesDueDate: rows.contains { $0.updated == nil }))
        }
        return result
    }
}
