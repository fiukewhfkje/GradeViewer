import Foundation
public enum Reconciler {
    public static func normalize(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).split(whereSeparator: { !$0.isLetter && !$0.isNumber }).joined(separator: " ")
    }
    private static func courseMatch(_ a: SourceCourse, _ b: SourceCourse, mappings: [String: String]) -> Bool {
        if a.source.provider == b.source.provider { return false }
        if mappings[a.id] != nil || mappings[b.id] != nil { return mappings[a.id] == b.id || mappings[b.id] == a.id }
        let teacherA = normalize(a.teacher), teacherB = normalize(b.teacher)
        if !teacherA.isEmpty && !teacherB.isEmpty && teacherA != teacherB { return false }
        if let startA = a.term.start, let endA = a.term.end, let startB = b.term.start, let endB = b.term.end,
           startA > endB || startB > endA { return false }
        if !normalize(a.title).isEmpty && normalize(a.title) == normalize(b.title)
            && !normalize(a.term.name).isEmpty && normalize(a.term.name) == normalize(b.term.name)
            && !teacherA.isEmpty && teacherA == teacherB { return true }
        // Names may reorder words and omit teacher/term metadata. Require two
        // distinct shared assignment identities, then a mutual unique course pair.
        let nameA = normalize(a.source.fields["course_name"] ?? a.title).split(separator: " ").sorted()
        let nameB = normalize(b.source.fields["course_name"] ?? b.title).split(separator: " ").sorted()
        guard !nameA.isEmpty, nameA == nameB else { return false }
        return sharedAssignmentCount(a, b) >= 2
    }
    struct AssignmentLabelKey: Hashable { let title: String; let possible: Double }
    static func assignmentLabelKey(_ row: SourceAssignment) -> AssignmentLabelKey? {
        let title = normalize(row.title)
        guard !title.isEmpty, let possible = row.score.possible, possible.isFinite else { return nil }
        return AssignmentLabelKey(title: title, possible: possible)
    }
    static func sharedAssignmentCount(_ a: SourceCourse, _ b: SourceCourse) -> Int {
        let own = Set(a.assignments.compactMap(assignmentLabelKey))
        return own.intersection(b.assignments.compactMap(assignmentLabelKey)).count
    }
    struct AssignmentKey: Hashable {
        var title: String; var day: Int; var possible: Double?
    }
    static func assignmentKey(_ a: SourceAssignment) -> AssignmentKey? {
        let title = normalize(a.title)
        guard !title.isEmpty, let date = a.due else { return nil }
        return AssignmentKey(title: title, day: Int(floor(date.timeIntervalSince1970 / 86400)), possible: a.score.possible)
    }
    public static func reconcile(_ input: [SourceCourse], previous: [Course] = [], mappings: [String: String] = [:], now: Date = Date()) -> [Course] {
        // Repeated provider IDs: latest fetched wins. Never pair multiple same-provider sections.
        let unique = Dictionary(input.map { ($0.id, $0) }, uniquingKeysWith: { $0.fetched > $1.fetched ? $0 : $1 }).values.sorted { $0.id < $1.id }
        var groups: [[SourceCourse]] = []
        var used = Set<String>()
        for item in unique where !used.contains(item.id) {
            let matches = unique.filter { !used.contains($0.id) && courseMatch(item, $0, mappings: mappings) }
            // Ambiguous same-title sections remain separate.
            let mutual = matches.count == 1 && unique.filter { courseMatch(matches[0], $0, mappings: mappings) }.count == 1
            let group = mutual ? [item, matches[0]] : [item]
            used.formUnion(group.map(\.id)); groups.append(group)
        }
        // A previous merged course can split after metadata changes. Only one group
        // inherits its identity/history; prefer the original identity, then its display source.
        var oldByGroup: [Int: Course] = [:]
        for old in previous {
            let oldKeys = Set(old.sources.map(\.id))
            let candidates = groups.indices.filter { !oldKeys.isDisjoint(with: groups[$0].map(\.id)) }
            let preferred = candidates.first { groups[$0].contains { $0.id == old.id } }
                ?? candidates.first { groups[$0].contains { $0.id == old.display.id } }
                ?? candidates.first
            if let preferred {
                // When separately cached provider courses first auto-merge, keep
                // the authoritative Campus identity/history and its local scenario.
                let existing = oldByGroup[preferred]
                if existing == nil || (old.display.source.provider == .infiniteCampus && existing?.display.source.provider != .infiniteCampus) {
                    oldByGroup[preferred] = old
                }
            }
        }
        return groups.enumerated().map { index, group in
            let old = oldByGroup[index]
            var course = Course(id: old?.id ?? group.map(\.id).sorted()[0], sources: group, history: old?.history ?? [], hidden: old?.hidden ?? false, order: old?.order ?? index)
            let flat = Dictionary(group.flatMap(\.assignments).map { ($0.id, $0) }, uniquingKeysWith: { a, b in (a.updated ?? .distantPast) > (b.updated ?? .distantPast) ? a : b }).values.sorted { $0.id < $1.id }
            let buckets = Dictionary(grouping: flat.compactMap { a in assignmentKey(a).map { ($0, a) } }, by: { $0.0 })
            var seen = Set<String>(), pairs: [[SourceAssignment]] = []
            for assignment in flat where !seen.contains(assignment.id) {
                let bucket = assignmentKey(assignment).flatMap { buckets[$0]?.map { $0.1 } } ?? []
                let uniquePair = bucket.count == 2 && Set(bucket.map { $0.source.provider }).count == 2
                let pair = uniquePair ? bucket : [assignment]
                seen.formUnion(pair.map(\.id)); pairs.append(pair)
            }
            let pairBySource = Dictionary(uniqueKeysWithValues: pairs.enumerated().flatMap { i, pair in pair.map { ($0.id, i) } })
            var oldIDs: [Int: String] = [:]
            for oldAssignment in old?.assignments ?? [] {
                let candidates = Set(oldAssignment.sources.compactMap { pairBySource[$0.id] }).sorted()
                let preferred = pairBySource[oldAssignment.id] ?? candidates.first
                if let preferred, oldIDs[preferred] == nil { oldIDs[preferred] = oldAssignment.id }
            }
            course.assignments = pairs.enumerated().map { i, pair in
                Assignment(id: oldIDs[i] ?? pair.map(\.id).sorted()[0], sources: pair)
            }
            course.assignments.sort { ($0.display.updated ?? $0.display.due ?? .distantPast) > ($1.display.updated ?? $1.display.due ?? .distantPast) }
            let grade = course.display.grade
            if grade.percent != nil || grade.letter != nil {
                let last = course.history.last
                let material = last == nil || last?.provider != course.display.source.provider || last?.grade.letter != grade.letter || changed(last?.grade.percent, grade.percent)
                if material { course.history.append(GradeHistorySnapshot(date: now, grade: grade, provider: course.display.source.provider)) }
            }
            return course
        }.sorted { $0.order == $1.order ? $0.id < $1.id : $0.order < $1.order }
    }
    private static func changed(_ a: Double?, _ b: Double?) -> Bool { switch (a,b) { case let (x?,y?): return abs(x-y) >= 0.01; case (nil,nil): return false; default: return true } }
    /// Replace only successful provider snapshots; retain failed providers in full.
    public static func refreshing(previous: [Course], successful: [ProviderID: [SourceCourse]], mappings: [String: String] = [:], now: Date = Date()) -> [Course] {
        let retained = previous.flatMap(\.sources).filter { successful[$0.source.provider] == nil }
        return reconcile(retained + successful.values.flatMap { $0 }, previous: previous, mappings: mappings, now: now)
    }
}
