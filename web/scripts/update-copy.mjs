import { execFileSync } from "node:child_process";
import { releaseVersion } from "../src/release.ts";
const [repo, ...options] = process.argv.slice(2);
if (!repo || !/^[\w-]+\/[\w.-]+$/.test(repo))
  throw new Error(
    "Use: npm run update:copy -- owner/repository [--version 0.1.4] [--preview|--stable]",
  );
const index = options.indexOf("--version");
const version = index >= 0 ? options[index + 1]?.replace(/^v/, "") : undefined;
if (index >= 0 && (!version || !releaseVersion.test(version)))
  throw new Error("Choose an official version.");
const permitted = new Set([
  "--preview",
  "--stable",
  "--version",
  version,
  version && "v" + version,
]);
if (
  options.some((option) => !permitted.has(option)) ||
  (options.includes("--preview") && options.includes("--stable"))
)
  throw new Error("Invalid update options.");
const gh = (...args) => execFileSync("gh", args, { stdio: "inherit" });
// Maintainer shortcut: use the already authenticated CLI, never ask app users
// for a token or put a maintainer credential into their Worker or repository.
gh("workflow", "enable", "gradeviewer-update.yml", "--repo", repo);
const args = ["workflow", "run", "gradeviewer-update.yml", "--repo", repo];
if (version) args.push("-f", "version=" + version);
if (options.includes("--preview")) args.push("-f", "channel=preview");
if (options.includes("--stable")) args.push("-f", "channel=stable");
gh(...args);
