import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FixtureVault } from "./fixture-worker";
import type { Env } from "../worker/index";
import { api, type Status } from "../src/api";
import { beginRefresh, readSnapshot } from "../src/refresh";
import { refreshCampus } from "../src/portal-refresh";
import { emptyState, type SavedState } from "../src/core/model";
import { browserJar } from "../worker/portal";
import { hash, seal } from "../worker/crypto";
import {
  campusPortal,
  campusState,
  campusSummary,
  campusDetail,
} from "./campus-fixture";
import * as repository from "../src/repository";

const password = "synthetic-combined-refresh-password";
describe("verified combined refresh", () => {
  let values: Map<string, unknown>, previous: SavedState;
  let calls: string[], appCalls: string[], active: number, peak: number;
  let failSchoology: number,
    failCampus: number,
    malformedCampus: boolean,
    emptyCampus: boolean,
    redirects: boolean,
    legacy: boolean;
  let cookie: string, vault: FixtureVault;
  let dropResponse: boolean;
  let rootRateLimits: boolean | "reverse",
    itemRateLimit: boolean,
    throttled: boolean,
    readsAfterThrottle: number;
  beforeEach(async () => {
    await repository.clear();
    values = new Map();
    calls = [];
    appCalls = [];
    active = peak = 0;
    failSchoology = failCampus = 0;
    malformedCampus = emptyCampus = redirects = legacy = false;
    cookie = "";
    dropResponse = false;
    rootRateLimits = itemRateLimit = throttled = false;
    readsAfterThrottle = 0;
    const storage = {
      get: async (key: string) => structuredClone(values.get(key)),
      put: async (key: string, value: unknown) => {
        values.set(key, structuredClone(value));
      },
      delete: async (key: string) => values.delete(key),
      getAlarm: async () => undefined,
      setAlarm: async () => {},
    } as unknown as DurableObjectStorage;
    class RecordingVault extends FixtureVault {
      constructor() {
        super(
          { storage } as unknown as DurableObjectState,
          { APP_PASSWORD: password } as Env,
        );
        const fixture = this.upstream;
        this.upstream = async (request) => {
          const url = new URL(request.url);
          if (url.hostname === "api.schoology.com" && throttled)
            readsAfterThrottle++;
          calls.push(
            url.hostname === "api.schoology.com" ? "schoology" : "campus",
          );
          active++;
          peak = Math.max(peak, active);
          try {
            await new Promise((resolve) => setTimeout(resolve, 2));
            if (url.hostname === "fixture.infinitecampus.org") {
              if (failCampus)
                return new Response(null, {
                  status: failCampus,
                  headers: { "Retry-After": "120" },
                });
              if (url.pathname.endsWith("/roster"))
                return Response.json({ personID: "101" });
              if (url.pathname.endsWith("/grades"))
                return Response.json(
                  emptyCampus ? [] : malformedCampus ? {} : campusSummary,
                );
              return Response.json(campusDetail);
            }
            if (failSchoology)
              return new Response(null, {
                status: failSchoology,
                headers: { "Retry-After": "120" },
              });
            if (rootRateLimits && /\/(sections|grades)$/.test(url.pathname))
              return new Response(null, {
                status: 429,
                headers: {
                  "Retry-After": url.pathname.endsWith(
                    rootRateLimits === "reverse" ? "/grades" : "/sections",
                  )
                    ? "120"
                    : "1",
                },
              });
            if (itemRateLimit && url.pathname.endsWith("/grade_items")) {
              throttled = true;
              return new Response(null, {
                status: 429,
                headers: { "Retry-After": "120" },
              });
            }
            if (redirects && Number(url.searchParams.get("offset") ?? 0) < 3) {
              url.searchParams.set(
                "offset",
                String(Number(url.searchParams.get("offset") ?? 0) + 1),
              );
              return new Response(null, {
                status: 302,
                headers: { Location: url.href },
              });
            }
            return await fixture(request);
          } finally {
            active--;
          }
        };
      }
    }
    vault = new RecordingVault();
    vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
      appCalls.push(path);
      if (legacy && path === "/api/refresh/start")
        return Response.json({ error: "notFound" }, { status: 404 });
      const headers = new Headers(init.headers);
      headers.set("Origin", "https://app.test");
      headers.set("Cookie", cookie);
      const response = await vault.fetch(
        new Request("https://app.test" + path, { ...init, headers }),
      );
      if (dropResponse && path === "/api/refresh/start")
        throw new TypeError("synthetic link loss after provider reads");
      const next = response.headers.get("Set-Cookie");
      if (next) cookie = next.split(";")[0];
      return response;
    });
    await api("login", { password });
    previous = await readSnapshot(emptyState(), await api<Status>("status"), {
      key: "fixture",
      secret: "fixture-secret",
    });
    const account = (
      await hash(new URL(campusPortal).origin + "\0" + "101")
    ).replace(/[^a-zA-Z0-9]/g, "");
    await storage.put(
      "portal-campus",
      await seal(
        {
          browserMs: 0,
          connection: {
            portal: campusPortal,
            account,
            selected: ["1:100"],
            jar: browserJar(
              campusState,
              new URL(campusPortal).origin,
            ).serializeSync(),
          },
        },
        password,
      ),
    );
    previous = await refreshCampus(previous, {
      connected: true,
      needsReconnect: false,
      selected: ["1:100"],
    });
    calls = [];
    appCalls = [];
    peak = 0;
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await repository.clear();
  });
  it("returns fresh Schoology and IC in two app requests with unchanged provider counts and a global five-read cap", async () => {
    const start = await beginRefresh(previous, true);
    expect(start.schoology?.ok).toBe(true);
    expect(start.campus?.ok).toBe(true);
    const schoology = await readSnapshot(
      previous,
      start.status,
      undefined,
      true,
      start.schoology,
    );
    const next = await refreshCampus(
      schoology,
      start.status.portals?.campus,
      "campus",
      start.campus,
    );
    expect(appCalls).toEqual(["/api/refresh/start", "/api/scan/commit"]);
    expect(calls.filter((x) => x === "schoology")).toHaveLength(23);
    expect(calls.filter((x) => x === "campus")).toHaveLength(3);
    expect(peak).toBeLessThanOrEqual(5);
    expect(next.courses.map((c) => [c.id, c.grade])).toEqual(
      previous.courses.map((c) => [c.id, c.grade]),
    );
    expect((await repository.load()).courses).toEqual(next.courses);
  });
  it("refreshes IC alone with no Schoology scan or additional snapshot request", async () => {
    const start = await beginRefresh(previous, true, "campus");
    await refreshCampus(
      previous,
      start.status.portals?.campus,
      "campus",
      start.campus,
    );
    expect(appCalls).toEqual(["/api/refresh/start"]);
    expect(calls).toEqual(["campus", "campus", "campus"]);
  });
  it("keeps IC-only actions independent of unrelated malformed Schoology cache keys", async () => {
    const changed = structuredClone(previous);
    changed.metadata = {
      "bad/id": changed.metadata![Object.keys(changed.metadata!)[0]],
    };
    const start = await beginRefresh(changed, true, "campus");
    expect(start.campus?.ok).toBe(true);
    expect(calls).toEqual(["campus", "campus", "campus"]);
  });
  it("does not duplicate provider work when the combined response is lost", async () => {
    dropResponse = true;
    await expect(beginRefresh(previous, true)).rejects.toMatchObject({
      code: "networkUnavailable",
    });
    expect(appCalls).toEqual(["/api/refresh/start"]);
    expect(calls.filter((x) => x === "schoology")).toHaveLength(23);
    expect(calls.filter((x) => x === "campus")).toHaveLength(3);
    expect((await repository.load()).courses).toEqual(previous.courses);
  });
  it("retains a Schoology 429 cooldown while IC succeeds, without retrying Schoology", async () => {
    failSchoology = 429;
    const start = await beginRefresh(previous, true);
    await expect(
      readSnapshot(previous, start.status, undefined, true, start.schoology),
    ).rejects.toMatchObject({ code: "rateLimited", retryAfter: 120 });
    const next = await refreshCampus(
      previous,
      start.status.portals?.campus,
      "campus",
      start.campus,
    );
    expect(next.courses.some((c) => c.fields.provider === "campus")).toBe(true);
    expect(start.status.cooldown).toBeGreaterThan(Date.now() + 119000);
    await beginRefresh(next, true);
    expect(calls.filter((x) => x === "schoology")).toHaveLength(1);
  });
  it.each([true, "reverse"] as const)(
    "keeps the longest Schoology root cooldown (%s) instead of replacing it with a shorter peer delay",
    async (order) => {
      rootRateLimits = order;
      const start = await beginRefresh(previous, true, "schoology-only");
      expect(start.status.cooldown).toBeGreaterThan(Date.now() + 119000);
      if (start.schoology?.ok !== false)
        throw new Error("Expected synthetic cooldown");
      expect(start.schoology.retryAfter).toBeGreaterThanOrEqual(119);
      expect(calls).toHaveLength(3);
    },
  );
  it("stops queued Schoology HTTP work as soon as a 429 arrives while allowing IC to finish", async () => {
    itemRateLimit = true;
    const start = await beginRefresh(previous, true);
    await expect(
      readSnapshot(previous, start.status, undefined, true, start.schoology),
    ).rejects.toMatchObject({ code: "rateLimited" });
    expect(readsAfterThrottle).toBe(0);
    expect(start.campus?.ok).toBe(true);
    expect((await repository.load()).courses).toEqual(previous.courses);
  });
  it.each([429, 401, 503])(
    "keeps saved IC on %s while committing Schoology, without an inline IC retry",
    async (status) => {
      failCampus = status;
      const start = await beginRefresh(previous, true);
      const next = await readSnapshot(
        previous,
        start.status,
        undefined,
        true,
        start.schoology,
      );
      await expect(
        refreshCampus(
          next,
          start.status.portals?.campus,
          "campus",
          start.campus,
        ),
      ).rejects.toBeInstanceOf(Error);
      expect(calls.filter((x) => x === "campus")).toHaveLength(1);
      expect(
        (await repository.load()).courses.filter(
          (c) => c.fields.provider === "campus",
        ),
      ).toEqual(previous.courses.filter((c) => c.fields.provider === "campus"));
      expect(appCalls.filter((x) => x === "/api/campus/snapshot")).toHaveLength(
        0,
      );
    },
  );
  it("distinguishes malformed IC from verified empty data", async () => {
    malformedCampus = true;
    let start = await beginRefresh(previous, true, "campus");
    await expect(
      refreshCampus(
        previous,
        start.status.portals?.campus,
        "campus",
        start.campus,
      ),
    ).rejects.toBeInstanceOf(Error);
    expect((await repository.load()).courses).toEqual(previous.courses);
    malformedCampus = false;
    emptyCampus = true;
    start = await beginRefresh(previous, true, "campus");
    const next = await refreshCampus(
      previous,
      start.status.portals?.campus,
      "campus",
      start.campus,
    );
    expect(next.courses.filter((c) => c.fields.provider === "campus")).toEqual(
      [],
    );
    expect(
      next.courses.filter(
        (c) => !c.fields.provider || c.fields.provider === "schoology",
      ),
    ).toHaveLength(
      previous.courses.filter((c) => c.fields.provider !== "campus").length,
    );
  });
  it("validates both providers before reading and refuses an account mismatch", async () => {
    for (const body of [
      { provider: "invalid" },
      { provider: "schoology", reuse: ["100", "100"] },
      { provider: "schoology", key: "untrusted" },
    ])
      await expect(api("refresh/start", body)).rejects.toMatchObject({
        status: 400,
      });
    const mismatched = await beginRefresh(
      { ...previous, account: "another-account" },
      true,
    );
    expect(mismatched.schoology).toBeUndefined();
    expect(mismatched.campus).toBeUndefined();
    expect(calls).toEqual([]);
    cookie = "";
    const locked = await beginRefresh(previous, true);
    expect(locked.status.authenticated).toBe(false);
    expect(locked.status.portals).toBeUndefined();
    expect(calls).toEqual([]);
  });
  it("reserves the IC allowance within the shared 44-subrequest budget and completes deferred Schoology reads", async () => {
    redirects = true;
    const start = await beginRefresh(previous, true);
    expect(calls).toHaveLength(44);
    expect(start.campus?.ok).toBe(true);
    const next = await readSnapshot(
      previous,
      start.status,
      undefined,
      true,
      start.schoology,
    );
    expect(next.courses.map((c) => c.id)).toEqual(
      previous.courses.map((c) => c.id),
    );
    expect(peak).toBeLessThanOrEqual(5);
  });
  it("rebases local changes made while the combined reads were in flight", async () => {
    const running = beginRefresh(previous, true);
    const updated = structuredClone(previous);
    updated.scenarios[updated.courses[0].id] = {
      scores: {},
      ignored: ["synthetic-local-edit"],
      added: [],
    };
    await repository.save(updated);
    const start = await running;
    let next = await readSnapshot(
      previous,
      start.status,
      undefined,
      true,
      start.schoology,
    );
    next = await refreshCampus(
      next,
      start.status.portals?.campus,
      "campus",
      start.campus,
    );
    expect(next.scenarios).toEqual(updated.scenarios);
  });
  it("falls back only for an unsupported older Worker route", async () => {
    legacy = true;
    const start = await beginRefresh(previous, true);
    expect(start.schoology).toBeUndefined();
    expect(calls).toHaveLength(0);
    const next = await readSnapshot(previous, start.status, undefined, true);
    expect(next.courses.map((c) => c.id)).toEqual(
      previous.courses.map((c) => c.id),
    );
    expect(calls).toHaveLength(23);
  });
});
