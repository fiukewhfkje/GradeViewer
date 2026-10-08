import XCTest
import SwiftData
import GradeCore
@testable import GradeViewer
@MainActor final class RepositoryTests: XCTestCase {
    func testOfflineStartupReadsCacheBeforeNetwork() throws {
        let repository = try GradeRepository(memory: true); let courses = Demo.courses(); try repository.save(courses)
        let store = AppStore(repository: repository, demo: false, readCredentials: false)
        XCTAssertEqual(store.courses.count, 6); XCTAssertEqual(store.visibleCourses.first?.display.grade.percent, 95.8); XCTAssertFalse(store.refreshing)
    }
    func testDifferentialSaveAndSuccessfulRemoval() throws {
        let repository = try GradeRepository(memory: true); let courses = Demo.courses(); try repository.save(courses); try repository.save(courses)
        XCTAssertEqual(try repository.container.mainContext.fetch(FetchDescriptor<CourseRecord>()).count, 6)
        try repository.save(Array(courses.prefix(2))); XCTAssertEqual(try repository.load().count, 2)
        let context = ModelContext(repository.container); let records = try context.fetch(FetchDescriptor<CourseRecord>())
        XCTAssertEqual(records.count, 2); XCTAssertEqual(try JSONDecoder().decode(Course.self, from: records[0].payload).history.count, 9)
    }
    func testScenarioRoundTripWithoutChangingGrades() throws {
        let repository = try GradeRepository(memory: true); let courses = Demo.courses(); try repository.save(courses)
        var h = Hypothesis(); let id = courses[0].calculationSource.assignments[0].id; h.scores[id] = 100; h.ignored.insert(id)
        try repository.saveScenario(h, id: courses[0].id); let restored = try repository.scenario(courses[0].id)
        XCTAssertEqual(restored.scores[id], 100); XCTAssertTrue(restored.ignored.contains(id)); XCTAssertEqual(try repository.load()[0].display.grade.percent, 95.8)
    }
    func testGradeEditorStartsWithValidUnroundedLargeScore() throws {
        let assignment = Demo.courses()[0].calculationSource.assignments[0]
        for value in [1234.56789, -12.5, 105.0, 0.0] {
            let editor = EditScoreView(assignment: assignment, value: value, save: { _ in })
            XCTAssertEqual(editor.number, value, "Editable scores must round trip without display grouping or rounding.")
        }
    }
    func testSignedScenarioPersistsAndLeavesActualGradesIntact() throws {
        let repository = try GradeRepository(memory: true)
        let course = Demo.courses()[0]; try repository.save([course])
        let store = AppStore(repository: repository, demo: false, readCredentials: false)
        let id = course.calculationSource.assignments[0].id
        for earned in [-12.5, 105.0] {
            var h = Hypothesis(); h.scores[id] = earned
            store.saveScenario(h, course: course)
            let restored = AppStore(repository: repository, demo: false, readCredentials: false)
            XCTAssertEqual(restored.scenario(course).scores[id], earned)
            XCTAssertNotNil(try? GradeCalculator.hypotheticalPercent(course: course.calculationSource, hypothesis: restored.scenario(course)))
            XCTAssertEqual(restored.courses[0].display.grade, course.display.grade)
            XCTAssertEqual(restored.courses[0].history, course.history)
            XCTAssertEqual(restored.courses[0].calculationSource.assignments, course.calculationSource.assignments)
        }
    }
    func testAddedGradesRestoreEditAndRemoveWithoutChangingProviderData() throws {
        let repository = try GradeRepository(memory: true)
        let course = Demo.courses()[0]; try repository.save([course])
        let store = AppStore(repository: repository, demo: false, readCredentials: false)
        let added = SourceAssignment(source: Provenance(course.calculationSource.source.provider, "hypothetical:fixture"), title: "Extra quiz", score: Score(earned: 150.5, possible: 100))
        var h = Hypothesis(); h.added = [added]; h.scores[added.id] = 120.5
        store.saveScenario(h, course: course)
        let restored = AppStore(repository: repository, demo: false, readCredentials: false)
        XCTAssertEqual(restored.addedAssignments(course).map(\.id), [added.id])
        XCTAssertEqual(restored.scenario(course).scores[added.id], 120.5)
        XCTAssertEqual(try GradeCalculator.hypotheticalPercent(course: course.calculationSource, hypothesis: restored.scenario(course)), (95.8 * 12 + 120.5) / 13, accuracy: 0.000001)
        h.added = []; restored.saveScenario(h, course: course)
        XCTAssertTrue(restored.addedAssignments(course).isEmpty)
        XCTAssertTrue(try repository.scenario(course.id).scores.isEmpty)
        XCTAssertEqual(try repository.load()[0].calculationSource.assignments, course.calculationSource.assignments)
        XCTAssertEqual(try repository.load()[0].history, course.history)
    }

    func testConnectionReportNeverIncludesUnderlyingErrorText() throws {
        let underlying = NSError(domain: NSURLErrorDomain, code: URLError.timedOut.rawValue, userInfo: [NSLocalizedDescriptionKey: "PRIVATE_URL_AND_TOKEN"])
        let report = ConnectionDiagnostics(provider: .schoology, result: ConnectionDiagnostics.result(underlying), responses: [])
        let encoded = String(decoding: try JSONEncoder().encode(report), as: UTF8.self)
        XCTAssertFalse(encoded.contains("PRIVATE_URL_AND_TOKEN")); XCTAssertTrue(encoded.contains("network error"))
        XCTAssertEqual(ConnectionDiagnostics.result(ProviderError.malformed), "unexpected JSON structure")
    }
    func testInitialTermChoosesCurrentRatherThanFutureQuarter() throws {
        let repository = try GradeRepository(memory: true)
        var courses = Array(Demo.courses().prefix(2))
        courses[0].sources[0].term = Term(id: "current", name: "Current quarter", start: Date().addingTimeInterval(-86_400), end: Date().addingTimeInterval(86_400))
        courses[1].sources[0].term = Term(id: "future", name: "Future quarter", start: Date().addingTimeInterval(172_800), end: Date().addingTimeInterval(259_200))
        try repository.save(courses)
        let store = AppStore(repository: repository, demo: false, readCredentials: false)
        XCTAssertEqual(store.terms.first, "Future quarter")
        XCTAssertEqual(store.selectedTerm, "Current quarter")
        XCTAssertEqual(store.visibleCourses.count, 1)
    }
}

extension RepositoryTests {

    func testFailedConnectionCommitRetainsActiveCredentialsGradesAndPendingAttempt() async throws {
        let active = "test-active-" + UUID().uuidString, pending = "test-pending-" + UUID().uuidString
        defer { try? SecureStore.delete(account: active); try? SecureStore.delete(account: pending) }
        let old = SchoologyCredentials(key:"old-fixture", secret:"old-fixture-secret")
        let new = SchoologyCredentials(key:"new-fixture", secret:"new-fixture-secret")
        try SecureStore.save(old, account:active); try SecureStore.save(new, account:pending)
        let repository = try GradeRepository(memory:true)
        let courses = Demo.courses(); try repository.save(courses)
        let store = AppStore(repository:repository, demo:false, readCredentials:false)
        store.connected = [.schoology]; store.pending = [.schoology]
        var invalid = courses[0].display; invalid.source.provider = .schoology; invalid.grade.percent = .nan
        do { try await store.activateConnection(new, account:active, pendingAccount:pending, provider:.schoology, fetched:[invalid]); XCTFail("Invalid snapshot must not commit") }
        catch { XCTAssertEqual(error as? ProviderError, .unavailable) }
        XCTAssertEqual(try SecureStore.load(SchoologyCredentials.self, account:active)?.key, old.key)
        XCTAssertEqual(try SecureStore.load(SchoologyCredentials.self, account:pending)?.key, new.key)
        XCTAssertEqual(store.courses.count, courses.count); XCTAssertEqual(try repository.load().count, courses.count)
        XCTAssertTrue(store.connected.contains(.schoology)); XCTAssertTrue(store.pending.contains(.schoology))
    }
    func testFailedInitialConnectionCommitDoesNotLeaveActiveCredential() async throws {
        let active = "test-active-" + UUID().uuidString, pending = "test-pending-" + UUID().uuidString
        defer { try? SecureStore.delete(account: active); try? SecureStore.delete(account: pending) }
        let value = SchoologyCredentials(key:"fixture", secret:"fixture-secret")
        try SecureStore.save(value, account:pending)
        let store = AppStore(repository:try GradeRepository(memory:true), demo:false, readCredentials:false)
        var invalid = Demo.courses()[0].display; invalid.source.provider = .schoology; invalid.grade.percent = .nan
        do { try await store.activateConnection(value, account:active, pendingAccount:pending, provider:.schoology, fetched:[invalid]); XCTFail("Invalid snapshot must not commit") }
        catch { XCTAssertEqual(error as? ProviderError, .unavailable) }
        XCTAssertNil(try SecureStore.load(SchoologyCredentials.self, account:active))
        XCTAssertFalse(store.connected.contains(.schoology)); XCTAssertTrue(store.courses.isEmpty)
        XCTAssertNotNil(try SecureStore.load(SchoologyCredentials.self, account:pending))
    }

    func testKeychainRoundTripWithDisposableFixture() throws {
        let account = "test-" + UUID().uuidString
        defer { try? SecureStore.delete(account: account) }
        try SecureStore.save(SchoologyCredentials(key: "fixture", secret: "not-a-real-key"), account: account)
        let loaded = try SecureStore.load(SchoologyCredentials.self, account: account); XCTAssertEqual(loaded?.key, "fixture")
        try SecureStore.delete(account: account); XCTAssertNil(try SecureStore.load(SchoologyCredentials.self, account: account))
    }
    func testSchoologyVerifiedIdentityPersistsWithOnlyItsCredentialSet() throws {
        let legacy = Data("{\"key\":\"fixture\",\"secret\":\"fixture-secret\",\"token\":\"\",\"tokenSecret\":\"\"}".utf8)
        XCTAssertNil(try JSONDecoder().decode(SchoologyCredentials.self, from: legacy).userID)
        let account = "test-identity-" + UUID().uuidString
        defer { try? SecureStore.delete(account: account) }
        var credentials = SchoologyCredentials(key: "fixture", secret: "fixture-secret")
        credentials.userID = "fixture-verified-user"
        try SecureStore.save(credentials, account: account)
        XCTAssertEqual(try SecureStore.load(SchoologyCredentials.self, account: account)?.userID, "fixture-verified-user")
        try SecureStore.save(SchoologyCredentials(key: "replacement", secret: "replacement-secret"), account: account)
        XCTAssertNil(try SecureStore.load(SchoologyCredentials.self, account: account)?.userID)
    }
}

private actor RefreshProbe {
    var calls: [ProviderID: Int] = [:]
    func fetch(_ provider: ProviderID) async throws -> [SourceCourse] {
        calls[provider, default: 0] += 1
        try await Task.sleep(for: .milliseconds(80))
        var source = Demo.courses()[0].display
        source.source = Provenance(.schoology, "new-fixture")
        source.assignments[0].title = "Fresh fixture grade"
        return [source]
    }
}

extension RepositoryTests {
    func testOverlappingSchoologyRefreshesShareOneReadAndOpenFreshGate() async throws {
        let repository = try GradeRepository(memory: true); try repository.save(Demo.courses())
        let probe = RefreshProbe()
        let store = AppStore(repository: repository, demo: false, readCredentials: false, fetch: { try await probe.fetch($0) })
        store.connected = [.schoology]
        let first = Task { await store.refresh() }; let second = Task { await store.refresh() }
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertTrue(store.needsFreshData); XCTAssertTrue(store.refreshing)
        await first.value; await second.value
        let calls = await probe.calls; XCTAssertEqual(calls, [.schoology: 1])
        XCTAssertFalse(store.needsFreshData); XCTAssertFalse(store.refreshing); XCTAssertTrue(store.errors.isEmpty)
        XCTAssertEqual(store.courses.count, 1); XCTAssertEqual(try repository.load().count, 1)
    }
    func testSchoologyFailureRetainsCacheAndLaterSuccessOpensGate() async throws {
        let repository = try GradeRepository(memory: true); let courses = Demo.courses(); try repository.save(courses)
        let fetches = SchoologyNetworkFixture(courses: courses.map(\.display))
        let store = AppStore(repository: repository, demo: false, readCredentials: false, fetch: { try await fetches.fetch($0) })
        store.connected = [.schoology]
        await store.activateScene()
        XCTAssertTrue(store.foregroundRefreshFailed); XCTAssertTrue(store.needsFreshData)
        XCTAssertNotNil(store.errors[.schoology]); XCTAssertEqual(store.courses.count, courses.count)
        XCTAssertEqual(try repository.load().map(\.id), courses.map(\.id))
        await store.refresh()
        XCTAssertNil(store.errors[.schoology]); XCTAssertFalse(store.needsFreshData)
        XCTAssertEqual(store.connected, [.schoology])
    }
    private func legacyPayload(_ course: Course) throws -> Data {
        var raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(course)) as! [String: Any]
        let source = (raw["sources"] as! [[String: Any]])[0]
        var retired = source, provenance = source["source"] as! [String: Any]
        provenance["provider"] = "infiniteCampus"; retired["source"] = provenance
        raw["sources"] = [retired, source]
        return try JSONSerialization.data(withJSONObject: raw)
    }
    func testOldStoreUpgradesOnceWithSameIdentityAndHistory() throws {
        let repository = try GradeRepository(memory: true), context = repository.container.mainContext
        let original = Demo.courses()[0]
        context.insert(CourseRecord(id: original.id, payload: try legacyPayload(original)))
        context.insert(MappingRecord(source: "old", target: "mapping")); try context.save()
        let upgraded = try repository.load()
        XCTAssertEqual(upgraded.map(\.id), [original.id]); XCTAssertEqual(upgraded[0].history, original.history)
        XCTAssertEqual(upgraded[0].sources.count, 1); XCTAssertEqual(upgraded[0].display.assignments, original.display.assignments)
        XCTAssertTrue(try context.fetch(FetchDescriptor<MappingRecord>()).isEmpty)
        let bytes = try context.fetch(FetchDescriptor<CourseRecord>())[0].payload
        _ = try repository.load()
        XCTAssertEqual(try context.fetch(FetchDescriptor<CourseRecord>())[0].payload, bytes)
    }
    func testMalformedOldScenarioCannotPartiallyUpgradeStore() throws {
        let repository = try GradeRepository(memory: true), context = repository.container.mainContext
        let course = Demo.courses()[0], payload = try legacyPayload(course), id = course.id
        context.insert(CourseRecord(id: id, payload: payload)); context.insert(ScenarioRecord(id: id, payload: Data("[]".utf8)))
        context.insert(MappingRecord(source: "old", target: "mapping")); try context.save()
        XCTAssertThrowsError(try repository.load())
        XCTAssertEqual(try context.fetch(FetchDescriptor<CourseRecord>())[0].payload, payload)
        XCTAssertEqual(try context.fetch(FetchDescriptor<MappingRecord>()).count, 1)
    }
}
private actor RateLimitProbe {
    var requests: [Date] = []
    func fetch(_ provider: ProviderID) throws -> [SourceCourse] {
        requests.append(Date())
        if requests.count == 1 { throw ProviderError.throttled(0) }
        var source = Demo.courses()[0].display
        source.source = Provenance(provider, "cooldown-fixture")
        return [source]
    }
}
extension RepositoryTests {

    func testAutomaticRefreshOnLaunchAndReturnIgnoresTemporaryInactivity() async throws {
        let probe = RefreshProbe()
        let store = AppStore(repository:try GradeRepository(memory:true), demo:false, readCredentials:false, fetch: { try await probe.fetch($0) })
        store.connected = [.schoology]
        await store.activateScene()
        let initial = await probe.calls; XCTAssertEqual(initial[.schoology], 1)
        XCTAssertFalse(store.needsFreshData)
        store.sceneChanged(.inactive)
        await store.activateScene()
        let switcher = await probe.calls; XCTAssertEqual(switcher[.schoology], 1)
        XCTAssertFalse(store.needsFreshData)
        store.sceneChanged(.background)
        XCTAssertTrue(store.needsFreshData)
        let leaving = await probe.calls; XCTAssertEqual(leaving[.schoology], 1, "Leaving cannot start requests")
        await store.activateScene()
        let returned = await probe.calls; XCTAssertEqual(returned[.schoology], 2)
        XCTAssertFalse(store.needsFreshData)
        await store.refresh()
        let manual = await probe.calls; XCTAssertEqual(manual[.schoology], 3)
    }
    func testActiveRefreshCadenceRemainsAndCancellationStopsRequests() async throws {
        let probe = RefreshProbe()
        let store = AppStore(repository: try GradeRepository(memory: true), demo: false, readCredentials: false, fetch: { try await probe.fetch($0) })
        store.connected = [.schoology]
        let timer = Task { await store.refreshWhileActive(interval: .milliseconds(10)) }
        for _ in 0..<100 {
            if await probe.calls[.schoology, default: 0] >= 2 { break }
            try await Task.sleep(for: .milliseconds(2))
        }
        timer.cancel(); await timer.value
        let stopped = await probe.calls[.schoology]
        try await Task.sleep(for: .milliseconds(30))
        let after = await probe.calls[.schoology]
        XCTAssertGreaterThanOrEqual(stopped ?? 0, 2); XCTAssertEqual(stopped, after)
    }
    func testForegroundDuringLongProviderCooldownWaitsWithoutFailureOrEarlyRequests() async throws {
        let probe = RefreshProbe()
        let repository = try GradeRepository(memory: true)
        var source = Demo.courses()[0].display; source.source.provider = .schoology
        source.source.fields["provider_retry_after"] = String(Date().addingTimeInterval(600).timeIntervalSince1970)
        try repository.save(Reconciler.reconcile([source]))
        let store = AppStore(repository: repository, demo: false, readCredentials: false, fetch: { try await probe.fetch($0) })
        store.connected = [.schoology]
        await store.activateScene()
        XCTAssertTrue(store.needsFreshData)
        XCTAssertFalse(store.foregroundRefreshFailed)
        XCTAssertNil(store.errors[.schoology])
        XCTAssertEqual(store.waitingProviders[.schoology], store.deadlines[.schoology])
        let calls = await probe.calls
        XCTAssertEqual(calls[.schoology, default: 0], 0)
    }
    func testRestoredShortCooldownResumesTheSameForegroundRefresh() async throws {
        let probe = RefreshProbe()
        let repository = try GradeRepository(memory: true)
        var source = Demo.courses()[0].display; source.source.provider = .schoology
        let until = Date().addingTimeInterval(0.3)
        source.source.fields["provider_retry_after"] = String(until.timeIntervalSince1970)
        try repository.save(Reconciler.reconcile([source]))
        let store = AppStore(repository: repository, demo: false, readCredentials: false, fetch: { try await probe.fetch($0) })
        store.connected = [.schoology]
        let refresh = Task { await store.activateScene() }
        try await Task.sleep(for: .milliseconds(30))
        let earlyCalls = await probe.calls
        XCTAssertEqual(earlyCalls[.schoology, default: 0], 0)
        XCTAssertTrue(store.refreshing); XCTAssertTrue(store.needsFreshData)
        XCTAssertFalse(store.foregroundRefreshFailed); XCTAssertNil(store.errors[.schoology])
        await refresh.value
        XCTAssertGreaterThanOrEqual(Date(), until)
        let calls = await probe.calls
        XCTAssertEqual(calls[.schoology], 1)
        XCTAssertFalse(store.needsFreshData); XCTAssertFalse(store.foregroundRefreshFailed)
        XCTAssertNil(store.waitingProviders[.schoology]); XCTAssertNil(store.errors[.schoology])
    }
    func testActiveTimerNoticesManualThrottleAndRetriesAtItsDeadline() async throws {
        let probe = RateLimitProbe()
        let store = AppStore(repository: try GradeRepository(memory: true), demo: false, readCredentials: false, fetch: { try await probe.fetch($0) })
        store.connected = [.schoology]; store.requireFreshData()
        let timer = Task { await store.refreshWhileActive(interval: .seconds(30)) }
        await Task.yield()
        await store.refresh()
        XCTAssertTrue(store.needsFreshData); XCTAssertFalse(store.foregroundRefreshFailed)
        XCTAssertNil(store.errors[.schoology]); XCTAssertNotNil(store.waitingProviders[.schoology])
        for _ in 0..<200 {
            if !store.needsFreshData { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        timer.cancel(); await timer.value
        let requests = await probe.requests
        XCTAssertEqual(requests.count, 2, "Retry must resume before the ordinary 30-second timer")
        if requests.count == 2 { XCTAssertGreaterThanOrEqual(requests[1].timeIntervalSince(requests[0]), 1) }
        XCTAssertFalse(store.needsFreshData); XCTAssertFalse(store.foregroundRefreshFailed)
        XCTAssertNil(store.waitingProviders[.schoology]); XCTAssertNil(store.errors[.schoology])
    }

}

extension RepositoryTests {



    func testCurrentQuarterWinsOverContainingSemesterAndExamTasks() throws {
        let repository = try GradeRepository(memory:true)
        try repository.save(Reconciler.reconcile(Demo.periodSources()))
        let store = AppStore(repository:repository,demo:false,readCredentials:false)
        XCTAssertEqual(store.preferredTerm(at:Date(timeIntervalSince1970:1_790_719_200)), "Q1")
        store.selectedTerm = "Q2"
        XCTAssertEqual(store.visibleCourses.count, 1)
        XCTAssertEqual(GradingPeriods.descriptor(store.visibleCourses[0]).kind, .quarter)
        let reloaded = try repository.load()
        XCTAssertEqual(reloaded.count, 8)
        XCTAssertEqual(reloaded.filter { GradingPeriods.descriptor($0).kind == .semester }.count, 2)
    }
}

extension RepositoryTests {
    func testSnapshotEncodingFailureCannotUncoverCachedGrades() async throws {
        let repository = try GradeRepository(memory: true); let old = Demo.courses(); try repository.save(old)
        var invalid = old[0].display; invalid.grade.percent = .nan
        let fetched = [invalid]
        let store = AppStore(repository: repository, demo: false, readCredentials: false, fetch: { _ in fetched })
        store.connected = [.schoology]
        await store.refresh()
        XCTAssertTrue(store.needsFreshData); XCTAssertTrue(store.foregroundRefreshFailed)
        XCTAssertNotNil(store.localError); XCTAssertNotNil(store.errors[.schoology])
        XCTAssertEqual(store.courses[0].display.grade, old[0].display.grade)
        XCTAssertEqual(try repository.load()[0].display.grade, old[0].display.grade)
    }
    func testLargeRefreshKeepsMainActorResponsiveAndPreservesLocalEdits() async throws {
        let old = Demo.courses(longList: true)
        let fetched = old.flatMap(\.sources).map { original in
            var source = original
            source.fetched = Date(); source.assignments[0].title = "Fresh large fixture"
            return source
        }
        let repository = try GradeRepository(memory: true); try repository.save(old)
        let store = AppStore(repository: repository, demo: false, readCredentials: false, fetch: { _ in fetched })
        store.connected = [.schoology]
        let refresh = Task { await store.refresh() }
        // Yield until the worker starts, then change local presentation while its
        // normalization/encoding is in flight. A revision mismatch must rebase.
        await Task.yield()
        store.setHidden(old[0].id, hidden: true)
        var ticks = 0
        while store.refreshing {
            ticks += 1
            try await Task.sleep(for: .milliseconds(2))
        }
        await refresh.value
        XCTAssertGreaterThan(ticks, 1, "Main actor must continue servicing work during a large snapshot")
        XCTAssertTrue(try XCTUnwrap(store.courses.first { $0.id == old[0].id }).hidden)
        XCTAssertEqual(store.courses[0].calculationSource.assignments[0].title, "Fresh large fixture")
        XCTAssertEqual(try repository.load().map(\.hidden), store.courses.map(\.hidden))
        XCTAssertFalse(store.refreshing)
    }

}


private actor SchoologyNetworkFixture {
    let courses: [SourceCourse]
    var failed = false
    init(courses: [SourceCourse]) { self.courses = courses }
    func fetch(_ provider: ProviderID) throws -> [SourceCourse] {
        if !failed { failed = true; throw URLError(.secureConnectionFailed) }
        return courses
    }
}
