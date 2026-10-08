import Foundation

public struct AssignmentGroupData: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let assignments: [Assignment]
}
public enum AssignmentGrouping {
    public static func updated(for course: Course) -> Date? {
        overview(for: course).compactMap { $0.display.updated }.max()
            ?? (course.history.count > 1 ? course.history.last?.date : nil)
    }
    public static func overview(for course: Course) -> [Assignment] { AssignmentOrdering.graded(course.assignments) }
    public static func groups(for course: Course) -> [AssignmentGroupData] {
        let source = course.calculationSource, graded = overview(for: course)
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
