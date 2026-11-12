import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { syntheticCourses } from "./schoology-fixture";
import * as repository from "../src/repository";
import { workspaceCourses } from "../src/core/visibility";
import { physicalKey } from "../src/core/periods";
import { estimateGpa, gpaSemesters } from "../src/core/gpa";
import { synchronizeVisibility } from "../src/course-visibility";
const state = {
  schema: 1 as const,
  account: "synthetic-owner",
  courses: syntheticCourses(),
  scenarios: {},
};
afterEach(async () => {
  await repository.clear();
  vi.unstubAllGlobals();
});
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
it("merges only remote visibility into the latest local snapshot and ignores older revisions and stale student replies", async () => {
  const saved = {
    ...structuredClone(state),
    scenarios: { synthetic: { scores: { a: 17.25 }, added: [], ignored: [] } },
  };
  await repository.save(saved);
  const remote = {
    account: "student",
    scope: "original-connection",
    revision: 2,
    hidden: ["course-a"],
  };
  const merged = (await repository.mergeVisibility(state.account, remote))!;
  expect(merged.courses).toEqual(saved.courses);
  expect(merged.scenarios).toEqual(saved.scenarios);
  expect(
    (await repository.mergeVisibility(
      state.account,
      { ...remote, revision: 1, hidden: [] },
      "original-connection",
    ))!.hiddenSchoology,
  ).toEqual(["course-a"]);
  expect(
    await repository.mergeVisibility("other-owner", remote),
  ).toBeUndefined();
  expect(
    (
      await repository.save({
        ...saved,
        ...merged,
        schoologyVisibility: { ...merged.schoologyVisibility!, revision: 1 },
        hiddenSchoology: [],
      })
    ).hiddenSchoology,
  ).toEqual(["course-a"]);
  await repository.mergeVisibility(
    state.account,
    {
      account: "student",
      scope: "new-connection",
      revision: 1,
      hidden: [],
    },
    "original-connection",
  );
  expect(
    await repository.mergeVisibility(
      state.account,
      remote,
      "original-connection",
    ),
  ).toBeUndefined();
  expect((await repository.load()).hiddenSchoology).toEqual([]);
});
it("imports legacy browser choices once, accepts the server's protected restores and retains local data after failed or malformed sync", async () => {
  const saved = {
    ...structuredClone(state),
    hiddenSchoology: ["course-a", "course-b"],
    courses: state.courses.slice(0, 2).map((course, i) => ({
      ...course,
      fields: {
        ...course.fields,
        user_id: "student",
        physical_key: i ? "course-b" : "course-a",
      },
    })),
  };
  await repository.save(saved, { clearVisibility: true });
  const remote = {
    account: "student",
    scope: "original-connection",
    revision: 4,
    hidden: ["course-z"],
  };
  const status = {
    authenticated: true,
    connected: true,
    account: state.account,
    schoologyVisibility: remote,
  };
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(init.body as string)).toEqual({
      account: "student",
      scope: "original-connection",
      import: saved.hiddenSchoology,
    });
    return Response.json({
      ...remote,
      revision: 5,
      hidden: ["course-b", "course-z"],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const synced = await synchronizeVisibility(saved, status);
  expect(synced.hiddenSchoology).toEqual(["course-b", "course-z"]);
  expect(synced.courses).toEqual(saved.courses);
  await synchronizeVisibility(synced, status);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    synchronizeVisibility(synced, {
      ...status,
      schoologyVisibility: { ...remote, hidden: null as any },
    }),
  ).rejects.toThrow("malformed");
  await repository.save(saved, { clearVisibility: true });
  fetcher.mockRejectedValueOnce(new Error("offline"));
  await expect(synchronizeVisibility(saved, status)).rejects.toThrow();
  expect(await repository.load()).toEqual(saved);
});
