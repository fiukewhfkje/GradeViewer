import XCTest
@testable import GradeCore
final class GradeCoreTests: XCTestCase {
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
    func testCampusParsingZeroAndExtraCredit() throws {
        let courses = try ProviderParsing.campus(grades: fixture("campus-grades"), details: ["100": fixture("campus-detail")])
        XCTAssertEqual(courses.count, 1); XCTAssertEqual(courses[0].grade.percent, 0); XCTAssertEqual(courses[0].grade.letter, "F")
        XCTAssertEqual(courses[0].assignments[0].score.earned, 0); XCTAssertEqual(courses[0].assignments[1].score.possible, 0); XCTAssertEqual(courses[0].source.fields["detail_id"], "100")
        XCTAssertEqual(try GradeCalculator.percent(course: courses[0]), 5)
    }
    func testCampusDetailRouteUsesSectionIDRatherThanCourseOpaqueID() throws {
        let summary = try ProviderParsing.campus(grades: fixture("campus-grades"))
        XCTAssertEqual(summary[0].source.fields["detail_id"], "100")
        let full = try ProviderParsing.campus(grades: fixture("campus-grades"), details: ["100": fixture("campus-detail")])
        XCTAssertEqual(full[0].assignments.count, 2)
    }
    func testMalformedPayloadDoesNotBecomeEmptySuccess() { XCTAssertThrowsError(try ProviderParsing.campus(grades: Data("{}".utf8))); XCTAssertThrowsError(try ProviderParsing.campus(grades: Data("[{\"foo\":1}]".utf8))) }
    func testTermsAndTasksStaySeparate() throws {
        let payload = Data("""
        [{"schoolID":1,"terms":[{"termID":1,"termName":"Fall","courses":[{"sectionID":1,"_id":"a","courseName":"Math","gradingTasks":[{"taskID":1,"progressPercent":90},{"taskID":2,"progressPercent":80}]}]},{"termID":2,"termName":"Spring","courses":[{"sectionID":1,"_id":"b","courseName":"Math","gradingTasks":[{"taskID":1,"progressPercent":70}]}]}]}]
        """.utf8)
        let rows = try ProviderParsing.campus(grades: payload); XCTAssertEqual(rows.count, 3); XCTAssertEqual(Set(rows.map(\.id)).count, 3)
    }
    func testReconciliationPreservesDisagreementsAndDeduplicates() {
        let a = source(.schoology, percent: 90), b = source(.infiniteCampus, percent: 88)
        let merged = Reconciler.reconcile([a, b]); XCTAssertEqual(merged.count, 1); XCTAssertEqual(merged[0].assignments.count, 2); XCTAssertEqual(merged[0].sources.count, 2); XCTAssertEqual(merged[0].display.grade.percent, 88); XCTAssertTrue(merged[0].disagrees)
        XCTAssertEqual(merged[0].assignments[0].sources.count, 2)
    }
    func testAmbiguousCourseAndAssignmentNamesStaySeparate() {
        let a = source(.schoology), b = source(.infiniteCampus, id: "a"), c = source(.infiniteCampus, id: "b")
        XCTAssertEqual(Reconciler.reconcile([a,b,c]).count, 3)
        var missingTeacher = b; missingTeacher.teacher = ""; missingTeacher.assignments = []; XCTAssertEqual(Reconciler.reconcile([a,missingTeacher]).count, 2)
        var repeated = b; var extra = repeated.assignments[0]; extra.source.id = "extra"; repeated.assignments.append(extra)
        XCTAssertEqual(Reconciler.reconcile([a,repeated])[0].assignments.count, 4)
    }
    func testDuplicateProviderIDsAndStableCourseIdentity() {
        let a = source(); var duplicate = a; duplicate.fetched = a.fetched.addingTimeInterval(10); duplicate.grade.percent = 95
        let old = Reconciler.reconcile([a]); let new = Reconciler.reconcile([a,duplicate,source(.infiniteCampus)], previous: old)
        XCTAssertEqual(new.count, 1); XCTAssertEqual(new[0].id, old[0].id); XCTAssertEqual(new[0].sources.count, 2); XCTAssertEqual(new[0].sources.first { $0.source.provider == .schoology }?.grade.percent, 95)
    }
    func testScoreDisagreementRetainsZero() {
        var b = source(.infiniteCampus); b.assignments[0].score.earned = 0
        let merged = Reconciler.reconcile([source(),b])[0]; let quiz = merged.assignments.first { $0.display.title == "Quiz 1" }!
        XCTAssertEqual(quiz.display.score.earned, 0); XCTAssertTrue(quiz.disagrees)
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
    func testPartialFailureAndSuccessfulRemoval() {
        let old = Reconciler.reconcile([source(),source(.infiniteCampus)])
        let updated = Reconciler.refreshing(previous: old, successful: [.schoology: [source(percent: 95)]])
        XCTAssertEqual(updated[0].sources.count, 2); XCTAssertEqual(updated[0].display.grade.percent, 90)
        let removed = Reconciler.refreshing(previous: old, successful: [.schoology: []]); XCTAssertEqual(removed.count, 1); XCTAssertEqual(removed[0].sources.count, 1)
        XCTAssertEqual(Reconciler.refreshing(previous: old, successful: [:])[0].assignments.count, 2)
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
        XCTAssertThrowsError(try ReadOnlyHTTP(origin: URL(string: "https://user:secret@example.com/campus/")!))
        XCTAssertEqual(ReadOnlyHTTP.retryAfter("42"), 42)
    }
}
extension GradeCoreTests {
    func testMergedCourseSplitKeepsUniqueIDs() {
        let a = source(), b = source(.infiniteCampus)
        let old = Reconciler.reconcile([a,b])
        var changed = b; changed.teacher = "Another teacher"
        let split = Reconciler.reconcile([a,changed], previous: old)
        XCTAssertEqual(Set(split.map(\.id)).count, 2)
    }
    func testMergedAssignmentSplitKeepsUniqueIDs() {
        let a = source(), b = source(.infiniteCampus), old = Reconciler.reconcile([a,b])
        var changed = b; changed.assignments[0].score.possible = 20
        let new = Reconciler.reconcile([a,changed], previous: old)[0]
        XCTAssertEqual(new.assignments.count, 3); XCTAssertEqual(Set(new.assignments.map(\.id)).count, 3)
    }
}
extension GradeCoreTests {
    func testExplicitCourseMappingWorksWithDifferentNamesAndTerms() {
        let a = source(); var b = source(.infiniteCampus); b.title = "District Advanced Science"; b.term.name = "Semester 1"; b.teacher = ""
        XCTAssertEqual(Reconciler.reconcile([a,b]).count, 2)
        let mappings = [a.id:b.id,b.id:a.id]; let matched = Reconciler.reconcile([a,b], mappings: mappings)
        XCTAssertEqual(matched.count, 1); XCTAssertEqual(matched[0].assignments.count, 2); XCTAssertEqual(matched[0].sources.count, 2)
    }
}


extension GradeCoreTests {
    func testAutomaticCourseMatchingUsesUniqueAssignmentEvidenceAcrossLabels() {
        let a = source()
        var b = source(.infiniteCampus)
        b.teacher = ""; b.title = "Physics 1 AP"; b.term.name = "Q1"
        let matched = Reconciler.reconcile([a, b])
        XCTAssertEqual(matched.count, 1); XCTAssertEqual(matched[0].sources.count, 2)
        XCTAssertEqual(matched[0].calculationSource.id, b.id)
        var duplicate = b; duplicate.source.id = "other-section"
        XCTAssertEqual(Reconciler.reconcile([a, b, duplicate]).count, 3)
        b.assignments = Array(b.assignments.prefix(1))
        XCTAssertEqual(Reconciler.reconcile([a, b]).count, 2)
    }
    func testAutomaticMatchingRejectsDisjointTermsAndConflictingTeachers() {
        var a = source(), b = source(.infiniteCampus)
        a.term.start = Date(timeIntervalSince1970: 10); a.term.end = Date(timeIntervalSince1970: 20)
        b.term.start = Date(timeIntervalSince1970: 30); b.term.end = Date(timeIntervalSince1970: 40)
        XCTAssertEqual(Reconciler.reconcile([a, b]).count, 2)
        b.term = a.term; b.teacher = "Another teacher"
        XCTAssertEqual(Reconciler.reconcile([a, b]).count, 2)
    }
    func testNewAutomaticMergeKeepsCampusIdentityAndHistoryRegardlessOfCacheOrder() {
        let schoology = source()
        var campus = source(.infiniteCampus); campus.teacher = ""
        let oldSchoology = Reconciler.reconcile([schoology], now: Demo.now)[0]
        var oldCampus = Reconciler.reconcile([campus], now: Demo.now)[0]
        oldCampus.order = 3
        let matched = Reconciler.reconcile([schoology, campus], previous: [oldSchoology, oldCampus], now: Demo.now.addingTimeInterval(20))
        XCTAssertEqual(matched.count, 1)
        XCTAssertEqual(matched[0].id, oldCampus.id)
        XCTAssertEqual(matched[0].history, oldCampus.history)
        XCTAssertEqual(matched[0].order, 3)
    }
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
        let first = GradeHistorySnapshot(date: Date(timeIntervalSince1970: 1_000), grade: OverallGrade(percent: 100), provider: .infiniteCampus)
        let second = GradeHistorySnapshot(date: Date(timeIntervalSince1970: 10_000), grade: OverallGrade(percent: 91.92), provider: .infiniteCampus)
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
    func testCampusScoreModifiedDateWinsOverFutureDueDate() throws {
        let detail = Data("""
        {"details":[{"task":{"termID":1,"taskID":1},"categories":[{"groupID":1,"name":"Points","isWeighted":false,"assignments":[{"objectSectionID":1,"assignmentName":"Quiz","scorePoints":"100","totalPoints":100,"dueDate":"2026-10-01","scoreModifiedDate":"2026-09-14T12:00:00Z"},{"objectSectionID":2,"assignmentName":"Lab","scorePoints":"100","totalPoints":100,"dueDate":"2026-09-15","scoreModifiedDate":"2026-09-15T12:00:00Z"}]}]}]}
        """.utf8)
        let summary = Data("""
        [{"schoolID":1,"terms":[{"termID":1,"termName":"Fall","courses":[{"sectionID":100,"courseName":"Science","gradingTasks":[{"taskID":1,"progressPercent":100}]}]}]}]
        """.utf8)
        let fetched = Date(timeIntervalSince1970: 1_790_000_000)
        let course = try XCTUnwrap(ProviderParsing.campus(grades: summary, details: ["100":detail], fetched: fetched).first)
        XCTAssertNotNil(course.assignments[0].updated)
        XCTAssertEqual(course.assignments[0].updated, ProviderParsing.date("2026-09-14T12:00:00Z"))
        XCTAssertEqual(GradeProgression.calculated(course, before: fetched).count, 2)
    }
    func testGradeCurveSamplesContinuouslyWithoutOvershootingAndKeepsFlatGradesFlat() throws {
        let start = Date(timeIntervalSince1970: 1_000_000)
        func point(_ seconds: Double, _ value: Double) -> GradeProgressionPoint {
            GradeProgressionPoint(GradeHistorySnapshot(date: start.addingTimeInterval(seconds), grade: OverallGrade(percent: value), provider: .infiniteCampus))
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
    func testSchoologyCategoryGroupingHidesUngradedAndDoesNotMergeAmbiguousCourses() {
        let campus = source(.infiniteCampus)
        let course = Reconciler.reconcile([campus])[0]
        var schoology = source(); schoology.teacher = ""
        schoology.categories[0].name = "Schoology quizzes"; schoology.categories[1].name = "Schoology homework"
        schoology.assignments.append(assignment(id: "ungraded", earned: nil))
        let selected = AssignmentGrouping.schoologySource(for: course, among: [schoology])
        XCTAssertNotNil(selected)
        let groups = AssignmentGrouping.groups(for: course, schoology: selected)
        XCTAssertEqual(groups.map(\.title), ["Schoology quizzes", "Schoology homework"])
        XCTAssertEqual(groups.flatMap(\.assignments).count, 2)
        XCTAssertTrue(groups.flatMap(\.assignments).allSatisfy { $0.display.score.isGraded })
        XCTAssertEqual(Reconciler.reconcile([campus,schoology]).count, 1, "Two shared assignments now support automatic course matching")
        var duplicate = schoology; duplicate.source.id = "second-section"
        XCTAssertNil(AssignmentGrouping.schoologySource(for: course, among: [schoology,duplicate]))
    }
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
    func testOverviewIncludesGradedSchoologyOnlyWorkWithoutChangingCampusCalculation() {
        let campus = source(.infiniteCampus), course = Reconciler.reconcile([campus])[0]
        var schoology = source(); schoology.teacher = ""
        var extra = assignment(id: "extra", earned: 1, possible: 1, category: "practice")
        extra.updated = Demo.now.addingTimeInterval(-7 * 3600)
        schoology.assignments.append(extra)
        let overview = AssignmentGrouping.overview(for: course, schoology: schoology)
        XCTAssertEqual(overview.count, 3)
        XCTAssertEqual(overview.first?.display.title, extra.title)
        XCTAssertEqual(course.calculationSource.assignments.count, 2)
    }
    func testSchoologyCatalogDoesNotDuplicateAnUndatedGradeDuringCategoryMatching() {
        var campus = source(.infiniteCampus); campus.assignments[0].due = nil
        var schoology = source(); schoology.assignments[0].due = nil
        schoology.assignments[0].source.fields = ["assignment_id":"one", "type":"assignment"]
        var metadata = schoology.assignments[0]; metadata.source = Provenance(.schoology,"catalog:one",fields:["id":"one", "type":"assignment"]); metadata.score.earned = nil
        schoology.assignmentCatalog = [metadata]
        let course = Reconciler.reconcile([campus])[0]
        XCTAssertEqual(AssignmentGrouping.overview(for:course,schoology:schoology).count,2)
        XCTAssertTrue(AssignmentGrouping.overview(for:course,schoology:schoology).allSatisfy { $0.sources.contains { $0.source.provider == .infiniteCampus } })
    }
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
    func testPastQuarterWorkUsesSchoologyCatalogWithoutDuplicateScoresOrUngradedRows() {
        var current = source(.infiniteCampus)
        current.source.fields = ["section_id":"section", "task_id":"task"]
        current.assignments[0].source.fields["objectSectionID"] = "one"
        current.assignments[1].source.fields["objectSectionID"] = "two"
        var past = current; past.source.id = "past"; past.term = Term(id:"past",name:"Past quarter")
        var duplicate = past.assignments[0]; duplicate.source.id = "past:one"
        var historical = assignment(.infiniteCampus, id:"old",earned:75,category:"practice")
        historical.title = "Past quarter lab"; historical.source.fields["objectSectionID"] = "old"
        past.assignments = [duplicate,historical,assignment(.infiniteCampus,id:"future",earned:nil)]
        let courses = Reconciler.reconcile([current,past])
        let course = courses.first { $0.display.source.id == current.source.id }!
        let full = AssignmentGrouping.fullCourse(for: course, among: courses)
        XCTAssertEqual(full.assignments.count,3)
        XCTAssertEqual(full.calculationSource.assignments.count,2)
        var schoology = source(); schoology.categories[1].name = "Labs"
        var metadata = historical; metadata.source = Provenance(.schoology,"catalog:old"); metadata.score.earned = nil
        schoology.assignmentCatalog = [metadata]
        XCTAssertNotNil(AssignmentGrouping.schoologySource(for: course, among: [schoology]))
        let groups = AssignmentGrouping.groups(for: full, schoology: schoology)
        XCTAssertTrue(groups.first { $0.title == "Labs" }!.assignments.contains { $0.display.title == "Past quarter lab" })
        XCTAssertEqual(groups.flatMap(\.assignments).count,3)
        XCTAssertTrue(groups.flatMap(\.assignments).allSatisfy { $0.display.score.isGraded })
    }
}
