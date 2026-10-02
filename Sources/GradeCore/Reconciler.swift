import Foundation
public enum Reconciler {
    public static func normalize(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).split(whereSeparator: { !$0.isLetter && !$0.isNumber }).joined(separator: " ")
    }
    /// All match evidence is normalized once per snapshot, outside pairwise
    /// matching. This is a local index; it never survives a provider refresh.
    private struct MatchEvidence {
        let source: SourceCourse
        let teacher: String
        let title: String
        let term: String
        let names: [Substring]
        let period: PeriodDescriptor
        let campusFinal: Bool
        let assignments: Set<AssignmentLabelKey>
        init(_ source: SourceCourse) {
            self.source = source
            teacher = normalize(source.teacher); title = normalize(source.title)
            term = normalize(source.term.name)
            names = normalize(source.source.fields["course_name"] ?? source.title).split(separator: " ").sorted()
            period = GradingPeriods.descriptor(source)
            campusFinal = normalize(source.source.fields["task_name"] ?? "") == "final"
            let labels = Dictionary(grouping: source.assignments.compactMap(assignmentLabelKey), by: { $0 })
            assignments = Set(labels.filter { $0.value.count == 1 }.keys)
        }
    }
    private static func courseMatch(_ a: MatchEvidence, _ b: MatchEvidence, mappings: [String: String], physicalLinks: [String: String]) -> Bool {
        let first = a.source, second = b.source
        if first.source.provider == second.source.provider { return false }
        guard compatibleMetadata(a.teacher, b.teacher, first.term, second.term) else { return false }
        let x = a.period, y = b.period
        let periodMatch = GradingPeriods.matches(x, y, campusFinal: first.source.provider == .infiniteCampus ? a.campusFinal : b.campusFinal, sameName: a.term == b.term)
        guard x.kind == .other || y.kind == .other || periodMatch else { return false }
        if mappings[first.id] != nil || mappings[second.id] != nil {
            return (mappings[first.id] == nil || mappings[first.id] == second.id) &&
                (mappings[second.id] == nil || mappings[second.id] == first.id)
        }
        if let keyA = GradingPeriods.physicalKey(first), let keyB = GradingPeriods.physicalKey(second),
           physicalLinks[keyA] == keyB || physicalLinks[keyB] == keyA,
           x.kind != .other && y.kind != .other { return periodMatch }
        if !a.title.isEmpty && a.title == b.title && !a.term.isEmpty && a.term == b.term && !a.teacher.isEmpty && a.teacher == b.teacher { return true }
        guard !a.names.isEmpty, a.names == b.names else { return false }
        if x.kind == y.kind, let xs = x.start, let xe = x.end, let ys = y.start, let ye = y.end,
           GradingPeriods.day(xs) == GradingPeriods.day(ys), GradingPeriods.day(xe) == GradingPeriods.day(ye), periodMatch { return true }
        return a.assignments.intersection(b.assignments).count >= 2
    }
    static func compatibleMetadata(_ a: SourceCourse, _ b: SourceCourse) -> Bool {
        compatibleMetadata(normalize(a.teacher), normalize(b.teacher), a.term, b.term)
    }
    private static func compatibleMetadata(_ teacherA: String, _ teacherB: String, _ a: Term, _ b: Term) -> Bool {
        if !teacherA.isEmpty && !teacherB.isEmpty && teacherA != teacherB { return false }
        if let startA = a.start, let endA = a.end, let startB = b.start, let endB = b.end,
           startA > endB || startB > endA { return false }
        return true
    }
    struct AssignmentLabelKey: Hashable { let title: String; let possible: Double }
    static func assignmentLabelKey(_ row: SourceAssignment) -> AssignmentLabelKey? {
        let title = normalize(row.title)
        guard row.hasTitle, !title.isEmpty, let possible = row.score.possible, possible.isFinite, possible >= 0 else { return nil }
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
        guard a.hasTitle, !title.isEmpty, let date = a.due, date.timeIntervalSince1970.isFinite,
              let possible = a.score.possible, possible.isFinite, possible >= 0 else { return nil }
        return AssignmentKey(title: title, day: Int(floor(date.timeIntervalSince1970 / 86400)), possible: a.score.possible)
    }
    public static func reconcile(_ input: [SourceCourse], previous: [Course] = [], mappings: [String: String] = [:], now: Date = Date()) -> [Course] {
        // Repeated provider IDs: latest fetched wins. Never pair multiple same-provider sections.
        let unique = Dictionary(input.map { ($0.id, $0) }, uniquingKeysWith: { $0.fetched > $1.fetched ? $0 : $1 }).values.sorted { $0.id < $1.id }
        let evidence = Dictionary(uniqueKeysWithValues: unique.map { ($0.id, MatchEvidence($0)) })
        func matches(_ a: SourceCourse, _ b: SourceCourse, links: [String: String] = [:]) -> Bool {
            courseMatch(evidence[a.id]!, evidence[b.id]!, mappings: mappings, physicalLinks: links)
        }
        // All evidenced periods must agree on one physical section pair. Include
        // ambiguous periods: one unique quarter cannot resolve a conflicting class.
        var candidates: [String: Set<String>] = [:]
        for source in unique {
            let peers = unique.filter { matches(source,$0) }
            for peer in peers {
                if let a = GradingPeriods.physicalKey(source), let b = GradingPeriods.physicalKey(peer) { candidates[a,default:[]].insert(b) }
            }
        }
        var physicalLinks: [String: String] = [:]
        for (key, matches) in candidates where matches.count == 1 {
            if let match = matches.first, candidates[match] == Set([key]) { physicalLinks[key] = match }
        }
        func consistentMatch(_ a: SourceCourse, _ b: SourceCourse) -> Bool {
            if let keyA = GradingPeriods.physicalKey(a), let keyB = GradingPeriods.physicalKey(b) {
                guard physicalLinks[keyA] == keyB && physicalLinks[keyB] == keyA else { return false }
            }
            return matches(a, b, links: physicalLinks)
        }
        var groups: [[SourceCourse]] = []
        var used = Set<String>()
        for item in unique where !used.contains(item.id) {
            let peers = unique.filter { !used.contains($0.id) && consistentMatch(item, $0) }
            // Ambiguous same-title sections remain separate.
            let mutual = peers.count == 1 && unique.filter { consistentMatch(peers[0], $0) }.count == 1
            let group = mutual ? [item, peers[0]] : [item]
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
        let oldRows = Dictionary(previous.flatMap(\.sources).flatMap(\.assignments).map { ($0.id, $0) }, uniquingKeysWith: { a,_ in a })
        let refreshed = successful.values.flatMap { $0 }.map { supplied in
            var source = supplied
            for index in source.assignments.indices where !source.assignments[index].hasTitle {
                if let old = oldRows[source.assignments[index].id], old.hasTitle { source.assignments[index].title = old.title }
            }
            return source
        }
        return reconcile(retained + refreshed, previous: previous, mappings: mappings, now: now)
    }
}
