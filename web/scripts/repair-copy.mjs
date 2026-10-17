import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { update } from "./update.mjs";
import { workflow } from "./updater-workflow.mjs";
import { releaseVersion } from "../src/release.ts";
const [repo, requested = "0.1.4"] = process.argv.slice(2);
if (
  !repo ||
  !/^[\w-]+\/[\w.-]+$/.test(repo) ||
  !releaseVersion.test(requested.replace(/^v/, ""))
)
  throw new Error(
    "Use: npm run repair:copy -- owner/repository [verified-version]",
  );
if (repo.toLowerCase() === "fiukewhfkje/gradeviewer")
  throw new Error(
    "Use this only for a personal installation, not the official source repository.",
  );
const temporary = await mkdtemp(join(tmpdir(), "gradeviewer-repair-"));
try {
  const cwd = join(temporary, "copy");
  execFileSync("gh", ["repo", "clone", repo, cwd], { stdio: "ignore" });
  let app = cwd;
  try {
    await access(join(cwd, "package.json"));
  } catch {
    app = join(cwd, "web");
  }
  const result = await update(requested, { cwd: app });
  if (!result.launcher || result.launcher.toString() !== workflow)
    throw new Error(
      "The verified release does not contain this reviewed updater launcher. No changes were pushed.",
    );
  await mkdir(join(cwd, ".github/workflows"), { recursive: true });
  await writeFile(
    join(cwd, ".github/workflows/gradeviewer-update.yml"),
    result.launcher,
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (git("status", "--porcelain")) {
    git("config", "user.name", "GradeViewer installation repair");
    git(
      "config",
      "user.email",
      "41898282+github-actions[bot]@users.noreply.github.com",
    );
    git("add", "--", ".");
    git(
      "commit",
      "-m",
      "Repair GradeViewer automatic updates from verified release",
    );
    git("push");
  }
  execFileSync(
    "gh",
    ["workflow", "enable", "gradeviewer-update.yml", "--repo", repo],
    { stdio: "inherit" },
  );
  console.log(
    "Verified source and updater installed. The existing Cloudflare Git connection will build the pushed commit; deployment success must be checked separately.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
