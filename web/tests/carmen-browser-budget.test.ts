import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
// @ts-expect-error Operator-only JavaScript.
import { browserBudgetReport } from "../scripts/carmen-browser-budget.mjs";
// @ts-expect-error Operator-only JavaScript.
import * as cloudflareStatus from "../scripts/carmen-cloudflare-status.mjs";
const { summarizeUsage, classifyCloudflareFailure } = cloudflareStatus;
// @ts-expect-error Operator-only JavaScript.
import * as experiment from "../scripts/carmen-experiment.mjs";
const { eligibleRenewals, recoveryDeferral } = experiment;

const base = Date.parse("2026-11-01T12:00:00Z");
const observation = (offset: number) => ({
  observedAtUTC: new Date(base + offset).toISOString(),
  probe: "active",
  http: "accepted",
});
const renewal = (
  offset: number,
  ms: number | null,
  runtime = "cloudflare",
  extra = {},
) => ({
  ...observation(offset),
  event: "separateRenewal",
  browserRuntime: runtime,
  browserLeaseWallMs: ms,
  renewalOutcome: "silent",
  ...extra,
});
describe("Carmen browser budget evidence", () => {
  it("refuses repeated initialization before any baseline can be reset", async () => {
    const root = await mkdtemp(join(tmpdir(), "synthetic-carmen-experiment-"));
    try {
      await writeFile(
        join(root, "cloudflare-account.json"),
        JSON.stringify({ accountId: "0".repeat(32) }),
        { mode: 0o600 },
      );
      await mkdir(join(root, "benchmark"), { mode: 0o700 });
      const r = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../scripts/carmen-experiment.mjs", import.meta.url),
          ),
          "init",
          root,
          "--consent",
          "--local-browser",
        ],
        { encoding: "utf8", timeout: 5000 },
      );
      expect(JSON.parse(r.stdout)).toEqual({
        error: "experimentAlreadyInitializedUseTickOrStatus",
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("allows one separate recovery only for a current confirmed rejection within the trial", () => {
    const state = {
      endsAt: base + 1000,
      probes: {
        active: { phase: "paused", confirmedExpiry: true },
        idle: { phase: "paused", confirmedExpiry: false },
      },
    };
    expect(eligibleRenewals(state, base)).toEqual(["active"]);
    expect(eligibleRenewals(state, base + 1000)).toEqual([]);
    expect(eligibleRenewals({ ...state, stopped: true }, base)).toEqual([]);
    expect(
      eligibleRenewals(
        {
          ...state,
          probes: {
            active: {
              phase: "paused",
              confirmedExpiry: true,
              renewalAttemptedAt: base,
            },
          },
        },
        base,
      ),
    ).toEqual([]);
  });
  it("does not count VM timings as Cloudflare budget evidence", () => {
    const r = browserBudgetReport([
      observation(0),
      observation(25 * 3600_000),
      renewal(1000, 5000, "vm-local"),
    ]);
    expect(r.cloudflareMeasured).toBe(false);
    expect(r.cloudflareRoutineTargetMetInObservedSample).toBe(false);
    expect(r.exactBilledTime).toBe(false);
    expect(r.groups[0].runtime).toBe("vm-local");
  });
  it("keeps separate probes, calendar days and rolling-24-hour costs", () => {
    const r = browserBudgetReport([
      observation(0),
      observation(25 * 3600_000),
      renewal(1000, 5000),
      renewal(13 * 3600_000, 7000),
      { ...renewal(1500, 3000), probe: "idle" },
    ]);
    const active = r.groups.find(
      (g: { probe: string }) => g.probe === "active",
    );
    expect(active.browserLeaseWallMsByUTCDate).toEqual({
      "2026-11-01": 5000,
      "2026-11-02": 7000,
    });
    expect(active.peakRolling24hBrowserLeaseWallMs).toBe(12000);
    expect(r.cloudflareRoutineTargetMetInObservedSample).toBe(true);
    expect(r.initialManualSignInsIncluded).toBe(false);
  });
  it("requires a day of evidence and keeps unknown/failed cleanup costs unresolved", () => {
    expect(browserBudgetReport([renewal(0, 2000)]).groups[0].targetStatus).toBe(
      "insufficientEvidence",
    );
    const r = browserBudgetReport([
      observation(0),
      observation(25 * 3600_000),
      renewal(1000, null),
      renewal(2000, 3000, "cloudflare", { cleanupFailed: true }),
    ]);
    expect(r.groups[0].unknownCosts).toBe(2);
    expect(r.cloudflareRoutineTargetMetInObservedSample).toBe(false);
  });
  it("flags narrow margin and the hard daily allowance", () => {
    expect(
      browserBudgetReport([renewal(0, 121000)]).groups[0].targetStatus,
    ).toBe("aboveRoutineTarget");
    expect(
      browserBudgetReport([renewal(0, 600000)]).groups[0].targetStatus,
    ).toBe("aboveFreeAllowance");
  });
  it("holds browser creation at the routine target and spaces Cloudflare acquisitions", () => {
    const state = { endsAt: base + 7 * 86400_000 };
    expect(
      recoveryDeferral([renewal(0, 121000)], state, base + 30_000).reason,
    ).toBe("routineBrowserTargetReached");
    expect(
      recoveryDeferral([renewal(0, 5000)], state, base + 1000).reason,
    ).toBe("acquisitionCooldown");
    expect(
      recoveryDeferral([renewal(0, 5000)], state, base + 30_000),
    ).toBeNull();
    const r = browserBudgetReport([
      observation(0),
      observation(25 * 3600_000),
      renewal(1000, 5000),
      {
        ...observation(2000),
        event: "recoveryDeferred",
        reason: "accountBrowserAllowanceLow",
      },
    ]);
    expect(r.cloudflareRoutineTargetMetInObservedSample).toBe(false);
    expect(r.unresolvedDeferrals).toBe(1);
  });
  it("omits arbitrary provider and identity fields", () => {
    const output = JSON.stringify(
      browserBudgetReport([
        {
          ...renewal(0, 5000),
          cookie: "private-cookie",
          name: "private-name",
          response: "private-response",
        },
      ]),
    );
    for (const value of ["private-cookie", "private-name", "private-response"])
      expect(output).not.toContain(value);
  });
  it("validates reported usage and computes the next UTC reset without proving a billing plan", () => {
    const r = summarizeUsage(
      [{ sum: { totalSessionDurationMs: 654396 } }],
      base,
    );
    expect(r).toMatchObject({
      reportedBrowserMs: 654396,
      reportedUsageExceedsFreeAllowance: true,
      freePlanResetAtUTC: "2026-11-02T00:00:00.000Z",
      planVerified: false,
    });
    expect(summarizeUsage([], base).reportedBrowserMs).toBe(0);
    for (const value of [
      null,
      {},
      [{ sum: { totalSessionDurationMs: "secret" } }],
    ])
      expect(() => summarizeUsage(value, base)).toThrow();
  });
  it("classifies Cloudflare errors without leaking their messages or credentials", () => {
    expect(
      classifyCloudflareFailure(
        new Error("Rate limit exceeded 429 secret-token"),
      ),
    ).toBe("cloudflareRateLimited");
    expect(
      classifyCloudflareFailure(
        new Error("Browser time limit exceeded for today"),
      ),
    ).toBe("dailyBrowserBudgetExceeded");
    expect(classifyCloudflareFailure(new Error("403 secret-token"))).toBe(
      "cloudflareAuthenticationRejected",
    );
    expect(classifyCloudflareFailure(new Error("secret-token"))).toBe(
      "cloudflareTechnicalFailure",
    );
  });
});
