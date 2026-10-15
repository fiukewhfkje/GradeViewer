import Foundation

/// A presentation-only inverse weighted average. Never persisted as a provider
/// grade, assignment score, scenario baseline, or observed history point.
public struct PeriodGradeEstimate: Sendable {
    public let percent: Double
    public let semesterLabel: String
    public let knownPeriodLabels: [String]
    public let excludesBlankExam: Bool
}

public extension GradingPeriods {
    static func estimatedGrade(for quarter: Course, among available: [Course]) -> PeriodGradeEstimate? {
        let target = quarter.display
        guard descriptor(quarter).kind == .quarter,
              target.grade.percent == nil, target.grade.letter == nil,
              target.source.fields["unsupported_overall_scale"] != "true",
              target.source.fields["overall_override"] != "true",
              target.assignments.contains(where: { $0.hasTitle }),
              let semester = semester(for:quarter,among:available),
              !semester.display.hasCalculatedGrade,
              semester.display.source.fields["overall_override"] != "true",
              !semester.display.assignments.contains(where: { $0.score.isGraded && !$0.score.excused && !$0.excluded }),
              let reported = semester.display.grade.percent, reported.isFinite else { return nil }

        let children = related(to:semester,among:available).filter { child in
            let kind = descriptor(child).kind
            return (kind == .quarter || kind == .exam) && self.semester(for:child,among:available)?.id == semester.id
        }
        let quarters = ordered(children.filter { descriptor($0).kind == .quarter })
        // Require an unambiguous two-quarter semester with complete dated
        // coverage. Other layouts remain unavailable rather than guessed.
        guard quarters.count == 2, quarters.contains(where: { $0.id == quarter.id }),
              Set(quarters.compactMap { descriptor($0).ordinal }).count == 2,
              let firstStart = descriptor(quarters[0]).start, let firstEnd = descriptor(quarters[0]).end,
              let lastStart = descriptor(quarters[1]).start, let lastEnd = descriptor(quarters[1]).end,
              let start = descriptor(semester).start, let end = descriptor(semester).end,
              day(firstStart) == day(start), day(lastEnd) == day(end),
              day(firstEnd) + 1 == day(lastStart),
              children.allSatisfy({ $0.display.term.weight.map { $0.isFinite && $0 >= 0 } == true }),
              let ownWeight = target.term.weight, ownWeight > 0 else { return nil }

        var totalWeight = ownWeight, knownWeight = 0.0, knownSum = 0.0
        var knownLabels: [String] = [], excludesBlankExam = false
        for child in ordered(children) where child.id != quarter.id {
            let source = child.display, weight = source.term.weight!
            if weight == 0 { continue }
            if let value = source.grade.percent, value.isFinite,
               !source.hasCalculatedGrade, source.source.fields["overall_override"] != "true" {
                totalWeight += weight; knownWeight += weight; knownSum += value * weight
                knownLabels.append(descriptor(child).label)
            } else if descriptor(child).kind == .exam, source.grade.percent == nil, source.grade.letter == nil,
                      source.source.fields["unsupported_overall_scale"] != "true",
                      source.source.fields["overall_override"] != "true",
                      !source.assignments.contains(where: { $0.score.isGraded && !$0.score.excused && !$0.excluded }) {
                // A genuinely blank exam is absent from the normalized average,
                // not a zero. This assumption is disclosed with the estimate.
                excludesBlankExam = true
            } else { return nil } // A second unknown cannot be solved uniquely.
        }
        // If the semester already equals the known-only average, an empty Q2
        // and an equal-scoring Q2 are indistinguishable. Do not fabricate one.
        guard knownWeight > 0, abs(reported - knownSum / knownWeight) > 0.005 else { return nil }
        let value = (reported * totalWeight - knownSum) / ownWeight
        guard totalWeight.isFinite, knownSum.isFinite, value.isFinite, value >= 0 else { return nil }
        return PeriodGradeEstimate(percent:value,semesterLabel:descriptor(semester).label,
                                   knownPeriodLabels:knownLabels,excludesBlankExam:excludesBlankExam)
    }
}
