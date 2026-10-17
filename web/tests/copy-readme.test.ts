import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error Plain Node release tooling.
import * as readmeSetup from "../scripts/configure-copy-readme.mjs";
const { configureCopyReadme, copyReadme } = readmeSetup;

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function installation() {
  const directory = await mkdtemp(join(tmpdir(), "gradeviewer-readme-"));
  directories.push(directory);
  const root = join(directory, "copy"),
    cwd = join(root, "web");
  await mkdir(cwd, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Synthetic owner");
  git("config", "user.email", "synthetic@example.invalid");
  await writeFile(
    join(root, "README.md"),
    "# Original template instructions\n",
  );
  await writeFile(join(cwd, "package.json"), '{"version":"0.1.7"}\n');
  git("add", ".");
  git("commit", "-m", "Initial template copy");
  const sha = git("rev-parse", "HEAD");
  const eventPath = join(directory, "event.json");
  await writeFile(
    eventPath,
    JSON.stringify({
      before: "0".repeat(40),
      after: sha,
      created: true,
      deleted: false,
      ref: "refs/heads/main",
      repository: { full_name: "synthetic-owner/copy", default_branch: "main" },
    }),
  );
  const env = {
    ...process.env,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "synthetic-owner/copy",
    GITHUB_SHA: sha,
  };
  const options = {
    cwd,
    env,
    repositoryInfo: async () => ({
      template_repository: { full_name: "fiukewhfkje/GradeViewer" },
    }),
  };
  return { root, cwd, directory, git, env, eventPath, options };
}
it("automatically commits the initial README link with the app receipt, leaving unrelated root files alone", async () => {
  const i = await installation(),
    remote = join(i.directory, "remote.git");
  execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
  i.git("remote", "add", "origin", remote);
  i.git("push", "-u", "origin", "main");
  await writeFile(join(i.root, "owner-notes.txt"), "unrelated local work");
  await writeFile(
    join(i.cwd, ".gradeviewer-update.json"),
    '{"version":"0.1.7"}',
  );
  expect(await configureCopyReadme(i.options)).toBe(true);
  expect(await readFile(join(i.root, "README.md"), "utf8")).toBe(copyReadme);
  expect(copyReadme).toContain(
    "https://github.com/fiukewhfkje/GradeViewer#readme",
  );
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/push-update.mjs", import.meta.url))],
    { cwd: i.cwd, stdio: "pipe" },
  );
  expect(
    i
      .git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
      .split("\n"),
  ).toEqual(["README.md", "web/.gradeviewer-update.json"]);
  expect(i.git("status", "--porcelain")).toBe("?? owner-notes.txt");
  expect(
    execFileSync("git", ["--git-dir=" + remote, "show", "main:README.md"], {
      encoding: "utf8",
    }),
  ).toBe(copyReadme);
});
it("preserves owner changes before the first run and after initialization, including reruns", async () => {
  const i = await installation();
  await writeFile(join(i.root, "README.md"), "# Owner customization\n");
  expect(await configureCopyReadme(i.options)).toBe(false);
  i.git("add", "README.md");
  i.git("commit", "-m", "Customize README");
  expect(await configureCopyReadme(i.options)).toBe(false);
  expect(
    await configureCopyReadme({
      ...i.options,
      env: { ...i.env, GITHUB_SHA: i.git("rev-parse", "HEAD") },
    }),
  ).toBe(false);
  expect(await readFile(join(i.root, "README.md"), "utf8")).toBe(
    "# Owner customization\n",
  );
  const fresh = await installation();
  expect(await configureCopyReadme(fresh.options)).toBe(true);
  expect(await configureCopyReadme(fresh.options)).toBe(false);
  fresh.git("commit", "-m", "Configure README");
  await writeFile(join(fresh.root, "README.md"), "# My personal README\n");
  fresh.git("add", "README.md");
  fresh.git("commit", "-m", "Personalize README");
  expect(await configureCopyReadme(fresh.options)).toBe(false);
  expect(await readFile(join(fresh.root, "README.md"), "utf8")).toBe(
    "# My personal README\n",
  );
});
it("never rewrites the official repository, ordinary checkouts, scheduled/manual updates, or isolated app roots", async () => {
  const i = await installation();
  const noMetadata = async () => {
    throw new Error("Metadata must not be requested");
  };
  for (const options of [
    {
      ...i.options,
      env: { ...i.env, GITHUB_REPOSITORY: "FIUKEWHFKJE/gradeviewer" },
    },
    { ...i.options, env: {} },
    { ...i.options, env: { ...i.env, GITHUB_EVENT_NAME: "schedule" } },
    { ...i.options, env: { ...i.env, GITHUB_EVENT_NAME: "workflow_dispatch" } },
    { ...i.options, cwd: i.root },
  ])
    expect(
      await configureCopyReadme({ ...options, repositoryInfo: noMetadata }),
    ).toBe(false);
  expect(await readFile(join(i.root, "README.md"), "utf8")).toBe(
    "# Original template instructions\n",
  );
});
it("requires an official template relationship and the initial default-branch push", async () => {
  const i = await installation();
  expect(
    await configureCopyReadme({
      ...i.options,
      repositoryInfo: async () => ({
        template_repository: { full_name: "someone/another-template" },
      }),
    }),
  ).toBe(false);
  const event = JSON.parse(await readFile(i.eventPath, "utf8"));
  for (const change of [
    { before: "1".repeat(40), created: false },
    { ref: "refs/heads/other" },
    { repository: { full_name: "someone/else", default_branch: "main" } },
  ]) {
    await writeFile(i.eventPath, JSON.stringify({ ...event, ...change }));
    expect(await configureCopyReadme(i.options)).toBe(false);
  }
  expect(await readFile(join(i.root, "README.md"), "utf8")).toBe(
    "# Original template instructions\n",
  );
});
it("does not follow README symlinks or write before repository metadata is confirmed", async () => {
  const i = await installation();
  await expect(
    configureCopyReadme({
      ...i.options,
      repositoryInfo: async () => {
        throw new Error("Metadata unavailable");
      },
    }),
  ).rejects.toThrow("Metadata unavailable");
  expect(await readFile(join(i.root, "README.md"), "utf8")).toBe(
    "# Original template instructions\n",
  );
  const outside = join(i.directory, "outside.md");
  await writeFile(outside, "# Preserve this file\n");
  await rm(join(i.root, "README.md"));
  await symlink(outside, join(i.root, "README.md"));
  expect(await configureCopyReadme(i.options)).toBe(false);
  expect(await readFile(outside, "utf8")).toBe("# Preserve this file\n");
});
