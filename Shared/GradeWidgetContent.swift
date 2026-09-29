import SwiftUI
import GradeCore
struct GradeWidgetContent: View {
    let snapshot: WidgetSnapshot
    let compact: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if snapshot.courses.isEmpty { Text("GradeViewer").font(.headline); Spacer(); Text("Open the app to load grades.").font(.caption).foregroundStyle(.secondary) }
            else if compact, let course = snapshot.courses.first {
                Text(course.name).font(.subheadline.weight(.semibold)).lineLimit(3)
                Spacer(minLength: 0)
                Text(course.grade.letter ?? course.grade.percent.map { $0.formatted(.number.precision(.fractionLength(0...1))) + "%" } ?? "—").font(.largeTitle.bold()).minimumScaleFactor(0.6).lineLimit(1)
                if course.grade.letter != nil, let n = course.grade.percent { Text(n.formatted(.number.precision(.fractionLength(0...2))) + "%").font(.caption).monospacedDigit().foregroundStyle(.secondary) }
            } else {
                ForEach(snapshot.courses.prefix(3)) { course in
                    HStack { Text(course.name).lineLimit(2); Spacer(minLength: 8); Text(course.grade.percent.map { $0.formatted(.number.precision(.fractionLength(0...1))) + "%" } ?? course.grade.letter ?? "—").fontWeight(.semibold).monospacedDigit().fixedSize() }
                    if course.id != snapshot.courses.prefix(3).last?.id { Divider() }
                }.font(.subheadline)
            }
            if let date = snapshot.refreshed { Text(date, style: .relative).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}
