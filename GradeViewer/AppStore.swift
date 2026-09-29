import SwiftUI
import Observation
import GradeCore

@Observable @MainActor final class AppStore {
    var courses: [Course] = []
    var errors: [ProviderID: String] = [:]
    var localError: String?
    var refreshing = false
    var demo = false
    var selectedTerm = ""
    var connected: Set<ProviderID> = []
    var scenarios: [String: Hypothesis] = [:]
    var mappings: [String: String] = [:]
    var deadlines: [ProviderID: Date] = [:]
    private var repository: GradeRepository?
    init(repository provided: GradeRepository? = nil, demo requested: Bool? = nil, readCredentials: Bool = true) {
        let arguments = ProcessInfo.processInfo.arguments
        demo = requested ?? arguments.contains("--demo")
        do {
            repository = try provided ?? GradeRepository(memory: demo)
            mappings = try repository!.mappings()
            courses = demo ? Demo.courses(longList: arguments.contains("--long-list")) : try repository!.load()
            if arguments.contains("--empty") { courses = [] }
            if arguments.contains("--error") { errors[.infiniteCampus] = "Infinite Campus could not refresh." }
            if !demo && readCredentials {
                if try SecureStore.load(SchoologyCredentials.self, account: "schoology") != nil { connected.insert(.schoology) }
                if try SecureStore.load(CampusSession.self, account: "campus") != nil { connected.insert(.infiniteCampus) }
            }
        } catch { localError = "Saved grades could not be opened." }
        for course in courses { scenarios[course.id] = (try? repository?.scenario(course.id)) ?? Hypothesis() }
        selectedTerm = terms.first ?? ""
    }
    var terms: [String] {
        let unique = Set(courses.map { $0.display.term.name })
        return unique.sorted { a,b in
            let startA = courses.first { $0.display.term.name == a }?.display.term.start ?? .distantPast
            let startB = courses.first { $0.display.term.name == b }?.display.term.start ?? .distantPast
            return startA == startB ? a > b : startA > startB
        }
    }
    var visibleCourses: [Course] { courses.filter { !$0.hidden && (selectedTerm.isEmpty || $0.display.term.name == selectedTerm) }.sorted { $0.order < $1.order } }
    func refresh() async {
        guard !demo, !refreshing, repository != nil else { return }
        refreshing = true; defer { refreshing = false }
        var successes: [ProviderID: [SourceCourse]] = [:]
        for provider in ProviderID.allCases where connected.contains(provider) {
            if let deadline = deadlines[provider], deadline > Date() { continue }
            do {
                switch provider {
                case .schoology:
                    guard let credentials = try SecureStore.load(SchoologyCredentials.self, account: "schoology") else { throw ProviderError.reconnect }
                    successes[provider] = try await SchoologyProvider(credentials: credentials).fetch()
                case .infiniteCampus:
                    guard var session = try SecureStore.load(CampusSession.self, account: "campus") else { throw ProviderError.reconnect }
                    let campus = try InfiniteCampusProvider(base: session.base, cookies: session.cookies.compactMap(\.cookie))
                    successes[provider] = try await campus.fetch()
                    session.cookies = await campus.sessionCookies().map(StoredCookie.init)
                    try SecureStore.save(session, account: "campus")
                }
                errors[provider] = nil
            } catch { errors[provider] = message(error, provider: provider) }
        }
        if !successes.isEmpty { persist(Reconciler.refreshing(previous: courses, successful: successes, mappings: mappings)) }
    }
    func message(_ error: Error, provider: ProviderID) -> String {
        if case ProviderError.reconnect = error { return "\(provider.name) needs to be reconnected." }
        if case ProviderError.forbidden = error { return "\(provider.name) did not allow access to grades." }
        if case let ProviderError.throttled(seconds) = error { deadlines[provider] = Date().addingTimeInterval(seconds); return "\(provider.name) asked to wait before refreshing." }
        return "\(provider.name) could not refresh."
    }
    func connectSchoology(_ credentials: SchoologyCredentials) async throws {
        guard !refreshing else { throw ProviderError.unavailable }
        refreshing = true; defer { refreshing = false }
        let fetched = try await SchoologyProvider(credentials: credentials).fetch()
        try SecureStore.save(credentials, account: "schoology")
        connected.insert(.schoology); errors[.schoology] = nil
        persist(Reconciler.refreshing(previous: courses, successful: [.schoology: fetched], mappings: mappings))
    }
    func connectCampus(_ supplied: CampusSession) async throws {
        guard !refreshing else { throw ProviderError.unavailable }
        refreshing = true; defer { refreshing = false }
        var session = supplied
        let provider = try InfiniteCampusProvider(base: session.base, cookies: session.cookies.compactMap(\.cookie))
        let fetched = try await provider.fetch()
        session.cookies = await provider.sessionCookies().map(StoredCookie.init)
        try SecureStore.save(session, account: "campus")
        connected.insert(.infiniteCampus); errors[.infiniteCampus] = nil
        persist(Reconciler.refreshing(previous: courses, successful: [.infiniteCampus: fetched], mappings: mappings))
    }
    func disconnect(_ provider: ProviderID) {
        guard !refreshing else { return }
        do { try SecureStore.delete(account: provider == .schoology ? "schoology" : "campus"); connected.remove(provider); errors[provider] = nil; deadlines[provider] = nil
            // Clear history and scenarios when disconnecting to avoid leaving another account's data.
            let remaining = courses.flatMap(\.sources).filter { $0.source.provider != provider }
            try repository?.clearScenarios(); scenarios = [:]; mappings = [:]; try repository?.saveMappings(mappings); persist(Reconciler.reconcile(remaining))
        } catch { localError = "The connection could not be removed." }
    }
    func persist(_ updated: [Course]) {
        do { try repository?.save(updated); courses = updated; if !terms.contains(selectedTerm) { selectedTerm = terms.first ?? "" } }
        catch { localError = "Grades could not be saved on this device."; return }
        updateWidget()
    }
    func updateWidget() {
        guard !demo else { return }
        do { try WidgetCache.write(courses: visibleCourses) }
        catch { localError = "The widget could not be updated." }
    }
    func match(_ sourceID: String, with targetID: String?) {
        var updated = mappings
        if let old = updated.removeValue(forKey: sourceID) { updated[old] = nil }
        if let targetID {
            if let old = updated.removeValue(forKey: targetID) { updated[old] = nil }
            updated[sourceID] = targetID; updated[targetID] = sourceID
        }
        do {
            try repository?.saveMappings(updated); mappings = updated
            persist(Reconciler.reconcile(courses.flatMap(\.sources), previous: courses, mappings: mappings))
        } catch { localError = "Course matches could not be saved." }
    }
    func setHidden(_ id: String, hidden: Bool) { var updated = courses; if let i = updated.firstIndex(where: { $0.id == id }) { updated[i].hidden = hidden }; persist(updated) }
    func move(from: IndexSet, to: Int) { var ordered = courses.sorted { $0.order < $1.order }; ordered.move(fromOffsets: from, toOffset: to); for i in ordered.indices { ordered[i].order = i }; persist(ordered) }
    func scenario(_ course: Course) -> Hypothesis { scenarios[course.id] ?? Hypothesis() }
    func saveScenario(_ scenario: Hypothesis, course: Course) { do { try repository?.saveScenario(scenario, id: course.id); scenarios[course.id] = scenario } catch { localError = "What-If could not be saved." } }
}
