import Foundation

public enum ProviderID: String, Codable, CaseIterable, Sendable { case schoology
    public var name: String { "Schoology" }
}
public struct Provenance: Codable, Hashable, Sendable {
    public var provider: ProviderID
    public var id: String
    public var fields: [String: String]
    public init(_ provider: ProviderID, _ id: String, fields: [String: String] = [:]) { self.provider = provider; self.id = id; self.fields = fields }
    public var key: String { "\(provider.rawValue):\(id)" }
}
public struct Term: Codable, Hashable, Sendable {
    public var id: String; public var name: String; public var start: Date?; public var end: Date?; public var weight: Double?
    public init(id: String, name: String, start: Date? = nil, end: Date? = nil, weight: Double? = nil) { self.id = id; self.name = name; self.start = start; self.end = end; self.weight = weight }
}
public struct Score: Codable, Hashable, Sendable {
    public var earned: Double?; public var possible: Double?; public var letter: String?; public var excused: Bool
    public init(earned: Double? = nil, possible: Double? = nil, letter: String? = nil, excused: Bool = false) { self.earned = earned; self.possible = possible; self.letter = letter; self.excused = excused }
    public var isGraded: Bool { earned != nil || letter?.isEmpty == false }
    public var percent: Double? { guard !excused, let e = earned, let p = possible, p > 0, e.isFinite, p.isFinite else { return nil }; return e / p * 100 }
}
public struct OverallGrade: Codable, Hashable, Sendable {
    public var percent: Double?; public var letter: String?
    public init(percent: Double? = nil, letter: String? = nil) { self.percent = percent; self.letter = letter }
}
public enum CategoryMethod: String, Codable, Sendable { case points, percent }
public enum CourseMethod: String, Codable, Sendable { case points, weightedCategories, equalCategories, unknown }
public struct GradingCategory: Codable, Hashable, Identifiable, Sendable {
    public var id: String; public var name: String; public var weight: Double?; public var method: CategoryMethod; public var dropLowest: Int; public var excluded: Bool
    public init(id: String, name: String, weight: Double? = nil, method: CategoryMethod = .points, dropLowest: Int = 0, excluded: Bool = false) { self.id = id; self.name = name; self.weight = weight; self.method = method; self.dropLowest = dropLowest; self.excluded = excluded }
}
public struct SourceAssignment: Codable, Hashable, Identifiable, Sendable {
    public var source: Provenance; public var title: String; public var categoryID: String?; public var due: Date?; public var updated: Date?; public var score: Score; public var multiplier: Double; public var excluded: Bool
    public var id: String { source.key }
    public var hasTitle: Bool {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return !name.isEmpty && name != "Untitled assignment" && name != "Assignment" && name.range(of: "^Assignment [0-9]+$", options: .regularExpression) == nil
    }
    public init(source: Provenance, title: String, categoryID: String? = nil, due: Date? = nil, updated: Date? = nil, score: Score = Score(), multiplier: Double = 1, excluded: Bool = false) { self.source = source; self.title = title; self.categoryID = categoryID; self.due = due; self.updated = updated; self.score = score; self.multiplier = multiplier; self.excluded = excluded }
}
public struct SourceCourse: Codable, Hashable, Identifiable, Sendable {
    public var source: Provenance; public var title: String; public var teacher: String; public var term: Term; public var grade: OverallGrade; public var categories: [GradingCategory]; public var assignments: [SourceAssignment]; public var method: CourseMethod; public var fetched: Date; public var assignmentCatalog: [SourceAssignment]?
    public var id: String { source.key }
    public init(source: Provenance, title: String, teacher: String = "", term: Term, grade: OverallGrade = OverallGrade(), categories: [GradingCategory] = [], assignments: [SourceAssignment] = [], method: CourseMethod = .unknown, fetched: Date = Date(), assignmentCatalog: [SourceAssignment]? = nil) { self.source = source; self.title = title; self.teacher = teacher; self.term = term; self.grade = grade; self.categories = categories; self.assignments = assignments; self.method = method; self.fetched = fetched; self.assignmentCatalog = assignmentCatalog }
}
public struct Assignment: Codable, Identifiable, Sendable {
    public var id: String; public var sources: [SourceAssignment]
    public init(id: String, sources: [SourceAssignment]) { self.id = id; self.sources = sources }
    public var display: SourceAssignment {
        sources[0]
    }
}
public struct GradeHistorySnapshot: Codable, Hashable, Identifiable, Sendable {
    // Historical origins are archive labels, not active connections.
    public var id: UUID; public var date: Date; public var grade: OverallGrade; public var provider: String
    public init(date: Date, grade: OverallGrade, provider: ProviderID) { id = UUID(); self.date = date; self.grade = grade; self.provider = provider.rawValue }
}
public struct Course: Codable, Identifiable, Sendable {
    public var id: String; public var sources: [SourceCourse]; public var assignments: [Assignment]; public var history: [GradeHistorySnapshot]; public var hidden: Bool; public var order: Int
    public var display: SourceCourse { sources[0] }
    public var calculationSource: SourceCourse { display }
    public var name: String { display.source.fields["course_name"] ?? display.title }
    public init(id: String, sources: [SourceCourse], assignments: [Assignment] = [], history: [GradeHistorySnapshot] = [], hidden: Bool = false, order: Int = 0) { self.id = id; self.sources = sources; self.assignments = assignments; self.history = history; self.hidden = hidden; self.order = order }
}
public struct Hypothesis: Codable, Sendable {
    public var scores: [String: Double] = [:]; public var ignored: Set<String> = []; public var added: [SourceAssignment] = []
    public init() {}
    public func normalized(for source: SourceCourse) -> Hypothesis {
        let originals = Dictionary((source.assignments + added).map { ($0.id, $0) }, uniquingKeysWith: { a,_ in a })
        var copy = self
        copy.scores = scores.filter { id, value in
            guard let item = originals[id], value.isFinite else { return false }
            return item.score.earned.map { abs($0 - value) > 0.000000001 } ?? true
        }
        copy.ignored = ignored.intersection(originals.keys)
        return copy
    }
}
