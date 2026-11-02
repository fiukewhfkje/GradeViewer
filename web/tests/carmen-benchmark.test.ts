import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Operator-only JavaScript diagnostic.
import * as bench from "../scripts/carmen-benchmark.mjs";
// @ts-expect-error Operator-only JavaScript diagnostic.
import * as lab from "../scripts/carmen-login-lab.mjs";

const hour = 3600_000;
const began = 1000 * hour;
function profile(authenticationId: string) {
  return {
    identity: "synthetic-private-account",
    authenticationId,
    gradesPermitted: true,
    courseTotalsVerifiedAt: began,
    authorizedUntil: began + 7 * 24 * hour,
    state: {
      cookies: [
        {
          domain: "osu.instructure.com",
          name: "session",
          value: "synthetic-secret-" + authenticationId,
        },
      ],
      origins: [],
    },
  };
}
const state = () =>
  bench.newBenchmark(
    profile("one"),
    profile("two"),
    ["/synthetic/private/active", "/synthetic/private/idle"],
    began,
  );
const success = {
  authenticated: true,
  courseTotalsChecked: true,
  timingsMs: { total: 300 },
};

describe("finite active and sequential idle Carmen benchmark", () => {
  it("sends scheduled measurement checks with renewal disabled and reports provenance limits", () => {
    for (const local of [false, true]) {
      const args = bench.labArguments("/synthetic/private", local);
      expect(args).toContain("--no-renew");
      expect(args[1]).toBe("check");
      expect(
        bench.labArguments("/synthetic/private", local, "renew"),
      ).not.toContain("--no-renew");
    }
    const summary = bench.benchmarkSummary(state());
    expect(summary).toMatchObject({
      measurementMode: "httpOnlyNoRenewal",
      independenceProven: false,
      independentSignInsRequired: true,
      fullWeekQuietTest: false,
      idleProtocol: "sequentialGaps",
    });
    const short = bench.newBenchmark(
      profile("one"),
      profile("two"),
      ["a", "b"],
      began,
      false,
      24,
    );
    expect(short.endsAt).toBe(began + 24 * hour);
    expect(() =>
      bench.newBenchmark(
        profile("one"),
        profile("two"),
        ["a", "b"],
        began,
        false,
        169,
      ),
    ).toThrow("durationMustBeOneTo168Hours");
  });

  it("records a separate recovery without counting another measurement or expiry", () => {
    const p = state().probes.active;
    bench.applyResult(
      p,
      "active",
      { httpCheck: { error: "authenticationRejected" } },
      began,
      began + 100,
    );
    expect(p.phase).toBe("paused");
    expect(p.stats.renewalAttempts).toBe(0);
    const event = bench.applyRenewalResult(
      p,
      "active",
      {
        browserRuntime: "cloudflare",
        error: "cloudflareRateLimited",
        renewalStages: lab.newRenewalStages(true),
      },
      began + 200,
      began + 500,
    );
    expect(p.stats).toMatchObject({
      checks: 1,
      confirmedExpiries: 1,
      renewalAttempts: 1,
      renewalInconclusive: 1,
    });
    expect(event).toMatchObject({
      event: "separateRenewal",
      recoveryError: "cloudflareRateLimited",
      stages: {
        carmenSessionRejected: true,
        browserLaunched: false,
        osuSignIn: "notObserved",
        duoChallenge: "notObserved",
      },
    });
    expect(p.phase).toBe("paused");
    const other = state().probes.idle;
    bench.applyResult(
      other,
      "idle",
      { httpCheck: { error: "authenticationRejected" } },
      other.nextAt,
      other.nextAt + 100,
    );
    bench.applyRenewalResult(
      other,
      "idle",
      {
        browserRuntime: "vm-local",
        renewal: success,
        success: true,
        renewalStages: {
          ...lab.newRenewalStages(true),
          browserLaunched: true,
          osuSignIn: "continuedSilently",
          renewalSucceeded: true,
        },
      },
      other.pausedAt,
      other.pausedAt + 500,
    );
    expect(other.stats).toMatchObject({
      checks: 1,
      confirmedExpiries: 1,
      silentRenewals: 1,
    });
    expect(other.intervalIndex).toBe(1);
    expect(other.confirmedExpiry).toBe(false);
  });
  it("requires separate authentications, same account and verified grade-path scope", () => {
    expect(() =>
      bench.validateProfiles(profile("one"), profile("one")),
    ).toThrow("separateAuthenticationsRequired");
    const copied = profile("two");
    copied.state = profile("one").state;
    expect(() => bench.validateProfiles(profile("one"), copied)).toThrow(
      "copiedServerSessionRejected",
    );
    expect(() =>
      bench.validateProfiles(profile("one"), {
        ...profile("two"),
        identity: "other",
      }),
    ).toThrow("sameAccountRequired");
    expect(() =>
      bench.validateProfiles(profile("one"), {
        ...profile("two"),
        gradesPermitted: false,
      }),
    ).toThrow("verifiedCourseTotalsRequired");
    expect(() =>
      bench.newBenchmark(
        profile("one"),
        { ...profile("two"), authorizedUntil: began + 48 * hour },
        ["a", "b"],
        began,
      ),
    ).toThrow("weekAuthorizationRequired");
  });

  it("anchors each idle wait after the previous success, including the final 48-hour wait", () => {
    const p = state().probes.idle;
    let last = began;
    for (const wait of [2, 4, 8, 16, 24, 48]) {
      expect(p.nextAt).toBe(last + wait * hour);
      const ended = p.nextAt + 350;
      const event = bench.applyResult(
        p,
        "idle",
        { httpCheck: success, success: true },
        p.nextAt,
        ended,
      );
      expect(event.http).toBe("accepted");
      expect(event.requestedWaitMs).toBe(wait * hour);
      last = ended;
    }
    expect(p.phase).toBe("complete");
    expect(p.nextAt).toBeNull();
    expect(last - began).toBe(102 * hour + 6 * 350);
  });

  it("preserves five-minute active cadence and records actual failure bounds after missed ticks", () => {
    const p = state().probes.active;
    bench.applyResult(
      p,
      "active",
      { httpCheck: success, success: true },
      began + 60_000,
      began + 60_300,
    );
    expect(p.nextAt).toBe(began + 5 * 60_000);
    const started = began + 20 * 60_000;
    const event = bench.applyResult(
      p,
      "active",
      {
        httpCheck: { authenticated: false, error: "authenticationRejected" },
        observation: { observedAtUTC: new Date(started + 300).toISOString() },
      },
      started,
      started + 1500,
    );
    expect(event.expiryWindowUpperMs).toBe(started + 300 - (began + 60_300));
    expect(event.expiryWindowUpperMs).toBeGreaterThan(5 * 60_000);
    expect(event.renewalOutcome).toBe("notAttempted");
    expect(p.nextAt).toBeNull();
    expect(p.phase).toBe("paused");
    expect(p.stats.confirmedExpiries).toBe(1);
  });

  it("does not confuse identity success with a successful courses request, or errors with expiry", () => {
    for (const error of [
      "networkUnavailable",
      "rateLimited",
      "permissionDenied",
      "nonJSONResponse",
      "invalidCourseList",
    ]) {
      const p = state().probes.idle;
      const event = bench.applyResult(
        p,
        "idle",
        { httpCheck: { authenticated: true, error } },
        p.nextAt,
        p.nextAt + 10,
      );
      expect(event.http).toBe("inconclusive");
      expect(event.expiryWindowUpperMs).toBeUndefined();
      expect(p.stats.confirmedExpiries).toBe(0);
      expect(p.stats.renewalAttempts).toBe(0);
      expect(p.phase).toBe("paused");
      expect(p.intervalIndex).toBe(0);
    }
    const p = state().probes.active;
    const event = bench.applyResult(
      p,
      "active",
      { httpCheck: { authenticated: true, error: "authenticationRejected" } },
      began,
      began + 300,
    );
    expect(event.http).toBe("confirmedAuthFailure");
  });

  it("counts repeated renewal episodes and separates verified human gates from inconclusive attempts", () => {
    const s = state(),
      p = s.probes.active;
    for (const humanReason of [undefined, "duo", "policy", "credentials"]) {
      bench.applyResult(
        p,
        "active",
        { httpCheck: { error: "authenticationRejected" } },
        began,
        began + 100,
      );
      bench.applyRenewalResult(
        p,
        "active",
        {
          browserRuntime: "cloudflare",
          renewalStages: {
            ...lab.newRenewalStages(true),
            humanAction: humanReason,
          },
          renewal: humanReason
            ? { error: "humanSignInRequired", humanReason }
            : { error: "renewalInconclusive" },
        },
        began,
        began + 1000,
      );
    }
    expect(p.stats).toMatchObject({
      confirmedExpiries: 4,
      renewalAttempts: 4,
      humanDuo: 1,
      humanPolicy: 1,
      humanCredentials: 1,
      renewalInconclusive: 1,
    });
    const summary = bench.benchmarkSummary(s);
    expect(summary.probes.active.duoUnknownAttempts).toBe(3);
    expect(summary.probes.active.duoFractionBounds).toEqual({
      minimum: 1 / 4,
      maximum: 1,
    });
    expect(summary.probes.idle.duoFractionBounds).toBeNull();
    expect(JSON.stringify(summary)).not.toContain("synthetic-private");
    expect(JSON.stringify(summary)).not.toContain("synthetic-secret");
  });

  it("does not print arbitrary report fields or identity data", () => {
    const s = state();
    const event = bench.applyResult(
      s.probes.active,
      "active",
      {
        httpCheck: {
          ...success,
          cookie: "private-cookie",
          identity: "private-name",
        },
        success: true,
        error: "private-error-with-password",
      },
      began,
      began + 300,
    );
    for (const secret of [
      "private-cookie",
      "private-name",
      "private-error-with-password",
    ])
      expect(JSON.stringify(event)).not.toContain(secret);
  });

  it("pauses a contaminated measurement instead of accepting unexpected browser renewal", () => {
    const p = state().probes.active;
    const event = bench.applyResult(
      p,
      "active",
      { httpCheck: success, success: true, browserRuntime: "cloudflare" },
      began,
      began + 100,
    );
    expect(event.unexpectedBrowser).toBe(true);
    expect(event.http).toBe("inconclusive");
    expect(p.phase).toBe("paused");
    expect(p.stats.renewalAttempts).toBe(0);
  });

  it("rejects CLI calls without consent before touching state or running a check", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/carmen-benchmark.mjs", import.meta.url),
        ),
        "tick",
        "/nonexistent",
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      error: "accountHolderPermissionRequired",
    });
    expect(result.stderr).toBe("");
  });

  it("runs local due-time/finite-stop/lock guards without any provider or browser traffic", async () => {
    const parent = await mkdtemp(join(tmpdir(), "synthetic-carmen-benchmark-"));
    const cli = (args: string[]) => {
      const r = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../scripts/carmen-benchmark.mjs", import.meta.url),
          ),
          ...args,
          "--consent",
        ],
        { encoding: "utf8", timeout: 5000 },
      );
      expect(r.stderr).toBe("");
      return { status: r.status, output: JSON.parse(r.stdout) };
    };
    try {
      const dirs = [join(parent, "active"), join(parent, "idle")];
      const now = Date.now();
      for (let i = 0; i < dirs.length; i++) {
        await lab.labDirectory(dirs[i], true);
        await writeFile(join(dirs[i], "key"), "synthetic-key", { mode: 0o600 });
        await lab.saveSession(
          dirs[i],
          {
            ...profile(String(i)),
            version: 1,
            createdAt: now,
            courseTotalsVerifiedAt: now,
            authorizedUntil: now + 7 * 24 * hour,
          },
          "synthetic-key",
        );
      }
      const root = join(parent, "experiment");
      expect(cli(["init", root, ...dirs]).status).toBe(0);
      const path = join(root, "state.json");
      const s = JSON.parse(await readFile(path, "utf8"));
      s.probes.active.nextAt = now + hour;
      await writeFile(path, JSON.stringify(s));
      expect(cli(["tick", root]).output).toEqual({ action: "notDue" });
      expect(cli(["renew", root, "active"]).output).toEqual({
        error: "confirmedAuthenticationFailureRequired",
      });
      s.probes.active.phase = "checking";
      s.probes.active.attemptStartedAt = Date.now();
      await writeFile(path, JSON.stringify(s));
      expect(cli(["tick", root]).output).toEqual({
        error: "interruptedCheckRequiresReview",
      });
      expect(cli(["resume", root, "active"]).output).toEqual({
        error: "verifiedResumeRequired",
      });
      const current = await lab.loadSession(dirs[0]);
      await lab.saveSession(
        dirs[0],
        { ...current.saved, courseTotalsVerifiedAt: Date.now() },
        current.key,
      );
      expect(cli(["resume", root, "active"]).output.probes.active.phase).toBe(
        "waiting",
      );
      s.endsAt = now - 1;
      await writeFile(path, JSON.stringify(s));
      expect(cli(["tick", root]).output).toEqual({ action: "trialEnded" });
      expect(JSON.parse(await readFile(path, "utf8")).stopped).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
