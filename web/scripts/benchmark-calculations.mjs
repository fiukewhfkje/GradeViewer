// Synthetic CPU benchmark: no network, browser state or provider credentials.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const samples = Number(option("--samples", "9"));
if (!Number.isInteger(samples) || samples < 3 || samples > 50)
  throw new Error("Use 3–50 samples.");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sourceFiles = [
  "src/core/calculator.ts",
  "src/core/progression.ts",
  "src/core/periods.ts",
  "src/core/model.ts",
  "src/core/reconcile.ts",
];
const implementation = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (path) => [path, digest(await readFile(path))]),
  ),
);
const harness = digest(await readFile("scripts/benchmark-calculations.mjs"));
const built = await build({
  stdin: {
    contents:
      "export {calculate,hypothetical} from './src/core/calculator'; export {recentProgression,gradeCurve} from './src/core/progression'; export {percentText,pointsText} from './src/core/model';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  calculate,
  hypothetical,
  recentProgression,
  gradeCurve,
  percentText,
  pointsText,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64")
);
const now = Date.parse("2026-11-12T12:00:00Z");
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function fixture(count, method) {
  const course = {
    id: "synthetic-quarter",
    title: "Synthetic benchmark course",
    teacher: "",
    term: {
      id: "q1",
      name: "Quarter 1",
      start: now - 90 * 86400000,
      end: now + 86400000,
    },
    method,
    categories: [
      {
        id: "a",
        name: "A",
        method: "points",
        weight: 60,
        dropLowest: 0,
        excluded: false,
      },
      {
        id: "b",
        name: "B",
        method: "points",
        weight: 40,
        dropLowest: 0,
        excluded: false,
      },
    ],
    assignments: Array.from({ length: count }, (_, i) => {
      const possible =
        method !== "percent" && i % 29 === 0 ? 0 : i % 3 === 0 ? 100 : 20;
      return {
        id: String(i),
        title: "Synthetic assignment",
        categoryID: i % 2 ? "a" : "b",
        updated: now - (count - i) * 3600000,
        score: {
          earned:
            possible === 0
              ? 1.25
              : i % 37 === 0
                ? -2
                : (possible * (60 + (i % 31))) / 100,
          possible,
          excused: i % 43 === 0,
        },
        multiplier: 1 + (i % 3) * 0.25,
        excluded: i % 47 === 0,
        fields: {},
      };
    }),
    grade: {},
    fetched: now,
    fields: { section_id: "synthetic" },
    history: [],
    hidden: false,
    order: 0,
    removed: [],
  };
  course.grade.percent = calculate(course);
  return freeze(course);
}
const results = [];
for (const method of ["points", "percent", "weightedCategories"]) {
  for (const count of [100, 500, 1500]) {
    const course = fixture(count, method),
      all = freeze([course]);
    const scenario = freeze({ scores: { 1: 19.5 }, ignored: ["2"], added: [] });
    const formatList = () =>
      course.assignments.map(
        (a, i) =>
          `${pointsText(a.score.earned)}/${pointsText(a.score.possible)} ${percentText((a.score.earned / Math.max(1, a.score.possible)) * 100, i % 3)}`,
      );
    const outputs = {
      calculate: calculate(course),
      hypothetical: hypothetical(course, scenario),
      curve: gradeCurve(recentProgression(course, all, now)),
      formatted: formatList(),
    };
    const outputDigest = digest(JSON.stringify(outputs));
    for (const [operation, iterations, run] of [
      ["calculate", 20, () => calculate(course)],
      ["hypothetical", 20, () => hypothetical(course, scenario)],
      [
        "course-graph",
        1,
        () => gradeCurve(recentProgression(course, all, now)),
      ],
      ["assignment-formatting", 1, formatList],
    ]) {
      const values = [];
      for (let sample = 0; sample <= samples; sample++) {
        const started = performance.now();
        for (let i = 0; i < iterations; i++) run();
        if (sample) values.push((performance.now() - started) / iterations);
      }
      const ordered = [...values].sort((a, b) => a - b);
      results.push({
        method,
        assignments: count,
        operation,
        samplesMs: values,
        p50Ms: ordered[Math.floor(ordered.length / 2)],
        p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
        outputDigest,
      });
    }
    console.log(
      `${method} ${count}: graph ${results.at(-2).p50Ms.toFixed(2)} ms; formatting ${results.at(-1).p50Ms.toFixed(2)} ms`,
    );
  }
}
const report = {
  schema: 1,
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  recordedAt: new Date().toISOString(),
  node: process.version,
  conditions: {
    samples,
    warmups: 1,
    counts: [100, 500, 1500],
    frozenInputs: true,
  },
  harness,
  implementation,
  results,
};
const compare = option("--compare");
if (compare) {
  const before = JSON.parse(await readFile(compare, "utf8"));
  if (
    before.harness !== harness ||
    JSON.stringify(before.conditions) !== JSON.stringify(report.conditions)
  )
    throw new Error("Benchmark conditions differ");
  for (const result of results) {
    const prior = before.results.find(
      (x) =>
        x.method === result.method &&
        x.assignments === result.assignments &&
        x.operation === result.operation,
    );
    if (!prior || prior.outputDigest !== result.outputDigest)
      throw new Error("Calculation output changed");
  }
}
const output = option(
  "--output",
  ".local-test/calculation-benchmark/latest.json",
);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(`Saved ${output}; all inputs deeply frozen.`);
