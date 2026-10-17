import Foundation
import XCTest
@testable import GradeCore

/// Runs the original implementation on synthetic cases; JavaScript consumes the
/// exported inputs/results in CI. No production/native storage is read here.
final class PWAParityTests: XCTestCase {
    struct Row: Encodable {
        var course: SourceCourse
        var hypothesis: Hypothesis
        var baseline: Double?
        var baselineError: String?
        var scenario: Double?
        var scenarioError: String?
        var hypothetical: Double?
        var reliable: Bool
        var current: Double
        var target: Double
        var weight: Double
        var required: Double?
        var finalError: String?
    }
    func testSyntheticJavaScriptParityCorpus() throws {
        var rows: [Row] = []
        let methods: [CourseMethod] = [.points, .weightedCategories, .equalCategories, .unknown]
        for i in 0..<1200 {
            let categories: [GradingCategory] = (0..<3).map { j in
                GradingCategory(id: "c\(j)", name: "Synthetic category \(j)",
                    weight: i % 23 == 0 && j == 0 ? nil : Double([70, 30, 0][j]),
                    method: (i + j) % 3 == 0 ? .percent : .points,
                    dropLowest: (i + j) % 3, excluded: i % 19 == 0 && j == 1)
            }
            let assignments: [SourceAssignment] = (0..<8).map { j in
                let earned: Double? = i % 17 == 0 && j == 0 ? nil : Double((i * 7 + j * 13) % 171 - 20) / 1.25
                var possible: Double = [5, 20, 100][j % 3]
                if i % 31 == 0 && j == 0 { possible = -1 }
                else if i % 7 == 0 && j == 1 { possible = 0 }
                let letter: String? = i % 17 == 0 && j == 0 ? "A" : nil
                let score = Score(earned: earned, possible: possible, letter: letter, excused: i % 11 == 0 && j == 2)
                let multiplier: Double = i % 29 == 0 && j == 0 ? 0 : [0.5, 1, 2, 3][(i + j) % 4]
                let category = i % 37 == 0 && j == 0 ? "missing" : "c\(j % 3)"
                return SourceAssignment(source: Provenance(.schoology, "a\(j)"), title: "Synthetic assignment \(j)",
                    categoryID: category, score: score, multiplier: multiplier, excluded: i % 13 == 0 && j == 4)
            }
            var course = SourceCourse(source: Provenance(.schoology, "synthetic-\(i)"), title: "Synthetic course",
                term: Term(id: "synthetic", name: "Synthetic term"), categories: categories,
                assignments: assignments, method: methods[i % methods.count], fetched: Date(timeIntervalSince1970: 1_792_152_000))
            let baseline = try? GradeCalculator.percent(course: course)
            course.grade.percent = baseline.map { $0 + (i % 5 == 0 ? 1 : 0.03) }
            var hypothesis = Hypothesis()
            hypothesis.scores[assignments[0].id] = Double(i % 190) - 12.345
            hypothesis.scores["missing"] = 999
            if i % 5 == 0 { hypothesis.ignored.insert(assignments[2].id) }
            if i % 3 == 0 {
                hypothesis.added = [SourceAssignment(source: Provenance(.schoology, "added"), title: "Synthetic extra credit",
                    categoryID: "c0", score: Score(earned: 50, possible: 40))]
            }
            func result(_ run: () throws -> Double) -> (Double?, String?) {
                do { return (try run(), nil) } catch { return (nil, String(describing: error)) }
            }
            let base = result { try GradeCalculator.percent(course: course) }
            let scenario = result { try GradeCalculator.percent(course: course, hypothesis: hypothesis) }
            let current = Double(i % 151), target = Double(60 + i % 51), weight = [0, 0.1, 0.2, 0.3, 1, 1.1][i % 6]
            let final = result { try GradeCalculator.requiredFinal(current: current, target: target, weight: weight) }
            rows.append(Row(course: course, hypothesis: hypothesis, baseline: base.0, baselineError: base.1,
                scenario: scenario.0, scenarioError: scenario.1,
                hypothetical: try? GradeCalculator.hypotheticalPercent(course: course, hypothesis: hypothesis),
                reliable: GradeCalculator.isReliable(course), current: current, target: target, weight: weight,
                required: final.0, finalError: final.1))
        }
        XCTAssertEqual(rows.count, 1200)
        XCTAssertGreaterThan(rows.filter { $0.baseline != nil }.count, 500)
        if let path = ProcessInfo.processInfo.environment["PWA_PARITY_OUTPUT"] {
            let url = URL(fileURLWithPath: path)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(rows).write(to: url, options: .atomic)
        }
    }
}
