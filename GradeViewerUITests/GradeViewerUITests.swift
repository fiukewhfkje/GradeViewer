import XCTest
final class GradeViewerUITests: XCTestCase {
    @MainActor func testMidyearFreshInstallShowsEarlierSchoologyProgression() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--period-fixture", "--midyear-history-fixture", "--screen=detail", "--record-chart-touch"]
        app.launch()
        let chart = app.otherElements["grade-chart"]
        XCTAssertTrue(chart.waitForExistence(timeout:10))
        let reconstructed = NSPredicate(format:"value == %@", "5 grades, latest 80%")
        expectation(for:reconstructed, evaluatedWith:chart)
        waitForExpectations(timeout:10)
        chart.coordinate(withNormalizedOffset:CGVector(dx:0,dy:0.5)).press(forDuration:0.4)
        XCTAssertEqual(chart.value as? String, "Released; last touch 90%")
        let attachment = XCTAttachment(screenshot:app.screenshot())
        attachment.name = "midyear-schoology-progression"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testSchoologyOnlySettingsAndConnectedAccountActions() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--screen=settings"]; app.launch()
        XCTAssertTrue(app.buttons["Schoology, Connect"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Campus'")).count, 0)
        XCTAssertTrue(app.buttons["Appearance, System"].exists)
        let overview = XCTAttachment(screenshot: app.screenshot()); overview.name = "schoology-only-settings"; overview.lifetime = .keepAlways; add(overview)
        app.buttons["Schoology, Connect"].tap()
        XCTAssertTrue(app.textFields["API key"].waitForExistence(timeout: 5)); XCTAssertTrue(app.secureTextFields["API secret"].exists)
        app.terminate(); app.launchArguments = ["--demo", "--connected-settings-fixture", "--screen=settings"]; app.launch()
        app.buttons["Schoology, Connected"].tap()
        XCTAssertTrue(app.buttons["Update sign-in"].waitForExistence(timeout: 5)); XCTAssertTrue(app.buttons["Disconnect"].exists)
        XCTAssertFalse(app.textFields["API key"].exists); XCTAssertFalse(app.secureTextFields["API secret"].exists)
        app.buttons["Disconnect"].tap(); app.buttons["Disconnect and remove its saved grades"].tap()
        XCTAssertEqual(app.descendants(matching: .any)["connection-status"].value as? String, "Connected", "Demo never deletes a real connection")
    }
    @MainActor func testSchoologyAssignmentTotalKeepsNormalLabelAndEditing() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--calculated-fixture", "--screen=detail"]; app.launch()
        XCTAssertTrue(app.staticTexts["Course Grade"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Calculated Grade"].exists)
        XCTAssertFalse(app.staticTexts["Estimated Grade"].exists)
        let grade = app.descendants(matching: .any)["course-grade-value"]
        XCTAssertEqual(grade.label, "Course grade")
        let options = app.buttons["Options for 2-D Kinematics Quiz"]
        XCTAssertTrue(options.isEnabled); options.tap(); app.buttons["Edit Grade"].tap()
        let field = app.textFields["edit-score-field"]; XCTAssertTrue(field.waitForExistence(timeout: 5))
        replaceScore(field, with: "100"); app.buttons["save-score"].tap()
        XCTAssertTrue(app.staticTexts["100/100"].waitForExistence(timeout: 5)); XCTAssertEqual(grade.label, "What-If grade")
        let detail = XCTAttachment(screenshot: app.screenshot()); detail.name = "schoology-calculated-detail"; detail.lifetime = .keepAlways; add(detail)
    }
    @MainActor private func replaceScore(_ field: XCUIElement, with text: String) {
        field.tap()
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20) + text)
    }
    @MainActor func testRetainedAssignmentHasOneEditableRowInRecentAndAllAssignments() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--untitled-fixture", "--screen=detail"]; app.launch()
        let options = app.buttons["Options for Unit 2 Test"]
        XCTAssertTrue(options.waitForExistence(timeout: 10)); XCTAssertTrue(options.isEnabled)
        XCTAssertEqual(app.buttons.matching(identifier: "Options for Unit 2 Test").count, 1)
        XCTAssertFalse(app.staticTexts["Untitled assignment"].exists)
        options.tap(); app.buttons["Edit Grade"].tap()
        let field = app.textFields["edit-score-field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); replaceScore(field, with: "120.5")
        app.buttons["save-score"].tap()
        XCTAssertTrue(app.staticTexts["120.5/100"].waitForExistence(timeout: 5))
        let all = app.buttons["view-all-assignments"]; if !all.isHittable { app.swipeUp() }; all.tap()
        let category = app.buttons["Total Points"]; XCTAssertTrue(category.waitForExistence(timeout: 5)); category.tap()
        XCTAssertEqual(app.buttons.matching(identifier: "Options for Unit 2 Test").count, 1)
        XCTAssertFalse(app.staticTexts["Untitled assignment"].exists)
        XCTAssertTrue(app.staticTexts["120.5/100"].exists)
        options.tap(); app.buttons["Drop Assignment"].tap()
        options.tap(); app.buttons["Reset Assignment"].tap()
        XCTAssertTrue(app.staticTexts["91.8/100"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.descendants(matching: .any)["course-grade-value"].label, "Course grade")
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "untitled-linked-assignment"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testCourseNavigationAndAppearance() throws {
        let app = XCUIApplication(); app.launchArguments = ["--demo"]; app.launch()
        XCTAssertTrue(app.buttons["course-0"].waitForExistence(timeout: 10)); app.buttons["course-0"].tap()
        XCTAssertTrue(app.staticTexts["Grade Progression"].waitForExistence(timeout: 5)); XCTAssertTrue(app.otherElements["grade-chart"].exists)
        app.buttons["Close course"].tap(); app.buttons["tab-profile"].tap(); XCTAssertTrue(app.staticTexts["Appearance"].exists)
    }
    @MainActor func testAssignmentDropRestoreAndEdit() throws {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--screen=assignments"]; app.launch()
        XCTAssertTrue(app.buttons["Total Points"].waitForExistence(timeout: 10)); app.buttons["Total Points"].tap()
        let options = app.buttons["Options for 2-D Kinematics Quiz"]; XCTAssertTrue(options.waitForExistence(timeout: 10)); options.tap(); app.buttons["Drop Assignment"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["course-grade-value"].waitForExistence(timeout: 5) && app.descendants(matching: .any)["course-grade-value"].label == "What-If grade")
        options.tap(); app.buttons["Undrop Assignment"].tap(); options.tap(); app.buttons["Edit Grade"].tap()
        XCTAssertTrue(app.textFields["edit-score-field"].waitForExistence(timeout: 5))
        // Exact clipboard insertion is unnecessary here: this is numeric test input, not source code.
        let field = app.textFields["edit-score-field"]; field.tap(); field.press(forDuration: 1); if app.menuItems["Select All"].exists { app.menuItems["Select All"].tap() }
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 8) + "100")
        app.buttons["save-score"].tap(); XCTAssertTrue(app.descendants(matching: .any)["course-grade-value"].waitForExistence(timeout: 5) && app.descendants(matching: .any)["course-grade-value"].label == "What-If grade")
    }
    @MainActor func testRecentAndAllAssignmentsShareDecimalScoreEdits() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--period-fixture", "--screen=detail"]; app.launch()
        let options = app.buttons["Options for First quarter lab"]
        XCTAssertTrue(options.waitForExistence(timeout: 10))
        options.tap(); app.buttons["Edit Grade"].tap()
        let field = app.textFields["edit-score-field"]
        let save = app.buttons["save-score"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); XCTAssertTrue(save.isEnabled)
        replaceScore(field, with: "")
        XCTAssertFalse(save.isEnabled)
        XCTAssertFalse(app.buttons["Toggle negative score"].exists)
        field.typeText("50.25")
        XCTAssertEqual(field.value as? String, "50.25"); XCTAssertTrue(save.isEnabled); XCTAssertTrue(save.isHittable)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "recent-decimal-score"; attachment.lifetime = .keepAlways; add(attachment)
        save.tap()
        XCTAssertTrue(app.staticTexts["50.25/100"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["75.06%"].exists)

        let all = app.buttons["view-all-assignments"]
        if !all.isHittable { app.swipeUp() }; all.tap()
        let category = app.buttons["Total Points"]
        XCTAssertTrue(category.waitForExistence(timeout: 5)); category.tap()
        XCTAssertTrue(app.staticTexts["50.25/100"].exists)
        if !options.isHittable { app.swipeUp() }
        options.tap(); app.buttons["Edit Grade"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5)); XCTAssertEqual(field.value as? String, "50.25")
        XCTAssertFalse(app.buttons["Toggle negative score"].exists)
        replaceScore(field, with: "150")
        XCTAssertTrue(save.isEnabled); XCTAssertTrue(save.isHittable); save.tap()
        XCTAssertTrue(app.staticTexts["150/100"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["100%"].exists)
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["150/100"].waitForExistence(timeout: 5))
    }
    @MainActor func testAddGradePopupSharesEditableGradesAcrossCourseViews() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--period-fixture", "--screen=detail", "-appearance", "light"]; app.launch()
        XCTAssertTrue(app.buttons["Course options"].waitForExistence(timeout: 10))
        app.buttons["Course options"].tap()
        XCTAssertFalse(app.buttons["What If? Calculator"].exists)
        app.buttons["Add Grade"].tap()
        let name = app.textFields["add-grade-name"]
        let score = app.textFields["add-grade-score"]
        let total = app.textFields["add-grade-total"]
        let save = app.buttons["add-grade-save"]
        XCTAssertTrue(name.waitForExistence(timeout: 5)); XCTAssertFalse(save.isEnabled)
        XCTAssertEqual(app.textFields.count, 3); XCTAssertFalse(app.buttons["Toggle negative score"].exists)
        name.tap(); name.typeText("Extra Quiz")
        score.tap(); score.typeText("150.5")
        replaceScore(total, with: "0"); XCTAssertFalse(save.isEnabled)
        replaceScore(total, with: "100"); XCTAssertTrue(save.isEnabled)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "add-grade-popup"; attachment.lifetime = .keepAlways; add(attachment)
        save.tap()
        XCTAssertTrue(app.staticTexts["150.5/100"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["95.08%"].exists)
        let all = app.buttons["view-all-assignments"]
        if !all.isHittable { app.swipeUp() }; all.tap()
        let group = app.buttons["Added Grades"]
        XCTAssertTrue(group.waitForExistence(timeout: 5)); group.tap()
        let options = app.buttons["Options for Extra Quiz"]
        XCTAssertTrue(options.waitForExistence(timeout: 5)); options.tap(); app.buttons["Edit Grade"].tap()
        let field = app.textFields["edit-score-field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); XCTAssertFalse(app.buttons["Toggle negative score"].exists)
        replaceScore(field, with: "120.5")
        XCTAssertEqual(field.value as? String, "120.5"); XCTAssertTrue(app.buttons["save-score"].isEnabled)
        app.buttons["save-score"].tap()
        XCTAssertTrue(app.staticTexts["120.5/100"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["90.08%"].exists)
        options.tap(); app.buttons["Drop Assignment"].tap()
        XCTAssertEqual(app.descendants(matching: .any)["course-grade-value"].label, "Course grade")
        options.tap(); app.buttons["Undrop Assignment"].tap()
        XCTAssertTrue(app.staticTexts["90.08%"].exists)
        options.tap(); app.buttons["Remove Grade"].tap()
        XCTAssertFalse(app.buttons["Added Grades"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["course-grade-value"].label, "Course grade")
    }
    @MainActor func testEmptyAndPartialFailureKeepUIUsable() throws {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--empty"]; app.launch(); XCTAssertTrue(app.staticTexts["No grades yet"].waitForExistence(timeout: 10)); app.terminate()
        app.launchArguments = ["--demo", "--error"]; app.launch(); XCTAssertTrue(app.staticTexts["Schoology could not refresh."].waitForExistence(timeout: 10)); XCTAssertTrue(app.buttons["course-0"].exists)
    }
}

extension GradeViewerUITests {
    @MainActor func testLongCourseNameRemainsReadable() {
        let app = XCUIApplication()
        for mode in ["light", "dark"] {
            app.launchArguments = ["--demo", "-appearance", mode]; app.launch()
            XCTAssertTrue(app.buttons["course-0"].waitForExistence(timeout: 10))
            app.scrollViews.firstMatch.swipeUp()
            XCTAssertTrue(app.buttons["course-5"].isHittable)
            let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "long-course-" + mode; attachment.lifetime = .keepAlways; add(attachment)
            app.terminate()
        }
    }
    @MainActor func testCategoryDropAndReset() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--screen=categories"]; app.launch()
        let category = app.buttons["Total Points"]
        XCTAssertTrue(category.waitForExistence(timeout: 10)); category.tap()
        let options = app.buttons["Options for 2-D Kinematics Quiz"]
        XCTAssertTrue(options.waitForExistence(timeout: 5)); options.tap(); app.buttons["Drop Assignment"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["course-grade-value"].waitForExistence(timeout: 5) && app.descendants(matching: .any)["course-grade-value"].label == "What-If grade")
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "category-dropped"; attachment.lifetime = .keepAlways; add(attachment)
        options.tap(); app.buttons["Reset Assignment"].tap()
        XCTAssertEqual(app.descendants(matching: .any)["course-grade-value"].label, "Course grade")
    }
    @MainActor func testGraphHoldShowsGradeAndDate() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--screen=detail", "--record-chart-touch"]; app.launch()
        let chart = app.otherElements["grade-chart"]; XCTAssertTrue(chart.waitForExistence(timeout: 10))
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.6)
        XCTAssertTrue((chart.value as? String)?.contains("Released; last touch") == true)
        XCTAssertFalse(app.descendants(matching: .any)["chart-selection"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "graph-selected"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testLaunchResponsivenessWithLongAssignmentLists() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--long-list"]
        let options = XCTMeasureOptions(); options.iterationCount = 3
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: options) { app.launch(); app.terminate() }
    }
    @MainActor func testScreenshotMatrix() {
        let app = XCUIApplication()
        for mode in ["light", "dark"] {
            for screen in ["grades", "detail", "assignments", "categories", "final", "settings", "empty", "error"] {
                app.launchArguments = ["--demo", "-appearance", mode]
                if screen == "empty" || screen == "error" { app.launchArguments.append("--" + screen) }
                else if screen != "grades" { app.launchArguments.append("--screen=" + screen) }
                app.launch()
                let title: String
                switch screen { case "detail": title = "AP Physics 1"; case "assignments", "categories": title = "AP Physics 1"; case "final": title = "Final grade"; case "settings": title = "Settings"; default: title = "My grades" }
                XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 10))
                if !["grades", "settings", "empty", "error"].contains(screen) {
                    let close = app.buttons["Close course"]
                    XCTAssertTrue(close.waitForExistence(timeout: 5))
                    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: close)
                    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
                }
                let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = screen + "-" + mode; attachment.lifetime = .keepAlways; add(attachment)
                app.terminate()
            }
        }
    }
}

extension GradeViewerUITests {
    @MainActor func testSettingsHaveNoManualCourseControls() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--overview-fixture", "--screen=settings"]; app.launch()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Edit courses"].exists)
        XCTAssertFalse(app.staticTexts["Match courses"].exists)
        XCTAssertFalse(app.buttons["Reload widgets"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "automatic-course-settings"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testCleanOverviewKeepsToolsInsideCourseMenu() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--multiple-terms"]; app.launch()
        XCTAssertTrue(app.buttons["course-0"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Refresh grades"].exists); XCTAssertFalse(app.pickers["Term"].exists)
        app.buttons["course-0"].tap()
        XCTAssertTrue(app.otherElements["grade-chart"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Fall 2026"].exists)
        XCTAssertFalse(app.buttons["Categories"].exists); XCTAssertFalse(app.buttons["What-If"].exists)
        app.buttons["Course options"].tap()
        XCTAssertTrue(app.buttons["Add Grade"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["What If? Calculator"].exists)
        XCTAssertTrue(app.buttons["Final Grade Calculator"].exists)
        app.buttons["Add Grade"].tap()
        XCTAssertTrue(app.navigationBars["Add Grade"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.otherElements["grade-chart"].waitForExistence(timeout: 5))
    }
    @MainActor func testFirstRecordedGradeAlreadyHasSelectableChart() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--single-history", "--screen=detail", "--record-chart-touch"]; app.launch()
        let chart = app.otherElements["grade-chart"]; XCTAssertTrue(chart.waitForExistence(timeout: 10))
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.6)
        XCTAssertTrue((chart.value as? String)?.contains("Released; last touch") == true)
        XCTAssertFalse(app.descendants(matching: .any)["chart-selection"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "first-grade-chart"; attachment.lifetime = .keepAlways; add(attachment)
    }
}

extension GradeViewerUITests {
    @MainActor func testGraphTracingShowsOnlyEventGradesAtThresholds() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--curve-fixture", "--screen=detail", "-appearance", "dark", "--record-chart-touch"]; app.launch()
        let chart = app.otherElements["grade-chart"]; XCTAssertTrue(chart.waitForExistence(timeout: 10))
        let a = chart.coordinate(withNormalizedOffset: CGVector(dx: 0.40, dy: 0.5))
        let b = chart.coordinate(withNormalizedOffset: CGVector(dx: 0.41, dy: 0.5))
        a.press(forDuration: 0.3)
        let first = chart.value as? String
        a.press(forDuration: 0.2, thenDragTo: b)
        let second = chart.value as? String
        XCTAssertEqual(first, second, "Tracing within an event threshold must keep the actual event grade")
        XCTAssertTrue(second?.contains("80%") == true)
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.60, dy: 0.5)).press(forDuration: 0.3)
        XCTAssertTrue((chart.value as? String)?.contains("100%") == true)
        XCTAssertTrue(second?.contains("Released; last touch") == true)
        XCTAssertFalse(app.descendants(matching: .any)["chart-selection"].exists)
        XCTAssertFalse(app.staticTexts["Calculated · due date"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "continuous-selection-dark"; attachment.lifetime = .keepAlways; add(attachment)
    }
}

extension GradeViewerUITests {
    @MainActor func testUnchangedSavedScoreKeepsRealCourseGrade() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--noop-scenario", "--screen=detail"]; app.launch()
        let value = app.descendants(matching: .any)["course-grade-value"]
        XCTAssertTrue(value.waitForExistence(timeout: 10)); XCTAssertEqual(value.label, "Course grade")
        XCTAssertFalse(app.staticTexts["+0.01%"].exists)
    }
}

extension GradeViewerUITests {

}

extension GradeViewerUITests {
    @MainActor func testOverviewKeepsRecentSchoologyOnlyGradeInOrder() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--overview-fixture", "--screen=detail"]; app.launch()
        let first = app.staticTexts["2-D Kinematics Quiz"], extra = app.staticTexts["Recent extra credit"], next = app.staticTexts["1-D Kinematics Quiz"]
        XCTAssertTrue(extra.waitForExistence(timeout:10))
        XCTAssertTrue(first.frame.minY < extra.frame.minY)
        XCTAssertTrue(extra.frame.minY < next.frame.minY)
        XCTAssertFalse(app.staticTexts["Pending future assignment"].exists)
    }
    @MainActor func testHeldGraphTooltipAppearanceInBothModes() {
        let app = XCUIApplication()
        for mode in ["light","dark"] {
            app.launchArguments = ["--demo", "--screen=detail", "--preview-chart-touch", "-appearance", mode]; app.launch()
            let chart = app.otherElements["grade-chart"]
            XCTAssertTrue(chart.waitForExistence(timeout: 10)); XCTAssertTrue((chart.value as? String)?.contains("Selected") == true)
            XCTAssertFalse(app.staticTexts["Calculated · due date"].exists)
            let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "graph-held-" + mode; attachment.lifetime = .keepAlways; add(attachment)
            app.terminate()
        }
    }
}

extension GradeViewerUITests {
    @MainActor func testHomeAndDetailShowSchoologyFreshness() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--freshness-fixture"]
        app.launch()
        let home = app.buttons["course-0"]
        XCTAssertTrue(home.waitForExistence(timeout:10))
        XCTAssertTrue(home.label.contains("updated recently"))
        home.tap()
        XCTAssertTrue(app.staticTexts["updated recently"].firstMatch.waitForExistence(timeout:5))
        XCTAssertGreaterThanOrEqual(app.staticTexts.matching(identifier:"updated recently").count, 2)
        let attachment = XCTAttachment(screenshot:app.screenshot()); attachment.name = "fresh-provider-home-detail"; attachment.lifetime = .keepAlways; add(attachment)
    }
}

extension GradeViewerUITests {
    @MainActor func testAssignmentPeriodPillsKeepSemesterGradeAndScopeAssignments() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--period-fixture", "--exam-fixture", "--screen=detail"]; app.launch()
        XCTAssertTrue(app.staticTexts["S1 overall"].waitForExistence(timeout:10))
        XCTAssertFalse(app.buttons["course-period-picker"].exists)
        XCTAssertFalse(app.buttons["period-Q1-quarter"].exists)
        let all = app.buttons["view-all-assignments"]
        if !all.isHittable { app.swipeUp() }
        all.tap()
        XCTAssertTrue(app.buttons["period-Q1-quarter"].waitForExistence(timeout:5))
        XCTAssertFalse(app.buttons["period-Q2-semester"].exists)
        XCTAssertFalse(app.buttons["period-Q4-semester"].exists)
        XCTAssertFalse(app.buttons["period-Q2-exam"].exists)
        XCTAssertTrue(app.staticTexts["S1 overall"].exists)
        XCTAssertEqual(app.descendants(matching:.any)["course-grade-value"].value as? String, "85%")
        app.buttons["Total Points"].tap()
        XCTAssertTrue(app.staticTexts["First quarter lab"].exists)
        XCTAssertFalse(app.staticTexts["Second quarter lab"].exists)
        XCTAssertFalse(app.staticTexts["Semester exam"].exists)
        let attachment = XCTAttachment(screenshot:app.screenshot()); attachment.name = "assignment-period-pills-light"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["period-Q2-quarter"].tap()
        XCTAssertTrue(app.staticTexts["Second quarter lab"].waitForExistence(timeout:5))
        XCTAssertFalse(app.staticTexts["First quarter lab"].exists)
        XCTAssertEqual(app.descendants(matching:.any)["course-grade-value"].value as? String, "85%")
        XCTAssertTrue(app.staticTexts["Semester exam"].waitForExistence(timeout:5))
        XCTAssertTrue(app.staticTexts["quarter-exam-section"].frame.minY > app.staticTexts["Second quarter lab"].frame.minY)
        app.swipeUp()
        let exam = XCTAttachment(screenshot:app.screenshot()); exam.name = "q2-exam-at-bottom"; exam.lifetime = .keepAlways; add(exam)
        if !app.buttons["period-Q4-quarter"].isHittable { app.swipeDown() }
        app.buttons["period-Q4-quarter"].tap()
        XCTAssertTrue(app.staticTexts["No assignments in this period."].waitForExistence(timeout:5))
        XCTAssertFalse(app.staticTexts["First quarter lab"].exists)
        XCTAssertFalse(app.staticTexts["Semester exam"].exists)
        XCTAssertTrue(app.staticTexts["S2 overall"].exists)
        let empty = XCTAttachment(screenshot:app.screenshot()); empty.name = "empty-future-quarter"; empty.lifetime = .keepAlways; add(empty)
    }
    @MainActor func testAssignmentPillsDarkAppearanceAndSemesterScenario() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--period-fixture", "--screen=detail", "-appearance", "dark"]; app.launch()
        let options = app.buttons["Options for First quarter lab"]
        XCTAssertTrue(options.waitForExistence(timeout:10)); options.tap()
        app.buttons["Edit Grade"].tap()
        let score = app.textFields["edit-score-field"]
        XCTAssertTrue(score.waitForExistence(timeout:5)); score.tap()
        score.press(forDuration:1)
        if app.menuItems["Select All"].exists { app.menuItems["Select All"].tap() }
        score.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 8) + "100")
        app.buttons["save-score"].tap()
        XCTAssertTrue(app.staticTexts["87.5%"].waitForExistence(timeout:5))
        XCTAssertTrue(app.staticTexts["+2.50%"].exists)
        let all = app.buttons["view-all-assignments"]
        if !all.isHittable { app.swipeUp() }
        all.tap()
        XCTAssertTrue(app.buttons["period-Q1-quarter"].waitForExistence(timeout:5))
        let attachment = XCTAttachment(screenshot:app.screenshot()); attachment.name = "assignment-period-pills-dark"; attachment.lifetime = .keepAlways; add(attachment)
    }
}

extension GradeViewerUITests {
    @MainActor func testFreshLaunchGateHidesCachedGradesAndLeavesProfileUsable() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--loading-fixture"]; app.launch()
        XCTAssertTrue(app.staticTexts["Refreshing grades…"].waitForExistence(timeout:10))
        XCTAssertFalse(app.buttons["course-0"].exists)
        XCTAssertFalse(app.staticTexts["(95.8%)"].exists)
        app.buttons["tab-profile"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout:5))
        app.terminate()
        app.launchArguments = ["--demo", "--fresh-failure-fixture", "--screen=detail", "-appearance", "dark"]; app.launch()
        XCTAssertTrue(app.staticTexts["Fresh grades unavailable"].waitForExistence(timeout:10))
        XCTAssertFalse(app.staticTexts["2-D Kinematics Quiz"].exists)
        let gate = XCTAttachment(screenshot:app.screenshot()); gate.name = "fresh-grade-failure-gate"; gate.lifetime = .keepAlways; add(gate)
        XCTAssertTrue(app.buttons["retry-fresh-grades-sheet"].isHittable)
        app.buttons["retry-fresh-grades-sheet"].tap()
        app.buttons["Close course"].tap()
        XCTAssertTrue(app.buttons["retry-fresh-grades"].isHittable)
        XCTAssertEqual(app.buttons["retry-fresh-grades"].label, "Retry")
        let retry = XCTAttachment(screenshot:app.screenshot()); retry.name = "fresh-grade-retry-dark"; retry.lifetime = .keepAlways; add(retry)
        app.buttons["tab-profile"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout:5))
        let attachment = XCTAttachment(screenshot:app.screenshot()); attachment.name = "fresh-gate-profile-recovery"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testGraphKeepsEarlierPerfectGradeBeforeReportedRoundedDecline() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--graph-rounding-fixture", "--screen=detail", "--record-chart-touch"]; app.launch()
        let chart = app.otherElements["grade-chart"]
        XCTAssertTrue(chart.waitForExistence(timeout:10))
        let ready = XCTNSPredicateExpectation(predicate:NSPredicate(format:"value CONTAINS '4 grades'"), object:chart)
        XCTAssertEqual(XCTWaiter.wait(for:[ready], timeout:5), .completed)
        chart.coordinate(withNormalizedOffset:CGVector(dx:0.05, dy:0.5)).press(forDuration:0.6)
        XCTAssertEqual(chart.value as? String, "Released; last touch 100%")
        let attachment = XCTAttachment(screenshot:app.screenshot()); attachment.name = "perfect-prefix-before-rounded-decline"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testProviderCooldownShowsAutomaticRetryAndKeepsProfileUsable() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--cooldown-fixture"]; app.launch()
        let retry = app.staticTexts["provider-retry-schoology"]
        XCTAssertTrue(retry.waitForExistence(timeout:10))
        XCTAssertTrue(retry.label.contains("Schoology will retry in"))
        XCTAssertFalse(app.staticTexts["Fresh grades unavailable"].exists)
        XCTAssertFalse(app.buttons["retry-fresh-grades"].exists)
        XCTAssertFalse(app.buttons["course-0"].exists)
        let attachment = XCTAttachment(screenshot:app.screenshot()); attachment.name = "automatic-provider-cooldown"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["tab-profile"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout:5))
    }


}

extension GradeViewerUITests {
    @MainActor func testSchoologyColumnsToolsAndNullPointsStayTitledAndEditable() {
        let app=XCUIApplication()
        app.launchArguments=["--demo","--schoology-stability-fixture"]
        app.launch()
        let card=app.buttons["course-0"]
        XCTAssertTrue(card.waitForExistence(timeout:10))
        XCTAssertTrue(card.label.contains("90%"))
        XCTAssertTrue(card.label.contains("updated recently"))
        card.tap()
        XCTAssertTrue(app.staticTexts["Course Grade"].waitForExistence(timeout:5))
        for title in ["Column quiz","Tool quiz","Points quiz"] {
            XCTAssertEqual(app.buttons.matching(identifier:"Options for " + title).count,1)
        }
        XCTAssertFalse(app.staticTexts["Untitled assignment"].exists)
        app.buttons["Options for Points quiz"].tap(); app.buttons["Edit Grade"].tap()
        let score=app.textFields["edit-score-field"]
        XCTAssertTrue(score.waitForExistence(timeout:5)); replaceScore(score,with:"12")
        app.buttons["save-score"].tap()
        XCTAssertTrue(app.staticTexts["12/10"].waitForExistence(timeout:5))
        XCTAssertEqual(app.descendants(matching:.any)["course-grade-value"].value as? String,"100%")
        let attachment=XCTAttachment(screenshot:app.screenshot()); attachment.name="schoology-titled-columns-null-points"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["Options for Points quiz"].tap(); app.buttons["Reset Assignment"].tap()
        XCTAssertTrue(app.staticTexts["9/10"].waitForExistence(timeout:5))
        XCTAssertEqual(app.descendants(matching:.any)["course-grade-value"].value as? String,"90%")
    }
}

extension GradeViewerUITests {
    @MainActor func testHomeAndDetailUseSameSemesterOverall() {
        let app=XCUIApplication(); app.launchArguments=["--demo","--period-fixture"]; app.launch()
        let card=app.buttons["course-0"]
        XCTAssertTrue(card.waitForExistence(timeout:10)); XCTAssertTrue(card.label.contains("85%"))
        card.tap()
        XCTAssertTrue(app.staticTexts["S1 overall"].waitForExistence(timeout:5))
        XCTAssertEqual(app.descendants(matching:.any)["course-grade-value"].value as? String,"85%")
        let attachment=XCTAttachment(screenshot:app.screenshot()); attachment.name="matching-home-detail-semester"; attachment.lifetime = .keepAlways; add(attachment)
    }
}

extension GradeViewerUITests {
    @MainActor func testRemovedUnresolvedRowCanBeRestoredWithoutChangingReportedGrade() {
        let app=XCUIApplication(); app.launchArguments=["--demo","--unresolved-title-fixture","--screen=detail"]; app.launch()
        let options=app.buttons["Options for Untitled assignment"]
        XCTAssertTrue(options.waitForExistence(timeout:10)); options.tap()
        app.buttons["Remove Assignment"].tap()
        XCTAssertFalse(app.staticTexts["Untitled assignment"].exists)
        XCTAssertEqual(app.descendants(matching:.any)["course-grade-value"].value as? String,"95.8%")
        app.buttons["Course options"].tap(); app.buttons["Restore Removed Assignments"].tap()
        XCTAssertTrue(options.waitForExistence(timeout:5))
        XCTAssertEqual(app.descendants(matching:.any)["course-grade-value"].value as? String,"95.8%")
    }
    @MainActor func testQ2KnownAssignmentsRemainVisibleWhenScoresAreUnavailable() {
        let app=XCUIApplication(); app.launchArguments=["--demo","--period-fixture","--unavailable-period-fixture","--period-refresh-fixture","--screen=assignments"]; app.launch()
        let q2=app.buttons["period-Q2-quarter"]
        XCTAssertTrue(q2.waitForExistence(timeout:10)); q2.tap()
        XCTAssertTrue(app.staticTexts["S1 overall"].exists)
        XCTAssertEqual(app.descendants(matching:.any)["course-grade-value"].value as? String,"85%")
        let estimate=app.staticTexts["quarter-grade-estimate"]
        XCTAssertTrue(estimate.waitForExistence(timeout:5)); XCTAssertEqual(estimate.value as? String,"80%")
        XCTAssertTrue(app.staticTexts["quarter-estimate-note"].exists)
        app.buttons["Total Points"].tap()
        XCTAssertTrue(app.staticTexts["Second quarter lab"].waitForExistence(timeout:5))
        XCTAssertTrue(app.staticTexts["Second quarter quiz"].exists)
        XCTAssertFalse(app.staticTexts["First quarter lab"].exists)
        XCTAssertFalse(app.staticTexts["No assignments in this period."].exists)
        XCTAssertFalse(app.buttons["Options for Second quarter lab"].isEnabled)
        XCTAssertFalse(app.staticTexts["80/100"].exists)
        let attachment=XCTAttachment(screenshot:app.screenshot()); attachment.name="q2-known-assignments-unavailable-scores"; attachment.lifetime = .keepAlways; add(attachment)
        let scroll=app.scrollViews["assignments-scroll"]
        scroll.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.2)).press(forDuration:0.1,thenDragTo:scroll.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.9)))
        let actual=app.descendants(matching:.any)["quarter-grade-actual"]
        XCTAssertTrue(actual.waitForExistence(timeout:5))
        XCTAssertFalse(estimate.exists); XCTAssertFalse(app.staticTexts["quarter-estimate-note"].exists)
        XCTAssertTrue(app.staticTexts["80/100"].waitForExistence(timeout:5))
        XCTAssertFalse(app.staticTexts["First quarter lab"].exists)
        let refreshed=XCTAttachment(screenshot:app.screenshot()); refreshed.name="q2-actual-replaces-estimate"; refreshed.lifetime = .keepAlways; add(refreshed)
    }
}
