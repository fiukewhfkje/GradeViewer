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
