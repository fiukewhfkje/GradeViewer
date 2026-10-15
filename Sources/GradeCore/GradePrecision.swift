import Foundation

/// Percent presentation uses hundredths; arithmetic stays unrounded. The tiny
/// epsilon only compensates for binary subtraction at an exact cent boundary.
enum GradePrecision {
    static let increment = 0.01
    static let epsilon = 0.000000001
    static func isReportingDifference(_ a: Double, _ b: Double) -> Bool {
        abs(a-b) + epsilon >= increment
    }
    static func matchesReconstruction(_ a: Double, _ b: Double) -> Bool {
        a.isFinite && b.isFinite && abs(a-b) <= increment + epsilon
    }
}
