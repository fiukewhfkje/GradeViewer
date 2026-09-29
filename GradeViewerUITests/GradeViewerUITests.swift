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
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--screen=detail"]; app.launch()
        let chart = app.otherElements["grade-chart"]; XCTAssertTrue(chart.waitForExistence(timeout: 10))
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.6)
        XCTAssertTrue((chart.value as? String)?.contains("Selected") == true)
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
            for screen in ["grades", "detail", "assignments", "categories", "whatif", "final", "settings", "widget", "empty", "error"] {
                app.launchArguments = ["--demo", "-appearance", mode]
                if screen == "empty" || screen == "error" { app.launchArguments.append("--" + screen) }
                else if screen != "grades" { app.launchArguments.append("--screen=" + screen) }
                app.launch()
                let title: String
                switch screen { case "detail": title = "AP Physics 1"; case "assignments", "categories": title = "AP Physics 1"; case "whatif": title = "What-If"; case "final": title = "Final grade"; case "settings": title = "Settings"; case "widget": title = "Widgets"; default: title = "My grades" }
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
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--single-history", "--screen=detail"]; app.launch()
        let chart = app.otherElements["grade-chart"]; XCTAssertTrue(chart.waitForExistence(timeout: 10))
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.6)
        XCTAssertTrue((chart.value as? String)?.contains("Selected") == true)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "first-grade-chart"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
