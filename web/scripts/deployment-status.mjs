import { execFileSync } from "node:child_process";
export function cloudflareBuildStatus(checks) {
  const builds =
    checks?.check_runs?.filter(
      (check) => check.app?.slug === "cloudflare-workers-and-pages",
    ) ?? [];
  if (!builds.length) return "unknown";
  if (builds.some((check) => check.status !== "completed")) return "pending";
  if (
    builds.some((check) =>
      [
        "failure",
        "cancelled",
        "timed_out",
        "action_required",
        "startup_failure",
      ].includes(check.conclusion),
    )
  )
    return "failed";
  return builds.every((check) => check.conclusion === "success")
    ? "success"
    : "unknown";
}
export function currentDeployment(cwd = process.cwd()) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[\w-]+\/[\w.-]+$/.test(repo) || !process.env.GH_TOKEN)
    return "unknown";
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim();
    const checks = JSON.parse(
      execFileSync(
        "gh",
        ["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`],
        {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 20000,
        },
      ),
    );
    return cloudflareBuildStatus(checks);
  } catch {
    return "unknown";
  }
}
