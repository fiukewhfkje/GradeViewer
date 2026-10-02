import XCTest
@testable import GradeCore

final class MatchingAuditTests: XCTestCase {
    private func course(_ provider: ProviderID, section: String, quarter: Int = 1, year: Int = 2026) -> SourceCourse {
        let start = ProviderParsing.date("\(year)-\(quarter == 1 ? "08-20" : "10-16")")!
        let end = ProviderParsing.date("\(year)-\(quarter == 1 ? "10-15" : "12-20")")!
        let fields = provider == .schoology ? ["grade_section_id": section] : ["section_id": section, "school_id": "school"]
        return SourceCourse(source: Provenance(provider, "\(section):\(quarter)", fields: fields), title: "Physics", teacher: "Taylor", term: Term(id: "Q\(quarter)", name: "Q\(quarter)", start: start, end: end))
    }
    func testPhysicalSectionCannotLinkToDifferentSectionsInDifferentQuarters() {
        let rows = [course(.schoology, section: "s", quarter: 1), course(.schoology, section: "s", quarter: 2), course(.infiniteCampus, section: "a", quarter: 1), course(.infiniteCampus, section: "b", quarter: 2)]
        XCTAssertEqual(Reconciler.reconcile(rows).count, 4)
        XCTAssertEqual(Reconciler.reconcile(rows.reversed()).count, 4)
    }
    func testAmbiguousPhysicalSectionDoesNotMergeOnlyItsUnambiguousQuarter() {
        let rows = [course(.schoology, section: "s", quarter: 1), course(.schoology, section: "s", quarter: 2), course(.infiniteCampus, section: "a", quarter: 1), course(.infiniteCampus, section: "a", quarter: 2), course(.infiniteCampus, section: "b", quarter: 1)]
        XCTAssertEqual(Reconciler.reconcile(rows).count, 5)
    }
    func testSavedMappingCannotOverrideKnownTeacherOrYearConflicts() {
        let a = course(.schoology, section: "s")
        var b = course(.infiniteCampus, section: "c", year: 2025)
        let map = [a.id: b.id, b.id: a.id]
        XCTAssertEqual(Reconciler.reconcile([a,b], mappings: map).count, 2)
        b.term = a.term; b.teacher = "Someone else"
        XCTAssertEqual(Reconciler.reconcile([a,b], mappings: map).count, 2)
    }
    func testUnknownAssignmentTitlesNeverSupplyCourseMatchEvidence() {
        var a = course(.schoology, section: "s"), b = course(.infiniteCampus, section: "c")
        a.teacher = ""; b.teacher = ""; a.term = Term(id: "a", name: "Unknown A"); b.term = Term(id: "b", name: "Unknown B")
        a.source.fields = [:]; b.source.fields = [:]
        for possible in [10.0, 100.0] {
            a.assignments.append(SourceAssignment(source: Provenance(.schoology, String(possible)), title: "Untitled assignment", score: Score(earned: 1, possible: possible)))
            b.assignments.append(SourceAssignment(source: Provenance(.infiniteCampus, String(possible)), title: "Untitled assignment", score: Score(earned: 1, possible: possible)))
        }
        XCTAssertEqual(Reconciler.reconcile([a,b]).count, 2)
    }
    func testCategoryFallbackCannotBorrowAnotherQuarterOrExam() {
        let a = course(.infiniteCampus, section: "c")
        var b = course(.schoology, section: "s", quarter: 2)
        b.term.start = nil; b.term.end = nil
        let rows = ["Quiz 1", "Quiz 2"].enumerated().map { index, title in SourceAssignment(source: Provenance(.schoology, String(index)), title: title, score: Score(earned: 8, possible: 10)) }
        b.assignments = rows; b.categories = [GradingCategory(id: "q", name: "Quizzes")]
        var campus = a; campus.assignments = rows.map { row in var copy = row; copy.source.provider = .infiniteCampus; return copy }
        let canonical = Reconciler.reconcile([campus])[0]
        XCTAssertNil(AssignmentGrouping.schoologySource(for: canonical, among: [b]))
        b.term.name = "Exam"; XCTAssertNil(AssignmentGrouping.schoologySource(for: canonical, among: [b]))
    }
    func testRepeatedAssignmentLabelsAreNotUniqueCourseEvidence() {
        var a = course(.schoology, section: "s"), b = course(.infiniteCampus, section: "c")
        a.source.fields = [:]; b.source.fields = [:]; a.teacher = ""; b.teacher = ""
        a.term = Term(id:"a", name:"Period A"); b.term = Term(id:"b", name:"Period B")
        for i in 0..<4 {
            let title = i < 2 ? "Quiz" : "Homework"
            a.assignments.append(SourceAssignment(source:Provenance(.schoology, String(i)), title:title, score:Score(earned:8, possible:10)))
            b.assignments.append(SourceAssignment(source:Provenance(.infiniteCampus, String(i)), title:title, score:Score(earned:8, possible:10)))
        }
        XCTAssertEqual(Reconciler.reconcile([a,b]).count, 2)
    }
    func testMissingPointsOrUnknownTitlesCannotMergeAssignments() {
        var a = course(.schoology, section: "s"), b = course(.infiniteCampus, section: "c")
        for title in ["Untitled assignment", "Quiz 1"] {
            a.assignments = [SourceAssignment(source:Provenance(.schoology, "a"), title:title, due:Demo.now, score:Score(earned:8))]
            b.assignments = [SourceAssignment(source:Provenance(.infiniteCampus, "b"), title:title, due:Demo.now, score:Score(earned:8))]
            XCTAssertEqual(Reconciler.reconcile([a,b])[0].assignments.count, 2)
        }
    }
    func testUnknownPeriodWithPhysicalIDsStillRequiresDirectAssignmentEvidence() {
        var a = course(.schoology, section:"s"), b = course(.infiniteCampus, section:"c")
        a.teacher = ""; b.teacher = ""; a.term.name = "Fall 2026"
        for i in 0..<2 {
            a.assignments.append(SourceAssignment(source:Provenance(.schoology,String(i)),title:"Quiz \(i)",score:Score(earned:8,possible:10)))
            b.assignments.append(SourceAssignment(source:Provenance(.infiniteCampus,String(i)),title:"Quiz \(i)",score:Score(earned:8,possible:10)))
        }
        XCTAssertEqual(Reconciler.reconcile([a,b]).count,1)
    }
    func testDifferentLabelsForSameQuarterRemainVisibleAndFutureYearDoesNot() {
        let campus = course(.infiniteCampus, section:"c")
        var schoology = course(.schoology, section:"unmatched")
        schoology.term.name = "Q1: 2026-08-20 - 2026-10-15"; schoology.title = "Biology"
        let future = course(.schoology, section:"future", year:2027)
        let courses = Reconciler.reconcile([campus,schoology,future])
        let now = ProviderParsing.date("2026-10-01")!
        XCTAssertEqual(CourseSelection.visible(courses,term:"Q1",at:now).count,2)
        XCTAssertEqual(CourseSelection.visible(courses,term:schoology.term.name,at:now).count,2)
    }
    func testSemesterOnlyDistrictGetsActualPeriodChoicesWithoutChangingQuarterUI() {
        var a = course(.schoology,section:"s"), b = course(.schoology,section:"s", quarter:2)
        a.term.name = "Semester 1"; b.term.name = "Semester 2"
        let semesters = Reconciler.reconcile([a,b])
        XCTAssertEqual(GradingPeriods.assignmentPeriods(for:semesters[0],among:semesters).count,2)
        let quarters = Reconciler.reconcile(Demo.periodSources())
        XCTAssertEqual(GradingPeriods.assignmentPeriods(for:quarters[0],among:quarters).map { GradingPeriods.descriptor($0).kind },[.quarter,.quarter,.quarter,.quarter])
    }
    func testUndatedLegacyPeriodsRetainFullCourseAssignmentView() {
        var a = course(.infiniteCampus,section:"c"), b = course(.infiniteCampus,section:"c",quarter:2)
        a.term = Term(id:"a",name:"Fall 2026"); b.term = Term(id:"b",name:"Past quarter")
        let courses = Reconciler.reconcile([a,b])
        XCTAssertTrue(GradingPeriods.assignmentPeriods(for:courses[0],among:courses).isEmpty)
    }
}
