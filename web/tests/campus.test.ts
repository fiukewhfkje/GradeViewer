import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { campusChoices, campusStudent, parseCampus } from "../src/core/campus";
import { reconcile } from "../src/core/reconcile";
import {
  physicalKey,
  visibleCourses,
  descriptor,
  overall,
} from "../src/core/periods";
import { calculate, hypothetical } from "../src/core/calculator";
import { gpaSemesters, estimateGpa } from "../src/core/gpa";
import { syntheticCourses } from "./schoology-fixture";
import { recentProgression } from "../src/core/progression";
import { PortalService, browserJar, campusURL } from "../worker/portal";
import type { PortalBinding, PortalBrowser } from "../worker/portal-browser";
import { portalBrowser } from "../worker/portal-browser";
import { seal } from "../worker/crypto";
import {
  campusSummary,
  campusDetail,
  campusPortal,
  campusState,
  campusCompositeFixture,
  campusBackfillFixture,
} from "./campus-fixture";
const now = Date.parse("2026-11-04T17:00:00Z");
afterEach(() => vi.useRealTimers());
const parsed = () =>
  parseCampus(
    campusSummary,
    { "100": campusDetail },
    ["1:100"],
    "account",
    now,
  );
describe("selected IC normalization", () => {
  it("backfills dated semester events using task category options and explicit composite child weights", () => {
    const { summary, detail } = campusBackfillFixture();
    const before = JSON.stringify({ summary, detail });
    const sources = parseCampus(
      summary,
      { "100": detail },
      ["1:100"],
      "account",
      now,
    );
    const courses = reconcile(sources, [], now);
    const q1 = courses.find((c) => c.term.id === "501:1")!;
    const q2 = courses.find((c) => c.term.id === "502:1")!;
    const final = overall(q2, courses);
    expect([q1.method, q2.method]).toEqual([
      "weightedCategories",
      "weightedCategories",
    ]);
    expect([q1.term.weight, q2.term.weight]).toEqual([3, 4]);
    expect([calculate(q1), calculate(q2)]).toEqual([82, 96]);
    const points = recentProgression(q2, courses, now);
    expect(points.map((p) => p.date)).toEqual(
      ["2026-09-10", "2026-09-20", "2026-09-25", "2026-10-05", "2026-10-20"]
        .map(Date.parse)
        .concat(now),
    );
    const expected = [50, 70, 82, (82 * 3 + 100 * 4) / 7, 90, 90];
    points.forEach((p, i) => expect(p.percent).toBeCloseTo(expected[i]));
    expect(points.slice(0, -1).every((p) => p.calculated)).toBe(true);
    expect(points.at(-1)?.calculated).toBe(false);
    expect(final.history).toHaveLength(1);
    expect(final.grade.percent).toBe(90);
    expect(JSON.stringify({ summary, detail })).toBe(before);
  });
  it("withholds composite backfill for missing/conflicting rules, invalid weights and incompatible totals", () => {
    for (const problem of [
      "missing",
      "negative",
      "conflicting",
      "baseline",
      "ambiguous",
    ]) {
      const { summary, detail } = campusBackfillFixture();
      const final = detail.details.find(
        (entry) => entry.task.termID === 502 && entry.task.taskID === 4,
      )!;
      if (problem === "missing") delete final.children![0].calculationWeight;
      if (problem === "negative") final.children![0].calculationWeight = -1;
      if (problem === "conflicting")
        detail.details[0].categories[0].isWeighted = false;
      if (problem === "baseline")
        summary[0].terms[1].courses[0].gradingTasks.find(
          (t) => t.taskID === 4,
        )!.progressPercent = 91;
      if (problem === "ambiguous") {
        const duplicate = { ...final.task, taskID: 6 };
        summary[0].terms[1].courses[0].gradingTasks.push(duplicate);
        detail.details.push({ ...structuredClone(final), task: duplicate });
      }
      const courses = reconcile(
        parseCampus(summary, { "100": detail }, ["1:100"], "account", now),
        [],
        now,
      );
      const q2 = courses.find((c) => c.term.id === "502:1")!;
      if (problem === "ambiguous") {
        expect(courses.every((c) => c.term.weight === undefined)).toBe(true);
        continue;
      }
      const points = recentProgression(q2, courses, now);
      if (problem === "conflicting") {
        expect(
          points.filter((p) => p.date < Date.parse("2026-10-02")),
          problem,
        ).toEqual([]);
      } else {
        expect(points, problem).toHaveLength(1);
        expect(points[0].calculated, problem).toBe(false);
      }
    }
  });
  it("maps Q2/Q4 Final tasks to semesters using their explicit child links", () => {
    const { summary, detail } = campusCompositeFixture();
    const courses = parseCampus(
      summary,
      { "100": detail },
      ["1:100"],
      "account",
      now,
    );
    const finals = courses.filter((c) => descriptor(c).kind === "semester");
    expect(finals.map((c) => descriptor(c).label)).toEqual(["S1", "S2"]);
    expect(finals[0].term.start).toBe(Date.parse("2026-08-15"));
    expect(finals[0].term.end).toBe(Date.parse("2026-12-18"));
    expect(finals[0].grade.percent).toBe(90); // provider total, not an average of the quarters
    expect(finals[0].assignments).toEqual([]);
    expect(courses.every((c) => c.term.weight === undefined)).toBe(true);
    const current = visibleCourses(reconcile(courses), now)[0];
    expect(descriptor(current).label).toBe("Q2");
    expect(overall(current, courses).id).toBe(finals[0].id);
    for (const q of courses.filter((c) =>
      ["Q1", "Q2"].includes(descriptor(c).label),
    ))
      expect(overall(q, courses).id).toBe(finals[0].id);
    const schoology = syntheticCourses(now),
      term = gpaSemesters(schoology, now)[0];
    const result = estimateGpa([...schoology, ...courses], term, {
      weighting: "equal",
      courses: {},
    });
    expect(result.rows).toHaveLength(6);
    expect(
      result.rows.find((r) => r.title === "Synthetic IC-only course"),
    ).toMatchObject({ points: 3.67, reason: undefined });
  });
  it.each(["missing", "duplicate", "foreign", "wrong-quarter", "self"])(
    "withholds an inferred semester span for %s child links",
    (problem) => {
      const { summary, detail } = campusCompositeFixture();
      const final = detail.details.find(
        (entry) => entry.children?.length === 3,
      )!;
      if (problem === "missing") delete final.children;
      else if (problem === "duplicate")
        final.children!.push({ ...final.children![0] });
      else if (problem === "foreign") final.children![0].sectionID = 999;
      else if (problem === "wrong-quarter") final.children![0].termID = 503;
      else final.children![0].taskID = 4;
      const courses = parseCampus(
        summary,
        { "100": detail },
        ["1:100"],
        "account",
        now,
      );
      const s = courses.find((c) => c.term.id === "502:4")!;
      expect(s.term.start).toBeUndefined();
      expect(s.grade.percent).toBe(90);
      expect(
        gpaSemesters(courses, now).some((term) => term.course.id === s.id),
      ).toBe(true);
      const row = estimateGpa(
        [...syntheticCourses(now), ...courses],
        gpaSemesters(syntheticCourses(now), now)[0],
        { weighting: "equal", courses: {} },
      ).rows.find((r) => r.title === s.title);
      expect(row?.points).toBeUndefined();
    },
  );
  it("uses sectionID, scoped identities and normal calculator/GPA behavior", () => {
    expect(campusChoices(campusSummary)[0]).toMatchObject({
      id: "1:100",
      section: "100",
    });
    const source = parsed()[0];
    expect(calculate(source)).toBe(90);
    expect(source.grade).toEqual({ percent: 90, letter: "A-" });
    expect(
      hypothetical(source, {
        scores: { [source.assignments[0].id]: 10 },
        ignored: [],
        added: [],
      })?.percent,
    ).toBe(100);
    const term = gpaSemesters([source], now)[0];
    expect(
      estimateGpa([source], term, { weighting: "equal", courses: {} })
        .unweighted,
    ).toBe(3.67);
    const courses = reconcile([source], [], now);
    expect(courses[0].history[0].provider).toBe("campus");
    expect(physicalKey(source)).not.toBe("100");
    expect(
      visibleCourses([...syntheticCourses(now), ...courses], now).some(
        (x) => x.id === source.id,
      ),
    ).toBe(true);
  });
  it("includes IC in the existing GPA semester despite different instructional start dates, preserving Schoology keys", () => {
    const schoology = syntheticCourses(now),
      baseline = gpaSemesters(schoology, now)[0],
      courses = [...schoology, ...parsed()];
    expect(gpaSemesters(courses, now)).toHaveLength(
      gpaSemesters(schoology, now).length,
    );
    expect(gpaSemesters(courses, now)[0].id).toBe(baseline.id);
    expect(
      estimateGpa(courses, baseline, {
        weighting: "equal",
        courses: {},
      }).rows.some(
        (r) => r.title === "Synthetic IC-only course" && r.points === 3.67,
      ),
    ).toBe(true);
  });
  it("imports only selected courses and keeps real zero separate from posted grades", () => {
    expect(parseCampus(campusSummary, {}, [], "account")).toEqual([]);
    expect(parseCampus([], {}, ["1:100"], "account")).toEqual([]);
    const summary = structuredClone(campusSummary),
      task = summary[0].terms[0].courses[0].gradingTasks[0];
    Object.assign(task, {
      progressPercent: 0,
      progressScore: "F",
      percent: 99,
      score: "A",
    });
    expect(
      parseCampus(summary, { "100": campusDetail }, ["1:100"], "account")[0]
        .grade,
    ).toEqual({ percent: 0, letter: "F" });
  });
  it.each([{}, "<html>login</html>", [{ schoolID: 1 }], null])(
    "rejects malformed summary %#",
    (input) => expect(() => campusChoices(input)).toThrow(),
  );
  it.each([
    [],
    { details: null },
    {
      details: [
        {
          task: { termID: 5, taskID: 1 },
          categories: [{ name: "Invalid", assignments: [] }],
        },
      ],
    },
  ])("rejects malformed detail %#", (detail) =>
    expect(() =>
      parseCampus(campusSummary, { "100": detail }, ["1:100"], "account"),
    ).toThrow(),
  );
  it("requires student identity and refuses nested teacher identities", () => {
    expect(campusStudent({ personID: 101 })).toBe("101");
    expect(() => campusStudent([{ teacher: { personID: 101 } }])).toThrow(
      "campusIdentityUnsupported",
    );
    expect(() => campusStudent([])).toThrow();
  });
  it("calculates unweighted score percentages without raw-point/category reweighting", () => {
    for (const rules of ["category", "task"]) {
      const detail = structuredClone(campusDetail),
        cat = detail.details[0].categories[0];
      if (rules === "category") Object.assign(cat, { useScorePercent: true });
      else
        Object.assign(detail.details[0].task, {
          groupWeighted: false,
          usePercent: true,
        });
      cat.assignments.push({
        ...cat.assignments[0],
        objectSectionID: 8,
        scorePoints: 0,
        totalPoints: 100,
      });
      expect(
        calculate(
          parseCampus(
            campusSummary,
            { "100": detail },
            ["1:100"],
            "account",
          )[0],
        ),
        rules,
      ).toBe(45);
    }
  });
});
function harness(withBinding = false) {
  const data = new Map<string, unknown>();
  let selectedPortal: string | undefined = campusPortal;
  const navigations: string[] = [];
  let browserCalls = 0,
    closed = 0;
  let identity: string | undefined = "101",
    studentNumber: string | undefined,
    failure = false,
    unavailable = false,
    malformed = false;
  const calls: string[] = [];
  const storage = {
    get: async (k: string) => structuredClone(data.get(k)),
    put: async (k: string, v: unknown) => {
      data.set(k, structuredClone(v));
    },
    delete: async (k: string) => data.delete(k),
    setAlarm: async () => {},
  } as unknown as DurableObjectStorage;
  const upstream = async function (this: unknown, req: Request) {
    // Workerd's global fetch rejects a receiver other than the global object.
    if (this !== undefined) throw new TypeError("Illegal invocation");
    const u = new URL(req.url);
    calls.push(u.pathname);
    expect(req.method).toBe("GET");
    expect(u.hostname).toBe("fixture.infinitecampus.org");
    expect(req.redirect).toBe("manual");
    if (failure) return Response.json({}, { status: 401 });
    if (u.pathname.endsWith("/roster"))
      return Response.json(
        identity ? { personID: identity } : [{ sectionID: 100 }],
      );
    if (u.pathname.endsWith("/grades"))
      return unavailable
        ? Response.json({}, { status: 503 })
        : Response.json(campusSummary);
    if (u.pathname.endsWith("/detail/100"))
      return Response.json(malformed ? [] : campusDetail);
    return Response.json({}, { status: 404 });
  };
  class Service extends PortalService {
    protected async browser(): Promise<PortalBrowser> {
      browserCalls++;
      return {
        id: "synthetic-browser",
        state: async () => structuredClone(campusState),
        live: async () =>
          "https://live.browser.run/ui/view?mode=tab&synthetic=true",
        navigate: async (url) => {
          navigations.push(url);
        },
        studentPortal: async () => selectedPortal,
        studentNumber: async () => studentNumber,
        url: () => campusPortal,
        ready: async () => {},
        close: async () => {},
      };
    }
  }
  const binding = withBinding
    ? ({
        devtools: {
          listTargets: async () => [
            {
              type: "page",
              url: selectedPortal ?? "https://www.infinitecampus.com/login",
            },
          ],
        },
        closeSession: async () => {
          closed++;
        },
      } as unknown as PortalBinding)
    : undefined;
  return {
    service: new Service(
      storage,
      "synthetic-owner-password-123456",
      binding,
      upstream,
    ),
    data,
    calls,
    navigations,
    browserCalls: () => browserCalls,
    closed: () => closed,
    setStudentNumber: (value: string) => {
      identity = undefined;
      studentNumber = value;
    },
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
    selectPortal: (url?: string) => {
      selectedPortal = url;
    },
    changeIdentity: () => {
      identity = "202";
    },
    expire: () => {
      failure = true;
    },
    malform: () => {
      malformed = true;
    },
  };
}
describe("encrypted IC session and selected snapshots", () => {
  it("keeps existing IC connections and ignores legacy automatic maintenance", async () => {
    const h = harness();
    h.data.set(
      "portal-campus",
      await seal(
        {
          browserMs: 0,
          connection: {
            portal: campusPortal,
            account: "synthetic-existing-account",
            selected: ["1:100"],
            maintenance: true,
            nextMaintenance: now,
          },
        },
        "synthetic-owner-password-123456",
      ),
    );
    expect(await h.service.status()).toMatchObject({
      connected: true,
      selected: ["1:100"],
      maintenance: false,
      nextMaintenance: undefined,
    });
    await h.service.expire();
    expect(h.calls).toEqual([]);
    expect(h.browserCalls()).toBe(0);
  });
  it.each([false, true])(
    "checks IC at 20 minutes without a browser or grade freshness change (profile-bound %s)",
    async (profileBound) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      const h = harness();
      if (profileBound) h.setStudentNumber("123456");
      await h.service.handle("start", { portal: campusPortal });
      await h.service.handle("finish");
      await h.service.handle("select", { selected: ["1:100"] });
      expect(await h.service.status()).toMatchObject({
        maintenance: false,
        nextMaintenance: undefined,
      });
      h.calls.length = 0;
      await h.service.handle("maintenance", { enabled: true });
      expect(h.calls).toEqual([]);
      const verified = (await h.service.status()).lastVerified,
        browsers = h.browserCalls();
      h.calls.length = 0;
      vi.setSystemTime(now + 19 * 60000);
      await h.service.expire();
      expect(h.calls).toEqual([]);
      vi.setSystemTime(now + 20 * 60000);
      await h.service.expire();
      expect(h.calls).toEqual([
        profileBound
          ? "/campus/resources/portal/grades"
          : "/campus/resources/portal/roster",
      ]);
      expect(h.browserCalls()).toBe(browsers);
      expect((await h.service.status()).diagnostics?.backgroundChecks).toBe(1);
      expect(await h.service.status()).toMatchObject({
        selected: ["1:100"],
        maintenance: true,
        lastVerified: verified,
        lastKeepalive: now + 20 * 60000,
        nextMaintenance: now + 40 * 60000,
      });
      await h.service.handle("maintenance", { enabled: false });
      h.calls.length = 0;
      vi.setSystemTime(now + 50 * 60000);
      await h.service.expire();
      expect(h.calls).toEqual([]);
      await h.service.handle("maintenance", { enabled: true });
      h.expire();
      vi.setSystemTime(now + 70 * 60000);
      await h.service.expire();
      expect(await h.service.status()).toMatchObject({
        needsReconnect: true,
        nextMaintenance: undefined,
        selected: ["1:100"],
      });
      h.calls.length = 0;
      vi.setSystemTime(now + 90 * 60000);
      await h.service.expire();
      expect(h.calls).toEqual([]);
      expect(h.browserCalls()).toBe(browsers);
    },
  );
  it.each([
    ["429: Browser time limit exceeded for today", "portalBrowserDailyLimit"],
    ["429: Too many requests", "portalBrowserRateLimited"],
  ])("classifies Browser Run launch failure %s", async (message, code) => {
    const binding = {
      acquire: async () => {
        throw new Error(message);
      },
    } as unknown as PortalBinding;
    await expect(portalBrowser(binding)).rejects.toMatchObject({
      code,
      status: 429,
      retryAfter: expect.any(Number),
    });
  });
  it("waits at district sign-in, then verifies the short Campus home and closes the same browser", async () => {
    const h = harness(true);
    const { attempt } = (await h.service.handle("start")) as {
      attempt: string;
    };
    await h.service.expire();
    expect(h.browserCalls()).toBe(1);
    expect(h.calls).toEqual([]);
    expect(await h.service.handle("progress", { attempt })).toEqual({
      state: "waiting",
    });
    await expect(
      h.service.handle("progress", { attempt: "another-attempt" }),
    ).rejects.toThrow("portalSignInExpired");
    expect(h.closed()).toBe(0);

    h.selectPortal(new URL("/campus/nav-wrapper", campusPortal).href);
    h.setStudentNumber("123456");
    h.setUnavailable(true);
    await h.service.expire();
    await expect(h.service.handle("progress", { attempt })).rejects.toThrow(
      "portalVerificationUnavailable",
    );
    expect((await h.service.status()).connected).toBe(false);
    expect(h.closed()).toBe(0);

    h.setUnavailable(false);
    await h.service.handle("progress", { attempt, retry: true });
    await h.service.expire();
    expect(h.closed()).toBe(1);
    expect(await h.service.handle("progress", { attempt })).toMatchObject({
      state: "connected",
      firstConnection: true,
    });
    await h.service.handle("select", { selected: ["1:100"] });
    expect(await h.service.handle("snapshot")).toMatchObject({
      courses: [expect.anything()],
    });

    const reconnect = (await h.service.handle("start")) as { attempt: string };
    h.setStudentNumber("234567");
    await h.service.expire();
    await expect(
      h.service.handle("progress", { attempt: reconnect.attempt }),
    ).rejects.toThrow("portalAccountChanged");
    expect((await h.service.status()).selected).toEqual(["1:100"]);
    h.setStudentNumber("123456");
    await h.service.handle("progress", {
      attempt: reconnect.attempt,
      retry: true,
    });
    await h.service.expire();
    expect(
      await h.service.handle("progress", { attempt: reconnect.attempt }),
    ).toMatchObject({
      state: "connected",
      firstConnection: false,
      selected: ["1:100"],
    });
    expect(h.closed()).toBe(2);
  });
  it("stages sign-in, verifies identity, encrypts cookies and reads only selected sectionID details", async () => {
    const h = harness();
    await h.service.handle("start", { portal: campusPortal });
    expect((await h.service.status()).connected).toBe(false);
    await h.service.handle("finish");
    expect((await h.service.status()).connected).toBe(true);
    expect(JSON.stringify([...h.data.values()])).not.toContain(
      "synthetic-session",
    );
    await h.service.handle("select", { selected: ["1:100"] });
    expect(
      ((await h.service.handle("snapshot")) as { courses: unknown[] }).courses,
    ).toHaveLength(1);
    expect(h.calls).toContain("/campus/resources/portal/grades/detail/100");
    expect(h.calls.some((x) => x.includes("wrong-detail-id"))).toBe(false);
    await h.service.handle("disconnect");
    expect((await h.service.status()).connected).toBe(false);
  });
  it("retains selected courses and avoids browser launches on repeated expired refreshes", async () => {
    const h = harness();
    await h.service.handle("start", { portal: campusPortal });
    h.data.set(
      "portal-campus-entry",
      "https://fixture.infinitecampus.org/campus/SSO/fixture/portal/students?configID=1",
    );
    await h.service.handle("finish");
    await h.service.handle("select", { selected: ["1:100"] });
    const before = h.browserCalls();
    h.expire();
    await expect(h.service.handle("snapshot")).rejects.toThrow(
      "portalSignInRequired",
    );
    await expect(h.service.handle("snapshot")).rejects.toThrow(
      "portalSignInRequired",
    );
    expect(h.browserCalls()).toBe(before);
    expect(await h.service.status()).toMatchObject({
      connected: true,
      needsReconnect: true,
      selected: ["1:100"],
    });
    await h.service.handle("start");
    expect(h.browserCalls()).toBe(before + 1);
    expect(h.navigations.at(-1)).toBe(
      "https://fixture.infinitecampus.org/campus/SSO/fixture/portal/students?configID=1",
    );
    await h.service.handle("cancel");
  });
  it("rejects account changes and malformed selected details", async () => {
    const h = harness();
    await h.service.handle("start", { portal: campusPortal });
    await h.service.handle("finish");
    await h.service.handle("select", { selected: ["1:100"] });
    h.malform();
    await expect(h.service.handle("snapshot")).rejects.toThrow();
    h.changeIdentity();
    await expect(h.service.handle("courses")).rejects.toThrow(
      "portalAccountChanged",
    );
    expect((await h.service.status()).selected).toEqual(["1:100"]);
  });
  it.each([
    "http://fixture.infinitecampus.org/campus/portal/students/x.jsp",
    "https://evil.test/campus/portal/students/x.jsp",
    "https://localhost/campus/portal/students/x.jsp",
    "https://fixture.infinitecampus.org/campus/portal/students/x.jsp?token=bad",
  ])("rejects unsafe district URL %s", (url) =>
    expect(() => campusURL(url)).toThrow(),
  );
  it("isolates cookie host/path and never sends IdP cookies with grade reads", () => {
    const state = structuredClone(campusState);
    state.cookies.push({
      ...state.cookies[0],
      domain: "accounts.google.com",
      name: "IdP",
      value: "never-forward",
    });
    const jar = browserJar(state, new URL(campusPortal).origin);
    expect(
      jar.getCookieStringSync(
        "https://fixture.infinitecampus.org/campus/resources/portal/grades",
      ),
    ).toBe("JSESSIONID=synthetic-session");
    expect(jar.getCookieStringSync("https://evil.test/campus")).toBe("");
    expect(
      jar.getCookieStringSync("https://fixture.infinitecampus.org/other"),
    ).toBe("");
  });
});

describe("IC account reset and local privacy", () => {
  it("allows explicit disconnect after an app-password change", async () => {
    const h = harness();
    await h.service.handle("start", { portal: campusPortal });
    await h.service.handle("finish");
    const storage = {
      get: async (k: string) => structuredClone(h.data.get(k)),
      put: async (k: string, v: unknown) => {
        h.data.set(k, structuredClone(v));
      },
      delete: async (k: string) => h.data.delete(k),
    } as unknown as DurableObjectStorage;
    const changed = new PortalService(
      storage,
      "different-synthetic-app-password",
    );
    expect(await changed.status()).toMatchObject({
      connected: true,
      needsReconnect: true,
    });
    await changed.handle("disconnect");
    expect((await h.service.status()).connected).toBe(false);
  });
  it("clears only IC grades, scenarios and GPA preferences on provider disconnect", async () => {
    const repository = await import("../src/repository"),
      { refreshCampus } = await import("../src/portal-refresh");
    const own = parsed()[0],
      sg = syntheticCourses(now)[0];
    const key = JSON.stringify(["term", physicalKey(own)]),
      sgKey = JSON.stringify(["term", physicalKey(sg)]);
    const state = {
      schema: 1 as const,
      account: "synthetic-owner",
      courses: reconcile([own, sg], [], now),
      scenarios: {
        [own.id]: { scores: {}, ignored: [], added: [] },
        [sg.id]: { scores: {}, ignored: [], added: [] },
      },
      gpa: {
        weighting: "equal" as const,
        courses: { [key]: { excluded: true }, [sgKey]: { excluded: true } },
      },
    };
    await repository.save(state);
    const result = await refreshCampus(state, {
      connected: false,
      needsReconnect: false,
      selected: [],
    });
    expect(result.courses.some((c) => c.fields.provider === "campus")).toBe(
      false,
    );
    expect(result.scenarios[own.id]).toBeUndefined();
    expect(result.scenarios[sg.id]).toBeDefined();
    expect(result.gpa?.courses[key]).toBeUndefined();
    expect(result.gpa?.courses[sgKey]).toBeDefined();
    await repository.clear();
  });
  it("keeps a reported grade when a zero multiplier prevents supported local math", () => {
    const detail = structuredClone(campusDetail);
    detail.details[0].categories[0].assignments[0].multiplier = 0;
    const course = parseCampus(
      campusSummary,
      { "100": detail },
      ["1:100"],
      "account",
    )[0];
    expect(course.grade.percent).toBe(90);
    expect(course.method).toBe("unknown");
  });
});

describe("district finder sign-in and modern Student URLs", () => {
  it("opens the official district finder without a pasted URL, then verifies the selected district", async () => {
    const h = harness();
    await h.service.handle("start");
    expect(h.navigations).toEqual(["https://www.infinitecampus.com/login"]);
    await h.service.handle("finish");
    expect((await h.service.status()).portal).toBe(campusPortal);
    await h.service.handle("start");
    expect(h.navigations[1]).toBe(campusPortal);
  });
  it("keeps sign-in pending until a Student portal is selected", async () => {
    const h = harness();
    h.selectPortal(undefined);
    await h.service.handle("start");
    await expect(h.service.handle("finish")).rejects.toThrow(
      "portalChooseStudent",
    );
    expect((await h.service.status()).connected).toBe(false);
    h.selectPortal(campusPortal);
    await h.service.handle("finish");
    expect((await h.service.status()).connected).toBe(true);
  });
  it("recognizes the historical modern home and safely discards transient SAML fields", async () => {
    const { observedCampusPortal } = await import("../worker/campus-url");
    const modern =
      "https://fixture.infinitecampus.org/campus/nav-wrapper/student/portal/student/home?appName=fixture";
    expect(campusURL(modern).href).toBe(modern);
    expect(
      observedCampusPortal(
        modern + "&SAMLResponse=private&RelayState=private#secret",
      ),
    ).toBe(modern);
    expect(
      observedCampusPortal(
        "https://fixture.infinitecampus.org/campus/SSO/fixture/portal/students?configID=1&SAMLRequest=private",
      ),
    ).toBe(campusPortal);
    expect(
      observedCampusPortal(
        "https://evil.test/campus/portal/students/fixture.jsp",
      ),
    ).toBeUndefined();
    expect(
      observedCampusPortal(
        "https://fixture.infinitecampus.org/campus/nav-wrapper/parent/portal/student/home",
      ),
    ).toBeUndefined();
  });
});
