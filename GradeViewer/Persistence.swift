import Foundation
import SwiftData
import GradeCore

@Model final class CourseRecord {
    @Attribute(.unique) var id: String
    var payload: Data
    init(id: String, payload: Data) { self.id = id; self.payload = payload }
}
@Model final class ScenarioRecord {
    @Attribute(.unique) var id: String
    var payload: Data
    init(id: String, payload: Data) { self.id = id; self.payload = payload }
}
// Retained only so SwiftData can open older stores. No runtime mapping API.
@Model final class MappingRecord {
    @Attribute(.unique) var source: String
    var target: String
    init(source: String, target: String) { self.source = source; self.target = target }
}
@MainActor final class GradeRepository {
    let container: ModelContainer
    let encoder: JSONEncoder
    init(memory: Bool = false) throws {
        container = try ModelContainer(for: CourseRecord.self, ScenarioRecord.self, MappingRecord.self, configurations: ModelConfiguration(isStoredInMemoryOnly: memory, cloudKitDatabase: .none))
        encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    }
    func load() throws -> [Course] {
        try upgradeSavedData()
        return try container.mainContext.fetch(FetchDescriptor<CourseRecord>()).map { try JSONDecoder().decode(Course.self, from: $0.payload) }.sorted { $0.order < $1.order }
    }
    private func upgradeSavedData() throws {
        let context = container.mainContext
        let records = try context.fetch(FetchDescriptor<CourseRecord>())
        guard try SchoologyUpgrade.needsUpgrade(records.map(\.payload)) else { return }
        do {
            let scenarios = try context.fetch(FetchDescriptor<ScenarioRecord>())
            let result = try SchoologyUpgrade.prepare(records.map(\.payload), scenarios: Dictionary(uniqueKeysWithValues: scenarios.map { ($0.id, $0.payload) }))
            // Serialize everything before mutations, and commit one differential transaction.
            let payloads = try Self.encode(result.courses)
            let scenarioPayloads = try result.scenarios.mapValues { try encoder.encode($0) }
            for record in records {
                if let payload = payloads[record.id] { record.payload = payload }
                else { context.delete(record) }
            }
            for record in scenarios {
                if let payload = scenarioPayloads[record.id] { record.payload = payload }
                else if payloads[record.id] == nil { context.delete(record) }
            }
            for record in try context.fetch(FetchDescriptor<MappingRecord>()) { context.delete(record) }
            try context.save()
        } catch { context.rollback(); throw error }
    }
    func save(_ courses: [Course]) throws {
        try save(payloads: Self.encode(courses))
    }
    nonisolated static func encode(_ courses: [Course]) throws -> [String: Data] {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try Dictionary(uniqueKeysWithValues: courses.map { ($0.id, try encoder.encode($0)) })
    }
    /// Serialization may happen off the UI thread; SwiftData mutations remain
    /// on their owning context and apply only changed rows in one transaction.
    func save(payloads: [String: Data]) throws {
        let context = container.mainContext
        do {
            let records = try context.fetch(FetchDescriptor<CourseRecord>())
            let map = Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0) })
            for (id, data) in payloads {
                if let old = map[id] { if old.payload != data { old.payload = data } }
                else { context.insert(CourseRecord(id: id, payload: data)) }
            }
            for record in records where payloads[record.id] == nil { context.delete(record) }
            try context.save()
        } catch { context.rollback(); throw error }
    }
    func scenario(_ id: String) throws -> Hypothesis {
        let records = try container.mainContext.fetch(FetchDescriptor<ScenarioRecord>())
        return try records.first { $0.id == id }.map { try JSONDecoder().decode(Hypothesis.self, from: $0.payload) } ?? Hypothesis()
    }
    func saveScenario(_ value: Hypothesis, id: String) throws {
        let context = container.mainContext
        do {
            let data = try encoder.encode(value)
            if let record = try context.fetch(FetchDescriptor<ScenarioRecord>()).first(where: { $0.id == id }) { record.payload = data }
            else { context.insert(ScenarioRecord(id: id, payload: data)) }
            try context.save()
        } catch { context.rollback(); throw error }
    }
    func clearScenarios() throws { let context = container.mainContext; for r in try context.fetch(FetchDescriptor<ScenarioRecord>()) { context.delete(r) }; try context.save() }
}
