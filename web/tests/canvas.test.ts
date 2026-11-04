import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { canvasChoices, canvasStudent, parseCanvas } from "../src/core/canvas";
import { canvasNext, canvasCoursesPath, canvasURL } from "../worker/canvas";
import { calculate } from "../src/core/calculator";
import { estimateGpa, gpaSemesters } from "../src/core/gpa";
import { PortalService } from "../worker/portal";
import type { PortalBrowser } from "../worker/portal-browser";
import { unseal, type Envelope } from "../worker/crypto";
import { canvasCourses, canvasDetails, canvasState } from "./canvas-fixture";
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
        navigate: async () => {},
        url: () => "https://osu.instructure.com/",
        ready: async () => {},
        close: async () => {},
      };
    }
  }
  const upstream = async (req: Request) => {
    const u = new URL(req.url);
    calls.push(u.pathname);
    expect(req.method).toBe("GET");
    expect(u.origin).toBe("https://osu.instructure.com");
    expect(req.headers.get("Cookie")).not.toContain("idp");
    if (failure)
      return Response.json(
        {},
        {
          status: failure,
          headers: failure === 429 ? { "Retry-After": "120" } : {},
        },
      );
    if (u.pathname.endsWith("/profile"))
      return Response.json(
        { id: identity },
        {
          headers: {
            "Set-Cookie":
              "_normandy_session=synthetic-rotated; Path=/; Secure; HttpOnly",
          },
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
      return Response.json(d["101:groups"]);
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
    fail: (s: number) => {
      failure = s;
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
    });
  });
  it("foreground sync defers ping and disabling maintenance prevents it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const h = harness();
    await connect(h);
    vi.setSystemTime(now + 60 * 60000);
    await h.service.handle("snapshot");
    expect((await h.service.status()).nextMaintenance).toBe(now + 150 * 60000);
    await h.service.handle("maintenance", { enabled: false });
    h.calls.length = 0;
    vi.setSystemTime(now + 200 * 60000);
    await h.service.expire();
    expect(h.calls).toEqual([]);
  });
  it.each([401, 403])(
    "pauses expired/denied background access (%s) without SSO automation",
    async (status) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      const h = harness();
      await connect(h);
      h.fail(status);
      vi.setSystemTime(now + 90 * 60000);
      await h.service.expire();
      expect(h.browsers).toBe(3);
      expect(await h.service.status()).toMatchObject({
        connected: true,
        needsReconnect: true,
        nextMaintenance: undefined,
      });
    },
  );
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
    { demoCourses } = await import("../src/core/demo");
  const c = parse()[0],
    sg = demoCourses(now)[0],
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
