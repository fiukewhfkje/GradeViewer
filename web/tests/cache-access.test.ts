import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { syntheticCourses } from "./schoology-fixture";
import * as repository from "../src/repository";
import { workspaceCourses } from "../src/core/visibility";
import { physicalKey } from "../src/core/periods";
import { estimateGpa, gpaSemesters } from "../src/core/gpa";
const state = {
  schema: 1 as const,
  account: "synthetic-owner",
  courses: syntheticCourses(),
  scenarios: {},
};
afterEach(() => repository.clear());
it("allows immediate local reads only for a matching, previously unlocked, unexpired browser", () => {
  const receipt = { locked: false, account: state.account, expires: 200 };
  expect(repository.canReadCache(state, receipt, 100)).toBe(true);
  expect(repository.canReadCache(state, receipt, 201)).toBe(false);
  expect(
    repository.canReadCache(state, { ...receipt, locked: true }, 100),
  ).toBe(false);
  expect(
    repository.canReadCache(state, { ...receipt, account: "other" }, 100),
  ).toBe(false);
  expect(repository.canReadCache(state, undefined, 100)).toBe(false);
});
it("an explicit local lock survives stale in-flight verification and requires a new unlock", async () => {
  const expiry = Date.now() + 60_000;
  await repository.rememberAccess(state.account, expiry);
  expect(repository.canReadCache(state, await repository.access())).toBe(true);
  await repository.lock();
  await repository.rememberAccess(state.account, expiry);
  expect(repository.canReadCache(state, await repository.access())).toBe(false);
  await repository.unlock();
  expect(repository.canReadCache(state, await repository.access())).toBe(false);
  await repository.rememberAccess(state.account, expiry);
  expect(repository.canReadCache(state, await repository.access())).toBe(true);
});
it("removes legacy blank placeholders and restores hidden classes before cached startup or recovery", async () => {
  const previous = structuredClone(state);
  previous.courses[0].hidden = true;
  const placeholder = {
    ...structuredClone(previous.courses[0]),
    id: "schoology:blank:ungraded",
    fields: { section_id: "blank", metadata_only: "true" },
    grade: {},
    history: [],
    hidden: false,
  };
  previous.courses.push(placeholder);
  const edits = { scores: { synthetic: 95 }, added: [], ignored: [] };
  const saved = {
    ...previous,
    hiddenSchoology: [physicalKey(previous.courses[0])],
    scenarios: { [previous.courses[0].id]: edits },
    gpa: {
      weighting: "equal" as const,
      courses: { synthetic: { excluded: true } },
    },
  };
  await repository.save(saved);
  await repository.prepare({
    state: saved,
    account: saved.account,
    scan: "synthetic",
  });
  for (const restored of [
    await repository.load(),
    (await repository.pending())!.state,
  ]) {
    expect(restored.courses).toHaveLength(state.courses.length);
    expect(
      restored.courses.some(
        (c) => c.hidden || c.fields.metadata_only === "true",
      ),
    ).toBe(false);
    expect(restored.courses[0].grade).toEqual(previous.courses[0].grade);
    expect(restored.courses[0].history).toEqual(previous.courses[0].history);
    expect(restored.scenarios).toEqual(saved.scenarios);
    expect(restored.gpa).toEqual(saved.gpa);
    expect(restored.hiddenSchoology).toEqual(saved.hiddenSchoology);
  }
});
it("hides every Schoology scope locally while keeping IC, Carmen and same-title sections independent", () => {
  const course = state.courses.find((c) => c.term.name === "Semester 1")!;
  const campus = {
    ...course,
    id: "campus:replacement",
    fields: {
      ...course.fields,
      provider: "campus",
      physical_key: "campus:replacement",
    },
  };
  const unrelated = {
    ...course,
    id: "different-schoology-section",
    fields: { ...course.fields, physical_key: "different-schoology-section" },
  };
  const carmen = {
    ...course,
    id: "carmen:independent",
    fields: {
      ...course.fields,
      provider: "carmen",
      physical_key: "carmen:independent",
    },
  };
  const saved = {
    ...state,
    courses: [...state.courses, campus, unrelated, carmen],
    hiddenSchoology: [physicalKey(course)],
  };
  const before = structuredClone(saved);
  const visible = workspaceCourses(saved);
  expect(visible.filter((c) => physicalKey(c) === physicalKey(course))).toEqual(
    [],
  );
  expect(visible).toContain(campus);
  expect(visible).toContain(unrelated);
  expect(visible).not.toContain(carmen);
  const term = gpaSemesters(visible)[0];
  const gpa = estimateGpa(visible, term, { weighting: "equal", courses: {} });
  expect(
    gpa.rows.some((r) => JSON.parse(r.key)[1] === physicalKey(course)),
  ).toBe(false);
  expect(
    gpa.rows.some((r) => JSON.parse(r.key)[1] === physicalKey(campus)),
  ).toBe(true);
  expect(workspaceCourses({ ...saved, primaryLms: "carmen" })).toEqual([
    carmen,
  ]);
  expect(workspaceCourses({ ...saved, hiddenSchoology: [] })).toContain(course);
  expect(saved).toEqual(before);
});
