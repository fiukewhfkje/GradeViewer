// Synthetic only; no real student records or district capture.
import type { Row } from "../src/core/parser";
export const campusPortal =
  "https://fixture.infinitecampus.org/campus/portal/students/fixture.jsp";
export const campusSummary = [
  {
    schoolID: 1,
    terms: [
      {
        termID: 5,
        termName: "Semester 1",
        startDate: "2026-08-20",
        endDate: "2026-12-20",
        courses: [
          {
            sectionID: 100,
            _id: "wrong-detail-id",
            courseName: "Synthetic IC-only course",
            teacherDisplay: "Synthetic teacher",
            gradingTasks: [
              {
                taskID: 1,
                taskName: "Semester",
                progressPercent: 90,
                progressScore: "A-",
              },
            ],
          },
        ],
      },
    ],
  },
];
export const campusDetail = {
  details: [
    {
      task: { termID: 5, taskID: 1 },
      categories: [
        {
          categoryID: 3,
          name: "Practice",
          isWeighted: false,
          assignments: [
            {
              objectSectionID: 7,
              assignmentName: "Synthetic work",
              scorePoints: 9,
              totalPoints: 10,
              multiplier: 1,
              dueDate: "2026-10-20",
              scoreModifiedDate: "2026-10-21",
            },
          ],
        },
      ],
    },
  ],
};
export function campusCompositeFixture() {
  const spans = [
    ["2026-08-15", "2026-10-01"],
    ["2026-10-02", "2026-12-18"],
    ["2027-01-07", "2027-03-07"],
    ["2027-03-08", "2027-05-24"],
  ];
  const entries: { task: Row; categories: Row[]; children?: Row[] }[] = [];
  const terms = spans.map(([startDate, endDate], i) => {
    const termID = 501 + i;
    const quarter: Row = {
      taskID: 1,
      taskName: "Quarter",
      termID,
      ...(i < 2
        ? {
            progressPercent: i === 0 ? 82 : 96,
            progressScore: i === 0 ? "B-" : "A",
          }
        : {}),
    };
    const categories =
      i < 2 ? structuredClone(campusDetail.details[0].categories) : [];
    if (i === 0) {
      categories[0].assignments[0].assignmentName = "Earlier synthetic work";
      categories[0].assignments[0].scoreModifiedDate = "2026-09-25";
    }
    entries.push({ task: quarter, categories });
    const gradingTasks: Row[] = [quarter];
    if (i % 2 === 1) {
      const children: Row[] = [
        { termID: termID - 1, taskID: 1, sectionID: 100 },
        { termID, taskID: 1, sectionID: 100 },
      ];
      if (i === 1) {
        const exam = { taskID: 5, taskName: "Exam", termID };
        gradingTasks.push(exam);
        entries.push({ task: exam, categories: [] });
        children.push({ termID, taskID: 5, sectionID: 100 });
      }
      const final: Row = {
        taskID: 4,
        taskName: "Final",
        termID,
        ...(i === 1 ? { progressPercent: 90, progressScore: "A-" } : {}),
      };
      gradingTasks.push(final);
      entries.push({ task: final, categories: [], children });
    }
    return {
      termID,
      termName: `Q${i + 1}`,
      startDate,
      endDate,
      courses: [
        {
          ...structuredClone(campusSummary[0].terms[0].courses[0]),
          gradingTasks,
        },
      ],
    };
  });
  return { summary: [{ schoolID: 1, terms }], detail: { details: entries } };
}
export function campusBackfillFixture(now = Date.parse("2026-11-04")) {
  const fixture = campusCompositeFixture();
  const offset =
    Math.floor((now - Date.parse("2026-11-04")) / 86400000) * 86400000;
  const on = (date: string) =>
    new Date(Date.parse(date) + offset).toISOString().slice(0, 10);
  for (const term of fixture.summary[0].terms) {
    term.startDate = on(term.startDate);
    term.endDate = on(term.endDate);
  }
  for (let i = 0; i < 2; i++) {
    const entry = fixture.detail.details.find(
      (entry) => entry.task.termID === 501 + i && entry.task.taskID === 1,
    )!;
    entry.task = { ...entry.task, groupWeighted: true, usePercent: false };
    // Portal task-level options govern these categories; the category itself
    // need not repeat isWeighted/usePercent.
    const practice: Row = entry.categories[0];
    delete practice.isWeighted;
    practice.weight = 0.4;
    practice.assignments = [
      {
        ...campusDetail.details[0].categories[0].assignments[0],
        assignmentName: i === 0 ? "Earlier synthetic work" : "Synthetic work",
        scorePoints: i === 0 ? 10 : 9,
        scoreModifiedDate: on(i === 0 ? "2026-09-25" : "2026-10-20"),
        dueDate: on(i === 0 ? "2026-09-25" : "2026-10-20"),
      },
    ];
    entry.categories.push({
      categoryID: 4,
      name: "Assessments",
      weight: 0.6,
      assignments: (i === 0 ? [10, 18] : [10]).map((scorePoints, j) => ({
        objectSectionID: 20 + j,
        assignmentName: `Synthetic assessment ${j + 1}`,
        scorePoints,
        totalPoints: i === 0 ? 20 : 10,
        multiplier: 1,
        dueDate: on(i === 0 ? `2026-09-${10 + j * 10}` : "2026-10-05"),
        scoreModifiedDate: on(
          i === 0 ? `2026-09-${10 + j * 10}` : "2026-10-05",
        ),
      })),
    });
  }
  const final = fixture.detail.details.find(
    (entry) => entry.task.termID === 502 && entry.task.taskID === 4,
  )!;
  for (const [i, child] of final.children!.entries())
    child.calculationWeight = [3, 4, 1][i];
  return fixture;
}
export const campusState = {
  cookies: [
    {
      name: "JSESSIONID",
      value: "synthetic-session",
      domain: "fixture.infinitecampus.org",
      path: "/campus",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
  ],
  origins: [],
};
