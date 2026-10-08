import Foundation

public struct AssignmentGroupData: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let assignments: [Assignment]
}

/// Presentation grouping never changes course identity or the calculator's source.
public enum AssignmentGrouping {
    /// A missing title is never course-match evidence. Inside an already
    /// evidenced course, a unique score/points/update-day pair can recover a
    /// presentation link without changing either provider's source records.
    private struct ScoredUpdateKey: Hashable {
        let earned: Double
        let possible: Double
        let day: Int
        let multiplier: Double
        let excluded: Bool
    }
    private static func scoredUpdateKey(_ item: SourceAssignment) -> ScoredUpdateKey? {
        guard !item.score.excused, let earned = item.score.earned, earned.isFinite,
              let possible = item.score.possible, possible.isFinite, possible > 0,
              let updated = item.updated, updated.timeIntervalSince1970.isFinite,
              let day = Int(exactly: floor(updated.timeIntervalSince1970 / 86400)),
              item.multiplier.isFinite, item.multiplier > 0 else { return nil }
        return ScoredUpdateKey(earned: earned, possible: possible, day: day, multiplier: item.multiplier, excluded: item.excluded)
    }
    public static func updated(for course: Course, schoology: SourceCourse?) -> Date? {
        overview(for: course, schoology: schoology).flatMap(\.sources)
            .filter { $0.score.isGraded }.compactMap(\.updated).max()
            ?? (course.history.count > 1 ? course.history.last?.date : nil)
    }
    public static func overview(for course: Course, schoology: SourceCourse?) -> [Assignment] {
        let rows = groups(for: course, schoology: schoology).flatMap(\.assignments)
        return AssignmentOrdering.graded(Dictionary(rows.map { ($0.id,$0) }, uniquingKeysWith: { a,_ in a }).values)
    }
    public static func schoologySource(for course: Course, among available: [SourceCourse]) -> SourceCourse? {
        if let linked = course.sources.first(where: { $0.source.provider == .schoology }) { return linked.categories.isEmpty ? nil : linked }
        let name = Reconciler.normalize(course.name)
        guard !name.isEmpty else { return nil }
        let own = Set(course.calculationSource.assignments.compactMap(Reconciler.assignmentLabelKey))
        let unique = Dictionary(available.filter { $0.source.provider == .schoology }.map { ($0.id, $0) }, uniquingKeysWith: { a,b in a.fetched > b.fetched ? a : b }).values
        let candidates = unique.filter { source in
            guard !source.categories.isEmpty, Reconciler.compatibleMetadata(course.calculationSource, source), GradingPeriods.compatible(course.calculationSource, source), Reconciler.normalize(source.source.fields["course_name"] ?? source.title) == name else { return false }
            let shared = own.intersection((source.assignments + (source.assignmentCatalog ?? [])).compactMap(Reconciler.assignmentLabelKey))
            // Matching names alone must never borrow another period/section's categories.
            return shared.count >= 2
        }
        let owners = Dictionary(grouping: candidates, by: { $0.source.fields["grade_section_id"] ?? $0.id })
        guard owners.count == 1 else { return nil }
        let periods = owners.values.first ?? []
        let counts = periods.map { own.intersection($0.assignments.compactMap(Reconciler.assignmentLabelKey)).count }
        guard let maximum = counts.max(), counts.filter({ $0 == maximum }).count == 1 else { return nil }
        return periods[counts.firstIndex(of: maximum)!]
    }

    public static func fullCourse(for course: Course, among available: [Course]) -> Course {
        let current = course.display
        let related = available.filter { candidate in candidate.id != course.id && candidate.sources.contains { source in
            guard source.source.provider == current.source.provider else { return false }
            if current.source.provider == .infiniteCampus {
                guard let section = current.source.fields["section_id"], let task = current.source.fields["task_id"] else { return false }
                return source.source.fields["section_id"] == section && source.source.fields["task_id"] == task
            }
            guard let owner = current.source.fields["grade_section_id"] else { return false }
            return source.source.fields["grade_section_id"] == owner
        } }
        var result = course, seen = Set<String>(), rows: [Assignment] = []
        for variant in [course] + related.sorted(by: { $0.display.fetched > $1.display.fetched }) {
            for row in variant.assignments where row.display.score.isGraded {
                let item = row.sources.first { $0.source.provider == current.source.provider } ?? row.display
                let rawID = item.source.fields["objectSectionID"] ?? item.source.fields["assignment_id"].map { ($0 + ":" + (item.source.fields["type"] ?? "assignment")) } ?? item.id
                let identity = item.source.provider.rawValue + ":" + rawID
                if seen.insert(identity).inserted { rows.append(row) }
            }
        }
        result.assignments = AssignmentOrdering.graded(rows)
        return result
    }

    public static func groups(for course: Course, schoology: SourceCourse?) -> [AssignmentGroupData] {
        let graded = course.assignments.filter { $0.display.score.isGraded }
        guard let schoology else {
            let source = course.calculationSource
            if source.method == .points || source.categories.isEmpty {
                return [AssignmentGroupData(id: "total", title: "Total Points", assignments: graded)]
            }
            var used = Set<String>(), result: [AssignmentGroupData] = []
            for category in source.categories {
                let rows = graded.filter { a in a.sources.contains { $0.source.provider == source.source.provider && $0.categoryID == category.id } }
                if !rows.isEmpty { result.append(AssignmentGroupData(id: category.id, title: category.name, assignments: rows)); used.formUnion(rows.map(\.id)) }
            }
            let other = graded.filter { !used.contains($0.id) }
            if !other.isEmpty { result.append(AssignmentGroupData(id: "other", title: "Other Assignments", assignments: other)) }
            return result
        }
        let actualKeys = Set(schoology.assignments.compactMap(Reconciler.assignmentKey))
        let actualIDs = Set(schoology.assignments.compactMap { item in item.source.fields["assignment_id"].map { ($0 + ":" + (item.source.fields["type"] ?? "assignment")) } })
        let sourceRows = schoology.assignments + (schoology.assignmentCatalog ?? []).filter {
            if let id = $0.source.fields["grade_item_id"] ?? $0.source.fields["id"], actualIDs.contains(id + ":" + ($0.source.fields["type"] ?? "assignment")) { return false }
            return Reconciler.assignmentKey($0).map { !actualKeys.contains($0) } ?? true
        }
        let basisProvider = course.calculationSource.source.provider
        let basisRows = graded.filter { $0.sources.contains { $0.source.provider == basisProvider } }
        let canonicalByKey = Dictionary(grouping: basisRows.compactMap { row in Reconciler.assignmentKey(row.display).map { ($0,row) } }, by: { $0.0 })
        let schoologyByKey = Dictionary(grouping: sourceRows.compactMap { row in Reconciler.assignmentKey(row).map { ($0,row) } }, by: { $0.0 })
        let canonicalByLabel = Dictionary(grouping: basisRows.compactMap { row in Reconciler.assignmentLabelKey(row.display).map { ($0,row) } }, by: { $0.0 })
        let schoologyByLabel = Dictionary(grouping: sourceRows.compactMap { row in Reconciler.assignmentLabelKey(row).map { ($0,row) } }, by: { $0.0 })
        let canonicalByUpdate = Dictionary(grouping: basisRows.compactMap { row in
            row.sources.first { $0.source.provider == basisProvider }.flatMap { scoredUpdateKey($0).map { ($0, row) } }
        }, by: { $0.0 })
        let schoologyByUpdate = Dictionary(grouping: schoology.assignments.compactMap { item in scoredUpdateKey(item).map { ($0, item) } }, by: { $0.0 })
        let compatiblePeriod = Reconciler.compatibleMetadata(course.calculationSource, schoology) && GradingPeriods.compatible(course.calculationSource, schoology)
        func recoveredTitleMatch(_ item: SourceAssignment) -> Assignment? {
            guard compatiblePeriod, let key = scoredUpdateKey(item),
                  let candidates = canonicalByUpdate[key], candidates.count == 1,
                  schoologyByUpdate[key]?.count == 1 else { return nil }
            let row = candidates[0].1
            guard let original = row.sources.first(where: { $0.source.provider == basisProvider }),
                  !item.hasTitle || !original.hasTitle else { return nil }
            if let a = original.due, let b = item.due {
                guard let firstDay = Int(exactly: floor(a.timeIntervalSince1970 / 86400)),
                      let secondDay = Int(exactly: floor(b.timeIntervalSince1970 / 86400)), firstDay == secondDay else { return nil }
            }
            // Never attach a second Schoology grade to a row that already has
            // an identified counterpart, including presentation-only labels.
            guard !row.sources.contains(where: { $0.source.provider == .schoology && $0.id != item.id }),
                  Reconciler.assignmentLabelKey(original).flatMap({ schoologyByLabel[$0] })?.contains(where: { $0.1.score.isGraded && $0.1.id != item.id }) != true else { return nil }
            return row
        }
        var rows: [Assignment] = [], used = Set<String>()
        for item in sourceRows {
            let direct = graded.first { $0.sources.contains { $0.id == item.id } }
            let key = Reconciler.assignmentKey(item)
            let candidate = key.flatMap { canonicalByKey[$0] }
            let unambiguous = candidate?.count == 1 && key.flatMap { schoologyByKey[$0]?.count } == 1
            let label = Reconciler.assignmentLabelKey(item)
            let labeled = label.flatMap { canonicalByLabel[$0] }
            let uniqueLabel = labeled?.count == 1 && label.flatMap { schoologyByLabel[$0]?.count } == 1
            // Date differences do not prevent borrowing a category within an evidenced class.
            // This fallback is presentation-only; canonical reconciliation remains strict.
            let directBasis = direct.flatMap { row in row.sources.contains { $0.source.provider == basisProvider } ? row : nil }
            let canonical = directBasis ?? (unambiguous ? candidate?.first?.1 : nil) ?? (uniqueLabel ? labeled?.first?.1 : nil) ?? recoveredTitleMatch(item) ?? direct
            if let canonical {
                guard !used.contains(canonical.id) else { continue }
                var row = canonical
                if !row.sources.contains(where: { $0.id == item.id }) { row.sources.append(item) }
                rows.append(row); used.insert(row.id)
                if let direct { used.insert(direct.id) }
            } else if item.score.isGraded { rows.append(Assignment(id: item.id, sources: [item])) }
        }
        rows = AssignmentOrdering.graded(rows)
        var result: [AssignmentGroupData] = []
        var categorized = Set<String>()
        for category in schoology.categories {
            let assignments = rows.filter { $0.sources.contains { $0.source.provider == .schoology && $0.categoryID == category.id } }
            if !assignments.isEmpty { result.append(AssignmentGroupData(id: category.id, title: category.name, assignments: assignments)); categorized.formUnion(assignments.map(\.id)) }
        }
        let other = rows.filter { !categorized.contains($0.id) } + graded.filter { !used.contains($0.id) }
        if !other.isEmpty { result.append(AssignmentGroupData(id: "other", title: "Other Assignments", assignments: other)) }
        return result
    }
}
