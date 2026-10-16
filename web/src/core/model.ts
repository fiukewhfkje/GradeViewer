export interface Grade {
  percent?: number;
  letter?: string;
}
export interface Score {
  earned?: number;
  possible?: number;
  letter?: string;
  excused: boolean;
}
export interface Assignment {
  id: string;
  title: string;
  categoryID?: string;
  due?: number;
  updated?: number;
  score: Score;
  multiplier: number;
  excluded: boolean;
  fields: Record<string, string>;
}
export interface Category {
  id: string;
  name: string;
  weight?: number;
  method: "points" | "percent";
  dropLowest: number;
  excluded: boolean;
}
export interface Term {
  id: string;
  name: string;
  start?: number;
  end?: number;
  weight?: number;
}
export interface SourceCourse {
  id: string;
  title: string;
  teacher: string;
  term: Term;
  grade: Grade;
  categories: Category[];
  assignments: Assignment[];
  method: "points" | "weightedCategories" | "equalCategories" | "unknown";
  fetched: number;
  fields: Record<string, string>;
  catalog?: Assignment[];
}
export interface Observation {
  id: string;
  date: number;
  grade: Grade;
  provider: string;
}
export interface Course extends SourceCourse {
  history: Observation[];
  hidden: boolean;
  order: number;
  removed: string[];
}
export interface Scenario {
  scores: Record<string, number>;
  ignored: string[];
  added: Assignment[];
}
export interface SavedState {
  schema: 1;
  account?: string;
  courses: Course[];
  scenarios: Record<string, Scenario>;
  metadata?: Record<
    string,
    {
      account: string;
      fetched: number;
      fingerprint: string;
      payload: {
        section: Record<string, unknown>;
        items: Record<string, unknown>[];
        categories: Record<string, unknown>[];
        periods: Record<string, unknown>[];
        scales?: Record<string, unknown>[];
      };
    }
  >;
}
export const emptyScenario = (): Scenario => ({
  scores: {},
  ignored: [],
  added: [],
});
export const emptyState = (): SavedState => ({
  schema: 1,
  courses: [],
  scenarios: {},
});
export const hasTitle = (a: Assignment) =>
  !!a.title.trim() &&
  !/^(untitled assignment|assignment(?: \d+)?)$/i.test(a.title.trim());
export const graded = (a: Assignment) =>
  a.score.earned !== undefined || !!a.score.letter;
export const scorePercent = (a: Assignment) =>
  !a.score.excused &&
  a.score.earned !== undefined &&
  (a.score.possible ?? 0) > 0
    ? (a.score.earned / a.score.possible!) * 100
    : undefined;
export const calculationSource = (c: Course): SourceCourse => ({
  ...c,
  assignments: c.assignments.filter((a) => !c.removed.includes(a.id)),
});
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const percentText = (n?: number, digits = 2) =>
  n !== undefined && Number.isFinite(n)
    ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(n)}%`
    : "—";
export const pointsText = (n?: number) =>
  n !== undefined && Number.isFinite(n)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)
    : "—";
export function scoreInput(s: string): number | undefined {
  const t = s.trim().replaceAll("−", "-").replaceAll(",", ".");
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t) &&
    Number.isFinite(Number(t))
    ? Number(t)
    : undefined;
}
export function recent(rows: Assignment[]) {
  return rows
    .filter(graded)
    .sort(
      (a, b) =>
        (b.updated ?? -Infinity) - (a.updated ?? -Infinity) ||
        (b.due ?? -Infinity) - (a.due ?? -Infinity) ||
        normalize(a.title).localeCompare(normalize(b.title)) ||
        a.id.localeCompare(b.id),
    );
}
export function updateAge(
  date?: number,
  now = Date.now(),
): { text: string; fresh: boolean } | undefined {
  if (date === undefined) return;
  const elapsed = Math.max(0, now - date),
    h = elapsed / 3600000;
  let count, unit;
  if (h < 0.5) return { text: "updated recently", fresh: true };
  if (h < 23.5) {
    count = Math.round(h);
    unit = "hour";
  } else if (elapsed > 30 * 86400000) {
    count = Math.max(1, Math.floor(elapsed / (30 * 86400000)));
    unit = "month";
  } else {
    count = Math.max(1, Math.round(elapsed / 86400000));
    unit = "day";
  }
  return {
    text: `updated ${count} ${unit}${count === 1 ? "" : "s"} ago`,
    fresh: h < 24,
  };
}
