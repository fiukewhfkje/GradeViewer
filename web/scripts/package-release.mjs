import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { sign } from "node:crypto";
import { sha256, verifyRelease } from "./release-lib.mjs";
const pkg = JSON.parse(await readFile("package.json", "utf8")),
  version = pkg.version;
if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== "v" + version
)
  throw new Error("Release tag must match package.json version.");
const roots = ["src", "worker", "public", "scripts", "tests", ".github"],
  files = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const p = path + "/" + entry.name;
    if (entry.isDirectory()) await walk(p);
    else if (entry.isFile()) files.push(p);
    else throw new Error("Links are not permitted in release sources.");
  }
}
for (const root of roots) await walk(root);
files.push(
  "README.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "wrangler.jsonc",
  "wrangler.test.jsonc",
  "index.html",
  ".gitignore",
  ".dev.vars.example",
);
const archive = Buffer.from(
  JSON.stringify({
    version,
    files: await Promise.all(
      files.sort().map(async (path) => {
        const content = await readFile(path);
        return {
          path,
          content: content.toString("base64"),
          sha256: sha256(content),
        };
      }),
    ),
  }),
);
const manifest = Buffer.from(
  JSON.stringify({
    schema: 1,
    version,
    localSchema: 1,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    archive: "gradeviewer-source.json",
    archiveSha256: sha256(archive),
  }) + "\n",
);
const privateKey =
  process.env.RELEASE_SIGNING_KEY ??
  (await readFile(".local-test/release-signing.pem", "utf8"));
const signature = sign(null, manifest, privateKey).toString("base64") + "\n";
verifyRelease(
  manifest,
  signature,
  archive,
  await readFile("scripts/release-public-key.pem"),
);
for (const secretName of [
  "SCHOOLOGY_API_KEY",
  "SCHOOLOGY_API_SECRET",
  "APP_PASSWORD",
]) {
  const value = process.env[secretName];
  if (
    value &&
    value.length >= 8 &&
    files.length &&
    (archive.includes(Buffer.from(value)) ||
      JSON.parse(archive).files.some((f) =>
        Buffer.from(f.content, "base64").includes(Buffer.from(value)),
      ))
  )
    throw new Error("Sensitive runtime material found in release source.");
}
await mkdir("release", { recursive: true });
await writeFile("release/gradeviewer-source.json", archive);
await writeFile("release/manifest.json", manifest);
await writeFile("release/manifest.sig", signature);
console.log(
  `Packaged signed GradeViewer ${version} (${files.length} source files).`,
);
