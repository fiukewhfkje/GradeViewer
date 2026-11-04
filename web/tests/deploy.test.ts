import { describe, it, expect } from "vitest";
import { readFile, stat } from "node:fs/promises";
// @ts-expect-error Deployment helper intentionally uses plain JavaScript.
import { deploy } from "../scripts/deploy.mjs";
const password = "synthetic-owner-password-at-least-20";
describe("no-terminal password setup", () => {
  it("accepts a 12-character password and rejects 11 before changing deployment", async () => {
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
    };
    await expect(deploy({ APP_PASSWORD: "test-only12" }, run)).rejects.toThrow(
      "at least 12 characters",
    );
    expect(calls).toHaveLength(0);
    await deploy({ APP_PASSWORD: "test-only123" }, run);
    expect(calls).toEqual([["deploy", "--secrets-file", expect.any(String)]]);
  });
  it("uploads code and password together after a rollback without a separate secret edit", async () => {
    let secretsFile = "";
    let count = 0;
    await deploy(
      { APP_PASSWORD: password, CLOUDFLARE_API_TOKEN: "synthetic-build-token" },
      async (args: string[], env: Record<string, string>, input?: string) => {
        count++;
        // Model Cloudflare refusing a separate secret edit on an older active version.
        if (args[0] === "secret")
          throw new Error("Latest version is not deployed");
        expect(args.slice(0, 2)).toEqual(["deploy", "--secrets-file"]);
        expect(JSON.stringify([args, env, input])).not.toContain(password);
        expect(env.CLOUDFLARE_API_TOKEN).toBe("synthetic-build-token");
        secretsFile = args[2];
        expect(JSON.parse(await readFile(secretsFile, "utf8"))).toEqual({
          APP_PASSWORD: password,
        });
        expect((await stat(secretsFile)).mode & 0o777).toBe(0o600);
      },
    );
    expect(count).toBe(1);
    await expect(stat(secretsFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("targets the explicitly selected Worker with the same code and password upload", async () => {
    const calls: string[][] = [];
    await deploy(
      { APP_PASSWORD: password },
      async (args: string[]) => {
        calls.push(args);
      },
      ["--name", "gradeviewer-preview"],
    );
    expect(calls).toEqual([
      [
        "deploy",
        "--name",
        "gradeviewer-preview",
        "--secrets-file",
        expect.any(String),
      ],
    ]);
  });
  it("preserves runtime secrets without a build password and removes the temporary file after failure", async () => {
    const calls: string[][] = [];
    await deploy({}, async (args: string[]) => {
      calls.push(args);
    });
    expect(calls).toEqual([["deploy"]]);
    let secretsFile = "";
    await expect(
      deploy({ APP_PASSWORD: password }, async (args: string[]) => {
        secretsFile = args[2];
        throw new Error("synthetic deployment failure");
      }),
    ).rejects.toThrow("synthetic deployment failure");
    await expect(stat(secretsFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
