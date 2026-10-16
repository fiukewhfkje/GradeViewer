import { describe, it, expect } from "vitest";
import { calculate, hypothetical, requiredFinal } from "../src/core/calculator";
import {
  type SourceCourse,
  type Course,
  type Assignment,
  emptyScenario,
  scoreInput,
  updateAge,
} from "../src/core/model";
import { parseSection, assignmentMetadata, itemID, date } from "../src/core/parser";
import { reconcile, resolveGrades } from "../src/core/reconcile";
import { syntheticPayload } from "../src/core/demo";
import {
  estimateQuarter,
  latestGradeUpdate,
  contains,
  overall,
  semesterScale,
  exams,
  visibleCourses,
} from "../src/core/periods";
import { progression, calculatedPoints, curve } from "../src/core/progression";
const score = (
  earned: number | undefined,
  possible = 100,
  id = "a",
): Assignment => ({
  id,
  title: "Synthetic quiz",
  score: { earned, possible, excused: false },
  multiplier: 1,
  excluded: false,
  fields: {},
  updated: 1000,
});
const source = (assignments = [score(80)]): SourceCourse => ({
  id: "test",
  title: "Synthetic course",
  teacher: "",
  term: { id: "q", name: "Quarter" },
  grade: { percent: 80 },
  categories: [],
  assignments,
  method: "points",
  fetched: 3000,
  fields: { section_id: "100" },
});
const course = (s: SourceCourse): Course => ({
  ...s,
  history: [],
  hidden: false,
  order: 0,
  removed: [],
});
function periods(exam?: number, q1Weight = 40, q2Weight = 35, examWeight = 25) {
  const base = source(),
    term = (
      id: string,
      name: string,
      start: string,
      end: string,
      weight: number,
      percent?: number,
    ): SourceCourse => ({
      ...structuredClone(base),
      id,
      term: {
        id,
        name,
        start: Date.parse(start),
        end: Date.parse(end),
        weight,
      },
      grade: { percent },
      assignments: [],
      fields: {
        section_id: "100",
        period_start_date_only: "true",
        period_end_date_only: "true",
      },
    });
  const q1 = term("q1", "Q1", "2026-08-01", "2026-10-15", q1Weight, 90),
    q2 = term("q2", "Q2", "2026-10-16", "2026-12-20", q2Weight);
  q2.assignments = [score(undefined)];
  return [
    q1,
    q2,
    term(
      "s",
      "S1",
      "2026-08-01",
      "2026-12-20",
      100,
      (90 * q1Weight + 70 * q2Weight + (exam ?? 0) * examWeight) /
        (q1Weight + q2Weight + (exam === undefined ? 0 : examWeight)),
    ),
    term("e", "Exam", "2026-12-18", "2026-12-20", examWeight, exam),
  ];
}
describe("native calculator rules", () => {
  it("uses points, multipliers and signed extra credit", () => {
    const c = source([score(-5, 20), { ...score(30, 20, "b"), multiplier: 2 }]);
    expect(calculate(c)).toBeCloseTo((55 / 60) * 100);
  });
  it("includes zero-point extra credit in points mode", () =>
    expect(calculate(source([score(80), score(5, 0, "b")]))).toBe(85));
  it("rejects zero denominators and letter-only contributions", () => {
    expect(() => calculate(source([score(5, 0)]))).toThrow();
    const a = score(undefined);
    a.score.letter = "P";
    expect(() => calculate(source([a]))).toThrow("incompleteData");
  });
  it("drops lowest by percentage before category weighting", () => {
    const c = source([
      score(50),
      score(90, 100, "b"),
      { ...score(80, 100, "c"), categoryID: "y" },
    ]);
    c.assignments[0].categoryID = c.assignments[1].categoryID = "x";
    c.categories = [
      {
        id: "x",
        name: "Tests",
        weight: 70,
        method: "points",
        dropLowest: 1,
        excluded: false,
      },
      {
        id: "y",
        name: "Work",
        weight: 30,
        method: "points",
        dropLowest: 0,
        excluded: false,
      },
    ];
    c.method = "weightedCategories";
    expect(calculate(c)).toBe(87);
  });
  it("normalizes populated category weights and supports percent averaging", () => {
    const c = source([
      { ...score(10, 10), categoryID: "x" },
      { ...score(0, 100, "b"), categoryID: "x" },
    ]);
    c.method = "weightedCategories";
    c.categories = [
      {
        id: "x",
        name: "X",
        weight: 30,
        method: "percent",
        dropLowest: 0,
        excluded: false,
      },
      {
        id: "y",
        name: "Y",
        weight: 70,
        method: "points",
        dropLowest: 0,
        excluded: false,
      },
    ];
    expect(calculate(c)).toBe(50);
  });
  it.each(["unknown", "missingCategory", "missingPoints", "badMultiplier"])(
    "rejects %s instead of guessing",
    (kind) => {
      const c = source();
      if (kind === "unknown") c.method = "unknown";
      if (kind === "missingCategory") c.method = "equalCategories";
      if (kind === "missingPoints") c.assignments[0].score.possible = undefined;
      if (kind === "badMultiplier") c.assignments[0].multiplier = 0;
      expect(() => calculate(c)).toThrow();
    },
  );
  it("excludes excused, dropped and explicitly excluded assignments", () => {
    const c = source([
      score(80),
      { ...score(0, 100, "b"), excluded: true },
      {
        ...score(0, 100, "c"),
        score: { earned: 0, possible: 100, excused: true },
      },
    ]);
    expect(calculate(c)).toBe(80);
    expect(
      calculate(source([score(80), score(0, 100, "b")]), {
        ...emptyScenario(),
        ignored: ["b"],
      }),
    ).toBe(80);
  });
  it("applies scenario delta to reported grade and rejects unreliable baseline", () => {
    const c = source();
    c.grade.percent = 80.01;
    expect(
      hypothetical(c, { ...emptyScenario(), scores: { a: 90 } }),
    ).toBeCloseTo(90.01);
    c.grade.percent = 90;
    expect(hypothetical(c, emptyScenario())).toBeUndefined();
  });
  it("final calculator accepts actual weights and extra-credit results", () => {
    expect(requiredFinal(80, 90, 0.2)).toBe(130);
    expect(() => requiredFinal(80, 90, 0)).toThrow();
  });
  it.each([
    ["-1.25", -1.25],
    ["105.5", 105.5],
    [".5", 0.5],
    ["1,25", 1.25],
    ["−3", -3],
    ["Infinity", undefined],
    ["", undefined],
  ])("parses score %s", (s, n) => expect(scoreInput(String(s))).toBe(n));
});
describe("unavailable scenarios", () => {
  it("withholds a total when every graded assignment is dropped", () => {
    expect(
      hypothetical(source(), { ...emptyScenario(), ignored: ["a"] }),
    ).toBeUndefined();
  });
});
describe("Schoology parsing and replacement", () => {
  const payload = () => ({
    ...syntheticPayload("100", Date.parse("2026-11-10T12:00:00Z")),
    owner: "100",
  });
  it("joins typed metadata and named ungraded items without duplicate scores", () => {
    const c = parseSection(payload()).find((c) => c.term.id === "p2")!;
    expect(c.assignments).toHaveLength(9);
    expect(
      c.assignments.filter((a) => a.score.earned !== undefined),
    ).toHaveLength(8);
    expect(c.assignments.every((a) => a.title !== "Untitled assignment")).toBe(
      true,
    );
  });
  it("defaults only hidden rules, rejects explicit unsupported methods", () => {
    const p = payload();
    for (const c of p.categories) {
      delete c.calculation_type;
      delete c.drop_lowest;
    }
    expect(parseSection(p)[0].fields.grade_rules_inferred).toBe("true");
    expect(parseSection(p)[0].method).toBe("weightedCategories");
    p.categories[0].calculation_type = 9;
    expect(parseSection(p)[0].method).toBe("unknown");
  });
  it("rejects malformed successful empty grade responses", () => {
    const p = payload();
    p.grades = {};
    expect(() => parseSection(p)).toThrow();
  });
  it("keeps reported zero and letter totals authoritative", () => {
    const p = payload();
    (p.grades.section as any[])[0].final_grade[0].grade = 0;
    expect(resolveGrades(parseSection(p))[0].grade.percent).toBe(0);
    (p.grades.section as any[])[0].final_grade[0].grade = "P";
    expect(resolveGrades(parseSection(p))[0].grade.letter).toBe("P");
  });
  it("uses a numeric overall scale only after unique visible metadata verification", () => {
    const p = payload();
    (p.grades.section as any[])[0].final_grade[0].scale_id = 17;
    expect(parseSection(p)[0].grade.percent).toBeUndefined();
    expect(
      parseSection({ ...p, scales: [{ id: 17, type: 1, hide_numeric: 0 }] })[0]
        .grade.percent,
    ).toBeDefined();
    expect(
      parseSection({ ...p, scales: [{ id: 17, type: 1, hide_numeric: 1 }] })[0]
        .grade.percent,
    ).toBeUndefined();
  });
  it("rejects conflicting title evidence and preserves score identity", () => {
    const a = {
      ...score(80),
      fields: { assignment_id: "12", type: "assignment", category_id: "1" },
    };
    expect(
      assignmentMetadata({ id: 12, type: "discussion", title: "Wrong" }, a),
    ).toBeUndefined();
    expect(
      assignmentMetadata({ id: 12, title: "Wrong", max_points: 50 }, a),
    ).toBeUndefined();
    expect(
      assignmentMetadata({ id: 12, title: "Correct", max_points: 100 }, a)
        ?.score.earned,
    ).toBe(80);
    expect(itemID({ id: 12, grade_item_id: 0 })).toBe("12");
  });
  it("retains observed history, known titles, order and removed identities", () => {
    const c = source();
    let old = reconcile([c]);
    old[0].removed = ["a"];
    old[0].order = 7;
    old[0].assignments[0].title = "Known title";
    c.assignments[0].title = "Untitled assignment";
    c.grade.percent = 80.01;
    const next = reconcile([c], old);
    expect(next[0].history).toHaveLength(2);
    expect(next[0].assignments[0].title).toBe("Known title");
    expect(next[0].removed).toEqual(["a"]);
    expect(next[0].order).toBe(7);
    expect(reconcile([], next)).toEqual([]);
  });
  it("keeps same-title assignments distinct and repeated identities singular", () => {
    const c = source([score(80), score(80, 100, "b"), score(80)]);
    expect(reconcile([c])[0].assignments).toHaveLength(2);
  });
  it("calculations never become observed history", () => {
    const c = source();
    c.grade = {};
    expect(reconcile([c])[0].history).toEqual([]);
    expect(reconcile([c])[0].grade.percent).toBe(80);
  });
});
describe("native periods and estimates", () => {
  it.each([undefined, 64, 0, 115])(
    "recovers missing quarter with exam %s",
    (exam) => {
      const p = periods(exam),
        e = estimateQuarter(p[1], p);
      expect(e?.percent).toBeCloseTo(70);
      expect(e?.blankExam).toBe(exam === undefined);
    },
  );
  it("limits precision for rounded and amplified inputs", () => {
    let p = periods(undefined, 45, 45, 10);
    p[0].grade.percent = 93.97;
    p[2].grade.percent = 81.99;
    const e = estimateQuarter(p[1], p);
    expect(e?.percent).toBeCloseTo(70.01);
    expect(e?.digits).toBe(1);
    p = periods(undefined, 95, 5, 0);
    expect(estimateQuarter(p[1], p)?.digits).toBe(0);
    p = periods(undefined, 99, 1, 0);
    expect(estimateQuarter(p[1], p)).toBeUndefined();
  });
  it.each([
    "overlap",
    "missingWeight",
    "override",
    "letter",
    "unknownExam",
    "noTitle",
  ])("withholds unsafe estimate %s", (kind) => {
    const p = periods();
    if (kind === "overlap") p.push({ ...p[2], id: "another-semester" });
    if (kind === "missingWeight") p[1].term.weight = undefined;
    if (kind === "override") p[2].fields.overall_override = "true";
    if (kind === "letter") p[1].grade.letter = "P";
    if (kind === "unknownExam") p[3].grade.letter = "P";
    if (kind === "noTitle") p[1].assignments = [];
    expect(estimateQuarter(p[1], p)).toBeUndefined();
  });
  it("replaces estimates with actual totals without changing inputs", () => {
    const p = periods(),
      before = JSON.stringify(p);
    expect(estimateQuarter(p[1], p)).toBeDefined();
    expect(JSON.stringify(p)).toBe(before);
    p[1].grade.percent = 70;
    expect(estimateQuarter(p[1], p)).toBeUndefined();
  });
  it("shares semester totals and preserves read-only exam association", () => {
    const p = periods(64);
    p[1].grade.percent = 70;
    expect(overall(p[1], p).id).toBe("s");
    expect(semesterScale(p[1], p[2], p)).toBeCloseTo(0.35);
    expect(exams(p[1], p).map((c) => c.id)).toEqual(["e"]);
  });
  it("includes the final local date-only school day", () => {
    const p = periods()[0];
    expect(contains(p, new Date(2026, 9, 15, 23, 59).getTime())).toBe(true);
    expect(contains(p, new Date(2026, 9, 16, 0, 0).getTime())).toBe(false);
  });
  it("selects one current quarter per physical course", () => {
    const p = reconcile(periods());
    expect(
      visibleCourses(p, Date.parse("2026-11-10")).map((c) => c.id),
    ).toEqual(["q2"]);
  });
});
describe("native progression regressions", () => {
  it.each([89.991, 89.996, 90.004, 90.009])(
    "anchors prefix %s in its own interval",
    (first) => {
      const c = course(
        source([
          score(first),
          { ...score(160 - first, 100, "b"), updated: 2000 },
        ]),
      );
      c.history = [
        {
          id: "obs",
          date: 1500,
          grade: { percent: 90 },
          provider: "schoology",
        },
        {
          id: "current",
          date: 3000,
          grade: { percent: 80 },
          provider: "schoology",
        },
      ];
      const before = JSON.stringify(c);
      expect(progression(c, [c]).map((p) => p.percent)).toEqual([
        90, 90, 80, 80,
      ]);
      expect(JSON.stringify(c)).toBe(before);
    },
  );
  it("preserves real hundredth changes and does not propagate large offsets", () => {
    const c = course(
      source([score(90.009), { ...score(69.991, 100, "b"), updated: 2000 }]),
    );
    c.history = [
      { id: "obs", date: 1500, grade: { percent: 89 }, provider: "schoology" },
    ];
    expect(progression(c, [c]).map((p) => p.percent)).toEqual([90.009, 89, 80]);
  });
  it("never invents an assignment date", () => {
    const c = source();
    delete c.assignments[0].updated;
    expect(calculatedPoints(c)).toEqual([]);
  });
  it("observations replace reconstruction at identical timestamps", () => {
    const c = course(source());
    c.history = [
      { id: "obs", date: 1000, grade: { percent: 80 }, provider: "schoology" },
    ];
    expect(progression(c, [c])).toHaveLength(1);
    expect(progression(c, [c])[0].calculated).toBe(false);
  });
  it("draws monotone native curve and flattens local extrema", () => {
    const path = curve(
      [0, 100, 0].map((percent, i) => ({
        id: String(i),
        date: i,
        percent,
        calculated: true,
      })),
    );
    expect(path).not.toContain("NaN");
    expect(path).toContain("C");
  });
});

describe("real update dates only", () => {
  it("withholds missing/nonfinite ages and uses actual semester component dates", () => {
    const p = periods();
    expect(latestGradeUpdate(p[1], p)).toBeUndefined();
    expect(updateAge(-Infinity)).toBeUndefined();
    p[0].assignments = [score(80)];
    p[0].assignments[0].updated = Date.parse("2026-10-10T12:00:00Z");
    expect(latestGradeUpdate(p[1], p)).toBe(Date.parse("2026-10-10T12:00:00Z"));
  });
  it("rejects zero/partial/impossible dates and treats timezone-less timestamps as UTC", () => {
    expect(date(0)).toBeUndefined();
    expect(date("2026")).toBeUndefined();
    expect(date("2026-02-30")).toBeUndefined();
    expect(date("2026-10-16 12:30:10.125")).toBe(
      Date.parse("2026-10-16T12:30:10.125Z"),
    );
  });
});
