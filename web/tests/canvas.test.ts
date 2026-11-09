import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { canvasChoices, canvasStudent, parseCanvas } from "../src/core/canvas";
import {
  canvasNext,
  canvasCoursesPath,
  canvasURL,
  canvasRejection,
  canvasSessionHeaders,
} from "../worker/canvas";
import { calculate } from "../src/core/calculator";
import { estimateGpa, gpaSemesters } from "../src/core/gpa";
import { PortalService, browserJar } from "../worker/portal";
import type { PortalBrowser } from "../worker/portal-browser";
import { unseal, type Envelope } from "../worker/crypto";
import { canvasCourses, canvasDetails, canvasState } from "./canvas-fixture";
import {
  carmenEvent,
  carmenFailure,
  newCarmenDiagnostics,
  type CarmenRecoveryStep,
} from "../src/core/carmen-diagnostics";
import { portalHealth } from "../src/portal-health";
const now = Date.parse("2026-11-04T12:00:00Z");
const parse = (details = canvasDetails(), courses = canvasCourses) =>
  parseCanvas(courses, details, "synthetic-account", "77", now);
afterEach(() => vi.useRealTimers());
describe("documented Canvas student normalization", () => {
  it("uses posted current whole-course grades, weighted groups, score already adjusted for lateness, and actual dates", () => {
    const c = parse()[0];
    expect(c.grade).toEqual({ percent: 86, letter: "B" });
    expect(calculate(c)).toBe(86);
    expect(c.assignments[0].score.earned).toBe(8);
    expect(c.assignments[1].due).toBeUndefined();
    expect(c.fields.provider).toBe("carmen");
    expect(c.fields.period_kind).toBe("semester");
    expect(c.assignments[0].updated).toBe(Date.parse("2026-11-02T12:00:00Z"));
  });
  it("supports points courses independently of group weights", () => {
    const courses = structuredClone(canvasCourses);
    courses[0].apply_assignment_group_weights = false;
    expect(calculate(parse(canvasDetails(), courses)[0])).toBeCloseTo(
      (98 / 110) * 100,
    );
  });
  it("does not manufacture zeroes for missing submissions or expose unposted scores", () => {
    const d = canvasDetails();
    Object.assign(d["101:groups"][0].assignments[0].submission, {
      score: null,
      missing: true,
    });
    const a = parse(d)[0].assignments[0];
    expect(a.score.earned).toBeUndefined();
    expect(a.fields.missing).toBe("true");
    Object.assign(d["101:groups"][1].assignments[0].submission, {
      posted_at: null,
    });
    expect(parse(d)[0].assignments[1].score.earned).toBeUndefined();
  });
  it.each(["drop_lowest", "drop_highest", "never_drop"])(
    "withholds incompatible Canvas %s math while retaining reported total",
    (rule) => {
      const d = canvasDetails();
      Object.assign(d["101:groups"][0].rules, {
        [rule]: rule === "never_drop" ? [201] : 1,
      });
      const c = parse(d)[0];
      expect(c.method).toBe("unknown");
      expect(c.grade.percent).toBe(86);
    },
  );
  it("withholds grading-period and grade-override math", () => {
    const d = canvasDetails();
    d["101:enrollments"][0].has_grading_periods = true;
    expect(parse(d)[0].method).toBe("unknown");
    Object.assign(d["101:enrollments"][0], {
      override_score: 94,
      override_grade: "A",
    });
    expect(parse(d)[0].grade).toEqual({ percent: 94, letter: "A" });
  });
  it("excludes excused, unpublished, omitted and non-graded assignments", () => {
    for (const patch of [
      { omit_from_final_grade: true },
      { published: false },
      { grading_type: "not_graded" },
    ]) {
      const d = canvasDetails();
      Object.assign(d["101:groups"][0].assignments[0], patch);
      expect(parse(d)[0].assignments[0].excluded).toBe(true);
    }
    const d = canvasDetails();
    d["101:groups"][0].assignments[0].submission.excused = true;
    expect(calculate(parse(d)[0])).toBe(90);
  });
  it("rejects malformed/duplicate courses and cross-student submissions/enrollments", () => {
    expect(() => canvasChoices({})).toThrow();
    expect(() => canvasChoices([...canvasCourses, ...canvasCourses])).toThrow();
    expect(() => canvasStudent({ id: 0 })).toThrow();
    const d = canvasDetails();
    d["101:groups"][0].assignments[0].submission.user_id = 99;
    expect(() => parse(d)).toThrow();
    const e = canvasDetails();
    e["101:enrollments"][0].user_id = 99;
    expect(() => parse(e)).toThrow();
    expect(parseCanvas([], {}, "a", "77", now)).toEqual([]);
  });
  it("accepts identical section enrollments and rejects conflicting totals or course scope", () => {
    const d = canvasDetails();
    d["101:enrollments"].push(structuredClone(d["101:enrollments"][0]));
    expect(parse(d)).toHaveLength(1);
    d["101:enrollments"][1].grades.current_score = 20;
    expect(() => parse(d)).toThrow();
    const other = canvasDetails();
    Object.assign(other["101:enrollments"][0], { course_id: 999 });
    expect(() => parse(other)).toThrow();
  });
  it("uses course-endpoint period flags and withholds nonstandard group totals", () => {
    const courses = structuredClone(canvasCourses);
    Object.assign(courses[0].enrollments[0], { has_grading_periods: true });
    expect(parse(canvasDetails(), courses)[0].method).toBe("unknown");
    const d = canvasDetails();
    d["101:groups"][0].group_weight = 80;
    expect(parse(d)[0].method).toBe("unknown");
  });
  it("uses OSU letter points and explicit credits, with no percent or difficulty assumptions", () => {
    const c = parse()[0],
      term = gpaSemesters([c], now)[0];
    const base = { weighting: "credits" as const, courses: {} };
    const key = estimateGpa([c], term, base, {}, "osu").rows[0].key;
    expect(estimateGpa([c], term, base, {}, "osu").rows[0].reason).toBe(
      "Credits needed",
    );
    const settings = {
      ...base,
      courses: {
        [key]: {
          credits: 3,
          level: "advanced" as const,
          letter: "A-" as const,
        },
      },
    };
    expect(estimateGpa([c], term, settings, {}, "osu").weighted).toBeCloseTo(
      3.7,
    );
    c.grade.letter = undefined;
    expect(
      estimateGpa(
        [c],
        term,
        { ...base, courses: { [key]: { credits: 3 } } },
        {},
        "osu",
      ).rows[0].reason,
    ).toBe("Letter grade needed");
  });
  it("groups Carmen semesters by actual enrollment term, never by per-course date differences", () => {
    const a = parse()[0],
      b = {
        ...a,
        id: a.id + "2",
        term: { ...a.term, start: now },
        fields: { ...a.fields, physical_key: a.id + "2" },
      };
    expect(gpaSemesters([a, b], now)).toHaveLength(1);
  });
});
describe("bounded Canvas pagination", () => {
  const first = new URL(canvasCoursesPath, "https://osu.instructure.com");
  it("follows RFC Link headers without changing authorization scope", () => {
    const next = new URL(first);
    next.searchParams.set("page", "2");
    expect(canvasNext(`<${next.href}>; rel="next"`, first, first)?.href).toBe(
      next.href,
    );
  });
  it.each([
    "https://evil.test/api/v1/courses",
    "https://osu.instructure.com/api/v1/courses?access_token=bad",
    "https://osu.instructure.com/api/v1/users/self/profile",
    "https://osu.instructure.com/api/v1/courses?enrollment_type=teacher",
  ])("rejects unsafe next URL %s", (url) =>
    expect(() => canvasNext(`<${url}>; rel="next"`, first, first)).toThrow(),
  );
  it("accepts only the fixed OSU origin", () =>
    expect(() => canvasURL("https://canvas.other.test")).toThrow());
});
function harness() {
  const data = new Map<string, unknown>(),
    calls: string[] = [];
  let alarm: number | null = null,
    failure = 0,
    identity = 77,
    browsers = 0,
    closed = 0,
    restoreOnNavigate = false,
    signedIn = false,
    blocked: CarmenRecoveryStep = "unknown",
    hanging = false,
    networkError: string | undefined,
    rejection: Response | undefined,
    groupOverride: unknown,
    empty = false,
    nextLink: string | undefined;
  const storage = {
    get: async (k: string) => structuredClone(data.get(k)),
    put: async (k: string, v: unknown) => {
      data.set(k, structuredClone(v));
    },
    delete: async (k: string) => data.delete(k),
    getAlarm: async () => alarm,
    setAlarm: async (n: number) => {
      alarm = n;
    },
  } as unknown as DurableObjectStorage;
  class Service extends PortalService {
    protected async browser(): Promise<PortalBrowser> {
      browsers++;
      return {
        id: "synthetic",
        state: async () => structuredClone(canvasState),
        live: async () => "https://live.browser.run/ui/view?synthetic=true",
        navigate: async () => {
          if (restoreOnNavigate) failure = 0;
        },
        url: () => "https://osu.instructure.com/",
        studentPortal: async () =>
          signedIn ? "https://osu.instructure.com/" : undefined,
        ready: async () => {
          if (hanging) await new Promise(() => {});
          if (blocked !== "unknown")
            throw new Error("private synthetic page text must not persist");
        },
        recoveryStep: async () => blocked,
        close: async () => {
          closed++;
        },
      };
    }
  }
  const upstream = async (req: Request) => {
    if (networkError)
      throw Object.assign(new Error("private transport details"), {
        name: networkError,
      });
    const u = new URL(req.url);
    calls.push(u.pathname);
    expect(req.method).toBe("GET");
    expect(u.origin).toBe("https://osu.instructure.com");
    expect(req.headers.get("Cookie")).not.toContain("idp");
    expect(req.headers.get("User-Agent")).toMatch(/^GradeViewer\//);
    expect(req.headers.get("X-Requested-With")).toBe("XMLHttpRequest");
    expect(req.headers.get("Referer")).toBe("https://osu.instructure.com/");
    const csrf = req.headers
      .get("Cookie")
      ?.match(/(?:^|; )_csrf_token=([^;]+)/)?.[1];
    expect(csrf).toBeTruthy();
    expect(req.headers.get("X-CSRF-Token")).toBe(decodeURIComponent(csrf!));
    if (rejection) return rejection.clone();
    if (failure)
      return Response.json(
        failure === 403
          ? {
              status: "unauthorized",
              errors: [
                { message: "user not authorized to perform that action" },
              ],
            }
          : {},
        {
          status: failure,
          headers: failure === 429 ? { "Retry-After": "120" } : {},
        },
      );
    if (u.pathname.endsWith("/profile"))
      return Response.json(
        { id: identity },
        {
          headers: [
            [
              "Set-Cookie",
              "_normandy_session=synthetic-rotated; Path=/; Secure; HttpOnly",
            ],
            [
              "Set-Cookie",
              "_csrf_token=synthetic%2Frotated%3D; Path=/; Secure",
            ],
          ],
        },
      );
    if (u.pathname === "/api/v1/courses")
      return Response.json(empty ? [] : canvasCourses, {
        headers: nextLink ? { Link: nextLink } : {},
      });
    const d = canvasDetails();
    if (u.pathname.endsWith("/assignment_groups")) {
      expect(u.searchParams.getAll("include[]")).toEqual([
        "assignments",
        "submission",
      ]);
      return Response.json(groupOverride ?? d["101:groups"]);
    }
    if (u.pathname.endsWith("/enrollments")) {
      expect(u.searchParams.get("user_id")).toBe("77");
      expect(u.searchParams.has("grading_period_id")).toBe(false);
      return Response.json(d["101:enrollments"]);
    }
    return Response.json({}, { status: 404 });
  };
  const service = new Service(
    storage,
    "synthetic-app-password-12345",
    undefined,
    upstream,
    "carmen",
  );
  return {
    service,
    data,
    calls,
    get browsers() {
      return browsers;
    },
    get closed() {
      return closed;
    },
    restore: () => {
      restoreOnNavigate = true;
    },
    signIn: () => {
      signedIn = true;
    },
    block: (step: CarmenRecoveryStep) => {
      blocked = step;
    },
    hang: () => {
      hanging = true;
    },
    network: (name: string) => {
      networkError = name;
    },
    fail: (s: number) => {
      failure = s;
    },
    reject: (response: Response) => {
      rejection = response;
    },
    overrideGroups: (value: unknown) => {
      groupOverride = value;
    },
    change: () => {
      identity = 99;
    },
    empty: () => {
      empty = true;
    },
    link: (s: string) => {
      nextLink = s;
    },
    alarm: () => {
      alarm = null;
    },
  };
}
async function connect(h: ReturnType<typeof harness>) {
  await h.service.handle("start");
  await h.service.handle("finish");
}
describe("encrypted Carmen session and HTTP maintenance", () => {
  it("records an initial HTML verification rejection without inventing a permission error or opening recovery", async () => {
    const h = harness();
    await h.service.handle("start");
    h.reject(
      new Response(
        "<html>Request blocked. private synthetic error must not persist</html>",
        { status: 403, headers: { "Content-Type": "text/html" } },
      ),
    );
    await expect(h.service.handle("finish")).rejects.toThrow(
      "portalRequestBlocked",
    );
    const status = await h.service.status();
    expect(status.connected).toBe(false);
    expect(status.diagnostics?.lastHttpRejection).toMatchObject({
      stage: "profile",
      httpStatus: 403,
      responseType: "html",
      reason: "challenge",
      sessionCookiePresent: true,
      csrfCookiePresent: true,
      csrfHeaderSent: true,
      clientHeaderSent: true,
    });
    expect(status.diagnostics?.recoveriesAttempted).toBe(0);
    expect(JSON.stringify(status.diagnostics)).not.toMatch(
      /private synthetic|synthetic-canvas-session|synthetic%2F|<html>/,
    );
    expect(h.browsers).toBe(2);
    expect(await h.service.compatibilityReport()).toMatchObject({
      signIn: {
        result: "failed",
        phase: "profile",
        error: "portalRequestBlocked",
        responses: { profile: { httpStatuses: [403], fields: {} } },
      },
    });
    await h.service.handle("cancel");
  });
  it("scopes session headers and classifies bounded rejections without retaining provider text", async () => {
    const jar = browserJar(canvasState, "https://osu.instructure.com");
    expect(() =>
      canvasSessionHeaders(
        jar,
        new URL("https://other.instructure.com/api/v1/users/self/profile"),
      ),
    ).toThrow("invalidRequest");
    expect(
      await canvasRejection(
        Response.json({
          status: "unauthorized",
          errors: [{ message: "user not authorized to perform that action" }],
        }),
      ),
    ).toEqual({ responseType: "json", reason: "permission" });
    expect(
      await canvasRejection(
        Response.json({ message: "private unrecognized error" }),
      ),
    ).toEqual({ responseType: "json", reason: "unknown" });
    expect(
      await canvasRejection(
        new Response("<html>private page</html>", {
          headers: { "Content-Type": "text/html", "cf-mitigated": "challenge" },
        }),
      ),
    ).toEqual({ responseType: "html", reason: "challenge" });
  });
  it("connects without Schoology, discovers all courses, encrypts and rotates scoped cookies", async () => {
    const h = harness();
    await connect(h);
    const r = (await h.service.handle("snapshot")) as { courses: unknown[] };
    expect(r.courses).toHaveLength(1);
    expect(JSON.stringify([...h.data.values()])).not.toContain(
      "synthetic-canvas-session",
    );
    const saved = await unseal<{ connection: { jar: unknown } }>(
      h.data.get("portal-carmen") as Envelope,
      "synthetic-app-password-12345",
    );
    expect(JSON.stringify(saved.connection.jar)).toContain("synthetic-rotated");
  });
  it("exports bounded Canvas field types after a failed grade sync without exposing provider values", async () => {
    const h = harness();
    expect(await h.service.compatibilityReport()).toBeNull();
    await connect(h);
    h.overrideGroups([
      {
        id: 101,
        name: "PRIVATE_GROUP_TITLE",
        assignments: [
          {
            id: 987654321,
            name: "PRIVATE_ASSIGNMENT",
            points_possible: 98765.123,
            submission: { score: 12345.678 },
          },
        ],
        PRIVATE_PROPERTY: "PRIVATE_VALUE",
      },
    ]);
    await expect(h.service.handle("snapshot")).rejects.toThrow(
      "malformedCanvas",
    );
    const calls = h.calls.length;
    const report = await h.service.compatibilityReport();
    expect(h.calls).toHaveLength(calls);
    expect(await h.service.status()).toMatchObject({
      connected: true,
      compatibilityReportAvailable: true,
    });
    expect(report).toMatchObject({
      schema: 1,
      signIn: { result: "ok" },
      sync: {
        result: "failed",
        phase: "normalize",
        error: "malformedCanvas",
        responses: {
          assignmentGroups: {
            httpStatuses: [200],
            fields: {
              "$[].assignments[].points_possible": ["number"],
              "$[].assignments[].submission.score": ["number"],
              "$[].assignments[].assignment_group_id": ["missing"],
            },
          },
        },
      },
    });
    expect(JSON.stringify(report)).not.toMatch(
      /PRIVATE_|987654321|98765\.123|12345\.678|Synthetic Carmen|synthetic-canvas|https:\/\//,
    );
    expect(h.data.get("carmen-diagnostics")).not.toHaveProperty(
      "compatibilityReport",
    );
    await h.service.handle("disconnect");
    expect(await h.service.compatibilityReport()).toBeNull();
  });
  it("pings identity only at 90 minutes, without browser use or grade freshness changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const h = harness();
    await connect(h);
    const verified = (await h.service.status()).lastVerified;
    h.calls.length = 0;
    vi.setSystemTime(now + 89 * 60000);
    await h.service.expire();
    expect(h.calls).toEqual([]);
    vi.setSystemTime(now + 90 * 60000);
    h.alarm();
    await h.service.expire();
    expect(h.calls).toEqual(["/api/v1/users/self/profile"]);
    expect(h.browsers).toBe(3);
    expect(await h.service.status()).toMatchObject({
      lastVerified: verified,
      lastKeepalive: now + 90 * 60000,
      nextMaintenance: now + 180 * 60000,
      diagnostics: { verifiedUptimeMs: 90 * 60000 },
    });
  });
  it("does not schedule maintenance for Carmen before connection", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const h = harness();
    expect(await h.service.status()).toMatchObject({
      connected: false,
      maintenance: false,
      nextMaintenance: undefined,
    });
    vi.setSystemTime(now + 90 * 60000);
    await h.service.expire();
    expect(h.calls).toEqual([]);
    expect(h.browsers).toBe(0);
  });
  it("foreground sync defers the next check and disconnect stops it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const h = harness();
    await connect(h);
    vi.setSystemTime(now + 60 * 60000);
    await h.service.handle("snapshot");
    expect((await h.service.status()).nextMaintenance).toBe(now + 150 * 60000);
    await h.service.handle("disconnect");
    h.calls.length = 0;
    vi.setSystemTime(now + 200 * 60000);
    await h.service.expire();
    expect(h.calls).toEqual([]);
  });
  it.each([401, 403])(
    "bounds expired-session recovery and never renews denied access (%s)",
    async (status) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      const h = harness();
      await connect(h);
      h.fail(status);
      vi.setSystemTime(now + 90 * 60000);
      await h.service.expire();
      expect(h.browsers).toBe(status === 401 ? 4 : 3);
      expect(await h.service.status()).toMatchObject({
        connected: true,
        needsReconnect: true,
        nextMaintenance: undefined,
      });
    },
  );
  it("automatically captures a completed Carmen sign-in and closes its browser", async () => {
    const h = harness();
    const start = (await h.service.handle("start")) as { attempt: string };
    await h.service.expire();
    expect((await h.service.status()).connected).toBe(false);
    h.signIn();
    await h.service.expire();
    expect(
      await h.service.handle("progress", { attempt: start.attempt }),
    ).toMatchObject({ state: "connected", firstConnection: true });
    expect(h.closed).toBe(1);
    expect((await h.service.status()).diagnostics?.manualConnections).toBe(1);
  });
  it("records the rejected session separately from a successful bounded background SSO recovery", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const h = harness();
    await connect(h);
    h.fail(401);
    h.restore();
    vi.setSystemTime(now + 90 * 60000);
    h.alarm();
    await h.service.expire();
    const status = await h.service.status(),
      d = status.diagnostics!;
    expect(status).toMatchObject({
      needsReconnect: false,
      nextMaintenance: now + 180 * 60000,
    });
    expect(d).toMatchObject({
      recoveriesAttempted: 1,
      recoveriesSucceeded: 1,
      verifiedUptimeMs: 0,
      sessionStartedAt: now + 90 * 60000,
      firstRejection: {
        category: "authentication",
        httpStatus: 401,
        sessionAgeMs: 90 * 60000,
      },
    });
    expect(d.currentFailure).toBeUndefined();
    expect(h.closed).toBe(2);
    expect(portalHealth(status, now + 90 * 60000)).toEqual({
      label: "Connected",
      tone: "connected",
    });
    expect(JSON.stringify(d)).not.toMatch(
      /synthetic-canvas-session|synthetic-rotated|private synthetic|\.instructure\.com/,
    );
  });
  it("stops on Duo, preserves the failure reason and avoids another automatic browser", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const h = harness();
    await connect(h);
    h.fail(401);
    h.block("duo");
    vi.setSystemTime(now + 90 * 60000);
    await h.service.expire();
    const status = await h.service.status();
    expect(status.diagnostics?.currentFailure).toMatchObject({
      code: "recoveryDuo",
      category: "humanRequired",
      stage: "browser",
    });
    expect(status.nextMaintenance).toBeUndefined();
    expect(portalHealth(status)).toEqual({
      label: "Sign-in needed",
      tone: "error",
    });
    vi.setSystemTime(now + 100 * 60000);
    await expect(h.service.handle("check")).rejects.toThrow(
      "portalSignInRequired",
    );
    expect(h.browsers).toBe(4);
  });
  it("closes a stalled recovery at its deadline and does not keep retrying", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const h = harness();
    await connect(h);
    h.fail(401);
    h.hang();
    vi.setSystemTime(now + 90 * 60000);
    const attempt = h.service.expire();
    await vi.waitFor(() => expect(h.browsers).toBe(4));
    await vi.advanceTimersByTimeAsync(25_000);
    await attempt;
    expect(h.closed).toBe(2);
    expect((await h.service.status()).diagnostics?.currentFailure?.code).toBe(
      "recoveryTimedOut",
    );
    await h.service.expire();
    expect(h.browsers).toBe(4);
  });
  it("retains bounded diagnostics and distinguishes stale or failed access", () => {
    const d = newCarmenDiagnostics(now);
    for (let i = 0; i < 100; i++)
      carmenEvent(d, {
        at: now + i,
        type: "httpSuccess",
        trigger: "alarm",
        stage: "profile",
      });
    expect(d.events).toHaveLength(32);
    expect(d.profileSuccesses).toBe(100);
    expect(d.verifiedUptimeMs).toBe(99);
    expect(carmenFailure("private-cookie=secret")).toEqual({
      code: "unexpectedFailure",
      category: "unknown",
    });
    expect(
      portalHealth(
        {
          connected: true,
          needsReconnect: false,
          selected: [],
          diagnostics: d,
          maintenance: true,
        },
        now + 96 * 60000,
      ).label,
    ).toBe("Check overdue");
    carmenEvent(d, {
      at: now + 100,
      type: "failure",
      trigger: "alarm",
      stage: "profile",
      category: "network",
      code: "portalUnavailable",
    });
    carmenEvent(d, {
      at: now + 200,
      type: "httpSuccess",
      trigger: "manual",
      stage: "profile",
    });
    expect(d.verifiedUptimeMs).toBe(99);
    carmenEvent(d, {
      at: now + 201,
      type: "failure",
      trigger: "manual",
      stage: "profile",
      category: "network",
      code: "portalUnavailable",
    });
    expect(
      portalHealth(
        {
          connected: true,
          needsReconnect: false,
          selected: [],
          diagnostics: d,
        },
        now + 100,
      ).label,
    ).toBe("Access unconfirmed");
  });
  it("distinguishes denied, throttled, server, network and timed-out checks without browser recovery", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const [failure, category] of [
      [403, "accessDenied"],
      [429, "rateLimit"],
      [503, "server"],
      ["TypeError", "network"],
      ["TimeoutError", "timeout"],
    ] as const) {
      vi.setSystemTime(now);
      const h = harness();
      await connect(h);
      if (typeof failure === "number") h.fail(failure);
      else h.network(failure);
      vi.setSystemTime(now + 90 * 60000);
      await h.service.expire();
      const d = (await h.service.status()).diagnostics!;
      expect(d.currentFailure).toMatchObject({
        stage: "profile",
        category,
        sessionAgeMs: 90 * 60000,
      });
      expect(d.currentFailure?.httpStatus).toBe(
        typeof failure === "number" ? failure : undefined,
      );
      expect(h.browsers).toBe(3);
      expect(JSON.stringify(d)).not.toContain("private transport details");
    }
  });
  it("keeps the rolling recovery budget across midnight without launching another browser", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const h = harness();
    await connect(h);
    h.data.set("portal-browser-budget", {
      browserDay: "2026-11-04",
      browserMs: 0,
      recoveryHistory: [{ at: now, ms: 120000 }],
    });
    h.fail(401);
    vi.setSystemTime(Date.parse("2026-11-05T00:01:00Z"));
    await h.service.expire();
    expect(h.browsers).toBe(3);
    expect((await h.service.status()).diagnostics?.currentFailure?.code).toBe(
      "portalBrowserBudget",
    );
  });
  it("bounds transient retries and honors cooldown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const h = harness();
    await connect(h);
    h.fail(429);
    vi.setSystemTime(now + 90 * 60000);
    await h.service.expire();
    expect((await h.service.status()).nextMaintenance).toBe(now + 92 * 60000);
    vi.setSystemTime(now + 92 * 60000);
    await h.service.expire();
    vi.setSystemTime(now + 94 * 60000);
    await h.service.expire();
    expect((await h.service.status()).nextMaintenance).toBeUndefined();
  });
  it("shares the IC browser allowance and migrates the pre-Carmen budget", async () => {
    const h = harness();
    h.data.set("portal-browser-budget", {
      browserDay: new Date().toISOString().slice(0, 10),
      browserMs: 540_000,
    });
    await expect(h.service.handle("start")).rejects.toThrow(
      "portalBrowserBudget",
    );
    expect(h.browsers).toBe(0);
    const legacy = harness();
    const { seal } = await import("../worker/crypto");
    legacy.data.set(
      "portal-campus",
      await seal(
        {
          browserDay: new Date().toISOString().slice(0, 10),
          browserMs: 540_000,
        },
        "synthetic-app-password-12345",
      ),
    );
    await expect(legacy.service.handle("start")).rejects.toThrow(
      "portalBrowserBudget",
    );
  });
  it("rejects identity changes, unsafe pagination, and accepts only identity-verified empty courses", async () => {
    const h = harness();
    await connect(h);
    h.link('<https://evil.test/>; rel="next"');
    await expect(h.service.handle("snapshot")).rejects.toThrow(
      "invalidPortalRedirect",
    );
    const empty = harness();
    await connect(empty);
    empty.empty();
    expect(
      ((await empty.service.handle("snapshot")) as { courses: unknown[] })
        .courses,
    ).toEqual([]);
    empty.change();
    await expect(empty.service.handle("snapshot")).rejects.toThrow(
      "portalAccountChanged",
    );
  });
});

it("clears disconnected Schoology preferences in another browser while retaining Carmen data", async () => {
  const repository = await import("../src/repository"),
    { readSnapshot } = await import("../src/refresh"),
    { reconcile } = await import("../src/core/reconcile"),
    { syntheticCourses } = await import("./schoology-fixture");
  const c = parse()[0],
    sg = syntheticCourses(now)[0],
    scenario = { scores: {}, ignored: [], added: [] };
  const state = {
    schema: 1 as const,
    account: "workspace:synthetic",
    courses: reconcile([c, sg], [], now),
    scenarios: { [sg.id]: scenario, [c.id]: scenario },
    gpa: { weighting: "equal" as const, courses: {} },
    carmenGpa: { weighting: "credits" as const, courses: {} },
  };
  await repository.save(state);
  try {
    const next = await readSnapshot(state, {
      authenticated: true,
      connected: true,
      schoologyConnected: false,
      account: state.account,
    });
    expect(next.courses.map((x) => x.id)).toEqual([c.id]);
    expect(next.gpa).toBeUndefined();
    expect(next.scenarios[sg.id]).toBeUndefined();
    expect(next.scenarios[c.id]).toEqual(scenario);
    expect(next.carmenGpa).toEqual(state.carmenGpa);
  } finally {
    await repository.clear();
  }
});
