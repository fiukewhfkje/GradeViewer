import Foundation

/// Reads the retired multi-provider cache only during an installation upgrade.
/// No retired transport/authentication/model is needed to decode old payloads.
public enum SchoologyUpgrade {
    public struct Result: Sendable {
        public let courses: [Course]
        public let scenarios: [String: Hypothesis]
    }
    private struct ArchiveProvenance: Decodable {
        let provider: String; let id: String
        var key: String { provider + ":" + id }
    }
    private struct ArchiveAssignment: Decodable {
        let source: ArchiveProvenance; let title: String; let score: Score
        let updated: Date?; let multiplier: Double; let excluded: Bool
    }
    private struct ArchiveSource: Decodable {
        let source: ArchiveProvenance; let assignments: [ArchiveAssignment]; let categories: [GradingCategory]
    }
    private struct ArchiveRow: Decodable { let id: String; let sources: [ArchiveAssignment] }
    private struct ProviderCheck: Decodable {
        struct Source: Decodable { let source: ArchiveProvenance }
        let sources: [Source]
    }
    private struct ArchiveCourse: Decodable {
        let id: String; let sources: [ArchiveSource]; let assignments: [ArchiveRow]
        let history: [GradeHistorySnapshot]; let hidden: Bool; let order: Int
    }
    public static func needsUpgrade(_ payloads: [Data]) throws -> Bool {
        try payloads.contains { data in
            let course = try JSONDecoder().decode(ProviderCheck.self, from: data)
            return course.sources.contains { $0.source.provider != ProviderID.schoology.rawValue }
        }
    }
    public static func prepare(_ payloads: [Data], scenarios: [String: Data]) throws -> Result {
        let decoder = JSONDecoder()
        var previous: [Course] = [], convertedScenarios: [String: Hypothesis] = [:]
        for payload in payloads {
            let old = try decoder.decode(ArchiveCourse.self, from: payload)
            guard let object = try JSONSerialization.jsonObject(with: payload) as? [String: Any],
                  let rawSources = object["sources"] as? [[String: Any]] else { throw ProviderError.malformed }
            for index in old.sources.indices where old.sources[index].source.provider == ProviderID.schoology.rawValue {
                var source = try decoder.decode(SourceCourse.self, from: JSONSerialization.data(withJSONObject: rawSources[index]))
                let dates = [source.fetched, source.term.start, source.term.end].compactMap { $0 } + source.assignments.flatMap { [$0.due, $0.updated].compactMap { $0 } }
                guard dates.allSatisfy({ $0.timeIntervalSince1970.isFinite && Int(exactly: floor($0.timeIntervalSince1970 / 86400)) != nil }) else { throw ProviderError.malformed }
                let retired = old.sources.filter { $0.source.provider != ProviderID.schoology.rawValue }
                let archivedItems = retired.flatMap(\.assignments)
                var aliases = Dictionary(source.assignments.map { ($0.id, $0.id) }, uniquingKeysWith: { a,_ in a })
                func sameName(_ title: String, _ item: SourceAssignment) -> Bool {
                    let a = Reconciler.normalize(title), b = Reconciler.normalize(item.title)
                    return !a.isEmpty && item.hasTitle && (a == b || (title.count >= 40 && b.hasPrefix(a)))
                }
                func sameSignature(_ a: ArchiveAssignment, _ b: SourceAssignment) -> Bool {
                    guard let x = a.updated, let y = b.updated, x.timeIntervalSince1970.isFinite, y.timeIntervalSince1970.isFinite,
                          let firstDay = Int(exactly: floor(x.timeIntervalSince1970 / 86400)), let secondDay = Int(exactly: floor(y.timeIntervalSince1970 / 86400)),
                          a.score.earned != nil, a.score.possible.map({ $0 > 0 }) == true else { return false }
                    return a.score.earned == b.score.earned && a.score.possible == b.score.possible && firstDay == secondDay && a.multiplier == b.multiplier && a.excluded == b.excluded && a.score.excused == b.score.excused
                }
                for item in archivedItems {
                    let direct = old.assignments.first { $0.sources.contains { $0.source.key == item.source.key } }?.sources.compactMap { archived in source.assignments.first { $0.id == archived.source.key } } ?? []
                    let named = source.assignments.filter { sameName(item.title, $0) && item.score.possible == $0.score.possible && (!item.score.isGraded || $0.score.isGraded) }
                    let reverseNamedUnique = named.count == 1 && archivedItems.filter { sameName($0.title, named[0]) && $0.score.possible == named[0].score.possible && (!$0.score.isGraded || named[0].score.isGraded) }.count == 1
                    let signature = source.assignments.filter { !$0.hasTitle && sameSignature(item, $0) }
                    let reverseUnique = signature.count == 1 && archivedItems.filter { sameSignature($0, signature[0]) }.count == 1
                    let catalogEvidence = (source.assignments + (source.assignmentCatalog ?? [])).contains { sameName(item.title, $0) && item.score.possible == $0.score.possible }
                    let matched = direct.count == 1 ? direct.first : reverseNamedUnique ? named.first : reverseUnique && catalogEvidence ? signature.first : nil
                    if let matched {
                        aliases[item.source.key] = matched.id
                        if !matched.hasTitle, let row = source.assignments.firstIndex(where: { $0.id == matched.id }) { source.assignments[row].title = item.title }
                    }
                }
                for row in old.assignments {
                    let matches = Set(row.sources.compactMap { aliases[$0.source.key] })
                    if matches.count == 1 { aliases[row.id] = matches.first }
                }
                let course = Course(id: old.id, sources: [source], assignments: source.assignments.map { Assignment(id: $0.id, sources: [$0]) }, history: old.history, hidden: old.hidden, order: old.order)
                previous.append(course)
                if let data = scenarios[old.id] {
                    guard var raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ProviderError.malformed }
                    let added = raw["added"] as? [[String: Any]] ?? []
                    let categoryNames = Dictionary(retired.flatMap(\.categories).map { ($0.id, Reconciler.normalize($0.name)) }, uniquingKeysWith: { a,_ in a })
                    raw["added"] = try added.map { item in
                        guard var provenance = item["source"] as? [String: Any], let provider = provenance["provider"] as? String, let id = provenance["id"] as? String else { throw ProviderError.malformed }
                        var item = item
                        aliases[provider + ":" + id] = ProviderID.schoology.rawValue + ":" + id
                        provenance["provider"] = ProviderID.schoology.rawValue; item["source"] = provenance
                        if let oldID = item["categoryID"] as? String, let name = categoryNames[oldID] {
                            let matches = source.categories.filter { Reconciler.normalize($0.name) == name }
                            if matches.count == 1 { item["categoryID"] = matches[0].id }
                        }
                        return item
                    }
                    let oldScores = raw["scores"] as? [String: Double] ?? [:]
                    raw["scores"] = Dictionary(oldScores.map { (aliases[$0.key] ?? $0.key, $0.value) }, uniquingKeysWith: { a,_ in a })
                    raw["ignored"] = (raw["ignored"] as? [String] ?? []).map { aliases[$0] ?? $0 }
                    convertedScenarios[old.id] = try decoder.decode(Hypothesis.self, from: JSONSerialization.data(withJSONObject: raw))
                }
            }
        }
        // Resolve display grades without recording a new provider observation.
        let resolved = Dictionary(SchoologyGrades.resolved(previous.map(\.display)).map { ($0.id, $0) }, uniquingKeysWith: { a,b in a.fetched >= b.fetched ? a : b })
        for index in previous.indices {
            previous[index].sources = [resolved[previous[index].display.id]!]
        }
        return Result(courses: previous, scenarios: convertedScenarios)
    }
}
