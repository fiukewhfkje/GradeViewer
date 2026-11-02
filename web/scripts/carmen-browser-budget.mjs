// Offline report only. Never infer Cloudflare billing from VM/browser wall time.
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { labDirectory, privateRead } from "./carmen-login-lab.mjs";

const ownPath = fileURLToPath(import.meta.url);
export const dailyAllowanceMs = 600_000;
export const routineTargetMs = 120_000;
const day = 24 * 3600_000;
const validTime = (v) => Number.isFinite(v) && v >= 0;

export function browserBudgetReport(events) {
  const parsed = events.filter(
    (e) => e && Number.isFinite(Date.parse(e.observedAtUTC)),
  );
  const times = parsed.map((e) => Date.parse(e.observedAtUTC));
  const observedHours =
    times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3600_000 : 0;
  const groups = [];
  for (const probe of ["active", "idle"]) {
    for (const runtime of ["cloudflare", "vm-local"]) {
      const rows = parsed.filter(
        (e) =>
          e.event === "separateRenewal" &&
          e.probe === probe &&
          e.browserRuntime === runtime,
      );
      if (!rows.length) continue;
      const measured = rows.filter(
        (e) => validTime(e.browserLeaseWallMs) && e.cleanupFailed !== true,
      );
      const days = {};
      for (const row of measured) {
        const date = new Date(row.observedAtUTC).toISOString().slice(0, 10);
        days[date] = (days[date] ?? 0) + row.browserLeaseWallMs;
      }
      const ordered = measured
        .map((r) => ({
          at: Date.parse(r.observedAtUTC),
          ms: r.browserLeaseWallMs,
        }))
        .sort((a, b) => a.at - b.at);
      let start = 0,
        sum = 0,
        peak = 0;
      for (let i = 0; i < ordered.length; i++) {
        sum += ordered[i].ms;
        while (ordered[i].at - ordered[start].at >= day)
          sum -= ordered[start++].ms;
        peak = Math.max(peak, sum);
      }
      const unknownCosts = rows.length - measured.length;
      const technicalFailures = rows.filter(
        (r) => r.renewalOutcome === "inconclusive" || r.cleanupFailed,
      ).length;
      groups.push({
        probe,
        runtime,
        attempts: rows.length,
        measuredAttempts: measured.length,
        unknownCosts,
        technicalFailures,
        browserLeaseWallMsByUTCDate: days,
        peakRolling24hBrowserLeaseWallMs: peak,
        maximumObservedLeaseMs: ordered.length
          ? Math.max(...ordered.map((r) => r.ms))
          : null,
        targetStatus:
          peak >= dailyAllowanceMs
            ? "aboveFreeAllowance"
            : peak > routineTargetMs
              ? "aboveRoutineTarget"
              : observedHours < 24 || unknownCosts || technicalFailures
                ? "insufficientEvidence"
                : "withinObservedRoutineTarget",
      });
    }
  }
  const cloud = groups.filter((g) => g.runtime === "cloudflare");
  const deferrals = parsed.filter((e) => e.event === "recoveryDeferred");
  const unresolvedDeferrals = deferrals.filter(
    (e) => e.reason !== "acquisitionCooldown",
  ).length;
  const unattributedRecoveryAttempts = parsed.filter(
    (e) =>
      e.event === "separateRenewal" &&
      !["cloudflare", "vm-local"].includes(e.browserRuntime),
  ).length;
  return {
    version: 1,
    observedHours,
    dailyAllowanceMs,
    routineTargetMs,
    metric: "wallTimeThroughBrowserCloseAcknowledgement",
    exactBilledTime: false,
    cloudflareMeasured: cloud.some((g) => g.measuredAttempts > 0),
    cloudflareRoutineTargetMetInObservedSample:
      cloud.length > 0 &&
      unresolvedDeferrals === 0 &&
      unattributedRecoveryAttempts === 0 &&
      cloud.every((g) => g.targetStatus === "withinObservedRoutineTarget"),
    initialManualSignInsIncluded: false,
    accountWideUsageMustAlsoBeChecked: true,
    deferredRecoveries: deferrals.length,
    unresolvedDeferrals,
    unattributedRecoveryAttempts,
    groups,
  };
}

export async function readBudgetEvents(root) {
  return (await privateRead(root, "observations.jsonl", 5_100_000))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--consent")) {
    console.log('{"error":"accountHolderPermissionRequired"}');
    process.exitCode = 1;
    return;
  }
  if (args.length !== 2 || args[1] !== "--consent") {
    console.log('{"error":"usePrivateBenchmarkDirectoryAndConsent"}');
    process.exitCode = 1;
    return;
  }
  try {
    const root = await labDirectory(args[0]);
    const rows = await readBudgetEvents(root);
    console.log(JSON.stringify(browserBudgetReport(rows)));
  } catch {
    console.log('{"error":"privateBudgetEvidenceUnavailable"}');
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => "")) === ownPath
)
  await main();
