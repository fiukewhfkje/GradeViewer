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
    func testCampusPortalValidationAndCookieScope() throws {
        let portal = URL(string: "https://district.example.org/campus/portal/students/district.jsp")!
        let valid = HTTPCookie(properties: [.name:"session",.value:"fixture",.domain:"district.example.org",.path:"/campus",.secure:"TRUE"])!
        let sso = HTTPCookie(properties: [.name:"sso",.value:"fixture",.domain:"login.example.net",.path:"/",.secure:"TRUE"])!
        let session = try CampusSession(portal: portal, cookies: [valid,sso])
        XCTAssertEqual(session.base.absoluteString, "https://district.example.org/campus/"); XCTAssertEqual(session.cookies.count, 1); XCTAssertEqual(session.cookies[0].cookie?.value, "fixture")
        XCTAssertThrowsError(try CampusSession(portal: URL(string: "https://district.example.org/campus/portal/parents/district.jsp")!, cookies: []))
    }
    func testCampusModernStudentHomeUsesCampusBase() throws {
        let url = URL(string: "https://district.example.org/campus/nav-wrapper/student/portal/student/home?appName=district")!
        let session = try CampusSession(portal: url, cookies: [])
        XCTAssertEqual(session.base.absoluteString, "https://district.example.org/campus/")
        XCTAssertThrowsError(try CampusSession(portal: URL(string: "https://district.example.org/campus/nav-wrapper/parent/portal/student/home")!, cookies: []))
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
    func testWidgetFollowsSelectedTermAndCourseVisibility() throws {
        let repository = try GradeRepository(memory: true)
        var courses = Demo.courses()
        courses[1].sources[0].term.name = "Spring 2026"
        courses[2].hidden = true
        try repository.save(courses)
        let store = AppStore(repository: repository, demo: false, readCredentials: false)
        store.selectedTerm = "Fall 2026"; store.updateWidget()
        let root = try XCTUnwrap(FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WidgetCache.group))
        let url = root.appendingPathComponent("grades.json")
        defer { try? FileManager.default.removeItem(at: url) }
        var snapshot = try JSONDecoder().decode(WidgetSnapshot.self, from: Data(contentsOf: url))
        XCTAssertEqual(snapshot.courses.count, 4)
        store.selectedTerm = "Spring 2026"; store.updateWidget()
        snapshot = try JSONDecoder().decode(WidgetSnapshot.self, from: Data(contentsOf: url))
        XCTAssertEqual(snapshot.courses.map(\.id), [courses[1].id])
    }
    func testExplicitMappingsRoundTrip() throws {
        let repository = try GradeRepository(memory: true)
        try repository.saveMappings(["a":"b","b":"a"]); XCTAssertEqual(try repository.mappings()["a"], "b")
        try repository.saveMappings(["a":"c","c":"a"]); XCTAssertEqual(try repository.mappings()["a"], "c"); XCTAssertNil(try repository.mappings()["b"])
    }
    func testWidgetUsesAppGroupSummaryOnly() throws {
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WidgetCache.group) else { XCTFail("App group missing"); return }
        let url = root.appendingPathComponent("grades.json")
        defer { try? FileManager.default.removeItem(at: url) }
        try WidgetCache.write(courses: Demo.courses())
        let snapshot = try JSONDecoder().decode(WidgetSnapshot.self, from: Data(contentsOf: url))
        XCTAssertEqual(snapshot.courses.count, 6); XCTAssertEqual(snapshot.courses[0].grade.percent, 95.8)
    }
    func testKeychainRoundTripWithDisposableFixture() throws {
        let account = "test-" + UUID().uuidString
        defer { try? SecureStore.delete(account: account) }
        try SecureStore.save(SchoologyCredentials(key: "fixture", secret: "not-a-real-key"), account: account)
        let loaded = try SecureStore.load(SchoologyCredentials.self, account: account); XCTAssertEqual(loaded?.key, "fixture")
        try SecureStore.delete(account: account); XCTAssertNil(try SecureStore.load(SchoologyCredentials.self, account: account))
    }
}

private actor RefreshProbe {
    var calls: [ProviderID: Int] = [:]
    func fetch(_ provider: ProviderID) async throws -> [SourceCourse] {
        calls[provider, default: 0] += 1
        if provider == .infiniteCampus { try await Task.sleep(for: .milliseconds(300)); throw ProviderError.reconnect }
        var source = Demo.courses()[0].display
        source.source = Provenance(.schoology, "new-fixture")
        source.assignments[0].title = "Fresh fixture grade"
        return [source]
    }
}
extension RepositoryTests {
    func testOverlappingRefreshesJoinAndPublishFastProviderBeforeFailure() async throws {
        let repository = try GradeRepository(memory:true); let old = Demo.courses(); try repository.save(old)
        let probe = RefreshProbe()
        let store = AppStore(repository:repository, demo:false, readCredentials:false, fetch: { try await probe.fetch($0) })
        store.connected = [.schoology, .infiniteCampus]
        let first = Task { await store.refresh() }
        let second = Task { await store.refresh() }
        for _ in 0..<100 {
            if store.courses.flatMap(\.sources).contains(where: { $0.source.id == "new-fixture" }) { break }
            try await Task.sleep(for:.milliseconds(2))
        }
        XCTAssertTrue(store.refreshing)
        XCTAssertTrue(store.courses.flatMap(\.sources).contains { $0.source.id == "new-fixture" })
        await first.value; await second.value
        let calls = await probe.calls; XCTAssertEqual(calls[.schoology], 1); XCTAssertEqual(calls[.infiniteCampus], 1)
        XCTAssertFalse(store.refreshing)
        XCTAssertEqual(store.errors[.infiniteCampus], "Infinite Campus needs to be reconnected.")
        XCTAssertEqual(store.courses.flatMap(\.sources).filter { $0.source.provider == .infiniteCampus }.count, old.count)
        XCTAssertEqual(try repository.load().count, store.courses.count)
    }
    func testEveryForegroundAndActiveCadenceRefreshesAndCancellationStopsTimer() async throws {
        let probe = RefreshProbe()
        let store = AppStore(repository:try GradeRepository(memory:true), demo:false, readCredentials:false, fetch: { try await probe.fetch($0) })
        store.connected = [.schoology]
        await store.becameActive(); await store.becameActive()
        let foregroundCalls = await probe.calls; XCTAssertEqual(foregroundCalls[.schoology], 2)
        let timer = Task { await store.refreshWhileActive(interval:.milliseconds(10)) }
        for _ in 0..<100 {
            if await probe.calls[.schoology, default:0] >= 3 { break }
            try await Task.sleep(for:.milliseconds(2))
        }
        timer.cancel(); await timer.value
        let stopped = await probe.calls[.schoology]
        try await Task.sleep(for:.milliseconds(30))
        let after = await probe.calls[.schoology]; XCTAssertEqual(stopped, after); XCTAssertGreaterThanOrEqual(stopped ?? 0, 3)
    }
    func testSavedCampusCookiesReplaceRotatedAndExcludeExpiredOrSSO() throws {
        let valid = HTTPCookie(properties:[.name:"session", .value:"fixture-new", .domain:"district.example.org", .path:"/campus", .secure:"TRUE"])!
        let expired = HTTPCookie(properties:[.name:"old", .value:"fixture", .domain:"district.example.org", .path:"/", .expires:Date().addingTimeInterval(-86400)])!
        let sso = HTTPCookie(properties:[.name:"sso", .value:"fixture", .domain:"sso.example.net", .path:"/"])!
        var session = try CampusSession(portal:URL(string:"https://district.example.org/campus/portal/students/district.jsp")!, cookies:[])
        session.replaceCookies([valid, expired, sso])
        XCTAssertEqual(session.cookies.map(\.name), ["session"])
        let restored = try JSONDecoder().decode(CampusSession.self, from:JSONEncoder().encode(session))
        XCTAssertEqual(restored.cookies.first?.cookie?.value, "fixture-new")
        session.replaceCookies([]); XCTAssertTrue(session.cookies.isEmpty)
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
    func testSavedGradesRemainCoveredUntilEveryProviderIsFreshAndFailureRetainsCache() async throws {
        let repository = try GradeRepository(memory:true)
        try repository.save(Demo.courses())
        let probe = RefreshProbe()
        let store = AppStore(repository:repository,demo:false,readCredentials:false,fetch:{ provider in try await probe.fetch(provider) })
        store.connected = [.infiniteCampus,.schoology]
        XCTAssertTrue(store.needsFreshData, "Gate must exist before any startup task runs")
        let task = Task { await store.becameActive() }
        try await Task.sleep(for:.milliseconds(100))
        XCTAssertTrue(store.needsFreshData, "Fast provider cannot uncover stale authority from the slow provider")
        await task.value
        XCTAssertTrue(store.foregroundRefreshFailed); XCTAssertTrue(store.needsFreshData)
        XCTAssertTrue(store.courses.contains { $0.sources.contains { $0.source.provider == .infiniteCampus } })
        let success = AppStore(repository:repository,demo:false,readCredentials:false,fetch:{ _ in Demo.courses().flatMap(\.sources) })
        success.connected = [.infiniteCampus]
        await success.becameActive()
        XCTAssertFalse(success.needsFreshData)
        success.requireFreshData(); XCTAssertTrue(success.needsFreshData)
        await success.becameActive(); XCTAssertFalse(success.needsFreshData)
    }
}
