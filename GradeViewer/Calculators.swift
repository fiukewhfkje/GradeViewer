import SwiftUI
import GradeCore

struct AddGradeView: View {
    let course: Course
    let add: (SourceAssignment) -> Void
    @State private var title = ""
    @State private var earned = ""
    @State private var possible = "100"
    @State private var category = ""
    var valid: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && ScoreInput.number(earned) != nil && ScoreInput.number(possible).map { $0 > 0 } == true && (course.calculationSource.method == .points || !category.isEmpty) }
    var body: some View {
        Form {
            TextField("Name", text: $title).accessibilityIdentifier("add-grade-name")
            HStack { Text("Score"); Spacer(); TextField("Score", text: $earned).keyboardType(.decimalPad).multilineTextAlignment(.trailing).accessibilityIdentifier("add-grade-score") }
            HStack { Text("Total Points"); Spacer(); TextField("Total Points", text: $possible).keyboardType(.decimalPad).multilineTextAlignment(.trailing).accessibilityIdentifier("add-grade-total") }
            if course.calculationSource.method != .points && course.calculationSource.categories.filter({ !$0.excluded }).count > 1 { Picker("Category", selection: $category) { ForEach(course.calculationSource.categories.filter { !$0.excluded }) { Text($0.name).tag($0.id) } } }
            Button("Add") {
                guard valid, let e = ScoreInput.number(earned), let p = ScoreInput.number(possible) else { return }
                add(SourceAssignment(source: Provenance(course.calculationSource.source.provider, "hypothetical:\(UUID().uuidString)"), title: title.trimmingCharacters(in: .whitespacesAndNewlines), categoryID: category.isEmpty ? nil : category, score: Score(earned: e, possible: p)))
            }.disabled(!valid).accessibilityIdentifier("add-grade-save")
        }.navigationTitle("Add Grade").navigationBarTitleDisplayMode(.inline)
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

/// The same local scenario is used by overview and assignment lists.
struct InteractiveAssignmentRow: View {
    @Environment(AppStore.self) private var store
    let assignment: Assignment
    let course: Course
    var compact = false
    @State private var editing = false
    var source: SourceAssignment { assignment.sources.first { $0.source.provider == course.calculationSource.source.provider } ?? assignment.display }
    var scenario: Hypothesis { store.scenario(course) }
    var added: Bool { scenario.added.contains { $0.id == source.id } }
    var dropped: Bool { scenario.ignored.contains(source.id) }
    var changed: Bool { added || scenario.scores[source.id] != nil || dropped }
    var simulated: Assignment {
        // Keep the reconciled title and newest timestamp when applying a local
        // score override. The calculator identity still comes from its own source.
        var a = assignment.display
        if let earned = scenario.scores[source.id] { a.score.earned = earned }
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
                if added {
                    Button("Remove Grade", systemImage: "trash", role: .destructive) {
                        var h = scenario; h.added.removeAll { $0.id == source.id }; h.scores[source.id] = nil; h.ignored.remove(source.id)
                        store.saveScenario(h, course: course)
                    }
                } else {
                    Button("Reset Assignment", systemImage: "arrow.uturn.backward") { var h = scenario; h.scores[source.id] = nil; h.ignored.remove(source.id); store.saveScenario(h, course: course) }.disabled(!changed)
                }
            } label: { Image(systemName: "ellipsis").rotationEffect(.degrees(90)).foregroundStyle(.primary).frame(width: 38, height: 44) }
                .tint(.primary).accessibilityLabel("Options for \(assignment.display.title)")
                .disabled(!GradeCalculator.isReliable(course.calculationSource) || !(added || course.calculationSource.assignments.contains(where: { $0.id == source.id })))
        }.background(compact ? Color.clear : Palette.row, in: RoundedRectangle(cornerRadius: compact ? 0 : 16))
            .sheet(isPresented: $editing) {
                EditScoreView(assignment: source, value: scenario.scores[source.id] ?? source.score.earned) { value in var h = scenario; h.scores[source.id] = value; store.saveScenario(h, course: course); editing = false }.freshGradeGate(dismissible:true)
                    .presentationDetents([.height(280)]).presentationDragIndicator(.visible)
            }
    }
}

struct EditScoreView: View {
    let assignment: SourceAssignment
    let save: (Double) -> Void
    @State private var text: String
    init(assignment: SourceAssignment, value: Double?, save: @escaping (Double) -> Void) { self.assignment = assignment; self.save = save; _text = State(initialValue: ScoreInput.text(value)) }
    var number: Double? { ScoreInput.number(text) }
    @FocusState private var focused: Bool
    var body: some View {
        VStack(spacing: 26) {
            Text("Edit Assignment Grade").font(.title2.bold())
            HStack(spacing: 12) {
                TextField("Score", text: $text).keyboardType(.decimalPad).focused($focused).font(.largeTitle.weight(.semibold)).multilineTextAlignment(.center).frame(width: 120, height: 64).background(Palette.row, in: RoundedRectangle(cornerRadius: 16)).accessibilityIdentifier("edit-score-field")
                Text("/ " + pointsText(assignment.score.possible)).font(.largeTitle.weight(.medium))
            }
            Button { if let number { save(number) } } label: {
                Text("Save").font(.headline).foregroundStyle(Palette.background).frame(maxWidth: .infinity).padding(.vertical, 18).background(Color(uiColor: .label), in: RoundedRectangle(cornerRadius: 16))
            }.buttonStyle(.plain).disabled(number == nil).opacity(number == nil ? 0.35 : 1).accessibilityIdentifier("save-score")
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity).background(Palette.background).onAppear { focused = true }
    }
}

struct CourseGradeSummary: View {
    @Environment(AppStore.self) private var store
    let course: Course
    var overall: Course? = nil
    @State private var destination: Destination?
    @State private var adding = false
    enum Destination: String, Identifiable { case assignments, final, sources; var id: String { rawValue } }
    var body: some View {
        let h = store.scenario(course)
        let changed = !h.scores.isEmpty || !h.ignored.isEmpty || !h.added.isEmpty
        let reliable = GradeCalculator.isReliable(course.calculationSource)
        let gradeCourse = overall ?? course
        let original = gradeCourse.display.grade.percent
        let scale = overall.flatMap { $0.id == course.id ? 1 : GradingPeriods.semesterScale(for: course, semester: $0, among: store.courses) } ?? (overall == nil ? 1 : nil)
        let quarterResult = changed && reliable ? try? GradeCalculator.hypotheticalPercent(course: course.calculationSource, hypothesis: h) : nil
        let simulated = quarterResult.flatMap { value in
            scale.flatMap { weight in original.flatMap { grade in course.display.grade.percent.map { grade + (value - $0) * weight } } }
        }
        let showScenario = changed && reliable && scale != nil && (simulated == nil || abs((simulated ?? 0) - (original ?? 0)) >= 0.005)
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 7) {
                Text("Course Grade").font(.title3.bold())
                if let overall { Text(GradingPeriods.descriptor(overall).label + " overall").font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                UpdatedLabel(date: store.updated(course))
            }.frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .center, spacing: 5) {
                if showScenario {
                    Text(percentText(simulated)).font(.title2.bold()).foregroundStyle(.blue).monospacedDigit()
                    if let simulated, let original { Text(String(format: "%+.2f%%", simulated - original)).font(.subheadline.bold()).foregroundStyle(.white).padding(.horizontal, 5).padding(.vertical, 2).background(Palette.grade, in: RoundedRectangle(cornerRadius: 4)) }
                } else { GradeLabel(grade: gradeCourse.display.grade, large: true) }
            }.accessibilityElement(children: .combine).accessibilityIdentifier("course-grade-value").accessibilityLabel(showScenario ? "What-If grade" : "Course grade").accessibilityValue(showScenario ? percentText(simulated) : percentText(gradeCourse.display.grade.percent))
            Menu {
                Button("View All Assignments", systemImage: "list.bullet") { destination = .assignments }
                Button("Add Grade", systemImage: "plus") { adding = true }.disabled(!reliable)
                Button("Final Grade Calculator", systemImage: "equal") { destination = .final }
                Button("Reset All Changes", systemImage: "arrow.uturn.backward") { store.saveScenario(Hypothesis(), course: course) }.disabled(!changed)
                if course.disagrees { Button("Source Grades", systemImage: "rectangle.on.rectangle") { destination = .sources } }
            } label: { Image(systemName: "ellipsis").rotationEffect(.degrees(90)).frame(width: 32, height: 44).foregroundStyle(.primary) }.tint(.primary).accessibilityLabel("Course options")
        }.padding(.leading, 16).padding(.trailing, 6).padding(.vertical, 24).background(Palette.row, in: RoundedRectangle(cornerRadius: 16))
            .sheet(isPresented: $adding) {
                NavigationStack {
                    AddGradeView(course: course) { assignment in
                        var h = store.scenario(course); h.added.append(assignment)
                        store.saveScenario(h, course: course); adding = false
                    }.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { adding = false } } }
                }.freshGradeGate(dismissible: true)
                    .presentationDetents([.height(course.calculationSource.method == .points ? 360 : 420)]).presentationDragIndicator(.visible)
            }
            .navigationDestination(item: $destination) { destination in
                switch destination {
                case .assignments: AssignmentsView(course: course, scoped: overall != nil || GradingPeriods.descriptor(course).kind != .other)
                case .final: FinalCalculatorView(course: gradeCourse)
                case .sources: SourceGradesView(course: gradeCourse)
                }
            }
    }
}
