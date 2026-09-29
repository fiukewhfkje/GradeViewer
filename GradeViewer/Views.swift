import SwiftUI
import Charts
import GradeCore

struct Palette {
    static let background = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.105, green: 0.105, blue: 0.10, alpha: 1) : UIColor(red: 0.99, green: 0.976, blue: 0.95, alpha: 1) })
    static let row = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.18, green: 0.18, blue: 0.17, alpha: 1) : UIColor(red: 0.953, green: 0.937, blue: 0.91, alpha: 1) })
    static let grade = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.49, green: 0.84, blue: 0.48, alpha: 1) : UIColor(red: 0.18, green: 0.47, blue: 0.18, alpha: 1) })
}
func percentText(_ value: Double?) -> String { value.map { $0.formatted(.number.precision(.fractionLength(0...2))) + "%" } ?? "—" }
func pointsText(_ value: Double?) -> String { value.map { $0.formatted(.number.precision(.fractionLength(0...2))) } ?? "—" }
struct GradeLabel: View {
    let grade: OverallGrade
    var large = false
    var body: some View {
        VStack(alignment: .trailing, spacing: 3) {
            if let letter = grade.letter, !letter.isEmpty { Text(letter).font(large ? .title2.bold() : .headline) }
            if grade.percent != nil || grade.letter == nil { Text(percentText(grade.percent)).font(large ? .title2.bold() : .headline) }
        }.foregroundStyle(Palette.grade).monospacedDigit().fixedSize(horizontal: true, vertical: false)
        .accessibilityElement(children: .combine)
    }
}
struct RootView: View {
    @Environment(AppStore.self) private var store
    @State private var tab = 0
    @State private var previewCourse: Course?
    private let screen = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--screen=") }?.replacingOccurrences(of: "--screen=", with: "")
    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { CourseListView() }.tabItem { Label("Grades", systemImage: "list.bullet") }.tag(0)
            NavigationStack { SettingsView() }.tabItem { Label("Settings", systemImage: "gearshape") }.tag(1)
        }.tint(Palette.grade)
            .onAppear { if screen == "settings" { tab = 1 }; if screen != nil && screen != "settings" { previewCourse = store.courses.first } }
            .sheet(item: $previewCourse) { course in
                NavigationStack {
                    Group {
                        switch screen {
                        case "assignments": AssignmentsView(course: course)
                        case "categories": CategoriesView(course: course)
                        case "whatif": WhatIfView(course: course)
                        case "final": FinalCalculatorView(course: course)
                        case "widget": WidgetPreviewView(courses: store.courses)
                        default: CourseDetailView(courseID: course.id)
                        }
                    }.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { previewCourse = nil } } }
                }.presentationDetents([.large])
            }
    }
}
struct CourseListView: View {
    @Environment(AppStore.self) private var store
    @State private var selected: Course?
    var body: some View {
        @Bindable var store = store
        ScrollView {
            LazyVStack(spacing: 10) {
                if store.demo { Text("Sample grades").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                if store.terms.count > 1 {
                    Picker("Term", selection: $store.selectedTerm) { ForEach(store.terms, id: \.self) { Text($0).tag($0) } }.pickerStyle(.menu).frame(maxWidth: .infinity, alignment: .leading)
                        .onChange(of: store.selectedTerm) { _, _ in store.updateWidget() }
                }
                if let error = store.localError { Text(error).font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                ForEach(ProviderID.allCases, id: \.self) { provider in
                    if let message = store.errors[provider] { Text(message).font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                }
                if store.courses.isEmpty {
                    VStack(spacing: 16) {
                        Text(store.connected.isEmpty ? "No grades yet" : "No courses available").font(.title3.bold())
                        if store.connected.isEmpty { NavigationLink("Connect a school account") { SettingsView() } }
                        else { Button("Refresh") { Task { await store.refresh() } }.disabled(store.refreshing) }
                    }.frame(maxWidth: .infinity).padding(.vertical, 60)
                } else if store.visibleCourses.isEmpty {
                    Text("All courses are hidden.").foregroundStyle(.secondary).padding(.vertical, 40)
                    NavigationLink("Edit courses") { CourseOrderView() }
                }
                ForEach(store.visibleCourses) { course in
                    Button { selected = course } label: {
                        HStack(spacing: 14) {
                            VStack(alignment: .leading, spacing: 7) {
                                Text(course.display.title).font(.headline).foregroundStyle(.primary).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                                Text("Refreshed \(course.display.fetched, style: .relative) ago").font(.caption).foregroundStyle(.secondary)
                                    .accessibilityLabel("Refreshed \(course.display.fetched.formatted(date: .abbreviated, time: .shortened))")
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            GradeLabel(grade: course.display.grade)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                        }.padding(18).frame(minHeight: 94).background(Palette.row, in: RoundedRectangle(cornerRadius: 16))
                    }.buttonStyle(.plain).accessibilityIdentifier("course-\(course.order)")
                }
                if store.refreshing { ProgressView().padding(8).accessibilityLabel("Refreshing grades") }
            }.padding(.horizontal, 16).padding(.vertical, 12)
        }.background(Palette.background).navigationTitle("My grades")
            .refreshable { await store.refresh() }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("Refresh grades").disabled(store.refreshing || store.demo) } }
            .sheet(item: $selected) { course in NavigationStack { CourseDetailView(courseID: course.id).toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { selected = nil } } } }.presentationDetents([.large]) }
    }
}
struct CourseDetailView: View {
    @Environment(AppStore.self) private var store
    let courseID: String
    var body: some View {
        if let course = store.courses.first(where: { $0.id == courseID }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 25) {
                    CourseGradeSummary(course: course)
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Grade progression").font(.title3.bold())
                        GradeChart(history: course.history)
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        HStack { Text("Recently graded").font(.title3.bold()); Spacer(); NavigationLink("All") { AssignmentsView(course: course) }.font(.subheadline) }
                        let recent = course.assignments.filter { $0.display.score.earned != nil || $0.display.score.letter != nil }.prefix(3)
                        if recent.isEmpty { Text("No graded assignments.").font(.subheadline).foregroundStyle(.secondary) }
                        ForEach(Array(recent)) { assignment in
                            InteractiveAssignmentRow(assignment: assignment, course: course)
                        }
                    }
                    VStack(spacing: 0) {
                        detailLink("Categories") { CategoriesView(course: course) }
                        Divider().padding(.horizontal)
                        detailLink("What-If") { WhatIfView(course: course) }
                        Divider().padding(.horizontal)
                        detailLink("Final grade calculator") { FinalCalculatorView(course: course) }
                    }.background(Palette.row, in: RoundedRectangle(cornerRadius: 16))
                    if course.disagrees { NavigationLink("Grades differ between sources") { SourceGradesView(course: course) }.font(.footnote) }
                }.padding(16)
            }.background(Palette.background).navigationTitle(course.display.title).navigationBarTitleDisplayMode(.inline)
        } else { ContentUnavailableView("Course unavailable", systemImage: "list.bullet") }
    }
    private func detailLink<Destination: View>(_ title: String, @ViewBuilder destination: () -> Destination) -> some View {
        NavigationLink(destination: destination) { HStack { Text(title).foregroundStyle(.primary); Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary) }.padding(17) }
    }
}
struct GradeChart: View {
    let history: [GradeHistorySnapshot]
    @State private var selection: Date?
    var selectedPoint: GradeHistorySnapshot? { guard let selection else { return nil }; return points.min { abs($0.date.timeIntervalSince(selection)) < abs($1.date.timeIntervalSince(selection)) } }
    var points: [GradeHistorySnapshot] { history.filter { $0.grade.percent != nil } }
    var domain: ClosedRange<Double> { let values = points.compactMap { $0.grade.percent }; return max(0, (values.min() ?? 0) - 1)...max(1, (values.max() ?? 100) + 1) }
    var body: some View {
        if points.count < 2 { Text("History will appear when your grade changes.").font(.subheadline).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 110).background(Palette.row, in: RoundedRectangle(cornerRadius: 16)) }
        else {
            Chart {
                ForEach(points) { point in
                LineMark(x: .value("Date", point.date), y: .value("Grade", point.grade.percent!)).foregroundStyle(Palette.grade).lineStyle(StrokeStyle(lineWidth: 2.5))
                PointMark(x: .value("Date", point.date), y: .value("Grade", point.grade.percent!)).foregroundStyle(Palette.grade).symbolSize(18)
                }
                if let selected = selectedPoint {
                    RuleMark(x: .value("Selected date", selected.date)).foregroundStyle(.secondary).lineStyle(StrokeStyle(lineWidth: 1, dash: [3]))
                    PointMark(x: .value("Date", selected.date), y: .value("Grade", selected.grade.percent!)).foregroundStyle(Palette.grade).symbolSize(65)
                        .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                            VStack(spacing: 3) { Text(percentText(selected.grade.percent)).bold(); Text(selected.date, format: .dateTime.month().day().year()) }.font(.caption).padding(8).background(.background, in: RoundedRectangle(cornerRadius: 8)).accessibilityIdentifier("chart-selection")
                        }
                }
            }.chartYScale(domain: domain)
                .chartXSelection(value: $selection)
                .chartGesture { proxy in
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in proxy.selectXValue(at: value.location.x) }
                        .onEnded { value in proxy.selectXValue(at: value.location.x) }
                }
                .accessibilityIdentifier("grade-chart")
                .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in AxisGridLine(); AxisValueLabel { if let n = value.as(Double.self) { Text(n.formatted(.number.precision(.fractionLength(0...1))) + "%").font(.caption2) } } } }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) { _ in AxisValueLabel(format: .dateTime.month(.abbreviated).day()) } }
                .frame(height: 155).padding(16).background(Palette.row, in: RoundedRectangle(cornerRadius: 16))
                .accessibilityLabel("Grade history").accessibilityValue(selectedPoint.map { "Selected " + percentText($0.grade.percent) + " on " + $0.date.formatted(date: .abbreviated, time: .omitted) } ?? "\(points.count) changes, latest \(percentText(points.last?.grade.percent))")
        }
    }
}
struct AssignmentRow: View {
    let assignment: Assignment
    var body: some View {
        let a = assignment.display
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(a.title).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                if let date = a.updated ?? a.due { Text(date, format: .dateTime.month(.abbreviated).day()).font(.caption).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 4) {
                if a.score.excused { Text("Excused").foregroundStyle(.secondary) }
                else if a.score.earned != nil { Text("\(pointsText(a.score.earned))/\(pointsText(a.score.possible))").font(.subheadline.weight(.semibold)); Text(percentText(a.score.percent)).font(.caption) }
                else { Text(a.score.letter ?? "Ungraded").font(.subheadline).foregroundStyle(.secondary) }
            }.foregroundStyle(Palette.grade).monospacedDigit().fixedSize()
        }.padding(16).background(Palette.row, in: RoundedRectangle(cornerRadius: 16))
    }
}
struct AssignmentsView: View {
    let course: Course
    var body: some View {
        ScrollView { LazyVStack(spacing: 9) {
            CourseGradeSummary(course: course)
            ForEach(course.assignments) { a in InteractiveAssignmentRow(assignment: a, course: course) }
            if course.assignments.isEmpty { Text("No assignments available.").foregroundStyle(.secondary).padding(40) }
        }.padding(16) }.background(Palette.background).navigationTitle("Assignments").navigationBarTitleDisplayMode(.inline)
    }
}
struct AssignmentDetailView: View {
    let assignment: Assignment; let course: Course
    var body: some View {
        Form {
            Section { Text(assignment.display.title).font(.headline); AssignmentRow(assignment: assignment) }
            if let due = assignment.display.due { LabeledContent("Due", value: due.formatted(date: .abbreviated, time: .shortened)) }
            if assignment.display.excluded { Text("Excluded from the course grade.").foregroundStyle(.secondary) }
            NavigationLink("What-If") { WhatIfView(course: course) }
            if assignment.disagrees {
                Section("Source scores") { ForEach(assignment.sources) { source in LabeledContent(source.source.provider.name, value: "\(pointsText(source.score.earned))/\(pointsText(source.score.possible))") } }
            }
        }.navigationTitle("Assignment").navigationBarTitleDisplayMode(.inline)
    }
}
struct CategoriesView: View {
    let course: Course
    var body: some View {
        List {
            CourseGradeSummary(course: course).listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            ForEach(course.calculationSource.categories) { category in
                Section {
                    DisclosureGroup {
                        ForEach(course.assignments.filter { a in a.sources.contains { $0.source.provider == course.calculationSource.source.provider && $0.categoryID == category.id } }) { a in InteractiveAssignmentRow(assignment: a, course: course, compact: true) }
                    } label: {
                        HStack { Text(category.name); Spacer(); if category.excluded { Text("Excluded").foregroundStyle(.secondary) } else if let weight = category.weight, course.calculationSource.method == .weightedCategories { Text("\(pointsText(weight))% weight").foregroundStyle(.secondary) } }
                    }
                    if category.dropLowest > 0 { LabeledContent("Drop lowest", value: String(category.dropLowest)) }
                }
            }
            if course.calculationSource.categories.isEmpty { Text("No categories available.").foregroundStyle(.secondary) }
        }.navigationTitle("Categories").navigationBarTitleDisplayMode(.inline)
    }
}
struct SourceGradesView: View {
    let course: Course
    var body: some View { List { ForEach(course.sources) { source in HStack { Text(source.source.provider.name); Spacer(); GradeLabel(grade: source.grade) } } }.navigationTitle("Source grades").navigationBarTitleDisplayMode(.inline) }
}
