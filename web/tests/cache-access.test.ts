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
