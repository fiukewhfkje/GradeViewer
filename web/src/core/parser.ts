import {
  type Assignment,
  type Category,
  type SourceCourse,
  hasTitle,
} from "./model";
import { titleDates } from "./periods";
export type Row = Record<string, unknown>;
export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
export function object(v: unknown): Row {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new ProviderError("malformed");
  return v as Row;
}
export function collection(v: unknown): Row[] {
  const rows = Array.isArray(v) ? v : [v];
  if (rows.some((x) => !x || typeof x !== "object" || Array.isArray(x)))
    throw new ProviderError("malformed");
  return rows as Row[];
}
export function text(v: unknown): string | undefined {
  return typeof v === "string" || typeof v === "number" ? String(v) : undefined;
}
export function nonempty(v: unknown) {
  return text(v)?.trim() || undefined;
}
export function number(v: unknown): number | undefined {
  const s = nonempty(v);
  return s !== undefined && Number.isFinite(Number(s)) ? Number(s) : undefined;
}
export const flag = (v: unknown) =>
  text(v) === "1" || text(v)?.toLowerCase() === "true";
export function date(v: unknown): number | undefined {
  const s = nonempty(v);
  if (!s) return;
  const n = number(s);
  if (n !== undefined) {
    if (n <= 1000000) return;
    const ms = n > 100000000000 ? n : n * 1000;
    return ms <= 253402300799000 ? ms : undefined;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
      s,
    )
  )
    return;
  const calendar = new Date(s.slice(0, 10) + "T00:00:00Z");
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== s.slice(0, 10)
  )
    return;
  const normalized = s.replace(" ", "T");
  const parsed = Date.parse(
    normalized.includes("T") && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
      ? normalized + "Z"
      : normalized,
  );
  return Number.isFinite(parsed) ? parsed : undefined;
}
export function itemID(r: Row) {
  const node = nonempty(r.grade_item_id);
  return node && (number(node) === undefined || number(node)! > 0)
    ? node
    : nonempty(r.id);
}
const kind = (r: Row) => nonempty(r.type) ?? "assignment";
export const itemKey = (r: Row) =>
  itemID(r) ? `${kind(r)}:${itemID(r)}` : undefined;
function raw(r: Row, keys: string[]) {
  return Object.fromEntries(
    keys.flatMap((k) => (text(r[k]) === undefined ? [] : [[k, text(r[k])!]])),
  );
}
export function compatible(
  item: Row,
  id: string,
  expectedKind: string,
  possible?: number,
  category?: string,
  period?: string,
) {
  const k = kind(item);
  if (itemID(item) !== id && nonempty(item.id) !== id) return false;
  if (k === "folder") return false;
  if (
    ["assignment", "discussion", "assessment"].includes(k) &&
    k !== expectedKind
  )
    return false;
  if (
    !["assignment", "discussion", "assessment"].includes(k) &&
    itemID(item) !== id &&
    !(k === expectedKind && nonempty(item.id) === id)
  )
    return false;
  if (
    possible !== undefined &&
    number(item.max_points) !== undefined &&
    possible !== number(item.max_points)
  )
    return false;
  if (
    category !== undefined &&
    nonempty(item.grading_category) !== undefined &&
    category !== nonempty(item.grading_category)
  )
    return false;
  if (
    period !== undefined &&
    nonempty(item.grading_period) !== undefined &&
    period.replace(/^p/, "") !== nonempty(item.grading_period)
  )
    return false;
  return true;
}
export function assignmentMetadata(
  item: Row,
  row: Assignment,
  period?: string,
): Assignment | undefined {
  const id = row.fields.assignment_id,
    title = nonempty(item.title);
  if (
    !id ||
    !title ||
    !compatible(
      item,
      id,
      row.fields.type ?? "assignment",
      row.score.possible,
      row.fields.category_id,
      period,
    )
  )
    return;
  const result = {
    ...row,
    title,
    due: row.due ?? date(item.due),
    score: {
      ...row.score,
      possible: row.score.possible ?? number(item.max_points),
    },
  };
  return hasTitle(result) ? result : undefined;
}
export interface SectionPayload {
  section: Row;
  grades: Row;
  items: Row[];
  categories: Row[];
  periods: Row[];
  scales?: Row[];
  owner: string;
  fetched?: number;
}
export function parseSection(p: SectionPayload): SourceCourse[] {
  const sectionID = nonempty(p.section.id);
  if (!sectionID) throw new ProviderError("malformed");
  const grades = collection(p.grades.section).find(
    (x) => nonempty(x.section_id) === p.owner,
  );
  if (!grades || grades.period === undefined)
    throw new ProviderError("malformed");
  if (
    p.items.some((x) => !itemID(x)) ||
    p.categories.some(
      (x) =>
        !nonempty(x.id) ||
        !nonempty(x.title) ||
        (x.drop_lowest != null &&
          (!Number.isSafeInteger(number(x.drop_lowest)) ||
            number(x.drop_lowest)! < 0)),
    )
  )
    throw new ProviderError("malformed");
  const categoryID = (id: unknown) =>
    text(id) !== undefined
      ? `schoology:${p.owner}:category:${text(id)}`
      : undefined;
  const categories: Category[] = p.categories.map((r) => ({
    id: categoryID(r.id)!,
    name: nonempty(r.title)!,
    weight: number(r.weight),
    method: number(r.calculation_type) === 1 ? "percent" : "points",
    dropLowest: number(r.drop_lowest) ?? 0,
    excluded: false,
  }));
  const known = p.categories.every(
      (r) =>
        r.calculation_type == null ||
        [1, 2].includes(number(r.calculation_type) ?? -1),
    ),
    options = p.section.options ? object(p.section.options) : {},
    method =
      !known || options.weighted_grading_categories == null
        ? "unknown"
        : flag(options.weighted_grading_categories)
          ? "weightedCategories"
          : "equalCategories";
  const metadata = (r: Row, period: string): Row => {
    const id = nonempty(r.assignment_id)!,
      key = `${kind(r)}:${id}`,
      ok = (x: Row) =>
        compatible(
          x,
          id,
          kind(r),
          number(r.max_points),
          nonempty(r.category_id),
          period,
        );
    const primary = p.items.filter((x) => itemKey(x) === key).at(-1);
    if (primary) return ok(primary) ? primary : {};
    const nodes = p.items.filter((x) => itemID(x) === id);
    if (
      nodes.length === 1 &&
      !["assignment", "discussion", "assessment"].includes(kind(nodes[0])) &&
      ok(nodes[0])
    )
      return nodes[0];
    const aliases = p.items.filter(
      (x) =>
        itemID(x) !== nonempty(x.id) && `${kind(x)}:${nonempty(x.id)}` === key,
    );
    return aliases.length &&
      new Set(aliases.map(itemKey)).size === 1 &&
      aliases.every(ok)
      ? aliases.at(-1)!
      : {};
  };
  const catalog = p.items.map((item) => ({
    id: `schoology:${p.owner}:catalog:${kind(item)}:${itemID(item)}`,
    title: nonempty(item.title) ?? "Untitled assignment",
    categoryID: categoryID(item.grading_category),
    due: date(item.due),
    score: { possible: number(item.max_points), excused: false },
    multiplier: number(item.factor) ?? 1,
    excluded: item.count_in_grade != null && !flag(item.count_in_grade),
    fields: raw(item, ["id", "grade_item_id", "type", "grading_period"]),
  }));
  const finals =
      grades.final_grade == null ? [] : collection(grades.final_grade),
    periods = collection(grades.period),
    ids = new Set(periods.map((r) => nonempty(r.period_id)));
  for (const final of finals) {
    const id = nonempty(final.period_id);
    if (id && !ids.has(id)) {
      periods.push({ period_id: id, assignment: [] });
      ids.add(id);
    }
  }
  for (const m of p.periods) {
    const id = nonempty(m.id);
    if (id && !ids.has("p" + id)) {
      periods.push({ period_id: "p" + id, assignment: [] });
      ids.add("p" + id);
    }
  }
  return periods.map((period) => {
    const id = nonempty(period.period_id);
    if (!id) throw new ProviderError("malformed");
    const final = finals.find((r) => nonempty(r.period_id) === id),
      meta =
        p.periods.find((r) => nonempty(r.id) === id.replace(/^p/, "")) ?? {},
      name = nonempty(period.period_title) ?? nonempty(meta.title) ?? id;
    const dates = titleDates(name),
      gradeText = nonempty(final?.grade),
      numeric = number(final?.grade),
      scale = number(final?.scale_id);
    let percent = scale === 0 ? numeric : undefined;
    const fields: Record<string, string> = {
      section_id: sectionID,
      grade_section_id: p.owner,
      period_id: id,
      course_name:
        nonempty(p.section.course_title) ??
        nonempty(p.section.section_title) ??
        "Course",
    };
    if (
      ["override", "override_grade", "grade_override"].some(
        (k) => nonempty(final?.[k]) !== undefined,
      ) ||
      flag(final?.is_override)
    )
      fields.overall_override = "true";
    if (gradeText && scale !== 0) {
      fields.unsupported_overall_scale = "true";
      if (numeric !== undefined && nonempty(final?.scale_id)) {
        fields.reported_numeric_total = String(numeric);
        fields.reported_scale_id = nonempty(final?.scale_id)!;
        const matching = p.scales?.filter(
          (s) => nonempty(s.id) === fields.reported_scale_id,
        );
        if (
          matching?.length === 1 &&
          [0, 1].includes(number(matching[0].type) ?? -1) &&
          (matching[0].hide_numeric == null ||
            number(matching[0].hide_numeric) === 0)
        ) {
          percent = numeric;
          delete fields.unsupported_overall_scale;
          fields.overall_scale_type = String(number(matching[0].type));
          fields.overall_scale_verified_at = String(p.fetched ?? Date.now());
        }
      }
    }
    for (const key of ["start", "end"]) {
      const v = nonempty(meta[key] ?? period[key]);
      if (v)
        fields[`period_${key}_date_only`] = String(
          /^\d{4}-\d{2}-\d{2}(?: 00:00:00)?$/.test(v),
        );
    }
    if (
      p.categories.some(
        (c) =>
          number(c.calculation_type) === undefined ||
          number(c.drop_lowest) === undefined,
      )
    )
      fields.grade_rules_inferred = "true";
    const wrapped =
        period.assignment &&
        typeof period.assignment === "object" &&
        !Array.isArray(period.assignment)
          ? (period.assignment as Row).grade
          : period.assignment,
      rows = collection(wrapped);
    if (rows.some((r) => !nonempty(r.assignment_id)))
      throw new ProviderError("malformed");
    const assignments: Assignment[] = rows.map((r) => {
      const node = nonempty(r.assignment_id)!,
        item = metadata(r, id),
        exception = number(r.exception) ?? 0;
      return {
        id: `schoology:${p.owner}:${id}:${kind(r)}:${node}`,
        title:
          nonempty(item.title) ?? nonempty(r.title) ?? "Untitled assignment",
        categoryID: categoryID(r.category_id ?? item.grading_category),
        due: date(item.due),
        updated: date(r.timestamp),
        score: {
          earned: exception === 0 ? number(r.grade) : undefined,
          possible: number(r.max_points) ?? number(item.max_points),
          letter:
            exception === 0 &&
            nonempty(r.grade) &&
            number(r.grade) === undefined
              ? nonempty(r.grade)
              : undefined,
          excused: exception === 1,
        },
        multiplier: number(item.factor) ?? 1,
        excluded: item.count_in_grade != null && !flag(item.count_in_grade),
        fields: raw(r, [
          "assignment_id",
          "type",
          "category_id",
          "exception",
          "grade",
          "scale_id",
          "scale_type",
          "timestamp",
        ]),
      };
    });
    const existing = new Set(
        rows.map((r) => `${kind(r)}:${nonempty(r.assignment_id)}`),
      ),
      represented = new Set(rows.map((r) => itemKey(metadata(r, id))));
    for (const item of p.items.filter(
      (x) => text(x.grading_period) === id.replace(/^p/, ""),
    )) {
      if (
        !itemID(item) ||
        existing.has(itemKey(item)!) ||
        represented.has(itemKey(item))
      )
        continue;
      assignments.push({
        id: `schoology:${p.owner}:${id}:${kind(item)}:${itemID(item)}`,
        title: nonempty(item.title) ?? "Untitled assignment",
        categoryID: categoryID(item.grading_category),
        due: date(item.due),
        score: { possible: number(item.max_points), excused: false },
        multiplier: number(item.factor) ?? 1,
        excluded: item.count_in_grade != null && !flag(item.count_in_grade),
        fields: { assignment_id: itemID(item)!, type: kind(item) },
      });
    }
    return {
      id: `schoology:${p.owner}:${id}`,
      title: fields.course_name,
      teacher:
        text(p.section.teacher_display ?? p.section.teacherDisplay) ?? "",
      term: {
        id,
        name,
        start: date(meta.start ?? period.start) ?? dates[0],
        end: date(meta.end ?? period.end) ?? dates[1],
        weight:
          number(final?.weight) ?? number(meta.weight) ?? number(period.weight),
      },
      grade: {
        percent,
        letter: gradeText && numeric === undefined ? gradeText : undefined,
      },
      categories,
      assignments,
      method,
      fetched: p.fetched ?? Date.now(),
      fields,
      catalog,
    };
  });
}
