import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { workflow } from "./updater-workflow.mjs";
export async function installationInfo(cwd = process.cwd(), env = process.env) {
  const git = (...args) => {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "";
    }
  };
  const remote = git("remote", "get-url", "origin");
  let safeRemote = remote;
  try {
    const url = new URL(remote);
    safeRemote =
      url.protocol === "https:" && url.hostname === "github.com"
        ? "https://github.com" + url.pathname
        : "";
  } catch {}
  const repository = safeRemote.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:)([\w-]+\/[\w.-]+?)(?:\.git)?$/,
  )?.[1];
  const root = git("rev-parse", "--show-toplevel") || cwd;
  let installed = false;
  try {
    installed =
      (await readFile(
        resolve(root, ".github/workflows/gradeviewer-update.yml"),
        "utf8",
      )) === workflow;
  } catch {}
  let receipt;
  try {
    receipt = JSON.parse(
      await readFile(resolve(cwd, ".gradeviewer-update.json"), "utf8"),
    );
  } catch {}
  return {
    repository,
    branch: env.WORKERS_CI_BRANCH || git("branch", "--show-current") || "main",
    automation: installed ? "installed" : "missing",
    channel: receipt?.channel === "preview" ? "preview" : "stable",
    // Source presence does not establish that GitHub Actions is enabled.
    checkedAt:
      typeof receipt?.checkedAt === "string" ? receipt.checkedAt : undefined,
  };
}
