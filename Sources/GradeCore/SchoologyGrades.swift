import Foundation

public extension SourceCourse {
    var hasCalculatedGrade: Bool { source.fields["grade_basis"] == "calculated" }
}

/// Reported totals win. Omitted totals use only complete supported rules.
/// Provenance/UI distinguish the result from an observed provider grade.
public enum SchoologyGrades {
    public static func resolved(_ input: [SourceCourse]) -> [SourceCourse] {
        var sources = input.map { supplied in
            var source = supplied
            if source.hasCalculatedGrade { source.grade.percent = nil; source.source.fields["grade_basis"] = nil }
            if source.grade.percent == nil, source.grade.letter == nil,
               source.source.fields["unsupported_overall_scale"] != "true",
               let value = try? GradeCalculator.percent(course: source), value.isFinite {
                source.grade.percent = value; source.source.fields["grade_basis"] = "calculated"
            }
            return source
        }
        let courses = sources.map { Course(id: $0.id, sources: [$0]) }
        for index in sources.indices where sources[index].grade.percent == nil && sources[index].grade.letter == nil && sources[index].source.fields["unsupported_overall_scale"] != "true" {
            guard GradingPeriods.descriptor(sources[index]).kind == .semester else { continue }
            let children = GradingPeriods.related(to: courses[index], among: courses).filter { child in
                let kind = GradingPeriods.descriptor(child).kind
                return (kind == .quarter || kind == .exam) && GradingPeriods.semester(for: child, among: courses)?.id == courses[index].id && (child.display.grade.percent != nil || child.display.grade.letter != nil || child.display.assignments.contains { $0.score.isGraded } || child.display.source.fields["unsupported_overall_scale"] == "true")
            }
            guard !children.isEmpty, children.allSatisfy({ $0.display.grade.percent != nil && $0.display.term.weight.map { $0.isFinite && $0 >= 0 } == true }) else { continue }
            let weight = children.reduce(0) { $0 + $1.display.term.weight! }
            guard weight > 0 else { continue }
            sources[index].grade.percent = children.reduce(0) { $0 + $1.display.grade.percent! * $1.display.term.weight! } / weight
            sources[index].source.fields["grade_basis"] = "calculated"
        }
        return sources
    }
}
