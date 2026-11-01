// Finite, deterministic operator experiment. A cron tick never invokes a model.
import { execFile } from "node:child_process";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  labDirectory,
  loadSession,
  privateRead,
  recordObservation,
  shouldRenew,
} from "./carmen-login-lab.mjs";

const execute = promisify(execFile);
const ownPath = fileURLToPath(import.meta.url);
const labPath = fileURLToPath(new URL("carmen-login-lab.mjs", import.meta.url));
export const activeInterval = 5 * 60_000;
export const idleIntervals = [2, 4, 8, 16, 24, 48].map(
  (hours) => hours * 3600_000,
);
const week = 7 * 24 * 3600_000;
const roles = ["active", "idle"];
const fault = (code) => Object.assign(new Error(code), { code });
const accepted = (probe) =>
  probe?.authenticated === true &&
  !probe.error &&
  probe.courseTotalsChecked === true;
const errorLabels = new Set([
  "authenticationRejected",
  "redirectRequiresReview",
  "permissionDenied",
  "rateLimited",
  "providerUnavailable",
  "networkUnavailable",
  "nonJSONResponse",
  "invalidJSON",
  "invalidCourseList",
  "responseTooLarge",
  "accountChanged",
  "unverifiedIdentity",
  "probeFailed",
  "humanSignInRequired",
  "renewalInconclusive",
  "cancelled",
  "dailyBrowserBudgetExceeded",
  "cloudflareRateLimited",
  "labFailed",
]);
const safeError = (error) =>
  errorLabels.has(error) ? error : error ? "unclassified" : null;

export function validateProfiles(active, idle) {
  if (active.identity !== idle.identity) throw fault("sameAccountRequired");
  if (
    !active.authenticationId ||
    !idle.authenticationId ||
    active.authenticationId === idle.authenticationId
  )
    throw fault("separateAuthenticationsRequired");
  // Additional copy guard. Authentication IDs are provenance, not proof that
  // someone could never hand-edit a state file. Start each profile separately.
  const sessions = (saved) =>
    saved.state.cookies.filter(
      (c) =>
        c.domain.replace(/^\./, "") === "osu.instructure.com" &&
        /session/i.test(c.name) &&
        c.value,
    );
  if (
    sessions(active).some((a) =>
      sessions(idle).some((b) => a.name === b.name && a.value === b.value),
    )
  )
    throw fault("copiedServerSessionRejected");
  for (const saved of [active, idle]) {
    if (
      !saved.gradesPermitted ||
      !Number.isFinite(saved.courseTotalsVerifiedAt)
    )
      throw fault("verifiedCourseTotalsRequired");
  }
}

export function newBenchmark(
  active,
  idle,
  directories,
  now = Date.now(),
  localBrowser = false,
) {
  validateProfiles(active, idle);
  const endsAt = Math.min(
    now + week,
    active.authorizedUntil ?? 0,
    idle.authorizedUntil ?? 0,
  );
  if (endsAt - now < idleIntervals.reduce((a, b) => a + b, 0))
    throw fault("weekAuthorizationRequired");
  return {
    version: 1,
    startedAt: now,
    endsAt,
    localBrowser,
    probes: Object.fromEntries(
      roles.map((role, index) => {
        const saved = [active, idle][index];
        return [
          role,
          {
            directory: directories[index],
            authenticationId: saved.authenticationId,
            phase: "waiting",
            intervalIndex: 0,
            pollAnchorAt: now,
            lastSuccessAt: saved.courseTotalsVerifiedAt,
            nextAt:
              role === "active"
                ? now
                : saved.courseTotalsVerifiedAt + idleIntervals[0],
            stats: {
              checks: 0,
              httpAccepted: 0,
              confirmedExpiries: 0,
              renewalAttempts: 0,
              silentRenewals: 0,
              humanDuo: 0,
              humanPolicy: 0,
              humanCredentials: 0,
              humanUnclassified: 0,
              renewalInconclusive: 0,
              httpInconclusive: 0,
              externalResumes: 0,
            },
          },
        ];
      }),
    ),
  };
}

function scheduleNext(probe, role, baseline, advance = true) {
  probe.phase = "waiting";
  probe.lastSuccessAt = baseline;
  if (role === "idle" && advance) probe.intervalIndex++;
  if (role === "idle" && probe.intervalIndex === idleIntervals.length) {
    probe.phase = "complete";
    probe.nextAt = null;
  } else
    probe.nextAt =
      role === "active"
        ? probe.pollAnchorAt +
          (Math.floor((baseline - probe.pollAnchorAt) / activeInterval) + 1) *
            activeInterval
        : baseline + idleIntervals[probe.intervalIndex];
}

export function applyResult(probe, role, report, began, ended) {
  const previousSuccess = probe.lastSuccessAt;
  const http = report.httpCheck;
  const expired = !!http && shouldRenew(http);
  const ordinarySuccess = accepted(http) && report.success === true;
  const silentSuccess =
    expired && accepted(report.renewal) && report.success === true;
  const attempted = expired && report.browserRuntime !== undefined;
  const reasons = {
    duo: "humanDuo",
    policy: "humanPolicy",
    credentials: "humanCredentials",
  };
  const outcome = silentSuccess
    ? "silent"
    : !attempted
      ? "notAttempted"
      : report.renewal?.error === "humanSignInRequired"
        ? (reasons[report.renewal.humanReason] ?? "humanUnclassified")
        : "inconclusive";
  probe.stats.checks++;
  if (ordinarySuccess) probe.stats.httpAccepted++;
  else if (expired) probe.stats.confirmedExpiries++;
  else probe.stats.httpInconclusive++;
  if (attempted) probe.stats.renewalAttempts++;
  if (outcome === "silent") probe.stats.silentRenewals++;
  else if (outcome === "inconclusive") probe.stats.renewalInconclusive++;
  else if (outcome.startsWith("human")) probe.stats[outcome]++;
  const observed = Date.parse(report.observation?.observedAtUTC);
  const httpObservedAt =
    Number.isFinite(observed) && observed >= began && observed <= ended
      ? observed
      : ended;
  const event = {
    version: 1,
    probe: role,
    startedAtUTC: new Date(began).toISOString(),
    observedAtUTC: new Date(ended).toISOString(),
    previousSuccessAtUTC: new Date(previousSuccess).toISOString(),
    requestedWaitMs:
      role === "active" ? activeInterval : idleIntervals[probe.intervalIndex],
    actualGapBeforeRequestMs: Math.max(0, began - previousSuccess),
    http: ordinarySuccess
      ? "accepted"
      : expired
        ? "confirmedAuthFailure"
        : "inconclusive",
    // Actual window, not a promise of five-minute precision after missed ticks.
    ...(expired
      ? {
          expiryWindowUpperMs: Math.max(0, httpObservedAt - previousSuccess),
          authFailureObservedAtUTC: new Date(httpObservedAt).toISOString(),
        }
      : {}),
    httpMs: Number.isFinite(http?.timingsMs?.total)
      ? http.timingsMs.total
      : null,
    httpError: safeError(http?.error),
    httpStatus:
      Number.isInteger(http?.status) && http.status >= 100 && http.status <= 599
        ? http.status
        : null,
    recoveryError: safeError(report.renewal?.error ?? report.error),
    checkWallMs: Math.max(0, ended - began),
    renewalOutcome: outcome,
    renewalMs: report.timingsMs?.renewal?.[0] ?? null,
    recoveryTotalMs: report.timingsMs?.browserRecoveryTotal?.[0] ?? null,
    browserRuntime: attempted
      ? report.browserRuntime === "vm-local"
        ? "vm-local"
        : "cloudflare"
      : "none",
    cleanupFailed: report.cleanupFailed === true,
    courseTotalsChecked: ordinarySuccess || silentSuccess,
    courseListEmpty:
      (ordinarySuccess ? http : silentSuccess ? report.renewal : {})
        ?.courseListEmpty ?? null,
  };
  if ((ordinarySuccess || silentSuccess) && !report.cleanupFailed)
    scheduleNext(probe, role, ended);
  else {
    // No automatic retries on network errors, 429s, human prompts or uncertain
    // recovery. An explicit verified resume establishes the next baseline.
    probe.phase = "paused";
    probe.pausedAt = ended;
    probe.confirmedExpiry = expired;
    probe.nextAt = null;
  }
  return event;
}

export function benchmarkSummary(state) {
  return {
    startedAtUTC: new Date(state.startedAt).toISOString(),
    endsAtUTC: new Date(state.endsAt).toISOString(),
    stopped: state.stopped === true,
    probes: Object.fromEntries(
      roles.map((role) => {
        const p = state.probes[role];
        const resolved =
          p.stats.silentRenewals +
          p.stats.humanDuo +
          p.stats.humanPolicy +
          p.stats.humanCredentials +
          p.stats.humanUnclassified;
        // A password/policy stop may hide a later Duo challenge. Only a silent
        // verified recovery proves that this attempt needed no human Duo step.
        const duoUnknown =
          p.stats.renewalAttempts - p.stats.silentRenewals - p.stats.humanDuo;
        return [
          role,
          {
            phase: p.phase,
            nextAtUTC:
              p.nextAt == null ? null : new Date(p.nextAt).toISOString(),
            stats: p.stats,
            resolvedRenewals: resolved,
            duoUnknownAttempts: duoUnknown,
            duoFractionBounds: p.stats.renewalAttempts
              ? {
                  minimum: p.stats.humanDuo / p.stats.renewalAttempts,
                  maximum:
                    (p.stats.humanDuo + duoUnknown) / p.stats.renewalAttempts,
                }
              : null,
          },
        ];
      }),
    ),
  };
}

async function saveState(directory, state) {
  const temporary = join(directory, "state-new.json");
  try {
    await writeFile(temporary, JSON.stringify(state), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, join(directory, "state.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function runCheck(directory, localBrowser) {
  const args = [labPath, "check", directory, "--consent", "--grades"];
  if (localBrowser) args.push("--local-browser");
  let output;
  try {
    output = (
      await execute(process.execPath, args, {
        timeout: 120_000,
        maxBuffer: 128_000,
        env: { ...process.env, DEBUG: "", PWDEBUG: "0" },
      })
    ).stdout;
  } catch (error) {
    // Nonzero is the check's normal negative result. Never print raw stderr.
    output = error.stdout;
  }
  try {
    return JSON.parse(output.trim());
  } catch {
    return { success: false };
  }
}

async function profilesFor(state) {
  const result = [];
  for (const role of roles) {
    const probe = state.probes[role];
    const directory = await labDirectory(probe.directory);
    const { saved } = await loadSession(directory);
    if (saved.authenticationId !== probe.authenticationId)
      throw fault("profileReplacedDuringTrial");
    result.push(saved);
  }
  validateProfiles(...result);
  return result;
}

const safeErrors = new Set([
  "sameAccountRequired",
  "separateAuthenticationsRequired",
  "copiedServerSessionRejected",
  "verifiedCourseTotalsRequired",
  "weekAuthorizationRequired",
  "profileReplacedDuringTrial",
  "invalidOrExpiredLabState",
  "verifiedResumeRequired",
  "outsideRequestDetected",
  "interruptedCheckRequiresReview",
]);

async function main() {
  const [mode, path, ...args] = process.argv.slice(2);
  if (!args.includes("--consent")) {
    console.log(JSON.stringify({ error: "accountHolderPermissionRequired" }));
    process.exitCode = 1;
    return;
  }
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const flags = args.filter((arg) => arg.startsWith("--"));
  if (
    !["init", "tick", "status", "resume"].includes(mode) ||
    !path ||
    flags.some((flag) => !["--consent", "--local-browser"].includes(flag)) ||
    (mode === "init"
      ? positional.length !== 2
      : mode === "resume"
        ? positional.length !== 1 || !roles.includes(positional[0])
        : positional.length !== 0)
  ) {
    console.log(
      JSON.stringify({ error: "useInitTickStatusOrResumeWithConsent" }),
    );
    process.exitCode = 1;
    return;
  }
  process.umask(0o077);
  let directory,
    locked = false;
  try {
    directory = await labDirectory(path, mode === "init");
    if (mode === "init") {
      const directories = await Promise.all(
        positional.map((p) => labDirectory(p)),
      );
      const saved = await Promise.all(
        directories.map(async (p) => (await loadSession(p)).saved),
      );
      const state = newBenchmark(
        ...saved,
        directories,
        Date.now(),
        flags.includes("--local-browser"),
      );
      await saveState(directory, state);
      console.log(JSON.stringify(benchmarkSummary(state)));
      return;
    }
    try {
      await mkdir(join(directory, ".tick-lock"), { mode: 0o700 });
      locked = true;
    } catch (error) {
      if (error.code === "EEXIST") {
        console.log('{"action":"locked"}');
        return;
      }
      throw error;
    }
    const state = JSON.parse(await privateRead(directory, "state.json"));
    if (mode === "status") {
      console.log(JSON.stringify(benchmarkSummary(state)));
      return;
    }
    if (Date.now() >= state.endsAt || state.stopped) {
      state.stopped = true;
      await saveState(directory, state);
      console.log('{"action":"trialEnded"}');
      return;
    }
    const saved = await profilesFor(state); // Local reads only; no idle traffic.
    if (mode === "resume") {
      const role = positional[0],
        probe = state.probes[role];
      const verifiedAt = saved[roles.indexOf(role)].courseTotalsVerifiedAt;
      const boundary =
        probe.phase === "checking" ? probe.attemptStartedAt : probe.pausedAt;
      if (
        !["paused", "checking"].includes(probe.phase) ||
        !Number.isFinite(boundary) ||
        verifiedAt <= boundary
      )
        throw fault("verifiedResumeRequired");
      probe.stats.externalResumes++;
      scheduleNext(probe, role, verifiedAt, probe.confirmedExpiry);
      await saveState(directory, state);
      await recordObservation(directory, {
        version: 1,
        probe: role,
        event: "externalVerifiedResume",
        observedAtUTC: new Date().toISOString(),
      });
      console.log(JSON.stringify(benchmarkSummary(state)));
      return;
    }
    let checked = 0;
    for (const role of roles) {
      const probe = state.probes[role];
      if (probe.phase === "checking")
        throw fault("interruptedCheckRequiresReview");
      if (probe.phase !== "waiting" || Date.now() < probe.nextAt) continue;
      // Another invocation of the lab changes its private baseline. Pause rather
      // than silently presenting contaminated idle data as a scheduled trial.
      if (
        saved[roles.indexOf(role)].courseTotalsVerifiedAt !==
        probe.lastSuccessAt
      ) {
        probe.phase = "paused";
        probe.pausedAt = Date.now();
        probe.nextAt = null;
        await saveState(directory, state);
        throw fault("outsideRequestDetected");
      }
      const began = Date.now();
      probe.phase = "checking";
      probe.attemptStartedAt = began;
      await saveState(directory, state); // A crashed tick cannot repeat a request.
      const report = await runCheck(probe.directory, state.localBrowser);
      const event = applyResult(probe, role, report, began, Date.now());
      // Use the actual successful HTTP verification time, excluding CLI/browser
      // cleanup, as the next successful baseline.
      if (probe.phase === "waiting" || probe.phase === "complete") {
        const latest = (await loadSession(probe.directory)).saved;
        probe.lastSuccessAt = latest.courseTotalsVerifiedAt;
        if (probe.phase === "waiting" && role === "idle")
          probe.nextAt =
            probe.lastSuccessAt + idleIntervals[probe.intervalIndex];
      }
      await recordObservation(directory, event);
      await saveState(directory, state);
      console.log(JSON.stringify(event));
      checked++;
    }
    if (!checked) console.log('{"action":"notDue"}');
  } catch (error) {
    console.log(
      JSON.stringify({
        error: safeErrors.has(error?.code) ? error.code : "benchmarkFailed",
      }),
    );
    process.exitCode = 1;
  } finally {
    if (locked)
      await rm(join(directory, ".tick-lock"), { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => "")) === ownPath
)
  await main();
