import Foundation

/// Select one current card per physical Schoology section. Grading periods
/// stay separate in the cache/calculator; exam totals never become another class.
public enum CourseSelection {
    public static func terms(_ courses: [Course]) -> [String] {
        Set(courses.map { $0.display.term.name }).sorted { a,b in
            let x = courses.first { $0.display.term.name == a }?.display.term.start ?? .distantPast
            let y = courses.first { $0.display.term.name == b }?.display.term.start ?? .distantPast
            return x == y ? a > b : x > y
        }
    }
    public static func preferredTerm(_ courses: [Course], at now: Date = Date(), calendar: Calendar = .current) -> String {
        let names = terms(courses)
        let ranks = Dictionary(uniqueKeysWithValues:names.map { name in
            (name,courses.filter { $0.display.term.name == name }.map { GradingPeriods.descriptor($0).kind == .quarter ? 4 : 0 }.max() ?? 0)
        })
        let ranked = names.sorted { ranks[$0] == ranks[$1] ? names.firstIndex(of:$0)! < names.firstIndex(of:$1)! : ranks[$0]! > ranks[$1]! }
        return ranked.first { name in courses.contains { $0.display.term.name == name && GradingPeriods.contains($0.display,at:now,calendar:calendar) } }
            ?? names.first { name in courses.contains { $0.display.term.name == name && GradingPeriods.hasStarted($0.display,at:now,calendar:calendar) && ($0.display.grade.percent != nil || $0.display.grade.letter?.isEmpty == false) } }
            ?? names.first ?? ""
    }
    public static func visible(_ courses: [Course], term: String, at now: Date = Date(), calendar: Calendar = .current) -> [Course] {
        let anchors = courses.filter { $0.display.term.name == term }.sorted { rank($0) > rank($1) }
        let anchor = anchors.first { GradingPeriods.contains($0.display,at:now,calendar:calendar) }
            ?? anchors.filter { GradingPeriods.hasStarted($0.display,at:now,calendar:calendar) }.max { ($0.display.term.start ?? .distantPast) < ($1.display.term.start ?? .distantPast) }
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
