import { canvasCourses, canvasDetails, canvasState } from "./canvas-fixture";
import { PortalService } from "../worker/portal";
import type { PortalBrowser } from "../worker/portal-browser";
import { ApiError } from "../worker/provider";
import {
  campusSummary,
  campusDetail,
  campusState,
  campusPortal,
  campusBackfillFixture,
} from "./campus-fixture";
// Separate test entry point. Production imports neither this file nor its fixture provider.
import worker, { CredentialVault, type Env } from "../worker/index";
import { syntheticPayload, SYNTHETIC_ACCOUNT } from "./schoology-fixture";
import { version } from "../package.json";
let releaseFixture: {
  version: string;
  publishedAt?: string;
  failure?: boolean;
} = { version };
export class FixtureVault extends CredentialVault {
  private gates = new Map<
    string,
    { promise: Promise<void>; release: () => void; waiting: boolean }
  >();
  private async waitForGate(kind: string) {
    const gate = this.gates.get(kind);
    if (gate) {
      gate.waiting = true;
      await gate.promise;
    }
  }
  constructor(
    private fixtureState: DurableObjectState,
    private fixtureEnv: Env,
  ) {
    super(fixtureState, fixtureEnv);
  }
  protected override portals(kind: "campus" | "carmen" = "campus") {
    const storage = this.fixtureState.storage;
    class FixturePortal extends PortalService {
      protected override async browser(): Promise<PortalBrowser> {
        const config = await storage.get<{ startLimited?: boolean }>(
          "synthetic-campus",
        );
        if (config?.startLimited)
          throw new ApiError(429, "portalBrowserDailyLimit");
        return {
          id: "synthetic-session",
          state: async () =>
            structuredClone(kind === "carmen" ? canvasState : campusState),
          live: async () => "/api/fixture/portal-window?provider=" + kind,
          navigate: async () => {
            await storage.delete(`synthetic-${kind}-signed-in`);
          },
          url: () => campusPortal,
          studentPortal: async () =>
            (await storage.get(`synthetic-${kind}-signed-in`))
              ? kind === "carmen"
                ? "https://osu.instructure.com/"
                : new URL("/campus/nav-wrapper", campusPortal).href
              : undefined,
          ready: async () => {},
          close: async () => {},
        };
      }
    }
    return new FixturePortal(
      this.fixtureState.storage,
      this.fixtureEnv.APP_PASSWORD,
      undefined,
      this.upstream,
      kind,
    );
  }
  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/api/fixture/gate") {
      const kind = new URL(request.url).searchParams.get("kind") ?? "provider";
      if (!["provider", "status", "maintenance"].includes(kind))
        return Response.json({}, { status: 400 });
      if (request.method === "POST") {
        const { held } = (await request.json()) as { held: boolean };
        this.gates.get(kind)?.release();
        this.gates.delete(kind);
        if (held) {
          let release!: () => void;
          const promise = new Promise<void>((resolve) => {
            release = resolve;
          });
          this.gates.set(kind, { promise, release, waiting: false });
        }
      }
      return Response.json({ waiting: this.gates.get(kind)?.waiting ?? false });
    }
    if (path === "/api/fixture/rate-limit" && request.method === "POST") {
      const { enabled } = (await request.json()) as { enabled: boolean };
      await this.fixtureState.storage.put("synthetic-scan-limit", !!enabled);
      return Response.json({ ok: true });
    }
    if (path === "/api/status") await this.waitForGate("status");
    if (path === "/api/campus/maintenance")
      await this.waitForGate("maintenance");
    if (
      path === "/api/scan/start" &&
      (await this.fixtureState.storage.get("synthetic-scan-limit"))
    )
      return Response.json(
        { error: "rateLimited", retryAfter: 1 },
        { status: 429, headers: { "Retry-After": "1" } },
      );
    if (path === "/api/fixture/portal-window") {
      const url = new URL(request.url);
      const kind = url.searchParams.get("provider");
      if (kind !== "campus" && kind !== "carmen")
        return new Response(null, { status: 404 });
      let content =
        '<p>This preview uses synthetic data. No school credentials are needed.</p><form method="post"><button>Complete synthetic sign-in</button></form>';
      if (request.method === "POST") {
        if (request.headers.get("Origin") !== url.origin)
          return new Response(null, { status: 403 });
        await this.fixtureState.storage.put(
          `synthetic-${kind}-signed-in`,
          true,
        );
        await this.alarm();
        content = "<p>Signed in. Return to GradeViewer.</p>";
      }
      return new Response(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>GradeViewer preview sign-in</title><main><h1>GradeViewer preview sign-in</h1>' +
          content +
          "</main></html>",
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    }
    if (
      ["/api/fixture/campus", "/api/fixture/carmen"].includes(
        new URL(request.url).pathname,
      ) &&
      request.method === "POST"
    ) {
      const value = await request.json();
      await this.fixtureState.storage.put(
        new URL(request.url).pathname.endsWith("carmen")
          ? "synthetic-carmen"
          : "synthetic-campus",
        value,
      );
      if (value && typeof value === "object" && "signedIn" in value) {
        await this.fixtureState.storage.put(
          new URL(request.url).pathname.endsWith("carmen")
            ? "synthetic-carmen-signed-in"
            : "synthetic-campus-signed-in",
          value.signedIn,
        );
        // Drive the same alarm path deterministically after the synthetic
        // human sign-in, rather than waiting for its wall-clock wakeup.
        if (value.signedIn === true) await this.alarm();
      }
      return Response.json({ ok: true });
    }

    if (
      new URL(request.url).pathname === "/api/fixture/delay" &&
      request.method === "POST"
    ) {
      const { ms } = (await request.json()) as { ms: number };
      await this.fixtureState.storage.put(
        "synthetic-provider-delay",
        Math.max(0, Math.min(5000, ms || 0)),
      );
      return Response.json({ ok: true });
    }
    if (
      new URL(request.url).pathname === "/api/fixture/failure" &&
      request.method === "POST"
    ) {
      const { enabled } = (await request.json()) as { enabled: boolean };
      await this.fixtureState.storage.put(
        "synthetic-provider-failure",
        enabled === true,
      );
      return Response.json({ ok: true });
    }
    return super.fetch(request);
  }
  protected upstream = async (request: Request): Promise<Response> => {
    if (new URL(request.url).hostname === "osu.instructure.com") {
      if (
        !request.headers.get("User-Agent")?.startsWith("GradeViewer/") ||
        request.headers.get("X-Requested-With") !== "XMLHttpRequest" ||
        request.headers.get("Referer") !== "https://osu.instructure.com/" ||
        request.headers.get("X-CSRF-Token") !== "synthetic/csrf+token="
      )
        return Response.json({ status: "unauthorized" }, { status: 403 });
      const config = await this.fixtureState.storage.get<{
        failure?: boolean;
        malformed?: boolean;
        empty?: boolean;
      }>("synthetic-carmen");
      if (config?.failure) return Response.json({}, { status: 401 });
      const path = new URL(request.url).pathname,
        details = canvasDetails();
      if (path.endsWith("/profile")) return Response.json({ id: 77 });
      if (path === "/api/v1/courses")
        return Response.json(
          config?.malformed ? {} : config?.empty ? [] : canvasCourses,
        );
      if (path.endsWith("/assignment_groups"))
        return Response.json(details["101:groups"]);
      if (path.endsWith("/enrollments"))
        return Response.json(details["101:enrollments"]);
      return Response.json({}, { status: 404 });
    }
    if (new URL(request.url).hostname === "fixture.infinitecampus.org") {
      const config = await this.fixtureState.storage.get<{
        failure?: boolean;
        malformed?: boolean;
        courseDelayMs?: number;
      }>("synthetic-campus");
      if (config?.failure) return Response.json({}, { status: 401 });
      const path = new URL(request.url).pathname;
      if (path.endsWith("/roster"))
        return Response.json({ personID: "synthetic-campus-student" });
      if (path.endsWith("/grades")) {
        if (config?.courseDelayMs)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(config.courseDelayMs!, 2000)),
          );
        return Response.json(campusBackfillFixture(Date.now()).summary);
      }
      if (path.endsWith("/detail/100"))
        return Response.json(
          config?.malformed ? [] : campusBackfillFixture(Date.now()).detail,
        );
      return Response.json({}, { status: 404 });
    }

    if (new URL(request.url).pathname.endsWith("/users/me")) {
      await this.waitForGate("provider");
      const delay = await this.fixtureState.storage.get<number>(
        "synthetic-provider-delay",
      );
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }
    if (await this.fixtureState.storage.get("synthetic-provider-failure"))
      return Response.json({}, { status: 502 });
    const auth = request.headers.get("Authorization") ?? "",
      key = decodeURIComponent(
        auth.match(/oauth_consumer_key="([^"]+)"/)?.[1] ?? "",
      ),
      u = new URL(request.url);
    if (!key.startsWith("fixture")) return Response.json({}, { status: 401 });
    if (u.pathname.endsWith("/users/me"))
      return Response.json({
        uid: key === "fixture-other" ? "sample-other" : SYNTHETIC_ACCOUNT,
      });
    if (u.pathname.endsWith("/sections") && u.pathname.includes("/users/"))
      return Response.json({
        section:
          key === "fixture-empty"
            ? []
            : Array.from(
                { length: key === "fixture-blank" ? 7 : 5 },
                (_, i) => ({
                  id: String((key === "fixture-aliases" ? 1000 : 100) + i),
                }),
              ),
      });
    if (u.pathname.endsWith("/grades")) {
      const sections = Array.from(
        { length: 5 },
        (_, i) =>
          syntheticPayload(String(100 + i), Date.parse("2026-10-16T12:00:00Z"))
            .grades.section as unknown[],
      )
        .flat()
        .map((value) => {
          const row = value as {
            section_id: string;
            final_grade: {
              period_id: string;
              grade: number | null;
              is_override?: boolean;
            }[];
          };
          // The unweighted section has assignment scores but no numeric Q2 total.
          if (row.section_id === "102") {
            row.final_grade.find((grade) => grade.period_id === "p2")!.grade =
              null;
            row.final_grade.find(
              (grade) => grade.period_id === "p3",
            )!.is_override = true;
          }
          return row;
        })
        .filter(
          (r) =>
            !u.searchParams.has("section_id") ||
            String((r as Record<string, unknown>).section_id) ===
              String(
                Number(u.searchParams.get("section_id")) -
                  (key === "fixture-aliases" ? 900 : 0),
              ),
        );
      return Response.json({
        section:
          key === "fixture-malformed" ? [{ section_id: "100" }] : sections,
      });
    }
    const section = u.pathname.split("/")[3],
      p = syntheticPayload(
        key === "fixture-aliases" ? String(Number(section) - 900) : section,
        Date.parse("2026-10-16T12:00:00Z"),
      );
    if (key === "fixture-aliases") p.section.id = section;
    if (key === "fixture-blank" && ["105", "106"].includes(section)) {
      p.section.course_title =
        section === "105" ? "Ungraded synthetic class" : "New synthetic class";
      p.items = [];
      p.categories = [];
      if (section === "106") p.periods = [];
    }
    if (p.section.course_title === "Computer Science A") {
      p.section.options = { weighted_grading_categories: 0 };
      for (const category of p.categories) {
        category.weight = 0;
        delete category.calculation_type;
      }
    }
    if (u.pathname === `/v1/sections/${section}`)
      return Response.json(p.section);
    const name = u.pathname.split("/").at(-1);
    const payloads: Record<string, unknown> = {
      grade_items: { assignment: p.items },
      grading_categories: { grading_category: p.categories },
      grading_periods: { grading_period: p.periods },
      grading_scales: { grading_scale: [] },
      assignments: { assignment: [] },
      "0": { "folder-item": [] },
    };
    return payloads[name!]
      ? Response.json(payloads[name!])
      : Response.json({}, { status: 403 });
  };
}
export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/fixture/release" && request.method === "POST") {
      releaseFixture = await request.json();
      return Response.json({ ok: true });
    }
    if (path === "/api/releases/latest")
      return Response.json(releaseFixture, {
        status: releaseFixture.failure ? 503 : 200,
        headers: { "Cache-Control": "no-store" },
      });
    return worker.fetch(request, env);
  },
};
