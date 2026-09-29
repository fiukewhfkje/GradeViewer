import Foundation
public enum CalculationError: Error, Equatable { case unknownRules, incompleteData, invalidInput, noGradedAssignments }
public enum GradeCalculator {
    public static func percent(course: SourceCourse, hypothesis: Hypothesis = Hypothesis()) throws -> Double {
        guard course.method != .unknown else { throw CalculationError.unknownRules }
        let all = course.assignments + hypothesis.added
        let assignments = all.filter { a in !hypothesis.ignored.contains(a.id) && !a.excluded && !a.score.excused && !course.categories.contains(where: { c in c.id == a.categoryID && c.excluded }) }.map { a -> SourceAssignment in
            var a = a; if let e = hypothesis.scores[a.id] { a.score.earned = e }; return a
        }.filter { $0.score.earned != nil }
        guard assignments.allSatisfy({ ($0.score.earned?.isFinite ?? false) && ($0.score.earned ?? -1) >= 0 && ($0.score.possible?.isFinite ?? false) && ($0.score.possible ?? -1) >= 0 && $0.multiplier.isFinite && $0.multiplier > 0 }) else { throw CalculationError.invalidInput }
        guard !assignments.isEmpty else { throw CalculationError.noGradedAssignments }
        if course.method == .points { return try aggregate(assignments, method: .points) }
        var total = 0.0, weights = 0.0
        for category in course.categories where !category.excluded {
            var rows = assignments.filter { $0.categoryID == category.id }
            guard !rows.isEmpty else { continue }
            guard category.dropLowest >= 0 else { throw CalculationError.invalidInput }
            rows.sort { ($0.score.percent ?? .infinity) < ($1.score.percent ?? .infinity) }
            rows = Array(rows.dropFirst(min(category.dropLowest, rows.count)))
            guard !rows.isEmpty else { continue }
            let weight = course.method == .equalCategories ? 1 : category.weight
            guard let weight, weight.isFinite, weight >= 0 else { throw CalculationError.unknownRules }
            if weight == 0 { continue }
            let value = try aggregate(rows, method: category.method)
            total += value * weight; weights += weight
        }
        guard assignments.allSatisfy({ row in course.categories.contains { $0.id == row.categoryID } }) else { throw CalculationError.incompleteData }
        guard weights > 0 else { throw CalculationError.noGradedAssignments }
        return total / weights
    }
    private static func aggregate(_ rows: [SourceAssignment], method: CategoryMethod) throws -> Double {
        if method == .percent {
            guard rows.allSatisfy({ $0.score.percent != nil }) else { throw CalculationError.incompleteData }
            return rows.reduce(0) { $0 + $1.score.percent! * $1.multiplier } / rows.reduce(0) { $0 + $1.multiplier }
        }
        let possible = rows.reduce(0) { $0 + ($1.score.possible ?? 0) * $1.multiplier }
        guard possible > 0 else { throw CalculationError.noGradedAssignments }
        return rows.reduce(0) { $0 + ($1.score.earned ?? 0) * $1.multiplier } / possible * 100
    }
    /// Require the available source data to reproduce its reported overall before estimating changes.
    public static func isReliable(_ course: SourceCourse) -> Bool {
        guard let reported = course.grade.percent, let calculated = try? percent(course: course) else { return false }
        return abs(reported - calculated) <= 0.15
    }
    public static func requiredFinal(current: Double, target: Double, weight: Double) throws -> Double {
        guard current.isFinite, target.isFinite, weight.isFinite, current >= 0, target >= 0, weight > 0, weight <= 1 else { throw CalculationError.invalidInput }
        return (target - current * (1 - weight)) / weight
    }
}
