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
    cookie = "";
  beforeEach(async () => {
    await repository.clear();
    requests = 0;
    cookie = "";
    const data = new Map();
    class RecordingVault extends FixtureVault {
      constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        const original = this.upstream;
        this.upstream = async (req) => {
          requests++;
          return original(req);
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
