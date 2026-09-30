import SwiftUI
import GradeCore

struct WhatIfView: View {
    @Environment(AppStore.self) private var store
    let course: Course
    @State private var hypothesis = Hypothesis()
    @State private var adding = false
    @State private var error: String?
    var reliable: Bool { GradeCalculator.isReliable(course.calculationSource) }
    var result: Double? { reliable ? try? GradeCalculator.hypotheticalPercent(course: course.calculationSource, hypothesis: hypothesis) : nil }
    var body: some View {
        Form {
            Section {
                LabeledContent("Current", value: percentText(course.display.grade.percent))
                LabeledContent("What-If", value: percentText(result)).font(.headline)
                if !reliable { Text("The visible assignments do not reproduce the course grade. What-If is unavailable for this course.").font(.footnote).foregroundStyle(.secondary) }
                else if result == nil { Text("No graded assignments remain in this scenario.").font(.footnote).foregroundStyle(.secondary) }
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            Section("Assignments") {
                ForEach(course.calculationSource.assignments.filter { $0.score.isGraded } + hypothesis.added) { a in
                    ScenarioRow(assignment: a, score: Binding(get: { hypothesis.scores[a.id] ?? a.score.earned }, set: { value in
                        if let value { hypothesis.scores[a.id] = value } else { hypothesis.scores[a.id] = nil }
                    }), ignored: Binding(get: { hypothesis.ignored.contains(a.id) }, set: { ignored in if ignored { hypothesis.ignored.insert(a.id) } else { hypothesis.ignored.remove(a.id) } }))
                }
                Button("Add assignment") { adding = true }.disabled(!reliable)
            }.disabled(!reliable)
            Section { Button("Reset What-If", role: .destructive) { hypothesis = Hypothesis() } }
        }.navigationTitle("What-If").navigationBarTitleDisplayMode(.inline)
            .onAppear { hypothesis = store.scenario(course) }
            .onChange(of: hypothesis.scores) { _, _ in save() }
            .onChange(of: hypothesis.ignored) { _, _ in save() }
            .onChange(of: hypothesis.added) { _, _ in save() }
            .sheet(isPresented: $adding) { NavigationStack { AddAssignmentView(course: course) { a in hypothesis.added.append(a); adding = false }.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { adding = false } } } } }
    }
    func save() { store.saveScenario(hypothesis, course: course) }
}
struct ScenarioRow: View {
    let assignment: SourceAssignment
    @Binding var score: Double?
    @Binding var ignored: Bool
    @State private var input = ""
    @State private var invalid = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text(assignment.title).fixedSize(horizontal: false, vertical: true); Spacer(); Text(pointsText(assignment.score.possible) + " pts").font(.caption).foregroundStyle(.secondary) }
            HStack {
                TextField("Ungraded", text: $input).keyboardType(.decimalPad).textFieldStyle(.roundedBorder).frame(maxWidth: 130).accessibilityLabel("Hypothetical score for \(assignment.title)")
                Spacer()
                Toggle("Ignore", isOn: $ignored).fixedSize()
            }
            if invalid { Text("Enter a score of zero or more.").font(.caption).foregroundStyle(.red) }
        }.padding(.vertical, 5).opacity(ignored ? 0.55 : 1)
            .onAppear { input = score.map(pointsText) ?? "" }
            .onChange(of: score) { _, value in if !invalid { input = value.map(pointsText) ?? "" } }
            .onChange(of: input) { _, value in
                if value.isEmpty { invalid = false; score = nil }
                else if let n = Double(value.replacingOccurrences(of: ",", with: ".")), n.isFinite, n >= 0 { invalid = false; score = n }
                else { invalid = true }
            }
    }
}
struct AddAssignmentView: View {
    let course: Course
    let add: (SourceAssignment) -> Void
    @State private var title = ""
    @State private var earned = ""
    @State private var possible = "100"
    @State private var category = ""
    var valid: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && Double(earned).map { $0.isFinite && $0 >= 0 } == true && Double(possible).map { $0.isFinite && $0 > 0 } == true && (course.calculationSource.method == .points || !category.isEmpty) }
    var body: some View {
        Form {
            TextField("Assignment name", text: $title)
            HStack { Text("Score"); Spacer(); TextField("Score", text: $earned).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
            HStack { Text("Points possible"); Spacer(); TextField("Points possible", text: $possible).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
            if !course.calculationSource.categories.isEmpty { Picker("Category", selection: $category) { ForEach(course.calculationSource.categories.filter { !$0.excluded }) { Text($0.name).tag($0.id) } } }
            Button("Add") {
                guard valid, let e = Double(earned), let p = Double(possible) else { return }
                add(SourceAssignment(source: Provenance(course.calculationSource.source.provider, "hypothetical:\(UUID().uuidString)"), title: title, categoryID: category.isEmpty ? nil : category, score: Score(earned: e, possible: p)))
            }.disabled(!valid)
        }.navigationTitle("Add assignment").navigationBarTitleDisplayMode(.inline)
            .onAppear { category = course.calculationSource.categories.first(where: { !$0.excluded })?.id ?? "" }
    }
}
struct FinalCalculatorView: View {
    let course: Course
    @State private var current = ""
    @State private var target = "90"
    @State private var weight = "20"
    var required: Double? { guard let c = Double(current), let t = Double(target), let w = Double(weight) else { return nil }; return try? GradeCalculator.requiredFinal(current: c, target: t, weight: w / 100) }
    var body: some View {
        Form {
            Section {
                input("Current grade (%)", text: $current)
                input("Target grade (%)", text: $target)
                input("Final weight (%)", text: $weight)
            } footer: { Text("Enter the final exam weight from your course syllabus.") }
            Section {
                LabeledContent("Needed on final", value: percentText(required)).font(.title3.bold()).monospacedDigit()
                if let required {
                    if required > 100 { Text("Requires extra credit.").font(.footnote).foregroundStyle(.secondary) }
                    else if required < 0 { Text("A zero on the final still meets this target.").font(.footnote).foregroundStyle(.secondary) }
                } else { Text("Enter valid grades and a final weight greater than 0% and at most 100%.").font(.footnote).foregroundStyle(.secondary) }
            }
        }.navigationTitle("Final grade").navigationBarTitleDisplayMode(.inline).onAppear { current = course.display.grade.percent.map(pointsText) ?? "" }
    }
    func input(_ label: String, text: Binding<String>) -> some View { HStack { Text(label); Spacer(); TextField(label, text: text).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 100) } }
}

/// The same local scenario is used by overview, assignments, categories, and What-If.
struct InteractiveAssignmentRow: View {
    @Environment(AppStore.self) private var store
    let assignment: Assignment
    let course: Course
    var compact = false
    @State private var editing = false
    var source: SourceAssignment { assignment.sources.first { $0.source.provider == course.calculationSource.source.provider } ?? assignment.display }
    var scenario: Hypothesis { store.scenario(course) }
    var dropped: Bool { scenario.ignored.contains(source.id) }
    var changed: Bool { scenario.scores[source.id] != nil || dropped }
    var simulated: Assignment {
        var a = source
        if let earned = scenario.scores[a.id] { a.score.earned = earned }
        return Assignment(id: assignment.id, sources: [a])
    }
    var body: some View {
        HStack(spacing: 0) {
            AssignmentRow(assignment: simulated, changed: changed, dropped: dropped)
            Menu {
                Button("Edit Grade", systemImage: "pencil") { editing = true }
                Button(dropped ? "Undrop Assignment" : "Drop Assignment", systemImage: dropped ? "plus.circle" : "minus.circle") {
                    var h = scenario; if dropped { h.ignored.remove(source.id) } else { h.ignored.insert(source.id) }; store.saveScenario(h, course: course)
                }
                Button("Reset Assignment", systemImage: "arrow.uturn.backward") { var h = scenario; h.scores[source.id] = nil; h.ignored.remove(source.id); store.saveScenario(h, course: course) }.disabled(!changed)
            } label: { Image(systemName: "ellipsis").rotationEffect(.degrees(90)).foregroundStyle(.primary).frame(width: 38, height: 44) }
                .tint(.primary).accessibilityLabel("Options for \(source.title)")
                .disabled(!GradeCalculator.isReliable(course.calculationSource) || !course.calculationSource.assignments.contains(where: { $0.id == source.id }))
        }.background(compact ? Color.clear : Palette.row, in: RoundedRectangle(cornerRadius: compact ? 0 : 16))
            .sheet(isPresented: $editing) {
                EditScoreView(assignment: source, value: scenario.scores[source.id] ?? source.score.earned) { value in var h = scenario; h.scores[source.id] = value; store.saveScenario(h, course: course); editing = false }
                    .presentationDetents([.height(280)]).presentationDragIndicator(.visible)
            }
    }
}

struct EditScoreView: View {
    let assignment: SourceAssignment
    let save: (Double) -> Void
    @State private var text: String
    init(assignment: SourceAssignment, value: Double?, save: @escaping (Double) -> Void) { self.assignment = assignment; self.save = save; _text = State(initialValue: value.map(pointsText) ?? "") }
    var number: Double? { guard let n = Double(text.replacingOccurrences(of: ",", with: ".")), n.isFinite, n >= 0 else { return nil }; return n }
    @FocusState private var focused: Bool
    var body: some View {
        VStack(spacing: 26) {
            Text("Edit Assignment Grade").font(.title2.bold())
            HStack(spacing: 12) {
                TextField("Score", text: $text).keyboardType(.decimalPad).focused($focused).font(.largeTitle.weight(.semibold)).multilineTextAlignment(.center).frame(width: 90, height: 64).background(Palette.row, in: RoundedRectangle(cornerRadius: 16)).accessibilityIdentifier("edit-score-field")
                Text("/ " + pointsText(assignment.score.possible)).font(.largeTitle.weight(.medium))
            }
            Button("Save") { if let number { save(number) } }.font(.headline).foregroundStyle(Palette.background).frame(maxWidth: .infinity).padding(.vertical, 18).background(Color.primary, in: RoundedRectangle(cornerRadius: 16)).disabled(number == nil).accessibilityIdentifier("save-score")
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity).background(Palette.background).onAppear { focused = true }
    }
}

struct CourseGradeSummary: View {
    @Environment(AppStore.self) private var store
    let course: Course
    @State private var destination: Destination?
    enum Destination: String, Identifiable { case assignments, whatif, final, sources; var id: String { rawValue } }
    var body: some View {
        let h = store.scenario(course)
        let changed = !h.scores.isEmpty || !h.ignored.isEmpty || !h.added.isEmpty
        let reliable = GradeCalculator.isReliable(course.calculationSource)
        let simulated = changed && reliable ? try? GradeCalculator.hypotheticalPercent(course: course.calculationSource, hypothesis: h) : nil
        let showScenario = changed && reliable && (simulated == nil || abs((simulated ?? 0) - (course.display.grade.percent ?? 0)) >= 0.005)
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 7) { Text("Course Grade").font(.title3.bold()); UpdatedLabel(date: course.updated) }.frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .center, spacing: 5) {
                if showScenario {
                    Text(percentText(simulated)).font(.title2.bold()).foregroundStyle(.blue).monospacedDigit()
                    if let simulated, let original = course.display.grade.percent { Text(String(format: "%+.2f%%", simulated - original)).font(.subheadline.bold()).foregroundStyle(.white).padding(.horizontal, 5).padding(.vertical, 2).background(Palette.grade, in: RoundedRectangle(cornerRadius: 4)) }
                } else { GradeLabel(grade: course.display.grade, large: true) }
            }.accessibilityElement(children: .combine).accessibilityIdentifier("course-grade-value").accessibilityLabel(showScenario ? "What-If grade" : "Course grade")
            Menu {
                Button("View All Assignments", systemImage: "list.bullet") { destination = .assignments }
                Button("What If? Calculator", systemImage: "pencil") { destination = .whatif }
                Button("Final Grade Calculator", systemImage: "equal") { destination = .final }
                Button("Reset All Changes", systemImage: "arrow.uturn.backward") { store.saveScenario(Hypothesis(), course: course) }.disabled(!changed)
                if course.disagrees { Button("Source Grades", systemImage: "rectangle.on.rectangle") { destination = .sources } }
            } label: { Image(systemName: "ellipsis").rotationEffect(.degrees(90)).frame(width: 32, height: 44).foregroundStyle(.primary) }.tint(.primary).accessibilityLabel("Course options")
        }.padding(.leading, 16).padding(.trailing, 6).padding(.vertical, 24).background(Palette.row, in: RoundedRectangle(cornerRadius: 16))
            .navigationDestination(item: $destination) { destination in
                switch destination {
                case .assignments: AssignmentsView(course: course)
                case .whatif: WhatIfView(course: course)
                case .final: FinalCalculatorView(course: course)
                case .sources: SourceGradesView(course: course)
                }
            }
    }
}
