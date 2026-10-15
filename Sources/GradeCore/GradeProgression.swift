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
    init(id: String, date: Date, percent: Double, usesDueDate: Bool) {
        self.id = "calculated:\(id)"; self.date = date; grade = OverallGrade(percent: percent); calculated = true; self.usesDueDate = usesDueDate
    }
    init(aligning point: GradeProgressionPoint, percent: Double) {
        id=point.id; date=point.date; grade=OverallGrade(percent:percent)
        calculated=point.calculated; usesDueDate=point.usesDueDate
    }
}
public enum GradeProgression {
    /// Reconstruct the section's available year from its actual assignment periods.
    /// Each period retains its own calculation rules; semester rollups and exams
    /// are not counted again when quarter assignment periods are available.
    public static func points(for course: Course, among available: [Course]) -> [GradeProgressionPoint] {
        let assignmentPeriods = GradingPeriods.assignmentPeriods(for: course, among: available)
        let periods = assignmentPeriods.isEmpty ? [course] : assignmentPeriods
        let populated = periods.filter { $0.calculationSource.assignments.contains { $0.score.isGraded } || !$0.history.isEmpty }
        guard let latest = populated.last else { return [] }
        return populated.flatMap { period in
            let source = period.calculationSource
            // A fetch today of a completed quarter is not a new year-end grade
            // event. Keep its dated assignments and observations made in-period.
            let history = period.history.filter { snapshot in period.id == latest.id || GradingPeriods.includesHistory(source,date:snapshot.date) }
            let reconstructed=calculated(source, before: source.fetched, includeCurrent: period.id == latest.id)
            return anchored(reconstructed,to:history) + history.map(GradeProgressionPoint.init)
        }
    }
    /// A rounded observation is better evidence than a reconstructed prefix in
    /// the same assignment interval. Only adjust calculated presentation points
    /// within a hundredth; retain every real observation, score and event date.
    private static func anchored(_ points: [GradeProgressionPoint], to history: [GradeHistorySnapshot]) -> [GradeProgressionPoint] {
        let dates=Array(Set(points.map(\.date))).sorted()
        let next=Dictionary(uniqueKeysWithValues:zip(dates,dates.dropFirst()))
        let observations=history.sorted { $0.date == $1.date ? $0.id.uuidString < $1.id.uuidString : $0.date < $1.date }
        return points.map { point in
            // An actual current calculation remains the calculator's endpoint.
            guard !point.id.hasPrefix("calculated:snapshot:"),let value=point.grade.percent,
                  let observed=observations.first(where: { snapshot in
                      snapshot.date >= point.date && snapshot.date < (next[point.date] ?? .distantFuture)
                          && snapshot.grade.percent.map { GradePrecision.matchesReconstruction(value,$0) } == true
                  })?.grade.percent else { return point }
            return GradeProgressionPoint(aligning:point,percent:observed)
        }
    }
    public static func calculated(_ source: SourceCourse, before cutoff: Date, includeCurrent: Bool = true) -> [GradeProgressionPoint] {
        guard GradeCalculator.isReliable(source) else { return [] }
        guard let reported = source.grade.percent, let baseline = try? GradeCalculator.percent(course: source) else { return [] }
        // A calculated current total uses the real snapshot fetch time. It can
        // follow older imported observations without rewriting those observations.
        let current = includeCurrent && source.hasCalculatedGrade && source.fetched <= cutoff
            ? [GradeProgressionPoint(id: "snapshot:" + source.id, date: source.fetched, percent: reported, usesDueDate: false)] : []
        let scored = source.assignments.filter { $0.score.earned != nil }
        guard !scored.isEmpty, scored.allSatisfy({ ($0.updated ?? $0.due).map { $0 <= source.fetched } == true }) else { return current }
        // A batch edit can give several distinct scores the same timestamp. Keep
        // every contribution; due date and identity provide stable ties, not new dates.
        let ordered = scored.sorted {
            let a = $0.updated ?? $0.due!, b = $1.updated ?? $1.due!
            if a != b { return a < b }
            if $0.due != $1.due { return ($0.due ?? .distantPast) < ($1.due ?? .distantPast) }
            return $0.id < $1.id
        }
        var prefix = source, included: [SourceAssignment] = [], result: [GradeProgressionPoint] = []
        for row in ordered {
            let date = row.updated ?? row.due!
            guard date <= cutoff else { continue }
            included.append(row); prefix.assignments = included
            guard let value = try? GradeCalculator.percent(course: prefix) else { continue }
            // Earlier prefixes use their own calculation: applying today's
            // rounding offset to an earlier perfect score invents a 99.99 point.
            // A prefix equal to the complete baseline uses the reported total,
            // preserving the endpoint without introducing a rounding-only step.
            let percent = abs(value - baseline) <= 0.000000001 ? reported : value
            result.append(GradeProgressionPoint(id: row.id, date: date, percent: percent, usesDueDate: row.updated == nil))
        }
        return result + current
    }
}
