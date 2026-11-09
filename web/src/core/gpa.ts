import { type SourceCourse, normalize } from "./model";
import { boundary, day, descriptor, physicalKey } from "./periods";

export type CourseLevel = "regular" | "honors" | "advanced";
export interface GpaCourseSettings {
  level?: CourseLevel;
  credits?: number;
  excluded?: boolean;
  letter?: GpaLetter;
}
export interface GpaSettings {
  weighting: "equal" | "credits";
  courses: Record<string, GpaCourseSettings>;
}

const scale = [
  ["A", 93, 4],
  ["A-", 90, 3.67],
  ["B+", 87, 3.33],
  ["B", 83, 3],
  ["B-", 80, 2.67],
  ["C+", 77, 2.33],
  ["C", 73, 2],
  ["C-", 70, 1.67],
  ["D+", 67, 1.33],
  ["D", 63, 1],
  ["D-", 60, 0.67],
  ["F", 0, 0],
] as const;
export type GpaLetter = (typeof scale)[number][0] | "E";
export type GpaPolicy = "dublin" | "osu";
const osuScale = [
  ["A", 0, 4],
  ["A-", 0, 3.7],
  ["B+", 0, 3.3],
  ["B", 0, 3],
  ["B-", 0, 2.7],
  ["C+", 0, 2.3],
  ["C", 0, 2],
  ["C-", 0, 1.7],
  ["D+", 0, 1.3],
  ["D", 0, 1],
  ["E", 0, 0],
] as const;
export const osuLetters = osuScale.map(([letter]) => letter);
export const gpaLetters = scale.map(([letter]) => letter);

export function suggestLevel(title: string): CourseLevel {
  const name = normalize(title);
  if (
    /\b(?:ap|advanced placement|ib)\b/.test(
      name.replace(/\bpre[ -]+(?:ap|ib)\b/g, ""),
    )
  )
    return "advanced";
  return /\bhonou?rs\b/.test(name) ? "honors" : "regular";
}

function semesterKey(c: SourceCourse) {
  const { kind, ordinal, start, end } = descriptor(c);
  if (kind !== "semester") return;
  if (c.fields.provider === "carmen")
    return JSON.stringify([
      "carmen",
      c.fields.provider_account,
      c.fields.enrollment_term_id,
    ]);
  return start !== undefined && end !== undefined
    ? JSON.stringify([ordinal, day(start), day(end)])
    : JSON.stringify([ordinal, c.term.id]);
}

// IC and Schoology can expose different first/last instructional days for the same semester.
// Group their semester windows, never their course identities or assignment records.
function campusSemesterMatches(a: SourceCourse, b: SourceCourse) {
  const providers = new Set([
    a.fields.provider ?? "schoology",
    b.fields.provider ?? "schoology",
  ]);
  if (!providers.has("campus") || !providers.has("schoology")) return false;
  const x = descriptor(a),
    y = descriptor(b);
  if (
    x.kind !== "semester" ||
    y.kind !== "semester" ||
    x.ordinal === undefined ||
    x.ordinal !== y.ordinal ||
    x.start === undefined ||
    x.end === undefined ||
    y.start === undefined ||
    y.end === undefined
  )
    return false;
  const duration = Math.max(x.end - x.start, y.end - y.start);
  return (
    duration > 0 &&
    Math.min(x.end, y.end) - Math.max(x.start, y.start) >= duration * 0.75
  );
}
export function gpaSemesters(courses: SourceCourse[], now = Date.now()) {
  const terms = new Map<string, SourceCourse>();
  const ordered = [...courses].sort(
    (a, b) =>
      Number(a.fields.provider === "campus") -
      Number(b.fields.provider === "campus"),
  );
  for (const c of ordered) {
    const id = semesterKey(c);
    if (id !== undefined && (boundary(c, false) ?? -Infinity) <= now) {
      const matches = [...terms.values()].filter((t) =>
        campusSemesterMatches(c, t),
      );
      if (matches.length !== 1) terms.set(id, c);
    }
  }
  return [...terms]
    .map(([id, course]) => ({ id, course }))
    .sort(
      (a, b) =>
        (descriptor(b.course).start ?? -Infinity) -
          (descriptor(a.course).start ?? -Infinity) ||
        (descriptor(b.course).ordinal ?? 0) -
          (descriptor(a.course).ordinal ?? 0) ||
        a.id.localeCompare(b.id),
    );
}

export type GpaSemester = ReturnType<typeof gpaSemesters>[number];

export function estimateGpa(
  courses: SourceCourse[],
  term: GpaSemester,
  settings: GpaSettings,
  projectedGrades: Partial<Record<string, GpaLetter>> = {},
  policy: GpaPolicy = "dublin",
) {
  const gradingScale: ReadonlyArray<readonly [string, number, number]> =
    policy === "osu" ? osuScale : scale;
  const { start, end } = descriptor(term.course);
  const roster = new Map<
    string,
    { source: SourceCourse; semesters: SourceCourse[] }
  >();
  for (const c of courses) {
    const d = descriptor(c),
      isSemester =
        semesterKey(c) === term.id || campusSemesterMatches(c, term.course);
    const isQuarter =
      d.kind === "quarter" &&
      start !== undefined &&
      end !== undefined &&
      d.start !== undefined &&
      d.end !== undefined &&
      day(d.start) >= day(start) &&
      day(d.end) <= day(end);
    if (!isSemester && !isQuarter) continue;
    const id = physicalKey(c);
    const row = roster.get(id) ?? { source: c, semesters: [] };
    if (isSemester) row.semesters.push(c);
    roster.set(id, row);
  }
  let weighted = 0,
    unweighted = 0,
    total = 0,
    incomplete = 0;
  const rows = [...roster]
    .map(([id, { source, semesters }]) => {
      const course = semesters.length === 1 ? semesters[0] : undefined,
        title = course?.title ?? source.title,
        key = JSON.stringify([term.id, id]),
        override = settings.courses[key],
        suggested = suggestLevel(title),
        level = override?.level ?? suggested,
        credits = override?.credits,
        reportedMark = course?.grade.letter
          ?.trim()
          .toUpperCase()
          .replaceAll("−", "-"),
        nonGpa =
          !!reportedMark && /^(S|U|P|PASS|NP|WAIVED)$/.test(reportedMark),
        canProject = !override?.excluded && !nonGpa && semesters.length <= 1,
        projection = canProject ? projectedGrades[key] : undefined,
        mark =
          projection ??
          (policy === "osu" ? override?.letter : undefined) ??
          (policy === "osu" && reportedMark === "EN" ? "E" : reportedMark),
        percent = course?.grade.percent,
        fromPercent =
          policy === "dublin" &&
          percent !== undefined &&
          Number.isFinite(percent)
            ? gradingScale.find(([, cutoff]) => percent >= cutoff)
            : undefined,
        grade = mark
          ? gradingScale.find(([letter]) => letter === mark)
          : fromPercent,
        weight = settings.weighting === "equal" ? 1 : credits;
      let reason: string | undefined;
      if (override?.excluded) reason = "Excluded";
      else if (nonGpa) reason = "Non-GPA grade";
      else if (!course && !projection)
        reason = semesters.length
          ? "Multiple semester grades"
          : "No semester grade";
      else if (!grade)
        reason = mark
          ? "Unsupported grade"
          : policy === "osu"
            ? "Letter grade needed"
            : "No usable grade";
      else if (weight === undefined || !Number.isFinite(weight) || weight <= 0)
        reason = "Credits needed";

      const points = grade?.[2];
      const bonus =
        policy === "dublin" && points !== undefined && points >= 1.67
          ? level === "advanced"
            ? 1
            : level === "honors"
              ? 0.5
              : 0
          : 0;
      if (reason) {
        if (reason !== "Excluded" && reason !== "Non-GPA grade") incomplete++;
      } else {
        weighted += (points! + bonus) * weight!;
        unweighted += points! * weight!;
        total += weight!;
      }
      return {
        key,
        title,
        canProject,
        suggested,
        override,
        reason,
        percent,
        grade: mark ?? grade?.[0],
        inferredGrade: !mark && !!fromPercent,
        conflict:
          !projection &&
          !!mark &&
          !!grade &&
          !!fromPercent &&
          grade !== fromPercent,
        weightedPoints: points === undefined ? undefined : points + bonus,
        points,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  return {
    rows,
    incomplete,
    weighted: total > 0 ? weighted / total : undefined,
    unweighted: total > 0 ? unweighted / total : undefined,
  };
}
