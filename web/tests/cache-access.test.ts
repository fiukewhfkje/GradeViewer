import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { demoCourses } from "../src/core/demo";
import * as repository from "../src/repository";
const state = {
  schema: 1 as const,
  account: "synthetic-owner",
  courses: demoCourses(),
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
  }
});
