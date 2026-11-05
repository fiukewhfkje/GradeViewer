import type { Assignment, Category, SourceCourse } from "./model";
import { semester } from "./periods";
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
// Calculation flags may be exposed by the task rather than repeated on every
// category. Conflicting or unrecognized declarations do not establish a rule.
function ruleFlag(values: unknown[]) {
  const declared = values.filter((v) => v !== undefined && v !== null);
  if (!declared.length) return;
  if (declared.some((v) => !/^(?:true|false|0|1)$/i.test(String(v)))) return;
  const flags = declared.map(flag);
  return new Set(flags).size === 1 ? flags[0] : undefined;
}
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
// IC can attach a semester Final to its last quarter. The detail's explicit
// child links establish its span; the containing Q2/Q4 alone does not.
function compositeSemester(
  parent: ReturnType<typeof campusRows>[number],
  entries: Row[],
  rows: ReturnType<typeof campusRows>,
) {
  const matches = entries.filter((entry) => {
    const task = object(entry.task);
    return (
      nonempty(task.termID) ===
        nonempty(parent.term.termID ?? parent.term._id) &&
      nonempty(task.taskID ?? task.gradingTaskID) ===
        nonempty(
          parent.task.taskID ?? parent.task.gradingTaskID ?? parent.task._id,
        )
    );
  });
  if (matches.length !== 1 || !Array.isArray(matches[0].children)) return;
  const children = collection(matches[0].children);
  if (children.length < 2 || children.length > 6) return;
  const seen = new Set<string>();
  const spans: { start: number; end: number }[] = [];
  const components: { term: string; task: string; weight?: number }[] = [];
  const quarters: {
    ordinal: number;
    start: number;
    end: number;
    term: string;
    startDateOnly: boolean;
    endDateOnly: boolean;
  }[] = [];
  for (const child of children) {
    if (
      child.sectionID !== undefined &&
      nonempty(child.sectionID) !== nonempty(parent.course.sectionID)
    )
      return;
    const termID = nonempty(child.termID),
      taskID = nonempty(child.taskID ?? child.gradingTaskID);
    const key = termID + ":" + taskID;
    if (!termID || !taskID || seen.has(key)) return;
    seen.add(key);
    const targets = rows.filter(
      (r) =>
        nonempty(r.school.schoolID) === nonempty(parent.school.schoolID) &&
        nonempty(r.course.sectionID) === nonempty(parent.course.sectionID) &&
        nonempty(r.term.termID ?? r.term._id) === termID &&
        nonempty(r.task.taskID ?? r.task.gradingTaskID ?? r.task._id) ===
          taskID,
    );
    if (targets.length !== 1) return;
    components.push({
      term: termID,
      task: taskID,
      weight: number(child.calculationWeight),
    });
    const target = targets[0];
    const start = date(target.term.startDate),
      end = date(target.term.endDate);
    if (start === undefined || end === undefined || start > end) return;
    spans.push({ start, end });
    const name = nonempty(target.task.taskName ?? target.task.name) ?? "";
    if (/exam|midterm/i.test(name)) continue;
    const q = nonempty(target.term.termName)?.match(
      /^(?:q|quarter)\s*([1-4])$/i,
    );
    if (!q || !/^(?:quarter(?:\s*[1-4])?|q[1-4])$/i.test(name)) return;
    quarters.push({
      ordinal: Number(q[1]),
      start,
      end,
      term: termID,
      startDateOnly: /^\d{4}-\d{2}-\d{2}$/.test(String(target.term.startDate)),
      endDateOnly: /^\d{4}-\d{2}-\d{2}$/.test(String(target.term.endDate)),
    });
  }
  quarters.sort((a, b) => a.ordinal - b.ordinal);
  if (quarters.length !== 2) return;
  const [first, last] = quarters;
  if (
    first.ordinal % 2 !== 1 ||
    last.ordinal !== first.ordinal + 1 ||
    first.end >= last.start ||
    last.term !== nonempty(parent.term.termID ?? parent.term._id) ||
    spans.some((span) => span.start < first.start || span.end > last.end)
  )
    return;
  return {
    name: `Semester ${last.ordinal / 2}`,
    start: first.start,
    end: last.end,
    startDateOnly: first.startDateOnly,
    endDateOnly: last.endDateOnly,
    components,
  };
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
  const output: SourceCourse[] = [],
    rows = campusRows(summary);
  const composites = new Map<
    string,
    NonNullable<ReturnType<typeof compositeSemester>>
  >();
  for (const row of rows) {
    const { school, term, course, task } = row;
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
    const unsupported = (rules: Row) =>
      [
        rules.isComposite,
        rules.hasCompositeTasks,
        rules.isRollup,
        rules.cumulativeGrading,
      ].some(flag) || (number(rules.maxAssignments) ?? 0) > 0;
    let unknownRules = unsupported(task);
    for (const entry of entries) {
      const scope = object(entry.task);
      if (
        id(scope.termID) !== tid ||
        id(scope.taskID ?? scope.gradingTaskID) !== taskID
      )
        continue;
      if (unsupported(scope)) unknownRules = true;
      for (const cat of list(entry.categories)) {
        const cid =
          namespace +
          ":category:" +
          id(cat.categoryID ?? cat.groupID ?? cat._id);
        if (!nonempty(cat.name) || categories.some((c) => c.id === cid))
          return bad();
        const categoryWeighted = ruleFlag([
          cat.isWeighted,
          task.groupWeighted,
          scope.groupWeighted,
        ]);
        if (categoryWeighted === undefined) unknownRules = true;
        else weighted.push(categoryWeighted);
        const drop = number(cat.dropLowest ?? cat.dropLowestScore) ?? 0;
        if (!Number.isSafeInteger(drop) || drop < 0) return bad();
        const percentDeclarations = [
          cat.useScorePercent,
          cat.usePercent,
          task.usePercent,
          scope.usePercent,
        ];
        const percent = ruleFlag(percentDeclarations);
        if (
          percent === undefined &&
          percentDeclarations.some((v) => v !== undefined && v !== null)
        )
          unknownRules = true;
        if (
          cat.calculationType !== undefined &&
          !["points", "percent"].includes(String(cat.calculationType))
        )
          unknownRules = true;
        if (
          cat.calculationType !== undefined &&
          percent !== undefined &&
          (cat.calculationType === "percent") !== percent
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
    const composite =
      kind === "semester" ? compositeSemester(row, entries, rows) : undefined;
    if (composite) composites.set(namespace, composite);
    const start =
      ownStart ??
      (kind === "semester" && !/^s(?:emester)?\s*\d/i.test(termName)
        ? composite?.start
        : date(term.startDate));
    const end = ownEnd ?? composite?.end ?? date(term.endDate);
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
              ? (composite?.name ?? taskName)
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
          ownStart === undefined && composite
            ? composite.startDateOnly
            : !!start &&
                /^\d{4}-\d{2}-\d{2}$/.test(
                  String(task.startDate ?? term.startDate),
                ),
        ),
        period_end_date_only: String(
          ownEnd === undefined && composite
            ? composite.endDateOnly
            : !!end &&
                /^\d{4}-\d{2}-\d{2}$/.test(
                  String(task.endDate ?? term.endDate),
                ),
        ),
        ...(kind ? { period_kind: kind } : {}),
      },
    });
  }
  // calculationWeight belongs to an edge in a composite, not to a quarter in
  // isolation. Use it only when all links resolve to this unique semester.
  for (const [parentID, composite] of composites) {
    const parent = output.find((c) => c.id === parentID)!;
    const children = composite.components.map((component) => ({
      component,
      course: output.find(
        (c) =>
          c.fields.physical_key === parent.fields.physical_key &&
          c.term.id === component.term + ":" + component.task,
      ),
    }));
    if (
      children.some(
        ({ course }) => !course || semester(course, output)?.id !== parentID,
      )
    )
      continue;
    if (
      children.some(
        ({ component }) =>
          component.weight === undefined || component.weight < 0,
      ) ||
      !children.some(({ component }) => component.weight! > 0) ||
      children.some(
        ({ component, course }) =>
          course!.term.weight !== undefined &&
          course!.term.weight !== component.weight,
      )
    ) {
      for (const { course } of children) delete course!.term.weight;
      continue;
    }
    for (const { component, course } of children)
      course!.term.weight = component.weight;
  }
  return output;
}
