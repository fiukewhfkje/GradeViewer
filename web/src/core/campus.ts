import type { Assignment, Category, SourceCourse } from "./model";
import {
  collection,
  object,
  nonempty,
  number,
  flag,
  date,
  ProviderError,
  type Row,
} from "./parser";

const bad = (): never => {
  throw new ProviderError("malformedCampus");
};
const id = (v: unknown) => {
  const s = nonempty(v);
  if (!s || !/^[\w-]{1,100}$/.test(s)) return bad();
  return s;
};
const list = (v: unknown): Row[] => {
  if (!Array.isArray(v)) return bad();
  return collection(v);
};
export interface CampusChoice {
  id: string;
  section: string;
  title: string;
  teacher: string;
}
export function campusRows(summary: unknown) {
  const rows: { school: Row; term: Row; course: Row; task: Row }[] = [];
  for (const school of list(summary)) {
    id(school.schoolID);
    for (const term of list(school.terms)) {
      id(term.termID ?? term._id);
      for (const course of list(term.courses)) {
        id(course.sectionID);
        if (!nonempty(course.courseName)) return bad();
        for (const task of list(course.gradingTasks)) {
          id(task.taskID ?? task.gradingTaskID ?? task._id);
          rows.push({ school, term, course, task });
          if (rows.length > 2000) return bad();
        }
      }
    }
  }
  return rows;
}
export function campusChoices(summary: unknown): CampusChoice[] {
  const choices = new Map<string, CampusChoice>();
  for (const { school, course } of campusRows(summary)) {
    const key = id(school.schoolID) + ":" + id(course.sectionID);
    const choice = {
      id: key,
      section: id(course.sectionID),
      title: String(course.courseName),
      teacher: nonempty(course.teacherDisplay) ?? "",
    };
    const old = choices.get(key);
    if (old && (old.title !== choice.title || old.teacher !== choice.teacher))
      return bad();
    choices.set(key, choice);
  }
  if (choices.size > 100) return bad();
  return [...choices.values()];
}
// A portal roster must establish the student, never a teacher nested in a course.
export function campusStudent(roster: unknown): string {
  const rows = Array.isArray(roster) ? list(roster) : [object(roster)];
  const identities = rows.map((r) =>
    nonempty(
      r.personID ?? r.studentID ?? (r.student && object(r.student).personID),
    ),
  );
  if (
    !identities.length ||
    identities.some((x) => !x) ||
    new Set(identities).size !== 1
  )
    throw new ProviderError("campusIdentityUnsupported");
  return id(identities[0]);
}
export function parseCampus(
  summary: unknown,
  details: Record<string, unknown>,
  selected: string[],
  account: string,
  fetched = Date.now(),
): SourceCourse[] {
  const choices = campusChoices(summary),
    allowed = new Set(choices.map((c) => c.id));
  if (selected.length > 32 || new Set(selected).size !== selected.length)
    return bad();
  const output: SourceCourse[] = [];
  for (const { school, term, course, task } of campusRows(summary)) {
    const physical = id(school.schoolID) + ":" + id(course.sectionID);
    if (!selected.includes(physical) || !allowed.has(physical)) continue;
    const tid = id(term.termID ?? term._id),
      taskID = id(task.taskID ?? task.gradingTaskID ?? task._id);
    const namespace =
      "campus:" + account + ":" + physical + ":" + tid + ":" + taskID;
    const detail = object(details[id(course.sectionID)]),
      entries = list(detail.details);
    const categories: Category[] = [],
      assignments: Assignment[] = [];
    const weighted: boolean[] = [];
    let unknownRules = false;
    for (const entry of entries) {
      const scope = object(entry.task);
      if (
        id(scope.termID) !== tid ||
        id(scope.taskID ?? scope.gradingTaskID) !== taskID
      )
        continue;
      for (const cat of list(entry.categories)) {
        const cid =
          namespace +
          ":category:" +
          id(cat.categoryID ?? cat.groupID ?? cat._id);
        if (!nonempty(cat.name) || categories.some((c) => c.id === cid))
          return bad();
        if (cat.isWeighted === undefined) unknownRules = true;
        else weighted.push(flag(cat.isWeighted));
        const drop = number(cat.dropLowest ?? cat.dropLowestScore) ?? 0;
        if (!Number.isSafeInteger(drop) || drop < 0) return bad();
        const percent = flag(cat.useScorePercent ?? cat.usePercent);
        if (
          cat.calculationType !== undefined &&
          !["points", "percent"].includes(String(cat.calculationType))
        )
          unknownRules = true;
        categories.push({
          id: cid,
          name: String(cat.name),
          weight: number(cat.weight),
          method:
            percent || cat.calculationType === "percent" ? "percent" : "points",
          dropLowest: drop,
          excluded: flag(cat.isExcluded),
        });
        for (const a of list(cat.assignments)) {
          const aid =
            namespace +
            ":assignment:" +
            id(a.objectSectionID ?? a.assignmentID ?? a._id);
          if (assignments.some((x) => x.id === aid)) return bad();
          const earned = number(a.scorePoints),
            possible = number(a.totalPoints),
            multiplier = number(a.multiplier) ?? 1;
          if (possible !== undefined && possible < 0) return bad();
          if (multiplier <= 0) unknownRules = true;
          assignments.push({
            id: aid,
            title: nonempty(a.assignmentName) ?? "Untitled assignment",
            categoryID: cid,
            due: date(a.dueDate),
            updated: date(a.scoreModifiedDate ?? a.modifiedDate ?? a.scoreDate),
            score: {
              earned,
              possible,
              letter:
                nonempty(a.score) && number(a.score) === undefined
                  ? nonempty(a.score)
                  : undefined,
              excused: flag(a.exempt ?? a.excused),
            },
            multiplier,
            excluded: flag(a.excluded) || flag(a.dropped),
            fields: {
              provider: "campus",
              assignment_id: id(a.objectSectionID ?? a.assignmentID ?? a._id),
              missing: String(flag(a.missing)),
              late: String(flag(a.late)),
            },
          });
        }
      }
    }
    if (task.isComposite || task.isRollup || task.cumulativeGrading)
      unknownRules = true;
    const progress =
      number(task.progressPercent) !== undefined ||
      nonempty(task.progressScore) !== undefined;
    const taskName = nonempty(task.taskName ?? task.name) ?? "";
    const termName = nonempty(term.termName) ?? tid;
    const kind = /exam|midterm/i.test(taskName)
      ? "exam"
      : /semester|^final$/i.test(taskName)
        ? "semester"
        : undefined;
    const ownStart = date(task.startDate),
      ownEnd = date(task.endDate);
    const start =
      ownStart ??
      (kind === "semester" && !/^s(?:emester)?\s*\d/i.test(termName)
        ? undefined
        : date(term.startDate));
    const end = ownEnd ?? date(term.endDate);
    output.push({
      id: namespace,
      title: String(course.courseName),
      teacher: nonempty(course.teacherDisplay) ?? "",
      term: {
        id: tid + ":" + taskID,
        name:
          kind === "exam"
            ? "Exam"
            : kind === "semester" && !/^s(?:emester)?\s*\d/i.test(termName)
              ? taskName
              : termName,
        start,
        end,
        weight: number(task.weight),
      },
      grade: {
        percent: number(progress ? task.progressPercent : task.percent),
        letter: nonempty(progress ? task.progressScore : task.score),
      },
      categories,
      assignments,
      method:
        unknownRules || !categories.length || new Set(weighted).size !== 1
          ? "unknown"
          : weighted[0]
            ? "weightedCategories"
            : categories.every((c) => c.method === "percent")
              ? "percent"
              : categories.some((c) => c.method === "percent")
                ? "unknown"
                : "points",
      fetched,
      fields: {
        provider: "campus",
        provider_account: account,
        physical_key: "campus:" + account + ":" + physical,
        section_id: id(course.sectionID),
        course_name: String(course.courseName),
        task_name: taskName,
        grade_basis: progress ? "reportedInProgress" : "reportedPosted",
        period_start_date_only: String(
          !!start &&
            /^\d{4}-\d{2}-\d{2}$/.test(
              String(task.startDate ?? term.startDate),
            ),
        ),
        period_end_date_only: String(
          !!end &&
            /^\d{4}-\d{2}-\d{2}$/.test(String(task.endDate ?? term.endDate)),
        ),
        ...(kind ? { period_kind: kind } : {}),
      },
    });
  }
  return output;
}
