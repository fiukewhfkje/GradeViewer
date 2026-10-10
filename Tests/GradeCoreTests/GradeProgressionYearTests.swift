import XCTest
@testable import GradeCore

final class GradeProgressionYearTests: XCTestCase {
    private func date(_ value: String) -> Date { ProviderParsing.date(value)! }
    private func period(_ name: String, owner: String = "section", start: String, end: String, scores: [(String, Double)]) -> SourceCourse {
        let id = owner + ":" + name
        let assignments = scores.enumerated().map { index, row in
            SourceAssignment(source: Provenance(.schoology, id + ":" + String(index)), title: "Assignment " + String(index), updated: date(row.0), score: Score(earned: row.1, possible: 100))
        }
        return SourceCourse(source: Provenance(.schoology, id, fields: ["grade_section_id":owner]), title: "Synthetic course", term: Term(id:name, name:name, start:date(start), end:date(end)), assignments: assignments, method:.points, fetched:date("2027-01-03"))
    }
    func testMidyearFreshInstallReconstructsEarlierQuartersWithoutRollupDuplicates() throws {
        let q1 = period("Q1", start:"2026-08-20", end:"2026-10-30", scores:[("2026-08-25",100),("2026-09-20",80)])
        let q2 = period("Q2", start:"2026-11-01", end:"2027-01-04", scores:[("2026-11-05",70),("2026-12-10",90)])
        let q3 = period("Q3", start:"2027-01-05", end:"2027-03-20", scores:[])
        var rollup = period("S1", start:"2026-08-20", end:"2027-01-04", scores:[])
        rollup.assignments = q1.assignments + q2.assignments
        let other = period("Q1", owner:"another-section", start:"2026-08-20", end:"2026-10-30", scores:[("2026-08-21",1)])
        let courses = Reconciler.reconcile([q2,rollup,other,q3,q1])
        XCTAssertTrue(courses.allSatisfy { $0.history.isEmpty }, "Reconstructed grades never become observations")
        let selected = try XCTUnwrap(courses.first { $0.display.term.name == "Q2" })
        let points = GradeProgression.points(for:selected, among:courses)
        XCTAssertEqual(points.map { $0.grade.percent }, [100,90,70,80,80])
        XCTAssertEqual(points.map(\.date), [date("2026-08-25"),date("2026-09-20"),date("2026-11-05"),date("2026-12-10"),q2.fetched])
        XCTAssertEqual(Set(points.map(\.id)).count, points.count)
        let earlier = try XCTUnwrap(courses.first { $0.id == q1.id })
        XCTAssertEqual(GradeProgression.points(for:earlier, among:courses).map(\.id), points.map(\.id))
        let observation = GradeHistorySnapshot(date:date("2026-09-10"), grade:OverallGrade(percent:60), provider:.schoology)
        var retained = courses
        let old = try XCTUnwrap(retained.firstIndex { $0.id == q1.id })
        retained[old].history = [observation, GradeHistorySnapshot(date:q1.fetched, grade:OverallGrade(percent:90), provider:.schoology)]
        let curve = GradeCurve(points:GradeProgression.points(for:selected, among:retained))
        XCTAssertEqual(curve.nodes.first { $0.date == observation.date }?.value, 60)
        XCTAssertEqual(curve.nodes.last?.value, selected.display.grade.percent)
        XCTAssertEqual(retained[old].history.count, 2, "A completed-period fetch stays archived without changing the current-year endpoint")
    }
    func testSemesterOnlyYearKeepsSingleEarlierAssignmentAndDoesNotInventDates() throws {
        let s1 = period("S1", start:"2026-08-20", end:"2027-01-04", scores:[("2026-09-01",90)])
        var s2 = period("S2", start:"2027-01-05", end:"2027-05-28", scores:[("2027-01-10",100),("2027-01-15",80)])
        s2.fetched = date("2027-02-01")
        var courses = Reconciler.reconcile([s1,s2])
        let selected = try XCTUnwrap(courses.first { $0.id == s2.id })
        let points = GradeProgression.points(for:selected, among:courses)
        XCTAssertEqual(points.map { $0.grade.percent }, [90,100,90,90])
        XCTAssertEqual(points.first?.date,date("2026-09-01"))
        let index = try XCTUnwrap(courses.firstIndex { $0.id == s1.id })
        courses[index].sources[0].assignments[0].updated = nil
        XCTAssertFalse(GradeProgression.points(for:selected, among:courses).contains { $0.date == date("2026-09-01") })
        XCTAssertTrue(courses.allSatisfy { $0.history.isEmpty })
    }
}
