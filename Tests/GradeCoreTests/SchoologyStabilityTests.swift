import XCTest
@testable import GradeCore

final class SchoologyStabilityTests: XCTestCase {
    private func date(_ value: String) -> Date { ISO8601DateFormatter().date(from:value)! }
    private var eastern: Calendar { var c = Calendar(identifier:.gregorian); c.timeZone = TimeZone(identifier:"America/New_York")!; return c }
    private func parse(points: Any? = 100, type: String = "assignment", item: [String:Any]) throws -> SourceCourse {
        var row: [String:Any] = ["assignment_id":10,"type":type,"category_id":2,"grade":80,"timestamp":1792080000]
        if let points { row["max_points"] = points }
        func data(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject:value) }
        return try ProviderParsing.schoology(
            section:data(["id":100,"course_title":"Synthetic course","options":["weighted_grading_categories":0]]),
            grades:data(["section":[["section_id":100,"period":[["period_id":"p1","assignment":[row]]]]]]),
            items:data(["assignment":[item]]), categories:data(["grading_category":[["id":2,"title":"Tests"]]]))[0]
    }
    func testNullBlankAndOmittedPointsRecoverCompatibleCatalogWithoutChangingEarned() throws {
        let item: [String:Any] = ["id":10,"type":"assignment","title":"Recovered quiz","max_points":100,"grading_category":2,"grading_period":1]
        for value: Any? in [nil,NSNull(),""] {
            let source = try parse(points:value,item:item)
            XCTAssertEqual(source.assignments[0].score,Score(earned:80,possible:100))
            XCTAssertEqual(try GradeCalculator.percent(course:source),80)
            XCTAssertEqual(source.assignments.count,1)
        }
        var conflicting=item; conflicting["grading_period"]=2
        XCTAssertNil(try parse(points:NSNull(),item:conflicting).assignments[0].score.possible)
    }
    func testZeroGradedNodeUsesDistinctColumnIDsAndRecoversTitle() throws {
        let item: [String:Any] = ["id":10,"grade_item_id":0,"type":"grade_column","title":"Synthetic column","max_points":100,"grading_category":2,"grading_period":1]
        let source=try parse(item:item)
        XCTAssertEqual(source.assignments[0].title,"Synthetic column")
        XCTAssertEqual(source.assignments[0].source.fields["assignment_id"],"10")
        XCTAssertEqual(source.assignmentCatalog?.first?.source.id,"100:catalog:grade_column:10")
        XCTAssertEqual(ProviderParsing.itemID(["id":11,"grade_item_id":"0"]),"11")
        XCTAssertEqual(ProviderParsing.itemID(["id":12,"grade_item_id":NSNull()]),"12")
        XCTAssertEqual(ProviderParsing.itemID(["id":13,"grade_item_id":14]),"14")
    }
    func testExternalToolWrapperRetainsExactTypedIdentityAndConflictGuards() throws {
        let item: [String:Any] = ["id":10,"grade_item_id":500,"type":"external_tool","title":"Synthetic external tool","max_points":100,"grading_category":2,"grading_period":1]
        let source=try parse(type:"external_tool",item:item)
        XCTAssertEqual(source.assignments[0].title,"Synthetic external tool")
        XCTAssertEqual(source.assignments.count,1)
        for key in ["max_points","grading_category","grading_period"] {
            var invalid=item; invalid[key]=999
            XCTAssertFalse(try parse(type:"external_tool",item:invalid).assignments[0].hasTitle)
        }
        var invalid=item; invalid["type"]="discussion"
        XCTAssertFalse(try parse(type:"external_tool",item:invalid).assignments[0].hasTitle)
    }
    func testFinalQuarterCalendarDayStaysCurrentUntilLocalMidnight() throws {
        let courses=Reconciler.reconcile(Demo.periodSources())
        for time in ["2026-10-15T00:00:01Z","2026-10-15T20:21:00Z","2026-10-16T03:59:59Z"] {
            XCTAssertEqual(CourseSelection.preferredTerm(courses,at:date(time),calendar:eastern),"Q1")
        }
        XCTAssertEqual(CourseSelection.preferredTerm(courses,at:date("2026-10-16T04:00:00Z"),calendar:eastern),"Q2")
        let q1=try XCTUnwrap(courses.first { $0.display.term.id == "Q1" })
        XCTAssertTrue(GradingPeriods.includesHistory(q1.display,date:date("2026-10-15T20:21:00Z"),calendar:eastern))
        XCTAssertFalse(GradingPeriods.includesHistory(q1.display,date:date("2026-10-16T04:00:00Z"),calendar:eastern))
    }
    func testDatedLegacyTitleRestoresWholeDayWithoutExtendingExplicitTimestamps() throws {
        var source=Demo.periodSources()[0]
        source.source.fields.removeValue(forKey:"period_start_date_only"); source.source.fields.removeValue(forKey:"period_end_date_only")
        source.term.name="Q1: 2026-08-20 - 2026-10-15"
        XCTAssertTrue(GradingPeriods.contains(source,at:date("2026-10-16T03:59:59Z"),calendar:eastern))
        source.term.name="Q1"
        source.term.end=date("2026-10-15T12:00:00Z")
        XCTAssertFalse(GradingPeriods.contains(source,at:date("2026-10-15T12:00:01Z"),calendar:eastern))
        source.term.name="Q1: 2026-08-20 - 2026-10-15"
        source.term.end=date("2026-10-15T00:00:00Z")
        source.source.fields["period_end_date_only"]="false"
        XCTAssertFalse(GradingPeriods.contains(source,at:date("2026-10-15T00:00:01Z"),calendar:eastern),"Explicit midnight timestamps must not fall back to the legacy calendar-date heuristic")
    }
    func testDocumentedSectionMidnightStringsAreWholeDaysButZonedInstantsAreExact() throws {
        func data(_ value: String) -> Data { Data(value.utf8) }
        for end in ["2026-10-15 00:00:00","2026-10-15","2026-10-15T00:00:00Z"] {
            let source=try ProviderParsing.schoology(
                section:data(#"{"id":1,"options":{"weighted_grading_categories":0}}"#),
                grades:data(#"{"section":[{"section_id":1,"period":[{"period_id":"p1","assignment":[]}]}]}"#),
                items:data(#"{"assignment":[]}"#),categories:data(#"{"grading_category":[]}"#),
                periods:data("{\"grading_period\":[{\"id\":1,\"title\":\"Q1: 2026-08-20 - 2026-10-15\",\"start\":\"2026-08-20 00:00:00\",\"end\":\"\(end)\"}]}"))[0]
            XCTAssertEqual(GradingPeriods.contains(source,at:date("2026-10-16T03:59:59Z"),calendar:eastern),!end.hasSuffix("Z"))
            XCTAssertFalse(GradingPeriods.contains(source,at:date("2026-10-16T04:00:00Z"),calendar:eastern))
        }
    }
    func testSemesterFreshnessUsesRelatedAssignmentDatesInsteadOfOldHistory() throws {
        var courses=Reconciler.reconcile(Demo.periodSources())
        let semester=try XCTUnwrap(courses.firstIndex { $0.display.term.id == "S1" })
        let old=date("2026-08-01T12:00:00Z")
        courses[semester].history=[GradeHistorySnapshot(date:old,grade:OverallGrade(percent:50),provider:.schoology),GradeHistorySnapshot(date:old.addingTimeInterval(60),grade:OverallGrade(percent:55),provider:.schoology)]
        let presentation=GradingPeriods.presentation(for:courses[semester],among:courses)
        let expected=AssignmentGrouping.overview(for:presentation).compactMap { $0.display.updated }.max()
        XCTAssertNotNil(expected)
        XCTAssertEqual(AssignmentGrouping.updated(for:courses[semester],among:courses),expected)
    }
}

extension SchoologyStabilityTests {
    func testReportedTotalsUseVerifiedPercentScalesAndPreserveUnsupportedOrHiddenScales() throws {
        var source=Demo.courses()[0].display
        source.grade=OverallGrade()
        source.source.fields["reported_numeric_total"]="92.125"
        source.source.fields["reported_scale_id"]="17"
        source.source.fields["unsupported_overall_scale"]="true"
        for type in [0,1] {
            let resolved=try ProviderParsing.schoologyOveralls([source],scales:Data("{\"grading_scale\":[{\"id\":17,\"type\":\(type),\"hide_numeric\":0}]}".utf8))[0]
            XCTAssertEqual(resolved.grade.percent,92.125)
            XCTAssertFalse(SchoologyGrades.resolved([resolved])[0].hasCalculatedGrade)
        }
        for fields in ["\"type\":3","\"type\":1,\"hide_numeric\":1","\"type\":9"] {
            let unsupported=try ProviderParsing.schoologyOveralls([source],scales:Data("{\"grading_scale\":[{\"id\":17,\(fields)}]}".utf8))[0]
            XCTAssertNil(unsupported.grade.percent)
        }
        let ambiguous=try ProviderParsing.schoologyOveralls([source],scales:Data("{\"grading_scale\":[{\"id\":17,\"type\":1},{\"id\":17,\"type\":3}]}".utf8))[0]
        XCTAssertNil(ambiguous.grade.percent)
    }
    func testCachedScaleVerificationIsScopedBoundedAndDoesNotSlide() throws {
        let now=date("2026-10-15T20:00:00Z")
        var raw=Demo.periodSources()[0]; raw.grade=OverallGrade()
        raw.source.fields["reported_scale_id"]="17"; raw.source.fields["reported_numeric_total"]="92.125"
        var old=raw; old.source.fields["overall_scale_type"]="1"
        old.source.fields["overall_scale_verified_at"]=String(now.addingTimeInterval(-60).timeIntervalSince1970)
        let resolved=ProviderParsing.schoologyCachedOveralls([raw],previous:[old],at:now)[0]
        XCTAssertEqual(resolved.grade.percent,92.125)
        XCTAssertEqual(resolved.source.fields["overall_scale_verified_at"],old.source.fields["overall_scale_verified_at"])
        XCTAssertNil(ProviderParsing.schoologyCachedOveralls([raw],previous:[old],at:now.addingTimeInterval(3600))[0].grade.percent)
        var other=old; other.source.fields["section_id"]="another-section"
        XCTAssertNil(ProviderParsing.schoologyCachedOveralls([raw],previous:[other],at:now)[0].grade.percent)
        other=old; other.source.fields["overall_scale_type"]="0"
        XCTAssertNil(ProviderParsing.schoologyCachedOveralls([raw],previous:[old,other],at:now)[0].grade.percent)
    }
}

extension SchoologyStabilityTests {
    func testCourseOverallUsesReportedSemesterWhenQ2AssignmentScoreIsUnavailable() throws {
        var sources=Demo.periodSources()
        let q1=try XCTUnwrap(sources.firstIndex { $0.term.id == "Q1" })
        let q2=try XCTUnwrap(sources.firstIndex { $0.term.id == "Q2" })
        let s1=try XCTUnwrap(sources.firstIndex { $0.term.id == "S1" })
        for i in sources[q2].assignments.indices { sources[q2].assignments[i].score.earned=nil }
        sources[q2].grade=OverallGrade()
        // The provider reports an overall including work its assignment read omits.
        sources[s1].grade=OverallGrade(percent:85)
        let courses=Reconciler.reconcile(sources)
        let quarter=try XCTUnwrap(courses.first { $0.id == sources[q1].id })
        let summary=GradingPeriods.overall(for:quarter,among:courses)
        XCTAssertEqual(quarter.display.grade.percent,90)
        XCTAssertEqual(summary.display.grade.percent,85)
        XCTAssertFalse(summary.display.hasCalculatedGrade)
        XCTAssertTrue(courses.first { $0.id == sources[q2].id }!.assignments.allSatisfy { !$0.display.score.isGraded })
    }
}

extension SchoologyStabilityTests {
    func testRemovedProviderIdentitiesStayRemovedAcrossRefreshAndRestoreWithoutDataLoss() throws {
        var original=Demo.courses()[0]
        let removed=original.assignments[0].id
        original.removedAssignmentIDs=[removed]
        let restored=try JSONDecoder().decode(Course.self,from:JSONEncoder().encode(original))
        var changed=original.display; changed.assignments[0].score.earned=42
        let refreshed=Reconciler.refreshing(previous:[restored],successful:[.schoology:[changed]])[0]
        XCTAssertEqual(refreshed.removedAssignmentIDs,[removed])
        XCTAssertFalse(AssignmentGrouping.overview(for:refreshed).contains { $0.id == removed })
        XCTAssertFalse(refreshed.calculationSource.assignments.contains { $0.id == removed })
        XCTAssertEqual(refreshed.display.assignments,changed.assignments,"Keep the complete provider snapshot for provenance")
        XCTAssertEqual(refreshed.history,original.history)
        XCTAssertEqual(AssignmentGrouping.overview(for:refreshed).count,original.assignments.count-1)
        var undo=refreshed; undo.removedAssignmentIDs=nil
        XCTAssertTrue(AssignmentGrouping.overview(for:undo).contains { $0.id == removed })
        XCTAssertEqual(undo.calculationSource.assignments,changed.assignments)
        XCTAssertNil(Reconciler.reconcile([changed])[0].removedAssignmentIDs,"A fresh account must not inherit another installation's removals")
    }
    func testOldCoursePayloadWithoutRemovalFieldStillDecodes() throws {
        var raw=try JSONSerialization.jsonObject(with:JSONEncoder().encode(Demo.courses()[0])) as! [String:Any]
        raw.removeValue(forKey:"removedAssignmentIDs")
        let course=try JSONDecoder().decode(Course.self,from:JSONSerialization.data(withJSONObject:raw))
        XCTAssertNil(course.removedAssignmentIDs)
        XCTAssertEqual(course.calculationSource.assignments,course.display.assignments)
    }
    func testAllAssignmentsShowsKnownUngradedRowsWithoutInventingGradesOrEmptyStubs() throws {
        var source=Demo.courses()[0].display
        let count=source.assignments.count
        var known=source.assignments[0]; known.source.id="known-ungraded"; known.title="Ungraded quiz"; known.score.earned=nil
        var stub=known; stub.source.id="empty-stub"; stub.title="Untitled assignment"
        source.assignments += [known,stub]
        let course=Reconciler.reconcile([source])[0]
        XCTAssertEqual(AssignmentGrouping.overview(for:course).count,count)
        XCTAssertEqual(AssignmentGrouping.all(for:course).count,count+1)
        XCTAssertEqual(AssignmentGrouping.groups(for:course,includeUngraded:true).flatMap(\.assignments).count,count+1)
        XCTAssertNil(AssignmentGrouping.all(for:course).last?.display.score.earned)
        XCTAssertFalse(AssignmentGrouping.all(for:course).contains { $0.id == stub.id })
        XCTAssertEqual(try GradeCalculator.percent(course:course.calculationSource),95.8,accuracy:0.000001)
    }
}
