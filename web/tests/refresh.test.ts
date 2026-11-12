import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { FixtureVault } from "./fixture-worker";
import type { Env } from "../worker/index";
import { readSnapshot } from "../src/refresh";
import { api, type Status } from "../src/api";
import { emptyState } from "../src/core/model";
import * as repository from "../src/repository";
import { visibleCourses } from "../src/core/periods";
describe("complete snapshot and cache integration", () => {
  let requests = 0,
    appRequests: string[] = [],
    legacyWorker = false,
    changedGrades = false,
    cookie = "",
    omitBulkOwner = false,
    slow = false,
    redirects = false,
    large = false,
    limited = false,
    limitSeconds = 30,
    active = 0,
    maximumActive = 0,
    batches: string[][] = [],
    metadataCompleted = 0,
    scalesAfterMetadata: number[] = [];
  let missingTitles = false,
    optionalTitleReads = 0;
  let cooldownDelivered: Promise<void>, resumeCooldownPeers: () => void;
  beforeEach(async () => {
    await repository.clear();
    requests = 0;
    appRequests = [];
    legacyWorker = changedGrades = false;
    cookie = "";
    omitBulkOwner = false;
    slow = limited = redirects = large = false;
    limitSeconds = 30;
    active = maximumActive = 0;
    batches = [];
    metadataCompleted = 0;
    scalesAfterMetadata = [];
    missingTitles = false;
    optionalTitleReads = 0;
    cooldownDelivered = new Promise((resolve) => {
      resumeCooldownPeers = resolve;
    });
    const data = new Map();
    class RecordingVault extends FixtureVault {
      constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        const original = this.upstream;
        this.upstream = async (req) => {
          requests++;
          const requestURL = new URL(req.url);
          if (/\/assignments(?:\/|$)|\/folder\//.test(requestURL.pathname))
            optionalTitleReads++;
          if (requestURL.pathname.endsWith("/grading_scales"))
            scalesAfterMetadata.push(metadataCompleted);
          if (
            redirects &&
            Number(requestURL.searchParams.get("offset") ?? 0) < 3
          ) {
            requestURL.searchParams.set(
              "offset",
              String(Number(requestURL.searchParams.get("offset") ?? 0) + 1),
            );
            return new Response(null, {
              status: 302,
              headers: { Location: requestURL.href },
            });
          }
          active++;
          maximumActive = Math.max(maximumActive, active);
          let response: Response;
          try {
            // Hold successful peers until the fixture's 429 has reached the
            // transport. Otherwise crypto/timer scheduling can legitimately
            // finish a peer and start another read before the cooldown arrives.
            if (
              limited &&
              /^\/v1\/sections\//.test(requestURL.pathname) &&
              !requestURL.pathname.endsWith("/grade_items")
            )
              await cooldownDelivered;
            if (slow) await new Promise((r) => setTimeout(r, 5));
            response =
              limited && new URL(req.url).pathname.endsWith("/grade_items")
                ? new Response("synthetic cooldown", {
                    status: 429,
                    headers: { "Retry-After": String(limitSeconds) },
                  })
                : await original(req);
            if (limited && response.status === 429)
              setTimeout(resumeCooldownPeers, 0);
          } finally {
            active--;
            if (
              /\/sections\/\d+(\/(grade_items|grading_categories|grading_periods))?$/.test(
                requestURL.pathname,
              )
            )
              metadataCompleted++;
          }
          const url = new URL(req.url);
          if (changedGrades && url.pathname.endsWith("/grades")) {
            const value = (await response.json()) as {
              section: Record<string, unknown>[];
            };
            return Response.json({
              ...value,
              section: value.section.map((row, i) =>
                i === 0 ? { ...row, syntheticRevision: 2 } : row,
              ),
            });
          }
          if (missingTitles && url.pathname.endsWith("/grade_items")) {
            const value = (await response.json()) as {
              assignment: Record<string, unknown>[];
            };
            return Response.json({
              assignment: value.assignment.map(({ title, ...item }) => item),
            });
          }
          if (large && /^\/v1\/sections\/\d+$/.test(url.pathname))
            return Response.json({
              ...((await response.json()) as Record<string, unknown>),
              syntheticPadding: "x".repeat(1000000),
            });
          if (
            omitBulkOwner &&
            url.pathname.endsWith("/grades") &&
            !url.searchParams.has("section_id")
          ) {
            const data = (await response.json()) as { section: unknown[] };
            return Response.json({ ...data, section: data.section.slice(1) });
          }
          return response;
        };
      }
    }
    const vault = new RecordingVault(
      {
        storage: {
          get: async (k: string) => structuredClone(data.get(k)),
          put: async (k: string, v: unknown) => data.set(k, structuredClone(v)),
        },
      } as unknown as DurableObjectState,
      { APP_PASSWORD: "synthetic-owner-password-for-tests-only" } as Env,
    );
    vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
      appRequests.push(path);
      if (legacyWorker && path === "/api/scan/start") {
        const { reuse, prefetch, prefetchMetadata, ...body } = JSON.parse(
          String(init.body),
        );
        init = { ...init, body: JSON.stringify(body) };
      }
      if (path === "/api/scan/read-batch")
        batches.push(
          JSON.parse(String(init.body)).jobs.map(
            (j: { resource: string }) => j.resource,
          ),
        );
      const headers = new Headers(init.headers);
      headers.set("Cookie", cookie);
      headers.set("Origin", "https://app.test");
      const r = await vault.fetch(
        new Request("https://app.test" + path, { ...init, headers }),
      );
      const next = r.headers.get("Set-Cookie");
      if (next) cookie = next.split(";")[0];
      if (path === "/api/scan/start" && r.ok) {
        const start = (await r.clone().json()) as {
          prefetched?: { jobs: { resource: string }[] };
        };
        if (start.prefetched)
          batches.push(start.prefetched.jobs.map((job) => job.resource));
      }
      return r;
    });
    await api("login", { password: "synthetic-owner-password-for-tests-only" });
  });
  afterEach(() => vi.unstubAllGlobals());
  const status = () => api<Status>("status");
  it("bounds hosted batches to five provider reads and validates every job before any read", async () => {
    slow = true;
    await readSnapshot(emptyState(), await status(), {
      key: "fixture",
      secret: "fixture-secret",
    });
    expect(maximumActive).toBe(5);
    const { scan } = await api<{ scan: string }>("scan/start", {});
    await api("scan/read", { scan, resource: "sections" });
    const count = requests;
    for (const jobs of [
      [],
      Array.from({ length: 33 }, () => ({ resource: "items", section: "100" })),
      [
        { resource: "items", section: "100" },
        { resource: "items", section: "999" },
      ],
      [
        { resource: "items", section: "100" },
        { resource: "items", section: "100" },
      ],
    ]) {
      await expect(
        api("scan/read-batch", { scan, jobs }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(requests).toBe(count);
    await api("scan/cancel", { scan });
  });
  it("bounds all redirect subrequests and defers excess work to a new invocation", async () => {
    const { scan } = await api<{ scan: string }>("scan/start", {
      key: "fixture",
      secret: "fixture-secret",
    });
    await api("scan/read", { scan, resource: "sections" });
    requests = 0;
    redirects = true;
    const { results } = await api<{
      results: { ok: boolean; error?: string }[];
    }>("scan/read-batch", {
      scan,
      jobs: ["100", "101", "102", "103", "104"].flatMap((section) =>
        ["section", "items", "categories", "periods", "scales", "grades"].map(
          (resource) => ({ resource, section }),
        ),
      ),
    });
    expect(requests).toBe(44);
    expect(results.some((r) => r.error === "batchDeferred")).toBe(true);
    expect(results.every((r) => r.ok || r.error === "batchDeferred")).toBe(
      true,
    );
    await api("scan/read", { scan, resource: "items", section: "100" });
    expect(requests).toBe(48);
    await api("scan/cancel", { scan });
  });
  it("runs optional scale jobs only after all required metadata completes, retaining result order", async () => {
    slow = true;
    const { scan } = await api<{ scan: string }>("scan/start", {
      key: "fixture",
      secret: "fixture-secret",
    });
    await api("scan/roots", { scan });
    const result = await api<{
      results: { ok: boolean; value: { data: unknown } }[];
    }>("scan/read-batch", {
      scan,
      jobs: [
        { resource: "scales", section: "100" },
        ...["100", "101", "102", "103", "104"].flatMap((section) =>
          ["section", "items", "categories", "periods"].map((resource) => ({
            resource,
            section,
          })),
        ),
      ],
    });
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(result.results[0].value.data).toEqual({ grading_scale: [] });
    expect(scalesAfterMetadata).toEqual([20]);
    await api("scan/commit", { scan });
  });
  it("defers optional scales when required reads are incomplete", async () => {
    const { scan } = await api<{ scan: string }>("scan/start", {
      key: "fixture",
      secret: "fixture-secret",
    });
    await api("scan/roots", { scan });
    const count = requests;
    const result = await api<{ results: { ok: boolean; error?: string }[] }>(
      "scan/read-batch",
      {
        scan,
        jobs: [{ resource: "scales", section: "100" }],
      },
    );
    expect(result.results).toEqual([
      { ok: false, error: "batchDeferred", status: 502 },
    ]);
    expect(requests).toBe(count);
    expect(scalesAfterMetadata).toEqual([]);
    await api("scan/cancel", { scan });
  });
  it("limits aggregate batch response size and retries deferred reads without losing a snapshot", async () => {
    large = true;
    const state = await readSnapshot(emptyState(), await status(), {
      key: "fixture",
      secret: "fixture-secret",
    });
    expect(state.courses.length).toBeGreaterThan(0);
    expect(requests).toBeGreaterThan(23);
    expect((await status()).connected).toBe(true);
  });
  it("stops queued batch reads when Schoology announces a cooldown", async () => {
    const { scan } = await api<{ scan: string }>("scan/start", {
      key: "fixture",
      secret: "fixture-secret",
    });
    await api("scan/read", { scan, resource: "sections" });
    requests = 0;
    slow = limited = true;
    const result = await api<{ results: { ok: boolean; error?: string }[] }>(
      "scan/read-batch",
      {
        scan,
        jobs: ["100", "101", "102"].flatMap((section) =>
          ["items", "section", "categories", "periods"].map((resource) => ({
            resource,
            section,
          })),
        ),
      },
    );
    expect(requests).toBeLessThanOrEqual(5);
    expect(
      result.results.filter((r) => !r.ok && r.error === "rateLimited").length,
    ).toBeGreaterThanOrEqual(8);
    await expect(
      api("scan/start", { key: "fixture", secret: "fixture-secret" }),
    ).rejects.toMatchObject({ code: "rateLimited" });
    await api("scan/cancel", { scan });
  });
  it("uses three unchanged provider reads after a complete cold snapshot, with fixed cache expiry", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
      key: "fixture",
      secret: "fixture-secret",
    });
    expect(requests).toBe(23);
    expect(appRequests.slice(-3)).toEqual([
      "/api/status",
      "/api/scan/start",
      "/api/scan/commit",
    ]);
    const cacheStamp = cold.metadata!["100"].fetched;
    requests = 0;
    appRequests = [];
    const warm = await readSnapshot(cold, await status());
    expect(requests).toBe(3);
    expect(appRequests).toEqual([
      "/api/status",
      "/api/scan/start",
      "/api/scan/commit",
    ]);
    expect(warm.metadata!["100"].fetched).toBe(cacheStamp);
    requests = 0;
    appRequests = [];
    await readSnapshot(warm, await status(), undefined, true);
    expect(requests).toBe(23);
    expect(appRequests).toEqual([
      "/api/status",
      "/api/scan/start",
      "/api/scan/commit",
    ]);
  });
  it("shares the initial invocation's redirect budget with prefetched metadata", async () => {
    redirects = true;
    requests = 0;
    const started = await api<{
      scan: string;
      prefetched: { results: { ok: boolean; error?: string }[] };
    }>("scan/start", {
      key: "fixture",
      secret: "fixture-secret",
      includeRoots: true,
      prefetchMetadata: true,
    });
    expect(requests).toBe(44);
    expect(
      started.prefetched.results.some(
        (result) => result.error === "batchDeferred",
      ),
    ).toBe(true);
    await expect(
      api("scan/commit", { scan: started.scan }),
    ).rejects.toMatchObject({ code: "incompleteSnapshot" });
    await api("scan/cancel", { scan: started.scan });
  });
  it("falls back to scan/reuse when an older Worker does not fold receipts into scan/start", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
      key: "fixture",
      secret: "fixture-secret",
    });
    legacyWorker = true;
    requests = 0;
    appRequests = [];
    const warm = await readSnapshot(cold, await status());
    expect(requests).toBe(3);
    expect(appRequests).toContain("/api/scan/reuse");
    expect(warm.metadata).toEqual(cold.metadata);
  });
  it("renews changed fingerprints instead of accepting the browser's reuse proposal", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
      key: "fixture",
      secret: "fixture-secret",
    });
    changedGrades = true;
    requests = 0;
    const next = await readSnapshot(cold, await status());
    expect(requests).toBe(7); // identity + fresh roots + four required metadata reads
    expect(next.metadata!["100"].fingerprint).not.toBe(
      cold.metadata!["100"].fingerprint,
    );
    expect(next.metadata!["101"]).toEqual(cold.metadata!["101"]);
  });
  it("validates reuse proposals before provider reads and rejects missing, expired or manual receipts", async () => {
    await readSnapshot(emptyState(), await status(), {
      key: "fixture",
      secret: "fixture-secret",
    });
    requests = 0;
    for (const reuse of [
      ["100", "100"],
      ["100/grades"],
      Array(33).fill("100"),
      "100",
    ]) {
      await expect(
        api("scan/start", { reuse, includeRoots: true }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(requests).toBe(0);
    const started = await api<{ scan: string; reused: string[] }>(
      "scan/start",
      { includeRoots: true, reuse: ["100", "999"] },
    );
    expect(started.reused).toEqual(["100"]);
    await expect(
      api("scan/commit", { scan: started.scan }),
    ).rejects.toMatchObject({ code: "incompleteSnapshot" });
    await api("scan/cancel", { scan: started.scan });
    const manual = await api<{ scan: string; reused: string[] }>("scan/start", {
      includeRoots: true,
      reuse: ["100"],
      refreshMetadata: true,
    });
    expect(manual.reused).toEqual([]);
    await api("scan/cancel", { scan: manual.scan });
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + 5 * 60000 + 1);
    try {
      const expired = await api<{ scan: string; reused: string[] }>(
        "scan/start",
        { includeRoots: true, reuse: ["100"] },
      );
      expect(expired.reused).toEqual([]);
      await api("scan/cancel", { scan: expired.scan });
    } finally {
      clock.mockRestore();
    }
  });
  it("does not retry a short provider rate limit inside the same scan", async () => {
    limited = true;
    limitSeconds = 1;
    await expect(
      readSnapshot(emptyState(), await status(), {
        key: "fixture",
        secret: "fixture-secret",
      }),
    ).rejects.toMatchObject({ code: "rateLimited" });
    expect(requests).toBeLessThanOrEqual(8); // three roots, then at most five batch peers
    expect((await status()).connected).toBe(false);
  });
  it("omits blank enrollments while retaining normal gradebooks and metadata reuse", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
      key: "fixture-blank",
      secret: "fixture-secret",
    });
    const shown = visibleCourses(cold.courses, Date.parse("2026-11-04"));
    expect(shown).toHaveLength(5);
    expect(
      cold.courses.some((c) => ["105", "106"].includes(c.fields.section_id)),
    ).toBe(false);
    expect(cold.metadata!["105"]).toBeUndefined();
    expect(cold.metadata!["106"]).toBeUndefined();
    const stamp = cold.metadata!["100"].fetched;
    requests = 0;
    const warm = await readSnapshot(cold, await status());
    expect(requests).toBe(5); // identity, enrollment, bulk grades, two empty gradebooks
    expect(warm.metadata!["100"].fetched).toBe(stamp);
    expect(visibleCourses(warm.courses, Date.parse("2026-11-04"))).toHaveLength(
      5,
    );
  });
  it("defers optional title traversal on returning opens and retries it on manual refresh", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
      key: "fixture",
      secret: "fixture-secret",
    });
    missingTitles = true;
    const previous = structuredClone(cold);
    // Remove one unresolved name from both the saved snapshot and cached catalog.
    for (const c of previous.courses)
      for (const a of c.assignments) a.title = "Untitled assignment";
    for (const m of Object.values(previous.metadata!))
      for (const item of m.payload.items) delete item.title;
    await repository.save(previous);
    optionalTitleReads = 0;
    const returning = await readSnapshot(previous, await status());
    expect(optionalTitleReads).toBe(0);
    expect(returning.courses).toHaveLength(cold.courses.length);
    const manual = await readSnapshot(
      returning,
      await status(),
      undefined,
      true,
    );
    expect(optionalTitleReads).toBeGreaterThan(0);
    optionalTitleReads = 0;
    await readSnapshot(manual, await status(), undefined, true);
    expect(optionalTitleReads).toBe(0); // Fresh full catalogs still run; failed optional lookups honor their backoff.
  });
  it("retains the active account/snapshot after malformed credential replacement", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
        key: "fixture",
        secret: "fixture-secret",
      }),
      before = await status();
    await expect(
      readSnapshot(cold, before, {
        key: "fixture-malformed",
        secret: "fixture-secret",
      }),
    ).rejects.toThrow();
    expect(await repository.load()).toEqual(cold);
    expect((await status()).revision).toBe(before.revision);
    expect(await repository.pending()).toBeUndefined();
  });
  it("reuses only recent server-verified aliases with fresh bulk grades and renews them on manual refresh", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
      key: "fixture-aliases",
      secret: "fixture-secret",
    });
    expect(cold.courses.length).toBeGreaterThan(0);
    expect(requests).toBe(28);
    const stamp = cold.metadata!["1000"].fetched;
    requests = 0;
    const warm = await readSnapshot(cold, await status());
    expect(requests).toBe(3);
    expect(warm.courses).toHaveLength(cold.courses.length);
    expect(warm.metadata!["1000"].fetched).toBe(stamp);
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + 5 * 60000 + 1);
    try {
      requests = 0;
      batches = [];
      await readSnapshot(warm, await status());
      expect(requests).toBe(28);
      expect(batches).toHaveLength(1);
      expect(batches[0].filter((r) => r === "grades")).toHaveLength(5);
      expect(batches[0].filter((r) => r !== "grades")).toHaveLength(20);
    } finally {
      clock.mockRestore();
    }
    requests = 0;
    await readSnapshot(warm, await status(), undefined, true);
    expect(requests).toBe(28);
  });
  it("performs an authoritative section read when a cached alias owner disappears from fresh bulk grades", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
      key: "fixture-aliases",
      secret: "fixture-secret",
    });
    requests = 0;
    omitBulkOwner = true;
    const next = await readSnapshot(cold, await status());
    expect(requests).toBe(4);
    expect(next.courses).toHaveLength(cold.courses.length);
  });
  it("preserves newest local scenarios and hidden-course preferences rather than an older in-flight copy", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
        key: "fixture",
        secret: "fixture-secret",
      }),
      latest = structuredClone(cold),
      id = latest.courses[0].id;
    latest.scenarios[id] = { scores: {}, ignored: ["synthetic"], added: [] };
    latest.hiddenSchoology = ["synthetic-hidden-section"];
    await repository.save(latest);
    const next = await readSnapshot(cold, await status());
    expect(next.scenarios[id].ignored).toEqual(["synthetic"]);
    expect(next.hiddenSchoology).toEqual(latest.hiddenSchoology);
  });
  it("accepts a verified schema-valid empty account without resurrecting old records", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
      key: "fixture",
      secret: "fixture-secret",
    });
    const next = await readSnapshot(cold, await status(), {
      key: "fixture-empty",
      secret: "fixture-secret",
    });
    expect(next.courses).toEqual([]);
    expect((await status()).connected).toBe(true);
  });
});
