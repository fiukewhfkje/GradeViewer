import XCTest
final class GradeViewerUITests: XCTestCase {
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
    @MainActor func testEmptyAndPartialFailureKeepUIUsable() throws {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--empty"]; app.launch(); XCTAssertTrue(app.staticTexts["No grades yet"].waitForExistence(timeout: 10)); app.terminate()
        app.launchArguments = ["--demo", "--error"]; app.launch(); XCTAssertTrue(app.staticTexts["Infinite Campus could not refresh."].waitForExistence(timeout: 10)); XCTAssertTrue(app.buttons["course-0"].exists)
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
            for screen in ["grades", "detail", "assignments", "categories", "whatif", "final", "settings", "empty", "error"] {
                app.launchArguments = ["--demo", "-appearance", mode]
                if screen == "empty" || screen == "error" { app.launchArguments.append("--" + screen) }
                else if screen != "grades" { app.launchArguments.append("--screen=" + screen) }
                app.launch()
                let title: String
                switch screen { case "detail": title = "AP Physics 1"; case "assignments", "categories": title = "AP Physics 1"; case "whatif": title = "What-If"; case "final": title = "Final grade"; case "settings": title = "Settings"; default: title = "My grades" }
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
        XCTAssertTrue(app.buttons["What If? Calculator"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Final Grade Calculator"].exists)
        app.buttons["What If? Calculator"].tap()
        XCTAssertTrue(app.navigationBars["What-If"].waitForExistence(timeout: 5))
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
    @MainActor func testFullViewUsesSchoologyCategoriesAndIncludesPastQuarterWork() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--past-quarter-fixture", "--screen=assignments"]; app.launch()
        XCTAssertTrue(app.buttons["Quizzes"].waitForExistence(timeout: 10)); XCTAssertTrue(app.buttons["Labs"].exists)
        app.buttons["Labs"].tap()
        XCTAssertTrue(app.staticTexts["Past quarter lab"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Ungraded"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "schoology-categories-past-quarter"; attachment.lifetime = .keepAlways; add(attachment)
    }
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
    @MainActor func testHomeAndDetailShowNewestLinkedProviderFreshness() {
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
        XCTAssertTrue(app.staticTexts["No graded assignments in this period."].waitForExistence(timeout:5))
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
    @MainActor func testSettingsKeepPersistenceAndRecoveryDetailsHidden() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--screen=settings"]; app.launch()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout:10))
        XCTAssertTrue(app.buttons["campus-connection"].exists)
        XCTAssertTrue(app.buttons["Schoology, Connect"].exists)
        XCTAssertTrue(app.buttons["Appearance, System"].exists)
        XCTAssertFalse(app.staticTexts["Version"].exists)
        XCTAssertFalse(app.buttons["Reload widgets"].exists)
        XCTAssertFalse(app.buttons["Disconnect Infinite Campus"].exists)
        let overview = XCTAttachment(screenshot:app.screenshot()); overview.name = "settings-clean-overview"; overview.lifetime = .keepAlways; add(overview)
        app.buttons["campus-connection"].tap()
        XCTAssertTrue(app.textFields["Student portal URL"].waitForExistence(timeout:5))
        XCTAssertTrue(app.buttons["Find your district"].exists)
        XCTAssertFalse(app.buttons["Use browser cookies"].exists)
        XCTAssertFalse(app.secureTextFields["campus-cookie-header"].exists)
        XCTAssertFalse(app.staticTexts["Automatic SSO reconnect ready"].exists)
        let campus = XCTAttachment(screenshot:app.screenshot()); campus.name = "campus-clean-setup"; campus.lifetime = .keepAlways; add(campus)
    }
    @MainActor func testConnectedSettingsHideSetupFieldsAndKeepAccountActions() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--connected-settings-fixture", "--screen=settings"]; app.launch()
        XCTAssertTrue(app.buttons["campus-connection"].waitForExistence(timeout:10)); app.buttons["campus-connection"].tap()
        let status = app.descendants(matching:.any)["connection-status"]
        XCTAssertTrue(status.waitForExistence(timeout:5))
        XCTAssertEqual(status.value as? String, "Connected")
        XCTAssertTrue(app.buttons["Sign in again"].exists)
        XCTAssertTrue(app.buttons["Disconnect"].exists)
        XCTAssertFalse(app.textFields["Student portal URL"].exists)
        XCTAssertFalse(app.buttons["Find your district"].exists)
        XCTAssertFalse(app.staticTexts["Automatic SSO reconnect ready"].exists)
        let campus = XCTAttachment(screenshot:app.screenshot()); campus.name = "campus-clean-connected"; campus.lifetime = .keepAlways; add(campus)
        app.buttons["Disconnect"].tap()
        XCTAssertTrue(app.buttons["Disconnect and remove its saved grades"].waitForExistence(timeout:5))
        app.buttons["Disconnect and remove its saved grades"].tap()
        XCTAssertEqual(status.value as? String, "Connected", "Demo disconnect must not delete real Keychain connections")
        app.navigationBars["Infinite Campus"].buttons.element(boundBy:0).tap()
        app.buttons["Schoology, Connected"].tap()
        XCTAssertTrue(app.buttons["Update sign-in"].waitForExistence(timeout:5))
        XCTAssertTrue(app.buttons["Disconnect"].exists)
        XCTAssertFalse(app.textFields["API key"].exists)
        XCTAssertFalse(app.secureTextFields["API secret"].exists)
        XCTAssertFalse(app.buttons["Access token (if required)"].exists)
        let schoology = XCTAttachment(screenshot:app.screenshot()); schoology.name = "schoology-clean-connected"; schoology.lifetime = .keepAlways; add(schoology)
    }
}


extension GradeViewerUITests {
    @MainActor func testCampusBrowserFailureShowsRetryAndPortalWithConnectDisabled() {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--screen=settings", "--campus-browser-failure"]; app.launch()
        app.buttons["campus-connection"].tap()
        XCTAssertTrue(app.staticTexts["Sign-in page unavailable"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["retry-campus-browser"].isHittable)
        XCTAssertTrue(app.buttons["open-campus-portal"].isHittable)
        XCTAssertFalse(app.buttons["Connect"].isEnabled)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Campus-browser-TLS-recovery"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["retry-campus-browser"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "campus-browser-loading").firstMatch.waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["Connect"].isEnabled)
        XCTAssertTrue(app.staticTexts["The sign-in page took too long to load. Check your connection, then retry."].waitForExistence(timeout: 18))
        XCTAssertTrue(app.buttons["retry-campus-browser"].isHittable)
        XCTAssertTrue(app.buttons["open-campus-portal"].isHittable)
        XCTAssertFalse(app.buttons["Connect"].isEnabled)
        app.buttons["Cancel"].tap()
        XCTAssertFalse(app.staticTexts["Sign-in page unavailable"].exists)
        XCTAssertTrue(app.navigationBars["Infinite Campus"].exists)
    }
}
