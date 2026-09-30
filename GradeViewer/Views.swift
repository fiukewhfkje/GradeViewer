import SwiftUI
import GradeCore

struct Palette {
    static let background = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.115, green: 0.115, blue: 0.11, alpha: 1) : UIColor(red: 0.99, green: 0.976, blue: 0.95, alpha: 1) })
    static let row = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.195, green: 0.19, blue: 0.185, alpha: 1) : UIColor(red: 0.953, green: 0.937, blue: 0.91, alpha: 1) })
    static let grade = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.30, green: 0.82, blue: 0.07, alpha: 1) : UIColor(red: 0.32, green: 0.74, blue: 0.16, alpha: 1) })
}
func percentText(_ value: Double?) -> String { value.map { $0.formatted(.number.precision(.fractionLength(0...2))) + "%" } ?? "—" }
func pointsText(_ value: Double?) -> String { value.map { $0.formatted(.number.precision(.fractionLength(0...2))) } ?? "—" }

/// A fixed label from a provider's score-change date, never a live refresh counter.
struct UpdatedLabel: View {
    let date: Date?
    var body: some View {
        if let date {
            let age = GradeUpdateAge(date: date)
            HStack(spacing: 5) {
                Text(age.text)
                Image(systemName: age.fresh ? "checkmark.circle.fill" : "clock").accessibilityHidden(true)
            }.font(.subheadline.weight(.semibold)).foregroundStyle(age.fresh ? Palette.grade : Color.secondary)
        }
    }
}
extension Course {
    var updated: Date? {
        let providerDates = display.assignments.filter { $0.score.earned != nil || $0.score.letter != nil }.compactMap(\.updated)
        return providerDates.max() ?? (history.count > 1 ? history.last?.date : nil)
    }
}
struct GradeLabel: View {
    let grade: OverallGrade
    var large = false
    var body: some View {
        VStack(alignment: .center, spacing: 4) {
            if let letter = grade.letter, !letter.isEmpty { Text(letter) }
            if grade.percent != nil || grade.letter == nil { Text(grade.percent.map { "(" + percentText($0) + ")" } ?? "—") }
        }.font(large ? .title2.bold() : .title3.bold()).foregroundStyle(Palette.grade).monospacedDigit().fixedSize(horizontal: true, vertical: false)
        .accessibilityElement(children: .combine)
    }
}
struct RootView: View {
    @Environment(AppStore.self) private var store
    @State private var tab = 0
    @State private var previewCourse: Course?
    private let screen = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--screen=") }?.replacingOccurrences(of: "--screen=", with: "")
    var body: some View {
        Group {
            if tab == 0 { NavigationStack { CourseListView() } }
            else { NavigationStack { SettingsView() } }
        }.onOpenURL { url in
            if url.scheme == "gradeviewer", url.host == "grades" { tab = 0; previewCourse = nil }
        }.safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                tabButton("Grades", icon: nil, selected: 0)
                tabButton("Profile", icon: "person", selected: 1)
            }.padding(.top, 8).padding(.bottom, 5).background(Palette.row)
                .overlay(alignment: .top) { Rectangle().fill(Color.primary.opacity(0.10)).frame(height: 0.5) }
        }.tint(.primary)
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
                    }.toolbar { CourseCloseToolbar { previewCourse = nil } }
                }.presentationDetents([.large])
            }
    }
    private func tabButton(_ name: String, icon: String?, selected: Int) -> some View {
        Button { tab = selected } label: {
            VStack(spacing: 4) {
                if let icon { Image(systemName: icon).font(.system(size: 25, weight: .light)).frame(height: 29) }
                else { Text("A+").font(.system(size: 25, weight: .light, design: .rounded)).frame(height: 29) }
                Text(name.lowercased()).font(.footnote)
            }.foregroundStyle(tab == selected ? Color.primary : Color.secondary.opacity(0.65)).frame(maxWidth: .infinity).padding(.vertical, 3)
        }.buttonStyle(.plain).accessibilityLabel(name).accessibilityIdentifier("tab-\(name.lowercased())").accessibilityAddTraits(tab == selected ? .isSelected : [])
    }
}
func closeButton(_ close: @escaping () -> Void) -> some View {
    Button(action: close) { Image(systemName: "xmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(.secondary).frame(width: 32, height: 32).background(Color.primary.opacity(0.08), in: Circle()) }.buttonStyle(.plain).accessibilityLabel("Close course")
}
struct CourseCloseToolbar: ToolbarContent {
    let close: () -> Void
    @ToolbarContentBuilder var body: some ToolbarContent {
        if #available(iOS 26, *) { ToolbarItem(placement: .topBarTrailing) { closeButton(close) }.sharedBackgroundVisibility(.hidden) }
        else { ToolbarItem(placement: .topBarTrailing) { closeButton(close) } }
    }
}
struct CourseListView: View {
    @Environment(AppStore.self) private var store
    @State private var selected: Course?
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                if store.demo { Text("Sample grades").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                if let error = store.localError { Text(error).font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                ForEach(ProviderID.allCases, id: \.self) { provider in
                    if let message = store.errors[provider] { Text(message).font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                }
                if store.courses.isEmpty {
                    VStack(spacing: 16) {
                        Text(store.connected.isEmpty ? "No grades yet" : "No courses available").font(.title3.bold())
                        if store.connected.isEmpty { NavigationLink("Connect a school account") { SettingsView() } }
                    }.frame(maxWidth: .infinity).padding(.vertical, 60)
                } else if store.visibleCourses.isEmpty {
                    Text("No courses available").padding(.vertical, 40)
                }
                ForEach(store.visibleCourses) { course in
                    Button { selected = course } label: {
                        HStack(spacing: 14) {
                            VStack(alignment: .leading, spacing: 7) {
                                Text(course.name).font(.title3.bold()).foregroundStyle(.primary).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                                UpdatedLabel(date: course.updated)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            GradeLabel(grade: course.display.grade)
                            Image(systemName: "chevron.right").font(.title3.weight(.medium)).foregroundStyle(.primary)
                        }.padding(16).frame(minHeight: 100).background(Palette.row, in: RoundedRectangle(cornerRadius: 16))
                    }.buttonStyle(.plain).accessibilityIdentifier("course-\(course.order)")
                }
            }.padding(.horizontal, 16).padding(.vertical, 12)
        }.background(Palette.background).navigationTitle("My grades")
            .refreshable { await store.refresh() }
            .sheet(item: $selected) { course in NavigationStack { CourseDetailView(courseID: course.id).toolbar { CourseCloseToolbar { selected = nil } } }.presentationDetents([.large]) }
    }
}
struct CourseDetailView: View {
    @Environment(AppStore.self) private var store
    let courseID: String
    var body: some View {
        if let course = store.courses.first(where: { $0.id == courseID }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 34) {
                    CourseGradeSummary(course: course)
                    VStack(alignment: .leading, spacing: 17) {
                        Text("Grade Progression").font(.title3.bold())
                        GradeProgressionView(course: course).zIndex(1)
                    }.zIndex(1)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Recently Graded Assignments").font(.title3.bold()).padding(.bottom, 7)
                        let schoology = AssignmentGrouping.schoologySource(for: course, among: store.courses.flatMap(\.sources))
                        let recent = AssignmentGrouping.overview(for: course, schoology: schoology).prefix(5)
                        ForEach(Array(recent)) { assignment in InteractiveAssignmentRow(assignment: assignment, course: course) }
                    }
                    NavigationLink { AssignmentsView(course: course) } label: {
                        HStack(spacing: 18) { Text("View All Assignments").font(.headline); Image(systemName: "arrow.right") }.foregroundStyle(Palette.background).frame(maxWidth: .infinity).padding(.vertical, 25).background(Color.primary, in: RoundedRectangle(cornerRadius: 16))
                    }.buttonStyle(.plain)
                }.padding(.horizontal, 16).padding(.top, 24).padding(.bottom, 24)
            }.background(Palette.background).navigationTitle(course.name).navigationBarTitleDisplayMode(.inline)
        } else { ContentUnavailableView("Course unavailable", systemImage: "list.bullet") }
    }
}
struct GradeProgressionView: View {
    let course: Course
    @State private var calculated: [GradeProgressionPoint] = []
    var body: some View {
        GradeChart(history: course.history, calculated: calculated)
            .task(id: course.calculationSource.fetched) {
                let source = course.calculationSource, first = course.calculationSource.fetched
                let points = await Task.detached(priority: .userInitiated) { GradeProgression.calculated(source, before: first) }.value
                if !Task.isCancelled { calculated = points }
            }
    }
}
struct GradeChart: View {
    let curve: GradeCurve
    @State private var selection: CGFloat?
    @State private var lastTouch: CGFloat?
    init(history: [GradeHistorySnapshot], calculated: [GradeProgressionPoint] = []) {
        curve = GradeCurve(points: calculated + history.map(GradeProgressionPoint.init))
        #if DEBUG
        _selection = State(initialValue: ProcessInfo.processInfo.arguments.contains("--demo") && ProcessInfo.processInfo.arguments.contains("--preview-chart-touch") ? 0.5 : nil)
        #endif
    }
    private var selectedEvent: GradeCurve.Node? { curve.event(at: Double(selection ?? 0)) }
    private var selectedValue: Double? { selectedEvent?.value }
    private var bounds: ClosedRange<Double> {
        let low = curve.nodes.map(\.value).min() ?? 0, high = curve.nodes.map(\.value).max() ?? 100
        let padding = max(1, (high - low) * 0.12)
        return (low - padding)...(high + padding)
    }
    private func position(fraction: Double, value: Double, size: CGSize) -> CGPoint {
        let x = fraction
        let y = (value - bounds.lowerBound) / (bounds.upperBound - bounds.lowerBound)
        return CGPoint(x: x * size.width, y: 12 + (1 - y) * (size.height - 24))
    }
    private func line(size: CGSize) -> Path {
        Path { path in
            guard let first = curve.nodes.first else { return }
            if curve.nodes.count == 1 {
                let y = position(fraction: first.fraction, value: first.value, size: size).y
                path.move(to: CGPoint(x: 0, y: y)); path.addLine(to: CGPoint(x: size.width, y: y)); return
            }
            path.move(to: position(fraction: first.fraction, value: first.value, size: size))
            for segment in curve.segments {
                let step = segment.duration / 3
                path.addCurve(to: position(fraction: segment.end.fraction, value: segment.end.value, size: size),
                              control1: position(fraction: segment.start.fraction + step, value: segment.start.value + segment.startSlope * step, size: size),
                              control2: position(fraction: segment.end.fraction - step, value: segment.end.value - segment.endSlope * step, size: size))
            }
        }
    }
    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size, path = line(size: size)
            let x = (selection ?? 1) * size.width
            ZStack(alignment: .topLeading) {
                var fill = path
                let _ = fill.addLine(to: CGPoint(x: size.width, y: size.height))
                let _ = fill.addLine(to: CGPoint(x: 0, y: size.height))
                let _ = fill.closeSubpath()
                fill.fill(LinearGradient(colors: [.primary.opacity(0.20), .primary.opacity(0)], startPoint: .top, endPoint: .bottom))
                path.stroke(Color.primary.opacity(selection == nil ? 1 : 0.25), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                if selection != nil {
                    path.stroke(Color.primary, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .mask(alignment: .leading) { Rectangle().frame(width: x) }
                }
            }.background(Palette.row, in: RoundedRectangle(cornerRadius: 16))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged {
                    selection = min(1, max(0, $0.location.x / size.width))
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--record-chart-touch") { lastTouch = selection }
                    #endif
                }.onEnded { _ in selection = nil })
                .overlay(alignment: .topLeading) {
                    if let selection, let event = selectedEvent, let trace = curve.traceValue(at: Double(selection)) {
                        let y = position(fraction: Double(selection), value: trace, size: size).y
                        Circle().fill(Color.primary.opacity(0.12)).frame(width: 32, height: 32).position(x: selection * size.width, y: y)
                        Circle().fill(Color.primary).frame(width: 8, height: 8).position(x: selection * size.width, y: y)
                        VStack(spacing: 6) {
                            Text(event.value, format: .number.precision(.fractionLength(2))).font(.subheadline.bold())
                            Text(event.date, format: .dateTime.month(.defaultDigits).day().year()).font(.subheadline)
                        }.foregroundStyle(Color(red: 0.13, green: 0.13, blue: 0.12)).padding(12)
                            .background(Color(red: 0.99, green: 0.976, blue: 0.95), in: RoundedRectangle(cornerRadius: 16))
                            .fixedSize().position(x: min(size.width - 48, max(48, selection * size.width)), y: -62)
                            .accessibilityIdentifier("chart-selection")
                    }
                }
        }.frame(height: 154)
            .accessibilityElement(children: .ignore).accessibilityIdentifier("grade-chart").accessibilityLabel("Grade progression")
            .accessibilityValue(accessibilityValue)
    }
    private var accessibilityValue: String {
        if selection != nil { return "Selected \(percentText(selectedValue)) on \((selectedEvent?.date.formatted(date: .numeric, time: .omitted) ?? ""))" }
        #if DEBUG
        // Explicit fixture instrumentation checks real gesture samples after XCTest releases its touch.
        if ProcessInfo.processInfo.arguments.contains("--record-chart-touch"), let lastTouch {
            return "Released; last touch \(percentText(curve.event(at: Double(lastTouch))?.value))"
        }
        #endif
        return "\(curve.nodes.count) grades, latest \(percentText(curve.nodes.last?.value))"
    }
}
struct AssignmentRow: View {
    let assignment: Assignment
    var changed = false
    var dropped = false
    var body: some View {
        let a = assignment.display
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 7) {
                Text(a.title).font(.body.weight(.semibold)).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                UpdatedLabel(date: a.updated)
            }.frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 6) {
                if a.score.excused { Text("Excused").foregroundStyle(.secondary) }
                else if a.score.earned != nil { Text("\(pointsText(a.score.earned))/\(pointsText(a.score.possible))").font(.body.weight(.semibold)); Text(percentText(a.score.percent)).font(.body.weight(.medium)) }
                else { Text(a.score.letter ?? "Ungraded").foregroundStyle(.secondary) }
            }.foregroundStyle(changed ? Color.blue : Palette.grade).strikethrough(dropped).monospacedDigit().fixedSize()
        }.padding(.vertical, 23).padding(.leading, 16).padding(.trailing, 6)
    }
}
struct AssignmentsView: View {
    @Environment(AppStore.self) private var store
    let course: Course
    var body: some View {
        let source = AssignmentGrouping.schoologySource(for: course, among: store.courses.flatMap(\.sources))
        let full = AssignmentGrouping.fullCourse(for: course, among: store.courses)
        let groups = AssignmentGrouping.groups(for: full, schoology: source)
        ScrollView {
            VStack(spacing: 20) {
                CourseGradeSummary(course: course)
                ForEach(groups) { group in AssignmentGroup(course: course, title: group.title, assignments: group.assignments) }
            }.padding(16)
        }.background(Palette.background).navigationTitle(course.name).navigationBarTitleDisplayMode(.inline)
    }
}
struct AssignmentGroup: View {
    let course: Course
    let title: String
    let assignments: [Assignment]
    @State private var expanded = false
    var body: some View {
        VStack(spacing: 0) {
            Button { withAnimation(.easeInOut(duration: 0.18)) { expanded.toggle() } } label: {
                HStack(spacing: 16) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.body.weight(.semibold)).frame(width: 46, height: 46).background(Palette.background, in: Circle())
                    Text(title).font(.title3.bold()).frame(maxWidth: .infinity, alignment: .leading)
                    if title == "Total Points" { GradeLabel(grade: course.display.grade) }
                }.foregroundStyle(.primary).padding(16)
            }.buttonStyle(.plain).accessibilityLabel(title).accessibilityValue(expanded ? "Expanded" : "Collapsed")
            if expanded {
                LazyVStack(spacing: 0) {
                    ForEach(assignments) { assignment in
                        Divider().padding(.horizontal, 16)
                        InteractiveAssignmentRow(assignment: assignment, course: course, compact: true)
                    }
                }
            }
        }.background(Palette.row, in: RoundedRectangle(cornerRadius: 16))
    }
}
struct CategoriesView: View {
    let course: Course
    var body: some View { AssignmentsView(course: course) }
}
struct AssignmentDetailView: View {
    let assignment: Assignment; let course: Course
    var body: some View {
        Form {
            Section { Text(assignment.display.title).font(.headline); AssignmentRow(assignment: assignment) }
            if let due = assignment.display.due { LabeledContent("Due", value: due.formatted(date: .abbreviated, time: .shortened)) }
            if assignment.display.excluded { Text("Excluded from the course grade.").foregroundStyle(.secondary) }
            if assignment.disagrees { Section("Source scores") { ForEach(assignment.sources) { source in LabeledContent(source.source.provider.name, value: "\(pointsText(source.score.earned))/\(pointsText(source.score.possible))") } } }
        }.navigationTitle("Assignment").navigationBarTitleDisplayMode(.inline)
    }
}
struct SourceGradesView: View {
    let course: Course
    var body: some View { List { ForEach(course.sources) { source in HStack { Text(source.source.provider.name); Spacer(); GradeLabel(grade: source.grade) } } }.navigationTitle("Source grades").navigationBarTitleDisplayMode(.inline) }
}
