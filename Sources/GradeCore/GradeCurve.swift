import Foundation

/// One monotone cubic curve shared by drawing and continuous touch sampling.
public struct GradeCurve: Sendable {
    public struct Node: Sendable { public let date: Date; public let value: Double }
    public struct Segment: Sendable {
        public let start: Node; public let end: Node
        public let startSlope: Double; public let endSlope: Double
        public var duration: Double { end.date.timeIntervalSince(start.date) }
        public func value(at fraction: Double) -> Double {
            let t = min(1, max(0, fraction)), t2 = t * t, t3 = t2 * t
            return (2 * t3 - 3 * t2 + 1) * start.value + (t3 - 2 * t2 + t) * duration * startSlope
                + (-2 * t3 + 3 * t2) * end.value + (t3 - t2) * duration * endSlope
        }
    }
    public let nodes: [Node]
    public let segments: [Segment]
    public init(points: [GradeProgressionPoint]) {
        // Prefer actual observations when a calculated point has the same date.
        let sorted = points.sorted { $0.date == $1.date ? $0.calculated && !$1.calculated : $0.date < $1.date }
        var unique: [Date: Double] = [:]
        for point in sorted { if let value = point.grade.percent, value.isFinite { unique[point.date] = value } }
        nodes = unique.keys.sorted().map { Node(date: $0, value: unique[$0]!) }
        guard nodes.count > 1 else { segments = []; return }
        let widths = zip(nodes, nodes.dropFirst()).map { $1.date.timeIntervalSince($0.date) }
        let slopes = zip(nodes, nodes.dropFirst()).enumerated().map { ($1.1.value - $1.0.value) / widths[$0] }
        var tangents = [slopes[0]]
        if nodes.count > 2 {
            for i in 1..<(nodes.count - 1) {
                let a = slopes[i - 1], b = slopes[i]
                let p = (a * widths[i] + b * widths[i - 1]) / (widths[i - 1] + widths[i])
                let signA = a < 0 ? -1.0 : a > 0 ? 1.0 : 0
                let signB = b < 0 ? -1.0 : b > 0 ? 1.0 : 0
                tangents.append((signA + signB) * min(abs(a), abs(b), abs(p) / 2))
            }
        }
        tangents.append(slopes.last!)
        var built: [Segment] = []
        for i in 0..<(nodes.count - 1) { built.append(Segment(start: nodes[i], end: nodes[i + 1], startSlope: tangents[i], endSlope: tangents[i + 1])) }
        segments = built
    }
    public func value(at date: Date) -> Double? {
        guard let first = nodes.first, let last = nodes.last else { return nil }
        if date <= first.date { return first.value }
        if date >= last.date { return last.value }
        guard let segment = segments.first(where: { date <= $0.end.date }) else { return last.value }
        return segment.value(at: date.timeIntervalSince(segment.start.date) / segment.duration)
    }
}
