import Foundation

public enum PeriodKind: String, Sendable { case quarter, semester, exam, year, other }
public struct PeriodDescriptor: Sendable {
    public let kind: PeriodKind
    public let ordinal: Int?
    public let label: String
    public let start: Date?
    public let end: Date?
}
public enum GradingPeriods {
    private static let datePattern = try! NSRegularExpression(pattern: "[0-9]{4}-[0-9]{2}-[0-9]{2}")
    private static let quarterPattern = try! NSRegularExpression(pattern: "^(?:q|quarter)\\s*([1-9][0-9]*)\\b")
    private static let semesterPattern = try! NSRegularExpression(pattern: "^(?:s|semester)\\s*([1-9][0-9]*)\\b")
    static func titleDates(_ title: String) -> (Date?, Date?) {
        let dates = datePattern.matches(in:title, range:NSRange(title.startIndex..., in:title)).compactMap { match in
            Range(match.range, in:title).flatMap { ProviderParsing.date(String(title[$0])) }
        }
        guard dates.count == 2, dates[0] <= dates[1] else { return (nil,nil) }
        return (dates[0],dates[1])
    }
    public static func descriptor(_ source: SourceCourse) -> PeriodDescriptor {
        let name = Reconciler.normalize(source.term.name)
        func index(_ regex: NSRegularExpression) -> Int? {
            guard let match = regex.firstMatch(in:name, range:NSRange(name.startIndex..., in:name)), let range = Range(match.range(at:1), in:name) else { return nil }
            return Int(name[range])
        }
        let quarter = index(quarterPattern)
        let semester = index(semesterPattern)
        let kind: PeriodKind
        let ordinal: Int?
        if name.hasPrefix("exam") || name.hasPrefix("midterm") { kind = .exam; ordinal = nil }
        else if let semester { kind = .semester; ordinal = semester }
        else if let quarter { kind = .quarter; ordinal = quarter }
        else if name == "final" || name.contains("year") { kind = .year; ordinal = nil }
        else { kind = .other; ordinal = nil }
        let label: String
        switch kind {
        case .quarter: label = "Q\(ordinal!)"
        case .semester: label = ordinal.map { "S\($0)" } ?? "Semester"
        case .exam: label = "Exam"
        case .year: label = "Overall"
        case .other: label = source.term.name
        }
        let dates = source.term.start != nil && source.term.end != nil ? (nil, nil) : titleDates(source.term.name)
        return PeriodDescriptor(kind:kind, ordinal:ordinal, label:label, start:source.term.start ?? dates.0, end:source.term.end ?? dates.1)
    }
    public static func descriptor(_ course: Course) -> PeriodDescriptor { descriptor(course.display) }
    static func day(_ date: Date) -> Int { Int(floor(date.timeIntervalSince1970 / 86400)) }
    static func matches(_ x: PeriodDescriptor, _ y: PeriodDescriptor, sameName: Bool) -> Bool {
        guard x.kind == y.kind else { return false }
        if let i = x.ordinal, let j = y.ordinal, i != j { return false }
        if let xs = x.start, let xe = x.end, let ys = y.start, let ye = y.end {
            return day(xs) == day(ys) && day(xe) == day(ye)
        }
        return (x.ordinal != nil && x.ordinal == y.ordinal) || sameName
    }
    static func physicalKey(_ source: SourceCourse) -> String? {
        (source.source.fields["grade_section_id"] ?? source.source.fields["section_id"]).map { "schoology:\($0)" }
    }
    public static func related(to course: Course, among available: [Course]) -> [Course] {
        let keys = Set(course.sources.compactMap(physicalKey))
        guard !keys.isEmpty else { return [course] }
        return available.filter { candidate in !keys.isDisjoint(with:candidate.sources.compactMap(physicalKey)) }
    }
    public static func semester(for course: Course, among available: [Course]) -> Course? {
        let selected = descriptor(course)
        if selected.kind == .semester { return course }
        guard let start = selected.start, let end = selected.end else { return nil }
        let matches = related(to:course, among:available).filter { candidate in
            let period = descriptor(candidate)
            guard period.kind == .semester, let s = period.start, let e = period.end else { return false }
            return day(s) <= day(start) && day(e) >= day(end)
        }
        return matches.count == 1 ? matches[0] : nil
    }
    public static func ordered(_ courses: [Course]) -> [Course] {
        courses.sorted { a,b in
            let x = descriptor(a), y = descriptor(b)
            if x.start != y.start { return (x.start ?? .distantPast) < (y.start ?? .distantPast) }
            if x.kind != y.kind { return x.kind.rawValue < y.kind.rawValue }
            if x.ordinal != y.ordinal { return (x.ordinal ?? 0) < (y.ordinal ?? 0) }
            return a.id < b.id
        }
    }
    /// Keep the requested quarter UI when quarters exist. Districts that expose
    /// only semesters or named periods still get their actual assignment periods.
    public static func assignmentPeriods(for course: Course, among available: [Course]) -> [Course] {
        let related = ordered(related(to: course, among: available))
        for kind: PeriodKind in [.quarter, .semester, .other, .year] {
            let periods = related.filter { descriptor($0).kind == kind }
            // Legacy unnamed/undated records retain their existing full-course
            // view. Do not create new period boundaries from missing metadata.
            if kind == .other && periods.contains(where: { descriptor($0).start == nil || descriptor($0).end == nil }) { continue }
            if !periods.isEmpty { return periods }
        }
        return []
    }
    /// Exam records stay separate from the quarter's calculator. Associate them
    /// for presentation only through a unique explicitly dated containing quarter.
    public static func exams(for quarter: Course, among available: [Course]) -> [Course] {
        guard descriptor(quarter).kind == .quarter else { return [] }
        let related = related(to:quarter, among:available)
        let quarters = related.filter { descriptor($0).kind == .quarter }
        return ordered(related.filter { exam in
            let period = descriptor(exam)
            guard period.kind == .exam else { return false }
            if let start = period.start, let end = period.end {
                let dated = quarters.filter { descriptor($0).start != nil && descriptor($0).end != nil }
                let containers = dated.filter { candidate in
                    let q = descriptor(candidate)
                    guard let s = q.start, let e = q.end else { return false }
                    return day(s) <= day(start) && day(e) >= day(end)
                }
                if !dated.isEmpty { return containers.count == 1 && containers[0].id == quarter.id }
            }
            return false
        })
    }
    /// A semester presentation contains its explicitly associated components.
    /// Sources remain untouched: an aggregate list is never a calculator input.
    public static func presentation(for course: Course, among available: [Course]) -> Course {
        guard descriptor(course).kind == .semester else { return course }
        let children = related(to:course, among:available).filter { child in
            let kind = descriptor(child).kind
            return (kind == .quarter || kind == .exam) && semester(for:child, among:available)?.id == course.id
        }
        var result = course
        let rows = ([course] + ordered(children)).flatMap { child in
            AssignmentGrouping.overview(for: child)
        }
        // Provider assignment IDs survive period changes; repeated IDs may appear
        // in both the semester rollup and a child quarter. Keep one presentation.
        var seen = Set<String>()
        result.assignments = AssignmentOrdering.graded(rows.filter { row in
            let identities = row.sources.map { item in
                item.source.provider.rawValue + ":" + (item.source.fields["assignment_id"].map { $0 + ":" + (item.source.fields["type"] ?? "assignment") } ?? item.id)
            }
            guard identities.allSatisfy({ !seen.contains($0) }) else { return false }
            seen.formUnion(identities); return true
        })
        return result
    }
    /// Explicit provider weights, normalized across currently available component
    /// grades, only when they reproduce the reported semester total.
    public static func semesterScale(for quarter: Course, semester: Course, among available: [Course]) -> Double? {
        let children = related(to:semester, among:available).filter { child in
            let kind = descriptor(child).kind
            return (kind == .quarter || kind == .exam) && self.semester(for:child, among:available)?.id == semester.id && child.display.grade.percent != nil
        }
        let weighted = children.compactMap { child -> (Course,Double)? in
            let weight = child.display.term.weight
            return weight.map { (child,$0) }
        }
        guard weighted.count == children.count, let reported = semester.display.grade.percent,
              let own = weighted.first(where: { $0.0.id == quarter.id })?.1,
              weighted.allSatisfy({ $0.1.isFinite && $0.1 >= 0 }) else { return nil }
        let total = weighted.reduce(0) { $0 + $1.1 }
        guard total > 0 else { return nil }
        let baseline = weighted.reduce(0) { $0 + $1.0.display.grade.percent! * $1.1 } / total
        guard abs(baseline - reported) <= 0.15 else { return nil }
        return own / total
    }
}
