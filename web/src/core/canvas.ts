import type { Assignment, Category, SourceCourse } from "./model";
import {
  date,
  nonempty,
  number,
  object,
  ProviderError,
  type Row,
} from "./parser";

const bad = (): never => {
  throw new ProviderError("malformedCanvas");
};
export const canvasID = (v: unknown): string => {
  if (
    (typeof v !== "number" && typeof v !== "string") ||
    !/^[1-9]\d{0,19}$/.test(String(v))
  )
    return bad();
  if (typeof v === "number" && !Number.isSafeInteger(v)) return bad();
  return String(v);
};
const list = (v: unknown): Row[] => {
  if (
    !Array.isArray(v) ||
    v.some((x) => !x || typeof x !== "object" || Array.isArray(x))
  )
    return bad();
  return v;
};
const numeric = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  const n = number(v);
  if (n === undefined) return bad();
  return n;
};
export const canvasStudent = (v: unknown) => canvasID(object(v).id);
export function canvasChoices(summary: unknown) {
  const seen = new Set<string>();
  return list(summary).map((c) => {
    const id = canvasID(c.id);
    if (seen.has(id) || !nonempty(c.name) || !Array.isArray(c.enrollments))
      return bad();
    seen.add(id);
    // The endpoint is restricted to student enrollments. Never silently accept a teacher roster.
    if (
      !list(c.enrollments).some((e) =>
        ["student", "StudentEnrollment"].includes(String(e.type)),
      )
    )
      return bad();
    return {
      id,
      section: id,
      title: String(c.name),
      teacher: Array.isArray(c.teachers)
        ? list(c.teachers)
            .map((t) => nonempty(t.display_name))
            .filter(Boolean)
            .join(", ")
        : "",
    };
  });
}
export function parseCanvas(
  summary: unknown,
  details: Record<string, unknown>,
  account: string,
  subject: string,
  fetched = Date.now(),
): SourceCourse[] {
  canvasChoices(summary);
  return list(summary).map((c) => {
    const cid = canvasID(c.id),
      ns = `carmen:${account}:${cid}`;
    const enrollments = list(details[cid + ":enrollments"]);
    const own = enrollments.filter(
      (e) =>
        canvasID(e.user_id) === subject &&
        e.type === "StudentEnrollment" &&
        !["deleted", "rejected", "inactive"].includes(
          String(e.enrollment_state),
        ),
    );
    if (
      !own.length ||
      own.some(
        (e) => e.course_id !== undefined && canvasID(e.course_id) !== cid,
      )
    )
      return bad();
    // Multiple section enrollments are documented. Only identical course totals may share one presentation.
    const gradeKey = (e: Row) =>
      JSON.stringify([
        e.grades,
        e.override_score,
        e.override_grade,
        e.enrollment_state,
      ]);
    if (new Set(own.map(gradeKey)).size !== 1) return bad();
    const enrollment = own[0],
      grades = object(enrollment.grades);
    const concluded =
      enrollment.enrollment_state === "completed" ||
      c.workflow_state === "completed";
    const overridden =
      numeric(enrollment.override_score) !== undefined ||
      nonempty(enrollment.override_grade) !== undefined;
    const percent = numeric(
      overridden
        ? enrollment.override_score
        : concluded
          ? grades.final_score
          : grades.current_score,
    );
    const letter = nonempty(
      overridden
        ? enrollment.override_grade
        : concluded
          ? grades.final_grade
          : grades.current_grade,
    );
    const categories: Category[] = [],
      assignments: Assignment[] = [];
    let unknown =
      c.apply_assignment_group_weights !== true &&
      c.apply_assignment_group_weights !== false;
    // Canvas drop rules rank by effect on the total, unlike Schoology's percent ordering.
    // Period weighting, overrides and custom grading cannot safely use that calculator.
    unknown ||=
      enrollment.has_grading_periods === true ||
      list(c.enrollments).some((e) => e.has_grading_periods === true) ||
      (Array.isArray(c.grading_periods) && c.grading_periods.length > 0) ||
      overridden;
    for (const g of list(details[cid + ":groups"])) {
      const gid = canvasID(g.id),
        groupID = ns + ":group:" + gid,
        rules = object(g.rules ?? {});
      if (categories.some((k) => k.id === groupID) || !nonempty(g.name))
        return bad();
      unknown ||=
        (numeric(rules.drop_lowest) ?? 0) !== 0 ||
        (numeric(rules.drop_highest) ?? 0) !== 0 ||
        (Array.isArray(rules.never_drop) && rules.never_drop.length > 0);
      const weight = numeric(g.group_weight);
      if (weight !== undefined && weight < 0) return bad();
      categories.push({
        id: groupID,
        name: String(g.name),
        weight,
        method: "points",
        dropLowest: 0,
        excluded: false,
      });
      for (const a of list(g.assignments)) {
        const aid = canvasID(a.id),
          id = ns + ":assignment:" + aid;
        if (
          assignments.some((x) => x.id === id) ||
          canvasID(a.assignment_group_id) !== gid ||
          !nonempty(a.name)
        )
          return bad();
        const s = a.submission == null ? {} : object(a.submission);
        if (s.user_id !== undefined && canvasID(s.user_id) !== subject)
          return bad();
        const possible = numeric(a.points_possible);
        if (possible !== undefined && possible < 0) return bad();
        if (s.assignment_id !== undefined && canvasID(s.assignment_id) !== aid)
          return bad();
        const hidden = s.posted_at === null;
        const earned = hidden ? undefined : numeric(s.score);
        unknown ||= ![
          "points",
          "percent",
          "letter_grade",
          "pass_fail",
          "not_graded",
          "gpa_scale",
        ].includes(String(a.grading_type));
        assignments.push({
          id,
          title: String(a.name),
          categoryID: groupID,
          due: date(a.due_at),
          updated: hidden ? undefined : date(s.graded_at),
          score: { earned, possible, excused: s.excused === true },
          multiplier: 1,
          excluded:
            a.omit_from_final_grade === true ||
            a.published === false ||
            a.grading_type === "not_graded",
          fields: {
            provider: "carmen",
            assignment_id: aid,
            missing: String(s.missing === true),
            late: String(s.late === true),
          },
        });
      }
    }
    if (
      c.apply_assignment_group_weights === true &&
      Math.abs(categories.reduce((sum, g) => sum + (g.weight ?? 0), 0) - 100) >
        0.0001
    )
      unknown = true;
    const term = object(c.term ?? {}),
      termID = term.id == null ? "unknown" : canvasID(term.id),
      name = nonempty(term.name) ?? "Unknown term";
    const academic =
      termID !== "unknown" &&
      /autumn|fall|spring|summer|winter|semester/i.test(name);
    return {
      id: ns,
      title: String(c.name),
      teacher: canvasChoices([c])[0].teacher,
      term: {
        id: termID,
        name,
        start: date(term.start_at),
        end: date(term.end_at),
      },
      grade: { percent, letter },
      categories,
      assignments,
      method: unknown
        ? "unknown"
        : c.apply_assignment_group_weights
          ? "weightedCategories"
          : "points",
      fetched,
      fields: {
        provider: "carmen",
        provider_account: account,
        physical_key: ns,
        canvas_course_id: cid,
        enrollment_term_id: termID,
        grade_basis: overridden
          ? "reportedOverride"
          : concluded
            ? "reportedFinal"
            : "reportedCurrent",
        ...(academic ? { period_kind: "semester" } : {}),
      },
    };
  });
}
