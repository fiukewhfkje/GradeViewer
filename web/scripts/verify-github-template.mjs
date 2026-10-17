// Opt-in live GitHub test. Creates two private, synthetic fixture repositories
// under the authenticated owner. This is NOT independent Cloudflare E2E.
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { workflow } from "./updater-workflow.mjs";
if (!process.argv.includes("--create-fixtures"))
  throw new Error("Live repository creation requires --create-fixtures.");
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const owner = JSON.parse(gh("api", "user")).login;
const suffix = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const sourceName = `gradeviewer-template-probe-${suffix}`,
  copyName = `gradeviewer-install-probe-${suffix}`;
const dir = await mkdtemp(join(tmpdir(), "gradeviewer-github-template-"));
let sequence = 0;
async function request(method, endpoint, data) {
  const file = join(dir, `request-${sequence++}.json`);
  await writeFile(file, JSON.stringify(data));
  const out = gh("api", "--method", method, endpoint, "--input", file);
  return out ? JSON.parse(out) : undefined;
}
await request("POST", "user/repos", {
  name: sourceName,
  private: true,
  is_template: true,
  description:
    "Synthetic GradeViewer setup verification fixture; no student data or secrets.",
});
await request("PUT", `repos/${owner}/${sourceName}/actions/permissions`, {
  enabled: false,
});
const checkout = join(dir, "source");
await mkdir(join(checkout, ".github/workflows"), { recursive: true });
await mkdir(join(checkout, "scripts"));
await mkdir(join(checkout, "src"));
await writeFile(
  join(checkout, ".github/workflows/gradeviewer-update.yml"),
  workflow,
);
for (const file of [
  "update.mjs",
  "push-update.mjs",
  "release-lib.mjs",
  "verify-provenance.mjs",
  "updater-workflow.mjs",
  "deployment-status.mjs",
])
  await copyFile(resolve("scripts", file), join(checkout, "scripts", file));
await copyFile(resolve("src/release.ts"), join(checkout, "src/release.ts"));
await copyFile(resolve(".gitignore"), join(checkout, ".gitignore"));
await writeFile(
  join(checkout, "package.json"),
  JSON.stringify({
    name: "gradeviewer-bootstrap-fixture",
    version: "0.1.3",
    private: true,
    type: "module",
  }),
);
await writeFile(
  join(checkout, "wrangler.jsonc"),
  JSON.stringify({
    name: copyName,
    vars: { SYNTHETIC_SETTING: "preserve" },
    durable_objects: {
      bindings: [{ name: "VAULT", class_name: "CredentialVault" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["CredentialVault"] }],
  }),
);
const git = (...args) =>
  execFileSync("git", args, {
    cwd: checkout,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
git("init", "--initial-branch=main");
git("config", "user.name", "GradeViewer setup verification");
git(
  "config",
  "user.email",
  "41898282+github-actions[bot]@users.noreply.github.com",
);
git("add", ".");
git("commit", "-m", "Synthetic automatic updater template fixture");
git("remote", "add", "origin", `https://github.com/${owner}/${sourceName}.git`);
git("push", "-u", "origin", "main");
const copy = await request("POST", `repos/${owner}/${sourceName}/generate`, {
  owner,
  name: copyName,
  private: true,
  include_all_branches: false,
});
const result = {
  source: `https://github.com/${owner}/${sourceName}`,
  copy: copy.html_url,
  createdAt: new Date().toISOString(),
  scope:
    "Real GitHub template generation only. Same owner; no Cloudflare deployment or independent account.",
  temporaryDirectory: dir,
};
await mkdir(".local-test", { recursive: true });
await writeFile(
  ".local-test/github-template-live.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
