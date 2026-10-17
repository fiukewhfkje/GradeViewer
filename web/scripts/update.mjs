import {
  readFile,
  writeFile,
  mkdir,
  rename,
  lstat,
  unlink,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { currentDeployment } from "./deployment-status.mjs";
import { verifyArchive, parseJsonc } from "./release-lib.mjs";
import { verifyProvenance } from "./verify-provenance.mjs";
import {
  upstream,
  officialRelease,
  compareVersions,
  releaseVersion,
} from "../src/release.ts";

export async function download(url, max = 6000000) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["api.github.com", "github.com"].includes(parsed.hostname)
  )
    throw new Error("Invalid download origin.");
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body)
    throw new Error(
      "Release download failed. Retry later; the deployed app is unchanged.",
    );
  const chunks = [],
    reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error("Release is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export function mergeConfiguration(current, next) {
  const merged = { ...next, ...current };
  for (const key of [
    "$schema",
    "main",
    "compatibility_date",
    "compatibility_flags",
    "assets",
  ])
    if (next[key] !== undefined) merged[key] = next[key];
  // The existing namespace and migration history own the encrypted connection.
  merged.migrations = [...(current.migrations ?? [])];
  for (const migration of next.migrations ?? []) {
    const existing = merged.migrations.find((m) => m.tag === migration.tag);
    if (existing && !isDeepStrictEqual(existing, migration))
      throw new Error(
        "Migration history conflict. Manual review is required; storage is unchanged.",
      );
    if (!existing) merged.migrations.push(migration);
  }
  const bindings = [...(current.durable_objects?.bindings ?? [])];
  for (const binding of next.durable_objects?.bindings ?? []) {
    const existing = bindings.find((b) => b.name === binding.name);
    if (existing && existing.class_name !== binding.class_name)
      throw new Error("Credential namespace change requires manual review.");
    if (!existing) bindings.push(binding);
  }
  merged.durable_objects = {
    ...next.durable_objects,
    ...current.durable_objects,
    bindings,
  };
  return merged;
}
export async function applyRelease(
  manifestBytes,
  archiveBytes,
  { cwd = process.cwd(), rollback = false, move = rename } = {},
) {
  const { archive, manifest } = verifyArchive(manifestBytes, archiveBytes);
  if (manifest.updaterProtocol !== undefined && manifest.updaterProtocol !== 1)
    throw new Error(
      "This release needs a newer updater launcher. Review the installation setup before updating.",
    );
  const pkgFile = archive.files.find((f) => f.path === "package.json");
  if (
    JSON.parse(Buffer.from(pkgFile.content, "base64")).version !==
    manifest.version
  )
    throw new Error("Release package version mismatch.");
  const currentConfig = parseJsonc(
    await readFile(join(cwd, "wrangler.jsonc"), "utf8"),
  );
  const kernel = new Set([
    "scripts/update.mjs",
    "scripts/push-update.mjs",
    "scripts/release-lib.mjs",
    "scripts/verify-provenance.mjs",
    "scripts/updater-workflow.mjs",
    "scripts/deployment-status.mjs",
    "src/release.ts",
  ]);
  const changes = [];
  for (const file of archive.files) {
    // GITHUB_TOKEN cannot update workflows. The installed launcher is stable;
    // future signed runtime scripts use it without changing its permissions.
    if (
      file.path.startsWith(".github/") ||
      ((rollback || !manifest.updaterProtocol) && kernel.has(file.path))
    )
      continue;
    const path = join(cwd, file.path);
    let parent = dirname(path);
    while (parent !== cwd) {
      const entry = await lstat(parent).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      if (entry?.isSymbolicLink() || (entry && !entry.isDirectory()))
        throw new Error("Unsafe checkout path.");
      parent = dirname(parent);
    }
    const entry = await lstat(path).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    if (entry && !entry.isFile()) throw new Error("Unsafe checkout file.");
    let content = Buffer.from(file.content, "base64");
    if (file.path === "wrangler.jsonc")
      content = Buffer.from(
        JSON.stringify(
          mergeConfiguration(currentConfig, parseJsonc(content.toString())),
          null,
          2,
        ) + "\n",
      );
    changes.push({
      path,
      content,
      original: entry ? await readFile(path) : undefined,
      mode: entry?.mode,
    });
  }
  // Stage outside the checkout, using unpredictable names. Pre-existing .gv-update
  // symlinks must never redirect writes into secrets or unrelated files.
  const staging = await mkdtemp(join(cwd, ".gradeviewer-stage-"));
  const applied = [];
  try {
    for (let i = 0; i < changes.length; i++)
      await writeFile(join(staging, String(i)), changes[i].content);
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      await mkdir(dirname(change.path), { recursive: true });
      await move(join(staging, String(i)), change.path);
      applied.push(change);
    }
  } catch (error) {
    for (const change of applied.reverse()) {
      if (change.original === undefined) await unlink(change.path);
      else await writeFile(change.path, change.original, { mode: change.mode });
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return manifest;
}
export async function update(
  requested = process.argv[2],
  {
    get = download,
    verify = verifyProvenance,
    now = new Date(),
    cwd = process.cwd(),
    channel: requestedChannel = process.env.REQUESTED_CHANNEL,
    deployment = currentDeployment,
  } = {},
) {
  if (requested) requested = requested.replace(/^v/, "");
  if (requested && !releaseVersion.test(requested))
    throw new Error("Choose an official GradeViewer version.");
  let receipt;
  const receiptPath = join(cwd, ".gradeviewer-update.json");
  try {
    receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const channel = requestedChannel || receipt?.channel || "stable";
  if (!["stable", "preview"].includes(channel))
    throw new Error("Choose stable or preview.");
  const local = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  const endpoint = requested
    ? "releases/tags/v" + requested
    : channel === "preview"
      ? "releases?per_page=100"
      : "releases/latest";
  const metadata = JSON.parse(
    await get(`https://api.github.com/repos/${upstream}/${endpoint}`, 1000000),
  );
  const release = Array.isArray(metadata)
    ? metadata
        .filter((r) => {
          try {
            officialRelease(r, channel);
            return true;
          } catch {
            return false;
          }
        })
        .sort((a, b) =>
          compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)),
        )[0]
    : metadata;
  const { version } = officialRelease(release, channel);
  const comparison = compareVersions(version, local.version);
  const build = !requested && comparison === 0 ? deployment(cwd) : "unknown";
  const retry = build === "failed" && (receipt?.deploymentRetries ?? 0) < 3;
  let applied = false;
  let launcher;
  if (requested || comparison > 0) {
    const asset = (name) => {
      const expected = `https://github.com/${upstream}/releases/download/v${version}/${name}`;
      if (
        release.assets?.filter(
          (a) => a.name === name && a.browser_download_url === expected,
        ).length !== 1
      )
        throw new Error("Missing official release asset.");
      return expected;
    };
    const manifest = await get(asset("manifest.json"), 20000);
    const provenance = await get(asset("provenance.json"), 200000);
    await verify(manifest, provenance, version);
    const archive = await get(asset("gradeviewer-source.json"));
    if (JSON.parse(manifest).version !== version)
      throw new Error("Release version mismatch.");
    await applyRelease(manifest, archive, { cwd, rollback: comparison < 0 });
    const verified = verifyArchive(manifest, archive);
    const file = verified.archive.files.find(
      (file) => file.path === ".github/workflows/gradeviewer-update.yml",
    );
    if (file) launcher = Buffer.from(file.content, "base64");
    applied = true;
  }
  // A monthly heartbeat avoids an idle default branch without rebuilding daily.
  // It cannot override owner/org suspension of Actions or account billing limits.
  if (
    applied ||
    retry ||
    receipt?.channel !== channel ||
    !receipt?.checkedAt ||
    now.getTime() - Date.parse(receipt.checkedAt) >= 28 * 86400000
  ) {
    await writeFile(
      receiptPath,
      JSON.stringify(
        {
          schema: 1,
          channel,
          version: applied ? version : local.version,
          checkedAt: now.toISOString(),
          deploymentRetries: applied
            ? 0
            : retry
              ? (receipt?.deploymentRetries ?? 0) + 1
              : (receipt?.deploymentRetries ?? 0),
        },
        null,
        2,
      ) + "\n",
    );
  }
  console.log(
    applied
      ? `Verified GradeViewer ${version}; push this commit for Cloudflare Builds.`
      : `GradeViewer ${local.version} has no newer ${channel} release.`,
  );
  if (retry)
    console.log(
      "The previous Cloudflare build failed; the next push requests a deployment retry.",
    );
  else if (build === "failed")
    throw new Error(
      "Cloudflare deployment failed repeatedly. Review its build error before retrying; the prior deployment and data are retained.",
    );
  return { applied, version, channel, launcher };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await update();
