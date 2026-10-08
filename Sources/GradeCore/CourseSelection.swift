import Foundation

/// Select one current card per physical Schoology section. Grading periods
/// stay separate in the cache/calculator; exam totals never become another class.
public enum CourseSelection {
    public static func visible(_ courses: [Course], term: String, at now: Date = Date()) -> [Course] {
        let anchors = courses.filter { $0.display.term.name == term }.sorted { rank($0) > rank($1) }
        let anchor = anchors.first { $0.display.term.start.map { $0 <= now } == true && $0.display.term.end.map { $0 >= now } == true }
            ?? anchors.filter { $0.display.term.start.map { $0 <= now } ?? true }.max { ($0.display.term.start ?? .distantPast) < ($1.display.term.start ?? .distantPast) }
            ?? anchors.first
        let selected = anchor.map(GradingPeriods.descriptor)
        let eligible = courses.filter { course in
            guard !course.hidden else { return false }
            if term.isEmpty { return true }
            let period = GradingPeriods.descriptor(course)
            if let selected, let a = selected.start, let b = selected.end, let c = period.start, let d = period.end, a > d || c > b { return false }
            if course.display.term.name == term { return true }
            // A Schoology class can use a dated title for the same
            // quarter. Different period labels must not hide that whole class.
            return period.kind != .other && selected.map { GradingPeriods.matches(period, $0, sameName: false) } == true
        }
        let groups = Dictionary(grouping: eligible) { course in
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
        let kind = GradingPeriods.descriptor(course).kind
        let exam = kind == .exam || kind == .year || kind == .semester
        let graded = source.assignments.contains { $0.score.isGraded }
        let reported = source.grade.percent != nil || source.grade.letter?.isEmpty == false
        // Prefer an available regular grading task over an exam/final in the
        // selected term. If only an exam exists, still expose that physical class.
        return (exam ? 0 : 8) + (reported ? 4 : 0) + (graded ? 2 : 0)
    }
}
