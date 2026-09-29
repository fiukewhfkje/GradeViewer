import Foundation

public enum ProviderError: Error, Equatable, Sendable { case reconnect, forbidden, throttled(TimeInterval), malformed, unavailable, unsafeURL, tooManyPages }
public enum ProviderParsing {
    static func object(_ data: Data) throws -> [String: Any] { guard let x = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ProviderError.malformed }; return x }
    static func rows(_ value: Any?) -> [[String: Any]] { if let x = value as? [[String: Any]] { return x }; if let x = value as? [String: Any] { return [x] }; return [] }
    static func text(_ x: Any?) -> String? { if x is NSNull || x == nil { return nil }; if let s = x as? String { return s }; if let n = x as? NSNumber { return n.stringValue }; return nil }
    static func number(_ x: Any?) -> Double? { guard let s = text(x), let n = Double(s), n.isFinite else { return nil }; return n }
    static func flag(_ x: Any?) -> Bool { text(x) == "1" || text(x)?.lowercased() == "true" }
    static func raw(_ row: [String: Any], _ keys: [String]) -> [String: String] { Dictionary(uniqueKeysWithValues: keys.compactMap { k in text(row[k]).map { (k, $0) } }) }
    static func date(_ x: Any?) -> Date? {
        guard let s = text(x), !s.isEmpty else { return nil }
        if let n = Double(s), n > 1_000_000 { return Date(timeIntervalSince1970: n > 100_000_000_000 ? n / 1000 : n) }
        let iso = ISO8601DateFormatter(); if let d = iso.date(from: s) { return d }
        iso.formatOptions.insert(.withFractionalSeconds); if let d = iso.date(from: s) { return d }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        for format in ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"] { formatter.dateFormat = format; if let d = formatter.date(from: s) { return d } }
        return nil
    }
    public static func schoology(section: Data, grades: Data, items: Data, categories: Data, fetched: Date = Date()) throws -> [SourceCourse] {
        let section = try object(section), payload = try object(grades), itemPayload = try object(items), categoryPayload = try object(categories)
        guard let sectionID = text(section["id"]), let sections = payload["section"] as? [[String: Any]], let g = sections.first(where: { text($0["section_id"]) == sectionID }), g["period"] != nil else { throw ProviderError.malformed }
        let itemRows = rows(itemPayload["assignment"])
        let byID = Dictionary(itemRows.compactMap { r in text(r["id"] ?? r["grade_item_id"]).map { ("\(text(r["type"]) ?? "assignment"):\($0)", r) } }, uniquingKeysWith: { _, b in b })
        let categoryRows = rows(categoryPayload["grading_category"])
        let parsedCategories = categoryRows.compactMap { r -> GradingCategory? in
            guard let id = text(r["id"]), let title = text(r["title"]) else { return nil }
            return GradingCategory(id: "schoology:\(sectionID):category:\(id)", name: title, weight: number(r["weight"]), method: number(r["calculation_type"]) == 1 ? .percent : .points, dropLowest: Int(number(r["drop_lowest"]) ?? 0))
        }
        let options = section["options"] as? [String: Any]
        let method: CourseMethod = options?["weighted_grading_categories"] == nil ? .unknown : flag(options?["weighted_grading_categories"]) ? .weightedCategories : .equalCategories
        return rows(g["period"]).compactMap { period in
            guard let periodID = text(period["period_id"]) else { return nil }
            let final = rows(g["final_grade"]).first { text($0["period_id"]) == periodID }
            let gradeText = text(final?["grade"])
            let grade = OverallGrade(percent: number(final?["scale_id"]) == 0 ? number(final?["grade"]) : nil, letter: gradeText.flatMap { Double($0) == nil ? $0 : nil })
            let rawGrades = rows((period["assignment"] as? [String: Any])?["grade"] ?? period["assignment"])
            var assignments = rawGrades.compactMap { r -> SourceAssignment? in
                guard let id = text(r["assignment_id"]) else { return nil }
                let kind = text(r["type"]) ?? "assignment", item = byID["\(kind):\(id)"] ?? [:]
                let exception = number(r["exception"]) ?? 0
                // Letter/rubric scales cannot be interpreted as points without a numeric value.
                let earned = exception == 0 ? number(r["grade"]) : nil
                return SourceAssignment(source: Provenance(.schoology, "\(sectionID):\(periodID):\(kind):\(id)", fields: raw(r, ["assignment_id", "type", "category_id", "exception", "grade", "scale_id", "scale_type", "timestamp"])), title: text(item["title"]) ?? "Assignment \(id)", categoryID: text(r["category_id"] ?? item["grading_category"]).map { "schoology:\(sectionID):category:\($0)" }, due: date(item["due"]), updated: date(r["timestamp"]), score: Score(earned: earned, possible: number(r["max_points"] ?? item["max_points"]), letter: text(r["grade"]).flatMap { Double($0) == nil ? $0 : nil }, excused: exception == 1), multiplier: number(item["factor"]) ?? 1)
            }
            let existing = Set(rawGrades.compactMap { text($0["assignment_id"]) })
            for item in itemRows where text(item["grading_period"]) == periodID.replacingOccurrences(of: "p", with: "") {
                guard let id = text(item["id"] ?? item["grade_item_id"]), !existing.contains(id) else { continue }
                assignments.append(SourceAssignment(source: Provenance(.schoology, "\(sectionID):\(periodID):\(text(item["type"]) ?? "assignment"):\(id)"), title: text(item["title"]) ?? "Assignment \(id)", categoryID: text(item["grading_category"]).map { "schoology:\(sectionID):category:\($0)" }, due: date(item["due"]), score: Score(possible: number(item["max_points"])), multiplier: number(item["factor"]) ?? 1))
            }
            return SourceCourse(source: Provenance(.schoology, "\(sectionID):\(periodID)", fields: ["section_id": sectionID, "period_id": periodID]), title: text(section["course_title"]) ?? text(section["section_title"]) ?? "Course", teacher: text(section["teacher_display"] ?? section["teacherDisplay"]) ?? "", term: Term(id: periodID, name: text(period["period_title"]) ?? periodID), grade: grade, categories: parsedCategories, assignments: assignments, method: method, fetched: fetched)
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
                    guard let sectionID = text(row["sectionID"]), let detailID = text(row["_id"]), let tasks = row["gradingTasks"] as? [[String: Any]] else { throw ProviderError.malformed }
                    let detail = try details[detailID].map(object)
                    for task in tasks {
                        guard let taskID = text(task["taskID"] ?? task["gradingTaskID"] ?? task["_id"]) else { continue }
                        let namespace = "\(text(school["schoolID"]) ?? "school"):\(sectionID):\(termID):\(taskID)"
                        let percent = number(task["progressPercent"]) ?? number(task["percent"])
                        let letter = text(task["progressScore"]) ?? text(task["score"])
                        var categories: [GradingCategory] = [], assignments: [SourceAssignment] = [], weighted: [Bool] = []
                        for entry in rows(detail?["details"]) {
                            let t = entry["task"] as? [String: Any] ?? [:]
                            let sameTerm = text(t["termID"]) == termID || (text(t["termName"]) != nil && text(t["termName"]) == text(term["termName"]))
                            let sameTask = text(t["taskID"] ?? t["gradingTaskID"]) == taskID || (tasks.count == 1 && t["taskID"] == nil && t["gradingTaskID"] == nil)
                            guard sameTerm && sameTask else { continue }
                            for c in rows(entry["categories"]) {
                                guard let id = text(c["categoryID"] ?? c["groupID"] ?? c["_id"] ?? c["name"]), let name = text(c["name"]) else { continue }
                                let catID = "infiniteCampus:\(namespace):category:\(id)"
                                categories.append(GradingCategory(id: catID, name: name, weight: number(c["weight"]), excluded: flag(c["isExcluded"])))
                                if c["isWeighted"] != nil { weighted.append(flag(c["isWeighted"])) }
                                for a in rows(c["assignments"]) {
                                    guard let aID = text(a["objectSectionID"] ?? a["assignmentID"] ?? a["_id"]) else { continue }
                                    assignments.append(SourceAssignment(source: Provenance(.infiniteCampus, "\(namespace):\(aID)", fields: raw(a, ["objectSectionID", "scorePoints", "totalPoints", "multiplier", "score", "excluded", "dropped", "missing", "late"])), title: text(a["assignmentName"]) ?? "Assignment", categoryID: catID, due: date(a["dueDate"]), updated: date(a["modifiedDate"] ?? a["scoreDate"]), score: Score(earned: number(a["scorePoints"]), possible: number(a["totalPoints"]), letter: text(a["score"]).flatMap { Double($0) == nil ? $0 : nil }, excused: flag(a["exempt"] ?? a["excused"])), multiplier: number(a["multiplier"]) ?? 1, excluded: flag(a["excluded"]) || flag(a["dropped"])))
                                }
                            }
                        }
                        let method: CourseMethod = categories.isEmpty || weighted.count != categories.count || Set(weighted).count != 1 ? .unknown : weighted[0] ? .weightedCategories : .points
                        let title = (text(row["courseName"]) ?? "Course") + (tasks.count > 1 ? " · \(text(task["taskName"] ?? task["name"]) ?? taskID)" : "")
                        result.append(SourceCourse(source: Provenance(.infiniteCampus, namespace, fields: ["section_id": sectionID, "term_id": termID, "task_id": taskID, "detail_id": detailID]), title: title, teacher: text(row["teacherDisplay"]) ?? "", term: Term(id: termID, name: text(term["termName"]) ?? termID, start: date(term["startDate"]), end: date(term["endDate"])), grade: OverallGrade(percent: percent, letter: letter), categories: categories, assignments: assignments, method: method, fetched: fetched))
                    }
                }
            }
        }
        return result
    }
}
