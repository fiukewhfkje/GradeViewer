import SwiftUI
import Observation
import GradeCore

private typealias ProviderFetch = (courses: [SourceCourse], retryAfter: Date?)

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
    var waitingProviders: [ProviderID: Date] = [:]
    private var repository: GradeRepository?
    private var started = false
    private var refreshOnNextActivation = true
    private var backgrounded = false
    private var refreshDurations: [ProviderID: Double] = [:]
    private var refreshTask: Task<Void, Never>?
    private var courseRevision = 0
    #if DEBUG
    private var refreshStages: [String: Double] = [:]
    private var maximumMainDelay: Double = 0
    private var didVerifyCampusRenewal = false
    #endif
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
            if demo && arguments.contains("--graph-rounding-fixture"), !courses.isEmpty {
                var source = courses[0].display; source.method = .points; source.categories = []
                source.assignments = Array(source.assignments.prefix(2))
                source.assignments[0].score = Score(earned:100, possible:100)
                source.assignments[1].score = Score(earned:92.598, possible:100)
                source.assignments[0].updated = Demo.now
                source.assignments[1].updated = Demo.now.addingTimeInterval(100)
                source.fetched = Demo.now.addingTimeInterval(200); source.grade.percent = 96.29
                courses[0].sources = [source]
                courses[0].history = [GradeHistorySnapshot(date:Demo.now.addingTimeInterval(50), grade:OverallGrade(percent:100), provider:source.source.provider), GradeHistorySnapshot(date:source.fetched, grade:source.grade, provider:source.source.provider)]
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
            if demo && arguments.contains("--untitled-fixture"), !courses.isEmpty {
                var campus = courses[0].display; campus.assignments[0].title = "Unit 2 Test"
                var schoology = campus; schoology.source = Provenance(.schoology, "untitled-fixture")
                for i in schoology.assignments.indices { schoology.assignments[i].source = Provenance(.schoology, "untitled-fixture:\(i)") }
                schoology.assignments[0].title = "Untitled assignment"; schoology.assignments[0].due = nil
                schoology.assignments[0].updated = campus.assignments[0].updated!.addingTimeInterval(60)
                var catalog = schoology.assignments[0]; catalog.title = "Unit 2 Test"; catalog.score.earned = nil; catalog.source.id += ":catalog"
                schoology.assignmentCatalog = [catalog]
                courses[0] = Reconciler.reconcile([campus, schoology], previous: [courses[0]])[0]
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
            if demo && arguments.contains("--connected-settings-fixture") { connected = Set(ProviderID.allCases) }
            if !demo && readCredentials {
                if try SecureStore.load(SchoologyCredentials.self, account: "schoology") != nil { connected.insert(.schoology) }
                if try SecureStore.load(CampusSession.self, account: "campus") != nil { connected.insert(.infiniteCampus) }
                if try SecureStore.load(SchoologyCredentials.self, account: "schoology-pending") != nil { pending.insert(.schoology) }
                if try SecureStore.load(CampusSession.self, account: "campus-pending") != nil { pending.insert(.infiniteCampus) }
            }
        } catch { localError = "Saved grades could not be opened." }
        for course in courses { scenarios[course.id] = (try? repository?.scenario(course.id)) ?? Hypothesis() }
        // A complete snapshot can include deferred optional title recovery.
        // Restore its server cooldown on process relaunch as well as foreground return.
        if !demo {
            for source in courses.flatMap(\.sources) {
                if let seconds = source.source.fields["provider_retry_after"].flatMap(Double.init), seconds.isFinite, seconds > Date().timeIntervalSince1970 {
                    deadlines[source.source.provider] = max(deadlines[source.source.provider] ?? .distantPast, Date(timeIntervalSince1970: seconds))
                }
            }
        }
        selectedTerm = preferredTerm()
        needsFreshData = !demo && (!connected.isEmpty || !courses.isEmpty)
        if demo && arguments.contains("--loading-fixture") { needsFreshData = true }
        if demo && arguments.contains("--fresh-failure-fixture") { needsFreshData = true; foregroundRefreshFailed = true }
        if demo && arguments.contains("--cooldown-fixture") {
            connected = [.schoology]; needsFreshData = true
            deadlines[.schoology] = Date().addingTimeInterval(60)
            waitingProviders[.schoology] = deadlines[.schoology]
        }
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
        await refresh(refreshMetadata: false)
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
                    "recoveredUntitledRows": overview.filter { row in
                        row.display.hasTitle && row.sources.contains { $0.source.provider == .schoology && !$0.hasTitle } && row.sources.contains { item in source.assignments.contains { $0.id == item.id } }
                    }.count,
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
                                     "waitingProviderCount": waitingProviders.count,
                                     "providerResults": Dictionary(uniqueKeysWithValues: ProviderID.allCases.map { ($0.rawValue, errors[$0] ?? (waitingProviders[$0] == nil ? "success" : "waiting for retry")) }),
                                     "refreshMilliseconds": Dictionary(uniqueKeysWithValues: refreshDurations.map { ($0.key.rawValue, $0.value) })]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: root.appendingPathComponent("layout-verification.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }
    #endif
    /// Foreground and manual requests join the same in-flight refresh.
    func refresh(refreshMetadata: Bool = true) async {
        presentationDate = Date()
        if let refreshTask { await refreshTask.value; return }
        guard !demo, !refreshing, repository != nil else { return }
        refreshing = true
        if needsFreshData { foregroundRefreshFailed = false }
        let task = Task {
            await performRefresh(refreshMetadata: refreshMetadata)
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
        guard needsFreshData, !backgrounded else { return }
        if (!connected.isEmpty && connected.isSubset(of:freshProviders)) || (connected.isEmpty && courses.isEmpty) {
            needsFreshData = false; foregroundRefreshFailed = false
        } else {
            foregroundRefreshFailed = connected.contains { !freshProviders.contains($0) && waitingProviders[$0] == nil }
        }
    }
    func sceneChanged(_ phase: ScenePhase) {
        // App switcher, Control Center, and system prompts temporarily deactivate
        // the scene. Only a real background entry arms another automatic read.
        guard phase == .background else { return }
        backgrounded = true; refreshOnNextActivation = true; requireFreshData()
    }
    func activateScene() async {
        guard refreshOnNextActivation else { return }
        refreshOnNextActivation = false; backgrounded = false
        requireFreshData()
        if started { await refresh(refreshMetadata: false) } else { await startup() }
        // A return may join a backgrounded operation after one provider already
        // finished. Resolve only providers that have not refreshed this entry.
        if needsFreshData && connected.contains(where: { !freshProviders.contains($0) && errors[$0] == nil && (deadlines[$0]?.timeIntervalSinceNow ?? 0) <= 30 }) { await refresh(refreshMetadata: false) }
    }
    func refreshWhileActive(interval: Duration = .seconds(60)) async {
        guard !demo else { return }
        let clock = ContinuousClock()
        var nextCheck = clock.now.advanced(by: interval)
        while !Task.isCancelled {
            let nextRetry = waitingProviders.filter { connected.contains($0.key) }.values.min()
            let untilCheck = max(.zero, clock.now.duration(to: nextCheck))
            let untilRetry = nextRetry.map { Duration.seconds(max(0, $0.timeIntervalSinceNow)) } ?? untilCheck
            // Notice a cooldown started by a manual refresh within one second,
            // without sending extra HTTP requests during the ordinary interval.
            let pause = min(.seconds(1), min(untilCheck, untilRetry))
            do { try await Task.sleep(for: pause) } catch { return }
            guard clock.now >= nextCheck || nextRetry.map({ $0 <= Date() }) == true else { continue }
            await refresh(refreshMetadata: false)
            nextCheck = clock.now.advanced(by: interval)
        }
    }
    func updated(_ course: Course) -> Date? {
        let schoology = AssignmentGrouping.schoologySource(for: course, among: courses.flatMap(\.sources))
        return AssignmentGrouping.updated(for: course, schoology: schoology)
    }
    private func performRefresh(refreshMetadata: Bool) async {
        #if DEBUG
        let profile = ProcessInfo.processInfo.arguments.contains("--profile-refresh")
        let refreshStarted = Date()
        refreshStages = [:]; maximumMainDelay = 0
        let heartbeat = profile ? Task { @MainActor in
            while !Task.isCancelled {
                let started = Date()
                do { try await Task.sleep(for: .milliseconds(16)) } catch { return }
                maximumMainDelay = max(maximumMainDelay, max(0, Date().timeIntervalSince(started) * 1000 - 16))
            }
        } : nil
        #endif
        // Short cooldowns stay in this coalesced refresh; longer waits leave
        // other providers free to refresh and resume from the active timer.
        let providers = ProviderID.allCases.filter { connected.contains($0) && (deadlines[$0]?.timeIntervalSinceNow ?? 0) <= 30 }
        for provider in connected where (deadlines[provider]?.timeIntervalSinceNow ?? 0) > 0 {
            errors[provider] = nil; waitingProviders[provider] = deadlines[provider]
        }
        await withTaskGroup(of: (ProviderID, Result<ProviderFetch, Error>).self) { group in
            for provider in providers {
                group.addTask { [self] in
                    do {
                        return (provider, .success(try await fetchAfterCooldown(provider, refreshMetadata: refreshMetadata)))
                    }
                    catch { return (provider, .failure(error)) }
                }
            }
            for await (provider, result) in group {
                switch result {
                case let .success(fetched):
                    waitingProviders[provider] = nil
                    // Publish each complete provider immediately; a slow provider
                    // must not hold up new assignments from the other one.
                    if await applySnapshot(fetched.courses, provider: provider) {
                        errors[provider] = nil; deadlines[provider] = fetched.retryAfter; freshProviders.insert(provider)
                    } else { errors[provider] = "Fresh grades could not be saved on this device." }
                case let .failure(error):
                    if case let ProviderError.throttled(seconds) = error {
                        deadlines[provider] = Date().addingTimeInterval(max(1, seconds))
                        waitingProviders[provider] = deadlines[provider]; errors[provider] = nil
                    } else { waitingProviders[provider] = nil; errors[provider] = message(error, provider: provider) }
                }
            }
        }
        presentationDate = Date()
        finishFreshPresentation()
        #if DEBUG
        if profile {
            // Let the heartbeat observe the last synchronous publication block.
            await Task.yield()
            heartbeat?.cancel(); await heartbeat?.value
            let report: [String: Any] = ["totalMilliseconds": Date().timeIntervalSince(refreshStarted) * 1000,
                "providerMilliseconds": Dictionary(uniqueKeysWithValues: refreshDurations.map { ($0.key.rawValue, $0.value) }),
                "stagesMilliseconds": refreshStages, "maximumMainDelayMilliseconds": maximumMainDelay,
                "providerErrorCount": errors.count, "waitingProviderCount": waitingProviders.count, "freshPresentationBlocked": needsFreshData,
                "courseCount": courses.count, "untitledRows": courses.flatMap(\.sources).flatMap(\.assignments).filter { $0.score.isGraded && !$0.hasTitle }.count]
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]),
               let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
                try? data.write(to: root.appendingPathComponent("refresh-performance.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        }
        verifyLayout(phase: "after refresh")
        #endif
    }
    private func fetchAfterCooldown(_ provider: ProviderID, refreshMetadata: Bool) async throws -> ProviderFetch {
        if let deadline = deadlines[provider], deadline > Date() {
            try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow)))
        }
        try Task.checkCancellation()
        guard connected.contains(provider) else { throw CancellationError() }
        deadlines[provider] = nil
        return try await fetchProvider(provider, refreshMetadata: refreshMetadata)
    }
    private func fetchProvider(_ provider: ProviderID, refreshMetadata: Bool) async throws -> ProviderFetch {
        let startedAt = Date()
        defer { refreshDurations[provider] = Date().timeIntervalSince(startedAt) * 1000 }
        if let fetchOverride { return (try await fetchOverride(provider), nil) }
        switch provider {
        case .schoology:
            guard var credentials = try SecureStore.load(SchoologyCredentials.self, account: "schoology") else { throw ProviderError.reconnect }
            var verify = false
            #if DEBUG
            verify = ProcessInfo.processInfo.arguments.contains("--verify-layout") || ProcessInfo.processInfo.arguments.contains("--profile-refresh")
            #endif
            let schoology = try SchoologyProvider(credentials: credentials, diagnosticsEnabled: verify)
            do {
                let result = try await schoology.fetchSnapshot(previous: courses.flatMap(\.sources), refreshMetadata: refreshMetadata)
                if credentials.userID != result.userID {
                    credentials.userID = result.userID; try SecureStore.save(credentials, account: "schoology")
                }
                if verify { ConnectionDiagnostics(provider: .schoology, result: "success", responses: await schoology.diagnostics()).save() }
                return (result.courses, result.retryAfter)
            } catch {
                if verify { ConnectionDiagnostics(provider: .schoology, result: ConnectionDiagnostics.result(error), responses: await schoology.diagnostics()).save() }
                throw error
            }
        case .infiniteCampus:
            guard var session = try SecureStore.load(CampusSession.self, account: "campus") else { throw ProviderError.reconnect }
            var verify = false
            #if DEBUG
            verify = ProcessInfo.processInfo.arguments.contains("--verify-layout") || ProcessInfo.processInfo.arguments.contains("--profile-refresh")
            #endif
            let campus = try InfiniteCampusProvider(base: session.base, cookies: session.cookies.compactMap(\.cookie), diagnosticsEnabled: verify)
            let ssoAvailable = session.sso?.canRenew(base: session.base) == true
            var result: Result<[SourceCourse], Error>
            do { result = .success(try await campus.fetch(resuming: ssoAvailable ? nil : session.portal)) } catch { result = .failure(error) }
            var responses = await campus.diagnostics()
            session.replaceCookies(await campus.sessionCookies())
            let initialResult = result
            let initialSession = session
            var verifyRenewal = false
            #if DEBUG
            verifyRenewal = session.sso?.browserCookies(base: session.base).isEmpty == false && !didVerifyCampusRenewal && ProcessInfo.processInfo.arguments.contains("--verify-campus-renewal")
            if verifyRenewal { didVerifyCampusRenewal = true; result = .failure(ProviderError.reconnect) }
            #endif
            var renewed = false
            var navigation: [String]?
            // Campus and the IdP have independent sessions. Renew through the
            // normal browser SSO entry only after Campus rejects authentication.
            if case .failure(ProviderError.reconnect) = result, ssoAvailable || verifyRenewal {
                renewed = true
                do {
                    var browserInput = session
                    // Device verification uses only saved IdP cookies, while the
                    // active Campus jar remains intact if the probe cannot renew.
                    if verifyRenewal { browserInput.cookies = []; browserInput.sso?.needsSignIn = nil }
                    session = try await CampusWebSession.renew(browserInput, retainingCookies: { session = $0 }, diagnostics: { navigation = $0 })
                    let replacement = try InfiniteCampusProvider(base: session.base, cookies: session.cookies.compactMap(\.cookie), diagnosticsEnabled: verify)
                    do { result = .success(try await replacement.fetch()) } catch { result = .failure(error) }
                    responses += await replacement.diagnostics()
                    session.replaceCookies(await replacement.sessionCookies())
                } catch { result = .failure(error) }
                if case .failure(ProviderError.reconnect) = result {
                    // Reopening the app must not loop on a finished sign-in page.
                    // A successful interactive connection creates a fresh SSO state.
                    session.sso?.needsSignIn = true
                }
            }
            if verify {
                let error: Error?
                switch result { case .success: error = nil; case .failure(let failure): error = failure }
                ConnectionDiagnostics(provider: .infiniteCampus, result: ConnectionDiagnostics.result(error), responses: responses,
                                      campusSSO: CampusSSODiagnostic(available: ssoAvailable, attempted: renewed, navigation: navigation,
                                                                   idpCookieCount: session.sso?.browserCookies(base: session.base).count)).save()
            }
            if verifyRenewal, case .failure = result, case .success = initialResult { result = initialResult; session = initialSession }
            // A response can rotate cookies even when a later detail fails. Save
            // the updated jar before surfacing that failure, preserving expiry/deletions.
            try SecureStore.save(session, account: "campus")
            return (try result.get(), nil)
        }
    }
    @discardableResult private func applySnapshot(_ fetched: [SourceCourse], provider: ProviderID) async -> Bool {
        // Rebase if a local visibility/order/mapping edit occurred while the
        // worker was running. Background normalization must never undo that edit.
        while connected.contains(provider) {
            let previous = courses, rules = mappings, revision = courseRevision
            do {
                #if DEBUG
                let workerStarted = Date()
                #endif
                let (updated, payloads) = try await Task.detached(priority: .userInitiated) {
                    let updated = Reconciler.refreshing(previous: previous, successful: [provider: fetched], mappings: rules)
                    return (updated, try GradeRepository.encode(updated))
                }.value
                guard revision == courseRevision else { continue }
                #if DEBUG
                refreshStages[provider.rawValue + " reconciliation and encoding"] = Date().timeIntervalSince(workerStarted) * 1000
                let started = Date()
                #endif
                try repository?.save(payloads: payloads)
                courses = updated; courseRevision += 1; selectedTerm = preferredTerm()
                #if DEBUG
                refreshStages[provider.rawValue + " save and publish"] = Date().timeIntervalSince(started) * 1000
                #endif
            } catch { localError = "Grades could not be saved on this device."; return false }
            return true
        }
        return false
    }
    func message(_ error: Error, provider: ProviderID) -> String {
        if case ProviderError.reconnect = error { return "\(provider.name) needs to be reconnected." }
        if case ProviderError.accountChanged = error { return "Disconnect \(provider.name) before switching accounts." }
        if case ProviderError.forbidden = error { return "\(provider.name) did not allow access to grades." }
        if case let ProviderError.throttled(seconds) = error { deadlines[provider] = Date().addingTimeInterval(seconds); return "\(provider.name) asked to wait before refreshing." }
        if let network = error as? URLError {
            switch network.code {
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid:
                return "\(provider.name) could not establish a secure connection. Check your network or VPN, then retry. Your saved sign-in is retained."
            case .timedOut: return "\(provider.name) took too long to respond. Check your connection, then retry."
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost:
                return "\(provider.name) could not be reached. Check your connection, then retry."
            default: break
            }
        }
        return "\(provider.name) could not refresh."
    }
    func connectSchoology(_ credentials: SchoologyCredentials) async throws {
        guard !refreshing else { throw ProviderError.unavailable }
        refreshing = true; defer { refreshing = false }
        let provider = try SchoologyProvider(credentials: credentials, diagnosticsEnabled: true)
        try SecureStore.save(credentials, account: "schoology-pending"); pending.insert(.schoology)
        do {
            let snapshot = try await provider.fetchSnapshot()
            let fetched = snapshot.courses
            if let active = try SecureStore.load(SchoologyCredentials.self, account: "schoology"),
               let owner = active.userID ?? courses.flatMap(\.sources).first(where: { $0.source.provider == .schoology })?.source.fields["user_id"],
               owner != snapshot.userID { throw ProviderError.accountChanged }
            var verified = credentials; verified.userID = snapshot.userID
            try await activateConnection(verified, account: "schoology", pendingAccount: "schoology-pending", provider: .schoology, fetched: fetched)
            errors[.schoology] = nil; deadlines[.schoology] = snapshot.retryAfter; waitingProviders[.schoology] = nil; freshProviders.insert(.schoology)
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
        if let active = try SecureStore.load(CampusSession.self, account: "campus"), active.base != session.base { throw ProviderError.accountChanged }
        let provider = try InfiniteCampusProvider(base: session.base, cookies: session.cookies.compactMap(\.cookie), diagnosticsEnabled: true)
        try SecureStore.save(session, account: "campus-pending"); pending.insert(.infiniteCampus)
        do {
            let fetched = try await provider.fetch()
            session.replaceCookies(await provider.sessionCookies())
            try await activateConnection(session, account: "campus", pendingAccount: "campus-pending", provider: .infiniteCampus, fetched: fetched)
            errors[.infiniteCampus] = nil; deadlines[.infiniteCampus] = nil; waitingProviders[.infiniteCampus] = nil; freshProviders.insert(.infiniteCampus)
            finishFreshPresentation()
            recordConnection(.infiniteCampus, responses: await provider.diagnostics(), error: nil,
                             campusSSO: CampusSSODiagnostic(available: session.sso?.canRenew(base: session.base) == true, attempted: false))
        } catch {
            session.replaceCookies(await provider.sessionCookies())
            try SecureStore.save(session, account: "campus-pending")
            recordConnection(.infiniteCampus, responses: await provider.diagnostics(), error: error,
                             campusSSO: CampusSSODiagnostic(available: session.sso?.canRenew(base: session.base) == true, attempted: false)); throw error
        }
    }
    /// A successful network read is insufficient: preserve active credentials
    /// and cached grades if local snapshot serialization/persistence fails.
    func activateConnection<T: Codable>(_ value: T, account: String, pendingAccount: String, provider: ProviderID, fetched: [SourceCourse]) async throws {
        let previous = try SecureStore.load(T.self, account: account)
        let wasConnected = connected.contains(provider)
        try SecureStore.save(value, account: account)
        connected.insert(provider)
        guard await applySnapshot(fetched, provider: provider) else {
            if !wasConnected { connected.remove(provider) }
            if let previous { try SecureStore.save(previous, account: account) }
            else { try SecureStore.delete(account: account) }
            throw ProviderError.unavailable
        }
        do {
            try SecureStore.delete(account: pendingAccount); pending.remove(provider)
        } catch { localError = "The saved setup attempt could not be cleared." }
    }
    private func recordConnection(_ provider: ProviderID, responses: [HTTPDiagnostic], error: Error?, campusSSO: CampusSSODiagnostic? = nil) {
        let report = ConnectionDiagnostics(provider: provider, result: ConnectionDiagnostics.result(error), responses: responses, campusSSO: campusSSO)
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
        guard !demo else { return } // UI fixtures must never remove real Keychain connections.
        guard !refreshing else { return }
        do { try SecureStore.delete(account: provider == .schoology ? "schoology" : "campus"); try SecureStore.delete(account: provider == .schoology ? "schoology-pending" : "campus-pending"); pending.remove(provider); connectionDetails[provider] = nil; connected.remove(provider); errors[provider] = nil; deadlines[provider] = nil; waitingProviders[provider] = nil
            // Clear history and scenarios when disconnecting to avoid leaving another account's data.
            let remaining = courses.flatMap(\.sources).filter { $0.source.provider != provider }
            try repository?.clearScenarios(); scenarios = [:]; mappings = [:]; try repository?.saveMappings(mappings); persist(Reconciler.reconcile(remaining))
            freshProviders.remove(provider)
            finishFreshPresentation()
        } catch { localError = "The connection could not be removed." }
    }
    func persist(_ updated: [Course]) {
        do { try repository?.save(updated); courses = updated; courseRevision += 1; selectedTerm = preferredTerm() }
        catch { localError = "Grades could not be saved on this device."; return }
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
    func addedAssignments(_ course: Course) -> [Assignment] { scenario(course).added.reversed().map { Assignment(id: $0.id, sources: [$0]) } }
    func saveScenario(_ supplied: Hypothesis, course: Course) { let scenario = supplied.normalized(for: course.calculationSource); do { try repository?.saveScenario(scenario, id: course.id); scenarios[course.id] = scenario } catch { localError = "What-If could not be saved." } }
}
