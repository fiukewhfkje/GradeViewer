import Foundation

public struct AssignmentGroupData: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let assignments: [Assignment]
}
public enum AssignmentGrouping {
    public static func updated(for course: Course, among available: [Course] = []) -> Date? {
        overview(for: GradingPeriods.presentation(for:course,among:available)).compactMap { $0.display.updated }.max()
            ?? (course.history.count > 1 ? course.history.last?.date : nil)
    }
    public static func overview(for course: Course) -> [Assignment] {
        AssignmentOrdering.graded(course.assignments.filter { course.removedAssignmentIDs?.contains($0.id) != true })
    }
    /// Known ungraded catalog entries belong in All Assignments. Empty API
    /// placeholders with no title are not evidence of another assignment.
    public static func all(for course: Course) -> [Assignment] {
        let ungraded=course.assignments.filter { !$0.display.score.isGraded && $0.display.hasTitle && course.removedAssignmentIDs?.contains($0.id) != true }.sorted {
            if $0.display.due != $1.display.due { return ($0.display.due ?? .distantFuture) < ($1.display.due ?? .distantFuture) }
            return $0.display.title == $1.display.title ? $0.id < $1.id : $0.display.title < $1.display.title
        }
        return overview(for:course) + ungraded
    }
    public static func groups(for course: Course, includeUngraded: Bool = false) -> [AssignmentGroupData] {
        let source = course.calculationSource, graded = includeUngraded ? all(for:course) : overview(for: course)
        if source.method == .points || source.categories.isEmpty {
            return [AssignmentGroupData(id: "total", title: "Total Points", assignments: graded)]
        }
        var used = Set<String>(), result: [AssignmentGroupData] = []
        for category in source.categories {
            let rows = graded.filter { $0.display.categoryID == category.id }
            if !rows.isEmpty { result.append(AssignmentGroupData(id: category.id, title: category.name, assignments: rows)); used.formUnion(rows.map(\.id)) }
        }
        let other = graded.filter { !used.contains($0.id) }
        if !other.isEmpty { result.append(AssignmentGroupData(id: "other", title: "Other Assignments", assignments: other)) }
        return result
    }
}
