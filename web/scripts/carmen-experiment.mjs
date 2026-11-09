// Portable owner-controlled trial. No LLM, cron installation or Worker deploy.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, lstat, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  labDirectory,
  privateRead,
  recordObservation,
} from "./carmen-login-lab.mjs";
import { readBudgetEvents, routineTargetMs } from "./carmen-browser-budget.mjs";

const execute = promisify(execFile);
const ownPath = fileURLToPath(import.meta.url);
const project = fileURLToPath(new URL("../", import.meta.url));
const script = (name) => fileURLToPath(new URL(name, import.meta.url));
export function eligibleRenewals(state, now = Date.now()) {
  if (state.stopped || now >= state.endsAt) return [];
  return ["active", "idle"].filter((role) => {
    const p = state.probes?.[role];
    return (
      p?.phase === "paused" &&
      p.confirmedExpiry === true &&
      p.renewalAttemptedAt === undefined
    );
  });
}
export function recoveryDeferral(events, state, now = Date.now()) {
  const recent = events.filter(
    (e) =>
      e.event === "separateRenewal" &&
      e.browserRuntime === "cloudflare" &&
      Date.parse(e.observedAtUTC) > now - 86400_000,
  );
  const spent = recent.reduce(
    (sum, e) =>
      sum +
      (Number.isFinite(e.browserLeaseWallMs) && e.browserLeaseWallMs >= 0
        ? e.browserLeaseWallMs
        : 0),
    0,
  );
  if (spent >= routineTargetMs)
    return {
      reason: "routineBrowserTargetReached",
      retryAtUTC: new Date(
        Math.min(
          state.endsAt,
          Math.min(...recent.map((e) => Date.parse(e.observedAtUTC))) +
            86400_000,
        ),
      ).toISOString(),
    };
  const last = recent.at(-1);
  if (last && now < Date.parse(last.observedAtUTC) + 25_000)
    return {
      reason: "acquisitionCooldown",
      retryAtUTC: new Date(
        Date.parse(last.observedAtUTC) + 25_000,
      ).toISOString(),
    };
  return null;
}
async function main() {
  const [mode, path, ...flags] = process.argv.slice(2);
  if (!flags.includes("--consent")) {
    console.log('{"error":"accountHolderPermissionRequired"}');
    process.exitCode = 1;
    return;
  }
  if (
    !["init", "tick", "status", "budget"].includes(mode) ||
    !path ||
    flags.some(
      (f) =>
        f !== "--consent" &&
        !(mode === "tick" && f === "--observe-recovery") &&
        !(mode === "init" && f === "--local-browser"),
    )
  ) {
    console.log('{"error":"useInitTickStatusOrBudgetWithConsent"}');
    process.exitCode = 1;
    return;
  }
  let initializationLock;
  try {
    const root = await labDirectory(path);
    const binding = JSON.parse(
      await privateRead(root, "cloudflare-account.json"),
    );
    if (!/^[a-f0-9]{32}$/.test(binding.accountId)) throw Error();
    const env = {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: binding.accountId,
      DEBUG: "",
      PWDEBUG: "0",
      WRANGLER_SEND_METRICS: "false",
    };
    async function run(file, args, echo = true) {
      let stdout;
      try {
        ({ stdout } = await execute(process.execPath, [file, ...args], {
          cwd: project,
          env,
          timeout: 120_000,
          maxBuffer: 2000000,
        }));
      } catch (e) {
        stdout = e.stdout;
      }
      const output = String(stdout ?? "").trim();
      let lines;
      try {
        lines = [JSON.parse(output)];
      } catch {
        lines = output
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      }
      if (!lines.length) throw Error();
      if (echo) for (const line of lines) console.log(JSON.stringify(line));
      return lines.at(-1);
    }
    const bench = join(root, "benchmark");
    if (mode === "init") {
      const lock = join(root, ".experiment-init");
      await mkdir(lock, { mode: 0o700 });
      initializationLock = lock;
      if (
        await lstat(bench).then(
          () => true,
          (error) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        )
      ) {
        console.log('{"error":"experimentAlreadyInitializedUseTickOrStatus"}');
        process.exitCode = 1;
        return;
      }
      if (!flags.includes("--local-browser")) {
        const diagnostic = await mkdtemp(join(root, "cf-auth-check-"));
        env.WRANGLER_LOG_PATH = join(diagnostic, "wrangler.log");
        let who;
        let authCheckUnavailable = false;
        try {
          who = await run(
            join(project, "node_modules/wrangler/bin/wrangler.js"),
            ["whoami", "--json"],
            false,
          );
        } catch {
          authCheckUnavailable = true;
        } finally {
          await rm(diagnostic, { recursive: true, force: true });
          delete env.WRANGLER_LOG_PATH;
        }
        if (authCheckUnavailable) {
          console.log('{"error":"cloudflareAuthCheckUnavailable"}');
          process.exitCode = 1;
          return;
        }
        if (
          !who.loggedIn ||
          !who.accounts?.some((a) => a.id === binding.accountId)
        ) {
          console.log('{"error":"cloudflareLoginRequiredForOwnerAccount"}');
          process.exitCode = 1;
          return;
        }
      }
      for (const role of ["active", "idle"]) {
        const result = await run(
          script("carmen-login-lab.mjs"),
          ["check", join(root, role), "--consent", "--grades", "--no-renew"],
          false,
        );
        console.log(
          JSON.stringify({
            event: "initialHostBaseline",
            probe: role,
            success: result.success === true,
            outcome: result.httpCheck?.error ?? result.error ?? "accepted",
            observedAtUTC: result.observation?.observedAtUTC ?? null,
          }),
        );
        if (!result.success || !result.httpCheck?.courseTotalsChecked) {
          console.log('{"error":"initialHostBaselineFailed"}');
          process.exitCode = 1;
          return;
        }
      }
      await run(script("carmen-benchmark.mjs"), [
        "init",
        bench,
        join(root, "active"),
        join(root, "idle"),
        "--consent",
        ...(flags.includes("--local-browser") ? ["--local-browser"] : []),
      ]);
    } else if (mode === "budget")
      await run(script("carmen-browser-budget.mjs"), [bench, "--consent"]);
    else {
      const result = await run(script("carmen-benchmark.mjs"), [
        mode,
        bench,
        "--consent",
      ]);
      if (
        mode === "tick" &&
        flags.includes("--observe-recovery") &&
        !result.error &&
        result.action !== "locked"
      ) {
        const state = JSON.parse(await privateRead(bench, "state.json"));
        const roles = eligibleRenewals(state);
        if (!roles.length) return;
        const events = await readBudgetEvents(bench);
        for (const role of roles) {
          const held = events
            .filter((e) => e.event === "recoveryDeferred" && e.probe === role)
            .at(-1);
          if (held && Date.parse(held.retryAtUTC) > Date.now()) continue;
          let defer = null;
          if (!state.localBrowser) {
            defer = recoveryDeferral(events, state);
            if (!defer) {
              const status = await run(
                script("carmen-cloudflare-status.mjs"),
                [root, "--consent"],
                false,
              );
              if (status.error || !status.usage)
                defer = {
                  reason: "cloudflareBudgetUnknown",
                  retryAtUTC: new Date(Date.now() + 15 * 60_000).toISOString(),
                };
              else if (status.usage.reportedBrowserMs >= 480_000)
                defer = {
                  reason: "accountBrowserAllowanceLow",
                  retryAtUTC: status.usage.freePlanResetAtUTC,
                };
            }
          }
          if (defer) {
            const event = {
              version: 1,
              event: "recoveryDeferred",
              probe: role,
              observedAtUTC: new Date().toISOString(),
              ...defer,
            };
            await recordObservation(bench, event);
            console.log(JSON.stringify(event));
            continue;
          }
          // A separate invocation begins only AFTER the HTTP observation was saved.
          await run(script("carmen-benchmark.mjs"), [
            "renew",
            bench,
            role,
            "--consent",
          ]);
          break; // One browser per tick; avoid bursting both probes at once.
        }
      }
    }
  } catch {
    console.log('{"error":"privateExperimentSetupOrCommandFailed"}');
    process.exitCode = 1;
  } finally {
    if (initializationLock)
      await rm(initializationLock, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => "")) === ownPath
)
  await main();
