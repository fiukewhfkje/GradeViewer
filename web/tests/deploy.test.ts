import { describe, it, expect } from "vitest";
// @ts-expect-error Deployment helper intentionally uses plain JavaScript.
import { deploy } from "../scripts/deploy.mjs";
describe("no-terminal password setup", () => {
  it("sends the password only over stdin and retains Cloudflare authentication", async () => {
    const calls: {
      args: string[];
      env: Record<string, string>;
      input?: string;
    }[] = [];
    await deploy(
      {
        APP_PASSWORD: "synthetic-owner-password-at-least-20",
        CLOUDFLARE_API_TOKEN: "synthetic-build-token",
      },
      async (args: string[], env: Record<string, string>, input?: string) => {
        calls.push({ args, env, input });
      },
    );
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls.map((c) => [c.args, c.env]))).not.toContain(
      "synthetic-owner-password-at-least-20",
    );
    expect(JSON.parse(calls[0].input!)).toEqual({
      APP_PASSWORD: "synthetic-owner-password-at-least-20",
    });
    expect(calls[1].env.CLOUDFLARE_API_TOKEN).toBe("synthetic-build-token");
    expect(calls[1].args).toEqual(["deploy"]);
  });
  it("keeps existing runtime secrets on ordinary redeploy and stops after secret-setup failure", async () => {
    const calls: string[][] = [];
    await deploy({}, async (args: string[]) => {
      calls.push(args);
    });
    expect(calls).toEqual([["deploy"]]);
    let deployed = false;
    await expect(
      deploy(
        { APP_PASSWORD: "synthetic-owner-password-at-least-20" },
        async (args: string[]) => {
          if (args[0] === "secret")
            throw new Error("synthetic permission error");
          deployed = true;
        },
      ),
    ).rejects.toThrow();
    expect(deployed).toBe(false);
    await expect(
      deploy({ APP_PASSWORD: "short" }, async () => {
        deployed = true;
      }),
    ).rejects.toThrow();
    expect(deployed).toBe(false);
  });
});
