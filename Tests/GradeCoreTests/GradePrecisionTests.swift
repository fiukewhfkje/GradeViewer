import XCTest
@testable import GradeCore

final class GradePrecisionTests: XCTestCase {
    private func source(_ scores: [Double]) -> SourceCourse {
        SourceCourse(source:Provenance(.schoology,"precision-fixture"),title:"Synthetic course",term:Term(id:"quarter",name:"Quarter"),
                     grade:OverallGrade(percent:80),assignments:scores.enumerated().map { index,score in
            SourceAssignment(source:Provenance(.schoology,"score-\(index)"),title:"Quiz \(index)",updated:Date(timeIntervalSince1970:Double(index+1)*1000),score:Score(earned:score,possible:100))
        },method:.points,fetched:Date(timeIntervalSince1970:3000))
    }
    func testReconstructionUsesMatchingObservationWithinTheSameAssignmentInterval() throws {
        for first in [89.991,89.996,90.004,90.009] {
            let raw=source([first,160-first])
            let observation=GradeHistorySnapshot(date:Date(timeIntervalSince1970:1500),grade:OverallGrade(percent:90),provider:.schoology)
            let current=GradeHistorySnapshot(date:raw.fetched,grade:raw.grade,provider:.schoology)
            let course=Course(id:raw.id,sources:[raw],history:[observation,current])
            let curve=GradeCurve(points:GradeProgression.points(for:course,among:[course]))
            XCTAssertEqual(curve.nodes.map(\.value),[90,90,80,80])
            XCTAssertEqual(course.history,[observation,current],"Presentation cannot rewrite observed history")
            XCTAssertEqual(raw.assignments.first?.score.earned,first)
        }
    }
    func testRealOneHundredthObservedChangesAndNewAssignmentChangesRemainVisible() {
        var raw=source([90,90.01]);raw.grade.percent=90.005
        let first=GradeHistorySnapshot(date:Date(timeIntervalSince1970:1100),grade:OverallGrade(percent:90),provider:.schoology)
        let changed=GradeHistorySnapshot(date:Date(timeIntervalSince1970:1700),grade:OverallGrade(percent:90.01),provider:.schoology)
        let course=Course(id:raw.id,sources:[raw],history:[first,changed])
        let curve=GradeCurve(points:GradeProgression.points(for:course,among:[course]))
        XCTAssertEqual(curve.nodes.first { $0.date == changed.date }?.value,90.01)
        XCTAssertEqual(curve.nodes.first { $0.date == raw.assignments[0].updated }?.value,90)
        XCTAssertEqual(curve.nodes.first { $0.date == raw.assignments[1].updated }?.value,90.005)
    }
    func testRoundingAnchorDoesNotReplaceALargeObservedDifference() {
        let raw=source([90.009,69.991])
        let different=GradeHistorySnapshot(date:Date(timeIntervalSince1970:1500),grade:OverallGrade(percent:89),provider:.schoology)
        let course=Course(id:raw.id,sources:[raw],history:[different])
        let curve=GradeCurve(points:GradeProgression.points(for:course,among:[course]))
        XCTAssertEqual(curve.nodes.map(\.value),[90.009,89,80])
    }
    func testHistoryRecordsExactHundredthChangesDespiteBinarySubtraction() throws {
        var raw=source([90,90]);raw.grade.percent=90.01
        let old=Reconciler.reconcile([raw])
        raw.grade.percent=90.02
        let refreshed=Reconciler.reconcile([raw],previous:old)
        XCTAssertEqual(refreshed[0].history.count,2)
        XCTAssertEqual(refreshed[0].history.last?.grade.percent,90.02)
    }
}
