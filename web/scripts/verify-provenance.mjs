import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Trust GitHub's maintained Sigstore verifier, with an exact release identity.
// Never accept a signature merely because it was produced somewhere on GitHub.
export async function verifyProvenance(
  manifestBytes,
  bundle,
  version,
  run = spawnSync,
) {
  const manifest = JSON.parse(manifestBytes);
  if (
    manifest.schema !== 2 ||
    manifest.verification !== "github-attestation" ||
    manifest.version !== version ||
    !/^0\.\d+\.\d+$/.test(version) ||
    !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)
  )
    throw new Error("Unsupported release provenance.");
  const directory = await mkdtemp(join(tmpdir(), "gradeviewer-provenance-"));
  try {
    const path = join(directory, "manifest.json"),
      attestation = join(directory, "provenance.json");
    await writeFile(path, manifestBytes, { mode: 0o600 });
    await writeFile(attestation, bundle, { mode: 0o600 });
    const result = run(
      "gh",
      [
        "attestation",
        "verify",
        path,
        "--repo",
        "fiukewhfkje/GradeViewer",
        "--bundle",
        attestation,
        "--signer-workflow",
        "fiukewhfkje/GradeViewer/.github/workflows/pwa.yml",
        "--source-ref",
        "refs/tags/v" + version,
        "--source-digest",
        manifest.sourceCommit,
        "--deny-self-hosted-runners",
        "--format",
        "json",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 1000000,
        env: { ...process.env, GH_HOST: "github.com" },
      },
    );
    if (result.status !== 0 || result.error)
      throw new Error(
        "Release provenance verification failed. Use a current GitHub CLI and an official signed release.",
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
