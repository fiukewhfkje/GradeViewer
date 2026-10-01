import SwiftUI
import Observation
import GradeCore

@Observable @MainActor final class AppStore {
    var courses: [Course] = []
    var errors: [ProviderID: String] = [:]
    var localError: String?
    var refreshing = false
    var needsFreshData = false
    var foregroundRefreshFailed = false
    private var freshProviders: Set<ProviderID> = []
    var demo = false
    var selectedTerm = ""
    var selectedCourseID: String?
    var selectedPeriods: [String:String] = [:]
    var connected: Set<ProviderID> = []
    var pending: Set<ProviderID> = []
    var connectionDetails: [ProviderID: String] = [:]
    var scenarios: [String: Hypothesis] = [:]
    var mappings: [String: String] = [:]
    var deadlines: [ProviderID: Date] = [:]
    private var repository: GradeRepository?
    private var started = false
    private var refreshDurations: [ProviderID: Double] = [:]
    private var refreshTask: Task<Void, Never>?
    private let fetchOverride: (@Sendable (ProviderID) async throws -> [SourceCourse])?
    var presentationDate = Date()
    init(repository provided: GradeRepository? = nil, demo requested: Bool? = nil, readCredentials: Bool = true, fetch: (@Sendable (ProviderID) async throws -> [SourceCourse])? = nil) {
        fetchOverride = fetch
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
            if demo && arguments.contains("--freshness-fixture"), !courses.isEmpty {
                for i in courses[0].sources[0].assignments.indices { courses[0].sources[0].assignments[i].updated = Date().addingTimeInterval(-3 * 86400) }
                courses[0].assignments = courses[0].sources[0].assignments.map { Assignment(id:$0.id, sources:[$0]) }
                var schoology = courses[0].display
                schoology.source = Provenance(.schoology, "freshness-schoology")
                for i in schoology.assignments.indices { schoology.assignments[i].source = Provenance(.schoology, "freshness:\(i)") }
                schoology.assignments[0].updated = Date()
                courses = Reconciler.reconcile(courses.flatMap(\.sources) + [schoology], previous:courses)
            }
            if arguments.contains("--empty") { courses = [] }
            if arguments.contains("--error") { errors[.infiniteCampus] = "Infinite Campus could not refresh." }
            if demo && arguments.contains("--period-fixture") {
                courses = Reconciler.reconcile(Demo.periodSources(includeExam:arguments.contains("--exam-fixture")))
                for i in courses.indices { courses[i].order = GradingPeriods.descriptor(courses[i]).label == "Q1" ? 0 : i + 1 }
                courses.sort { $0.order < $1.order }
            }
            if !demo && readCredentials {
                if try SecureStore.load(SchoologyCredentials.self, account: "schoology") != nil { connected.insert(.schoology) }
                if try SecureStore.load(CampusSession.self, account: "campus") != nil { connected.insert(.infiniteCampus) }
                if try SecureStore.load(SchoologyCredentials.self, account: "schoology-pending") != nil { pending.insert(.schoology) }
                if try SecureStore.load(CampusSession.self, account: "campus-pending") != nil { pending.insert(.infiniteCampus) }
            }
        } catch { localError = "Saved grades could not be opened." }
        for course in courses { scenarios[course.id] = (try? repository?.scenario(course.id)) ?? Hypothesis() }
        selectedTerm = preferredTerm()
        needsFreshData = !demo && (!connected.isEmpty || !courses.isEmpty)
        if demo && arguments.contains("--loading-fixture") { needsFreshData = true }
        if demo && arguments.contains("--fresh-failure-fixture") { needsFreshData = true; foregroundRefreshFailed = true }
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
    var visibleCourses: [Course] { CourseSelection.visible(courses, term: selectedTerm) }
    func preferredTerm(at now: Date = Date()) -> String {
        let ranks = Dictionary(uniqueKeysWithValues: terms.map { name in
            (name, courses.filter { $0.display.term.name == name }.map { course in
                (GradingPeriods.descriptor(course).kind == .quarter ? 4 : 0) + (course.display.source.provider == .infiniteCampus ? 2 : 0)
            }.max() ?? 0)
        })
        let ranked = terms.sorted { a,b in
            ranks[a] == ranks[b] ? terms.firstIndex(of:a)! < terms.firstIndex(of:b)! : ranks[a]! > ranks[b]!
        }
        let current = ranked.first { name in courses.contains { course in
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
        await refresh()
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
                    "periodCount": GradingPeriods.related(to:course, among:courses).count,
                    "periodKinds": Dictionary(uniqueKeysWithValues: ["quarter", "semester", "exam", "year", "other"].map { kind in
                        (kind, GradingPeriods.related(to:course, among:courses).filter { GradingPeriods.descriptor($0).kind.rawValue == kind }.count)
                    }),
                    "hasMatchedSemester": GradingPeriods.semester(for:course, among:courses).map { $0.sources.count == 2 } ?? false,
                    "sameTitleRows": matchingTitles.count,
                    "sameTitlePointConflicts": matchingTitles.filter { a in source.assignments.contains { Reconciler.normalize($0.title) == Reconciler.normalize(a.title) && $0.score.possible != a.score.possible } }.count,
                    "overviewGradedRows": AssignmentGrouping.overview(for: course, schoology: schoology).count,
                    "overviewSorted": zip(dates,dates.dropFirst()).allSatisfy { $0 >= $1 },
                    "overviewUnique": Set(overview.map(\.id)).count == overview.count,
                    "untitledOverviewRows": overview.filter { !$0.display.hasTitle }.count,
                    "untitledKindCounts": Dictionary(uniqueKeysWithValues: ["assignment", "discussion", "assessment", "other"].map { kind in
                        (kind, overview.filter { row in
                            guard !row.display.hasTitle else { return false }
                            let value = row.display.source.fields["type"] ?? "assignment"
                            return kind == "other" ? !["assignment", "discussion", "assessment"].contains(value) : value == kind
                        }.count)
                    }),
                    "untitledCatalogWithTitleCount": overview.filter { row in
                        guard !row.display.hasTitle, let id = row.display.source.fields["assignment_id"] else { return false }
                        return (schoology?.assignmentCatalog ?? []).contains { ($0.source.fields["id"] == id || $0.source.fields["grade_item_id"] == id) && $0.hasTitle }
                    }.count,
                    "untitledCatalogKindCounts": Dictionary(uniqueKeysWithValues: ["assignment", "discussion", "assessment", "other"].map { kind in
                        let unresolved = Set(overview.filter { !$0.display.hasTitle }.compactMap { $0.display.source.fields["assignment_id"] })
                        return (kind, (schoology?.assignmentCatalog ?? []).filter { item in
                            guard unresolved.contains(item.source.fields["id"] ?? "") || unresolved.contains(item.source.fields["grade_item_id"] ?? "") else { return false }
                            let value = item.source.fields["type"] ?? "assignment"
                            return kind == "other" ? !["assignment", "discussion", "assessment"].contains(value) : value == kind
                        }.count)
                    }),
                    "untitledCatalogExplicitNodeCount": overview.filter { row in
                        guard !row.display.hasTitle, let id = row.display.source.fields["assignment_id"] else { return false }
                        return (schoology?.assignmentCatalog ?? []).contains { $0.source.fields["grade_item_id"] == id }
                    }.count,
                    "untitledHasCatalogIdentityCount": overview.filter { row in
                        guard !row.display.hasTitle, let id = row.display.source.fields["assignment_id"] else { return false }
                        return (schoology?.assignmentCatalog ?? []).contains { $0.source.fields["id"] == id || $0.source.fields["grade_item_id"] == id }
                    }.count,
                    "homeMatchesOverviewDate": updated(course) == overview.compactMap { $0.display.updated }.max(),
                    "latestCalculatedMatchesReported": generated.last?.grade.percent.map { abs($0 - (source.grade.percent ?? $0)) < 0.000000001 } ?? true,
                    "assignments": source.assignments.count, "reliableBaseline": GradeCalculator.isReliable(source),
                    "calculatedPoints": generated.count, "observedPoints": course.history.count,
                    "hasUpdateDate": updated(course) != nil,
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
                                     "freshPresentationBlocked": needsFreshData, "cachedCourses": courses.count, "visibleCourses": rows, "storageError": localError != nil,
                                     "providerErrorCount": errors.count,
                                     "providerResults": Dictionary(uniqueKeysWithValues: ProviderID.allCases.map { ($0.rawValue, errors[$0] ?? "success") }),
                                     "refreshMilliseconds": Dictionary(uniqueKeysWithValues: refreshDurations.map { ($0.key.rawValue, $0.value) })]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: root.appendingPathComponent("layout-verification.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }
    #endif
    /// Foreground and manual requests join the same in-flight refresh.
    func refresh() async {
        presentationDate = Date()
        if let refreshTask { await refreshTask.value; return }
        guard !demo, !refreshing, repository != nil else { return }
        refreshing = true
        if needsFreshData { foregroundRefreshFailed = false }
        let task = Task {
            await performRefresh()
            refreshTask = nil; refreshing = false
        }
        refreshTask = task
        await task.value
    }
    func requireFreshData() {
        guard !demo else { return }
        freshProviders = []
        needsFreshData = !connected.isEmpty || !courses.isEmpty
        foregroundRefreshFailed = false
    }
    private func finishFreshPresentation() {
        guard needsFreshData else { return }
        if (!connected.isEmpty && connected.isSubset(of:freshProviders)) || (connected.isEmpty && courses.isEmpty) {
            needsFreshData = false; foregroundRefreshFailed = false
        } else { foregroundRefreshFailed = true }
    }
    func becameActive() async {
        requireFreshData()
        if started { await refresh() } else { await startup() }
        // A foreground entry may have joined a backgrounded operation after one
        // provider had already finished. Fetch again only for that unresolved case.
        if needsFreshData && connected.contains(where: { !freshProviders.contains($0) && errors[$0] == nil }) { await refresh() }
    }
    func refreshWhileActive(interval: Duration = .seconds(60)) async {
        while !Task.isCancelled {
            do { try await Task.sleep(for: interval) } catch { return }
            await refresh()
        }
    }
    func updated(_ course: Course) -> Date? {
        let schoology = AssignmentGrouping.schoologySource(for: course, among: courses.flatMap(\.sources))
        return AssignmentGrouping.updated(for: course, schoology: schoology)
    }
    private func performRefresh() async {
        let providers = ProviderID.allCases.filter { connected.contains($0) && (deadlines[$0] ?? .distantPast) <= Date() }
        await withTaskGroup(of: (ProviderID, Result<[SourceCourse], Error>).self) { group in
            for provider in providers {
                group.addTask { [self] in
                    do { return (provider, .success(try await fetchProvider(provider))) }
                    catch { return (provider, .failure(error)) }
                }
            }
            for await (provider, result) in group {
                switch result {
                case let .success(fetched):
                    errors[provider] = nil; deadlines[provider] = nil; freshProviders.insert(provider)
                    // Publish each complete provider immediately; a slow provider
                    // must not hold up new assignments from the other one.
                    persist(Reconciler.refreshing(previous: courses, successful: [provider: fetched], mappings: mappings))
                case let .failure(error):
                    errors[provider] = message(error, provider: provider)
                }
            }
        }
        presentationDate = Date()
        finishFreshPresentation()
        #if DEBUG
        verifyLayout(phase: "after refresh")
        #endif
    }
    private func fetchProvider(_ provider: ProviderID) async throws -> [SourceCourse] {
        let startedAt = Date()
        defer { refreshDurations[provider] = Date().timeIntervalSince(startedAt) * 1000 }
        if let fetchOverride { return try await fetchOverride(provider) }
        switch provider {
        case .schoology:
            guard let credentials = try SecureStore.load(SchoologyCredentials.self, account: "schoology") else { throw ProviderError.reconnect }
            var verify = false
            #if DEBUG
            verify = ProcessInfo.processInfo.arguments.contains("--verify-layout")
            #endif
            let schoology = try SchoologyProvider(credentials: credentials, diagnosticsEnabled: verify)
            do {
                let result = try await schoology.fetch(previous: courses.flatMap(\.sources))
                if verify { ConnectionDiagnostics(provider: .schoology, result: "success", responses: await schoology.diagnostics()).save() }
                return result
            } catch {
                if verify { ConnectionDiagnostics(provider: .schoology, result: ConnectionDiagnostics.result(error), responses: await schoology.diagnostics()).save() }
                throw error
            }
        case .infiniteCampus:
            guard var session = try SecureStore.load(CampusSession.self, account: "campus") else { throw ProviderError.reconnect }
            let campus = try InfiniteCampusProvider(base: session.base, cookies: session.cookies.compactMap(\.cookie))
            let result: Result<[SourceCourse], Error>
            do { result = .success(try await campus.fetch(resuming: session.portal)) } catch { result = .failure(error) }
            // A response can rotate cookies even when a later detail fails. Save
            // the updated jar before surfacing that failure, preserving expiry/deletions.
            session.replaceCookies(await campus.sessionCookies())
            try SecureStore.save(session, account: "campus")
            return try result.get()
        }
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
            connected.insert(.schoology); errors[.schoology] = nil; freshProviders.insert(.schoology)
            persist(Reconciler.refreshing(previous: courses, successful: [.schoology: fetched], mappings: mappings))
            finishFreshPresentation()
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
            session.replaceCookies(await provider.sessionCookies())
            try SecureStore.save(session, account: "campus")
            try SecureStore.delete(account: "campus-pending"); pending.remove(.infiniteCampus)
            connected.insert(.infiniteCampus); errors[.infiniteCampus] = nil; freshProviders.insert(.infiniteCampus)
            persist(Reconciler.refreshing(previous: courses, successful: [.infiniteCampus: fetched], mappings: mappings))
            finishFreshPresentation()
            recordConnection(.infiniteCampus, responses: await provider.diagnostics(), error: nil)
        } catch {
            session.replaceCookies(await provider.sessionCookies())
            try SecureStore.save(session, account: "campus-pending")
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
            freshProviders.remove(provider)
            finishFreshPresentation()
        } catch { localError = "The connection could not be removed." }
    }
    func persist(_ updated: [Course]) {
        do { try repository?.save(updated); courses = updated; selectedTerm = preferredTerm() }
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
