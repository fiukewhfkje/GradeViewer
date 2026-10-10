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
    #endif
    private let fetchOverride: (@Sendable (ProviderID) async throws -> [SourceCourse])?
    var presentationDate = Date()
    init(repository provided: GradeRepository? = nil, demo requested: Bool? = nil, readCredentials: Bool = true, fetch: (@Sendable (ProviderID) async throws -> [SourceCourse])? = nil) {
        fetchOverride = fetch
        let arguments = ProcessInfo.processInfo.arguments
        demo = requested ?? arguments.contains("--demo")
        do {
            repository = try provided ?? GradeRepository(memory: demo)
            courses = demo ? Demo.courses(longList: arguments.contains("--long-list")) : try repository!.load()
            if demo && arguments.contains("--single-history") { for i in courses.indices { courses[i].history = Array(courses[i].history.suffix(1)) } }
            if demo && arguments.contains("--multiple-terms"), courses.count > 1 {
                for i in courses.indices { courses[i].sources[0].term.start = Date().addingTimeInterval(-86_400); courses[i].sources[0].term.end = Date().addingTimeInterval(86_400) }
                courses[1].sources[0].term = Term(id: "future", name: "Future quarter", start: Date().addingTimeInterval(172_800), end: Date().addingTimeInterval(259_200))
            }
            if demo && arguments.contains("--curve-fixture"), !courses.isEmpty {
                courses[0].history = [GradeHistorySnapshot(date: Date(timeIntervalSince1970: 1_790_000_000), grade: OverallGrade(percent: 80), provider: .schoology), GradeHistorySnapshot(date: Date(timeIntervalSince1970: 1_790_172_800), grade: OverallGrade(percent: 100), provider: .schoology)]
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
            if demo && arguments.contains("--calculated-fixture"), !courses.isEmpty {
                var source = courses[0].display; source.grade = OverallGrade()
                courses[0] = Reconciler.reconcile([source], previous:[courses[0]])[0]
            }
            if demo && arguments.contains("--noop-scenario"), let course = courses.first, let assignment = course.calculationSource.assignments.first, let score = assignment.score.earned {
                var scenario = Hypothesis(); scenario.scores[assignment.id] = score; try repository?.saveScenario(scenario, id: course.id)
            }
            if demo && arguments.contains("--overview-fixture"), !courses.isEmpty {
                var source = courses[0].display
                source.assignments.append(SourceAssignment(source: Provenance(.schoology, "overview:extra"), title: "Recent extra credit", categoryID: source.categories[0].id, updated: source.assignments[0].updated!.addingTimeInterval(-3600), score: Score(earned:1, possible:1)))
                source.assignments.append(SourceAssignment(source: Provenance(.schoology, "overview:pending"), title: "Pending future assignment", categoryID: source.categories[0].id, due: Demo.now.addingTimeInterval(86400), score: Score(possible:100)))
                courses[0] = Reconciler.reconcile([source], previous:[courses[0]])[0]
            }
            if demo && arguments.contains("--untitled-fixture"), !courses.isEmpty {
                var source = courses[0].display; source.assignments[0].title = "Unit 2 Test"
                courses[0] = Reconciler.reconcile([source], previous:[courses[0]])[0]
            }
            if demo && arguments.contains("--freshness-fixture"), !courses.isEmpty {
                var source = courses[0].display
                for i in source.assignments.indices { source.assignments[i].updated = Date().addingTimeInterval(-3 * 86400) }
                source.assignments[0].updated = Date()
                courses[0] = Reconciler.reconcile([source], previous:[courses[0]])[0]
            }
            if arguments.contains("--empty") { courses = [] }
            if arguments.contains("--error") { errors[.schoology] = "Schoology could not refresh." }
            if demo && arguments.contains("--period-fixture") {
                courses = Reconciler.reconcile(Demo.periodSources(includeExam:arguments.contains("--exam-fixture")))
                if arguments.contains("--midyear-history-fixture") {
                    let sources = courses.map { course in
                        var source = course.display
                        source.fetched = ISO8601DateFormatter().date(from:"2027-01-03T00:00:00Z")!
                        source.grade = OverallGrade()
                        return source
                    }
                    courses = Reconciler.reconcile(sources)
                }
                for i in courses.indices { courses[i].order = GradingPeriods.descriptor(courses[i]).label == "Q1" ? 0 : i + 1 }
                courses.sort { $0.order < $1.order }
            }
            if demo && arguments.contains("--connected-settings-fixture") { connected = Set(ProviderID.allCases) }
            if !demo && readCredentials {
                try SecureStore.removeRetiredConnections()
                if try SecureStore.load(SchoologyCredentials.self, account: "schoology") != nil { connected.insert(.schoology) }
                if try SecureStore.load(SchoologyCredentials.self, account: "schoology-pending") != nil { pending.insert(.schoology) }
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
                GradingPeriods.descriptor(course).kind == .quarter ? 4 : 0
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
            let progression = GradeProgression.points(for: course, among: courses)
            let curve = GradeCurve(points: progression)
            let overview = AssignmentGrouping.overview(for:course)
            let dates = overview.compactMap { $0.display.updated }
            return ["method": source.method.rawValue, "provider": source.source.provider.rawValue,
                    "periodCount": GradingPeriods.related(to:course, among:courses).count,
                    "periodKinds": Dictionary(uniqueKeysWithValues: ["quarter", "semester", "exam", "year", "other"].map { kind in
                        (kind, GradingPeriods.related(to:course, among:courses).filter { GradingPeriods.descriptor($0).kind.rawValue == kind }.count)
                    }),
                    "hasSemester": GradingPeriods.semester(for:course, among:courses) != nil,
                    "overviewGradedRows": AssignmentGrouping.overview(for: course).count,
                    "overviewSorted": zip(dates,dates.dropFirst()).allSatisfy { $0 >= $1 },
                    "overviewUnique": Set(overview.map(\.id)).count == overview.count,
                    "untitledOverviewRows": overview.filter { !$0.display.hasTitle }.count,
                    "homeMatchesOverviewDate": updated(course) == overview.compactMap { $0.display.updated }.max(),
                    "latestCalculatedMatchesReported": generated.last?.grade.percent.map { abs($0 - (source.grade.percent ?? $0)) < 0.000000001 } ?? true,
                    "assignments": source.assignments.count, "reliableBaseline": GradeCalculator.isReliable(source),
                    "calculatedPoints": generated.count, "observedPoints": course.history.count,
                    "yearGraphPoints": curve.nodes.count,
                    "yearGraphMatchesCurrent": curve.nodes.last.map { abs($0.value - (source.grade.percent ?? $0.value)) < 0.000000001 } ?? false,
                    "hasUpdateDate": updated(course) != nil,
                    "categoryCount": source.categories.count,
                    "hasNumericTotal": source.grade.percent != nil, "calculatedTotal": source.hasCalculatedGrade]
        }
        let payload: [String: Any] = ["phase": phase, "schoologyConnected": connected.contains(.schoology),
                                     "pendingConnections": pending.count,
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
        return AssignmentGrouping.updated(for: course)
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
        // the coalesced refresh return and resume from the active timer.
        let providers = ProviderID.allCases.filter { connected.contains($0) && (deadlines[$0]?.timeIntervalSinceNow ?? 0) <= 30 }
        for provider in connected where (deadlines[provider]?.timeIntervalSinceNow ?? 0) > 0 {
            errors[provider] = nil; waitingProviders[provider] = deadlines[provider]
        }
        if let provider = providers.first {
            do {
                let fetched = try await fetchAfterCooldown(provider, refreshMetadata: refreshMetadata)
                waitingProviders[provider] = nil
                if await applySnapshot(fetched.courses, provider: provider) {
                    errors[provider] = nil; deadlines[provider] = fetched.retryAfter; freshProviders.insert(provider)
                } else { errors[provider] = "Fresh grades could not be saved on this device." }
            } catch {
                if case let ProviderError.throttled(seconds) = error {
                    deadlines[provider] = Date().addingTimeInterval(max(1, seconds))
                    waitingProviders[provider] = deadlines[provider]; errors[provider] = nil
                } else { waitingProviders[provider] = nil; errors[provider] = message(error, provider: provider) }
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
        guard var credentials = try SecureStore.load(SchoologyCredentials.self, account: "schoology") else { throw ProviderError.reconnect }
        var verify = false
        #if DEBUG
        verify = ProcessInfo.processInfo.arguments.contains("--verify-layout") || ProcessInfo.processInfo.arguments.contains("--profile-refresh")
        #endif
        let schoology = try SchoologyProvider(credentials: credentials, diagnosticsEnabled: verify)
        do {
            var previous = courses.flatMap(\.sources)
            #if DEBUG
            let firstConnection = ProcessInfo.processInfo.arguments.contains("--verify-first-connection")
            if firstConnection { previous = [] }
            #endif
            let result = try await schoology.fetchSnapshot(previous: previous, refreshMetadata: refreshMetadata)
            #if DEBUG
            if firstConnection { verifyFirstConnection(result.courses, startedAt: startedAt) }
            #endif
            if credentials.userID != result.userID {
                credentials.userID = result.userID; try SecureStore.save(credentials, account: "schoology")
            }
            if verify { ConnectionDiagnostics(provider: .schoology, result: "success", responses: await schoology.diagnostics()).save() }
            return (result.courses, result.retryAfter)
        } catch {
            if verify { ConnectionDiagnostics(provider: .schoology, result: ConnectionDiagnostics.result(error), responses: await schoology.diagnostics()).save() }
            throw error
        }
    }
    #if DEBUG
    /// Explicit read-only network check with no previous sources/metadata. It
    /// never clears saved data; normal reconciliation still preserves history.
    private func verifyFirstConnection(_ fetched: [SourceCourse], startedAt: Date) {
        let fresh = Reconciler.reconcile(fetched)
        let visible = CourseSelection.visible(fresh, term: selectedTerm)
        let rows = fetched.flatMap(\.assignments).filter { $0.score.isGraded }
        let dates = rows.compactMap { $0.updated ?? $0.due }
        let curves = visible.map { GradeCurve(points:GradeProgression.points(for:$0, among:fresh)) }
        let report: [String:Any] = ["previousSources":0, "courses":fresh.count,
            "gradedRows":rows.count, "datedGradedRows":dates.count,
            "rowsPredatingConnection":dates.filter { $0 < startedAt }.count,
            "rowsOlderThanThirtyDays":dates.filter { startedAt.timeIntervalSince($0) > 30 * 86400 }.count,
            "homeCards":visible.count, "numericTotals":visible.filter { $0.display.grade.percent != nil }.count,
            "graphPoints":curves.map { $0.nodes.count },
            "allGraphsHaveEarlierData":curves.allSatisfy { $0.nodes.contains { $0.date < startedAt.addingTimeInterval(-86400) } },
            "graphEndpointsMatchCurrent":zip(visible,curves).allSatisfy { $0.display.grade.percent == $1.nodes.last?.value }]
        if let data = try? JSONSerialization.data(withJSONObject:report, options:[.prettyPrinted,.sortedKeys]),
           let root = FileManager.default.urls(for:.cachesDirectory, in:.userDomainMask).first {
            try? data.write(to:root.appendingPathComponent("first-connection-verification.json"), options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
        }
    }
    #endif
    @discardableResult private func applySnapshot(_ fetched: [SourceCourse], provider: ProviderID) async -> Bool {
        // Rebase if a local visibility/order edit occurred while the
        // worker was running. Background normalization must never undo that edit.
        while connected.contains(provider) {
            let previous = courses, revision = courseRevision
            do {
                #if DEBUG
                let workerStarted = Date()
                #endif
                let (updated, payloads) = try await Task.detached(priority: .userInitiated) {
                    let updated = Reconciler.refreshing(previous: previous, successful: [provider: fetched])
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
    private func recordConnection(_ provider: ProviderID, responses: [HTTPDiagnostic], error: Error?) {
        let report = ConnectionDiagnostics(provider: provider, result: ConnectionDiagnostics.result(error), responses: responses)
        report.save(); connectionDetails[provider] = error == nil ? nil : report.summary
    }
    func retryConnection(_ provider: ProviderID) async throws {
        guard let saved = try SecureStore.load(SchoologyCredentials.self, account: "schoology-pending") else { throw ProviderError.reconnect }
        try await connectSchoology(saved)
    }
    func forgetPending(_ provider: ProviderID) {
        do {
            try SecureStore.delete(account: "schoology-pending")
            pending.remove(provider); connectionDetails[provider] = nil
        } catch { localError = "The saved connection could not be removed." }
    }
    func disconnect(_ provider: ProviderID) {
        guard !demo else { return } // UI fixtures must never remove real Keychain connections.
        guard !refreshing else { return }
        do { try SecureStore.delete(account: "schoology"); try SecureStore.delete(account: "schoology-pending"); pending.remove(provider); connectionDetails[provider] = nil; connected.remove(provider); errors[provider] = nil; deadlines[provider] = nil; waitingProviders[provider] = nil
            // Clear history and scenarios when disconnecting to avoid leaving another account's data.
            let remaining = courses.flatMap(\.sources).filter { $0.source.provider != provider }
            try repository?.clearScenarios(); scenarios = [:]; persist(Reconciler.reconcile(remaining))
            freshProviders.remove(provider)
            finishFreshPresentation()
        } catch { localError = "The connection could not be removed." }
    }
    func persist(_ updated: [Course]) {
        do { try repository?.save(updated); courses = updated; courseRevision += 1; selectedTerm = preferredTerm() }
        catch { localError = "Grades could not be saved on this device."; return }
    }
    func setHidden(_ id: String, hidden: Bool) { var updated = courses; if let i = updated.firstIndex(where: { $0.id == id }) { updated[i].hidden = hidden }; persist(updated) }
    func move(from: IndexSet, to: Int) { var ordered = courses.sorted { $0.order < $1.order }; ordered.move(fromOffsets: from, toOffset: to); for i in ordered.indices { ordered[i].order = i }; persist(ordered) }
    func scenario(_ course: Course) -> Hypothesis { (scenarios[course.id] ?? Hypothesis()).normalized(for: course.calculationSource) }
    func addedAssignments(_ course: Course) -> [Assignment] { scenario(course).added.reversed().map { Assignment(id: $0.id, sources: [$0]) } }
    func saveScenario(_ supplied: Hypothesis, course: Course) { let scenario = supplied.normalized(for: course.calculationSource); do { try repository?.saveScenario(scenario, id: course.id); scenarios[course.id] = scenario } catch { localError = "What-If could not be saved." } }
}
