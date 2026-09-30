import Foundation

/// Smooth geometry across evenly spaced grade events. The tooltip selects an
/// event independently: interpolated geometry is never an historical grade.
public struct GradeCurve: Sendable {
    public struct Node: Sendable {
        public let date: Date
        public let value: Double
        public let fraction: Double
    }
    public struct Segment: Sendable {
        public let start: Node; public let end: Node
        public let startSlope: Double; public let endSlope: Double
        public var duration: Double { end.fraction - start.fraction }
        public func value(at fraction: Double) -> Double {
            let t = min(1, max(0, fraction)), t2 = t * t, t3 = t2 * t
            return (2 * t3 - 3 * t2 + 1) * start.value + (t3 - 2 * t2 + t) * duration * startSlope
                + (-2 * t3 + 3 * t2) * end.value + (t3 - t2) * duration * endSlope
        }
    }
    public let nodes: [Node]
    public let segments: [Segment]
    public init(points: [GradeProgressionPoint]) {
        // Stable input order preserves distinct contributions with identical dates.
        // An observed value wins at its timestamp, after any calculated events.
        let sorted = points.enumerated().filter { $0.element.grade.percent?.isFinite == true }.sorted {
            if $0.element.date != $1.element.date { return $0.element.date < $1.element.date }
            if $0.element.calculated != $1.element.calculated { return $0.element.calculated }
            return $0.offset < $1.offset
        }
        var seen = Set<String>()
        let events = sorted.map(\.element).filter { seen.insert($0.id).inserted }
        nodes = events.enumerated().map { index, point in
            Node(date: point.date, value: point.grade.percent!, fraction: events.count > 1 ? Double(index) / Double(events.count - 1) : 0.5)
        }
        guard nodes.count > 1 else { segments = []; return }
        let widths = zip(nodes, nodes.dropFirst()).map { $1.fraction - $0.fraction }
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
        for i in 0..<(nodes.count - 1) {
            built.append(Segment(start: nodes[i], end: nodes[i + 1], startSlope: tangents[i], endSlope: tangents[i + 1]))
        }
        segments = built
    }
    /// Only for the line and tracing marker; never show this as a grade.
    public func traceValue(at fraction: Double) -> Double? {
        guard fraction.isFinite, let first = nodes.first, let last = nodes.last else { return nil }
        if fraction <= first.fraction { return first.value }
        if fraction >= last.fraction { return last.value }
        guard let segment = segments.first(where: { fraction <= $0.end.fraction }) else { return last.value }
        return segment.value(at: (fraction - segment.start.fraction) / segment.duration)
    }
    /// Changes once at each midpoint threshold, with the actual event's date/value.
    public func event(at fraction: Double) -> Node? {
        guard fraction.isFinite, !nodes.isEmpty else { return nil }
        let index = Int((min(1, max(0, fraction)) * Double(nodes.count - 1)).rounded())
        return nodes[index]
    }
}
