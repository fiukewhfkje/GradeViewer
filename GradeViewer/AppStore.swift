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
    var pending: Set<ProviderID> = []
    var connectionDetails: [ProviderID: String] = [:]
    var scenarios: [String: Hypothesis] = [:]
    var mappings: [String: String] = [:]
    var deadlines: [ProviderID: Date] = [:]
    private var repository: GradeRepository?
    private var started = false
    init(repository provided: GradeRepository? = nil, demo requested: Bool? = nil, readCredentials: Bool = true) {
        let arguments = ProcessInfo.processInfo.arguments
        demo = requested ?? arguments.contains("--demo")
        do {
            repository = try provided ?? GradeRepository(memory: demo)
            mappings = try repository!.mappings()
            courses = demo ? Demo.courses(longList: arguments.contains("--long-list")) : try repository!.load()
            if demo && arguments.contains("--single-history") { for i in courses.indices { courses[i].history = Array(courses[i].history.suffix(1)) } }
            if demo && arguments.contains("--multiple-terms"), courses.count > 1 {
                for i in courses.indices { courses[i].sources[0].term.start = Date().addingTimeInterval(-86_400); courses[i].sources[0].term.end = Date().addingTimeInterval(86_400) }
                courses[1].sources[0].term = Term(id: "future", name: "Future quarter", start: Date().addingTimeInterval(172_800), end: Date().addingTimeInterval(259_200))
            }
            if demo && arguments.contains("--curve-fixture"), !courses.isEmpty {
                courses[0].history = [GradeHistorySnapshot(date: Date(timeIntervalSince1970: 1_790_000_000), grade: OverallGrade(percent: 80), provider: .infiniteCampus), GradeHistorySnapshot(date: Date(timeIntervalSince1970: 1_790_172_800), grade: OverallGrade(percent: 100), provider: .infiniteCampus)]
                courses[0].sources[0].assignments = []
            }
            if demo && arguments.contains("--noop-scenario"), let course = courses.first, let assignment = course.calculationSource.assignments.first, let score = assignment.score.earned {
                var scenario = Hypothesis(); scenario.scores[assignment.id] = score; try repository?.saveScenario(scenario, id: course.id)
            }
            if demo && arguments.contains("--past-quarter-fixture"), !courses.isEmpty {
                for i in courses[0].sources[0].assignments.indices { courses[0].sources[0].assignments[i].source.fields["objectSectionID"] = "fixture:\(i)" }
                courses[0].sources[0].source.fields["section_id"] = "fixture-section"; courses[0].sources[0].source.fields["task_id"] = "fixture-task"
                courses[0].assignments = courses[0].sources[0].assignments.map { Assignment(id: $0.id, sources: [$0]) }
                var past = courses[0].display
                past.source.id = "fixture-past"; past.term = Term(id: "past", name: "Past quarter")
                let old = SourceAssignment(source: Provenance(.infiniteCampus, "fixture-old", fields: ["objectSectionID":"fixture-old"]), title: "Past quarter lab", due: Demo.now.addingTimeInterval(-40 * 86400), updated: Demo.now.addingTimeInterval(-39 * 86400), score: Score(earned: 90, possible: 100))
                past.assignments = [old]
                courses += Reconciler.reconcile([past])
                var schoology = courses[0].display
                schoology.source = Provenance(.schoology, "fixture-schoology"); schoology.teacher = ""
                schoology.categories = [GradingCategory(id: "quizzes", name: "Quizzes"), GradingCategory(id: "labs", name: "Labs")]
                for i in schoology.assignments.indices {
                    schoology.assignments[i].source = Provenance(.schoology, "fixture-schoology:\(i)")
                    schoology.assignments[i].categoryID = "quizzes"
                }
                var metadata = old; metadata.source = Provenance(.schoology, "fixture-catalog-old"); metadata.categoryID = "labs"; metadata.score.earned = nil
                schoology.assignmentCatalog = [metadata]
                courses += Reconciler.reconcile([schoology])
            }
            if demo && arguments.contains("--overview-fixture"), !courses.isEmpty {
                var schoology = courses[0].display
                schoology.source = Provenance(.schoology, "overview-schoology"); schoology.teacher = ""
                for i in schoology.assignments.indices { schoology.assignments[i].source = Provenance(.schoology, "overview:\(i)") }
                schoology.assignments.append(SourceAssignment(source: Provenance(.schoology, "overview:extra"), title: "Recent extra credit", categoryID: schoology.categories[0].id, updated: courses[0].display.assignments[0].updated!.addingTimeInterval(-3600), score: Score(earned:1, possible:1)))
                schoology.assignments.append(SourceAssignment(source: Provenance(.schoology, "overview:pending"), title: "Pending future assignment", categoryID: schoology.categories[0].id, due: Demo.now.addingTimeInterval(86400), score: Score(possible:100)))
                courses += Reconciler.reconcile([schoology])
            }
            if arguments.contains("--empty") { courses = [] }
            if arguments.contains("--error") { errors[.infiniteCampus] = "Infinite Campus could not refresh." }
            if !demo && readCredentials {
                if try SecureStore.load(SchoologyCredentials.self, account: "schoology") != nil { connected.insert(.schoology) }
                if try SecureStore.load(CampusSession.self, account: "campus") != nil { connected.insert(.infiniteCampus) }
                if try SecureStore.load(SchoologyCredentials.self, account: "schoology-pending") != nil { pending.insert(.schoology) }
                if try SecureStore.load(CampusSession.self, account: "campus-pending") != nil { pending.insert(.infiniteCampus) }
            }
        } catch { localError = "Saved grades could not be opened." }
        for course in courses { scenarios[course.id] = (try? repository?.scenario(course.id)) ?? Hypothesis() }
        selectedTerm = preferredTerm()
        #if DEBUG
        verifyLayout(phase: "cached startup")
        #endif
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
    func preferredTerm(at now: Date = Date()) -> String {
        let current = terms.first { name in courses.contains { course in
            let term = course.display.term
            return term.name == name && term.start.map { $0 <= now } == true && term.end.map { $0 >= now } == true
        } }
        if let current { return current }
        return terms.first { name in courses.contains { course in
            let source = course.display
            return source.term.name == name && (source.term.start == nil || source.term.start! <= now) && (source.grade.percent != nil || source.grade.letter?.isEmpty == false)
        } } ?? terms.first ?? ""
    }
    func startup() async {
        guard !started else { return }; started = true
        let pendingAttempts = pending
        var attempted = pendingAttempts
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--verify-connections") {
            for provider in ProviderID.allCases where connected.contains(provider) {
                do {
                    switch provider {
                    case .schoology: if let value = try SecureStore.load(SchoologyCredentials.self, account: "schoology") { try await connectSchoology(value) }
                    case .infiniteCampus: if let value = try SecureStore.load(CampusSession.self, account: "campus") { try await connectCampus(value) }
                    }
                } catch { errors[provider] = message(error, provider: provider) }
                attempted.insert(provider)
            }
        }
        #endif
        for provider in ProviderID.allCases where pendingAttempts.contains(provider) && pending.contains(provider) {
            do { try await retryConnection(provider) }
            catch { errors[provider] = message(error, provider: provider) }
        }
        await refresh(excluding: attempted)
        #if DEBUG
        verifyLayout(phase: "after startup refresh")
        #endif
    }
    #if DEBUG
    /// Explicit CLI verification only; no names, IDs, scores, dates, or credentials.
    private func verifyLayout(phase: String) {
        guard ProcessInfo.processInfo.arguments.contains("--verify-layout"),
              let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let rows: [[String: Any]] = visibleCourses.map { course in
            let source = course.calculationSource
            let generated = GradeProgression.calculated(source, before: source.fetched)
            let schoology = AssignmentGrouping.schoologySource(for: course, among: courses.flatMap(\.sources))
            let matchingTitles = (schoology?.assignments ?? []).filter { a in source.assignments.contains { Reconciler.normalize($0.title) == Reconciler.normalize(a.title) } }
            let overview = AssignmentGrouping.overview(for:course,schoology:schoology)
            let dates = overview.compactMap { $0.display.updated }
            return ["method": source.method.rawValue, "provider": source.source.provider.rawValue,
                    "sameTitleRows": matchingTitles.count,
                    "sameTitlePointConflicts": matchingTitles.filter { a in source.assignments.contains { Reconciler.normalize($0.title) == Reconciler.normalize(a.title) && $0.score.possible != a.score.possible } }.count,
                    "overviewGradedRows": AssignmentGrouping.overview(for: course, schoology: schoology).count,
                    "overviewSorted": zip(dates,dates.dropFirst()).allSatisfy { $0 >= $1 },
                    "overviewUnique": Set(overview.map(\.id)).count == overview.count,
                    "assignments": source.assignments.count, "reliableBaseline": GradeCalculator.isReliable(source),
                    "calculatedPoints": generated.count, "observedPoints": course.history.count,
                    "hasUpdateDate": course.updated != nil,
                    "schoologyCategoryCount": AssignmentGrouping.schoologySource(for: course, among: courses.flatMap(\.sources))?.categories.count ?? 0,
                    "schoologyNameMatches": courses.flatMap(\.sources).filter { $0.source.provider == .schoology && Reconciler.normalize($0.source.fields["course_name"] ?? $0.title) == Reconciler.normalize(course.name) }.count,
                    "schoologyAvailableCategoryCount": courses.flatMap(\.sources).filter { $0.source.provider == .schoology && Reconciler.normalize($0.source.fields["course_name"] ?? $0.title) == Reconciler.normalize(course.name) }.flatMap(\.categories).count,
                    "fullGradedRows": AssignmentGrouping.fullCourse(for: course, among: courses).assignments.count,
                    "gradedRows": course.assignments.filter { $0.display.score.isGraded }.count,
                    "numericScoreWithoutPoints": source.assignments.filter { $0.score.earned == nil && $0.source.fields["score"].flatMap(Double.init) != nil }.count,
                    "schoologyGradedRows": AssignmentGrouping.schoologySource(for: course, among: courses.flatMap(\.sources))?.assignments.filter { $0.score.isGraded }.count ?? 0,
                    "schoologyOnlyGradedRows": AssignmentGrouping.groups(for: course, schoology: AssignmentGrouping.schoologySource(for: course, among: courses.flatMap(\.sources))).flatMap(\.assignments).filter { row in !row.sources.contains { $0.source.provider == source.source.provider } }.count,
                    "missingScoredDates": source.assignments.filter { $0.score.earned != nil && $0.updated == nil && $0.due == nil }.count,
                    "futureScoredDates": source.assignments.filter { $0.score.earned != nil && ($0.updated ?? $0.due).map { $0 > source.fetched } == true }.count]
        }
        let payload: [String: Any] = ["phase": phase, "schoologyConnected": connected.contains(.schoology),
                                     "campusConnected": connected.contains(.infiniteCampus), "pendingConnections": pending.count,
                                     "cachedCourses": courses.count, "visibleCourses": rows, "storageError": localError != nil,
                                     "providerErrorCount": errors.count]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: root.appendingPathComponent("layout-verification.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }
    #endif
    func refresh(excluding: Set<ProviderID> = []) async {
        guard !demo, !refreshing, repository != nil else { return }
        refreshing = true; defer { refreshing = false }
        var successes: [ProviderID: [SourceCourse]] = [:]
        for provider in ProviderID.allCases where connected.contains(provider) && !excluding.contains(provider) {
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
        let provider = try SchoologyProvider(credentials: credentials, diagnosticsEnabled: true)
        try SecureStore.save(credentials, account: "schoology-pending"); pending.insert(.schoology)
        do {
            let fetched = try await provider.fetch()
            try SecureStore.save(credentials, account: "schoology")
            try SecureStore.delete(account: "schoology-pending"); pending.remove(.schoology)
            connected.insert(.schoology); errors[.schoology] = nil
            persist(Reconciler.refreshing(previous: courses, successful: [.schoology: fetched], mappings: mappings))
            recordConnection(.schoology, responses: await provider.diagnostics(), error: nil)
        } catch {
            recordConnection(.schoology, responses: await provider.diagnostics(), error: error); throw error
        }
    }
    func connectCampus(_ supplied: CampusSession) async throws {
        guard !refreshing else { throw ProviderError.unavailable }
        refreshing = true; defer { refreshing = false }
        var session = supplied
        let provider = try InfiniteCampusProvider(base: session.base, cookies: session.cookies.compactMap(\.cookie), diagnosticsEnabled: true)
        try SecureStore.save(session, account: "campus-pending"); pending.insert(.infiniteCampus)
        do {
            let fetched = try await provider.fetch()
            session.cookies = await provider.sessionCookies().map(StoredCookie.init)
            try SecureStore.save(session, account: "campus")
            try SecureStore.delete(account: "campus-pending"); pending.remove(.infiniteCampus)
            connected.insert(.infiniteCampus); errors[.infiniteCampus] = nil
            persist(Reconciler.refreshing(previous: courses, successful: [.infiniteCampus: fetched], mappings: mappings))
            recordConnection(.infiniteCampus, responses: await provider.diagnostics(), error: nil)
        } catch {
            recordConnection(.infiniteCampus, responses: await provider.diagnostics(), error: error); throw error
        }
    }
    private func recordConnection(_ provider: ProviderID, responses: [HTTPDiagnostic], error: Error?) {
        let report = ConnectionDiagnostics(provider: provider, result: ConnectionDiagnostics.result(error), responses: responses)
        report.save(); connectionDetails[provider] = error == nil ? nil : report.summary
    }
    func retryConnection(_ provider: ProviderID) async throws {
        switch provider {
        case .schoology:
            guard let saved = try SecureStore.load(SchoologyCredentials.self, account: "schoology-pending") else { throw ProviderError.reconnect }
            try await connectSchoology(saved)
        case .infiniteCampus:
            guard let saved = try SecureStore.load(CampusSession.self, account: "campus-pending") else { throw ProviderError.reconnect }
            try await connectCampus(saved)
        }
    }
    func forgetPending(_ provider: ProviderID) {
        do {
            try SecureStore.delete(account: provider == .schoology ? "schoology-pending" : "campus-pending")
            pending.remove(provider); connectionDetails[provider] = nil
        } catch { localError = "The saved connection could not be removed." }
    }
    func disconnect(_ provider: ProviderID) {
        guard !refreshing else { return }
        do { try SecureStore.delete(account: provider == .schoology ? "schoology" : "campus"); try SecureStore.delete(account: provider == .schoology ? "schoology-pending" : "campus-pending"); pending.remove(provider); connectionDetails[provider] = nil; connected.remove(provider); errors[provider] = nil; deadlines[provider] = nil
            // Clear history and scenarios when disconnecting to avoid leaving another account's data.
            let remaining = courses.flatMap(\.sources).filter { $0.source.provider != provider }
            try repository?.clearScenarios(); scenarios = [:]; mappings = [:]; try repository?.saveMappings(mappings); persist(Reconciler.reconcile(remaining))
        } catch { localError = "The connection could not be removed." }
    }
    func persist(_ updated: [Course]) {
        do { try repository?.save(updated); courses = updated; if !terms.contains(selectedTerm) { selectedTerm = preferredTerm() } }
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
    func scenario(_ course: Course) -> Hypothesis { (scenarios[course.id] ?? Hypothesis()).normalized(for: course.calculationSource) }
    func saveScenario(_ supplied: Hypothesis, course: Course) { let scenario = supplied.normalized(for: course.calculationSource); do { try repository?.saveScenario(scenario, id: course.id); scenarios[course.id] = scenario } catch { localError = "What-If could not be saved." } }
}
