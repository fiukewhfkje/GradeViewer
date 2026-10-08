import XCTest
@testable import GradeCore

final class UntitledAssignmentTests: XCTestCase {
    private func sources() -> (SourceCourse, SourceCourse) {
        var campus = Demo.courses()[0].display
        campus.assignments[0].title = "Unit 2 Test"
        var schoology = campus
        schoology.source = Provenance(.schoology, "fixture-owner")
        schoology.assignments = campus.assignments.map { item in
            var copy = item; copy.source = Provenance(.schoology, "fixture:" + item.source.id)
            return copy
        }
        schoology.assignments[0].title = "Untitled assignment"
        schoology.assignments[0].due = nil
        schoology.assignments[0].updated = campus.assignments[0].updated!.addingTimeInterval(60)
        return (campus, schoology)
    }
    private func overview(_ campus: SourceCourse, _ schoology: SourceCourse) -> [Assignment] {
        AssignmentGrouping.overview(for: Reconciler.reconcile([campus, schoology])[0], schoology: schoology)
    }
    func testUntitledDuplicateUsesNamedCalculatorIdentityWithoutMutatingSources() throws {
        let (campus, schoology) = sources()
        let course = Reconciler.reconcile([campus, schoology])[0]
        XCTAssertEqual(course.assignments.count, 13, "Original provider evidence is retained.")
        let rows = overview(campus, schoology)
        XCTAssertEqual(rows.count, 12)
        let row = try XCTUnwrap(rows.first { $0.display.title == "Unit 2 Test" })
        XCTAssertEqual(row.sources.count, 2)
        XCTAssertEqual(row.sources.first { $0.source.provider == .infiniteCampus }?.id, campus.assignments[0].id)
        XCTAssertEqual(AssignmentGrouping.groups(for: course, schoology: schoology).flatMap(\.assignments).count, 12)
        XCTAssertEqual(course.calculationSource.assignments, campus.assignments)
        var hypothesis = Hypothesis(); hypothesis.scores[campus.assignments[0].id] = 120.5
        XCTAssertEqual(try GradeCalculator.hypotheticalPercent(course: campus, hypothesis: hypothesis), 95.8 + (120.5 - 91.8) / 12, accuracy: 0.000001)
        var reordered = schoology; reordered.assignments.reverse()
        XCTAssertEqual(rows.map(\.id), overview(campus, reordered).map(\.id))
    }
    func testEqualScoresWithoutRecordedMatchingUpdateDayStaySeparate() {
        let (campus, original) = sources()
        for date in [nil, campus.assignments[0].updated!.addingTimeInterval(86400), Date(timeIntervalSince1970: .infinity), Date(timeIntervalSince1970: 1e30)] {
            var schoology = original; schoology.assignments[0].updated = date
            XCTAssertEqual(overview(campus, schoology).count, 13)
        }
    }
    func testMissingAndZeroPointTotalsNeverRecoverUntitledRows() {
        let (originalCampus, originalSchoology) = sources()
        for possible in [nil, 0.0] {
            var campus = originalCampus, schoology = originalSchoology
            campus.assignments[0].score.possible = possible; schoology.assignments[0].score.possible = possible
            XCTAssertEqual(overview(campus, schoology).count, 13)
        }
    }
    func testAmbiguousScoresOnEitherProviderStaySeparate() {
        let (originalCampus, originalSchoology) = sources()
        var campus = originalCampus
        var extra = campus.assignments[0]; extra.source.id += ":another"; extra.title = "Another test"
        campus.assignments.append(extra)
        XCTAssertEqual(overview(campus, originalSchoology).count, 14)
        var schoology = originalSchoology
        extra = schoology.assignments[0]; extra.source.id += ":another"
        schoology.assignments.append(extra)
        XCTAssertEqual(overview(originalCampus, schoology).count, 14)
    }
    func testConflictingTitlesDueDatesScoresAndPeriodsStaySeparate() {
        let (campus, original) = sources()
        var variants: [SourceCourse] = []
        var schoology = original; schoology.assignments[0].title = "Different test"; variants.append(schoology)
        schoology = original; schoology.assignments[0].due = campus.assignments[0].due!.addingTimeInterval(86400); variants.append(schoology)
        schoology = original; schoology.assignments[0].score.earned! += 1; variants.append(schoology)
        schoology = original; schoology.assignments[0].score.possible! += 1; variants.append(schoology)
        schoology = original; schoology.assignments[0].excluded = true; variants.append(schoology)
        schoology = original; schoology.assignments[0].multiplier = 2; variants.append(schoology)
        schoology = original; schoology.teacher = "Someone else"; variants.append(schoology)
        for source in variants {
            let course = Reconciler.reconcile([campus])[0]
            XCTAssertTrue(AssignmentGrouping.overview(for: course, schoology: source).contains { $0.sources.count == 1 && $0.sources[0].id == source.assignments[0].id })
        }
    }
    func testKnownDifferentPeriodsCannotRecoverAnUntitledTitle() {
        var (campus, schoology) = sources()
        campus.term = Term(id: "q1", name: "Q1", start: Demo.now, end: Demo.now.addingTimeInterval(86400))
        schoology.term = Term(id: "q2", name: "Q2", start: Demo.now.addingTimeInterval(172800), end: Demo.now.addingTimeInterval(259200))
        let course = Reconciler.reconcile([campus])[0]
        XCTAssertEqual(AssignmentGrouping.overview(for: course, schoology: schoology).count, 13)
    }
    func testExistingNamedCounterpartCannotAbsorbAnotherUntitledGrade() {
        let (campus, original) = sources()
        var schoology = original
        var named = schoology.assignments[0]; named.source.id += ":named"; named.title = "Unit 2 Test"
        named.updated = named.updated!.addingTimeInterval(86400)
        schoology.assignments.append(named)
        let rows = overview(campus, schoology)
        XCTAssertEqual(rows.count, 13)
        XCTAssertTrue(rows.contains { !$0.display.hasTitle })
        XCTAssertEqual(rows.first { $0.display.title == "Unit 2 Test" }?.sources.count, 2)
    }
    func testCatalogTitleDoesNotCreateAnotherScoredCounterpart() {
        let (campus, original) = sources()
        var schoology = original
        var catalog = schoology.assignments[0]
        catalog.title = "Unit 2 Test"; catalog.source.id += ":catalog"; catalog.score.earned = nil
        schoology.assignmentCatalog = [catalog]
        let rows = overview(campus, schoology)
        XCTAssertEqual(rows.count, 12)
        XCTAssertFalse(rows.contains { !$0.display.hasTitle })
        XCTAssertTrue(rows.first { $0.display.title == "Unit 2 Test" }!.sources.contains { $0.id == schoology.assignments[0].id })
    }
}
