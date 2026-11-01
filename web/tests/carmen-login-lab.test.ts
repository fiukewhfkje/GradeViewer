import { describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  chmod,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
// @ts-expect-error Operator diagnostic intentionally uses JavaScript.
import * as lab from "../scripts/carmen-login-lab.mjs";
// @ts-expect-error Operator diagnostic intentionally uses JavaScript.
import * as probe from "../scripts/verify-carmen-session.mjs";

const identity = "123456789";
const profile = { id: identity, name: "Synthetic private student" };
function apiFor(data: unknown = profile, status = 200, extraHeaders = {}) {
  const calls: Array<{ url: string; options: Record<string, unknown> }> = [];
  let disposed = 0;
  return {
    calls,
    get disposed() {
      return disposed;
    },
    async get(url: string, options: Record<string, unknown>) {
      calls.push({ url, options });
      return {
        headers: () => ({
          "content-type": "application/json",
          ...extraHeaders,
        }),
        body: async () => Buffer.from(JSON.stringify(data)),
        status: () => status,
        dispose: async () => {
          disposed++;
        },
      };
    },
  };
}

describe("isolated direct-sign-in Carmen lab", () => {
  it("uses a managed cookie jar, fixed GETs, no redirects/retries and sanitized results", async () => {
    const api = apiFor();
    const result = await lab.readAccount(api, undefined, false);
    expect(result.identity).toBe(identity); // Private in-memory binding, not the report.
    expect(result.report.authenticated).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].url).toBe(
      "https://osu.instructure.com/api/v1/users/self/profile",
    );
    expect(api.calls[0].options).toMatchObject({
      maxRedirects: 0,
      maxRetries: 0,
      failOnStatusCode: false,
    });
    expect(api.calls[0].options.headers).toEqual({
      Accept: "application/json",
    });
    expect(api.disposed).toBe(1);
    for (const value of [identity, profile.name])
      expect(JSON.stringify(result.report)).not.toContain(value);
    await expect(
      lab.managedFetcher(api)("https://other.invalid/"),
    ).rejects.toThrow("unexpectedLabRequest");
    expect(api.calls).toHaveLength(1);
  });

  it("rejects account changes and does not confuse denied access/rate limits with expiry", async () => {
    const changed = await lab.readAccount(apiFor(), { identity: "999" }, false);
    expect(changed.identity).toBeUndefined();
    expect(changed.report).toMatchObject({
      authenticated: false,
      error: "accountChanged",
    });
    for (const [status, error] of [
      [401, "authenticationRejected"],
      [403, "permissionDenied"],
      [429, "rateLimited"],
    ] as const) {
      const result = await lab.readAccount(
        apiFor({}, status),
        undefined,
        false,
      );
      expect(result.report.error).toBe(error);
    }
    for (const [target, expected] of [
      ["https://webauth.service.ohio-state.edu/secret?state=private", true],
      ["https://attacker.invalid/login", false],
      ["https://osu.instructure.com/login/saml", true],
    ] as const) {
      const result = await lab.readAccount(
        apiFor({}, 302, { location: target }),
        undefined,
        false,
      );
      expect(result.report).toMatchObject({
        error: "redirectRequiresReview",
        signInRedirect: expected,
      });
      expect(JSON.stringify(result.report)).not.toContain(target);
    }
  });

  it("keeps only scoped session state and encrypts it outside the project", async () => {
    const parent = await mkdtemp(join(tmpdir(), "synthetic-carmen-lab-"));
    const directory = join(parent, "private");
    const state = lab.scopeState({
      cookies: [
        {
          domain: "osu.instructure.com",
          name: "synthetic",
          value: "private-cookie",
        },
        { domain: ".ohio-state.edu", name: "sso", value: "private-sso" },
        { domain: "other.invalid", name: "unrelated", value: "discard" },
      ],
      origins: [
        { origin: "https://webauth.service.ohio-state.edu", localStorage: [] },
        { origin: "https://other.invalid", localStorage: [] },
      ],
    });
    expect(state.cookies).toHaveLength(2);
    expect(state.origins).toHaveLength(1);
    const saved = {
      version: 1,
      createdAt: Date.now(),
      identity,
      gradesPermitted: false,
      state,
    };
    try {
      await expect(lab.labDirectory("relative", true)).rejects.toThrow(
        "absolutePrivateDirectoryRequired",
      );
      await lab.labDirectory(directory, true);
      await writeFile(join(directory, "key"), "synthetic-root-key", {
        mode: 0o600,
      });
      await lab.saveSession(directory, saved, "synthetic-root-key");
      const encrypted = await readFile(join(directory, "session.json"), "utf8");
      for (const value of ["private-cookie", "private-sso", identity])
        expect(encrypted).not.toContain(value);
      expect((await lab.loadSession(directory)).saved).toEqual(saved);
      await chmod(join(directory, "session.json"), 0o644);
      await expect(lab.loadSession(directory)).rejects.toThrow(
        "privateFileRequired",
      );
      await chmod(join(directory, "session.json"), 0o600);
      await lab.saveSession(
        directory,
        { ...saved, createdAt: Date.now() - 49 * 3600_000 },
        "synthetic-root-key",
      );
      await expect(lab.loadSession(directory)).rejects.toThrow(
        "invalidOrExpiredLabState",
      );
      const link = join(parent, "link");
      await symlink(directory, link);
      await expect(lab.labDirectory(link)).rejects.toThrow(
        "privateOwnerOnlyDirectoryRequired",
      );
      const insecure = join(parent, "insecure");
      await mkdir(insecure);
      await chmod(insecure, 0o755);
      await expect(lab.labDirectory(insecure)).rejects.toThrow(
        "privateOwnerOnlyDirectoryRequired",
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects advertised oversized API bodies with a fixed error and disposes them", async () => {
    const api = apiFor({}, 200, { "content-length": "3000000" });
    const result = await lab.readAccount(api, undefined, false);
    expect(result.report.error).toBe("responseTooLarge");
    expect(result.identity).toBeUndefined();
    expect(api.disposed).toBe(1);
  });

  it("generates a private handoff with a supported expiry without reporting the URL", async () => {
    let handedOff = false;
    const context = {
      request: apiFor(),
      newPage: async () => ({
        goto: async () => {},
        url: () => "https://osu.instructure.com/",
      }),
      storageState: async () => ({ cookies: [], origins: [] }),
      newCDPSession: async () => ({
        send: async (method: string, options: Record<string, unknown>) => {
          expect(method).toBe("Cloudflare.getLiveView");
          expect(options).toEqual({ mode: "tab", expiresInMs: 300000 });
          return {
            devtoolsFrontendUrl:
              "https://live.browser.run/ui/view?mode=tab&wss=synthetic-private-token",
          };
        },
      }),
    };
    const result = await lab.attemptRenewal({
      browser: { contexts: () => [context] },
      interactive: true,
      handoff: async (url: string) => {
        expect(url).toContain("synthetic-private-token");
        handedOff = true;
      },
    });
    expect(handedOff).toBe(true);
    expect(result.report.authenticated).toBe(true);
    expect(JSON.stringify(result.report)).not.toContain(
      "synthetic-private-token",
    );
  });

  it("performs a silent restoration with headless Chrome and synthetic data only", async () => {
    const browser = await chromium.launch();
    try {
      const wrapped = {
        async newContext(options: Record<string, unknown>) {
          const context = await browser.newContext(options);
          await context.route("**/*", (route) =>
            route.request().url() === "https://osu.instructure.com/"
              ? route.fulfill({
                  contentType: "text/html",
                  body: "<!doctype html><title>Synthetic only</title>",
                })
              : route.abort(),
          );
          return context;
        },
      };
      let verified = 0;
      const result = await lab.attemptRenewal({
        browser: wrapped,
        saved: { identity, state: { cookies: [], origins: [] } },
        read: async () => {
          verified++;
          return lab.readAccount(apiFor(), { identity }, false);
        },
      });
      expect(verified).toBe(1);
      expect(result.report.authenticated).toBe(true);
      expect(result.identity).toBe(identity);
      expect(result.state).toEqual({ cookies: [], origins: [] });
      expect(result.renewalMs).toBeGreaterThanOrEqual(0);
    } finally {
      await browser.close();
    }
  });

  it("never consults a managed session or identity callback without permission", async () => {
    let called = false;
    const result = await probe.probeCarmen({
      managedCookies: true,
      onIdentity: () => {
        called = true;
      },
      fetcher: () => {
        called = true;
      },
    });
    expect(result.error).toBe("accountHolderPermissionRequired");
    expect(called).toBe(false);
  });
});
