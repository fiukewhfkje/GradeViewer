import XCTest
@testable import GradeCore

extension HTTPTests {
    func testFirstConnectionReadsEarlierGradingPeriodsWithoutCacheOrDateFilter() async throws {
        let provider = try refreshFixture()
        let q1 = Int(ProviderParsing.date("2025-09-01")!.timeIntervalSince1970)
        let q2 = Int(ProviderParsing.date("2025-11-01")!.timeIntervalSince1970)
        StubURLProtocol.bodies["/v1/users/fixture-user/grades?section_id=100"] = """
        {"section":[{"section_id":"100","period":[
        {"period_id":"p1","period_title":"Q1","assignment":[{"assignment_id":10,"grade":100,"max_points":100,"type":"assignment","category_id":2,"timestamp":\(q1)}]},
        {"period_id":"p2","period_title":"Q2","assignment":[{"assignment_id":12,"grade":60,"max_points":100,"type":"assignment","category_id":2,"timestamp":\(q2)}]}],"final_grade":[]}]}
        """
        StubURLProtocol.bodies["/v1/sections/100/grade_items?limit=200"] = """
        {"assignment":[{"id":10,"type":"assignment","title":"Earlier quiz","grading_period":1,"grading_category":2,"max_points":100},
        {"id":12,"type":"assignment","title":"Later quiz","grading_period":2,"grading_category":2,"max_points":100}]}
        """
        StubURLProtocol.bodies["/v1/sections/100/grading_periods?limit=200"] = """
        {"grading_period":[{"id":1,"title":"Q1","start":"2025-08-20","end":"2025-10-30"},
        {"id":2,"title":"Q2","start":"2025-11-01","end":"2026-01-04"}]}
        """
        StubURLProtocol.requests = []
        let fresh = Reconciler.reconcile(try await provider.fetch(previous:[]))
        XCTAssertEqual(fresh.count,2); XCTAssertTrue(fresh.allSatisfy { $0.history.isEmpty })
        let latest = try XCTUnwrap(fresh.first { $0.display.term.id == "p2" })
        let curve = GradeCurve(points:GradeProgression.points(for:latest, among:fresh))
        XCTAssertEqual(curve.nodes.map(\.value),[100,60,60])
        XCTAssertEqual(curve.nodes.first?.date,ProviderParsing.date("2025-09-01"))
        XCTAssertFalse(StubURLProtocol.requests.contains { $0.contains("timestamp=") || $0.contains("grading_period_ids=") })
        XCTAssertTrue(StubURLProtocol.requests.contains("/v1/users/fixture-user/grades?section_id=100"))
    }
    func testPreUpgradeMetadataIsReadAgainBeforeUsingNewCalculationRules() async throws {
        let provider = try refreshFixture()
        var first = try await provider.fetch()
        for i in first.indices { first[i].source.fields["section_metadata_version"] = "3" }
        StubURLProtocol.requests = []
        _ = try await provider.fetch(previous: first)
        XCTAssertTrue(StubURLProtocol.requests.contains("/v1/sections/100/grading_categories?limit=200"))
    }
    private func refreshFixture(sections: Int = 1, missingTitle: Bool = false) throws -> SchoologyProvider {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures")
        func fixture(_ name: String) throws -> String { try String(contentsOf: root.appendingPathComponent(name + ".json"), encoding: .utf8) }
        let ids = (0..<sections).map { String(100 + $0) }
        StubURLProtocol.bodies["/v1/users/me"] = "{\"uid\":\"fixture-user\"}"
        StubURLProtocol.bodies["/v1/users/fixture-user/sections?limit=200"] = "{\"section\":[" + ids.map { "{\"id\":\"\($0)\"}" }.joined(separator: ",") + "]}"
        var grades: [[String: Any]] = []
        for id in ids {
            let grade = try fixture("schoology-grades").replacingOccurrences(of: "\"section_id\":\"100\"", with: "\"section_id\":\"\(id)\"")
            grades += try ProviderParsing.collection(ProviderParsing.object(Data(grade.utf8))["section"])
            StubURLProtocol.bodies["/v1/users/fixture-user/grades?section_id=\(id)"] = grade
            StubURLProtocol.bodies["/v1/sections/\(id)"] = try fixture("schoology-section").replacingOccurrences(of: "\"id\":\"100\"", with: "\"id\":\"\(id)\"")
            StubURLProtocol.bodies["/v1/sections/\(id)/grade_items?limit=200"] = missingTitle ? "{\"assignment\":[]}" : try fixture("schoology-items")
            StubURLProtocol.bodies["/v1/sections/\(id)/grading_categories?limit=200"] = try fixture("schoology-categories")
            StubURLProtocol.bodies["/v1/sections/\(id)/grading_periods?limit=200"] = "{\"grading_period\":[{\"id\":1,\"title\":\"Fall 2026\",\"start\":\"2026-08-20\",\"end\":\"2026-10-15\"}]}"
            StubURLProtocol.statuses["/v1/sections/\(id)/assignments/10"] = 403
            StubURLProtocol.bodies["/v1/sections/\(id)/assignments?limit=200"] = "{\"assignment\":[]}"
            StubURLProtocol.bodies["/v1/courses/\(id)/folder/0"] = "{\"folder-item\":[]}"
        }
        StubURLProtocol.bodies["/v1/users/fixture-user/grades?limit=200"] = String(decoding: try JSONSerialization.data(withJSONObject: ["section": grades]), as: UTF8.self)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubURLProtocol.self]
        let http = try ReadOnlyHTTP(origin: URL(string: "https://api.schoology.com/v1/")!, credentials: SchoologyCredentials(key: "fixture", secret: "fixture-secret"), configuration: config)
        return SchoologyProvider(http: http, userID: "fixture-user")
    }

    func testSchoologyUnchangedRepeatChecksIdentityAndFreshGradesWithoutRepeatingMetadata() async throws {
        let provider = try refreshFixture(sections: 7)
        let first = try await provider.fetch()
        StubURLProtocol.requests = []
        // A new client plus a Codable round trip represents process relaunch.
        let restored = try JSONDecoder().decode([SourceCourse].self, from: JSONEncoder().encode(first))
        let second = try await refreshFixture(sections: 7).fetch(previous: restored)
        XCTAssertEqual(second.count, first.count)
        XCTAssertEqual(second[0].assignments, first[0].assignments)
        XCTAssertGreaterThan(second[0].fetched, first[0].fetched)
        XCTAssertEqual(second[0].source.fields["section_metadata_fetched"], first[0].source.fields["section_metadata_fetched"], "Repeat reads must not slide metadata expiry")
        XCTAssertEqual(Set(StubURLProtocol.requests), Set(["/v1/users/me", "/v1/users/fixture-user/sections?limit=200", "/v1/users/fixture-user/grades?limit=200"]))
        XCTAssertEqual(StubURLProtocol.requests.count, 3)
    }

    func testOptionalTitleThrottlePreservesFreshScoreWithoutRetryingOrTraversingFolders() async throws {
        let provider = try refreshFixture(missingTitle: true)
        let first = try await provider.fetch()
        StubURLProtocol.bodies["/v1/users/fixture-user/grades?limit=200"] = StubURLProtocol.bodies["/v1/users/fixture-user/grades?limit=200"]!.replacingOccurrences(of: "\"grade\":\"0\"", with: "\"grade\":\"25\"")
        StubURLProtocol.statuses["/v1/sections/100/assignments/10"] = 429
        StubURLProtocol.extraHeaders = ["Retry-After": "0.05"]
        StubURLProtocol.requests = []
        let second = try await provider.fetch(previous: first)
        XCTAssertEqual(second[0].assignments[0].score.earned, 25)
        XCTAssertEqual(second[0].assignments[0].title, "Untitled assignment")
        XCTAssertEqual(StubURLProtocol.requests.filter { $0 == "/v1/sections/100/assignments/10" }.count, 1)
        XCTAssertFalse(StubURLProtocol.requests.contains { $0.contains("/folder/") || $0.contains("/assignments?") })
    }

    func testOptionalTitleThrottleCannotPauseOtherSectionsRequiredReads() async throws {
        let provider = try refreshFixture(sections: 7, missingTitle: true)
        StubURLProtocol.statuses["/v1/sections/100/assignments/10"] = 429
        StubURLProtocol.extraHeaders = ["Retry-After": "600"]
        let started = Date()
        let result = try await provider.fetchSnapshot()
        XCTAssertEqual(result.courses.count, 7)
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(result.retryAfter).timeIntervalSince(started), 600)
        XCTAssertEqual(result.courses[0].source.fields["provider_retry_after"].flatMap(Double.init), result.retryAfter?.timeIntervalSince1970)
        let requests = StubURLProtocol.requests
        let firstOptional = try XCTUnwrap(requests.firstIndex { $0.contains("/assignments/") })
        let lastRequired = try XCTUnwrap(requests.lastIndex { $0.contains("/grade_items?") || $0.contains("/grading_categories?") || $0.contains("/grading_periods?") })
        XCTAssertGreaterThan(firstOptional, lastRequired)
        XCTAssertEqual(requests.filter { $0.contains("/grade_items?") }.count, 7)
    }

    func testSchoologyMetadataExpiresWithoutSlidingAndManualRefreshBypassesReuse() async throws {
        let provider = try refreshFixture()
        let first = try await provider.fetch()
        StubURLProtocol.bodies["/v1/sections/100/grade_items?limit=200"] = StubURLProtocol.bodies["/v1/sections/100/grade_items?limit=200"]!.replacingOccurrences(of: "Kinematics Quiz", with: "Renamed quiz")
        let warm = try await provider.fetch(previous: first)
        XCTAssertEqual(warm[0].assignments[0].title, "Kinematics Quiz")
        XCTAssertEqual(warm[0].source.fields["section_metadata_fetched"], first[0].source.fields["section_metadata_fetched"])
        let manual = try await provider.fetch(previous: warm, refreshMetadata: true)
        XCTAssertEqual(manual[0].assignments[0].title, "Renamed quiz")

        var expired = warm
        for index in expired.indices { expired[index].source.fields["section_metadata_fetched"] = String(Date().addingTimeInterval(-301).timeIntervalSince1970) }
        StubURLProtocol.requests = []
        let renewed = try await provider.fetch(previous: expired)
        XCTAssertEqual(renewed[0].assignments[0].title, "Renamed quiz")
        XCTAssertTrue(StubURLProtocol.requests.contains("/v1/sections/100/grade_items?limit=200"))
        XCTAssertNotEqual(renewed[0].source.fields["section_metadata_fetched"], expired[0].source.fields["section_metadata_fetched"])
    }

    func testSchoologyChangedGradesAndNewPeriodsRefreshMetadataImmediately() async throws {
        let provider = try refreshFixture()
        let first = try await provider.fetch()
        let path = "/v1/users/fixture-user/grades?limit=200"
        StubURLProtocol.bodies[path] = StubURLProtocol.bodies[path]!.replacingOccurrences(of: "\"grade\":\"0\"", with: "\"grade\":\"25\"")
        StubURLProtocol.bodies["/v1/sections/100/grade_items?limit=200"] = StubURLProtocol.bodies["/v1/sections/100/grade_items?limit=200"]!.replacingOccurrences(of: "Kinematics Quiz", with: "Fresh title")
        StubURLProtocol.requests = []
        let changed = try await provider.fetch(previous: first)
        XCTAssertEqual(changed[0].assignments[0].score.earned, 25)
        XCTAssertEqual(changed[0].grade.percent, 25)
        XCTAssertEqual(changed[0].assignments[0].title, "Fresh title")
        XCTAssertTrue(StubURLProtocol.requests.contains("/v1/sections/100/grade_items?limit=200"))
        StubURLProtocol.bodies[path] = "{\"section\":[{\"section_id\":\"100\",\"period\":[{\"period_id\":\"p2\",\"assignment\":[]}]}]}"
        StubURLProtocol.bodies["/v1/sections/100/grading_periods?limit=200"] = "{\"grading_period\":[{\"id\":2,\"title\":\"Q2\"}]}"
        StubURLProtocol.requests = []
        let nextPeriod = try await provider.fetch(previous: changed)
        XCTAssertEqual(nextPeriod.map(\.term.id), ["p2"])
        XCTAssertTrue(nextPeriod[0].assignments.isEmpty)
        XCTAssertTrue(StubURLProtocol.requests.contains("/v1/sections/100/grading_periods?limit=200"))
    }

    func testSchoologyReuseStillRejectsMalformedGradesAndAcceptsValidEmptySnapshot() async throws {
        let provider = try refreshFixture()
        let first = try await provider.fetch()
        let path = "/v1/users/fixture-user/grades?limit=200"
        StubURLProtocol.bodies[path] = "{\"section\":[{\"section_id\":\"100\",\"period\":\"broken\"}]}"
        do { _ = try await provider.fetch(previous: first); XCTFail("Fresh malformed grades must not reuse the successful snapshot") }
        catch { XCTAssertEqual(error as? ProviderError, .malformed) }
        StubURLProtocol.bodies[path] = "{\"section\":[]}"
        let empty = try await provider.fetchSnapshot(previous: first)
        XCTAssertEqual(empty.userID, "fixture-user")
        XCTAssertTrue(empty.courses.isEmpty)
    }

    func testSchoologyPartialMetadataSnapshotCannotHideAMissingPeriod() async throws {
        let provider = try refreshFixture()
        StubURLProtocol.bodies["/v1/sections/100/grading_periods?limit=200"] = "{\"grading_period\":[{\"id\":1,\"title\":\"Q1\"},{\"id\":2,\"title\":\"Q2\"}]}"
        let first = try await provider.fetch()
        XCTAssertEqual(first.count, 2)
        StubURLProtocol.requests = []
        let repaired = try await provider.fetch(previous: Array(first.prefix(1)))
        XCTAssertEqual(repaired.count, 2)
        XCTAssertTrue(StubURLProtocol.requests.contains("/v1/sections/100/grade_items?limit=200"))
    }

    func testOptionalTitleListAndFolderThrottlesBackOffWithoutRejectingGrades() async throws {
        for path in ["/v1/sections/100/assignments?limit=200", "/v1/courses/100/folder/0"] {
            StubURLProtocol.statuses = [:]; StubURLProtocol.requests = []; StubURLProtocol.extraHeaders = [:]
            let provider = try refreshFixture(missingTitle: true)
            StubURLProtocol.statuses[path] = 429
            StubURLProtocol.extraHeaders = ["Retry-After": "1200"]
            let started = Date()
            let snapshot = try await provider.fetchSnapshot()
            let row = try XCTUnwrap(snapshot.courses.first?.assignments.first)
            XCTAssertEqual(row.score.earned, 0)
            XCTAssertFalse(row.hasTitle)
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(row.source.fields["title_lookup_retry_after"].flatMap(Double.init)), started.timeIntervalSince1970 + 1200)
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(snapshot.retryAfter).timeIntervalSince(started), 1200)
            XCTAssertEqual(StubURLProtocol.requests.filter { $0 == path }.count, 1)
        }
    }
}
