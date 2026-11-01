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
    storageState: async () => ({ cookies: [], origins: [] }),
    dispose: async () => {},
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
        headersArray: () =>
          Object.entries({
            "content-type": "application/json",
            ...extraHeaders,
          }).flatMap(([name, value]) =>
            String(value)
              .split("\n")
              .map((item) => ({ name, value: item })),
          ),
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
  it("keeps an idle observation HTTP-only even when authentication was rejected", () => {
    for (const result of [
      { error: "authenticationRejected" },
      { error: "redirectRequiresReview", signInRedirect: true },
    ]) {
      expect(lab.shouldRenew(result)).toBe(true);
      expect(lab.shouldRenew(result, false)).toBe(false);
    }
    for (const result of [
      { authenticated: true },
      { error: "permissionDenied" },
      { error: "rateLimited" },
      { error: "networkUnavailable" },
      { error: "redirectRequiresReview", signInRedirect: false },
    ])
      expect(lab.shouldRenew(result)).toBe(false);
  });

  it("records bounded private observations without copying identity, cookies or arbitrary errors", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "synthetic-carmen-observation-"),
    );
    try {
      const observation = lab.observationFor(
        {
          httpCheck: {
            authenticated: false,
            status: 401,
            error: "authenticationRejected",
            cookie: "synthetic-private-cookie",
            name: profile.name,
            timingsMs: { total: 123 },
          },
          error: "synthetic-private-error",
          success: false,
          renewalDeferred: true,
        },
        1000,
        8_101_000,
      );
      expect(observation).toMatchObject({
        idleGapMs: 8_100_000,
        initialState: "signInRequired",
        renewalAttempted: false,
        renewalDeferred: true,
        httpStatus: 401,
      });
      await lab.recordObservation(directory, observation);
      const source = await readFile(
        join(directory, "observations.jsonl"),
        "utf8",
      );
      for (const value of [
        profile.name,
        "synthetic-private-cookie",
        "synthetic-private-error",
      ])
        expect(source).not.toContain(value);
      expect(JSON.parse(source)).toEqual(observation);
      await chmod(join(directory, "observations.jsonl"), 0o644);
      await expect(
        lab.recordObservation(directory, observation),
      ).rejects.toThrow("privateFileRequired");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
      await lab.savePending(
        directory,
        { ...saved, identity: undefined },
        "synthetic-root-key",
      );
      expect(
        (await lab.loadSession(directory, true)).saved.identity,
      ).toBeUndefined();
      await expect(lab.loadSession(directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        await readFile(join(directory, "pending.json"), "utf8"),
      ).not.toContain("private-cookie");
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

  it("accepts separate Set-Cookie headers instead of interpreting rotation as a network failure", async () => {
    const api = apiFor(profile, 200, {
      "set-cookie":
        "synthetic-a=private-a; Path=/\nsynthetic-b=private-b; Path=/",
    });
    const result = await lab.readAccount(api, undefined, false);
    expect(result.report.authenticated).toBe(true);
    expect(result.report.error).toBeUndefined();
    expect(result.report.cookieRotationOffered).toBe(true);
    for (const value of ["private-a", "private-b"])
      expect(JSON.stringify(result.report)).not.toContain(value);
  });

  it("reports a fixed transport category without leaking Playwright error call logs", async () => {
    const result = await lab.readAccount(
      {
        get: async () => {
          throw new Error(
            "Target page context closed. Cookie: synthetic-private-cookie https://private.invalid/?jwt=synthetic-token",
          );
        },
      },
      undefined,
      false,
    );
    expect(result.report).toMatchObject({
      authenticated: false,
      error: "networkUnavailable",
      networkFailure: "contextClosed",
    });
    for (const value of [
      "synthetic-private-cookie",
      "synthetic-token",
      "private.invalid",
    ])
      expect(JSON.stringify(result.report)).not.toContain(value);
  });

  it("waits for explicit Done before reading a Canvas page that may still require first-use policy", async () => {
    for (const done of [false, true]) {
      let handedOff = false;
      let pendingSaved = false;
      let complete: ((event: { success: boolean }) => void) | undefined;
      const api = apiFor();
      const cdp = {
        once: (
          event: string,
          callback: (result: { success: boolean }) => void,
        ) => {
          expect(event).toBe("Cloudflare.handoffComplete");
          complete = callback;
        },
        detach: async () => {},
        send: async (method: string, options: Record<string, unknown>) => {
          if (method === "Cloudflare.getLiveView") {
            expect(options).toEqual({ mode: "tab", expiresInMs: 300000 });
            return {
              devtoolsFrontendUrl:
                "https://live.browser.run/ui/view?mode=tab&wss=synthetic-private-token",
            };
          }
          if (method === "Cloudflare.handoff") {
            expect(Number(options.timeout)).toBeGreaterThan(0);
            expect(api.calls).toHaveLength(0);
            return { handoffId: "synthetic-handoff" };
          }
          expect(method).toBe("Browser.getVersion");
          return {};
        },
      };
      const context = {
        request: api,
        newPage: async () => ({
          goto: async () => {},
          url: () => "https://osu.instructure.com/",
        }),
        storageState: async () => ({ cookies: [], origins: [] }),
        newCDPSession: async () => cdp,
      };
      const result = await lab.attemptRenewal({
        browser: { contexts: () => [context] },
        createRequest: async () => api,
        interactive: true,
        deadlineMs: done ? 1000 : 25,
        onPendingState: async () => {
          pendingSaved = true;
        },
        handoff: async (url: string) => {
          expect(url).toContain("synthetic-private-token");
          expect(api.calls).toHaveLength(0);
          handedOff = true;
          if (done) complete?.({ success: true });
        },
      });
      expect(handedOff).toBe(true);
      expect(pendingSaved).toBe(done);
      expect(api.calls).toHaveLength(done ? 1 : 0);
      expect(result.report.authenticated).toBe(done);
      expect(JSON.stringify(result.report)).not.toContain(
        "synthetic-private-token",
      );
    }
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
