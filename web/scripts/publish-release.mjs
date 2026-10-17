import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releaseVersion, upstream } from "../src/release.ts";
export function releaseArguments(version, environment = process.env) {
  if (
    !releaseVersion.test(version) ||
    environment.GITHUB_REF_TYPE !== "tag" ||
    environment.GITHUB_REF_NAME !== "v" + version ||
    environment.GITHUB_REPOSITORY !== upstream
  )
    throw new Error(
      "Only the official matching release tag can publish this package.",
    );
  const directory = fileURLToPath(new URL("../release/", import.meta.url));
  return [
    "release",
    "create",
    "v" + version,
    ...["gradeviewer-source.json", "manifest.json", "provenance.json"].map(
      (name) => directory + name,
    ),
    "--verify-tag",
    "--generate-notes",
    "--title",
    "GradeViewer v" + version,
    ...(version.includes("-")
      ? ["--prerelease", "--latest=false"]
      : ["--latest"]),
  ];
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  execFileSync("gh", releaseArguments(pkg.version), { stdio: "inherit" });
}
