import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { FixtureVault } from "./fixture-worker";
import type { Env } from "../worker/index";
import { readSnapshot } from "../src/refresh";
import { api, type Status } from "../src/api";
import { emptyState } from "../src/core/model";
import * as repository from "../src/repository";
describe("complete snapshot and cache integration", () => {
  let requests = 0,
    cookie = "",
    omitBulkOwner = false,
    slow = false,
    redirects = false,
    large = false,
    limited = false,
    active = 0,
    maximumActive = 0;
  beforeEach(async () => {
    await repository.clear();
    requests = 0;
    cookie = "";
    omitBulkOwner = false;
    slow = limited = redirects = large = false;
    active = maximumActive = 0;
    const data = new Map();
    class RecordingVault extends FixtureVault {
      constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        const original = this.upstream;
        this.upstream = async (req) => {
          requests++;
          const requestURL = new URL(req.url);
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
            if (slow) await new Promise((r) => setTimeout(r, 5));
            response =
              limited && new URL(req.url).pathname.endsWith("/grade_items")
                ? new Response("synthetic cooldown", {
                    status: 429,
                    headers: { "Retry-After": "30" },
                  })
                : await original(req);
          } finally {
            active--;
          }
          const url = new URL(req.url);
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
      const headers = new Headers(init.headers);
      headers.set("Cookie", cookie);
      headers.set("Origin", "https://app.test");
      const r = await vault.fetch(
        new Request("https://app.test" + path, { ...init, headers }),
      );
      const next = r.headers.get("Set-Cookie");
      if (next) cookie = next.split(";")[0];
      return r;
    });
    await api("login", { password: "synthetic-owner-password-for-tests-only" });
  });
  afterEach(() => vi.unstubAllGlobals());
  const status = () => api<Status>("status");
  it("bounds hosted batches to six provider reads and validates every job before any read", async () => {
    slow = true;
    await readSnapshot(emptyState(), await status(), {
      key: "fixture",
      secret: "fixture-secret",
    });
    expect(maximumActive).toBe(6);
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
    expect(requests).toBeLessThanOrEqual(6);
    expect(
      result.results.filter((r) => !r.ok && r.error === "rateLimited").length,
    ).toBeGreaterThanOrEqual(7);
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
    const cacheStamp = cold.metadata!["100"].fetched;
    requests = 0;
    const warm = await readSnapshot(cold, await status());
    expect(requests).toBe(3);
    expect(warm.metadata!["100"].fetched).toBe(cacheStamp);
    requests = 0;
    await readSnapshot(warm, await status(), undefined, true);
    expect(requests).toBe(23);
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
      await readSnapshot(warm, await status());
      expect(requests).toBe(28);
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
  it("preserves the newest local scenario rather than an older in-flight copy", async () => {
    const cold = await readSnapshot(emptyState(), await status(), {
        key: "fixture",
        secret: "fixture-secret",
      }),
      latest = structuredClone(cold),
      id = latest.courses[0].id;
    latest.scenarios[id] = { scores: {}, ignored: ["synthetic"], added: [] };
    await repository.save(latest);
    const next = await readSnapshot(cold, await status());
    expect(next.scenarios[id].ignored).toEqual(["synthetic"]);
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
