import SwiftUI
import WidgetKit
import GradeCore
struct GradeEntry: TimelineEntry { var date: Date; var snapshot: WidgetSnapshot }
struct GradeTimeline: TimelineProvider {
    func placeholder(in context: Context) -> GradeEntry { GradeEntry(date: Date(), snapshot: WidgetSnapshot(courses: Demo.courses().prefix(3).map(WidgetCourse.init), refreshed: Date())) }
    func getSnapshot(in context: Context, completion: @escaping (GradeEntry) -> Void) { completion(context.isPreview ? placeholder(in: context) : load()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<GradeEntry>) -> Void) { completion(Timeline(entries: [load()], policy: .never)) }
    func load() -> GradeEntry {
        let snapshot: WidgetSnapshot
        if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.ashtonchang.GradeViewer")?.appendingPathComponent("grades.json"), let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) { snapshot = value }
        else { snapshot = WidgetSnapshot() }
        return GradeEntry(date: Date(), snapshot: snapshot)
    }
}
struct GradesWidget: Widget {
    let kind = "GradeViewerGrades"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: GradeTimeline()) { entry in GradeWidgetView(entry: entry) }
            .configurationDisplayName("Grades").description("Current grades from this device.").supportedFamilies([.systemSmall, .systemMedium])
    }
}
struct GradeWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GradeEntry
    var body: some View { GradeWidgetContent(snapshot: entry.snapshot, compact: family == .systemSmall).containerBackground(.background, for: .widget).widgetURL(URL(string: "gradeviewer://grades")) }
}
@main struct GradeWidgets: WidgetBundle { var body: some Widget { GradesWidget() } }
