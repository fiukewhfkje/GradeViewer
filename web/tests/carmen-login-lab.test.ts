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
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-expect-error Operator diagnostic intentionally uses JavaScript.
import * as lab from "../scripts/carmen-login-lab.mjs";
// @ts-expect-error Operator diagnostic intentionally uses JavaScript.
import * as probe from "../scripts/verify-carmen-session.mjs";
// @ts-expect-error Operator diagnostic intentionally uses JavaScript.
import * as browserClients from "../scripts/carmen-browser-client.mjs";

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
  it("uses explicit human completion for local capture without Cloudflare handoff commands", async () => {
    for (const done of [false, true]) {
      const api = apiFor();
      const context = {
        newPage: async () => ({
          goto: async () => {},
          url: () => "https://osu.instructure.com/",
        }),
        storageState: async () => ({ cookies: [], origins: [] }),
        newCDPSession: async () => {
          throw new Error("must not use Cloudflare handoff for local capture");
        },
      };
      const r = await lab.attemptRenewal({
        browser: { contexts: () => [], newContext: async () => context },
        interactive: true,
        deadlineMs: 2000,
        createRequest: async () => api,
        localHandoff: async () => {
          expect(api.calls).toHaveLength(0);
          return done;
        },
      });
      expect(r.report.authenticated).toBe(done);
      expect(api.calls).toHaveLength(done ? 1 : 0);
    }
  });
  it("claims exactly one recovery per recorded failure, including concurrent invocations", async () => {
    const parent = await mkdtemp(join(tmpdir(), "synthetic-carmen-claim-"));
    try {
      const now = Date.now(),
        key = "synthetic-private-key";
      await writeFile(join(parent, "key"), key, { mode: 0o600 });
      const saved = {
        version: 1,
        identity,
        createdAt: now - 1000,
        verifiedAt: now - 100,
        state: { cookies: [], origins: [] },
      };
      await lab.saveSession(parent, saved, key);
      await expect(lab.claimRenewal(parent, saved, key)).rejects.toThrow(
        "confirmedAuthenticationFailureRequired",
      );
      const failed = { ...saved, lastAuthFailure: { at: now } };
      await lab.saveSession(parent, failed, key);
      const results = await Promise.allSettled([
        lab.claimRenewal(parent, failed, key),
        lab.claimRenewal(parent, failed, key),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      await expect(lab.claimRenewal(parent, failed, key)).rejects.toThrow(
        "renewalAlreadyAttempted",
      );
      expect(
        (await lab.loadSession(parent)).saved.lastAuthFailure
          .renewalAttemptedAt,
      ).toBeGreaterThanOrEqual(now);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("reports missing private state as a local setup failure before provider access", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/carmen-login-lab.mjs", import.meta.url),
        ),
        "check",
        join(tmpdir(), "synthetic-missing-carmen-state"),
        "--consent",
        "--grades",
        "--no-renew",
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: "privateLabStateMissing",
      failedStage: "privateLabSetup",
      timingsMs: {},
    });
    expect(result.stderr).toBe("");
  });

  it("separates silent OSU SSO, stable human gates, merely visiting Duo and unknown timeouts", async () => {
    for (const scenario of [
      "silent",
      "credentials",
      "duo",
      "policy",
      "other",
      "duoVisitOnly",
      "unknown",
    ]) {
      let clock = 0;
      let navigation: ((frame: { url: () => string }) => void) | undefined;
      const url =
        scenario === "silent" || scenario === "policy" || scenario === "other"
          ? "https://osu.instructure.com/"
          : scenario.startsWith("duo")
            ? "https://synthetic.duosecurity.com/"
            : "https://webauth.service.ohio-state.edu/login";
      const visible = (value: boolean) => ({
        first: () => ({ isVisible: async () => value }),
      });
      const page = {
        on: (_event: string, fn: typeof navigation) => {
          navigation = fn;
        },
        url: () => url,
        goto: async () => {
          navigation?.({
            url: () =>
              "https://webauth.service.ohio-state.edu/?secret=private-url-token",
          });
          navigation?.({ url: () => url });
        },
        getByRole: (_role: string, options: { name: RegExp }) =>
          visible(
            options.name.source.includes("acceptable")
              ? scenario === "policy"
              : scenario === "other",
          ),
        locator: (selector: string) =>
          visible(
            selector.includes('type="password"')
              ? scenario === "credentials"
              : scenario === "other",
          ),
        frames: () => [
          { url: () => url, getByText: () => visible(scenario === "duo") },
        ],
      };
      const context = {
        newPage: async () => page,
        storageState: async () => ({ cookies: [], origins: [] }),
        newCDPSession: async () => ({
          send: async () => ({}),
          detach: async () => {},
        }),
      };
      const stages = lab.newRenewalStages(true);
      stages.browserLaunched = true;
      let gradeReads = 0;
      const result = await lab.attemptRenewal({
        browser: { newContext: async () => context },
        saved: { identity, state: { cookies: [], origins: [] } },
        grades: true,
        stages,
        clock: () => clock,
        pause: async () => {
          clock += 1000;
        },
        deadlineMs: 3000,
        createRequest: async () => ({
          storageState: async () => ({ cookies: [] }),
          dispose: async () => {},
        }),
        read: async () => {
          gradeReads++;
          return {
            identity,
            report: { authenticated: true, courseTotalsChecked: true },
          };
        },
      });
      if (scenario === "silent") {
        expect(stages).toMatchObject({
          osuSignIn: "continuedSilently",
          humanAction: "notObserved",
          renewalSucceeded: true,
        });
        expect(gradeReads).toBe(1);
      } else if (["duoVisitOnly", "unknown"].includes(scenario)) {
        expect(result.report.error).toBe("renewalInconclusive");
        expect(stages.duoChallenge).toBe("notObserved");
        expect(stages.humanAction).toBe("notObserved");
        expect(stages.duoPageObserved).toBe(scenario === "duoVisitOnly");
      } else {
        expect(result.report).toMatchObject({
          error: "humanSignInRequired",
          humanReason: scenario,
        });
        expect(stages.humanAction).toBe(scenario);
        expect(gradeReads).toBe(0);
        expect(clock).toBe(1000); // Stable twice, rather than an intermediate redirect.
      }
      expect(JSON.stringify(stages)).not.toContain("private-url-token");
      expect(JSON.stringify(stages)).not.toContain(identity);
    }
  });

  it("runs the consent guard even when the CLI entry path is a symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synthetic-carmen-cli-"));
    try {
      for (const name of [
        "carmen-login-lab.mjs",
        "verify-carmen-session.mjs",
      ]) {
        const target = fileURLToPath(
          new URL("../scripts/" + name, import.meta.url),
        );
        const link = join(directory, name);
        await symlink(target, link);
        const result = spawnSync(process.execPath, [link], {
          encoding: "utf8",
          timeout: 5000,
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toEqual({
          error: "accountHolderPermissionRequired",
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
      await lab.saveSession(
        directory,
        {
          ...saved,
          createdAt: Date.now() - 49 * 3600_000,
          authorizedUntil: Date.now() + 24 * 3600_000,
        },
        "synthetic-root-key",
      );
      expect((await lab.loadSession(directory)).saved.identity).toBe(identity);
      await lab.saveSession(
        directory,
        {
          ...saved,
          authorizedUntil: saved.createdAt + 8 * 24 * 3600_000,
        },
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
    const client = browserClients.createLocalBrowserClient();
    const { browser } = await client.open();
    try {
      const wrapped = {
        async newContext(options: Record<string, unknown>) {
          const context = await browser.newContext(options);
          await context.route(
            "**/*",
            (route: import("playwright-core").Route) =>
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
      expect(await client.cleanup()).toBe(true);
      expect(client.browserLeaseWallMs()).toBeGreaterThan(0);
    }
  });

  it("recognizes visible Duo, policy and credential gates without treating an unknown page as Duo", async () => {
    for (const reason of ["duo", "policy", "credentials", undefined]) {
      const visible = (value: boolean) => ({
        first: () => ({ isVisible: async () => value }),
      });
      const page = {
        url: () =>
          reason === "credentials"
            ? "https://webauth.service.ohio-state.edu/"
            : "https://osu.instructure.com/",
        getByRole: () => visible(reason === "policy"),
        locator: () => visible(reason === "credentials"),
        frames: () => [
          {
            url: () => "https://synthetic.duosecurity.com/",
            getByText: () => visible(reason === "duo"),
          },
        ],
      };
      expect(await lab.humanGate(page)).toBe(reason);
    }
    const observation = lab.observationFor(
      { httpCheck: { authenticated: true, error: "rateLimited" } },
      Date.now(),
    );
    expect(observation.initialState).toBe("inconclusive");
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
