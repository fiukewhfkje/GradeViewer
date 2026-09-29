import Foundation
public enum Demo {
    public static let now = Date(timeIntervalSince1970: 1_790_719_200)
    public static func courses(longList: Bool = false) -> [Course] {
        let names = ["AP Physics 1", "AP Computer Science A", "AP Calculus BC", "AP Statistics", "AP Biology", "English Literature and Composition: Seminar"]
        let values = [95.8, 98.6, 87.25, 94.3, 92.4, 93.1]
        var result: [Course] = []
        for (i, name) in names.enumerated() {
            let id = "demo:\(i)", categoryID = id + ":tests"
            let assignments: [SourceAssignment] = (0..<(longList ? 350 : 12)).map { j in
                let title: String
                if j == 0 { title = "2-D Kinematics Quiz" }
                else if j == 1 { title = "1-D Kinematics Quiz" }
                else if j == 2 { title = "Hit or Miss Lab" }
                else { title = ["Practice", "Lab", "Quiz"][j % 3] + " " + String(j + 1) }
                let due = now.addingTimeInterval(Double(-j) * 86400)
                let updated = due.addingTimeInterval(-10800)
                let score = Score(earned: values[i] + [-4.0, 2.0, 2.0][j % 3], possible: 100)
                return SourceAssignment(source: Provenance(.infiniteCampus, id + ":assignment:" + String(j)), title: title, categoryID: categoryID, due: due, updated: updated, score: score)
            }
            let source = SourceCourse(source: Provenance(.infiniteCampus, id), title: name, teacher: "Taylor", term: Term(id: "fall", name: "Fall 2026"), grade: OverallGrade(percent: values[i], letter: i == 2 ? "B" : "A"), categories: i == 0 ? [GradingCategory(id: categoryID, name: "Total Points")] : [GradingCategory(id: categoryID, name: "Assessments", weight: 70), GradingCategory(id: id + ":practice", name: "Practice", weight: 30)], assignments: assignments, method: i == 0 ? .points : .weightedCategories, fetched: now)
            var course = Reconciler.reconcile([source], now: now)[0]; course.order = i
            course.history = (0..<9).map { j in GradeHistorySnapshot(date: now.addingTimeInterval(Double(j - 8) * 3 * 86400), grade: OverallGrade(percent: values[i] + [1.4, 1, -0.6, 0.8, 0.1, -0.4, -0.2, 0.3, 0][j], letter: i == 2 ? "B" : "A"), provider: .infiniteCampus) }
            result.append(course)
        }
        return result
    }
}
public struct WidgetCourse: Codable, Identifiable, Sendable {
    public var id: String; public var name: String; public var grade: OverallGrade
    public init(course: Course) { id = course.id; name = course.name; grade = course.display.grade }
}
public struct WidgetSnapshot: Codable, Sendable {
    public var courses: [WidgetCourse]; public var refreshed: Date?
    public init(courses: [WidgetCourse] = [], refreshed: Date? = nil) { self.courses = courses; self.refreshed = refreshed }
}
