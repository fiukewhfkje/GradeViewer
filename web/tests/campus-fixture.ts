// Synthetic only; no real student records or district capture.
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
