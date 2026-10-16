import {
  readFile,
  writeFile,
  mkdir,
  rename,
  lstat,
  unlink,
} from "node:fs/promises";
import { dirname } from "node:path";
import { verifyRelease, parseJsonc } from "./release-lib.mjs";
const upstream = "fiukewhfkje/GradeViewer",
  requested = process.argv[2];
if (requested && !/^v?0\.\d+\.\d+$/.test(requested))
  throw new Error("Choose a version such as 0.1.0.");
const local = JSON.parse(await readFile("package.json", "utf8"));
async function download(url, max = 6000000) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["api.github.com", "github.com"].includes(parsed.hostname)
  )
    throw new Error("Invalid download origin.");
  const r = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error("Release download failed.");
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > max) throw new Error("Release is too large.");
  return bytes;
}
const release = JSON.parse(
  await download(
    `https://api.github.com/repos/${upstream}/releases/${requested ? "tags/v" + requested.replace(/^v/, "") : "latest"}`,
  ),
);
if (
  release.draft ||
  release.prerelease ||
  !/^v0\.\d+\.\d+$/.test(release.tag_name)
)
  throw new Error("Expected a stable GradeViewer release.");
const version = release.tag_name.slice(1),
  greater = (a, b) => {
    const x = a.split(".").map(Number),
      y = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if (x[i] !== y[i]) return x[i] > y[i];
    }
    return false;
  };
if (!requested && !greater(version, local.version)) {
  console.log(`GradeViewer ${local.version} is current.`);
  process.exit(0);
}
const asset = (name) => {
  const a = release.assets.find((a) => a.name === name),
    expected = `https://github.com/${upstream}/releases/download/${release.tag_name}/${name}`;
  if (!a || a.browser_download_url !== expected)
    throw new Error("Missing official release asset.");
  return a.browser_download_url;
};
const manifestBytes = await download(asset("manifest.json"), 20000),
  signature = (await download(asset("manifest.sig"), 1000)).toString(),
  archiveBytes = await download(asset("gradeviewer-source.json"));
const { archive, manifest } = verifyRelease(
  manifestBytes,
  signature,
  archiveBytes,
  await readFile("scripts/release-public-key.pem"),
);
if (manifest.version !== version) throw new Error("Release version mismatch.");
const currentConfig = parseJsonc(await readFile("wrangler.jsonc", "utf8"));
// Verify everything before touching the checkout. Never overwrite local secrets or workflows.
for (const file of archive.files) {
  if (file.path.startsWith(".github/")) continue;
  let parent = dirname(file.path);
  while (parent !== ".") {
    try {
      if ((await lstat(parent)).isSymbolicLink())
        throw new Error("Symlink in checkout.");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    parent = dirname(parent);
  }
  try {
    if ((await lstat(file.path)).isSymbolicLink())
      throw new Error("Symlink in checkout.");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const staged = [];
try {
  for (const file of archive.files) {
    if (file.path.startsWith(".github/")) continue;
    let content = Buffer.from(file.content, "base64");
    if (file.path === "wrangler.jsonc") {
      const next = parseJsonc(content.toString());
      for (const key of [
        "name",
        "routes",
        "route",
        "workers_dev",
        "preview_urls",
        "vars",
        "limits",
        "placement",
      ])
        if (currentConfig[key] !== undefined) next[key] = currentConfig[key];
      content = Buffer.from(JSON.stringify(next, null, 2) + "\n");
    }
    await mkdir(dirname(file.path), { recursive: true });
    const temp = file.path + ".gv-update";
    await writeFile(temp, content);
    staged.push([temp, file.path]);
  }
  for (const [temp, path] of staged) await rename(temp, path);
} finally {
  for (const [temp] of staged) await unlink(temp).catch(() => {});
}
console.log(
  `Updated GradeViewer source to ${version}. Cloudflare will deploy the pushed commit.`,
);
