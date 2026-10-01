import Foundation

/// Select one current card per physical Campus section. Grading tasks and terms
/// stay separate in the cache/calculator; exam totals never become another class.
public enum CourseSelection {
    public static func visible(_ courses: [Course], term: String) -> [Course] {
        let eligible = courses.filter { !$0.hidden && (term.isEmpty || $0.display.term.name == term) }
        let groups = Dictionary(grouping: eligible) { course in
            if let campus = course.sources.first(where: { $0.source.provider == .infiniteCampus }), let section = campus.source.fields["section_id"] {
                return "campus:\(campus.source.fields["school_id"] ?? "school"):\(section)"
            }
            return course.sources.compactMap(GradingPeriods.physicalKey).first ?? course.id
        }
        return groups.values.compactMap { group in
            group.sorted { a,b in
                let rankA = rank(a), rankB = rank(b)
                if rankA != rankB { return rankA > rankB }
                return a.order == b.order ? a.id < b.id : a.order < b.order
            }.first
        }.sorted { $0.order == $1.order ? $0.id < $1.id : $0.order < $1.order }
    }
    private static func rank(_ course: Course) -> Int {
        let source = course.display
        let task = Reconciler.normalize(source.source.fields["task_name"] ?? "")
        let words = Set(task.split(separator:" "))
        let exam = !words.isDisjoint(with: ["exam", "exams", "final", "midterm"])
        let graded = source.assignments.contains { $0.score.isGraded }
        let reported = source.grade.percent != nil || source.grade.letter?.isEmpty == false
        // Prefer an available regular grading task over an exam/final in the
        // selected term. If only an exam exists, still expose that physical class.
        return (exam ? 0 : 8) + (reported ? 4 : 0) + (graded ? 2 : 0)
    }
}
