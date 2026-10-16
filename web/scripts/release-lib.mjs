import { createHash, verify } from "node:crypto";
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export function parseJsonc(input) {
  let text = "",
    quoted = false,
    escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i],
      next = input[i + 1];
    if (quoted) {
      text += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      text += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      text += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      const end = input.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unclosed configuration comment.");
      i = end + 1;
      text += " ";
      continue;
    }
    text += c;
  }
  let cleaned = "";
  quoted = false;
  escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      cleaned += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    if (c === ",") {
      const following = text.slice(i + 1).trimStart()[0];
      if (following === "}" || following === "]") continue;
    }
    cleaned += c;
  }
  return JSON.parse(cleaned);
}
export function verifyRelease(
  manifestBytes,
  signature,
  archiveBytes,
  publicKey,
) {
  if (
    !verify(
      null,
      manifestBytes,
      publicKey,
      Buffer.from(signature.trim(), "base64"),
    )
  )
    throw new Error("Release signature is invalid.");
  const manifest = JSON.parse(manifestBytes);
  if (
    manifest.schema !== 1 ||
    manifest.localSchema !== 1 ||
    !/^0\.\d+\.\d+$/.test(manifest.version) ||
    manifest.archive !== "gradeviewer-source.json" ||
    sha256(archiveBytes) !== manifest.archiveSha256
  )
    throw new Error("Unsupported or damaged release.");
  const archive = JSON.parse(archiveBytes);
  if (
    archive.version !== manifest.version ||
    !Array.isArray(archive.files) ||
    archive.files.length > 500
  )
    throw new Error("Invalid release archive.");
  const paths = new Set();
  let total = 0;
  for (const file of archive.files) {
    if (
      typeof file.path !== "string" ||
      !file.path ||
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path.split("/").some((x) => x === ".." || x === "." || !x) ||
      paths.has(file.path) ||
      file.path
        .split("/")
        .some((x) =>
          [
            "node_modules",
            ".git",
            ".wrangler",
            ".local-test",
            "dist",
            "release",
          ].includes(x),
        ) ||
      (/^(?:\.dev\.vars|\.env)(?:$|\.)/.test(file.path) &&
        file.path !== ".dev.vars.example")
    )
      throw new Error("Unsafe release path.");
    paths.add(file.path);
    const bytes = Buffer.from(file.content, "base64");
    total += bytes.length;
    if (total > 6000000 || sha256(bytes) !== file.sha256)
      throw new Error("Invalid release file.");
  }
  for (const required of [
    "package.json",
    "package-lock.json",
    "wrangler.jsonc",
    "worker/index.ts",
    "src/App.tsx",
    "scripts/update.mjs",
  ])
    if (!paths.has(required)) throw new Error("Incomplete release.");
  return { manifest, archive };
}
