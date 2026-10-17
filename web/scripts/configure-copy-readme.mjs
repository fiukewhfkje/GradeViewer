import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { upstream } from "../src/release.ts";

export const copyReadme = `# GradeViewer

This is your personal GradeViewer copy.

[Current setup, usage, and update instructions](https://github.com/${upstream}#readme)

After setup, published app updates are installed automatically. You can customize this README without affecting app updates.
`;

export async function configureCopyReadme({
  cwd = process.cwd(),
  env = process.env,
  repositoryInfo = (repo) =>
    JSON.parse(
      execFileSync("gh", ["api", `repos/${repo}`], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20000,
        maxBuffer: 1000000,
      }),
    ),
} = {}) {
  const repository = env.GITHUB_REPOSITORY;
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "push" ||
    !env.GITHUB_EVENT_PATH ||
    !/^[\w-]+\/[\w.-]+$/.test(repository ?? "") ||
    repository.toLowerCase() === upstream.toLowerCase() ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")
  )
    return false;
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
  if (
    event.created !== true ||
    event.deleted ||
    !/^0{40}$/.test(event.before ?? "") ||
    event.after !== env.GITHUB_SHA ||
    event.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
    event.ref !== `refs/heads/${event.repository?.default_branch}`
  )
    return false;
  const git = (directory, ...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const root = await realpath(git(cwd, "rev-parse", "--show-toplevel"));
  // Only the full GitHub template copy has a separate, owner-editable README.
  // cat-file retains real parent headers even in checkout's shallow clone.
  if (
    (await realpath(cwd)) !== join(root, "web") ||
    git(root, "rev-parse", "HEAD") !== env.GITHUB_SHA ||
    /^parent /m.test(git(root, "cat-file", "-p", "HEAD").split("\n\n")[0]) ||
    git(root, "status", "--porcelain", "--", "README.md")
  )
    return false;
  const path = join(root, "README.md");
  if (!(await lstat(path)).isFile()) return false;
  const info = await repositoryInfo(repository);
  if (
    info.template_repository?.full_name?.toLowerCase() !==
    upstream.toLowerCase()
  )
    return false;
  const original = await readFile(path);
  try {
    await writeFile(path, copyReadme);
    // push-update runs from web/. Stage this one parent file explicitly so its
    // existing commit also includes it, without staging unrelated root files.
    git(root, "add", "--", "README.md");
  } catch (error) {
    await writeFile(path, original);
    throw error;
  }
  console.log(
    "Linked this installation's README to the official instructions.",
  );
  return true;
}
