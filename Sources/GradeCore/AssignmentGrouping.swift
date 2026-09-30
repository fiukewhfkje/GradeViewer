import Foundation

public struct AssignmentGroupData: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let assignments: [Assignment]
}

/// Presentation grouping never changes course identity or the calculator's source.
public enum AssignmentGrouping {
    public static func overview(for course: Course, schoology: SourceCourse?) -> [Assignment] {
        let rows = groups(for: course, schoology: schoology).flatMap(\.assignments)
        return AssignmentOrdering.graded(Dictionary(rows.map { ($0.id,$0) }, uniquingKeysWith: { a,_ in a }).values)
    }
    private struct LabelKey: Hashable { let title: String; let possible: Double }
    private static func labelKey(_ row: SourceAssignment) -> LabelKey? {
        let title = Reconciler.normalize(row.title)
        guard !title.isEmpty, let points = row.score.possible else { return nil }
        return LabelKey(title: title, possible: points)
    }
    public static func schoologySource(for course: Course, among available: [SourceCourse]) -> SourceCourse? {
        if let linked = course.sources.first(where: { $0.source.provider == .schoology && !$0.categories.isEmpty }) { return linked }
        let name = Reconciler.normalize(course.name)
        guard !name.isEmpty else { return nil }
        let own = Set(course.calculationSource.assignments.compactMap(labelKey))
        let unique = Dictionary(available.filter { $0.source.provider == .schoology }.map { ($0.id, $0) }, uniquingKeysWith: { a,b in a.fetched > b.fetched ? a : b }).values
        let candidates = unique.filter { source in
            guard !source.categories.isEmpty, Reconciler.normalize(source.source.fields["course_name"] ?? source.title) == name else { return false }
            let shared = own.intersection((source.assignments + (source.assignmentCatalog ?? [])).compactMap(labelKey))
            // Matching names alone must never borrow another period/section's categories.
            return shared.count >= 2
        }
        let owners = Dictionary(grouping: candidates, by: { $0.source.fields["grade_section_id"] ?? $0.id })
        guard owners.count == 1 else { return nil }
        return owners.values.first?.max { a,b in
            own.intersection(a.assignments.compactMap(labelKey)).count < own.intersection(b.assignments.compactMap(labelKey)).count
        }
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
            if let id = $0.source.fields["id"], actualIDs.contains(id + ":" + ($0.source.fields["type"] ?? "assignment")) { return false }
            return Reconciler.assignmentKey($0).map { !actualKeys.contains($0) } ?? true
        }
        let canonicalByKey = Dictionary(grouping: graded.compactMap { row in Reconciler.assignmentKey(row.display).map { ($0,row) } }, by: { $0.0 })
        let schoologyByKey = Dictionary(grouping: sourceRows.compactMap { row in Reconciler.assignmentKey(row).map { ($0,row) } }, by: { $0.0 })
        let canonicalByLabel = Dictionary(grouping: graded.compactMap { row in labelKey(row.display).map { ($0,row) } }, by: { $0.0 })
        let schoologyByLabel = Dictionary(grouping: sourceRows.compactMap { row in labelKey(row).map { ($0,row) } }, by: { $0.0 })
        var rows: [Assignment] = [], used = Set<String>()
        for item in sourceRows {
            let direct = graded.first { $0.sources.contains { $0.id == item.id } }
            let key = Reconciler.assignmentKey(item)
            let candidate = key.flatMap { canonicalByKey[$0] }
            let unambiguous = candidate?.count == 1 && key.flatMap { schoologyByKey[$0]?.count } == 1
            let label = labelKey(item)
            let labeled = label.flatMap { canonicalByLabel[$0] }
            let uniqueLabel = labeled?.count == 1 && label.flatMap { schoologyByLabel[$0]?.count } == 1
            // Date differences do not prevent borrowing a category within an evidenced class.
            // This fallback is presentation-only; canonical reconciliation remains strict.
            let canonical = direct ?? (unambiguous ? candidate?.first?.1 : nil) ?? (uniqueLabel ? labeled?.first?.1 : nil)
            if let canonical {
                guard !used.contains(canonical.id) else { continue }
                var row = canonical
                if !row.sources.contains(where: { $0.id == item.id }) { row.sources.append(item) }
                rows.append(row); used.insert(row.id)
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
