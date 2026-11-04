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
