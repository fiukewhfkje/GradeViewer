import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Opt-in diagnostic intentionally uses plain JavaScript.
import * as carmenSession from "../scripts/verify-carmen-session.mjs";
const { parseCookieHeader, probeCarmen, readPrivateCookieFile } = carmenSession;

const cookie = "synthetic_session=synthetic-secret";
const json = (data: unknown, headers = {}) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("opt-in Carmen cookie diagnostic", () => {
  it("accepts an external parent bundle root while denying the project and its descendants", () => {
    expect(carmenSession.outsideDirectory("/private/project", "/private")).toBe(
      true,
    );
    expect(
      carmenSession.outsideDirectory("/private/project", "/private/project"),
    ).toBe(false);
    expect(
      carmenSession.outsideDirectory(
        "/private/project",
        "/private/project/sub",
      ),
    ).toBe(false);
    expect(
      carmenSession.outsideDirectory(
        "/private/project",
        "/private/project-copy",
      ),
    ).toBe(true);
  });
  it("makes no request without the account holder's permission", async () => {
    let requests = 0;
    const report = await probeCarmen({
      cookie,
      timing: true,
      now: () => {
        throw new Error("must not time an unpermitted read");
      },
      fetcher: async () => {
        requests++;
      },
    });
    expect(report.error).toBe("accountHolderPermissionRequired");
    expect(requests).toBe(0);
  });

  it("rejects header injection, exports with attributes, and duplicate cookies", () => {
    expect(parseCookieHeader("Cookie: " + cookie + "\n")).toBe(cookie);
    for (const input of [
      "",
      cookie + "\r\nAuthorization: leaked",
      cookie + "; Domain=osu.instructure.com",
      cookie + "; " + cookie,
      "session=has a space",
    ])
      expect(() => parseCookieHeader(input)).toThrow("invalidCookieFile");
  });

  it("restricts reads to self identity and enrolled-course totals, with no sensitive output", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const report = await probeCarmen({
      cookie,
      consent: true,
      grades: true,
      fetcher: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return calls.length === 1
          ? json(
              { id: 123, name: "Synthetic private student" },
              { "Set-Cookie": "synthetic=rotated-secret" },
            )
          : json(
              [
                {
                  id: 456,
                  name: "Synthetic private course",
                  enrollments: [
                    { type: "student", computed_current_score: 87.654321 },
                  ],
                },
              ],
              {
                Link: '<https://osu.instructure.com/api/v1/courses?page=2>; rel="next"',
              },
            );
      },
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://osu.instructure.com/api/v1/users/self/profile",
      "https://osu.instructure.com/api/v1/courses?enrollment_type=student&include[]=total_scores&per_page=100",
    ]);
    expect(
      calls.every(
        (c) => c.init.method === "GET" && c.init.redirect === "manual",
      ),
    ).toBe(true);
    expect(report).toEqual({
      authenticated: true,
      courseTotalsChecked: true,
      courseCount: 1,
      scoreFieldsPresent: true,
      courseListEmpty: false,
      visibleTotalsPresent: true,
      courseListHasMorePages: true,
      cookieRotationOffered: true,
    });
    for (const secret of [
      "synthetic-secret",
      "rotated-secret",
      "Synthetic private",
      "87.654321",
      "123",
      "456",
    ])
      expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("never follows a login redirect or interprets 403/network errors as expired login", async () => {
    for (const [status, error] of [
      [302, "redirectRequiresReview"],
      [401, "authenticationRejected"],
      [403, "permissionDenied"],
      [429, "rateLimited"],
    ] as const) {
      let requests = 0;
      const report = await probeCarmen({
        cookie,
        consent: true,
        grades: true,
        fetcher: async () => {
          requests++;
          return new Response(null, {
            status,
            headers: {
              Location: "https://other.invalid/login?secret=synthetic",
            },
          });
        },
      });
      expect(report.error).toBe(error);
      expect(requests).toBe(1);
      expect(JSON.stringify(report)).not.toContain("other.invalid");
    }
    const report = await probeCarmen({
      cookie,
      consent: true,
      fetcher: async () => {
        throw new Error(cookie);
      },
    });
    expect(report.error).toBe("networkUnavailable");
    expect(JSON.stringify(report)).not.toContain("synthetic-secret");
  });

  it("withholds success for login HTML, malformed identity and oversized JSON", async () => {
    for (const response of [
      new Response("<html>login</html>"),
      json({ name: "no identity" }),
      json({ id: [1] }),
      json({ id: 0 }),
      json({ id: 1, extra: "x".repeat(2_000_000) }),
    ]) {
      const report = await probeCarmen({
        cookie,
        consent: true,
        fetcher: async () => response,
      });
      expect(report.authenticated).toBe(false);
      expect(report.error).toBeDefined();
    }
  });

  it("allows a valid empty course list without claiming grades are present", async () => {
    let requests = 0;
    const report = await probeCarmen({
      cookie,
      consent: true,
      grades: true,
      fetcher: async () => json(++requests === 1 ? { id: 1 } : []),
    });
    expect(report.courseTotalsChecked).toBe(true);
    expect(report.courseListEmpty).toBe(true);
    expect(report.courseCount).toBe(0);
    expect(report.scoreFieldsPresent).toBe(false);
    expect(report.visibleTotalsPresent).toBe(false);
    expect(report.courseListHasMorePages).toBe(false);
  });

  it("rejects malformed courses and enrollment scores rather than accepting a profile-only result", async () => {
    for (const courses of [
      { error: "not a list" },
      [null],
      [{ id: 0 }],
      [{ id: 1, enrollments: {} }],
      [{ id: 1, enrollments: [null] }],
      [{ id: 1, enrollments: [{ computed_current_score: "not a number" }] }],
    ]) {
      let calls = 0;
      const result = await probeCarmen({
        consent: true,
        grades: true,
        cookie,
        fetcher: async () => json(++calls === 1 ? { id: 1 } : courses),
      });
      expect(result.error).toBe("invalidCourseList");
      expect(result.courseTotalsChecked).toBe(false);
    }
  });

  it("keeps course-route auth, permission, throttling, server and malformed responses separate", async () => {
    for (const [location, signInRedirect] of [
      ["https://osu.instructure.com/login?secret=synthetic", true],
      ["https://other.invalid/login?secret=synthetic", false],
    ] as const) {
      let calls = 0;
      const r = await probeCarmen({
        managedCookies: true,
        consent: true,
        grades: true,
        fetcher: async () =>
          ++calls === 1
            ? json({ id: 1 })
            : new Response(null, {
                status: 302,
                headers: { Location: location },
              }),
      });
      expect(r).toMatchObject({
        error: "redirectRequiresReview",
        stage: "courseTotals",
        signInRedirect,
      });
      expect(JSON.stringify(r)).not.toContain("secret=synthetic");
    }
    for (const [status, error] of [
      [401, "authenticationRejected"],
      [403, "permissionDenied"],
      [429, "rateLimited"],
      [500, "providerUnavailable"],
      [503, "providerUnavailable"],
    ] as const) {
      let calls = 0;
      const r = await probeCarmen({
        cookie,
        consent: true,
        grades: true,
        fetcher: async () =>
          ++calls === 1 ? json({ id: 1 }) : new Response(null, { status }),
      });
      expect(r).toMatchObject({
        authenticated: true,
        courseTotalsChecked: false,
        stage: "courseTotals",
        error,
        status,
      });
      expect(r.courseListEmpty).toBeUndefined();
    }
    for (const response of [
      new Response("<html>login</html>", {
        headers: { "Content-Type": "text/html" },
      }),
      new Response("{bad JSON", {
        headers: { "Content-Type": "application/json" },
      }),
    ]) {
      let calls = 0;
      const r = await probeCarmen({
        cookie,
        consent: true,
        grades: true,
        fetcher: async () => (++calls === 1 ? json({ id: 1 }) : response),
      });
      expect(r.courseTotalsChecked).toBe(false);
      expect(["nonJSONResponse", "invalidJSON"]).toContain(r.error);
      expect(r.courseListEmpty).toBeUndefined();
    }
  });

  it("optionally times complete reads without logging credentials or response data", async () => {
    let clock = 0;
    const report = await probeCarmen({
      cookie,
      consent: true,
      grades: true,
      timing: true,
      now: () => clock,
      fetcher: async () => {
        const identity = clock === 0;
        clock += identity ? 125 : 250;
        return json(
          identity ? { id: 123, name: "Private synthetic name" } : [],
        );
      },
    });
    expect(report.timingsMs).toEqual({
      identity: 125,
      courseTotals: 250,
      total: 375,
    });
    expect(report.authenticated).toBe(true);
    expect(report.courseTotalsChecked).toBe(true);
    for (const secret of [cookie, "Private synthetic name", '"id"'])
      expect(JSON.stringify(report)).not.toContain(secret);

    clock = 0;
    const rejected = await probeCarmen({
      cookie,
      consent: true,
      timing: true,
      now: () => clock,
      fetcher: async () => {
        clock += 80;
        return new Response(null, { status: 401 });
      },
    });
    expect(rejected.error).toBe("authenticationRejected");
    expect(rejected.timingsMs).toEqual({ identity: 80, total: 80 });
  });

  it("requires a private external owner-only file and refuses symlinks", async () => {
    await expect(
      readPrivateCookieFile(
        join(process.cwd(), "scripts/verify-carmen-session.mjs"),
      ),
    ).rejects.toThrow("cookieFileMustBeOutsideProject");
    const dir = await mkdtemp(join(tmpdir(), "synthetic-carmen-test-"));
    const path = join(dir, "cookie.txt");
    try {
      await writeFile(path, cookie, { mode: 0o600 });
      expect(await readPrivateCookieFile(path)).toBe(cookie);
      await chmod(path, 0o644);
      await expect(readPrivateCookieFile(path)).rejects.toThrow(
        "privateOwnerOnlyFileRequired",
      );
      await chmod(path, 0o600);
      const link = join(dir, "link.txt");
      await symlink(path, link);
      await expect(readPrivateCookieFile(link)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
