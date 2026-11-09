import { canvasChoices, canvasStudent, parseCanvas } from "../src/core/canvas";
import {
  canvasURL,
  canvasAllowed,
  canvasNext,
  canvasCoursesPath,
  canvasSessionHeaders,
  canvasRejection,
} from "./canvas";

import { campusURL, campusLogin, campusHome } from "./campus-url";
export { campusURL } from "./campus-url";
import { Cookie, CookieJar } from "tough-cookie";
import { seal, unseal, hash, random, type Envelope } from "./crypto";
import { ApiError, type Fetcher } from "./provider";
import { campusChoices, campusStudent, parseCampus } from "../src/core/campus";
import {
  carmenEvent,
  carmenFailure,
  newCarmenDiagnostics,
  type CarmenDiagnostics,
  type CarmenStage,
  type CarmenTrigger,
  type CarmenRecoveryStep,
} from "../src/core/carmen-diagnostics";
import {
  browserQuotaRetryAfter,
  portalBrowser,
  type PortalBrowser,
  type BrowserState,
  type PortalBinding,
} from "./portal-browser";
import {
  compatibilityResource,
  observeCompatibility,
  type CarmenCompatibilityAttempt,
  type CarmenCompatibilityReport,
} from "./carmen-compatibility";

export interface PortalConnection {
  portal: string;
  account?: string;
  subject?: string;
  // A separate field makes older, automatically enabled sessions opt in again.
  keepConnected?: boolean;
  nextMaintenance?: number;
  maintenanceFailures?: number;
  lastIdentityVerified?: number;
  lastKeepalive?: number;
  diagnostics?: CarmenDiagnostics;
  compatibilityReport?: CarmenCompatibilityReport;
  recoveryBlocked?: CarmenRecoveryStep;
  maintenancePaused?: boolean;
  state?: BrowserState;
  jar?: ReturnType<CookieJar["serializeSync"]>;
  selected: string[];
  entry?: string;
  needsReconnect?: boolean;
  cooldown?: number;
  lastVerified?: number;
  renewalAfter?: number;
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
  renewalMs?: number;
  recoveryHistory?: { at: number; ms: number }[];
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
  private trigger: CarmenTrigger = "foreground";
  private stage: CarmenStage = "profile";
  private httpStatus?: number;
  private recordedError?: unknown;
  private compatibility?: CarmenCompatibilityAttempt;
  private diagnostics(c: PortalConnection) {
    return (c.diagnostics ??= newCarmenDiagnostics(Date.now()));
  }
  private event(
    c: PortalConnection,
    type: Parameters<typeof carmenEvent>[1]["type"],
    extra: Partial<Parameters<typeof carmenEvent>[1]> = {},
  ) {
    carmenEvent(this.diagnostics(c), {
      at: Date.now(),
      type,
      trigger: this.trigger,
      stage: this.stage,
      ...extra,
    });
  }
  private failure(c: PortalConnection, error: unknown) {
    if (this.recordedError === error) return;
    this.recordedError = error;
    const detail = carmenFailure(
      error instanceof ApiError ? error.code : "unexpectedFailure",
      this.httpStatus,
    );
    this.event(c, "failure", { ...detail, httpStatus: this.httpStatus });
  }
  private resetBudget(s: PortalStore) {
    const today = new Date().toISOString().slice(0, 10);
    if (s.browserDay !== today) {
      s.browserDay = today;
      s.browserMs = 0;
      s.renewalMs = 0;
    }
  }
  private portalURL(input: unknown) {
    return this.kind === "carmen" ? canvasURL(input) : campusURL(input);
  }
  private get summaryPath() {
    return this.kind === "carmen"
      ? canvasCoursesPath
      : "resources/portal/grades";
  }
  private get maintenanceInterval() {
    return (this.kind === "campus" ? 20 : 90) * 60_000;
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
  protected async browser(saved?: BrowserState, id?: string, recovery = false) {
    if (!this.binding) throw new ApiError(503, "browserUnavailable");
    return portalBrowser(
      this.binding,
      saved,
      id,
      (entry) => {
        void this.storage
          .put(`portal-${this.kind}-entry`, entry)
          .catch(() => {});
      },
      (portal, sessionID) => {
        if (!id && this.kind === "campus")
          void this.storage
            .put("portal-campus-discovered", { portal, sessionID })
            .catch(() => {});
      },
      recovery ? 30_000 : 240_000,
    );
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
      Pick<
        PortalStore,
        "browserDay" | "browserMs" | "renewalMs" | "recoveryHistory"
      >
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
        recoveryHistory: used.recoveryHistory,
      };
    }
    if (!budget.recoveryHistory && budget.renewalMs)
      budget.recoveryHistory = [{ at: Date.now(), ms: budget.renewalMs }];
    return { ...local, ...budget };
  }
  private async arm(next: number) {
    const current = await this.storage.getAlarm?.();
    if (!current || next < current) await this.storage.setAlarm(next);
  }
  private async save(s: PortalStore) {
    await this.storage.put(`portal-${this.kind}`, await seal(s, this.password));
    if (s.connection?.diagnostics)
      await this.storage.put(
        `${this.kind}-diagnostics`,
        s.connection.diagnostics,
      );
    else await this.storage.delete(`${this.kind}-diagnostics`);
    await this.storage.put("portal-browser-budget", {
      browserDay: s.browserDay,
      browserMs: s.browserMs,
      renewalMs: s.renewalMs,
      recoveryHistory: s.recoveryHistory,
    });
    const deadlines = [
      s.connection?.pending?.expires,
      s.connection?.keepConnected && !s.connection.pending
        ? s.connection.nextMaintenance
        : undefined,
    ].filter((x): x is number => typeof x === "number");
    if (deadlines.length) await this.arm(Math.min(...deadlines));
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
        maintenance: !!c?.keepConnected,
        nextMaintenance: c?.keepConnected ? c.nextMaintenance : undefined,
        lastKeepalive: c?.lastKeepalive,
        diagnostics: c?.diagnostics,
        compatibilityReportAvailable: !!c?.compatibilityReport,
        recoveryBlocked:
          this.kind === "carmen" ? c?.recoveryBlocked : undefined,
      };
    } catch (error) {
      if (error instanceof ApiError && error.code === "portalPasswordChanged")
        return { connected: true, needsReconnect: true, selected: [] };
      throw error;
    }
  }
  async compatibilityReport() {
    return (await this.load()).connection?.compatibilityReport ?? null;
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
    if (this.kind === "campus")
      await this.storage.delete("portal-campus-discovered");
    delete s.connection!.pending;
  }
  private async recover(s: PortalStore, c: PortalConnection): Promise<boolean> {
    if (this.kind !== "carmen" || !c.keepConnected) return false;
    this.resetBudget(s);
    s.recoveryHistory ??= s.renewalMs
      ? [{ at: Date.now(), ms: s.renewalMs }]
      : [];
    s.recoveryHistory = s.recoveryHistory.filter(
      (x) => x.at > Date.now() - 86400000,
    );
    if (
      !c.entry ||
      !c.state ||
      c.recoveryBlocked ||
      (c.renewalAfter ?? 0) > Date.now()
    )
      return false;
    // Reserve the worst-case short lease before acquiring. Refund only after
    // confirmed closure; a crashed/failed recovery cannot spend the budget twice.
    if (
      s.recoveryHistory.reduce((n, x) => n + x.ms, 0) + 60_000 > 120_000 ||
      s.browserMs + 60_000 > 540_000
    ) {
      this.event(c, "recoveryFailed", {
        stage: "browser",
        ...carmenFailure("portalBrowserBudget"),
      });
      return false;
    }
    const began = Date.now(),
      reservation = { at: began, ms: 60_000 };
    s.recoveryHistory.push(reservation);
    s.browserMs += 60_000;
    s.renewalMs = (s.renewalMs ?? 0) + 60_000;
    c.renewalAfter = began + 5 * 60_000;
    this.event(c, "recoveryStarted", { stage: "browser" });
    await this.save(s);
    let browser: PortalBrowser | undefined,
      stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    this.stage = "browser";
    this.httpStatus = undefined;
    const opening = this.browser(c.state, undefined, true);
    void opening.then(
      (late) => {
        if (stopped && !browser) void late.close().catch(() => {});
      },
      () => {},
    );
    try {
      const work = (async () => {
        const open = await opening;
        if (stopped) throw new ApiError(502, "recoveryTimedOut");
        browser = open;
        await open.navigate(c.entry!);
        await open.ready(this.portalURL(c.portal).origin);
        const state = await open.state(),
          jar = browserJar(state, this.portalURL(c.portal).origin);
        if (stopped) throw new ApiError(502, "recoveryTimedOut");
        const candidate = { ...c };
        this.diagnostics(c).profileChecks++;
        if (this.trigger === "alarm") this.diagnostics(c).backgroundChecks++;
        await this.verify(candidate, jar, false);
        return { state, jar, candidate };
      })();
      const recovered = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ApiError(502, "recoveryTimedOut")),
            25_000,
          );
        }),
      ]);
      Object.assign(c, recovered.candidate);
      c.state = this.retainState(recovered.state, c.portal);
      this.retainJar(c, recovered.jar);
      c.needsReconnect = false;
      c.maintenanceFailures = 0;
      delete c.recoveryBlocked;
      if (c.keepConnected && !c.maintenancePaused)
        c.nextMaintenance = Date.now() + this.maintenanceInterval;
      this.event(c, "httpSuccess", { stage: "profile", httpStatus: 200 });
      this.event(c, "recovered", {
        stage: "browser",
        durationMs: Date.now() - began,
      });
      return true;
    } catch (error) {
      stopped = true;
      let step: CarmenRecoveryStep = "unknown";
      if (browser?.recoveryStep) {
        let stop: ReturnType<typeof setTimeout> | undefined;
        try {
          step = await Promise.race([
            browser.recoveryStep(),
            new Promise<CarmenRecoveryStep>((resolve) => {
              stop = setTimeout(() => resolve("unknown"), 1500);
            }),
          ]);
        } catch {
          /* Classify only known steps; never persist browser errors/text. */
        } finally {
          clearTimeout(stop);
        }
      }
      if (step !== "unknown") c.recoveryBlocked = step;
      const code =
        step === "duo"
          ? "recoveryDuo"
          : step === "credentials"
            ? "recoveryCredentials"
            : step === "policy"
              ? "recoveryPolicy"
              : error instanceof ApiError
                ? error.code
                : "recoveryUnknown";
      this.event(c, "recoveryFailed", {
        stage: "browser",
        ...carmenFailure(code, this.httpStatus),
        httpStatus: this.httpStatus,
        durationMs: Date.now() - began,
      });
      return false;
    } finally {
      stopped = true;
      clearTimeout(timer);
      if (browser) {
        let closeTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            browser.close(),
            new Promise<never>((_, reject) => {
              closeTimer = setTimeout(
                () => reject(new Error("closeTimeout")),
                3000,
              );
            }),
          ]);
          const used = Math.min(60_000, Math.max(1, Date.now() - began));
          s.browserMs -= reservation.ms - used;
          s.renewalMs = Math.max(0, (s.renewalMs ?? 0) - reservation.ms + used);
          reservation.ms = used;
        } catch {
          c.maintenancePaused = true;
          delete c.nextMaintenance;
          this.event(c, "recoveryFailed", {
            stage: "browser",
            ...carmenFailure("recoveryCleanupFailed"),
          });
        } finally {
          clearTimeout(closeTimer);
        }
      }
    }
  }
  private async expireMaintenance() {
    this.requests = 0;
    this.bytes = 0;
    this.trigger = "alarm";
    this.recordedError = undefined;
    const s = await this.load(),
      c = s.connection;
    if (c?.pending) {
      this.resetBudget(s);
      await this.monitorSignIn(s);
      return;
    }
    if (!c?.keepConnected || c.maintenancePaused || !c.nextMaintenance) return;
    if (c.nextMaintenance > Date.now()) {
      await this.arm(c.nextMaintenance);
      return;
    }
    this.resetBudget(s);
    try {
      if (c.cooldown && c.cooldown > Date.now()) {
        c.nextMaintenance = c.cooldown;
        return;
      }
      if (!c.jar) {
        delete c.nextMaintenance;
        return;
      }
      let jar = CookieJar.deserializeSync(c.jar);
      try {
        if (this.kind === "campus" && c.profileAccount) {
          // The authenticated Student Profile bound this jar at sign-in. Some
          // district rosters omit identity, so validate the existing grades
          // collection without assignment details or changing local snapshots.
          this.diagnostics(c).profileChecks++;
          this.diagnostics(c).backgroundChecks++;
          campusChoices(await this.read(c, this.summaryPath, jar));
          this.event(c, "httpSuccess", { stage: "courses", httpStatus: 200 });
        } else await this.verify(c, jar);
        c.lastKeepalive = Date.now();
        c.maintenanceFailures = 0;
        c.needsReconnect = false;
        c.nextMaintenance = Date.now() + this.maintenanceInterval;
      } catch (error) {
        this.failure(c, error);
        if (error instanceof ApiError && error.code === "portalRateLimited")
          c.cooldown = Date.now() + (error.retryAfter ?? 60) * 1000;
        if (
          error instanceof ApiError &&
          error.code === "portalSignInRequired" &&
          this.kind === "carmen" &&
          (await this.recover(s, c))
        ) {
          jar = CookieJar.deserializeSync(c.jar!);
          c.lastKeepalive = Date.now();
          return;
        }
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
  async expire() {
    return this.expireMaintenance();
  }
  private async monitorSignIn(s: PortalStore) {
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
    await this.arm(p.expires);
    if (p.attempt && !p.error) {
      // The temporary browser is monitored only during an explicit sign-in.
      // Keep the expiration alarm even if a check is interrupted.
      try {
        const result = await this.handle("finish", {}, true);
        if ("state" in result && result.state === "waiting")
          await this.arm(Math.min(p.expires, Date.now() + 4000));
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
    this.stage = /\/(profile|roster)$/.test(u.pathname)
      ? "profile"
      : /\/(courses|grades)$/.test(u.pathname)
        ? "courses"
        : "assignments";
    this.httpStatus = undefined;
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
    const request = new Request(u, {
      headers:
        this.kind === "carmen"
          ? canvasSessionHeaders(jar, u)
          : {
              Accept: "application/json",
              Cookie: jar.getCookieStringSync(u.href),
            },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    try {
      // Invoke a supplied global fetch without binding it to this service.
      const upstream = this.upstream;
      r = await upstream(request);
    } catch (error) {
      throw new ApiError(
        502,
        request.signal.aborted ||
          (error instanceof Error &&
            ["TimeoutError", "AbortError"].includes(error.name))
          ? "portalTimeout"
          : "portalUnavailable",
      );
    }
    this.httpStatus = r.status;
    const resource = this.compatibility && compatibilityResource(u.pathname);
    if (this.compatibility && resource)
      observeCompatibility(this.compatibility, resource, r.status);
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
      if (r.status === 403 && this.kind === "carmen") {
        const rejection = await canvasRejection(r),
          cookies = jar.getCookiesSync(u.href);
        this.diagnostics(c).lastHttpRejection = {
          at: Date.now(),
          stage: this.stage,
          httpStatus: r.status,
          ...rejection,
          sessionCookiePresent: cookies.some((x) =>
            ["_normandy_session", "canvas_session"].includes(x.key),
          ),
          csrfCookiePresent: cookies.some((x) => x.key === "_csrf_token"),
          csrfHeaderSent: request.headers.has("X-CSRF-Token"),
          clientHeaderSent: request.headers.has("User-Agent"),
        };
        throw new ApiError(
          403,
          rejection.reason === "permission"
            ? "portalAccessDenied"
            : "portalRequestBlocked",
        );
      }
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
      this.bytes += value.length;
      if (size > 2_000_000 || this.bytes > 4_000_000) {
        await reader.cancel();
        throw new ApiError(502, "portalTooLarge");
      }
      text += decoder.decode(value, { stream: true });
    }
    try {
      const data: unknown = JSON.parse(text + decoder.decode());
      if (this.compatibility && resource)
        observeCompatibility(this.compatibility, resource, r.status, data);
      return {
        data,
        link: r.headers.get("Link"),
      };
    } catch {
      throw new ApiError(502, "malformedCampus");
    }
  }
  private async verify(c: PortalConnection, jar: CookieJar, observe = true) {
    if (this.compatibility) this.compatibility.phase = "profile";
    if (observe) {
      this.diagnostics(c).profileChecks++;
      if (this.trigger === "alarm") this.diagnostics(c).backgroundChecks++;
    }
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
    if (observe)
      this.event(c, "httpSuccess", { stage: "profile", httpStatus: 200 });
    if (c.keepConnected && !c.maintenancePaused)
      c.nextMaintenance = Date.now() + this.maintenanceInterval;
    return account;
  }
  private async fetch(c: PortalConnection) {
    if (!c.jar) throw new ApiError(401, "portalSignInRequired");
    const jar = CookieJar.deserializeSync(c.jar);
    const profileBound =
      this.kind === "campus" && !!c.profileAccount && !!c.account;
    if (profileBound) this.diagnostics(c).profileChecks++;
    try {
      // A profile-bound jar was created only after verifying the Student Profile
      // and a successful grades read. It cannot be replaced by an HTTP refresh.
      const account =
        this.kind === "campus" && c.profileAccount && c.account
          ? c.account
          : await this.verify(c, jar);
      if (this.compatibility) this.compatibility.phase = "courses";
      const summary = await this.read(c, this.summaryPath, jar);
      const choices = this.choices(summary),
        details: Record<string, unknown> = {};
      if (profileBound)
        this.event(c, "httpSuccess", { stage: "courses", httpStatus: 200 });
      this.diagnostics(c).courseCount = choices.length;
      this.diagnostics(c).lastCourseReadAt = Date.now();
      this.event(c, "coursesRead", { stage: "courses", httpStatus: 200 });
      if (this.kind === "campus" && c.keepConnected && !c.maintenancePaused)
        c.nextMaintenance = Date.now() + this.maintenanceInterval;
      // Keep request and memory amplification bounded. Discovery does not request assignment details.
      return { account, summary, choices, details, jar };
    } finally {
      this.retainJar(c, jar);
    }
  }
  async handle(
    action: string,
    b: Record<string, unknown> = {},
    automatic = false,
  ) {
    this.requests = 0;
    this.bytes = 0;
    this.trigger = action === "check" ? "manual" : "foreground";
    this.recordedError = undefined;
    let s: PortalStore;
    try {
      s = await this.load();
    } catch (error) {
      if (action !== "disconnect") throw error;
      await this.storage.delete(`portal-${this.kind}`);
      await this.storage.delete(`${this.kind}-diagnostics`);
      return { ok: true };
    }
    let c = s.connection;
    const capture =
      this.kind === "carmen" && (action === "finish" || action === "snapshot");
    this.compatibility = capture
      ? {
          result: "waiting",
          phase: action === "finish" ? "signIn" : "profile",
          responses: {},
        }
      : undefined;
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
        await this.arm(Date.now());
      }
      return { state: "waiting" };
    }
    try {
      this.resetBudget(s);
      if (c?.pending && c.pending.expires < Date.now()) await this.close(s);
      if (action === "status") return this.status();
      if (action === "disconnect") {
        await this.close(s);
        s = {
          browserMs: s.browserMs,
          browserDay: s.browserDay,
          renewalMs: s.renewalMs,
          recoveryHistory: s.recoveryHistory,
        };
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
          this.kind === "campus" &&
          (requested === undefined || requested === campusLogin)
            ? campusLogin
            : this.portalURL(requested ?? "https://osu.instructure.com").href;
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

        await this.storage.delete(`portal-${this.kind}-entry`);
        try {
          const destination = c.account && c.entry ? c.entry : portal;
          const [, url] = await Promise.all([
            browser.navigate(destination, "commit"),
            browser.live(),
          ]);
          await this.arm(Math.min(c.pending.expires, Date.now() + 1000));
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
      if (action === "finish" && this.kind === "carmen") {
        if (!c.pending) {
          if (c.completed)
            return {
              state: "connected",
              firstConnection: c.completed.firstConnection,
            };
          throw new ApiError(409, "portalSignInExpired");
        }
        const pending = c.pending,
          firstConnection = !c.account;
        if (automatic && this.binding) {
          const targets = await this.binding.devtools.listTargets(pending.id);
          if (
            !targets.some((t) => {
              if (t.type !== "page") return false;
              try {
                const url = new URL(t.url);
                return (
                  url.origin === "https://osu.instructure.com" &&
                  !/^\/(login|saml2)(\/|$)/i.test(url.pathname)
                );
              } catch {
                return false;
              }
            })
          )
            return { state: "waiting" };
        }
        const browser = await this.browser(undefined, pending.id);
        try {
          if (automatic && !this.binding && !(await browser.studentPortal?.()))
            return { state: "waiting" };
          const state = await browser.state();
          const portal = c.portal;
          const candidate = { ...c, portal };
          if (this.kind === "carmen")
            candidate.diagnostics = this.diagnostics(c);
          const jar = browserJar(state, this.portalURL(portal).origin),
            account = await this.verify(candidate, jar);
          if (this.compatibility) this.compatibility.phase = "courses";
          this.choices(await this.read(candidate, this.summaryPath, jar));
          const retained = this.retainState(state, portal);
          const entry = await this.storage.get<string>(
            `portal-${this.kind}-entry`,
          );
          Object.assign(c, candidate);
          if (entry && new URL(entry).origin === this.portalURL(portal).origin)
            c.entry = entry;
          c.portal = portal;
          c.state = retained;
          c.account = account;
          this.retainJar(c, jar);
          c.needsReconnect = false;
          c.lastVerified = Date.now();
          if (this.kind === "carmen") {
            c.maintenanceFailures = 0;
            c.nextMaintenance = c.keepConnected
              ? Date.now() + this.maintenanceInterval
              : undefined;
            c.entry = c.portal;
            delete c.recoveryBlocked;
            delete c.maintenancePaused;
            this.event(c, "connected");
          }
          c.completed = { attempt: pending.attempt!, firstConnection };
          await this.close(s);
          if (this.compatibility) this.compatibility.result = "ok";
          return { state: "connected", firstConnection, selected: c.selected };
        } catch (error) {
          if (
            automatic &&
            error instanceof ApiError &&
            error.code === "portalSignInRequired"
          )
            return { state: "waiting" };
          throw error;
        } finally {
          if (c.pending) await browser.detach?.().catch(() => {});
        }
      }
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
          c.maintenanceFailures = 0;
          delete c.maintenancePaused;
          c.nextMaintenance = c.keepConnected
            ? Date.now() + this.maintenanceInterval
            : undefined;
          this.event(c, "connected", { trigger: "manual", stage: "profile" });
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
      if (!c.account) throw new ApiError(409, "portalConnectRequired");
      if (action === "maintenance") {
        if (typeof b.enabled !== "boolean")
          throw new ApiError(400, "invalidRequest");
        c.keepConnected = b.enabled;
        delete c.maintenancePaused;
        c.maintenanceFailures = 0;
        c.nextMaintenance =
          b.enabled && c.jar && !c.needsReconnect
            ? Date.now() + this.maintenanceInterval
            : undefined;
        this.event(c, b.enabled ? "resumed" : "paused");
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
        c.needsReconnect = false;
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.code !== "portalSignInRequired"
        )
          throw error;
        c.needsReconnect = true;
        this.failure(c, error);
        if (!(await this.recover(s, c))) throw error;
        fresh = await this.fetch(c);
      }
      if (action === "check")
        return { ok: true, courseCount: fresh.choices.length };
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
        if (this.compatibility) this.compatibility.phase = "details";
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
        if (this.compatibility) this.compatibility.phase = "normalize";
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
        if (this.compatibility) this.compatibility.result = "ok";
        return { account: fresh.account, courses };
      }
      throw new ApiError(404, "notFound");
    } catch (error) {
      if (this.compatibility) {
        this.compatibility.result = "failed";
        const code = error instanceof Error ? error.message : "";
        this.compatibility.error = carmenFailure(
          code === "malformedCampus" ? "malformedCanvas" : code,
        ).code;
      }
      if (c) this.failure(c, error);
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
      if (
        c &&
        this.compatibility &&
        Object.keys(this.compatibility.responses).length
      ) {
        const report = (c.compatibilityReport ??= { schema: 1 });
        if (action === "finish") {
          report.signIn = this.compatibility;
          if (this.compatibility.result === "ok") delete report.sync;
        } else report.sync = this.compatibility;
      }
      this.compatibility = undefined;
      await this.save(s);
    }
  }
}
