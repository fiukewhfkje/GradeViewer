import { campusURL, campusLogin, campusHome } from "./campus-url";
export { campusURL } from "./campus-url";
import { Cookie, CookieJar } from "tough-cookie";
import { seal, unseal, hash, random, type Envelope } from "./crypto";
import { ApiError, type Fetcher } from "./provider";
import { campusChoices, campusStudent, parseCampus } from "../src/core/campus";
import {
  browserQuotaRetryAfter,
  portalBrowser,
  type BrowserState,
  type PortalBinding,
} from "./portal-browser";

export interface PortalConnection {
  portal: string;
  account?: string;
  state?: BrowserState;
  jar?: ReturnType<CookieJar["serializeSync"]>;
  selected: string[];
  entry?: string;
  needsReconnect?: boolean;
  cooldown?: number;
  lastVerified?: number;
  profileAccount?: string;
  completed?: { attempt: string; firstConnection: boolean };
  pending?: {
    id: string;
    attempt?: string;
    expires: number;
    started: number;
    error?: string;
  };
}
interface PortalStore {
  connection?: PortalConnection;
  browserDay?: string;
  browserMs: number;
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
  ) {}
  protected async browser(saved?: BrowserState, id?: string) {
    if (!this.binding) throw new ApiError(503, "browserUnavailable");
    return portalBrowser(
      this.binding,
      saved,
      id,
      (entry) => {
        void this.storage.put("portal-campus-entry", entry).catch(() => {});
      },
      (portal, sessionID) => {
        if (!id)
          void this.storage
            .put("portal-campus-discovered", { portal, sessionID })
            .catch(() => {});
      },
    );
  }
  private async load(): Promise<PortalStore> {
    const encrypted = await this.storage.get<Envelope>("portal-campus");
    if (!encrypted) return { browserMs: 0 };
    try {
      return await unseal<PortalStore>(encrypted, this.password);
    } catch {
      throw new ApiError(409, "portalPasswordChanged");
    }
  }
  private async save(s: PortalStore) {
    await this.storage.put("portal-campus", await seal(s, this.password));
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
    if (s.browserDay === new Date(p.started).toISOString().slice(0, 10))
      s.browserMs = Math.max(
        0,
        s.browserMs -
          240_000 +
          Math.min(240_000, Math.max(0, Date.now() - p.started)),
      );
    await this.storage.delete("portal-campus-discovered");
    delete s.connection!.pending;
  }
  async expire() {
    const s = await this.load();
    const c = s.connection,
      p = c?.pending;
    if (!p) return;
    if (
      p.expires <= Date.now() ||
      (c.completed?.attempt === p.attempt && p.attempt)
    ) {
      await this.close(s);
      await this.save(s);
      return;
    }
    if (p.attempt && !p.error) {
      // The temporary browser is monitored only during an explicit sign-in.
      // Keep the expiration alarm even if a check is interrupted.
      await this.storage.setAlarm(p.expires);
      try {
        const result = await this.handle("finish", {}, true);
        if ("state" in result && result.state === "waiting")
          await this.storage.setAlarm(Math.min(p.expires, Date.now() + 4000));
      } catch (error) {
        const current = await this.load();
        const pending = current.connection?.pending;
        if (pending && pending.attempt === p.attempt) {
          pending.error =
            error instanceof ApiError
              ? error.code
              : "portalBrowserCaptureFailed";
          await this.save(current);
        }
      }
    }
  }
  private async read(
    c: PortalConnection,
    path: string,
    jar: CookieJar,
  ): Promise<unknown> {
    const portal = campusURL(c.portal),
      u = new URL("/campus/" + path, portal);
    if (
      !/^resources\/portal\/(?:roster|grades(?:\/detail\/[\w-]{1,100})?)$/.test(
        path,
      )
    )
      throw new ApiError(400, "invalidRequest");
    let r: Response;
    try {
      // Invoke a supplied global fetch without binding it to this service.
      const upstream = this.upstream;
      r = await upstream(
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
        target.origin !== u.origin ||
        !/\/campus\/(portal|SSO|verify)/.test(target.pathname)
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
      if (r.status === 404 && path === "resources/portal/roster")
        throw new ApiError(502, "campusIdentityUnsupported");
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
      if (size > 2_000_000) {
        await reader.cancel();
        throw new ApiError(502, "portalTooLarge");
      }
      text += decoder.decode(value, { stream: true });
    }
    try {
      return JSON.parse(text + decoder.decode());
    } catch {
      throw new ApiError(502, "malformedCampus");
    }
  }
  private async verify(c: PortalConnection, jar: CookieJar) {
    const roster = await this.read(c, "resources/portal/roster", jar);
    const account = (
      await hash(campusURL(c.portal).origin + "\0" + campusStudent(roster))
    ).replace(/[^a-zA-Z0-9]/g, "");
    if (c.account && c.account !== account)
      throw new ApiError(409, "portalAccountChanged");
    return account;
  }
  private async fetch(c: PortalConnection) {
    if (!c.jar) throw new ApiError(401, "portalSignInRequired");
    const jar = CookieJar.deserializeSync(c.jar);
    try {
      // A profile-bound jar was created only after verifying the Student Profile
      // and a successful grades read. It cannot be replaced by an HTTP refresh.
      const account =
          c.profileAccount && c.account ? c.account : await this.verify(c, jar),
        summary = await this.read(c, "resources/portal/grades", jar);
      const choices = campusChoices(summary),
        details: Record<string, unknown> = {};
      // Keep request and memory amplification bounded. Discovery does not request assignment details.
      return { account, summary, choices, details, jar };
    } finally {
      c.jar = jar.serializeSync();
    }
  }
  async handle(
    action: string,
    b: Record<string, unknown> = {},
    automatic = false,
  ) {
    let s: PortalStore;
    try {
      s = await this.load();
    } catch (error) {
      if (action !== "disconnect") throw error;
      await this.storage.delete("portal-campus");
      return { ok: true };
    }
    let c = s.connection;
    if (action === "progress") {
      if (c?.completed && c.completed.attempt === b.attempt && !c.pending)
        return {
          state: "connected",
          firstConnection: c.completed.firstConnection,
          selected: c.selected,
        };
      const p = c?.pending;
      if (!p?.attempt || p.attempt !== b.attempt || p.expires <= Date.now())
        throw new ApiError(409, "portalSignInExpired");
      if (p.error) {
        if (b.retry !== true) throw new ApiError(502, p.error);
        delete p.error;
        await this.save(s);
        await this.storage.setAlarm(Date.now());
      }
      return { state: "waiting" };
    }
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (s.browserDay !== today) {
        s.browserDay = today;
        s.browserMs = 0;
      }
      if (c?.pending && c.pending.expires < Date.now()) await this.close(s);
      if (action === "status") return this.status();
      if (action === "disconnect") {
        await this.close(s);
        s = { browserMs: s.browserMs, browserDay: s.browserDay };
        return { ok: true };
      }
      if (action === "cancel") {
        if (b.attempt !== undefined && c?.pending?.attempt !== b.attempt)
          return { ok: true };
        await this.close(s);
        return { ok: true };
      }
      if (action === "start") {
        const requested = b.portal ?? c?.portal;
        const portal =
          requested && requested !== campusLogin
            ? campusURL(requested).href
            : campusLogin;
        if (c?.account && c.portal !== portal)
          throw new ApiError(409, "portalDisconnectFirst");
        if (c?.pending) await this.close(s);
        if (s.browserMs + 240_000 > 540_000)
          throw new ApiError(
            429,
            "portalBrowserBudget",
            browserQuotaRetryAfter(),
          );
        c ??= { portal, selected: [] };
        if (!c.account) c.portal = portal;
        s.connection = c;
        const began = Date.now();
        s.browserMs += 240_000;
        await this.save(s);
        let browser;
        try {
          browser = await this.browser(c.state);
        } catch (error) {
          s.browserMs -= 240_000;
          throw error;
        }
        c.pending = {
          id: browser.id,
          attempt: random(),
          started: began,
          expires: began + 240_000,
        };
        await this.save(s);
        await this.storage.setAlarm(c.pending.expires);
        await this.storage.delete("portal-campus-entry");
        try {
          const destination = c.account && c.entry ? c.entry : portal;
          const [, url] = await Promise.all([
            browser.navigate(destination, "commit"),
            browser.live(),
          ]);
          await this.storage.setAlarm(
            Math.min(c.pending.expires, Date.now() + 1000),
          );
          return {
            url,
            expires: c.pending.expires,
            attempt: c.pending.attempt,
          };
        } catch {
          await this.close(s);
          throw new ApiError(502, "browserUnavailable");
        }
      }
      if (!c) throw new ApiError(409, "portalConnectRequired");
      if (action === "finish") {
        const p = c.pending;
        if (!p) {
          if (c.completed)
            return {
              state: "connected",
              firstConnection: c.completed.firstConnection,
              selected: c.selected,
            };
          throw new ApiError(409, "portalSignInExpired");
        }
        let home: string | undefined;
        if (automatic && this.binding) {
          try {
            const targets = await this.binding.devtools.listTargets(p.id);
            home = [...targets]
              .reverse()
              .filter((t) => t.type === "page")
              .map((t) => campusHome(t.url))
              .find(Boolean);
          } catch {
            throw new ApiError(502, "portalBrowserCaptureFailed");
          }
          if (!home) return { state: "waiting" };
        }
        let browser;
        try {
          browser = await this.browser(undefined, p.id);
        } catch {
          throw new ApiError(502, "portalBrowserCaptureFailed");
        }
        let studentNumber: string | undefined;
        try {
          const discovered = await this.storage.get<{
            portal: string;
            sessionID: string;
          }>("portal-campus-discovered");
          const found =
            home ??
            (await browser.studentPortal?.()) ??
            (discovered?.sessionID === p.id ? discovered.portal : undefined) ??
            (c.portal !== campusLogin ? c.portal : undefined);
          if (!found || (automatic && !campusHome(found))) {
            if (automatic) return { state: "waiting" };
            throw new ApiError(409, "portalChooseStudent");
          }
          const portal = campusURL(found).href;
          const origin = campusURL(portal).origin;
          if (c.account && campusURL(c.portal).origin !== origin)
            throw new ApiError(409, "portalDisconnectFirst");
          let state: BrowserState;
          try {
            state = await browser.state();
          } catch {
            throw new ApiError(502, "portalBrowserCaptureFailed");
          }
          const jar = browserJar(state, origin);
          const candidate = { ...c, portal };
          let account: string, profileAccount: string | undefined;
          studentNumber = await browser.studentNumber?.(origin);
          if (studentNumber)
            profileAccount = (
              await hash(origin + "\0profile\0" + studentNumber)
            ).replace(/[^a-zA-Z0-9]/g, "");
          if (c.profileAccount) {
            if (!profileAccount) {
              if (automatic) return { state: "waiting" };
              throw new ApiError(502, "campusIdentityUnsupported");
            }
            if (profileAccount !== c.profileAccount)
              throw new ApiError(409, "portalAccountChanged");
            account = c.account!;
          } else {
            try {
              account = await this.verify(candidate, jar);
            } catch (error) {
              // The schedule can omit a student ID. Only a new connection may
              // fall back to the identity on the authenticated Student Profile.
              const noRosterIdentity =
                error instanceof Error &&
                error.message === "campusIdentityUnsupported";
              if (
                automatic &&
                !c.account &&
                noRosterIdentity &&
                !profileAccount
              )
                return { state: "waiting" };
              if (c.account || !profileAccount || !noRosterIdentity)
                throw error;
              account = profileAccount;
            }
          }
          const courses = campusChoices(
            await this.read(candidate, "resources/portal/grades", jar),
          );
          const permitted = (host: string) =>
            host === campusURL(portal).hostname ||
            /(^|\.)(google\.com|microsoftonline\.com|live\.com|duosecurity\.com)$/.test(
              host,
            );
          const retained = {
            cookies: state.cookies.filter((x) =>
              permitted(x.domain.replace(/^\./, "")),
            ),
            origins: [],
          };
          if (JSON.stringify(retained).length > 1_000_000)
            throw new ApiError(502, "portalTooLarge");
          const entry = await this.storage.get<string>("portal-campus-entry");
          if (entry && new URL(entry).origin === origin) c.entry = entry;
          const firstConnection = !c.account;
          c.portal = portal;
          c.state = retained;
          c.account = account;
          if (account === profileAccount) c.profileAccount = profileAccount;
          c.jar = jar.serializeSync();
          c.needsReconnect = false;
          c.lastVerified = Date.now();
          if (p.attempt) c.completed = { attempt: p.attempt, firstConnection };
          // Persist the verified cookies before stopping the remote Chrome session.
          await this.save(s);
          await this.close(s);
          return {
            state: "connected",
            firstConnection,
            courses,
            selected: c.selected,
          };
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.code === "portalSignInRequired"
          ) {
            if (automatic && !studentNumber) return { state: "waiting" };
            throw new ApiError(401, "portalSessionUnverified");
          }
          if (error instanceof ApiError && error.code === "portalUnavailable")
            throw new ApiError(502, "portalVerificationUnavailable");
          throw error;
        } finally {
          if (c.pending) await browser.detach?.().catch(() => {});
        }
      }
      if (c.cooldown && c.cooldown > Date.now())
        throw new ApiError(
          429,
          "portalRateLimited",
          Math.ceil((c.cooldown - Date.now()) / 1000),
        );
      const fresh = await this.fetch(c);
      c.needsReconnect = false;
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
        const live = fresh.choices.filter((x) => c!.selected.includes(x.id));
        if (live.length > 20) throw new ApiError(400, "portalTooManyCourses");
        // At most 20 detail reads plus identity/discovery, below a Worker subrequest budget.
        try {
          let aggregate = JSON.stringify(fresh.summary).length;
          for (let offset = 0; offset < live.length; offset += 3)
            await Promise.all(
              live.slice(offset, offset + 3).map(async (x) => {
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
        } finally {
          c.jar = fresh.jar.serializeSync();
        }
        const fetched = Date.now();
        const courses = parseCampus(
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
      if (
        error instanceof ApiError &&
        error.code === "portalSignInRequired" &&
        c?.account
      )
        c.needsReconnect = true;
      if (error instanceof ApiError) throw error;
      if (
        error instanceof Error &&
        ["campusIdentityUnsupported", "malformedCampus", "malformed"].includes(
          error.message,
        )
      )
        throw new ApiError(502, error.message);
      throw new ApiError(502, "portalUnavailable");
    } finally {
      await this.save(s);
    }
  }
}
