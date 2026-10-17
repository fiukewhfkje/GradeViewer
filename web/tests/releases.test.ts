import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
// @ts-expect-error Node release scripts are intentionally plain JavaScript.
import { sha256, verifyRelease, parseJsonc } from "../scripts/release-lib.mjs";
describe("signed update verification", () => {
  const keys = generateKeyPairSync("ed25519"),
    publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  function release(path?: string) {
    const files = [
        "package.json",
        "package-lock.json",
        "wrangler.jsonc",
        "worker/index.ts",
        "src/App.tsx",
        "scripts/update.mjs",
        ...(path ? [path] : []),
      ].map((path) => ({
        path,
        content: Buffer.from("{}").toString("base64"),
        sha256: sha256(Buffer.from("{}")),
      })),
      archive = Buffer.from(JSON.stringify({ version: "0.1.0", files })),
      manifest = Buffer.from(
        JSON.stringify({
          schema: 1,
          version: "0.1.0",
          localSchema: 1,
          archive: "gradeviewer-source.json",
          archiveSha256: sha256(archive),
        }),
      ),
      signature = sign(null, manifest, keys.privateKey).toString("base64");
    return { archive, manifest, signature };
  }
  it("accepts a signed complete release", () => {
    const r = release();
    expect(
      verifyRelease(r.manifest, r.signature, r.archive, publicKey).manifest
        .version,
    ).toBe("0.1.0");
  });
  it("rejects altered archives and untrusted signing keys", () => {
    const r = release();
    expect(() =>
      verifyRelease(
        r.manifest,
        r.signature,
        Buffer.from("tampered"),
        publicKey,
      ),
    ).toThrow();
    const other = generateKeyPairSync("ed25519");
    expect(() =>
      verifyRelease(r.manifest, r.signature, r.archive, other.publicKey),
    ).toThrow();
  });
  it.each([
    "../escape",
    "/absolute",
    "src/../../escape",
    ".dev.vars",
    ".env.production",
    "node_modules/bad",
    "src/.git/config",
  ])("rejects unsafe archive path %s", (path) => {
    const r = release(path);
    expect(() =>
      verifyRelease(r.manifest, r.signature, r.archive, publicKey),
    ).toThrow();
  });
});

describe("generated JSONC configuration", () => {
  it("accepts comments and trailing commas while preserving URL strings", () => {
    expect(
      parseJsonc(
        '{/* generated */"name":"personal", "vars":{"URL":"https://example.test/a//b",},// keep\n}',
      ),
    ).toEqual({ name: "personal", vars: { URL: "https://example.test/a//b" } });
  });
});
