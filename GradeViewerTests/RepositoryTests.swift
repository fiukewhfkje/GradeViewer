import XCTest
import SwiftData
import GradeCore
import WebKit
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
    func testExplicitMappingsRoundTrip() throws {
        let repository = try GradeRepository(memory: true)
        try repository.saveMappings(["a":"b","b":"a"]); XCTAssertEqual(try repository.mappings()["a"], "b")
        try repository.saveMappings(["a":"c","c":"a"]); XCTAssertEqual(try repository.mappings()["a"], "c"); XCTAssertNil(try repository.mappings()["b"])
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
    func testForegroundDuringProviderCooldownExplainsWaitWithoutSendingRequests() async throws {
        let probe = RefreshProbe()
        let repository = try GradeRepository(memory: true)
        var source = Demo.courses()[0].display; source.source.provider = .schoology
        source.source.fields["provider_retry_after"] = String(Date().addingTimeInterval(600).timeIntervalSince1970)
        try repository.save(Reconciler.reconcile([source]))
        let store = AppStore(repository: repository, demo: false, readCredentials: false, fetch: { try await probe.fetch($0) })
        store.connected = [.schoology]
        await store.activateScene()
        XCTAssertTrue(store.needsFreshData)
        XCTAssertTrue(store.foregroundRefreshFailed)
        XCTAssertEqual(store.errors[.schoology], "Schoology asked to wait before refreshing.")
        let calls = await probe.calls
        XCTAssertEqual(calls[.schoology, default: 0], 0)
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
    func testImportedCampusSessionSurvivesKeychainRoundTripWithAllRequestCookies() throws {
        let portal = URL(string: "https://district.example.org/campus/portal/students/district.jsp")!
        var session = try CampusSession(portal: portal, cookies: [])
        session.replaceCookies(try CampusCookieHeader.parse("session=fixture==; route=fixture-node", origin: session.base))
        let account = "test-campus-session-" + UUID().uuidString
        defer { try? SecureStore.delete(account: account) }
        try SecureStore.save(session, account: account)
        let restored = try XCTUnwrap(SecureStore.load(CampusSession.self, account: account))
        XCTAssertEqual(restored.base, session.base); XCTAssertEqual(restored.portal, portal)
        XCTAssertEqual(restored.cookies.compactMap(\.cookie).map(\.value), ["fixture==", "fixture-node"])
        XCTAssertTrue(restored.cookies.compactMap(\.cookie).allSatisfy { $0.isSecure && $0.expiresDate == nil })
    }
    func testCampusCookieSerializationPreservesBrowserSecurityFlagsAndLegacyData() throws {
        let expires = Date(timeIntervalSince1970: 1_800_000_000)
        let cookie = HTTPCookie(properties: [.name: "session", .value: "fixture", .domain: "district.example.org", .path: "/campus", .secure: "TRUE", .expires: expires, HTTPCookiePropertyKey(rawValue: "HttpOnly"): "TRUE"])!
        let restored = try JSONDecoder().decode(StoredCookie.self, from: JSONEncoder().encode(StoredCookie(cookie)))
        XCTAssertTrue(try XCTUnwrap(restored.cookie).isHTTPOnly)
        XCTAssertTrue(try XCTUnwrap(restored.cookie).isSecure)
        XCTAssertEqual(restored.cookie?.expiresDate, expires)
        let legacy = Data("{\"name\":\"session\",\"value\":\"fixture\",\"domain\":\"district.example.org\",\"path\":\"/campus\",\"secure\":true}".utf8)
        let old = try JSONDecoder().decode(StoredCookie.self, from: legacy)
        XCTAssertNil(old.httpOnly); XCTAssertEqual(old.cookie?.value, "fixture")
    }
}

extension RepositoryTests {
    func testSSOEntryAcceptsOnlyReusableSameOriginStudentLink() throws {
        let base = URL(string: "https://district.example.org/campus/")!
        let entry = URL(string: "https://district.example.org/campus/SSO/district/portal/students?configID=1")!
        XCTAssertTrue(CampusSSO.validEntry(entry, base: base))
        for invalid in [
            "http://district.example.org/campus/SSO/district/portal/students",
            "https://other.example.org/campus/SSO/district/portal/students",
            "https://district.example.org:8443/campus/SSO/district/portal/students",
            "https://district.example.org/campus/SSO/district/portal/parents",
            "https://district.example.org/campus/SSO/district/portal/students?SAMLRequest=fixture",
            "https://district.example.org/campus/SSO/district/portal/students?configID=1&RelayState=fixture",
            "https://district.example.org/campus/SSO/district/portal/students?configID=1&configID=2",
            "https://district.example.org/campus/SSO/district/portal/students#fixture"
        ] { XCTAssertFalse(CampusSSO.validEntry(URL(string: invalid)!, base: base), invalid) }
    }
    func testSavedStudentPortalDropsTransientSAMLQueryAndFragment() throws {
        let portal = URL(string:"https://district.example.org/campus/nav-wrapper/student/portal/student/home?appName=district&SAMLRequest=fixture&SAMLResponse=fixture&RelayState=fixture#fixture")!
        let saved = try CampusSession(portal:portal, cookies:[])
        XCTAssertEqual(saved.portal.absoluteString, "https://district.example.org/campus/nav-wrapper/student/portal/student/home?appName=district")
        XCTAssertEqual(saved.base.absoluteString, "https://district.example.org/campus/")
    }
    func testSSOCookiesRetainOnlyVisitedHostsAndRemoveExpiredCookies() throws {
        let portal = URL(string: "https://district.example.org/campus/portal/students/district.jsp")!
        var session = try CampusSession(portal: portal, cookies: [])
        let entry = URL(string: "https://district.example.org/campus/SSO/district/portal/students")!
        let fixture = [
            HTTPCookie(properties: [.name:"idp", .value:"fixture", .domain:".example.net", .path:"/", .secure:"TRUE"])!,
            HTTPCookie(properties: [.name:"campus", .value:"fixture", .domain:"district.example.org", .path:"/campus"])!,
            HTTPCookie(properties: [.name:"foreign", .value:"fixture", .domain:"other.example.com", .path:"/"])!,
            HTTPCookie(properties: [.name:"lookalike", .value:"fixture", .domain:"evil-example.net", .path:"/"])!,
            HTTPCookie(properties: [.name:"expired", .value:"fixture", .domain:"login.example.net", .path:"/", .expires:Date().addingTimeInterval(-100)])!
        ]
        session.replaceCookies(fixture)
        session.sso = try CampusSSO(base: session.base, entry: entry, hosts: ["login.example.net"], cookies: fixture)
        XCTAssertEqual(session.cookies.map(\.name), ["campus"])
        XCTAssertEqual(session.sso?.cookies.map(\.name), ["idp"])
        XCTAssertEqual(session.sso?.canRenew(base: session.base), true)
        session.sso?.needsSignIn = true
        XCTAssertEqual(session.sso?.canRenew(base: session.base), false)
        XCTAssertEqual(session.sso?.browserCookies(base: session.base).count, 1, "Interactive login must still reuse its own IdP session")
    }
    func testLegacyCampusConnectionAndNewSSOKeychainRoundTrip() throws {
        let legacy = Data("{\"portal\":\"https://district.example.org/campus/portal/students/district.jsp\",\"base\":\"https://district.example.org/campus/\",\"cookies\":[]}".utf8)
        var session = try JSONDecoder().decode(CampusSession.self, from: legacy)
        XCTAssertNil(session.sso)
        let cookie = HTTPCookie(properties: [.name:"idp", .value:"fixture", .domain:"login.example.net", .path:"/", .secure:"TRUE", .sameSitePolicy:"strict", HTTPCookiePropertyKey(rawValue:"HttpOnly"):"TRUE"])!
        session.sso = try CampusSSO(base: session.base, entry: URL(string: "https://district.example.org/campus/SSO/district/portal/students?configID=1")!, hosts: ["login.example.net"], cookies: [cookie])
        let account = "test-sso-" + UUID().uuidString
        defer { try? SecureStore.delete(account: account) }
        try SecureStore.save(session, account: account)
        let restored = try XCTUnwrap(SecureStore.load(CampusSession.self, account: account))
        let idp = try XCTUnwrap(restored.sso?.browserCookies(base: restored.base).first)
        XCTAssertTrue(idp.isHTTPOnly); XCTAssertTrue(idp.isSecure)
        XCTAssertEqual(idp.sameSitePolicy?.rawValue, "strict")
        XCTAssertTrue(restored.cookies.isEmpty)
        XCTAssertEqual(restored.sso?.canRenew(base: restored.base), true)
    }
    func testPrivateBrowserRestoresCampusAndSSOButRejectsOtherDistrict() async throws {
        let portal = URL(string: "https://district.example.org/campus/portal/students/district.jsp")!
        let campus = HTTPCookie(properties: [.name:"campus", .value:"fixture", .domain:"district.example.org", .path:"/campus", .secure:"TRUE"])!
        let idp = HTTPCookie(properties: [.name:"idp", .value:"fixture", .domain:"login.example.net", .path:"/", .secure:"TRUE", .sameSitePolicy:"strict", HTTPCookiePropertyKey(rawValue:"HttpOnly"):"TRUE"])!
        var saved = try CampusSession(portal: portal, cookies: [campus])
        saved.sso = try CampusSSO(base: saved.base, entry: URL(string: "https://district.example.org/campus/SSO/district/portal/students")!, hosts: ["login.example.net"], cookies: [idp])
        let browser = CampusWebSession(portal: portal, saved: saved, automatic: true)
        XCTAssertFalse(browser.webView.configuration.websiteDataStore.isPersistent)
        await browser.restoreCookies()
        let restored = await browser.webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        XCTAssertEqual(Set(restored.map(\.name)), ["campus", "idp"])
        XCTAssertTrue(try XCTUnwrap(restored.first { $0.name == "idp" }).isHTTPOnly)
        let other = CampusWebSession(portal: URL(string: "https://other.example.org/campus/portal/students/other.jsp")!, saved: saved, automatic: true)
        await other.restoreCookies()
        let foreign = await other.webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        XCTAssertTrue(foreign.isEmpty)
        XCTAssertTrue(browser.permits(URL(string:"https://login.example.net/saml?transient=fixture")!))
        XCTAssertFalse(browser.permits(URL(string:"https://unknown.example.com/saml")!))
        XCTAssertFalse(browser.permits(URL(string:"http://login.example.net/saml")!))
    }
    func testRenewalWithoutSavedSSONeverStartsBrowser() async throws {
        let saved = try CampusSession(portal: URL(string:"https://district.example.org/campus/portal/students/district.jsp")!, cookies:[])
        do { _ = try await CampusWebSession.renew(saved); XCTFail("A Campus cookie is not an IdP session") }
        catch ProviderError.reconnect {} catch { XCTFail("Unexpected error") }
    }
    func testSSOReturnAcceptsSharedCampusPageOnlyAfterIdpNavigation() throws {
        let base = URL(string:"https://district.example.org/campus/")!
        let shared = URL(string:"https://district.example.org/campus/portal/district.jsp")!
        XCTAssertTrue(CampusSSO.returnedToCampus(shared, base:base, visitedIdp:true))
        XCTAssertFalse(CampusSSO.returnedToCampus(shared, base:base, visitedIdp:false))
        XCTAssertTrue(CampusSSO.returnedToCampus(URL(string:"https://district.example.org/campus/SSO/district/portal/students")!, base:base, visitedIdp:true))
        for candidate in ["https://login.example.net/campus/portal/district.jsp", "http://district.example.org/campus/portal/district.jsp", "https://district.example.org/outside", "https://district.example.org/campus-lookalike/portal/district.jsp"] {
            XCTAssertFalse(CampusSSO.returnedToCampus(URL(string:candidate)!, base:base, visitedIdp:true))
        }
    }
    func testCancelledSSORenewalExitsBeforeLoadingProvider() async throws {
        var session = try CampusSession(portal:URL(string:"https://district.example.org/campus/portal/students/district.jsp")!, cookies:[])
        let idp = HTTPCookie(properties:[.name:"idp",.value:"fixture",.domain:"login.example.net",.path:"/"])!
        session.sso = try CampusSSO(base:session.base, entry:URL(string:"https://district.example.org/campus/SSO/district/portal/students")!, hosts:["login.example.net"], cookies:[idp])
        let saved = session
        let task = Task { try await CampusWebSession.renew(saved) }
        task.cancel()
        do { _ = try await task.value; XCTFail("Cancelled renewal must not run") }
        catch is CancellationError {} catch { XCTFail("Unexpected error") }
    }
    func testStoredCookiePreservesInsecureFlagRatherThanChangingIt() throws {
        let original = HTTPCookie(properties:[.name:"fixture", .value:"fixture", .domain:"login.example.net", .path:"/"])!
        XCTAssertFalse(original.isSecure)
        XCTAssertFalse(try XCTUnwrap(StoredCookie(original).cookie).isSecure)
    }
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
        store.connected = [.infiniteCampus]
        await store.refresh()
        XCTAssertTrue(store.needsFreshData); XCTAssertTrue(store.foregroundRefreshFailed)
        XCTAssertNotNil(store.localError); XCTAssertNotNil(store.errors[.infiniteCampus])
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
        store.connected = [.infiniteCampus]
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
    func testSavedGradesRemainCoveredUntilEveryProviderIsFreshAndFailureRetainsCache() async throws {
        let repository = try GradeRepository(memory:true)
        try repository.save(Demo.courses())
        let probe = RefreshProbe()
        let store = AppStore(repository:repository,demo:false,readCredentials:false,fetch:{ provider in try await probe.fetch(provider) })
        store.connected = [.infiniteCampus,.schoology]
        XCTAssertTrue(store.needsFreshData, "Gate must exist before any startup task runs")
        let task = Task { await store.startup() }
        try await Task.sleep(for:.milliseconds(100))
        XCTAssertTrue(store.needsFreshData, "Fast provider cannot uncover stale authority from the slow provider")
        await task.value
        XCTAssertTrue(store.foregroundRefreshFailed); XCTAssertTrue(store.needsFreshData)
        XCTAssertTrue(store.courses.contains { $0.sources.contains { $0.source.provider == .infiniteCampus } })
        let success = AppStore(repository:repository,demo:false,readCredentials:false,fetch:{ _ in Demo.courses().flatMap(\.sources) })
        success.connected = [.infiniteCampus]
        await success.refresh()
        XCTAssertFalse(success.needsFreshData)
        success.requireFreshData(); XCTAssertTrue(success.needsFreshData)
        await success.refresh(); XCTAssertFalse(success.needsFreshData)
    }
}
