import type { BrowserState } from "../worker/portal-browser";
export const canvasCourses = [
  {
    id: 101,
    name: "Synthetic Carmen Calculus",
    apply_assignment_group_weights: true,
    term: {
      id: 5,
      name: "Autumn 2026",
      start_at: "2026-08-25T00:00:00Z",
      end_at: "2026-12-19T00:00:00Z",
    },
    teachers: [{ display_name: "Synthetic Instructor" }],
    enrollments: [{ type: "student", user_id: 77 }],
  },
];
export const canvasGroups = [
  {
    id: 11,
    name: "Homework",
    group_weight: 40,
    rules: {},
    assignments: [
      {
        id: 201,
        name: "Synthetic Carmen homework",
        assignment_group_id: 11,
        grading_type: "points",
        points_possible: 10,
        published: true,
        due_at: "2026-11-01T00:00:00Z",
        submission: {
          user_id: 77,
          score: 8,
          grade: "8",
          graded_at: "2026-11-02T12:00:00Z",
          posted_at: "2026-11-02T12:00:00Z",
          excused: false,
          late: true,
          points_deducted: 1,
        },
      },
    ],
  },
  {
    id: 12,
    name: "Exams",
    group_weight: 60,
    rules: {},
    assignments: [
      {
        id: 202,
        name: "Synthetic Carmen exam",
        assignment_group_id: 12,
        grading_type: "points",
        points_possible: 100,
        published: true,
        submission: {
          user_id: 77,
          score: 90,
          grade: "90",
          graded_at: "2026-11-02T12:00:00Z",
          posted_at: "2026-11-02T12:00:00Z",
          excused: false,
        },
      },
    ],
  },
];
export const canvasEnrollments = [
  {
    id: 66,
    user_id: 77,
    type: "StudentEnrollment",
    enrollment_state: "active",
    has_grading_periods: false,
    grades: {
      current_score: 86,
      current_grade: "B",
      final_score: 35,
      final_grade: "E",
      unposted_current_score: 100,
    },
  },
];
export const canvasDetails = () => ({
  "101:groups": structuredClone(canvasGroups),
  "101:enrollments": structuredClone(canvasEnrollments),
});
export const canvasState: BrowserState = {
  cookies: [
    {
      name: "_csrf_token",
      value: "synthetic%2Fcsrf%2Btoken%3D",
      domain: "osu.instructure.com",
      path: "/",
      expires: -1,
      secure: true,
      httpOnly: false,
      sameSite: "Lax",
    },
    {
      name: "_normandy_session",
      value: "synthetic-canvas-session",
      domain: "osu.instructure.com",
      path: "/",
      expires: -1,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "idp",
      value: "synthetic-idp-session",
      domain: "webauth.service.ohio-state.edu",
      path: "/",
      expires: -1,
      secure: true,
      httpOnly: true,
      sameSite: "None",
    },
  ],
  origins: [],
};
