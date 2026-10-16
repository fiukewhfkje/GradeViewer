// Synthetic Swift reference output only. Never load a native app/user archive.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
const compiled = await build({
  stdin: {
    contents: "export * from './src/core/calculator';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { calculate, hypothetical, reliable, requiredFinal } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
const rows = JSON.parse(
  await readFile(process.argv[2] ?? ".local-test/native-parity.json", "utf8"),
);
const assignment = (a) => ({
  ...a,
  id: a.source.provider + ":" + a.source.id,
  fields: a.source.fields,
  score: a.score,
});
const result = (run) => {
  try {
    return { value: run() };
  } catch (e) {
    return { error: e.code };
  }
};
function equal(actual, expected, context) {
  if (actual == null || expected == null)
    assert.equal(actual ?? null, expected ?? null, context);
  else assert.ok(Math.abs(actual - expected) <= 1e-8, context);
}
rows.forEach((row, index) => {
  const course = {
    ...row.course,
    id: row.course.source.provider + ":" + row.course.source.id,
    fields: row.course.source.fields,
    assignments: row.course.assignments.map(assignment),
  };
  const scenario = {
    ...row.hypothesis,
    added: row.hypothesis.added.map(assignment),
  };
  for (const [name, run, value, error] of [
    ["baseline", () => calculate(course), row.baseline, row.baselineError],
    [
      "scenario",
      () => calculate(course, scenario),
      row.scenario,
      row.scenarioError,
    ],
    [
      "final",
      () => requiredFinal(row.current, row.target, row.weight),
      row.required,
      row.finalError,
    ],
  ]) {
    const actual = result(run);
    assert.equal(actual.error, error, `Synthetic case ${index} ${name}: error`);
    equal(actual.value, value, `Synthetic case ${index} ${name}: result`);
  }
  assert.equal(
    reliable(course),
    row.reliable,
    `Synthetic case ${index}: reliability`,
  );
  equal(
    hypothetical(course, scenario),
    row.hypothetical,
    `Synthetic case ${index}: hypothesis`,
  );
});
assert.equal(rows.length, 1200);
console.log(
  "PASS 1,200 synthetic Swift/JavaScript calculation, scenario, reliability and final-calculator comparisons.",
);
