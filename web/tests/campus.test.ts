import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { campusChoices, campusStudent, parseCampus } from "../src/core/campus";
import { reconcile } from "../src/core/reconcile";
import { physicalKey, visibleCourses } from "../src/core/periods";
import { calculate, hypothetical } from "../src/core/calculator";
import { gpaSemesters, estimateGpa } from "../src/core/gpa";
import { demoCourses } from "../src/core/demo";
import { PortalService, browserJar, campusURL } from "../worker/portal";
import type { PortalBrowser } from "../worker/portal-browser";
import {
  campusSummary,
  campusDetail,
  campusPortal,
  campusState,
} from "./campus-fixture";
const now = Date.parse("2026-11-04T17:00:00Z");
const parsed = () =>
  parseCampus(
    campusSummary,
    { "100": campusDetail },
    ["1:100"],
    "account",
    now,
  );
describe("selected IC normalization", () => {
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
      visibleCourses([...demoCourses(now), ...courses], now).some(
        (x) => x.id === source.id,
      ),
    ).toBe(true);
  });
  it("includes IC in the existing GPA semester despite different instructional start dates, preserving Schoology keys", () => {
    const schoology = demoCourses(now),
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
    const detail = structuredClone(campusDetail),
      cat = detail.details[0].categories[0];
    Object.assign(cat, { useScorePercent: true });
    cat.assignments.push({
      ...cat.assignments[0],
      objectSectionID: 8,
      scorePoints: 0,
      totalPoints: 100,
    });
    expect(
      calculate(
        parseCampus(campusSummary, { "100": detail }, ["1:100"], "account")[0],
      ),
    ).toBe(45);
  });
});
function harness() {
  const data = new Map<string, unknown>();
  let selectedPortal: string | undefined = campusPortal;
  const navigations: string[] = [];
  let browserCalls = 0;
  let identity = "101",
    failure = false,
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
  const upstream = async (req: Request) => {
    const u = new URL(req.url);
    calls.push(u.pathname);
    expect(req.method).toBe("GET");
    expect(u.hostname).toBe("fixture.infinitecampus.org");
    expect(req.redirect).toBe("manual");
    if (failure) return Response.json({}, { status: 401 });
    if (u.pathname.endsWith("/roster"))
      return Response.json({ personID: identity });
    if (u.pathname.endsWith("/grades")) return Response.json(campusSummary);
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
        url: () => campusPortal,
        close: async () => {},
      };
    }
  }
  return {
    service: new Service(
      storage,
      "synthetic-owner-password-123456",
      undefined,
      upstream,
    ),
    data,
    calls,
    navigations,
    browserCalls: () => browserCalls,
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
      sg = demoCourses(now)[0];
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
