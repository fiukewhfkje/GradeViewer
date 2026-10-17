// Separate test entry point. Production imports neither this file nor its fixture provider.
import worker, { CredentialVault, type Env } from "../worker/index";
import { syntheticPayload, SYNTHETIC_ACCOUNT } from "../src/core/demo";
export class FixtureVault extends CredentialVault {
  constructor(
    private fixtureState: DurableObjectState,
    env: Env,
  ) {
    super(fixtureState, env);
  }
  override async fetch(request: Request): Promise<Response> {
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
            : Array.from({ length: 5 }, (_, i) => ({
                id: String((key === "fixture-aliases" ? 1000 : 100) + i),
              })),
      });
    if (u.pathname.endsWith("/grades")) {
      const sections = Array.from(
        { length: 5 },
        (_, i) =>
          syntheticPayload(String(100 + i), Date.parse("2026-10-16T12:00:00Z"))
            .grades.section as unknown[],
      )
        .flat()
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
export default worker;
