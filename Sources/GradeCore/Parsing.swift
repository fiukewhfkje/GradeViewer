import Foundation

private extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }

/// Reuse configured Foundation parsers. The lock also protects the non-Sendable
/// ISO formatter when parallel provider reads normalize dates.
private final class ProviderDateParser: @unchecked Sendable {
    static let shared = ProviderDateParser()
    private let lock = NSLock()
    private let iso = ISO8601DateFormatter()
    private let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter
    }()
    private let formats: [DateFormatter] = ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"].map { format in
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = format
        return formatter
    }
    func parse(_ value: String) -> Date? {
        lock.withLock {
            if let date = iso.date(from: value) ?? fractional.date(from: value) { return date }
            for formatter in formats { if let date = formatter.date(from: value) { return date } }
            return nil
        }
    }
}

public enum ProviderError: Error, Equatable, Sendable { case reconnect, accountChanged, forbidden, throttled(TimeInterval), malformed, unavailable, unsafeURL, tooManyPages }
public enum ProviderParsing {
    static func object(_ data: Data) throws -> [String: Any] { guard let x = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ProviderError.malformed }; return x }
    static func rows(_ value: Any?) -> [[String: Any]] { if let x = value as? [[String: Any]] { return x }; if let x = value as? [String: Any] { return [x] }; return [] }
    static func collection(_ value: Any?) throws -> [[String: Any]] {
        if let x = value as? [[String: Any]] { return x }
        if let x = value as? [String: Any] { return [x] }
        throw ProviderError.malformed
    }
    static func nonempty(_ value: Any?) -> String? { text(value)?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty }
    // grade_item_id identifies the graded node; a gradebook wrapper can have another id.
    static func itemID(_ row: [String: Any]) -> String? {
        // Grade columns return 0 when there is no separate graded node.
        let node = nonempty(row["grade_item_id"]).flatMap { value in
            number(value).map { $0 <= 0 } == true ? nil : value
        }
        return node ?? nonempty(row["id"])
    }
    static func itemKey(_ row: [String: Any]) -> String? { itemID(row).map { "\(nonempty(row["type"]) ?? "assignment"):\($0)" } }
    /// Title metadata cannot change a grade's identity, score, or exclusion rules.
    static func assignmentMetadata(_ item: [String: Any], for row: SourceAssignment, period: String?) -> SourceAssignment? {
        guard let id = row.source.fields["assignment_id"], let title = nonempty(item["title"]),
              compatibleAssignmentMetadata(item, id: id, kind: row.source.fields["type"] ?? "assignment", possible: row.score.possible, category: row.source.fields["category_id"], period: period) else { return nil }
        var result = row; result.title = title
        guard result.hasTitle else { return nil }
        result.due = row.due ?? date(item["due"])
        result.score.possible = row.score.possible ?? number(item["max_points"])
        return result
    }
    /// Catalog, wrapper, detail and folder reads share the same conflict rules.
    private static func compatibleAssignmentMetadata(_ item: [String: Any], id: String, kind expectedKind: String, possible: Double?, category: String?, period: String?) -> Bool {
        guard itemID(item) == id || nonempty(item["id"]) == id else { return false }
        let kind = nonempty(item["type"]) ?? "assignment"
        guard kind != "folder" else { return false }
        if ["assignment", "discussion", "assessment"].contains(kind) && kind != expectedKind { return false }
        if !["assignment", "discussion", "assessment"].contains(kind), itemID(item) != id,
           !(kind == expectedKind && nonempty(item["id"]) == id) { return false }
        if let expected = possible, let actual = number(item["max_points"]), expected != actual { return false }
        if let expected = category, let actual = nonempty(item["grading_category"]), expected != actual { return false }
        if let expected = period, let actual = nonempty(item["grading_period"]),
           (expected.hasPrefix("p") ? String(expected.dropFirst()) : expected) != actual { return false }
        return true
    }
    static func text(_ x: Any?) -> String? { if x is NSNull || x == nil { return nil }; if let s = x as? String { return s }; if let n = x as? NSNumber { return n.stringValue }; return nil }
    static func number(_ x: Any?) -> Double? { guard let s = text(x), let n = Double(s), n.isFinite else { return nil }; return n }
    static func flag(_ x: Any?) -> Bool { text(x) == "1" || text(x)?.lowercased() == "true" }
    static func raw(_ row: [String: Any], _ keys: [String]) -> [String: String] { Dictionary(uniqueKeysWithValues: keys.compactMap { k in text(row[k]).map { (k, $0) } }) }
    static func date(_ x: Any?) -> Date? {
        guard let s = text(x), !s.isEmpty else { return nil }
        if let n = Double(s), n > 1_000_000 {
            let seconds = n > 100_000_000_000 ? n / 1000 : n
            guard seconds.isFinite, seconds <= 253_402_300_799 else { return nil }
            return Date(timeIntervalSince1970: seconds)
        }
        return ProviderDateParser.shared.parse(s)
    }
    public static func schoology(section: Data, grades: Data, items: Data, categories: Data, periods: Data? = nil, periodsFetched: Date? = nil, fetched: Date = Date(), gradeSectionID: String? = nil) throws -> [SourceCourse] {
        let section = try object(section), payload = try object(grades), itemPayload = try object(items), categoryPayload = try object(categories)
        guard let sectionID = text(section["id"]), let sections = payload["section"] as? [[String: Any]], let g = sections.first(where: { text($0["section_id"]) == (gradeSectionID ?? sectionID) }), g["period"] != nil else { throw ProviderError.malformed }
        let gradeOwner = gradeSectionID ?? sectionID
        let periodMetadata = try periods.map { try collection(object($0)["grading_period"]) } ?? []
        let byPeriod = Dictionary(periodMetadata.compactMap { row in nonempty(row["id"]).map { ($0, row) } }, uniquingKeysWith:{ a,_ in a })
        let itemRows = try collection(itemPayload["assignment"])
        guard itemRows.allSatisfy({ itemID($0) != nil }) else { throw ProviderError.malformed }
        let byID = Dictionary(itemRows.compactMap { r in itemKey(r).map { ($0, r) } }, uniquingKeysWith: { a, b in nonempty(b["title"]) == nil ? a : b })
        let wrappers = Dictionary(grouping: itemRows.filter { nonempty($0["id"]) != itemID($0) }, by: { "\(nonempty($0["type"]) ?? "assignment"):\(nonempty($0["id"]) ?? "")" })
        func itemMetadata(_ key: String, grade: [String: Any], periodID: String) -> [String: Any] {
            let id = nonempty(grade["assignment_id"])!
            func compatible(_ item: [String: Any]) -> Bool {
                compatibleAssignmentMetadata(item, id: id, kind: nonempty(grade["type"]) ?? "assignment", possible: number(grade["max_points"]), category: nonempty(grade["category_id"]), period: periodID)
            }
            if let primary = byID[key] { return compatible(primary) ? primary : [:] }
            // Newer catalog kinds can still identify the same graded node. Only
            // accept a unique primary node ID, with no known-kind
            // collision and no conflicting points/category/period metadata.
            let nodes = itemRows.filter { itemID($0) == id }
            if nodes.count == 1, let node = nodes.first,
               let kind = nonempty(node["type"]), !["assignment", "discussion", "assessment"].contains(kind), compatible(node) {
                return node
            }
            // Some grade rows reference the wrapper. Accept only a unique typed
            // alias; colliding content kinds or physical IDs must never be guessed.
            guard let aliases = wrappers[key], Set(aliases.compactMap(itemKey)).count == 1, aliases.allSatisfy(compatible) else { return [:] }
            return aliases.last ?? [:]
        }
        let categoryRows = try collection(categoryPayload["grading_category"])
        guard categoryRows.allSatisfy({ nonempty($0["id"]) != nil && nonempty($0["title"]) != nil }) else { throw ProviderError.malformed }
        guard categoryRows.allSatisfy({ row in
            guard let value = row["drop_lowest"], !(value is NSNull) else { return true }
            guard let count = number(value), count >= 0, Int(exactly: count) != nil else { return false }
            return true
        }) else { throw ProviderError.malformed }
        let parsedCategories = categoryRows.compactMap { r -> GradingCategory? in
            guard let id = text(r["id"]), let title = text(r["title"]) else { return nil }
            return GradingCategory(id: "schoology:\(gradeOwner):category:\(id)", name: title, weight: number(r["weight"]), method: number(r["calculation_type"]) == 1 ? .percent : .points, dropLowest: Int(number(r["drop_lowest"]) ?? 0))
        }
        let catalog = itemRows.compactMap { item -> SourceAssignment? in
            guard let id = itemID(item) else { return nil }
            let kind = text(item["type"]) ?? "assignment"
            return SourceAssignment(source: Provenance(.schoology, "\(gradeOwner):catalog:\(kind):\(id)", fields: raw(item, ["id", "grade_item_id", "type", "grading_period"])), title: nonempty(item["title"]) ?? "Untitled assignment", categoryID: text(item["grading_category"]).map { "schoology:\(gradeOwner):category:\($0)" }, due: date(item["due"]), score: Score(possible: number(item["max_points"])), multiplier: number(item["factor"]) ?? 1, excluded: item["count_in_grade"] != nil && !flag(item["count_in_grade"]))
        }
        let options = section["options"] as? [String: Any]
        // Schoology hides methods/drop counts from student accounts. Preserve
        // the existing points/no-drops defaults when those fields are omitted.
        // An explicitly unsupported method still cannot be calculated.
        let knownCategoryRules = categoryRows.allSatisfy { row in
            row["calculation_type"] == nil || row["calculation_type"] is NSNull || [1.0, 2.0].contains(number(row["calculation_type"]) ?? -1)
        }
        let inferredRules = categoryRows.contains { number($0["calculation_type"]) == nil || number($0["drop_lowest"]) == nil }
        let method: CourseMethod = options?["weighted_grading_categories"] == nil || !knownCategoryRules ? .unknown : flag(options?["weighted_grading_categories"]) ? .weightedCategories : .equalCategories
        var periodRows = try collection(g["period"])
        let finals = g["final_grade"].map(rows) ?? []
        let known = Set(periodRows.compactMap { nonempty($0["period_id"]) })
        var added = Set<String>()
        for row in finals {
            if let id = nonempty(row["period_id"]), !known.contains(id), added.insert(id).inserted { periodRows.append(["period_id":id,"assignment":[]]) }
        }
        for row in periodMetadata {
            if let id = nonempty(row["id"]) {
                let gradeID = "p" + id
                if !known.contains(gradeID), !added.contains(gradeID) { periodRows.append(["period_id":gradeID,"assignment":[]]); added.insert(gradeID) }
            }
        }
        return try periodRows.map { period in
            guard let periodID = nonempty(period["period_id"]) else { throw ProviderError.malformed }
            let final = finals.first { text($0["period_id"]) == periodID }
            let metadata = byPeriod[periodID.hasPrefix("p") ? String(periodID.dropFirst()) : periodID] ?? [:]
            let periodName = nonempty(period["period_title"]) ?? nonempty(metadata["title"]) ?? periodID
            let dates = GradingPeriods.titleDates(periodName)
            let gradeText = nonempty(final?["grade"])
            let grade = OverallGrade(percent: number(final?["scale_id"]) == 0 ? number(final?["grade"]) : nil, letter: gradeText.flatMap { Double($0) == nil ? $0 : nil })
            let rawGrades = try collection((period["assignment"] as? [String: Any])?["grade"] ?? period["assignment"])
            guard rawGrades.allSatisfy({ nonempty($0["assignment_id"]) != nil }) else { throw ProviderError.malformed }
            var assignments = rawGrades.compactMap { r -> SourceAssignment? in
                guard let id = text(r["assignment_id"]) else { return nil }
                let kind = text(r["type"]) ?? "assignment", item = itemMetadata("\(kind):\(id)", grade:r, periodID:periodID)
                let exception = number(r["exception"]) ?? 0
                // Letter/rubric scales cannot be interpreted as points without a numeric value.
                let earned = exception == 0 ? number(r["grade"]) : nil
                return SourceAssignment(source: Provenance(.schoology, "\(gradeOwner):\(periodID):\(kind):\(id)", fields: raw(r, ["assignment_id", "type", "category_id", "exception", "grade", "scale_id", "scale_type", "timestamp"])), title: nonempty(item["title"]) ?? nonempty(r["title"]) ?? "Untitled assignment", categoryID: text(r["category_id"] ?? item["grading_category"]).map { "schoology:\(gradeOwner):category:\($0)" }, due: date(item["due"]), updated: date(r["timestamp"]), score: Score(earned: earned, possible: number(r["max_points"]) ?? number(item["max_points"]), letter: exception == 0 ? nonempty(r["grade"]).flatMap { Double($0) == nil ? $0 : nil } : nil, excused: exception == 1), multiplier: number(item["factor"]) ?? 1, excluded: item["count_in_grade"] != nil && !flag(item["count_in_grade"]))
            }
            let existing = Set(rawGrades.compactMap { r in text(r["assignment_id"]).map { "\(text(r["type"]) ?? "assignment"):\($0)" } })
            let represented = Set(rawGrades.compactMap { row -> String? in
                guard let id=nonempty(row["assignment_id"]) else { return nil }
                return itemKey(itemMetadata("\(nonempty(row["type"]) ?? "assignment"):\(id)",grade:row,periodID:periodID))
            })
            for item in itemRows where text(item["grading_period"]) == periodID.replacingOccurrences(of: "p", with: "") {
                guard let id = itemID(item), let key = itemKey(item), !existing.contains(key), !represented.contains(key) else { continue }
                assignments.append(SourceAssignment(source: Provenance(.schoology, "\(gradeOwner):\(periodID):\(text(item["type"]) ?? "assignment"):\(id)"), title: nonempty(item["title"]) ?? "Untitled assignment", categoryID: text(item["grading_category"]).map { "schoology:\(gradeOwner):category:\($0)" }, due: date(item["due"]), score: Score(possible: number(item["max_points"])), multiplier: number(item["factor"]) ?? 1, excluded: item["count_in_grade"] != nil && !flag(item["count_in_grade"])))
            }
            var fields = ["section_id":sectionID, "grade_section_id":gradeOwner, "period_id":periodID, "course_name":text(section["course_title"]) ?? text(section["section_title"]) ?? "Course"]
            if ["override", "override_grade", "grade_override"].contains(where: { nonempty(final?[$0]) != nil }) || flag(final?["is_override"]) {
                fields["overall_override"] = "true"
            }
            for key in ["start", "end"] {
                if let value = nonempty(metadata[key] ?? period[key]) {
                    fields["period_" + key + "_date_only"] = value.range(of:"^[0-9]{4}-[0-9]{2}-[0-9]{2}$",options:.regularExpression) != nil ? "true" : "false"
                }
            }
            if nonempty(final?["grade"]) != nil, number(final?["scale_id"]) != 0 {
                fields["unsupported_overall_scale"] = "true"
                if let value = number(final?["grade"]), let scale = nonempty(final?["scale_id"]) {
                    fields["reported_numeric_total"] = String(value); fields["reported_scale_id"] = scale
                }
            }
            if inferredRules { fields["grade_rules_inferred"] = "true" }
            if let metadataID = nonempty(metadata["id"]) {
                fields["period_metadata_id"] = metadataID
                fields["period_metadata_fetched"] = String((periodsFetched ?? fetched).timeIntervalSince1970)
            }
            return SourceCourse(source: Provenance(.schoology, "\(gradeOwner):\(periodID)", fields: fields), title: text(section["course_title"]) ?? text(section["section_title"]) ?? "Course", teacher: text(section["teacher_display"] ?? section["teacherDisplay"]) ?? "", term: Term(id: periodID, name: periodName, start: date(metadata["start"] ?? period["start"]) ?? dates.0, end: date(metadata["end"] ?? period["end"]) ?? dates.1, weight: number(final?["weight"]) ?? number(metadata["weight"]) ?? number(period["weight"])), grade: grade, categories: parsedCategories, assignments: assignments, method: method, fetched: fetched, assignmentCatalog: catalog)
        }
    }
    /// A nonzero scale ID can still be a documented numeric/percent scale.
    /// Verify its type before treating the provider's numeric total as percent.
    static func schoologyOveralls(_ courses: [SourceCourse], scales: Data) throws -> [SourceCourse] {
        let rows = try collection(object(scales)["grading_scale"])
        return courses.map { original in
            var course=original
            guard let id=course.source.fields["reported_scale_id"], let value=course.source.fields["reported_numeric_total"].flatMap(Double.init),value.isFinite else { return course }
            let matches=rows.filter { nonempty($0["id"]) == id }
            guard matches.count == 1, let scale=matches.first, let type=number(scale["type"]),[0,1].contains(type),
                  scale["hide_numeric"] == nil || number(scale["hide_numeric"]) == 0 else { return course }
            course.grade.percent=value
            course.source.fields["unsupported_overall_scale"]=nil
            course.source.fields["overall_scale_type"]=String(Int(type))
            course.source.fields["overall_scale_verified_at"]=String(Date().timeIntervalSince1970)
            return course
        }
    }
    /// An optional metadata failure may reuse a recent, account/section-scoped
    /// verified scale. Keep its original verification time, never extend it.
    static func schoologyCachedOveralls(_ courses: [SourceCourse], previous: [SourceCourse], at now: Date = Date()) -> [SourceCourse] {
        courses.map { original in
            var course=original
            guard let id=course.source.fields["reported_scale_id"],
                  let section=course.source.fields["section_id"],let owner=course.source.fields["grade_section_id"],
                  let value=course.source.fields["reported_numeric_total"].flatMap(Double.init),value.isFinite else { return course }
            let matches=previous.filter { old in
                let fields=old.source.fields
                return fields["section_id"] == section && fields["grade_section_id"] == owner
                    && fields["reported_scale_id"] == id && ["0","1"].contains(fields["overall_scale_type"] ?? "")
                    && fields["overall_scale_verified_at"].flatMap(Double.init).map { $0 <= now.timeIntervalSince1970 && now.timeIntervalSince1970 - $0 < 3600 } == true
            }
            guard let old=matches.first,Set(matches.compactMap { $0.source.fields["overall_scale_type"] }).count == 1 else { return course }
            course.grade.percent=value; course.source.fields["unsupported_overall_scale"]=nil
            course.source.fields["overall_scale_type"]=old.source.fields["overall_scale_type"]
            course.source.fields["overall_scale_verified_at"]=matches.compactMap { $0.source.fields["overall_scale_verified_at"].flatMap(Double.init) }.min().map { String($0) }
            return course
        }
    }
}
