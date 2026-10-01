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

public enum ProviderError: Error, Equatable, Sendable { case reconnect, forbidden, throttled(TimeInterval), malformed, unavailable, unsafeURL, tooManyPages }
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
    static func itemID(_ row: [String: Any]) -> String? { nonempty(row["grade_item_id"]) ?? nonempty(row["id"]) }
    static func itemKey(_ row: [String: Any]) -> String? { itemID(row).map { "\(nonempty(row["type"]) ?? "assignment"):\($0)" } }
    /// Title metadata cannot change a grade's identity, score, or exclusion rules.
    static func assignmentMetadata(_ item: [String: Any], for row: SourceAssignment, period: String?) -> SourceAssignment? {
        guard let id = row.source.fields["assignment_id"], itemID(item) == id || nonempty(item["id"]) == id,
              let title = nonempty(item["title"]) else { return nil }
        let kind = nonempty(item["type"]) ?? "assignment", expectedKind = row.source.fields["type"] ?? "assignment"
        guard kind != "folder" else { return nil }
        if ["assignment", "discussion", "assessment"].contains(kind) && kind != expectedKind { return nil }
        if !["assignment", "discussion", "assessment"].contains(kind) && itemID(item) != id { return nil }
        if let expected = row.score.possible, let actual = number(item["max_points"]), expected != actual { return nil }
        if let expected = row.source.fields["category_id"], let actual = nonempty(item["grading_category"]), expected != actual { return nil }
        if let expected = period, let actual = nonempty(item["grading_period"]),
           (expected.hasPrefix("p") ? String(expected.dropFirst()) : expected) != actual { return nil }
        var result = row; result.title = title
        guard result.hasTitle else { return nil }
        result.due = row.due ?? date(item["due"])
        result.score.possible = row.score.possible ?? number(item["max_points"])
        return result
    }
    static func text(_ x: Any?) -> String? { if x is NSNull || x == nil { return nil }; if let s = x as? String { return s }; if let n = x as? NSNumber { return n.stringValue }; return nil }
    static func number(_ x: Any?) -> Double? { guard let s = text(x), let n = Double(s), n.isFinite else { return nil }; return n }
    static func flag(_ x: Any?) -> Bool { text(x) == "1" || text(x)?.lowercased() == "true" }
    static func raw(_ row: [String: Any], _ keys: [String]) -> [String: String] { Dictionary(uniqueKeysWithValues: keys.compactMap { k in text(row[k]).map { (k, $0) } }) }
    static func date(_ x: Any?) -> Date? {
        guard let s = text(x), !s.isEmpty else { return nil }
        if let n = Double(s), n > 1_000_000 { return Date(timeIntervalSince1970: n > 100_000_000_000 ? n / 1000 : n) }
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
            if let primary = byID[key] { return primary }
            // Newer catalog kinds can still identify the same graded node. Only
            // accept a unique primary node ID, with no known-kind
            // collision and no conflicting points/category/period metadata.
            let id = nonempty(grade["assignment_id"])!
            let nodes = itemRows.filter { itemID($0) == id }
            if nodes.count == 1, let node = nodes.first,
               let kind = nonempty(node["type"]), !["assignment", "discussion", "assessment"].contains(kind),
               !(number(node["max_points"]) != nil && number(grade["max_points"]) != nil && number(node["max_points"]) != number(grade["max_points"])),
               !(nonempty(node["grading_category"]) != nil && nonempty(grade["category_id"]) != nil && nonempty(node["grading_category"]) != nonempty(grade["category_id"])),
               nonempty(node["grading_period"]).map({ $0 == (periodID.hasPrefix("p") ? String(periodID.dropFirst()) : periodID) }) ?? true {
                return node
            }
            // Some grade rows reference the wrapper. Accept only a unique typed
            // alias; colliding content kinds or physical IDs must never be guessed.
            guard let aliases = wrappers[key], Set(aliases.compactMap(itemKey)).count == 1 else { return [:] }
            return aliases.last ?? [:]
        }
        let categoryRows = try collection(categoryPayload["grading_category"])
        guard categoryRows.allSatisfy({ nonempty($0["id"]) != nil && nonempty($0["title"]) != nil }) else { throw ProviderError.malformed }
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
        let method: CourseMethod = options?["weighted_grading_categories"] == nil ? .unknown : flag(options?["weighted_grading_categories"]) ? .weightedCategories : .equalCategories
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
            let gradeText = text(final?["grade"])
            let grade = OverallGrade(percent: number(final?["scale_id"]) == 0 ? number(final?["grade"]) : nil, letter: gradeText.flatMap { Double($0) == nil ? $0 : nil })
            let rawGrades = try collection((period["assignment"] as? [String: Any])?["grade"] ?? period["assignment"])
            guard rawGrades.allSatisfy({ nonempty($0["assignment_id"]) != nil }) else { throw ProviderError.malformed }
            var assignments = rawGrades.compactMap { r -> SourceAssignment? in
                guard let id = text(r["assignment_id"]) else { return nil }
                let kind = text(r["type"]) ?? "assignment", item = itemMetadata("\(kind):\(id)", grade:r, periodID:periodID)
                let exception = number(r["exception"]) ?? 0
                // Letter/rubric scales cannot be interpreted as points without a numeric value.
                let earned = exception == 0 ? number(r["grade"]) : nil
                return SourceAssignment(source: Provenance(.schoology, "\(gradeOwner):\(periodID):\(kind):\(id)", fields: raw(r, ["assignment_id", "type", "category_id", "exception", "grade", "scale_id", "scale_type", "timestamp"])), title: nonempty(item["title"]) ?? nonempty(r["title"]) ?? "Untitled assignment", categoryID: text(r["category_id"] ?? item["grading_category"]).map { "schoology:\(gradeOwner):category:\($0)" }, due: date(item["due"]), updated: date(r["timestamp"]), score: Score(earned: earned, possible: number(r["max_points"] ?? item["max_points"]), letter: exception == 0 ? text(r["grade"]).flatMap { Double($0) == nil ? $0 : nil } : nil, excused: exception == 1), multiplier: number(item["factor"]) ?? 1, excluded: item["count_in_grade"] != nil && !flag(item["count_in_grade"]))
            }
            let existing = Set(rawGrades.compactMap { r in text(r["assignment_id"]).map { "\(text(r["type"]) ?? "assignment"):\($0)" } })
            for item in itemRows where text(item["grading_period"]) == periodID.replacingOccurrences(of: "p", with: "") {
                guard let id = itemID(item), let key = itemKey(item), !existing.contains(key) else { continue }
                assignments.append(SourceAssignment(source: Provenance(.schoology, "\(gradeOwner):\(periodID):\(text(item["type"]) ?? "assignment"):\(id)"), title: nonempty(item["title"]) ?? "Untitled assignment", categoryID: text(item["grading_category"]).map { "schoology:\(gradeOwner):category:\($0)" }, due: date(item["due"]), score: Score(possible: number(item["max_points"])), multiplier: number(item["factor"]) ?? 1, excluded: item["count_in_grade"] != nil && !flag(item["count_in_grade"])))
            }
            var fields = ["section_id":sectionID, "grade_section_id":gradeOwner, "period_id":periodID, "course_name":text(section["course_title"]) ?? text(section["section_title"]) ?? "Course"]
            if let metadataID = nonempty(metadata["id"]) {
                fields["period_metadata_id"] = metadataID
                fields["period_metadata_fetched"] = String((periodsFetched ?? fetched).timeIntervalSince1970)
            }
            return SourceCourse(source: Provenance(.schoology, "\(gradeOwner):\(periodID)", fields: fields), title: text(section["course_title"]) ?? text(section["section_title"]) ?? "Course", teacher: text(section["teacher_display"] ?? section["teacherDisplay"]) ?? "", term: Term(id: periodID, name: periodName, start: date(metadata["start"] ?? period["start"]) ?? dates.0, end: date(metadata["end"] ?? period["end"]) ?? dates.1, weight: number(final?["weight"] ?? metadata["weight"] ?? period["weight"])), grade: grade, categories: parsedCategories, assignments: assignments, method: method, fetched: fetched, assignmentCatalog: catalog)
        }
    }
    public static func campus(grades: Data, details: [String: Data] = [:], fetched: Date = Date()) throws -> [SourceCourse] {
        guard let schools = try JSONSerialization.jsonObject(with: grades) as? [[String: Any]] else { throw ProviderError.malformed }
        var result: [SourceCourse] = []
        for school in schools {
            guard let terms = school["terms"] as? [[String: Any]] else { throw ProviderError.malformed }
            for term in terms {
                guard let termID = text(term["termID"] ?? term["_id"] ?? term["termName"]), let courses = term["courses"] as? [[String: Any]] else { throw ProviderError.malformed }
                for row in courses {
                    guard let sectionID = text(row["sectionID"]), let tasks = row["gradingTasks"] as? [[String: Any]] else { throw ProviderError.malformed }
                    let detailID = sectionID
                    let detail = try details[detailID].map(object)
                    if let detail { _ = try collection(detail["details"]) }
                    for task in tasks {
                        guard let taskID = nonempty(task["taskID"] ?? task["gradingTaskID"] ?? task["_id"]) else { throw ProviderError.malformed }
                        let namespace = "\(text(school["schoolID"]) ?? "school"):\(sectionID):\(termID):\(taskID)"
                        let percent = number(task["progressPercent"]) ?? number(task["percent"])
                        let letter = text(task["progressScore"]) ?? text(task["score"])
                        var categories: [GradingCategory] = [], assignments: [SourceAssignment] = [], weighted: [Bool] = []
                        for entry in rows(detail?["details"]) {
                            let t = entry["task"] as? [String: Any] ?? [:]
                            let sameTerm = text(t["termID"]) == termID || (text(t["termName"]) != nil && text(t["termName"]) == text(term["termName"]))
                            let sameTask = text(t["taskID"] ?? t["gradingTaskID"]) == taskID || (tasks.count == 1 && t["taskID"] == nil && t["gradingTaskID"] == nil)
                            guard sameTerm && sameTask else { continue }
                            for c in try collection(entry["categories"]) {
                                guard let id = nonempty(c["categoryID"] ?? c["groupID"] ?? c["_id"] ?? c["name"]), let name = nonempty(c["name"]) else { throw ProviderError.malformed }
                                let catID = "infiniteCampus:\(namespace):category:\(id)"
                                categories.append(GradingCategory(id: catID, name: name, weight: number(c["weight"]), excluded: flag(c["isExcluded"])))
                                if c["isWeighted"] != nil { weighted.append(flag(c["isWeighted"])) }
                                for a in try collection(c["assignments"]) {
                                    guard let aID = nonempty(a["objectSectionID"] ?? a["assignmentID"] ?? a["_id"]) else { throw ProviderError.malformed }
                                    assignments.append(SourceAssignment(source: Provenance(.infiniteCampus, "\(namespace):\(aID)", fields: raw(a, ["objectSectionID", "scorePoints", "totalPoints", "multiplier", "score", "excluded", "dropped", "missing", "late"])), title: text(a["assignmentName"]) ?? "Assignment", categoryID: catID, due: date(a["dueDate"]), updated: date(a["scoreModifiedDate"]) ?? date(a["modifiedDate"]) ?? date(a["scoreDate"]), score: Score(earned: number(a["scorePoints"]), possible: number(a["totalPoints"]), letter: text(a["score"]).flatMap { Double($0) == nil ? $0 : nil }, excused: flag(a["exempt"] ?? a["excused"])), multiplier: number(a["multiplier"]) ?? 1, excluded: flag(a["excluded"]) || flag(a["dropped"])))
                                }
                            }
                        }
                        let method: CourseMethod = categories.isEmpty || weighted.count != categories.count || Set(weighted).count != 1 ? .unknown : weighted[0] ? .weightedCategories : .points
                        let title = (text(row["courseName"]) ?? "Course") + (tasks.count > 1 ? " · \(text(task["taskName"] ?? task["name"]) ?? taskID)" : "")
                        result.append(SourceCourse(source: Provenance(.infiniteCampus, namespace, fields: ["section_id": sectionID, "term_id": termID, "task_id": taskID, "detail_id": detailID, "school_id": text(school["schoolID"]) ?? "school", "task_name": text(task["taskName"] ?? task["name"]) ?? "", "course_name": text(row["courseName"]) ?? "Course"]), title: title, teacher: text(row["teacherDisplay"]) ?? "", term: Term(id: termID, name: text(term["termName"]) ?? termID, start: date(term["startDate"]), end: date(term["endDate"])), grade: OverallGrade(percent: percent, letter: letter), categories: categories, assignments: assignments, method: method, fetched: fetched))
                    }
                }
            }
        }
        return result
    }
}
