import XCTest
@testable import GradeCore

final class PeriodGradeEstimateTests: XCTestCase {
    private func sources(q1Weight: Double = 40, q2Weight: Double = 35, examWeight: Double = 25, exam: Double? = nil) -> [SourceCourse] {
        var sources = Demo.periodSources()
        for index in sources.indices {
            switch sources[index].term.id {
            case "Q1": sources[index].term.weight=q1Weight
            case "Q2":
                sources[index].term.weight=q2Weight; sources[index].grade=OverallGrade()
                for row in sources[index].assignments.indices { sources[index].assignments[row].score.earned=nil }
            case "Exam S1": sources[index].term.weight=examWeight; sources[index].grade=OverallGrade(percent:exam)
            case "S1":
                let activeWeight=q1Weight+q2Weight+(exam == nil ? 0 : examWeight)
                sources[index].grade=OverallGrade(percent:(90*q1Weight+70*q2Weight+(exam ?? 0)*examWeight)/activeWeight)
            default: break
            }
        }
        return sources
    }
    private func estimate(_ sources: [SourceCourse]) throws -> PeriodGradeEstimate? {
        let courses=Reconciler.reconcile(sources)
        return GradingPeriods.estimatedGrade(for:try XCTUnwrap(courses.first { $0.display.term.id == "Q2" }),among:courses)
    }
    func testUnequalQuarterAndExamWeightsWithBlankScoredAndZeroExam() throws {
        for exam: Double? in [nil,64,0,115] {
            let input=sources(exam:exam), estimate=try XCTUnwrap(estimate(input))
            XCTAssertEqual(estimate.percent,70,accuracy:0.000000001)
            XCTAssertEqual(estimate.excludesBlankExam,exam == nil)
            XCTAssertEqual(Set(estimate.knownPeriodLabels),exam == nil ? ["Q1"] : ["Q1","Exam"])
            XCTAssertEqual(estimate.semesterLabel,"S1")
        }
        // Weights are relative; no assumption that the denominator is 100.
        XCTAssertEqual(try XCTUnwrap(estimate(sources(q1Weight:4,q2Weight:7,examWeight:2,exam:50))).percent,70,accuracy:0.000000001)
    }
    func testMissingAmbiguousOrUnsupportedInputsDoNotCreateAnEstimate() throws {
        let mutations: [(inout [SourceCourse]) -> Void] = [
            { $0[0].grade=OverallGrade() },
            { $0[0].source.fields["grade_basis"]="calculated" },
            { $0[0].source.fields["overall_override"]="true" },
            { $0[1].term.weight=nil },
            { $0[1].term.weight=0 },
            { $0[1].term.weight = .nan },
            { $0[1].term.weight = -1 },
            { $0[1].grade=OverallGrade(letter:"P") },
            { $0[1].source.fields["unsupported_overall_scale"]="true" },
            { $0[1].assignments=[] },
            { $0[1].term.start=ProviderParsing.date("2026-10-18") },
            { $0[4].source.fields["grade_basis"]="calculated" },
            { $0[4].source.fields["overall_override"]="true" },
            { $0[4].grade=OverallGrade(percent:0) }, // Would require a negative Q2.
            { $0[5].grade=OverallGrade(letter:"P") },
            { $0[5].source.fields["unsupported_overall_scale"]="true" },
            { $0[5].term.weight=nil },
            { $0[5].assignments=[SourceAssignment(source:Provenance(.schoology,"exam"),title:"Exam",score:Score(earned:5))] },
            { var extra=$0[0]; extra.source.id="overlapping-quarter"; extra.term.id="other-quarter"; $0.append(extra) },
            { var extra=$0[4]; extra.source.id="overlapping-semester"; extra.term.id="other-semester"; $0.append(extra) }
        ]
        for (index,mutate) in mutations.enumerated() {
            var input=sources(); mutate(&input)
            XCTAssertNil(try estimate(input),"Unsafe input \(index)")
        }
        var indistinguishable=sources(); indistinguishable[4].grade.percent=90
        XCTAssertNil(try estimate(indistinguishable),"Q2 may simply be empty when the known-only total already matches")
    }
    func testActualRefreshReplacesEstimateWithoutWritingScoresOrHistory() throws {
        let input=sources(), courses=Reconciler.reconcile(input)
        let quarter=try XCTUnwrap(courses.first { $0.display.term.id == "Q2" })
        let encoder=JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let before=try encoder.encode(quarter)
        XCTAssertNotNil(GradingPeriods.estimatedGrade(for:quarter,among:courses))
        XCTAssertEqual(try encoder.encode(quarter),before)
        XCTAssertTrue(quarter.history.isEmpty)
        XCTAssertTrue(quarter.assignments.allSatisfy { $0.display.score.earned == nil })
        var actual=input
        actual[1].grade=OverallGrade(percent:70)
        for index in actual[1].assignments.indices { actual[1].assignments[index].score.earned=70 }
        let refreshed=Reconciler.refreshing(previous:courses,successful:[.schoology:actual])
        XCTAssertNil(GradingPeriods.estimatedGrade(for:try XCTUnwrap(refreshed.first { $0.id == quarter.id }),among:refreshed))
        XCTAssertNil(try estimate(sources().map { s in var s=s; if s.term.id == "S1" { s.grade=OverallGrade() }; return s }),"Future semesters without a reported total are not inferred")
    }
    func testReportedCategoryRulesAndPeriodWeightsHaveIndependentMeanings() throws {
        func data(_ value: String) -> Data { Data(value.utf8) }
        let parsed=try ProviderParsing.schoology(
            section:data(#"{"id":1,"options":{"weighted_grading_categories":1}}"#),
            grades:data(#"{"section":[{"section_id":1,"period":[{"period_id":"p1","assignment":[{"assignment_id":10,"category_id":2,"grade":50,"max_points":100},{"assignment_id":11,"category_id":3,"grade":100,"max_points":100}]}],"final_grade":[{"period_id":"p1","grade":65,"scale_id":0,"weight":37}]}]}"#),
            items:data(#"{"assignment":[]}"#),
            categories:data(#"{"grading_category":[{"id":2,"title":"Tests","weight":70,"calculation_type":2,"drop_lowest":0},{"id":3,"title":"Work","weight":30,"calculation_type":2,"drop_lowest":0}]}"#))[0]
        XCTAssertEqual(parsed.term.weight,37)
        XCTAssertEqual(parsed.categories.map(\.weight),[70,30])
        XCTAssertEqual(parsed.method,.weightedCategories)
        XCTAssertEqual(try GradeCalculator.percent(course:parsed),65)
        XCTAssertTrue(GradeCalculator.isReliable(parsed))
    }
    func testZeroWeightExamAndExtraCreditQuarterRemainValid() throws {
        XCTAssertEqual(try XCTUnwrap(estimate(sources(examWeight:0,exam:0))).percent,70,accuracy:0.000000001)
        var input=sources(q1Weight:20,q2Weight:70,examWeight:10,exam:95)
        input[4].grade.percent=(90.0*20.0+112.0*70.0+95.0*10.0)/100.0
        XCTAssertEqual(try XCTUnwrap(estimate(input)).percent,112,accuracy:0.000000001)
    }
    func testNullFinalWeightUsesMetadataAndExplicitOverrideIsFlagged() throws {
        func data(_ value: String) -> Data { Data(value.utf8) }
        let parsed=try ProviderParsing.schoology(
            section:data(#"{"id":1,"options":{"weighted_grading_categories":0}}"#),
            grades:data(#"{"section":[{"section_id":1,"period":[{"period_id":"p1","assignment":[]}],"final_grade":[{"period_id":"p1","grade":0,"scale_id":0,"weight":null,"override":0}]}]}"#),
            items:data(#"{"assignment":[]}"#),categories:data(#"{"grading_category":[]}"#),
            periods:data(#"{"grading_period":[{"id":1,"title":"Q1","weight":23}]}"#))[0]
        XCTAssertEqual(parsed.term.weight,23)
        XCTAssertEqual(parsed.source.fields["overall_override"],"true")
        XCTAssertEqual(parsed.grade.percent,0,"An override stays reported; only inverse estimation is withheld")
    }
    func testRoundedInputsDoNotClaimRecoveredHundredths() throws {
        var input=sources(q1Weight:45,q2Weight:45,examWeight:10)
        input[0].grade.percent=93.97;input[4].grade.percent=81.99
        let result=try XCTUnwrap(estimate(input))
        XCTAssertEqual(result.percent,70.01,accuracy:0.000000001,"Preserve the inverse arithmetic internally")
        XCTAssertEqual(result.maximumFractionDigits,1)
        XCTAssertEqual(result.roundingUncertainty,0.03,accuracy:0.000000001)
        XCTAssertEqual((result.percent*10).rounded()/10,70,"Presentation cannot pretend rounded inputs establish a hundredth")
    }
    func testSmallTargetWeightReducesPrecisionOrWithholdsUnstableEstimate() throws {
        let result=try XCTUnwrap(estimate(sources(q1Weight:95,q2Weight:5,examWeight:0)))
        XCTAssertEqual(result.maximumFractionDigits,0)
        XCTAssertGreaterThan(result.roundingUncertainty,0.05)
        XCTAssertNil(try estimate(sources(q1Weight:99,q2Weight:1,examWeight:0)))
    }
}
