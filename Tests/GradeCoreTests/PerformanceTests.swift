import XCTest
@testable import GradeCore

final class PerformanceTests: XCTestCase {
    func testProviderDatesRemainCorrectAcrossConcurrentReads() async {
        let matches = await withTaskGroup(of: Bool.self, returning: [Bool].self) { group in
            for _ in 0..<12 {
                group.addTask {
                    (0..<100).allSatisfy { _ in ProviderParsing.date("2026-09-30T19:59:00-04:00") == ProviderParsing.date("2026-09-30 23:59:00") }
                }
            }
            var results: [Bool] = []; for await result in group { results.append(result) }; return results
        }
        XCTAssertEqual(matches.count, 12); XCTAssertTrue(matches.allSatisfy { $0 })
    }
    func testProviderDateParsingThroughputAndFormats() throws {
        let strings = ["2026-09-30 23:59:00", "2026-09-30T23:59:00", "2026-09-30", "2026-09-30T23:59:00Z", "2026-09-30T23:59:00.125Z", "2026-09-30T19:59:00-04:00"]
        let started = Date()
        for _ in 0..<200 { for value in strings { XCTAssertNotNil(ProviderParsing.date(value)) } }
        print("Synthetic date parsing milliseconds: \(Date().timeIntervalSince(started) * 1000)")
        XCTAssertEqual(ProviderParsing.date(strings[0]), ProviderParsing.date(strings[3]))
        XCTAssertEqual(ProviderParsing.date(strings[0]), ProviderParsing.date(strings[5]))
        XCTAssertEqual(try XCTUnwrap(ProviderParsing.date(strings[4])).timeIntervalSince1970 - XCTUnwrap(ProviderParsing.date(strings[3])).timeIntervalSince1970, 0.125, accuracy: 0.001)
        XCTAssertEqual(ProviderParsing.date("1790812800"), ProviderParsing.date("1790812800000"))
        XCTAssertNil(ProviderParsing.date("invalid date"))
    }
    func testRepresentativePeriodReconciliationThroughput() {
        let sources = (0..<6).flatMap { index in
            Demo.periodSources().map { original in
                var source = original
                source.source.id += ":\(index)"
                source.title += " \(index)"
                source.source.fields["course_name"] = source.title
                source.source.fields["section_id"] = (source.source.fields["section_id"] ?? "") + ":\(index)"
                if let owner = source.source.fields["grade_section_id"] { source.source.fields["grade_section_id"] = owner + ":\(index)" }
                return source
            }
        }
        let started = Date()
        let courses = Reconciler.reconcile(sources)
        print("Synthetic 96-source reconciliation milliseconds: \(Date().timeIntervalSince(started) * 1000)")
        XCTAssertEqual(courses.count, 48)
        XCTAssertTrue(courses.allSatisfy { $0.sources.count == 2 })
    }
}
