// Read-only account diagnostics, with an optional one-shot blank-browser proof.
// OAuth credentials stay in memory; output contains no identity/session URLs.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { realpath, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createBrowserClient } from "./carmen-browser-client.mjs";
import { labDirectory } from "./carmen-login-lab.mjs";

const execute = promisify(execFile);
const ownPath = fileURLToPath(import.meta.url);
const project = fileURLToPath(new URL("../", import.meta.url));
export function summarizeUsage(groups, now = Date.now()) {
  if (!Array.isArray(groups) || groups.length > 1)
    throw new Error("invalidUsage");
  const ms =
    groups[0]?.sum?.totalSessionDurationMs ?? (groups.length === 0 ? 0 : NaN);
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error("invalidUsage");
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  return {
    reportedBrowserMs: ms,
    freeAllowanceMs: 600_000,
    reportedUsageExceedsFreeAllowance: ms >= 600_000,
    freePlanResetAtUTC: reset.toISOString(),
    planVerified: false,
    analyticsMayLagOrBeSampled: true,
  };
}
export function classifyCloudflareFailure(error) {
  const text =
    String(error?.message ?? "") +
    String(error?.stderr ?? "") +
    String(error?.stdout ?? "");
  return /Browser time limit exceeded/i.test(text)
    ? "dailyBrowserBudgetExceeded"
    : /rate limit exceeded|too many requests|\b429\b/i.test(text)
      ? "cloudflareRateLimited"
      : /\b401\b|\b403\b|unauthoriz/i.test(text)
        ? "cloudflareAuthenticationRejected"
        : "cloudflareTechnicalFailure";
}
async function main() {
  const [path, ...flags] = process.argv.slice(2);
  if (!flags.includes("--consent")) {
    console.log('{"error":"accountHolderPermissionRequired"}');
    process.exitCode = 1;
    return;
  }
  if (
    !path ||
    flags.some((f) => !["--consent", "--probe-launch"].includes(f))
  ) {
    console.log('{"error":"usePrivateDirectoryConsentAndOptionalProbeLaunch"}');
    process.exitCode = 1;
    return;
  }
  let directory, client;
  const report = {
    version: 1,
    observedAtUTC: new Date().toISOString(),
    osuVisited: false,
  };
  try {
    const root = await labDirectory(path);
    directory = await labDirectory(
      join(root, "cloudflare-diagnostic-" + randomUUID()),
      true,
    );
    const command = async (args) =>
      JSON.parse(
        (
          await execute(
            process.execPath,
            [join(project, "node_modules/wrangler/bin/wrangler.js"), ...args],
            {
              cwd: project,
              timeout: 25_000,
              maxBuffer: 2_000_000,
              env: {
                ...process.env,
                DEBUG: "",
                PWDEBUG: "0",
                WRANGLER_SEND_METRICS: "false",
                WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
              },
            },
          )
        ).stdout.trim(),
      );
    const [who, credential] = await Promise.all([
      command(["whoami", "--json"]),
      command(["auth", "token", "--json"]),
    ]);
    if (
      who.accounts?.length !== 1 ||
      !/^[a-f0-9]{32}$/.test(who.accounts[0].id) ||
      typeof credential.token !== "string"
    )
      throw new Error("accountSelectionRequired");
    const id = who.accounts[0].id;
    const headers = {
      Authorization: "Bearer " + credential.token,
      "Content-Type": "application/json",
    };
    const now = new Date(),
      start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400_000);
    const query =
      "query($id:String!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$id}){browserRenderingBrowserTimeUsageAdaptiveGroups(limit:1,filter:{datetime_geq:$start,datetime_lt:$end}){count sum{totalSessionDurationMs}}}}}";
    const [inventory, analytics] = await Promise.all([
      fetch(
        "https://api.cloudflare.com/client/v4/accounts/" +
          id +
          "/browser-rendering/devtools/session",
        { headers, signal: AbortSignal.timeout(15000) },
      ),
      fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
          variables: { id, start: start.toISOString(), end: end.toISOString() },
        }),
        signal: AbortSignal.timeout(15000),
      }),
    ]);
    if (!inventory.ok || !analytics.ok) throw new Error("cloudflareReadFailed");
    const sessions = await inventory.json(),
      data = await analytics.json();
    if (!Array.isArray(sessions) || data.errors?.length)
      throw new Error("invalidCloudflareResponse");
    report.activeBrowsers = sessions.length;
    report.usage = summarizeUsage(
      data.data?.viewer?.accounts?.[0]
        ?.browserRenderingBrowserTimeUsageAdaptiveGroups,
      now.getTime(),
    );
    if (flags.includes("--probe-launch")) {
      client = createBrowserClient(directory);
      try {
        await client.open();
        report.blankBrowserLaunched = true;
      } catch (error) {
        report.blankBrowserLaunched = false;
        report.launchError = classifyCloudflareFailure(error);
      }
    }
  } catch (error) {
    report.error = classifyCloudflareFailure(error);
    process.exitCode = 1;
  } finally {
    if (client) {
      report.cleanupSucceeded = await client.cleanup();
      report.browserLeaseWallMs = client.browserLeaseWallMs();
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    console.log(JSON.stringify(report));
  }
}
if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => "")) === ownPath
)
  await main();
