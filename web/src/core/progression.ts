import {
  type Course,
  type SourceCourse,
  calculationSource,
  graded,
} from "./model";
import { calculate, reliable } from "./calculator";
import {
  assignmentPeriods,
  includesHistory,
  overall,
  descriptor,
  related,
  semester,
  ordered,
  contains,
  boundary,
} from "./periods";
export interface GraphPoint {
  id: string;
  date: number;
  percent: number;
  calculated: boolean;
}
export function calculatedPoints(
  c: SourceCourse,
  includeCurrent = true,
): GraphPoint[] {
  if (!reliable(c)) return [];
  const baseline = calculate(c),
    reported = c.grade.percent!;
  const current: GraphPoint[] =
    includeCurrent && c.fields.grade_basis === "calculated"
      ? [
          {
            id: "calculated:snapshot:" + c.id,
            date: c.fetched,
            percent: reported,
            calculated: true,
          },
        ]
      : [];
  const rows = c.assignments.filter((a) => a.score.earned !== undefined);
  if (
    !rows.length ||
    rows.some(
      (a) =>
        (a.updated ?? a.due) === undefined || (a.updated ?? a.due)! > c.fetched,
    )
  )
    return current;
  const ordered = [...rows].sort(
      (a, b) =>
        (a.updated ?? a.due)! - (b.updated ?? b.due)! ||
        (a.due ?? -Infinity) - (b.due ?? -Infinity) ||
        a.id.localeCompare(b.id),
    ),
    result: GraphPoint[] = [];
  for (let i = 0; i < ordered.length; i++) {
    try {
      const n = calculate({ ...c, assignments: ordered.slice(0, i + 1) });
      result.push({
        id: "calculated:" + ordered[i].id,
        date: (ordered[i].updated ?? ordered[i].due)!,
        percent: Math.abs(n - baseline) <= 1e-9 ? reported : n,
        calculated: true,
      });
    } catch {
      /* An unsupported prefix is not a provider observation. */
    }
  }
  return result.concat(current);
}
function periodPoints(p: Course, current: boolean): GraphPoint[] {
  const history = p.history
    .filter((h) => current || includesHistory(p, h.date))
    .filter((h) => h.grade.percent !== undefined)
    .map((h) => ({
      id: h.id,
      date: h.date,
      percent: h.grade.percent!,
      calculated: false,
    }))
    .sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
  const calculated = calculatedPoints(calculationSource(p), current),
    dates = [...new Set(calculated.map((x) => x.date))].sort((a, b) => a - b),
    nextDates = new Map(
      dates.map((date, i) => [date, dates[i + 1] ?? Infinity]),
    );
  let firstHistory = 0;
  return calculated
    .map((point) => {
      const next = nextDates.get(point.date) ?? Infinity;
      while (
        firstHistory < history.length &&
        history[firstHistory].date < point.date
      )
        firstHistory++;
      let anchor: GraphPoint | undefined;
      for (
        let i = firstHistory;
        i < history.length && history[i].date < next;
        i++
      ) {
        if (Math.abs(history[i].percent - point.percent) <= 0.01 + 1e-9) {
          anchor = history[i];
          break;
        }
      }
      return anchor && !point.id.startsWith("calculated:snapshot:")
        ? { ...point, percent: anchor.percent }
        : point;
    })
    .concat(history);
}
function sortedPoints(points: GraphPoint[]) {
  const observedDates = new Set(
    points.filter((p) => !p.calculated).map((p) => p.date),
  );
  return points
    .sort(
      (a, b) =>
        a.date - b.date ||
        Number(b.calculated) - Number(a.calculated) ||
        a.id.localeCompare(b.id),
    )
    .filter((p) => !p.calculated || !observedDates.has(p.date));
}

/** Semester observations stay authoritative. Reconstructed events combine the
 * explicitly weighted components available at each real event date, only when
 * their complete baseline reproduces the reported semester total. */
export function progression(c: Course, all: Course[]): GraphPoint[] {
  const basis = overall(c, all);
  if (descriptor(basis).kind !== "semester") {
    const periods = assignmentPeriods(c, all),
      populated = (periods.length ? periods : [c]).filter(
        (p) => p.assignments.some(graded) || p.history.length,
      );
    return sortedPoints(
      populated.flatMap((p, i) => periodPoints(p, i === populated.length - 1)),
    );
  }
  const own = periodPoints(basis, true);
  if (
    basis.grade.percent !== undefined &&
    Number.isFinite(basis.grade.percent) &&
    !own.some(
      (p) => p.date === basis.fetched && p.percent === basis.grade.percent,
    )
  )
    own.push({
      id: "calculated:semester:snapshot:" + basis.id,
      date: basis.fetched,
      percent: basis.grade.percent,
      calculated: true,
    });
  const children = ordered(
    related(basis, all).filter(
      (p) =>
        ["quarter", "exam"].includes(descriptor(p).kind) &&
        semester(p, all)?.id === basis.id &&
        p.term.weight !== 0 &&
        (p.grade.percent !== undefined ||
          !!p.grade.letter ||
          p.assignments.some(graded)),
    ),
  );
  if (
    !children.length ||
    basis.assignments.some(graded) ||
    basis.grade.percent === undefined ||
    basis.fields.overall_override === "true" ||
    children.some(
      (p) =>
        p.grade.percent === undefined ||
        !Number.isFinite(p.grade.percent) ||
        !Number.isFinite(p.term.weight) ||
        (p.term.weight ?? 0) <= 0 ||
        p.fields.overall_override === "true",
    )
  )
    return sortedPoints(own);
  const total = children.reduce((n, p) => n + p.term.weight!, 0),
    baseline =
      children.reduce((n, p) => n + p.grade.percent! * p.term.weight!, 0) /
      total;
  if (Math.abs(baseline - basis.grade.percent) > 0.15) return sortedPoints(own);
  const events = children
    .flatMap((period) =>
      sortedPoints(periodPoints(period, false))
        .filter((point) => contains(period, point.date))
        .map((point) => ({ period, point })),
    )
    .sort(
      (a, b) =>
        a.point.date - b.point.date || a.point.id.localeCompare(b.point.id),
    );
  const values = new Map<string, number>();
  const reconstructed: GraphPoint[] = [];
  for (const { period, point } of events) {
    values.set(period.id, point.percent);
    let sum = 0,
      weight = 0;
    for (const p of children) {
      // A completed component uses its complete baseline at a later event;
      // a future component contributes nothing before its first dated event.
      const percent =
        (boundary(p, true) ?? Infinity) < point.date
          ? p.grade.percent
          : values.get(p.id);
      if (percent !== undefined) {
        sum += percent * p.term.weight!;
        weight += p.term.weight!;
      }
    }
    if (weight > 0)
      reconstructed.push({
        ...point,
        id: "calculated:semester:" + basis.id + ":" + point.id,
        percent: sum / weight,
        calculated: true,
      });
  }
  return sortedPoints(reconstructed.concat(own));
}
/** GradeCurve.swift geometry: evenly spaced real events, monotone interpolation.
 * A tracing marker follows the curve; the tooltip always selects an actual event.
 */
export function gradeCurve(input: GraphPoint[]) {
  const observed = new Set(
    input
      .filter((p) => !p.calculated && Number.isFinite(p.percent))
      .map((p) => p.date),
  );
  const seen = new Set<string>();
  const points = input
    .filter((p) => Number.isFinite(p.percent) && Number.isFinite(p.date))
    .sort(
      (a, b) => a.date - b.date || Number(b.calculated) - Number(a.calculated),
    )
    .filter(
      (p) =>
        (!p.calculated || !observed.has(p.date)) &&
        !seen.has(p.id) &&
        !!seen.add(p.id),
    );
  const values = points.map((p) => p.percent),
    n = points.length;
  const low = n ? Math.min(...values) : 0,
    high = n ? Math.max(...values) : 100;
  const padding = Math.max(1, (high - low) * 0.12);
  const y = (value: number) =>
    12 + (1 - (value - low + padding) / (high - low + 2 * padding)) * 130;
  const slopes = values.slice(1).map((v, i) => (v - values[i]) * (n - 1));
  const tangents = values.map((_, i) =>
    i === 0
      ? slopes[0]
      : i === n - 1
        ? slopes[n - 2]
        : (Math.sign(slopes[i - 1]) + Math.sign(slopes[i])) *
          Math.min(
            Math.abs(slopes[i - 1]),
            Math.abs(slopes[i]),
            Math.abs((slopes[i - 1] + slopes[i]) / 4),
          ),
  );
  let path =
    n === 1
      ? `M0,${y(values[0])} L1000,${y(values[0])}`
      : n
        ? `M0,${y(values[0])}`
        : "";
  for (let i = 0; i < n - 1; i++) {
    const h = 1 / (n - 1),
      x = i * h * 1000;
    path += ` C${x + (1000 * h) / 3},${y(values[i] + (tangents[i] * h) / 3)} ${x + (2000 * h) / 3},${y(values[i + 1] - (tangents[i + 1] * h) / 3)} ${(i + 1) * h * 1000},${y(values[i + 1])}`;
  }
  const event = (fraction: number) =>
    points[Math.round(Math.max(0, Math.min(1, fraction)) * (n - 1))];
  const trace = (fraction: number) => {
    if (!n) return undefined;
    if (n === 1) return y(values[0]);
    const f = Math.max(0, Math.min(1, fraction)) * (n - 1),
      i = Math.min(n - 2, Math.floor(f)),
      t = f - i;
    const t2 = t * t,
      t3 = t2 * t,
      h = 1 / (n - 1);
    return y(
      (2 * t3 - 3 * t2 + 1) * values[i] +
        (t3 - 2 * t2 + t) * h * tangents[i] +
        (-2 * t3 + 3 * t2) * values[i + 1] +
        (t3 - t2) * h * tangents[i + 1],
    );
  };
  return { points, path, event, trace };
}
export function curve(points: GraphPoint[]) {
  return gradeCurve(points).path;
}
