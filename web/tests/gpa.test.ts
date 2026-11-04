import { describe, expect, it } from "vitest";
import { estimateGpa, gpaSemesters, suggestLevel } from "../src/core/gpa";
import { demoCourses } from "../src/core/demo";
import type { Course, Grade } from "../src/core/model";

const now = Date.parse("2026-11-03T12:00:00Z");
const sample = demoCourses(now).find((c) => c.term.name === "Semester 1")!;
const semester = (
  id: string,
  title: string,
  grade: Grade,
  extra: Partial<Course> = {},
): Course => ({
  ...sample,
  id: id + ":semester",
  title,
  grade,
  fields: { grade_section_id: id },
  ...extra,
});
const estimate = (courses: Course[]) => {
  const term = gpaSemesters(courses, now)[0];
  return {
    term,
    ...estimateGpa(courses, term, { weighting: "equal", courses: {} }),
  };
};

describe("Dublin semester GPA", () => {
  it("uses published plus/minus points, with no bonus at D+ or below", () => {
    const courses = [
      semester("1", "AP Literature", { letter: "A" }),
      semester("2", "Honors Geometry", { percent: 92.99 }),
      semester("3", "Regular Science", { percent: 87 }),
      semester("4", "AP History", { letter: "D+" }),
      semester("5", "AP Physics", { percent: 0 }),
    ];
    const result = estimate(courses);
    expect(result.weighted).toBeCloseTo((5 + 4.17 + 3.33 + 1.33) / 5);
    expect(result.unweighted).toBeCloseTo((4 + 3.67 + 3.33 + 1.33) / 5);
    expect(result.incomplete).toBe(0);
  });

  it("keeps one contribution per section, scopes by semester and explains omitted grades", () => {
    const valid = semester(
      "1",
      "A course",
      { percent: 93, letter: "B" },
      { hidden: true },
    );
    const quarter = {
      ...valid,
      id: "q",
      term: {
        id: "q1",
        name: "Quarter 1",
        start: sample.term.start,
        end: Date.parse("2026-10-15"),
      },
    };
    const ambiguous = semester("2", "Ambiguous", { letter: "A" });
    const older = semester(
      "6",
      "Old grade",
      { letter: "F" },
      {
        term: {
          ...sample.term,
          start: Date.parse("2025-08-15"),
          end: Date.parse("2025-12-20"),
        },
      },
    );
    const result = estimate([
      valid,
      quarter,
      older,
      ambiguous,
      { ...ambiguous, id: "duplicate" },
      semester("3", "Pass/fail", { letter: "S" }),
      semester("4", "No grade", {}),
      { ...quarter, id: "only-quarter", fields: { grade_section_id: "5" } },
      { ...valid, id: "exam", term: { ...sample.term, name: "Exam" } },
      { ...valid, id: "year", term: { ...sample.term, name: "Full Year" } },
    ]);
    expect(result.rows).toHaveLength(5);
    expect(result.weighted).toBe(3);
    expect(result.incomplete).toBe(3);
    expect(
      result.rows.find((row) => row.title === valid.title && row.conflict)
        ?.grade,
    ).toBe("B");
    expect(result.rows.map((row) => row.reason)).toEqual(
      expect.arrayContaining([
        "Multiple semester grades",
        "Non-GPA grade",
        "No usable grade",
        "No semester grade",
      ]),
    );
  });

  it("supports unequal semester credits, level overrides and explicit exclusions", () => {
    const courses = [
      semester("1", "AP 1", { letter: "A" }),
      semester("2", "Regular 2", { letter: "C" }),
      semester("3", "Regular 3", { letter: "B" }),
      semester("4", "Regular 4", { letter: "A" }),
    ];
    const { term, rows } = estimate(courses);
    const settings = {
      weighting: "credits" as const,
      courses: {
        [rows[0].key]: { credits: 0.5, level: "regular" as const },
        [rows[1].key]: { credits: 1.5, level: "advanced" as const },
        [rows[2].key]: { excluded: true },
      },
    };
    const result = estimateGpa(courses, term, settings);
    expect(result.weighted).toBe(3.25);
    expect(result.unweighted).toBe(2.5);
    expect(result.incomplete).toBe(1);
    expect(
      estimateGpa(courses, term, { weighting: "credits", courses: {} })
        .weighted,
    ).toBeUndefined();
  });

  it("projects selected letters without changing the semester grades or course settings", () => {
    const courses = [
      semester("1", "AP Science", { percent: 95 }),
      semester("2", "Literature", {}),
      semester("3", "Non-credit", { letter: "P" }),
      semester("4", "Studio", { letter: "B" }),
    ];
    const { term, rows } = estimate(courses);
    const key = (title: string) => rows.find((row) => row.title === title)!.key;
    const settings = {
      weighting: "credits" as const,
      courses: {
        [key("AP Science")]: { credits: 1 },
        [key("Literature")]: { credits: 2 },
        [key("Non-credit")]: { credits: 1 },
        [key("Studio")]: { credits: 1, excluded: true },
      },
    };
    const original = structuredClone({ courses, settings });
    const result = estimateGpa(courses, term, settings, {
      [key("AP Science")]: "B+",
      [key("Literature")]: "A",
      [key("Non-credit")]: "A",
      [key("Studio")]: "A",
    });
    expect(result.weighted).toBeCloseTo((4.33 + 8) / 3);
    expect(result.unweighted).toBeCloseTo((3.33 + 8) / 3);
    expect(result.incomplete).toBe(0);
    expect(
      result.rows.find((row) => row.title === "AP Science")?.conflict,
    ).toBe(false);
    expect({ courses, settings }).toEqual(original);
    expect(estimateGpa(courses, term, settings).weighted).toBe(5);
  });

  it("suggests levels without awarding AP weight for Pre-AP or a substring", () => {
    expect(
      [
        "AP Capstone",
        "IB Biology",
        "Advanced Placement Art",
        "Honours English",
        "Pre-AP Biology",
        "Applied Math",
        "Capstone",
        "CCP Financial Literacy",
      ].map(suggestLevel),
    ).toEqual([
      "advanced",
      "advanced",
      "advanced",
      "honors",
      "regular",
      "regular",
      "regular",
      "regular",
    ]);
  });
});
