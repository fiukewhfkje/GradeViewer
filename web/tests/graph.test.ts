import { describe, expect, it } from "vitest";
import {
  gradeCurve,
  progression,
  type GraphPoint,
} from "../src/core/progression";
import type { Course } from "../src/core/model";

const points = (values: number[]): GraphPoint[] =>
  values.map((percent, i) => ({
    id: String(i),
    date: 1000 + i,
    percent,
    calculated: true,
  }));

describe("native GradeCurve geometry and event selection", () => {
  it("keeps observations authoritative, stable same-date events and unique identities", () => {
    const curve = gradeCurve([
      { id: "calculated", date: 10, percent: 70, calculated: true },
      { id: "observed", date: 10, percent: 71, calculated: false },
      { id: "a", date: 20, percent: 80, calculated: true },
      { id: "b", date: 20, percent: 81, calculated: true },
      { id: "b", date: 20, percent: 81, calculated: true },
      { id: "bad", date: 30, percent: NaN, calculated: true },
    ]);
    expect(curve.points.map((p) => p.id)).toEqual(["observed", "a", "b"]);
    expect(curve.event(0.24)?.id).toBe("observed");
    expect(curve.event(0.26)?.id).toBe("a");
    expect(curve.event(1)?.id).toBe("b");
  });
  it("traces native cubic geometry while tooltips retain discrete grades and dates", () => {
    const curve = gradeCurve(points([80, 100, 90]));
    expect(curve.trace(0)).toBeCloseTo(129.4193548387);
    expect(curve.trace(0.25)).toBeCloseTo(63.8951612903);
    expect(curve.trace(0.5)).toBeCloseTo(24.5806451613);
    expect(curve.trace(0.75)).toBeCloseTo(44.2379032258);
    expect(curve.event(0.25)?.percent).toBe(100);
    expect(curve.event(0.25)?.date).toBe(1001);
    // Intermediate samples stay within their own segment's extrema.
    for (let i = 0; i <= 100; i++) {
      const y = curve.trace(i / 100)!;
      expect(y).toBeGreaterThanOrEqual(24.5806451612);
      expect(y).toBeLessThanOrEqual(i < 50 ? 129.4193548388 : 77.0000000001);
    }
  });
  it("handles empty and single-event series at the native vertical midpoint", () => {
    expect(gradeCurve([]).path).toBe("");
    expect(gradeCurve([]).trace(0.5)).toBeUndefined();
    const curve = gradeCurve(points([99]));
    expect(curve.path).toBe("M0,77 L1000,77");
    expect(curve.trace(0)).toBe(77);
    expect(curve.trace(1)).toBe(77);
    expect(curve.event(1)?.percent).toBe(99);
  });
});

function period(
  id: string,
  name: string,
  start: string,
  end: string,
  percent: number,
  weight: number,
): Course {
  return {
    id,
    title: "Synthetic course",
    teacher: "",
    term: { id, name, start: Date.parse(start), end: Date.parse(end), weight },
    grade: { percent },
    categories: [],
    assignments: [],
    method: "points",
    fetched: Date.parse("2026-12-19T12:00:00Z"),
    fields: { section_id: "fixture" },
    history: [],
    hidden: false,
    order: 0,
    removed: [],
  };
}
function semesterFixture() {
  const q1 = period(
      "q1",
      "Quarter 1",
      "2026-08-01",
      "2026-09-30T23:59:59Z",
      80,
      45,
    ),
    q2 = period(
      "q2",
      "Quarter 2",
      "2026-10-01",
      "2026-12-31T23:59:59Z",
      100,
      45,
    ),
    s = period(
      "s1",
      "Semester 1",
      "2026-08-01",
      "2026-12-31T23:59:59Z",
      90,
      100,
    );
  for (const p of [q1, q2])
    p.assignments = [
      {
        id: p.id + ":score",
        title: "Synthetic assignment",
        updated: p.term.start! + 86400000,
        score: { earned: p.grade.percent, possible: 100, excused: false },
        multiplier: 1,
        excluded: false,
        fields: {},
      },
    ];
  s.history = [
    {
      id: "semester-observed",
      date: s.fetched,
      grade: { percent: 90 },
      provider: "schoology",
    },
  ];
  return { q1, q2, s, all: [q1, q2, s] };
}
describe("semester progression", () => {
  it("combines Q2 with Q1 instead of switching to the Q2 percentage", () => {
    const { q2, all } = semesterFixture(),
      before = JSON.stringify(all);
    const points = progression(q2, all);
    expect(points.map((p) => p.percent)).toEqual([80, 90, 90]);
    expect(points.at(-1)?.id).toBe("semester-observed");
    expect(points.at(-1)?.calculated).toBe(false);
    expect(points.slice(0, 2).every((p) => p.calculated)).toBe(true);
    expect(JSON.stringify(all)).toBe(before);
  });
  it("uses declared unequal weights, includes a real zero exam and omits blank exams", () => {
    const { q1, q2, s, all } = semesterFixture();
    q1.term.weight = 30;
    q2.term.weight = 60;
    const exam = period("exam", "Exam", "2026-12-18", "2026-12-20", 0, 10);
    exam.history = [
      {
        id: "exam-observed",
        date: Date.parse("2026-12-18T12:00:00Z"),
        grade: { percent: 0 },
        provider: "schoology",
      },
    ];
    s.grade.percent = 84;
    s.history[0].grade.percent = 84;
    let points = progression(q2, [...all, exam]);
    expect(points[1].percent).toBeCloseTo(93.3333333333);
    expect(points[2].percent).toBe(84);
    expect(points.at(-1)?.percent).toBe(84);
    exam.grade = {};
    exam.history = [];
    s.grade.percent = 93.3333333333;
    s.history[0].grade.percent = s.grade.percent;
    points = progression(q2, [...all, exam]);
    expect(points.at(-1)?.percent).toBeCloseTo(93.3333333333);
  });
  it("keeps only semester data when weights or baseline cannot support reconstruction", () => {
    const { q1, q2, s, all } = semesterFixture();
    q1.term.weight = undefined;
    expect(progression(q2, all)).toEqual([
      {
        id: "semester-observed",
        date: s.fetched,
        percent: 90,
        calculated: false,
      },
    ]);
    q1.term.weight = 45;
    s.grade.percent = 70;
    s.history[0].grade.percent = 70;
    expect(progression(q2, all).map((p) => p.percent)).toEqual([70]);
  });
  it("does not mix semesters, estimate a missing quarter or rewrite observations", () => {
    const { q2, s, all } = semesterFixture();
    const other = period("q3", "Quarter 3", "2027-01-01", "2027-03-31", 12, 45);
    other.history = [
      {
        id: "other-semester",
        date: Date.parse("2027-02-01"),
        grade: { percent: 12 },
        provider: "schoology",
      },
    ];
    expect(progression(q2, [...all, other]).map((p) => p.percent)).toEqual([
      80, 90, 90,
    ]);
    q2.grade = {};
    expect(progression(q2, all).map((p) => p.percent)).toEqual([
      s.grade.percent,
    ]);
  });
});
