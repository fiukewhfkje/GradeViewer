import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { FixtureVault } from "./fixture-worker";
import {
  campusSummary,
  campusDetail,
  campusPortal,
  campusState,
} from "./campus-fixture";
import { seal, hash } from "../worker/crypto";
import type { Env } from "../worker/index";
import { api, type Status } from "../src/api";
import { readSnapshot } from "../src/refresh";
import { refreshCampus } from "../src/portal-refresh";
import { emptyState, type SavedState } from "../src/core/model";
import * as repository from "../src/repository";
import { browserJar } from "../worker/portal";

const password = "synthetic-refresh-benchmark-password";
const conditions = {
  version: 1,
  appRoundTripMs: 80,
  providerReadMs: 80,
  icSkewedDetailMs: [320, 40, 40, 320, 40, 40],
  storage: "in-memory Durable Object + fake IndexedDB",
  network: "local synthetic delays; no provider or Cloudflare requests",
};

function harness(icCount = 0, skewed = false, missingTitles = false) {
  const values = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => structuredClone(values.get(key)),
    put: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
    delete: async (key: string) => values.delete(key),
    getAlarm: async () => undefined,
    setAlarm: async () => {},
  } as unknown as DurableObjectStorage;
  let providerRequests = 0,
    active = 0,
    peakConcurrency = 0;
  let apiRequests = 0,
    cookie = "",
    measuring = false;
  const summary = structuredClone(campusSummary);
  const template = summary[0].terms[0].courses[0];
  summary[0].terms[0].courses = Array.from({ length: icCount }, (_, i) => ({
    ...template,
    sectionID: 100 + i,
    courseName: `Synthetic IC ${i + 1}`,
  }));
  class BenchmarkVault extends FixtureVault {
    constructor() {
      super(
        { storage } as unknown as DurableObjectState,
        { APP_PASSWORD: password } as Env,
      );
      const fixture = this.upstream;
      this.upstream = async (request) => {
        const url = new URL(request.url);
        if (measuring) {
          providerRequests++;
          active++;
          peakConcurrency = Math.max(peakConcurrency, active);
        }
        try {
          const section = url.pathname.match(/\/detail\/(\d+)$/)?.[1];
          if (measuring)
            await delay(
              section && skewed
                ? conditions.icSkewedDetailMs[(Number(section) - 100) % 6]
                : conditions.providerReadMs,
            );
          if (url.hostname === "fixture.infinitecampus.org") {
            if (url.pathname.endsWith("/roster"))
              return Response.json({ personID: "101" });
            if (url.pathname.endsWith("/grades")) return Response.json(summary);
            if (section) return Response.json(campusDetail);
            throw new Error("Unexpected synthetic IC path");
          }
          const response = await fixture(request);
          if (missingTitles && url.pathname.endsWith("/grade_items")) {
            const body = (await response.json()) as {
              assignment: Record<string, unknown>[];
            };
            delete body.assignment[0].title;
            return Response.json(body);
          }
          return response;
        } finally {
          if (measuring) active--;
        }
      };
    }
  }
  const vault = new BenchmarkVault();
  const fetcher = async (
    path: string | URL | Request,
    init: RequestInit = {},
  ) => {
    assert.equal(typeof path, "string");
    assert.ok(String(path).startsWith("/api/"));
    if (measuring) {
      apiRequests++;
      await delay(conditions.appRoundTripMs / 2);
    }
    const headers = new Headers(init.headers);
    headers.set("Origin", "https://app.test");
    headers.set("Cookie", cookie);
    const response = await vault.fetch(
      new Request("https://app.test" + path, { ...init, headers }),
    );
    const next = response.headers.get("Set-Cookie");
    if (next) cookie = next.split(";")[0];
    if (measuring) await delay(conditions.appRoundTripMs / 2);
    return response;
  };
  return {
    values,
    fetcher,
    async connectIC() {
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
              selected: Array.from(
                { length: icCount },
                (_, i) => `1:${100 + i}`,
              ),
              jar: browserJar(
                campusState,
                new URL(campusPortal).origin,
              ).serializeSync(),
            },
          },
          password,
        ),
      );
    },
    start() {
      measuring = true;
    },
    stats() {
      return { apiRequests, providerRequests, peakConcurrency };
    },
  };
}

function digest(state: SavedState) {
  // Read/observation timestamps vary with wall clock; all grade/assignment/rule fields must match.
  const courses = JSON.stringify(state.courses, (key, value) =>
    [
      "fetched",
      "history",
      "overall_scale_verified_at",
      "title_lookup_retry_after",
    ].includes(key)
      ? undefined
      : value,
  );
  return createHash("sha256").update(courses).digest("hex");
}

export async function benchmarkRefresh(samples: number) {
  const originalFetch = globalThis.fetch;
  const scenarios = [
    "schoology-cold",
    "schoology-warm",
    "schoology-alias-warm",
    "schoology-expired",
    "schoology-manual",
    "schoology-unresolved-title-repeat",
    "ic-one",
    "ic-six-uniform",
    "ic-six-skewed",
  ];
  const results = [];
  try {
    for (const scenario of scenarios) {
      const samplesMs: number[] = [];
      let expectedStats:
        ReturnType<ReturnType<typeof harness>["stats"]> | undefined;
      let expectedDigest: string | undefined;
      // One unreported warm-up per scenario, then independent, identically seeded samples.
      for (let sample = -1; sample < samples; sample++) {
        await repository.clear();
        const ic = scenario.startsWith("ic-");
        const h = harness(
          ic ? (scenario === "ic-one" ? 1 : 6) : 0,
          scenario.endsWith("skewed"),
          scenario.includes("unresolved-title"),
        );
        globalThis.fetch = h.fetcher as typeof fetch;
        await api("login", { password });
        let previous = emptyState();
        if (scenario !== "schoology-cold")
          previous = await readSnapshot(previous, await api<Status>("status"), {
            key: scenario.includes("alias") ? "fixture-aliases" : "fixture",
            secret: "fixture-secret",
          });
        if (ic) await h.connectIC();
        if (scenario === "schoology-expired") {
          for (const metadata of Object.values(previous.metadata ?? {}))
            metadata.fetched = 0;
          const vault = h.values.get("vault") as {
            metadata: Record<string, { expires: number }>;
            gradeLinks: Record<string, { expires: number }>;
          };
          for (const receipt of [
            ...Object.values(vault.metadata),
            ...Object.values(vault.gradeLinks),
          ])
            receipt.expires = 0;
          await repository.save(previous);
        }
        h.start();
        const started = performance.now();
        const status = await api<Status>("status");
        const next = ic
          ? await refreshCampus(previous, status.portals?.campus)
          : await readSnapshot(
              previous,
              status,
              scenario === "schoology-cold"
                ? { key: "fixture", secret: "fixture-secret" }
                : undefined,
              scenario === "schoology-manual" ||
                scenario.includes("unresolved-title"),
            );
        const elapsed = performance.now() - started;
        const stats = h.stats(),
          snapshot = digest(next);
        if (sample >= 0) {
          if (expectedStats) assert.deepEqual(stats, expectedStats);
          if (expectedDigest) assert.equal(snapshot, expectedDigest);
          expectedStats = stats;
          expectedDigest = snapshot;
          samplesMs.push(Math.round(elapsed * 10) / 10);
        }
      }
      const sorted = [...samplesMs].sort((a, b) => a - b);
      results.push({
        scenario,
        samplesMs,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        ...expectedStats!,
        digest: expectedDigest!,
      });
      console.log("Measured " + scenario);
    }
    return { conditions, samples, results };
  } finally {
    globalThis.fetch = originalFetch;
    await repository.clear();
  }
}
