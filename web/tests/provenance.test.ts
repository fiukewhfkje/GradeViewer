import { describe, it, expect } from "vitest";
// @ts-expect-error Node release scripts are intentionally plain JavaScript.
import { verifyProvenance } from "../scripts/verify-provenance.mjs";
const manifest = (change = {}) =>
  Buffer.from(
    JSON.stringify({
      schema: 2,
      verification: "github-attestation",
      version: "0.1.0",
      sourceCommit: "a".repeat(40),
      ...change,
    }),
  );
describe("official release provenance policy", () => {
  it("requires the exact official workflow, release tag, source commit and hosted runner", async () => {
    let called = false;
    await verifyProvenance(
      manifest(),
      Buffer.from("{}"),
      "0.1.0",
      (command: string, args: string[]) => {
        called = true;
        expect(command).toBe("gh");
        for (const [flag, value] of [
          ["--repo", "fiukewhfkje/GradeViewer"],
          [
            "--signer-workflow",
            "fiukewhfkje/GradeViewer/.github/workflows/pwa.yml",
          ],
          ["--source-ref", "refs/tags/v0.1.0"],
          ["--source-digest", "a".repeat(40)],
        ])
          expect(args[args.indexOf(flag) + 1]).toBe(value);
        expect(args).toContain("--deny-self-hosted-runners");
        return { status: 0 };
      },
    );
    expect(called).toBe(true);
  });
  it("fails closed when the real verifier rejects a signature or is unavailable", async () => {
    for (const result of [
      { status: 1 },
      { status: null, error: new Error("missing gh") },
    ])
      await expect(
        verifyProvenance(manifest(), Buffer.from("{}"), "0.1.0", () => result),
      ).rejects.toThrow("verification failed");
  });
  it.each([
    { schema: 1 },
    { verification: "untrusted" },
    { version: "0.2.0" },
    { sourceCommit: "main" },
  ])(
    "rejects unsupported provenance before invoking a verifier: %j",
    async (change) => {
      await expect(
        verifyProvenance(manifest(change), Buffer.from("{}"), "0.1.0", () => {
          throw new Error("must not run");
        }),
      ).rejects.toThrow("Unsupported release provenance");
    },
  );
});
