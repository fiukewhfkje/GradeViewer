import { canvasChoices, canvasStudent, parseCanvas } from "../src/core/canvas";
import {
  canvasURL,
  canvasAllowed,
  canvasNext,
  canvasCoursesPath,
} from "./canvas";
import { Cookie, CookieJar } from "tough-cookie";
import { seal, unseal, hash, type Envelope } from "./crypto";
import { ApiError, type Fetcher } from "./provider";
import { campusChoices, campusStudent, parseCampus } from "../src/core/campus";
import {
  portalBrowser,
  type PortalBrowser,
  type BrowserState,
  type PortalBinding,
} from "./portal-browser";

export interface PortalConnection {
  portal: string;
  account?: string;
  subject?: string;
  maintenance?: boolean;
  nextMaintenance?: number;
  maintenanceFailures?: number;
  lastIdentityVerified?: number;
  lastKeepalive?: number;
  state?: BrowserState;
  jar?: ReturnType<CookieJar["serializeSync"]>;
  selected: string[];
  entry?: string;
  needsReconnect?: boolean;
  cooldown?: number;
  lastVerified?: number;
  renewalAfter?: number;
  pending?: { id: string; expires: number; started: number };
}
interface PortalStore {
  connection?: PortalConnection;
  browserDay?: string;
  browserMs: number;
  renewalMs?: number;
}
export function campusURL(input: unknown) {
  if (typeof input !== "string" || input.length > 1000)
    throw new ApiError(400, "invalidCampusURL");
  const u = new URL(input);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    !/^([a-z0-9-]+\.)+infinitecampus\.(org|com)$/.test(u.hostname) ||
    !/^\/campus\/portal\/students\/[a-zA-Z0-9_-]+\.jsp$/.test(u.pathname) ||
    u.search
  )
    throw new ApiError(400, "invalidCampusURL");
  return u;
}
export function browserJar(state: BrowserState, origin: string) {
  if (state.cookies.length > 400) throw new ApiError(502, "malformedCampus");
  const jar = new CookieJar();
  for (const c of state.cookies) {
    if (c.expires >= 0 && c.expires <= Date.now() / 1000) continue;
    if (c.name.length + c.value.length > 10000)
      throw new ApiError(502, "malformedCampus");
    const domain = c.domain.replace(/^\./, "");
    // Only Campus cookies enter Campus HTTP requests. IdP cookies stay in encrypted browser state.
    if (
      new URL(origin).hostname !== domain &&
      !new URL(origin).hostname.endsWith("." + domain)
    )
      continue;
    jar.setCookieSync(
      new Cookie({
        key: c.name,
        value: c.value,
        domain,
        hostOnly: !c.domain.startsWith("."),
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite.toLowerCase(),
        ...(c.expires > 0 ? { expires: new Date(c.expires * 1000) } : {}),
      }),
      origin + c.path,
    );
  }
  return jar;
}
export class PortalService {
  constructor(
    protected storage: DurableObjectStorage,
    protected password: string,
    protected binding?: PortalBinding,
    protected upstream: Fetcher = fetch,
    protected kind: "campus" | "carmen" = "campus",
  ) {}
  private requests = 0;
  private bytes = 0;
  private portalURL(input: unknown) {
    return this.kind === "carmen" ? canvasURL(input) : campusURL(input);
  }
  private get summaryPath() {
    return this.kind === "carmen"
      ? canvasCoursesPath
      : "resources/portal/grades";
  }
  private choices(summary: unknown) {
    return this.kind === "carmen"
      ? canvasChoices(summary)
      : campusChoices(summary);
  }
  private retainState(state: BrowserState, portal: string): BrowserState {
    const permitted = (host: string) =>
      host === this.portalURL(portal).hostname ||
      /(^|\.)(google\.com|microsoftonline\.com|live\.com|duosecurity\.com|ohio-state\.edu|osu\.edu|instructure\.com)$/.test(
        host,
      );
    const filtered = {
      cookies: state.cookies.filter((x) =>
        permitted(x.domain.replace(/^\./, "")),
      ),
      origins: state.origins.filter((x) => {
        try {
          return permitted(new URL(x.origin).hostname);
        } catch {
          return false;
        }
      }),
    };
    if (JSON.stringify(filtered).length > 1_000_000)
      throw new ApiError(502, "portalTooLarge");
    return filtered;
  }
  private retainJar(c: PortalConnection, jar: CookieJar) {
    c.jar = jar.serializeSync();
    if (!c.state) return;
    const host = this.portalURL(c.portal).hostname;
    const matches = (domain: string) =>
      host === domain.replace(/^\./, "") ||
      host.endsWith("." + domain.replace(/^\./, ""));
    c.state.cookies = [
      ...c.state.cookies.filter((x) => !matches(x.domain)),
      ...(jar.serializeSync()?.cookies ?? [])
        .map((x) => Cookie.fromJSON(x))
        .filter((x): x is Cookie => !!x && !!x.domain && matches(x.domain))
        .map((x) => ({
          name: x.key,
          value: x.value,
          domain: x.hostOnly ? x.domain! : "." + x.domain!,
          path: x.path ?? "/",
          expires: Number.isFinite(x.expiryTime())
            ? x.expiryTime()! / 1000
            : -1,
          httpOnly: x.httpOnly,
          secure: x.secure,
          sameSite: (x.sameSite === "strict"
            ? "Strict"
            : x.sameSite === "none"
              ? "None"
              : "Lax") as "Strict" | "None" | "Lax",
        })),
    ];
  }
  protected async browser(saved?: BrowserState, id?: string) {
    if (!this.binding) throw new ApiError(503, "browserUnavailable");
    return portalBrowser(this.binding, saved, id, (entry) => {
      void this.storage.put(`portal-${this.kind}-entry`, entry);
    });
  }
  private async load(): Promise<PortalStore> {
    const encrypted = await this.storage.get<Envelope>(`portal-${this.kind}`);
    let local: PortalStore = { browserMs: 0 };
    if (encrypted) {
      try {
        local = await unseal<PortalStore>(encrypted, this.password);
      } catch {
        throw new ApiError(409, "portalPasswordChanged");
      }
    }
    let budget = await this.storage.get<
      Pick<PortalStore, "browserDay" | "browserMs" | "renewalMs">
    >("portal-browser-budget");
    if (!budget) {
      // Migrate the existing IC allowance even when Carmen is the first route used after an upgrade.
      const legacy =
        this.kind === "carmen"
          ? await this.storage.get<Envelope>("portal-campus")
          : undefined;
      let used = local;
      if (legacy) {
        try {
          used = await unseal<PortalStore>(legacy, this.password);
        } catch {
          used = {
            browserMs: 540_000,
            browserDay: new Date().toISOString().slice(0, 10),
            renewalMs: 120_000,
          };
        }
      }
      budget = {
        browserMs: used.browserMs,
        browserDay: used.browserDay,
        renewalMs: used.renewalMs,
      };
    }
    return { ...local, ...budget };
  }
  private async save(s: PortalStore) {
    await this.storage.put(`portal-${this.kind}`, await seal(s, this.password));
    await this.storage.put("portal-browser-budget", {
      browserDay: s.browserDay,
      browserMs: s.browserMs,
      renewalMs: s.renewalMs,
    });
    const deadlines = [
      s.connection?.pending?.expires,
      s.connection?.pending ? undefined : s.connection?.nextMaintenance,
    ].filter((x): x is number => typeof x === "number");
    if (deadlines.length) {
      const next = Math.min(...deadlines),
        current = await this.storage.getAlarm?.();
      if (!current || next < current) await this.storage.setAlarm(next);
    }
  }
  async status() {
    try {
      const s = await this.load(),
        c = s.connection;
      return {
        connected: !!c?.account,
        needsReconnect: !!c?.needsReconnect,
        selected: c?.selected ?? [],
        portal: c?.portal,
        lastVerified: c?.lastVerified,
        cooldown: c?.cooldown,
        maintenance: !!c?.maintenance,
        nextMaintenance: c?.nextMaintenance,
        lastKeepalive: c?.lastKeepalive,
      };
    } catch (error) {
      if (error instanceof ApiError && error.code === "portalPasswordChanged")
        return { connected: true, needsReconnect: true, selected: [] };
      throw error;
    }
  }
  private async close(s: PortalStore) {
    const p = s.connection?.pending;
    if (!p) return;
    try {
      if (this.binding) await this.binding.closeSession(p.id);
      else {
        const browser = await this.browser(undefined, p.id);
        await browser.close();
      }
    } catch {
      /* Browser may already have expired. */
    }
    if (new Date(p.started).toISOString().slice(0, 10) === s.browserDay)
      s.browserMs = Math.max(
        0,
        s.browserMs +
          Math.min(240_000, Math.max(0, Date.now() - p.started)) -
          240_000,
      );
    delete s.connection!.pending;
  }
  async expire() {
    this.requests = 0;
    this.bytes = 0;
    const s = await this.load(),
      c = s.connection;
    try {
      if (c?.pending && c.pending.expires <= Date.now()) await this.close(s);
      if (
        this.kind !== "carmen" ||
        !c?.maintenance ||
        !c.nextMaintenance ||
        c.nextMaintenance > Date.now() ||
        c.pending
      )
        return;
      if (c.cooldown && c.cooldown > Date.now()) {
        c.nextMaintenance = c.cooldown;
        return;
      }
      if (!c.jar) {
        delete c.nextMaintenance;
        return;
      }
      const jar = CookieJar.deserializeSync(c.jar);
      try {
        await this.verify(c, jar);
        c.lastKeepalive = Date.now();
        c.maintenanceFailures = 0;
        c.needsReconnect = false;
        c.nextMaintenance = Date.now() + 90 * 60_000;
      } catch (error) {
        c.maintenanceFailures = (c.maintenanceFailures ?? 0) + 1;
        if (
          error instanceof ApiError &&
          [401, 403, 409].includes(error.status)
        ) {
          c.needsReconnect = true;
          delete c.nextMaintenance;
        } else if (c.maintenanceFailures >= 3) delete c.nextMaintenance;
        else {
          const delay =
            error instanceof ApiError && error.retryAfter
              ? error.retryAfter * 1000
              : c.maintenanceFailures * 5 * 60_000;
          c.nextMaintenance = Date.now() + Math.max(60_000, delay);
        }
      } finally {
        this.retainJar(c, jar);
      }
    } finally {
      await this.save(s);
    }
  }
  private async read(
    c: PortalConnection,
    path: string,
    jar: CookieJar,
  ): Promise<unknown> {
    const first = new URL(
      this.kind === "carmen" ? path : "/campus/" + path,
      this.portalURL(c.portal),
    );
    let u: URL | undefined = first,
      output: unknown[] | undefined;
    const seen = new Set<string>();
    while (u) {
      if (seen.has(u.href) || seen.size >= 20)
        throw new ApiError(502, "malformedCanvas");
      seen.add(u.href);
      const { data, link } = await this.readPage(c, u, jar);
      if (this.kind !== "carmen" || !Array.isArray(data)) {
        if (output) throw new ApiError(502, "malformedCanvas");
        return data;
      }
      output ??= [];
      output.push(...data);
      u = canvasNext(link, u, first);
    }
    return output;
  }
  private async readPage(
    c: PortalConnection,
    u: URL,
    jar: CookieJar,
  ): Promise<{ data: unknown; link: string | null }> {
    if (++this.requests > 45) throw new ApiError(502, "portalTooLarge");
    const path = u.pathname.replace(/^\/campus\//, "");
    if (
      this.kind === "carmen"
        ? !canvasAllowed(u)
        : !/^resources\/portal\/(?:roster|grades(?:\/detail\/[\w-]{1,100})?)$/.test(
            path,
          )
    )
      throw new ApiError(400, "invalidRequest");
    let r: Response;
    try {
      r = await this.upstream(
        new Request(u, {
          headers: {
            Accept: "application/json",
            Cookie: jar.getCookieStringSync(u.href),
          },
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        }),
      );
    } catch {
      throw new ApiError(502, "portalUnavailable");
    }
    for (const cookie of r.headers.getSetCookie()) {
      try {
        jar.setCookieSync(cookie, u.href);
      } catch {
        throw new ApiError(502, "malformedCampus");
      }
    }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const location = r.headers.get("Location");
      await r.body?.cancel();
      const target = location ? new URL(location, u) : undefined;
      if (
        !target ||
        !(this.kind === "carmen"
          ? (target.origin === u.origin &&
              /^\/(login|saml2|SAML2)(?:\/|$)/i.test(target.pathname)) ||
            target.origin === "https://webauth.service.ohio-state.edu"
          : target.origin === u.origin &&
            /\/campus\/(portal|SSO|verify)/.test(target.pathname))
      )
        throw new ApiError(502, "invalidPortalRedirect");
      throw new ApiError(401, "portalSignInRequired");
    }
    if (r.status === 401) {
      await r.body?.cancel();
      throw new ApiError(401, "portalSignInRequired");
    }
    if (r.status === 429) {
      await r.body?.cancel();
      throw new ApiError(
        429,
        "portalRateLimited",
        Math.min(3600, Math.max(1, Number(r.headers.get("Retry-After")) || 60)),
      );
    }
    if (!r.ok) {
      await r.body?.cancel();
      throw new ApiError(
        r.status === 403 ? 403 : 502,
        r.status === 403 ? "portalAccessDenied" : "portalUnavailable",
      );
    }
    if (!r.headers.get("Content-Type")?.includes("application/json")) {
      await r.body?.cancel();
      throw new ApiError(502, "malformedCampus");
    }
    const reader = r.body?.getReader();
    if (!reader) throw new ApiError(502, "malformedCampus");
    let text = "",
      size = 0;
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      this.bytes += value.length;
      if (size > 2_000_000 || this.bytes > 4_000_000) {
        await reader.cancel();
        throw new ApiError(502, "portalTooLarge");
      }
      text += decoder.decode(value, { stream: true });
    }
    try {
      return {
        data: JSON.parse(text + decoder.decode()),
        link: r.headers.get("Link"),
      };
    } catch {
      throw new ApiError(502, "malformedCampus");
    }
  }
  private async verify(c: PortalConnection, jar: CookieJar) {
    const roster = await this.read(
      c,
      this.kind === "carmen"
        ? "/api/v1/users/self/profile"
        : "resources/portal/roster",
      jar,
    );
    const subject =
      this.kind === "carmen" ? canvasStudent(roster) : campusStudent(roster);
    const account = (
      await hash(this.portalURL(c.portal).origin + "\0" + subject)
    ).replace(/[^a-zA-Z0-9]/g, "");
    if (c.account && c.account !== account)
      throw new ApiError(409, "portalAccountChanged");
    c.subject = subject;
    c.lastIdentityVerified = Date.now();
    if (c.maintenance) c.nextMaintenance = Date.now() + 90 * 60_000;
    return account;
  }
  private async fetch(c: PortalConnection) {
    if (!c.jar) throw new ApiError(401, "portalSignInRequired");
    const jar = CookieJar.deserializeSync(c.jar);
    try {
      const account = await this.verify(c, jar),
        summary = await this.read(c, this.summaryPath, jar);
      const choices = this.choices(summary),
        details: Record<string, unknown> = {};
      // Keep request and memory amplification bounded. Discovery does not request assignment details.
      return { account, summary, choices, details, jar };
    } finally {
      this.retainJar(c, jar);
    }
  }
  async handle(action: string, b: Record<string, unknown> = {}) {
    this.requests = 0;
    this.bytes = 0;
    let s: PortalStore;
    try {
      s = await this.load();
    } catch (error) {
      if (action !== "disconnect") throw error;
      await this.storage.delete(`portal-${this.kind}`);
      return { ok: true };
    }
    let c = s.connection;
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (s.browserDay !== today) {
        s.browserDay = today;
        s.browserMs = 0;
        s.renewalMs = 0;
      }
      if (c?.pending && c.pending.expires < Date.now()) await this.close(s);
      if (action === "status") return this.status();
      if (action === "disconnect") {
        await this.close(s);
        s = {
          browserMs: s.browserMs,
          browserDay: s.browserDay,
          renewalMs: s.renewalMs,
        };
        return { ok: true };
      }
      if (action === "cancel") {
        await this.close(s);
        return { ok: true };
      }
      if (action === "start") {
        const portal = this.portalURL(
          b.portal ??
            c?.portal ??
            (this.kind === "carmen"
              ? "https://osu.instructure.com"
              : undefined),
        ).href;
        if (c?.account && c.portal !== portal)
          throw new ApiError(409, "portalDisconnectFirst");
        if (c?.pending) await this.close(s);
        if (s.browserMs + 240_000 > 540_000)
          throw new ApiError(429, "portalBrowserBudget", 3600);
        c ??= { portal, selected: [] };
        s.connection = c;
        const began = Date.now();
        s.browserMs += 240_000;
        await this.save(s);
        const browser = await this.browser(c.state);
        c.pending = {
          id: browser.id,
          started: began,
          expires: began + 240_000,
        };
        await this.save(s);

        await this.storage.delete(`portal-${this.kind}-entry`);
        try {
          await browser.navigate(portal);
          return { url: await browser.live(), expires: c.pending.expires };
        } catch {
          await this.close(s);
          throw new ApiError(502, "browserUnavailable");
        }
      }
      if (!c) throw new ApiError(409, "portalConnectRequired");
      if (action === "finish") {
        if (!c.pending) throw new ApiError(409, "portalSignInExpired");
        const browser = await this.browser(undefined, c.pending.id),
          state = await browser.state();
        const jar = browserJar(state, this.portalURL(c.portal).origin),
          account = await this.verify(c, jar);
        this.choices(await this.read(c, this.summaryPath, jar));
        // Retain only actual sign-in origins; never passwords, form state or page content.
        c.state = this.retainState(state, c.portal);
        const entry = await this.storage.get<string>(
          `portal-${this.kind}-entry`,
        );
        if (entry && new URL(entry).origin === this.portalURL(c.portal).origin)
          c.entry = entry;
        c.account = account;
        this.retainJar(c, jar);
        c.needsReconnect = false;
        c.lastVerified = Date.now();
        if (this.kind === "carmen") {
          c.maintenance ??= true;
          c.maintenanceFailures = 0;
          c.nextMaintenance = c.maintenance
            ? Date.now() + 90 * 60_000
            : undefined;
          c.entry = c.portal;
        }
        await this.close(s);
        return { ok: true };
      }
      if (action === "maintenance" && this.kind === "carmen") {
        if (typeof b.enabled !== "boolean")
          throw new ApiError(400, "invalidRequest");
        c.maintenance = b.enabled;
        c.maintenanceFailures = 0;
        c.nextMaintenance = b.enabled ? Date.now() + 90 * 60_000 : undefined;
        return { ok: true };
      }
      if (c.cooldown && c.cooldown > Date.now())
        throw new ApiError(
          429,
          "portalRateLimited",
          Math.ceil((c.cooldown - Date.now()) / 1000),
        );
      let fresh;
      try {
        fresh = await this.fetch(c);
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.code !== "portalSignInRequired"
        )
          throw error;
        c.needsReconnect = true;
        // A rejected HTTP session may use the actual captured SSO entry once; network failures never launch a browser.
        if (
          !c.entry ||
          !c.state ||
          (c.renewalAfter ?? 0) > Date.now() ||
          (s.renewalMs ?? 0) + 25_000 > 120_000 ||
          s.browserMs + 25_000 > 540_000
        )
          throw error;
        c.renewalAfter = Date.now() + 5 * 60_000;
        let browser: PortalBrowser | undefined;
        const began = Date.now();
        try {
          browser = await this.browser(c.state);
          await browser.navigate(c.entry);
          await browser.ready(this.portalURL(c.portal).origin);
          const state = await browser.state(),
            jar = browserJar(state, this.portalURL(c.portal).origin);
          await this.verify(c, jar);
          this.retainJar(c, jar);
          c.state = this.retainState(state, c.portal);
          c.needsReconnect = false;
          fresh = await this.fetch(c);
        } catch {
          throw error;
        } finally {
          await browser?.close().catch(() => {});
          s.browserMs += Date.now() - began;
          s.renewalMs = (s.renewalMs ?? 0) + Date.now() - began;
        }
      }
      if (action === "courses")
        return { courses: fresh.choices, selected: c.selected };
      if (action === "select") {
        if (
          !Array.isArray(b.selected) ||
          b.selected.length > 20 ||
          b.selected.some(
            (x) =>
              typeof x !== "string" || !fresh.choices.some((y) => y.id === x),
          ) ||
          new Set(b.selected).size !== b.selected.length
        )
          throw new ApiError(400, "invalidRequest");
        c.selected = b.selected as string[];
        return { ok: true };
      }
      if (action === "snapshot") {
        if (this.kind === "carmen") c.selected = fresh.choices.map((x) => x.id);
        const live = fresh.choices.filter((x) => c!.selected.includes(x.id));
        if (live.length > 20) throw new ApiError(400, "portalTooManyCourses");
        // At most 20 detail reads plus identity/discovery, below a Worker subrequest budget.
        try {
          let aggregate = JSON.stringify(fresh.summary).length;
          for (let offset = 0; offset < live.length; offset += 3) {
            const results = await Promise.allSettled(
              live.slice(offset, offset + 3).map(async (x) => {
                if (this.kind === "carmen") {
                  fresh.details[x.id + ":groups"] = await this.read(
                    c!,
                    `/api/v1/courses/${x.id}/assignment_groups?include[]=assignments&include[]=submission&per_page=100`,
                    fresh.jar,
                  );
                  fresh.details[x.id + ":enrollments"] = await this.read(
                    c!,
                    `/api/v1/courses/${x.id}/enrollments?user_id=${c!.subject}&type[]=StudentEnrollment&per_page=100`,
                    fresh.jar,
                  );
                  return;
                }
                const detail = await this.read(
                  c!,
                  "resources/portal/grades/detail/" + x.section,
                  fresh.jar,
                );
                aggregate += JSON.stringify(detail).length;
                if (aggregate > 4_000_000)
                  throw new ApiError(502, "portalTooLarge");
                fresh.details[x.section] = detail;
              }),
            );
            const rejected = results.find(
              (x): x is PromiseRejectedResult => x.status === "rejected",
            );
            if (rejected) throw rejected.reason;
          }
        } finally {
          this.retainJar(c, fresh.jar);
        }
        const fetched = Date.now();
        const courses =
          this.kind === "carmen"
            ? parseCanvas(
                fresh.summary,
                fresh.details,
                fresh.account,
                c.subject!,
                fetched,
              )
            : parseCampus(
                fresh.summary,
                fresh.details,
                c.selected,
                fresh.account,
                fetched,
              );
        c.lastVerified = fetched;
        c.needsReconnect = false;
        return { account: fresh.account, courses };
      }
      throw new ApiError(404, "notFound");
    } catch (error) {
      if (error instanceof ApiError && error.code === "portalRateLimited" && c)
        c.cooldown = Date.now() + (error.retryAfter ?? 60) * 1000;
      if (error instanceof ApiError) {
        if (
          c &&
          ["portalSignInRequired", "portalAccountChanged"].includes(error.code)
        ) {
          c.needsReconnect = true;
          delete c.nextMaintenance;
        }
        if (this.kind === "carmen" && error.code === "malformedCampus")
          throw new ApiError(502, "malformedCanvas");
        throw error;
      }
      if (
        error instanceof Error &&
        [
          "campusIdentityUnsupported",
          "malformedCampus",
          "malformedCanvas",
          "malformed",
        ].includes(error.message)
      )
        throw new ApiError(502, error.message);
      throw new ApiError(502, "portalUnavailable");
    } finally {
      await this.save(s);
    }
  }
}
