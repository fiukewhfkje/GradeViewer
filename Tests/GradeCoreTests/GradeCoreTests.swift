import XCTest
@testable import GradeCore
final class GradeCoreTests: XCTestCase {
    func testOutOfRangeProviderValuesCannotCrashParsing() throws {
        for value in ["1e300", "inf", "NaN"] { XCTAssertNil(ProviderParsing.date(value)) }
        for count in ["1e300", "-1", "1.5", "not-a-number"] {
            let categories = Data("{\"grading_category\":[{\"id\":2,\"title\":\"Quizzes\",\"drop_lowest\":\"\(count)\"}]}".utf8)
            XCTAssertThrowsError(try ProviderParsing.schoology(section:fixture("schoology-section"), grades:fixture("schoology-grades"), items:fixture("schoology-items"), categories:categories))
        }
    }
    func testSchoologyCatalogAndWrapperConflictsCannotOverrideGradeMetadata() throws {
        for identity in ["\"id\":10", "\"id\":10,\"grade_item_id\":500"] {
            for conflict in ["\"max_points\":5", "\"grading_period\":2", "\"grading_category\":99"] {
                let items = Data("{\"assignment\":[{\(identity),\(conflict),\"title\":\"Conflicting metadata\",\"type\":\"assignment\"}]}".utf8)
                let row = try ProviderParsing.schoology(section:fixture("schoology-section"), grades:fixture("schoology-grades"), items:items, categories:fixture("schoology-categories"))[0].assignments[0]
                XCTAssertEqual(row.title,"Untitled assignment")
                XCTAssertEqual(row.score.earned,0); XCTAssertEqual(row.score.possible,100)
            }
        }
    }
    func fixture(_ name: String) throws -> Data { try Data(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures/\(name).json")) }
    func source(_ provider: ProviderID = .schoology, id: String = "course", percent: Double = 90) -> SourceCourse {
        SourceCourse(source: Provenance(provider, id), title: "AP Physics 1", teacher: "Taylor", term: Term(id: "1", name: "Fall 2026"), grade: OverallGrade(percent: percent), categories: [GradingCategory(id: "tests", name: "Tests", weight: 70), GradingCategory(id: "practice", name: "Practice", weight: 30)], assignments: [assignment(provider, id: "1", earned: 80, possible: 100, category: "tests"), assignment(provider, id: "2", earned: 100, possible: 100, category: "practice")], method: .weightedCategories)
    }
    func assignment(_ provider: ProviderID = .schoology, id: String = "1", earned: Double? = 90, possible: Double = 100, category: String = "tests") -> SourceAssignment { SourceAssignment(source: Provenance(provider, id), title: "Quiz \(id)", categoryID: category, due: Demo.now, score: Score(earned: earned, possible: possible)) }
    func testSchoologyParsingZeroAndExcused() throws {
        let courses = try ProviderParsing.schoology(section: fixture("schoology-section"), grades: fixture("schoology-grades"), items: fixture("schoology-items"), categories: fixture("schoology-categories"))
        XCTAssertEqual(courses.count, 1); XCTAssertEqual(courses[0].grade.percent, 0); XCTAssertEqual(courses[0].assignments.count, 2)
        XCTAssertEqual(courses[0].assignments[0].score.earned, 0); XCTAssertTrue(courses[0].assignments[1].score.excused)
        XCTAssertEqual(courses[0].categories[0].weight, 100); XCTAssertEqual(courses[0].method, .weightedCategories)
    }

    func testDuplicateProviderIDsAndStableCourseIdentity() {
        let a = source(); var duplicate = a; duplicate.fetched = a.fetched.addingTimeInterval(10); duplicate.grade.percent = 95
        let old = Reconciler.reconcile([a]); let new = Reconciler.reconcile([a,duplicate,source(.schoology)], previous: old)
        XCTAssertEqual(new.count, 1); XCTAssertEqual(new[0].id, old[0].id); XCTAssertEqual(new[0].sources.count, 1); XCTAssertEqual(new[0].sources.first { $0.source.provider == .schoology }?.grade.percent, 95)
    }

    func testWeightedAndEqualCategoryCalculations() throws {
        let c = source(); XCTAssertEqual(try GradeCalculator.percent(course: c), 86, accuracy: 0.0001)
        var equal = c; equal.method = .equalCategories; XCTAssertEqual(try GradeCalculator.percent(course: equal), 90)
        var points = c; points.method = .points; XCTAssertEqual(try GradeCalculator.percent(course: points), 90)
    }
    func testPercentageCategoriesMultiplierAndDropLowest() throws {
        var c = source(); c.categories = [GradingCategory(id: "tests", name: "Tests", weight: 100, method: .percent, dropLowest: 1)]
        c.assignments = [assignment(earned: 10, possible: 20), assignment(id: "2", earned: 90)]; XCTAssertEqual(try GradeCalculator.percent(course: c), 90)
        c.categories[0].dropLowest = 0; c.assignments[1].multiplier = 3
        XCTAssertEqual(try GradeCalculator.percent(course: c), 80)
    }
    func testIgnoreEditAndAddScenarioPreservesOriginal() throws {
        let c = source(); var h = Hypothesis(); h.scores[c.assignments[0].id] = 100
        XCTAssertEqual(try GradeCalculator.percent(course: c, hypothesis: h), 100)
        h.ignored.insert(c.assignments[0].id); XCTAssertEqual(try GradeCalculator.percent(course: c, hypothesis: h), 100)
        h.added = [assignment(id: "new", earned: 0, category: "practice")]; XCTAssertEqual(try GradeCalculator.percent(course: c, hypothesis: h), 50)
        XCTAssertEqual(c.assignments[0].score.earned, 80)
    }
    func testSignedAndExtraCreditScoresCalculateWithoutClamping() throws {
        var c = source(); c.grade.percent = 86
        let id = c.assignments[0].id
        for (earned, expected) in [(-20.0, 16.0), (150.0, 135.0)] {
            var h = Hypothesis(); h.scores[id] = earned
            XCTAssertEqual(try GradeCalculator.hypotheticalPercent(course: c, hypothesis: h), expected, accuracy: 0.000001)
            c.categories[0].method = .percent
            XCTAssertEqual(try GradeCalculator.hypotheticalPercent(course: c, hypothesis: h), expected, accuracy: 0.000001)
            XCTAssertEqual(c.assignments[0].score.earned, 80)
        }
        c.method = .points; c.grade.percent = 90
        var h = Hypothesis(); h.added = [assignment(id: "new", earned: -30)]
        XCTAssertEqual(try GradeCalculator.hypotheticalPercent(course: c, hypothesis: h), 50, accuracy: 0.000001)
        h.added = []; h.scores[id] = -250
        XCTAssertEqual(try GradeCalculator.hypotheticalPercent(course: c, hypothesis: h), -75, accuracy: 0.000001)
        h.scores[id] = 150
        XCTAssertEqual(try GradeCalculator.hypotheticalPercent(course: c, hypothesis: h), 125, accuracy: 0.000001)
        c.assignments[0].score.possible = -100
        XCTAssertThrowsError(try GradeCalculator.percent(course: c))
    }
    func testScoreInputRoundTripsSignedDecimalsWithoutGroupingOrRounding() {
        for value in [1234.56789, -12.5, 105.0, 0.0, 0.000123456789] {
            XCTAssertEqual(ScoreInput.number(ScoreInput.text(value)), value)
            XCTAssertFalse(ScoreInput.text(value).contains(","))
        }
        XCTAssertEqual(ScoreInput.number("  −12,5\n"), -12.5)
        XCTAssertEqual(ScoreInput.number("150.25"), 150.25)
        for invalid in ["", "-", ".", "-.", "NaN", "inf", "1e999", "1,234.5", "abc"] {
            XCTAssertNil(ScoreInput.number(invalid))
        }
        XCTAssertEqual(ScoreInput.text(nil), "")
        XCTAssertEqual(ScoreInput.text(.infinity), "")
    }
    func testInvalidUnknownMissingAndExcludedCategories() throws {
        var c = source(); c.method = .unknown; XCTAssertThrowsError(try GradeCalculator.percent(course: c))
        c.method = .weightedCategories; c.categories[0].weight = nil; XCTAssertThrowsError(try GradeCalculator.percent(course: c))
        c = source(); c.assignments[0].categoryID = "missing"; XCTAssertThrowsError(try GradeCalculator.percent(course: c))
        c = source(); c.method = .points; c.categories[0].excluded = true; XCTAssertEqual(try GradeCalculator.percent(course: c), 100)
        c = source(); c.assignments[0].score.earned = .nan; XCTAssertThrowsError(try GradeCalculator.percent(course: c))
    }
    func testEmptyWeightedCategoryAndExcused() throws {
        var c = source(); c.assignments[0].score.excused = true; XCTAssertEqual(try GradeCalculator.percent(course: c), 100)
        c.assignments[1].score.earned = nil; XCTAssertThrowsError(try GradeCalculator.percent(course: c))
    }
    func testFinalCalculatorAndImpossibleTarget() throws {
        XCTAssertEqual(try GradeCalculator.requiredFinal(current: 85, target: 90, weight: 0.2), 110, accuracy: 0.00001)
        XCTAssertEqual(try GradeCalculator.requiredFinal(current: 100, target: 70, weight: 0.1), -200, accuracy: 0.00001)
        XCTAssertThrowsError(try GradeCalculator.requiredFinal(current: 90, target: 90, weight: 0)); XCTAssertThrowsError(try GradeCalculator.requiredFinal(current: 90, target: 90, weight: 1.1))
    }
    func testHistoryNoDuplicatesAndMaterialChange() {
        let old = Reconciler.reconcile([source()], now: Demo.now)
        let same = Reconciler.reconcile([source()], previous: old, now: Demo.now.addingTimeInterval(20)); XCTAssertEqual(same[0].history.count, 1)
        var c = source(); c.grade.percent = 90.005; XCTAssertEqual(Reconciler.reconcile([c], previous: old)[0].history.count, 1)
        c.grade.percent = 89; XCTAssertEqual(Reconciler.reconcile([c], previous: old)[0].history.count, 2)
    }

    func testCachedSerializationAndLongLists() throws {
        let c = Demo.courses(longList: true); let data = try JSONEncoder().encode(c); let loaded = try JSONDecoder().decode([Course].self, from: data)
        XCTAssertEqual(loaded.count, 6); XCTAssertEqual(loaded[0].assignments.count, 350); XCTAssertEqual(loaded[0].history.count, 9)
        XCTAssertEqual(Reconciler.reconcile(loaded.flatMap(\.sources), previous: loaded).count, 6)
    }
    func testOAuthOfficialRFC5849Vector() {
        let url = URL(string: "http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b")!
        let parameters = [("oauth_consumer_key", "9djdj82h48djs9d2"), ("oauth_token", "kkk9d7dh3k39sjv7"), ("oauth_signature_method", "HMAC-SHA1"), ("oauth_timestamp", "137131201"), ("oauth_nonce", "7d8f3e4a"), ("c2", ""), ("a3", "2 q")]
        XCTAssertEqual(OAuth1.signature(url: url, method: "POST", parameters: parameters, secret: "j49sk3j29djd", tokenSecret: "dh893hdasih9"), "r6/TJjbCOr97/+UU0NsvSne7s5g=")
        XCTAssertEqual(OAuth1.encode("a &+é"), "a%20%26%2B%C3%A9")
    }
    func testHTTPSAndHostValidation() {
        XCTAssertThrowsError(try ReadOnlyHTTP(origin: URL(string: "http://api.schoology.com/v1/")!))
        XCTAssertThrowsError(try ReadOnlyHTTP(origin: URL(string: "https://user:secret@example.com/v1/")!))
        XCTAssertEqual(ReadOnlyHTTP.retryAfter("42"), 42)
    }
}



extension GradeCoreTests {

    func testBatchScoreEventsRemainDistinctWithStableDatesAndOrder() throws {
        var c = source(); c.method = .points; c.categories = []
        c.fetched = Date(timeIntervalSince1970: 500_000)
        c.assignments = [assignment(id: "a", earned: 100), assignment(id: "b", earned: 80), assignment(id: "c", earned: 90)]
        for i in c.assignments.indices {
            c.assignments[i].updated = Date(timeIntervalSince1970: 200_000)
            c.assignments[i].due = Date(timeIntervalSince1970: Double(100_000 + i * 10))
        }
        c.grade.percent = 90
        let points = GradeProgression.calculated(c, before: c.fetched)
        XCTAssertEqual(points.map { $0.grade.percent }, [100, 90, 90])
        XCTAssertEqual(Set(points.map(\.id)).count, 3)
        XCTAssertEqual(Set(points.map(\.date)), [Date(timeIntervalSince1970: 200_000)])
        c.assignments.reverse()
        XCTAssertEqual(GradeProgression.calculated(c, before: c.fetched).map(\.id), points.map(\.id))
        let curve = GradeCurve(points: points)
        XCTAssertEqual(curve.nodes.count, 3); XCTAssertEqual(curve.nodes.map(\.fraction), [0, 0.5, 1])
    }
    func testTooltipJumpsAtThresholdAndNeverUsesInterpolatedValueOrDate() throws {
        let first = GradeHistorySnapshot(date: Date(timeIntervalSince1970: 1_000), grade: OverallGrade(percent: 100), provider: .schoology)
        let second = GradeHistorySnapshot(date: Date(timeIntervalSince1970: 10_000), grade: OverallGrade(percent: 91.92), provider: .schoology)
        let curve = GradeCurve(points: [GradeProgressionPoint(first), GradeProgressionPoint(second)])
        for i in 0...1000 {
            let event = try XCTUnwrap(curve.event(at: Double(i) / 1000))
            XCTAssertTrue([100, 91.92].contains(event.value))
            XCTAssertTrue([first.date, second.date].contains(event.date))
        }
        XCTAssertEqual(curve.event(at: 0.4999)?.value, 100)
        XCTAssertEqual(curve.event(at: 0.5)?.value, 91.92)
        XCTAssertNotEqual(curve.traceValue(at: 0.5), curve.event(at: 0.5)?.value)
        XCTAssertNil(curve.event(at: .nan)); XCTAssertNil(curve.traceValue(at: .infinity))
    }
    func testInitialProgressionUsesCanonicalCalculationWithoutInventingObservedHistory() throws {
        var course = source(); course.method = .points; course.categories = []
        course.fetched = Date(timeIntervalSince1970: 500_000)
        course.assignments = [assignment(earned: 100), assignment(id: "2", earned: 90)]
        course.assignments[0].updated = Date(timeIntervalSince1970: 100_000)
        course.assignments[1].updated = Date(timeIntervalSince1970: 200_000)
        course.grade.percent = 95
        let points = GradeProgression.calculated(course, before: course.fetched)
        XCTAssertEqual(points.map { $0.grade.percent }, [100,95]); XCTAssertTrue(points.allSatisfy(\.calculated))
        XCTAssertTrue(points.allSatisfy { !$0.usesDueDate })
        course.grade.percent = 85
        XCTAssertTrue(GradeProgression.calculated(course, before: course.fetched).isEmpty)
    }
    func testProgressionGroupsDatesAndDistinguishesDueDateFallback() {
        var course = source(); course.method = .points; course.categories = []
        course.fetched = Date(timeIntervalSince1970: 500_000)
        course.assignments = [assignment(earned: 100), assignment(id: "2", earned: 90)]
        for i in course.assignments.indices { course.assignments[i].updated = nil; course.assignments[i].due = Date(timeIntervalSince1970: 100_000) }
        course.grade.percent = 95
        let points = GradeProgression.calculated(course, before: course.fetched)
        XCTAssertEqual(points.count, 2); XCTAssertTrue(points.allSatisfy(\.usesDueDate)); XCTAssertEqual(points.map { $0.grade.percent }, [100, 95])
        course.assignments[0].due = nil
        XCTAssertTrue(GradeProgression.calculated(course, before: course.fetched).isEmpty)
    }
}

extension GradeCoreTests {

    func testGradeCurveSamplesContinuouslyWithoutOvershootingAndKeepsFlatGradesFlat() throws {
        let start = Date(timeIntervalSince1970: 1_000_000)
        func point(_ seconds: Double, _ value: Double) -> GradeProgressionPoint {
            GradeProgressionPoint(GradeHistorySnapshot(date: start.addingTimeInterval(seconds), grade: OverallGrade(percent: value), provider: .schoology))
        }
        let curve = GradeCurve(points: [point(0,90),point(100,95),point(300,100),point(400,92)])
        let a = try XCTUnwrap(curve.traceValue(at: 0.16))
        let b = try XCTUnwrap(curve.traceValue(at: 0.17))
        XCTAssertGreaterThan(b, a); XCTAssertLessThan(b - a, 0.3)
        for segment in curve.segments { for i in 0...100 {
            let value = segment.value(at: Double(i)/100)
            XCTAssertGreaterThanOrEqual(value, min(segment.start.value, segment.end.value) - 0.00001)
            XCTAssertLessThanOrEqual(value, max(segment.start.value, segment.end.value) + 0.00001)
        } }
        let flat = GradeCurve(points: [point(0,100),point(100,100),point(200,100)])
        XCTAssertEqual(flat.traceValue(at: 0.375), 100)
        let single = GradeCurve(points: [point(0,100)])
        XCTAssertEqual(single.traceValue(at: 0.5), 100)
    }
}

extension GradeCoreTests {

    func testNoOpHypothesesAndReportedRoundingCannotProduceFakeCourseDelta() throws {
        var course = source(); course.method = .points; course.categories = []
        course.assignments = [assignment(earned: 99.04),assignment(id: "2", earned: 99.05)]
        course.grade.percent = 99.04
        var h = Hypothesis(); h.scores[course.assignments[0].id] = 99.04; h.scores["stale-id"] = 90; h.ignored.insert("stale-id")
        let normalized = h.normalized(for: course)
        XCTAssertTrue(normalized.scores.isEmpty); XCTAssertTrue(normalized.ignored.isEmpty)
        XCTAssertEqual(try GradeCalculator.hypotheticalPercent(course: course, hypothesis: h), 99.04, accuracy: 0.000001)
        h.scores[course.assignments[0].id] = 100
        XCTAssertEqual(try GradeCalculator.hypotheticalPercent(course: course, hypothesis: h), 99.52, accuracy: 0.000001)
    }
}

extension GradeCoreTests {

    func testRecentOrderingUsesScoreDatesBeforeDueDatesWithStableTies() {
        var old = assignment(id: "old"); old.updated = Demo.now.addingTimeInterval(-100)
        var newer = assignment(id: "newer"); newer.updated = Demo.now
        var undated = assignment(id: "undated"); undated.due = Demo.now.addingTimeInterval(3600)
        var tie = newer; tie.source.id = "tie"; tie.title = "A tie"
        let rows = [undated,old,newer,tie].map { Assignment(id:$0.id,sources:[$0]) }
        let expected = [tie.id,newer.id,old.id,undated.id]
        XCTAssertEqual(AssignmentOrdering.graded(rows).map(\.id), expected)
        XCTAssertEqual(AssignmentOrdering.graded(rows.reversed()).map(\.id), expected)
    }
    func testRelativeUpdateLabelRoundsUnitsInsteadOfAlwaysTruncating() {
        let now = Demo.now
        XCTAssertEqual(GradeUpdateAge(date: now.addingTimeInterval(-5.6 * 3600), now:now).text, "updated 6 hours ago")
        XCTAssertEqual(GradeUpdateAge(date: now.addingTimeInterval(-23.8 * 3600), now:now).text, "updated 1 day ago")
        XCTAssertEqual(GradeUpdateAge(date: now.addingTimeInterval(-4.4 * 86400), now:now).text, "updated 4 days ago")
    }

}

extension GradeCoreTests {
    func testSchoologyUsesGradedNodeIDForTitleAndCatalogIdentity() throws {
        let items = try fixture("schoology-items").asJSONObject()
        var payload = items
        var rows = try XCTUnwrap(items["assignment"] as? [[String: Any]])
        rows[0]["grade_item_id"] = "10"; rows[0]["id"] = "wrapper-500"
        rows[0]["count_in_grade"] = 0
        payload["assignment"] = rows
        let courses = try ProviderParsing.schoology(section: fixture("schoology-section"), grades: fixture("schoology-grades"), items: JSONSerialization.data(withJSONObject: payload), categories: fixture("schoology-categories"))
        let row = courses[0].assignments[0]
        XCTAssertEqual(row.title, "Kinematics Quiz"); XCTAssertTrue(row.excluded)
        XCTAssertTrue(courses[0].assignmentCatalog![0].id.hasSuffix(":assignment:10"))
        XCTAssertEqual(courses[0].assignments.count, 2)
    }

    func testUntitledFreshScorePreservesPreviouslyKnownTitle() {
        let old = Reconciler.reconcile([source()])
        var fresh = source(); fresh.assignments[0].title = "Untitled assignment"; fresh.assignments[0].score.earned = 70
        let result = Reconciler.refreshing(previous: old, successful: [.schoology: [fresh]])
        XCTAssertEqual(result[0].assignments.first { $0.id == fresh.assignments[0].id }?.display.title, "Quiz 1")
        XCTAssertEqual(result[0].assignments.first { $0.id == fresh.assignments[0].id }?.display.score.earned, 70)
    }

    func testCalculatedGraphEndsAtReportedGradeWithoutRoundingTransition() {
        var course = source(.schoology, percent: 96.29); course.method = .points
        course.assignments = [assignment(.schoology, id:"a", earned:96.299), assignment(.schoology, id:"b", earned:96.299)]
        for i in course.assignments.indices { course.assignments[i].updated = Demo.now.addingTimeInterval(Double(i)) }
        course.fetched = Demo.now.addingTimeInterval(100)
        let points = GradeProgression.calculated(course, before: course.fetched)
        XCTAssertEqual(points.count, 2)
        for point in points { XCTAssertEqual(point.grade.percent!, 96.29, accuracy: 0.0000001) }
        let observed = GradeHistorySnapshot(date: course.fetched, grade: course.grade, provider: .schoology)
        let curve = GradeCurve(points: points + [GradeProgressionPoint(observed)])
        XCTAssertEqual(Set(curve.nodes.map { ($0.value * 100).rounded() }).count, 1)
    }
    func testEarlierPerfectGraphPointsDoNotInheritCurrentRoundingOffset() throws {
        var course = source(.schoology, percent: 96.29); course.method = .points
        course.assignments = [assignment(.schoology, id:"a", earned:100), assignment(.schoology, id:"b", earned:92.598)]
        for i in course.assignments.indices { course.assignments[i].updated = Demo.now.addingTimeInterval(Double(i) * 100) }
        course.fetched = Demo.now.addingTimeInterval(200)
        let points = GradeProgression.calculated(course, before: course.fetched)
        XCTAssertEqual(try XCTUnwrap(points.first?.grade.percent), 100, accuracy: 0.0000001)
        XCTAssertEqual(try XCTUnwrap(points.last?.grade.percent), 96.29, accuracy: 0.0000001)
        let earlier = GradeHistorySnapshot(date: Demo.now.addingTimeInterval(50), grade: OverallGrade(percent:100), provider:.schoology)
        let current = GradeHistorySnapshot(date:course.fetched, grade:course.grade, provider:.schoology)
        let curve = GradeCurve(points:points + [GradeProgressionPoint(earlier), GradeProgressionPoint(current)])
        XCTAssertEqual(curve.nodes.map(\.value), [100,100,96.29,96.29])
        XCTAssertTrue(zip(curve.nodes,curve.nodes.dropFirst()).allSatisfy { $0.value >= $1.value }, "Current rounding must not manufacture an upward bump before the real decline")
    }
    func testObservedGradeReplacesCalculatedEventsAtTheSameTimestamp() {
        var course = source(.schoology, percent:90); course.method = .points
        course.assignments = [assignment(.schoology, id:"a", earned:100), assignment(.schoology, id:"b", earned:80)]
        for i in course.assignments.indices { course.assignments[i].updated = Demo.now.addingTimeInterval(Double(i) * 100) }
        course.fetched = Demo.now.addingTimeInterval(200)
        let earlier = GradeHistorySnapshot(date:Demo.now.addingTimeInterval(100), grade:OverallGrade(percent:92), provider:.schoology)
        let current = GradeHistorySnapshot(date:course.fetched, grade:course.grade, provider:.schoology)
        let curve = GradeCurve(points:GradeProgression.calculated(course, before:course.fetched) + [GradeProgressionPoint(earlier),GradeProgressionPoint(current)])
        XCTAssertEqual(curve.nodes.map(\.value), [100,92,90])
        XCTAssertEqual(curve.nodes.filter { $0.date == earlier.date }.count, 1)
    }
    func testCorrectedMissingAssignmentKeepsObservedDipAndRecovery() throws {
        var course = source(.schoology, percent:100); course.method = .points; course.categories = []
        course.assignments = [assignment(.schoology, id:"a", earned:20, possible:20), assignment(.schoology, id:"b", earned:20, possible:20)]
        for i in course.assignments.indices { course.assignments[i].updated = Demo.now.addingTimeInterval(Double(i) * 10 - 100) }
        course.fetched = Demo.now
        let first = Reconciler.reconcile([course], now:course.fetched)
        course.assignments[1].score.earned = 0; course.grade.percent = 50
        course.assignments[1].updated = Demo.now.addingTimeInterval(100); course.fetched = Demo.now.addingTimeInterval(100)
        let missing = Reconciler.reconcile([course], previous:first, now:course.fetched)
        course.assignments[1].score.earned = 20; course.grade.percent = 100
        course.assignments[1].updated = Demo.now.addingTimeInterval(200); course.fetched = Demo.now.addingTimeInterval(200)
        let corrected = try XCTUnwrap(Reconciler.reconcile([course], previous:missing, now:course.fetched).first)
        let restored = try JSONDecoder().decode(Course.self, from:JSONEncoder().encode(corrected))
        XCTAssertEqual(restored.history.map { $0.grade.percent }, [100,50,100])
        let curve = GradeCurve(points:GradeProgression.calculated(restored.calculationSource, before:course.fetched) + restored.history.map(GradeProgressionPoint.init))
        XCTAssertEqual(curve.nodes.first { $0.date == missing[0].history.last!.date }?.value, 50)
        XCTAssertEqual(curve.nodes.last?.value, 100)
        XCTAssertEqual(restored.assignments.first { $0.display.source.id == "b" }?.display.score.earned, 20)
    }
    func testTypedSchoologyIDsDoNotSuppressAnotherKind() throws {
        let items = Data("{\"assignment\":[{\"id\":\"wrapper\",\"grade_item_id\":10,\"type\":\"discussion\",\"title\":\"Discussion\",\"grading_period\":1,\"max_points\":5}]}".utf8)
        let course = try ProviderParsing.schoology(section: fixture("schoology-section"), grades: fixture("schoology-grades"), items: items, categories: fixture("schoology-categories"))[0]
        XCTAssertEqual(course.assignments.count, 3)
        XCTAssertTrue(course.assignments.contains { $0.title == "Discussion" })
        XCTAssertFalse(course.assignments.contains { $0.title.contains("Assignment 10") })
    }
}
private extension Data {
    func asJSONObject() throws -> [String: Any] { try XCTUnwrap(JSONSerialization.jsonObject(with: self) as? [String: Any]) }
}

extension GradeCoreTests {
    func testSchoologyUniqueTypedWrapperAliasRetainsTitle() throws {
        let items = Data("{\"assignment\":[{\"id\":10,\"grade_item_id\":500,\"title\":\"Wrapper referenced title\",\"type\":\"assignment\",\"max_points\":100}]}".utf8)
        let course = try ProviderParsing.schoology(section: fixture("schoology-section"), grades: fixture("schoology-grades"), items: items, categories: fixture("schoology-categories"))[0]
        XCTAssertEqual(course.assignments[0].title, "Wrapper referenced title")
        XCTAssertEqual(course.assignments[0].source.fields["assignment_id"], "10")
    }
}



extension GradeCoreTests {

    func testPeriodMetadataAddsEmptyPeriodsAndExplicitDatesWithoutInventingGrades() throws {
        let periods = Data("""
        {"grading_period":[{"id":1,"title":"Q1: 2026-08-20 - 2026-10-15","weight":33.333},{"id":2,"title":"Q2","start":"2026-10-16","end":"2027-01-04","weight":33.333},{"id":3,"title":"Exam","start":"2026-12-14","end":"2026-12-18","weight":33.333}]}
        """.utf8)
        var grades = try fixture("schoology-grades").asJSONObject()
        var sections = grades["section"] as! [[String:Any]]
        var periodsInGrades = sections[0]["period"] as! [[String:Any]]
        periodsInGrades[0].removeValue(forKey:"period_title"); sections[0]["period"] = periodsInGrades; grades["section"] = sections
        let parsed = try ProviderParsing.schoology(section:fixture("schoology-section"), grades:JSONSerialization.data(withJSONObject:grades), items:fixture("schoology-items"), categories:fixture("schoology-categories"), periods:periods)
        XCTAssertEqual(parsed.count, 3)
        XCTAssertEqual(parsed[0].term.start, ProviderParsing.date("2026-08-20"))
        XCTAssertEqual(parsed[0].term.end, ProviderParsing.date("2026-10-15"))
        XCTAssertEqual(parsed[1].term.weight, 33.333)
        XCTAssertTrue(parsed[1].assignments.isEmpty); XCTAssertNil(parsed[1].grade.percent)
        XCTAssertEqual(GradingPeriods.descriptor(parsed[2]).kind, .exam)
    }
    func testSemesterWeightsMustReproduceReportedGradeBeforeSimulation() {
        let sources = Demo.periodSources(); var courses = Reconciler.reconcile(sources)
        let quarter = courses.first { GradingPeriods.descriptor($0).label == "Q1" }!
        let index = courses.firstIndex { GradingPeriods.descriptor($0).label == "S1" }!
        for i in courses[index].sources.indices { courses[index].sources[i].grade.percent = 99 }
        XCTAssertNil(GradingPeriods.semesterScale(for:quarter,semester:courses[index],among:courses))
        let undated = source(.schoology)
        XCTAssertNil(GradingPeriods.semester(for:Reconciler.reconcile([undated])[0],among:courses))
    }
}



extension GradeCoreTests {
    func testExplicitGradedNodeResolvesNewCatalogKindWithoutCrossKindGuessing() throws {
        func parse(_ items: String) throws -> SourceCourse {
            try ProviderParsing.schoology(section:fixture("schoology-section"),grades:fixture("schoology-grades"),items:Data(items.utf8),categories:fixture("schoology-categories"))[0]
        }
        let node = "\"id\":500,\"grade_item_id\":10,\"type\":\"external_tool\",\"title\":\"Catalog title\",\"grading_period\":1,\"grading_category\":2,\"max_points\":100"
        let course = try parse("{\"assignment\":[{\(node)}]}")
        XCTAssertEqual(course.assignments[0].title, "Catalog title")
        XCTAssertEqual(course.assignments[0].source.fields["type"], "assignment")
        let direct = node.replacingOccurrences(of:"\"id\":500,\"grade_item_id\":10", with:"\"id\":10")
        XCTAssertEqual(try parse("{\"assignment\":[{\(direct)}]}").assignments[0].title, "Catalog title")
        for field in ["\"max_points\":100", "\"grading_category\":2", "\"grading_period\":1"] {
            let conflicting = node.replacingOccurrences(of:field,with:field.components(separatedBy:":")[0] + ":999")
            XCTAssertEqual(try parse("{\"assignment\":[{\(conflicting)}]}").assignments[0].title, "Untitled assignment")
        }
        let typed = node.replacingOccurrences(of:"external_tool",with:"discussion")
        XCTAssertEqual(try parse("{\"assignment\":[{\(typed)}]}").assignments[0].title, "Untitled assignment")
        XCTAssertEqual(try parse("{\"assignment\":[{\(node)},{\(node)}]}").assignments[0].title, "Untitled assignment")
    }
}

extension GradeCoreTests {
    func testExamPresentationBelongsOnlyToItsUniqueClosingQuarter() {
        let courses = Reconciler.reconcile(Demo.periodSources())
        func quarter(_ label: String) -> Course { courses.first { GradingPeriods.descriptor($0).label == label }! }
        XCTAssertTrue(GradingPeriods.exams(for:quarter("Q1"), among:courses).isEmpty)
        XCTAssertTrue(GradingPeriods.exams(for:quarter("Q3"), among:courses).isEmpty)
        let q2 = quarter("Q2"), q4 = quarter("Q4")
        let exam1 = GradingPeriods.exams(for:q2, among:courses), exam2 = GradingPeriods.exams(for:q4, among:courses)
        XCTAssertEqual(exam1.count, 1); XCTAssertEqual(exam2.count, 1)
        XCTAssertNotEqual(exam1[0].id, exam2[0].id)
        XCTAssertEqual(GradingPeriods.semester(for:exam1[0], among:courses)?.id, GradingPeriods.semester(for:q2, among:courses)?.id)
        XCTAssertEqual(q2.calculationSource.assignments.count, 2)
        var duplicate = q2; duplicate.id += ":duplicate"
        XCTAssertTrue(GradingPeriods.exams(for:q2, among:courses + [duplicate]).isEmpty)
    }

    func testUpdateLabelsKeep24HourCheckAndUseMonthsAfter30Days() {
        let now = Demo.now
        XCTAssertTrue(GradeUpdateAge(date:now.addingTimeInterval(-23.999 * 3600),now:now).fresh)
        XCTAssertFalse(GradeUpdateAge(date:now.addingTimeInterval(-24 * 3600),now:now).fresh)
        XCTAssertEqual(GradeUpdateAge(date:now.addingTimeInterval(-30 * 86400),now:now).text,"updated 30 days ago")
        XCTAssertEqual(GradeUpdateAge(date:now.addingTimeInterval(-31 * 86400),now:now).text,"updated 1 month ago")
        XCTAssertEqual(GradeUpdateAge(date:now.addingTimeInterval(-60 * 86400),now:now).text,"updated 2 months ago")
        XCTAssertEqual(GradeUpdateAge(date:now.addingTimeInterval(-90 * 86400),now:now).text,"updated 3 months ago")
    }
}
