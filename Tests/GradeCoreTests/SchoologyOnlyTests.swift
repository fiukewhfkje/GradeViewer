import XCTest
@testable import GradeCore

final class SchoologyOnlyTests: XCTestCase {
    func testStudentHiddenRulesAndNullOverallPreservePointsDefaults() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures")
        func fixture(_ name: String) throws -> Data { try Data(contentsOf: root.appendingPathComponent(name + ".json")) }
        let categories = Data("{\"grading_category\":[{\"id\":2,\"title\":\"Tests\",\"weight\":100}]}".utf8)
        var grades = try JSONSerialization.jsonObject(with: fixture("schoology-grades")) as! [String:Any]
        var sections = grades["section"] as! [[String:Any]]
        sections[0]["final_grade"] = [["period_id":"p1","grade":NSNull(),"scale_id":17]]; grades["section"] = sections
        let courses = try ProviderParsing.schoology(section: fixture("schoology-section"), grades: JSONSerialization.data(withJSONObject:grades), items: fixture("schoology-items"), categories: categories)
        XCTAssertEqual(courses[0].method, .weightedCategories)
        XCTAssertNil(courses[0].source.fields["unsupported_overall_scale"])
        let resolved = SchoologyGrades.resolved(courses)[0]
        XCTAssertEqual(resolved.grade.percent,0); XCTAssertTrue(resolved.hasCalculatedGrade)
        XCTAssertTrue(Reconciler.reconcile(courses)[0].history.isEmpty)
        sections[0]["final_grade"] = [["period_id":"p1","grade":"  ","scale_id":17]]; grades["section"] = sections
        let blank = try ProviderParsing.schoology(section: fixture("schoology-section"), grades: JSONSerialization.data(withJSONObject:grades), items: fixture("schoology-items"), categories:categories)
        XCTAssertNil(blank[0].grade.letter); XCTAssertTrue(SchoologyGrades.resolved(blank)[0].hasCalculatedGrade)
        sections[0]["final_grade"] = [["period_id":"p1","grade":999,"scale_id":17]]; grades["section"] = sections
        let custom = try ProviderParsing.schoology(section: fixture("schoology-section"), grades: JSONSerialization.data(withJSONObject:grades), items: fixture("schoology-items"), categories:categories)
        XCTAssertNil(custom[0].grade.percent, "A custom-scale score is not a percentage")
        XCTAssertEqual(custom[0].source.fields["unsupported_overall_scale"], "true")
        XCTAssertEqual(SchoologyGrades.resolved(custom)[0].grade.percent, 0, "Available assignment points still calculate independently")
        let invalid = Data("{\"grading_category\":[{\"id\":2,\"title\":\"Tests\",\"weight\":100,\"calculation_type\":9}]}".utf8)
        let unknown = try ProviderParsing.schoology(section: fixture("schoology-section"), grades: JSONSerialization.data(withJSONObject:grades), items: fixture("schoology-items"), categories:invalid)
        XCTAssertEqual(unknown[0].method,.unknown); XCTAssertNil(SchoologyGrades.resolved(unknown)[0].grade.percent)
    }
    func testReportedTotalWinsOverStudentHiddenRulesAndSemesterStillCalculates() {
        var source = Demo.courses()[0].display
        source.source.fields["grade_rules_inferred"] = "true"
        XCTAssertFalse(SchoologyGrades.resolved([source])[0].hasCalculatedGrade)
        var periods = Demo.periodSources()
        let q1 = periods.firstIndex { GradingPeriods.descriptor($0).label == "Q1" }!
        let s1 = periods.firstIndex { GradingPeriods.descriptor($0).label == "S1" }!
        periods[q1].grade = OverallGrade(); periods[q1].source.fields["grade_rules_inferred"] = "true"
        periods[s1].grade = OverallGrade()
        XCTAssertTrue(SchoologyGrades.resolved(periods)[s1].hasCalculatedGrade)
    }
    func testMissingReportedGradeUsesSupportedSchoologyRulesWithoutObservedHistory() throws {
        var source = Demo.courses()[0].display; source.grade = OverallGrade()
        let course = Reconciler.reconcile([source])[0]
        XCTAssertEqual(course.display.grade.percent!, try GradeCalculator.percent(course: source), accuracy: 1e-9)
        XCTAssertTrue(course.display.hasCalculatedGrade); XCTAssertTrue(GradeCalculator.isReliable(course.display))
        XCTAssertTrue(course.history.isEmpty); XCTAssertFalse(GradeProgression.calculated(course.display, before: source.fetched).isEmpty)
        var updated = course.display; updated.assignments[0].score.earned = 50
        let refreshed = Reconciler.reconcile([updated], previous: [course])[0]
        XCTAssertEqual(refreshed.display.grade.percent!, try GradeCalculator.percent(course: updated), accuracy: 1e-9)
        XCTAssertTrue(refreshed.history.isEmpty)
        var h = Hypothesis(); h.scores[updated.assignments[0].id] = 100
        XCTAssertGreaterThan(try GradeCalculator.hypotheticalPercent(course: refreshed.display, hypothesis: h), refreshed.display.grade.percent!)
    }
    func testReportedNumericOrLetterGradeIsNeverReplacedByCalculation() {
        var source = Demo.courses()[0].display; source.grade = OverallGrade(percent: 12.3)
        XCTAssertEqual(Reconciler.reconcile([source])[0].display.grade.percent, 12.3)
        XCTAssertFalse(Reconciler.reconcile([source])[0].display.hasCalculatedGrade)
        source.grade = OverallGrade(letter: "Pass")
        XCTAssertNil(Reconciler.reconcile([source])[0].display.grade.percent)
        XCTAssertEqual(Reconciler.reconcile([source])[0].display.grade.letter, "Pass")
    }
    func testCalculatedEndpointFollowsImportedHistoryWithoutInventingAssignmentDates() throws {
        var source = Demo.courses()[0].display; source.grade = OverallGrade()
        for i in source.assignments.indices { source.assignments[i].updated = nil; source.assignments[i].due = nil }
        let resolved = SchoologyGrades.resolved([source])[0]
        let observation = GradeHistorySnapshot(date: source.fetched.addingTimeInterval(-1), grade: OverallGrade(percent: 99), provider: .schoology)
        let calculated = GradeProgression.calculated(resolved, before: source.fetched)
        XCTAssertEqual(calculated.count, 1); XCTAssertTrue(calculated[0].calculated)
        XCTAssertEqual(calculated[0].date, source.fetched)
        let curve = GradeCurve(points: [GradeProgressionPoint(observation)] + calculated)
        XCTAssertEqual(curve.nodes.last?.value, resolved.grade.percent)
        XCTAssertEqual(observation.grade.percent, 99)
    }
    func testUnknownIncompleteRulesCannotInventTotalsButOverallScaleDoesNotBlockPoints() throws {
        var source = Demo.courses()[0].display; source.grade = OverallGrade(); source.method = .unknown
        XCTAssertNil(Reconciler.reconcile([source])[0].display.grade.percent)
        source.method = .points; source.assignments[0].score.possible = nil
        XCTAssertNil(Reconciler.reconcile([source])[0].display.grade.percent)
        source = Demo.courses()[0].display; source.grade = OverallGrade(); source.source.fields["unsupported_overall_scale"] = "true"
        XCTAssertEqual(Reconciler.reconcile([source])[0].display.grade.percent!, try GradeCalculator.percent(course:source), accuracy:1e-9)
    }
    func testLetterAssignmentCannotSilentlyDisappearFromCalculatedTotal() {
        var source = Demo.courses()[0].display; source.grade = OverallGrade()
        source.assignments[0].score.earned = nil; source.assignments[0].score.letter = "Proficient"
        XCTAssertThrowsError(try GradeCalculator.percent(course: source))
        XCTAssertNil(SchoologyGrades.resolved([source])[0].grade.percent)
        source.assignments[0].excluded = true
        XCTAssertNotNil(SchoologyGrades.resolved([source])[0].grade.percent)
    }
    func testCalculatedSemesterUsesExplicitWeightsAndRejectsIncompleteGradedChild() {
        var sources = Demo.periodSources()
        let semester = sources.firstIndex { GradingPeriods.descriptor($0).label == "S1" }!
        sources[semester].grade = OverallGrade()
        let resolved = SchoologyGrades.resolved(sources)
        XCTAssertEqual(resolved[semester].grade.percent, 85); XCTAssertTrue(resolved[semester].hasCalculatedGrade)
        let q2 = sources.firstIndex { GradingPeriods.descriptor($0).label == "Q2" }!
        sources[q2].term.weight = nil
        XCTAssertNil(SchoologyGrades.resolved(sources)[semester].grade.percent)
        sources[q2].term.weight = 33.333; sources[q2].grade = OverallGrade(); sources[q2].method = .unknown
        XCTAssertNil(SchoologyGrades.resolved(sources)[semester].grade.percent)
    }
    func testSameTitlesAreDistinctButRepeatedSourceIDsAreDeduplicated() {
        var source = Demo.courses()[0].display
        source.assignments[1].title = source.assignments[0].title
        source.assignments.append(source.assignments[0])
        let course = Reconciler.reconcile([source, source])[0]
        XCTAssertEqual(course.sources.count, 1); XCTAssertEqual(course.assignments.count, 12)
        XCTAssertEqual(AssignmentGrouping.overview(for: course).filter { $0.display.title == source.assignments[0].title }.count, 2)
        XCTAssertEqual(AssignmentGrouping.groups(for: course).flatMap(\.assignments).count, 12)
    }
    func testFailedSnapshotRetainsCacheAndSuccessfulEmptyRemovesIt() {
        let old = Demo.courses()
        XCTAssertEqual(Reconciler.refreshing(previous: old, successful: [:]).map(\.id), old.map(\.id))
        XCTAssertTrue(Reconciler.refreshing(previous: old, successful: [.schoology: []]).isEmpty)
        XCTAssertEqual(Reconciler.refreshing(previous: old, successful: [.schoology: [old[0].display]])[0].id, old[0].id)
    }
    func testUnknownExamDatesCannotInventQuarterAssociation() {
        var courses = Reconciler.reconcile(Demo.periodSources())
        let q2 = courses.first { GradingPeriods.descriptor($0).label == "Q2" }!
        let index = courses.firstIndex { GradingPeriods.exams(for: q2, among: courses).first?.id == $0.id }!
        courses[index].sources[0].term.start = nil; courses[index].sources[0].term.end = nil
        XCTAssertTrue(GradingPeriods.exams(for: q2, among: courses).isEmpty)
    }
}

final class SchoologyUpgradeTests: XCTestCase {
    private func fixture(missingTitle: Bool = false, ambiguous: Bool = false, linked: Bool = true) throws -> (Data, Data, SourceCourse, String) {
        var source = Demo.courses()[0].display
        if missingTitle {
            var catalog = source.assignments[0]; catalog.score.earned = nil
            source.assignmentCatalog = [catalog]; source.assignments[0].title = "Untitled assignment"
        }
        var old = Demo.courses()[0]; old.id = "retained-course"; old.sources = [source]
        var raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(old)) as! [String: Any]
        let current = raw["sources"] as! [[String: Any]]
        var retired = current[0], provenance = retired["source"] as! [String: Any]
        provenance["provider"] = "infiniteCampus"; retired["source"] = provenance
        var rows = retired["assignments"] as! [[String: Any]]
        for i in rows.indices {
            var provenance = rows[i]["source"] as! [String: Any]; provenance["provider"] = "infiniteCampus"
            rows[i]["source"] = provenance
        }
        rows[0]["title"] = Demo.courses()[0].display.assignments[0].title
        if ambiguous { var duplicate = rows[0]; var p = duplicate["source"] as! [String: Any]; p["id"] = "ambiguous"; duplicate["source"] = p; rows.append(duplicate) }
        retired["assignments"] = rows; raw["sources"] = [retired, current[0]]
        raw["assignments"] = rows.enumerated().map { i, item in
            ["id":"old:\(i)", "sources": linked && i < source.assignments.count ? [item, (current[0]["assignments"] as! [[String:Any]])[i]] : [item]] as [String: Any]
        }
        var history = raw["history"] as! [[String:Any]]
        for i in history.indices { history[i]["provider"] = "infiniteCampus" }
        raw["history"] = history
        let oldID = "infiniteCampus:" + source.assignments[0].source.id
        var scenario = Hypothesis(); scenario.scores[source.assignments[0].id] = 101; scenario.ignored.insert(source.assignments[1].id)
        scenario.added = [SourceAssignment(source: Provenance(.schoology,"hypothetical:fixture"), title:"Added grade", score: Score(earned:50,possible:100))]
        scenario.scores[scenario.added[0].id] = 70
        var h = try JSONSerialization.jsonObject(with: JSONEncoder().encode(scenario)) as! [String:Any]
        h["scores"] = [oldID:101, "infiniteCampus:hypothetical:fixture":70]
        h["ignored"] = ["infiniteCampus:" + source.assignments[1].source.id]
        var added = h["added"] as! [[String:Any]], p = added[0]["source"] as! [String:Any]
        p["provider"] = "infiniteCampus"; added[0]["source"] = p; h["added"] = added
        return (try JSONSerialization.data(withJSONObject:raw), try JSONSerialization.data(withJSONObject:h), source, oldID)
    }
    func testUpgradeRetainsIdentityHistoryAndMapsEditsDropsAndAddedGrades() throws {
        let (payload, scenario, source, _) = try fixture()
        XCTAssertTrue(try SchoologyUpgrade.needsUpgrade([payload]))
        let result = try SchoologyUpgrade.prepare([payload], scenarios:["retained-course":scenario])
        let course = try XCTUnwrap(result.courses.first), h = try XCTUnwrap(result.scenarios[course.id])
        XCTAssertEqual(course.id,"retained-course"); XCTAssertEqual(course.sources.count,1)
        XCTAssertEqual(course.display.assignments,source.assignments)
        XCTAssertEqual(course.history.count,9); XCTAssertTrue(course.history.allSatisfy { $0.provider == "infiniteCampus" })
        XCTAssertEqual(h.scores[source.assignments[0].id],101); XCTAssertTrue(h.ignored.contains(source.assignments[1].id))
        XCTAssertEqual(h.added.count,1); XCTAssertEqual(h.scores[h.added[0].id],70)
        XCTAssertFalse(try SchoologyUpgrade.needsUpgrade([JSONEncoder().encode(course)]))
    }
    func testMissingTitleAndScenarioRecoverOnlyWithUniqueEvidence() throws {
        let (payload, scenario, source, _) = try fixture(missingTitle:true,linked:false)
        let result = try SchoologyUpgrade.prepare([payload],scenarios:["retained-course":scenario])
        XCTAssertEqual(result.courses[0].display.assignments[0].title,Demo.courses()[0].display.assignments[0].title)
        XCTAssertEqual(result.scenarios["retained-course"]?.scores[source.assignments[0].id],101)
        let (ambiguous, h, original, oldID) = try fixture(missingTitle:true,ambiguous:true,linked:false)
        let unresolved = try SchoologyUpgrade.prepare([ambiguous],scenarios:["retained-course":h])
        XCTAssertFalse(unresolved.courses[0].display.assignments[0].hasTitle)
        XCTAssertNil(unresolved.scenarios["retained-course"]?.scores[original.assignments[0].id])
        XCTAssertEqual(unresolved.scenarios["retained-course"]?.scores[oldID],101,"Keep ambiguous archived edits without applying them to another assignment")
    }
    func testMalformedCacheOrScenarioFailsBeforeMutation() throws {
        let (payload, _, _, _) = try fixture()
        XCTAssertThrowsError(try SchoologyUpgrade.prepare([payload],scenarios:["retained-course":Data("[]".utf8)]))
        XCTAssertThrowsError(try SchoologyUpgrade.needsUpgrade([Data("{}".utf8)]))
    }
    func testRepeatedArchivedTitleDoesNotApplyAmbiguousEditToOneSchoologyRow() throws {
        let (payload, scenario, source, oldID) = try fixture(ambiguous:true,linked:false)
        let result = try SchoologyUpgrade.prepare([payload],scenarios:["retained-course":scenario])
        XCTAssertNil(result.scenarios["retained-course"]?.scores[source.assignments[0].id])
        XCTAssertEqual(result.scenarios["retained-course"]?.scores[oldID],101)
    }
    func testInvalidArchivedDateFailsWithoutOverflowOrDataLoss() throws {
        let (payload, _, _, _) = try fixture()
        var raw = try JSONSerialization.jsonObject(with: payload) as! [String:Any]
        var sources = raw["sources"] as! [[String:Any]]; sources[1]["fetched"] = 1e100; raw["sources"] = sources
        XCTAssertThrowsError(try SchoologyUpgrade.prepare([JSONSerialization.data(withJSONObject:raw)],scenarios:[:]))
    }
}
