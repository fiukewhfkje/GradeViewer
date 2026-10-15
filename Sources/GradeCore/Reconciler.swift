import Foundation

/// Stable identities and history for one complete Schoology snapshot.
/// Assignment titles are metadata, never deduplication identities.
public enum Reconciler {
    public static func normalize(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).split(whereSeparator: { !$0.isLetter && !$0.isNumber }).joined(separator: " ")
    }
    public static func reconcile(_ input: [SourceCourse], previous: [Course] = [], now: Date = Date()) -> [Course] {
        let unique = Dictionary(input.map { ($0.id, $0) }, uniquingKeysWith: { $0.fetched > $1.fetched ? $0 : $1 }).values.sorted { $0.id < $1.id }
        let resolved = SchoologyGrades.resolved(Array(unique))
        let oldBySource = Dictionary(previous.flatMap { course in course.sources.map { ($0.id, course) } }, uniquingKeysWith: { a, _ in a })
        return resolved.enumerated().map { index, source in
            let old = oldBySource[source.id]
            let rows = Dictionary(source.assignments.map { ($0.id, $0) }, uniquingKeysWith: { a,b in (a.updated ?? .distantPast) > (b.updated ?? .distantPast) ? a : b }).values
            var course = Course(id: old?.id ?? source.id, sources: [source], assignments: rows.map { Assignment(id: $0.id, sources: [$0]) }, history: old?.history ?? [], hidden: old?.hidden ?? false, order: old?.order ?? index, removedAssignmentIDs:old?.removedAssignmentIDs)
            course.assignments = AssignmentOrdering.graded(course.assignments) + course.assignments.filter { !$0.display.score.isGraded }.sorted { $0.id < $1.id }
            let grade = source.grade
            // Calculated totals/prefixes are not observations of a provider total.
            if !source.hasCalculatedGrade && (grade.percent != nil || grade.letter != nil) {
                let last = course.history.last
                if last == nil || last?.provider != source.source.provider.rawValue || last?.grade.letter != grade.letter || changed(last?.grade.percent, grade.percent) {
                    course.history.append(GradeHistorySnapshot(date: now, grade: grade, provider: source.source.provider))
                }
            }
            return course
        }.sorted { $0.order == $1.order ? $0.id < $1.id : $0.order < $1.order }
    }
    private static func changed(_ a: Double?, _ b: Double?) -> Bool {
        switch (a,b) { case let (x?,y?): return GradePrecision.isReportingDifference(x,y); case (nil,nil): return false; default: return true }
    }
    /// Called only after a complete schema-valid read. Failures never replace data.
    public static func refreshing(previous: [Course], successful: [ProviderID: [SourceCourse]], now: Date = Date()) -> [Course] {
        guard let fetched = successful[.schoology] else { return previous }
        let oldRows = Dictionary(previous.flatMap(\.sources).flatMap(\.assignments).map { ($0.id, $0) }, uniquingKeysWith: { a,_ in a })
        let refreshed = fetched.map { supplied in
            var source = supplied
            for index in source.assignments.indices where !source.assignments[index].hasTitle {
                if let old = oldRows[source.assignments[index].id], old.hasTitle { source.assignments[index].title = old.title }
            }
            return source
        }
        return reconcile(refreshed, previous: previous, now: now)
    }
}
