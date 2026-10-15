import Foundation
public enum Demo {
    public static let now = Date(timeIntervalSince1970: 1_790_719_200)
    /// Offline response shapes observed during the Schoology parser audit, with
    /// entirely synthetic identities, titles and scores.
    public static func schoologyStabilitySources() -> [SourceCourse] {
        func data(_ value: String) -> Data { Data(value.utf8) }
        let sources = try! ProviderParsing.schoology(
            section:data(#"{"id":"fixture-section","course_title":"Synthetic Biology","options":{"weighted_grading_categories":0}}"#),
            grades:data(#"{"section":[{"section_id":"fixture-section","period":[{"period_id":"p1","period_title":"Q1: 2026-08-20 - 2026-10-15","assignment":[{"assignment_id":10,"type":"assignment","grade":8,"max_points":10,"category_id":2,"timestamp":1792095000},{"assignment_id":11,"type":"external_tool","grade":10,"max_points":10,"category_id":2,"timestamp":1792095060},{"assignment_id":12,"type":"assignment","grade":9,"max_points":null,"category_id":2,"timestamp":1792095120}]}],"final_grade":[{"period_id":"p1","grade":90,"scale_id":17}]}]}"#),
            items:data(#"{"assignment":[{"id":10,"grade_item_id":0,"type":"grade_column","title":"Column quiz","grading_period":1,"grading_category":2,"max_points":10},{"id":11,"grade_item_id":501,"type":"external_tool","title":"Tool quiz","grading_period":1,"grading_category":2,"max_points":10},{"id":12,"type":"assignment","title":"Points quiz","grading_period":1,"grading_category":2,"max_points":10}]}"#),
            categories:data(#"{"grading_category":[{"id":2,"title":"Tests"}]}"#),
            fetched:ProviderParsing.date("2026-10-15T20:21:00Z")!)
        let instant=Date()
        return try! ProviderParsing.schoologyOveralls(sources,scales:data(#"{"grading_scale":[{"id":17,"type":1,"hide_numeric":0}]}"#)).map { original in
            var source=original; source.fetched=instant
            for index in source.assignments.indices { source.assignments[index].updated=instant.addingTimeInterval(-Double(index + 1) * 60) }
            return source
        }
    }
    /// Synthetic Schoology period hierarchy for regression/UI verification.
    public static func periodSources(includeExam: Bool = false) -> [SourceCourse] {
        func date(_ value: String) -> Date { ProviderParsing.date(value)! }
        func course(_ provider: ProviderID, period: String, start: String, end: String, grade: Double? = nil, titles: [String] = []) -> SourceCourse {
            let identity = period
            let fields = ["section_id":"fixture-enrollment", "grade_section_id":"fixture-owner", "course_name":"AP Physics 1", "period_start_date_only":"true", "period_end_date_only":"true"]
            let assignments = titles.enumerated().map { index, title in
                SourceAssignment(source: Provenance(provider, identity + ":" + String(index)), title:title, due:date(start).addingTimeInterval(Double(index + 1) * 86400), updated:date(start).addingTimeInterval(Double(index + 1) * 86400), score:Score(earned:grade, possible:100))
            }
            return SourceCourse(source:Provenance(provider,identity,fields:fields), title:"AP Physics 1", teacher:"Taylor", term:Term(id:period,name:period,start:date(start),end:date(end),weight:provider == .schoology ? 33.333 : nil), grade:OverallGrade(percent:grade), assignments:assignments, method:assignments.isEmpty ? .unknown : .points, fetched:now)
        }
        let definitions: [(String,String,String,Double?,[String])] = [
            ("Q1","2026-08-20","2026-10-15",90,["First quarter lab", "First quarter quiz"]),
            ("Q2","2026-10-16","2027-01-04",80,["Second quarter lab", "Second quarter quiz"]),
            ("Q3","2027-01-05","2027-03-12",nil,[]),
            ("Q4","2027-03-13","2027-05-28",nil,[])
        ]
        var sources = definitions.flatMap { period,start,end,grade,titles in
            [course(.schoology,period:period,start:start,end:end,grade:grade,titles:titles)]
        }
        sources += [
            course(.schoology,period:"S1",start:"2026-08-20",end:"2027-01-04",grade:85),
            course(.schoology,period:"Exam S1",start:"2026-12-14",end:"2026-12-18"),
            course(.schoology,period:"S2",start:"2027-01-05",end:"2027-05-28"),
            course(.schoology,period:"Exam S2",start:"2027-05-20",end:"2027-05-24")
        ]
        if includeExam {
            for i in sources.indices where GradingPeriods.descriptor(sources[i]).kind == .exam && GradingPeriods.descriptor(sources[i]).end! < date("2027-01-05") {
                sources[i].assignments = [SourceAssignment(source:Provenance(sources[i].source.provider,"fixture-semester-exam"),title:"Semester exam",due:date("2026-12-16"),updated:date("2026-12-16"),score:Score(earned:80,possible:100))]
                sources[i].grade = OverallGrade(percent:80); sources[i].method = .points
            }
        }
        return sources
    }
    public static func courses(longList: Bool = false) -> [Course] {
        let names = ["AP Physics 1", "AP Computer Science A", "AP Calculus BC", "AP Statistics", "AP Biology", "English Literature and Composition: Seminar"]
        let values = [95.8, 98.6, 87.25, 94.3, 92.4, 93.1]
        var result: [Course] = []
        for (i, name) in names.enumerated() {
            let id = "demo:\(i)", categoryID = id + ":tests"
            let assignments: [SourceAssignment] = (0..<(longList ? 350 : 12)).map { j in
                let title: String
                if j == 0 { title = "2-D Kinematics Quiz" }
                else if j == 1 { title = "1-D Kinematics Quiz" }
                else if j == 2 { title = "Hit or Miss Lab" }
                else { title = ["Practice", "Lab", "Quiz"][j % 3] + " " + String(j + 1) }
                let due = now.addingTimeInterval(Double(-j) * 86400)
                let updated = due.addingTimeInterval(-10800)
                let score = Score(earned: values[i] + [-4.0, 2.0, 2.0][j % 3], possible: 100)
                return SourceAssignment(source: Provenance(.schoology, id + ":assignment:" + String(j)), title: title, categoryID: categoryID, due: due, updated: updated, score: score)
            }
            let source = SourceCourse(source: Provenance(.schoology, id), title: name, teacher: "Taylor", term: Term(id: "fall", name: "Fall 2026"), grade: OverallGrade(percent: values[i], letter: i == 2 ? "B" : "A"), categories: i == 0 ? [GradingCategory(id: categoryID, name: "Total Points")] : [GradingCategory(id: categoryID, name: "Assessments", weight: 70), GradingCategory(id: id + ":practice", name: "Practice", weight: 30)], assignments: assignments, method: i == 0 ? .points : .weightedCategories, fetched: now)
            var course = Reconciler.reconcile([source], now: now)[0]; course.order = i
            course.history = (0..<9).map { j in GradeHistorySnapshot(date: now.addingTimeInterval(Double(j - 8) * 3 * 86400), grade: OverallGrade(percent: values[i] + [1.4, 1, -0.6, 0.8, 0.1, -0.4, -0.2, 0.3, 0][j], letter: i == 2 ? "B" : "A"), provider: .schoology) }
            result.append(course)
        }
        return result
    }
}
