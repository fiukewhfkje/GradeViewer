import {
  hash,
  equal,
  random,
  seal,
  unseal,
  type Credentials,
  type Envelope,
} from "./crypto";
import {
  ApiError,
  readProvider,
  rows,
  validID,
  nextPage,
  type Fetcher,
} from "./provider";
import { latestRelease } from "./updates";
export interface Env {
  APP_PASSWORD: string;
  VAULT: DurableObjectNamespace;
  ASSETS: FetcherAssets;
}
interface FetcherAssets {
  fetch(request: Request): Promise<Response>;
}
interface Scan {
  id: string;
  expires: number;
  account: string;
  credentials: Envelope;
  sections: string[];
  owners: Record<string, string>;
  done: string[];
  cursors: Record<string, string>;
  pages: Record<string, number>;
  fingerprints: Record<string, string>;
  reused: string[];
  replacement: boolean;
  cachedOwners?: string[];
  freshMetadata?: boolean;
}
interface Vault {
  credentials?: Envelope;
  account?: string;
  revision: string;
  scans: Record<string, Scan>;
  cooldown: number;
  sessions: Record<string, number>;
  failures: number;
  blockedUntil: number;
  passwordHash: string;
  metadata: Record<
    string,
    { account: string; fingerprint: string; expires: number; owner: string }
  >;
  gradeLinks?: Record<
    string,
    { account: string; owner: string; expires: number }
  >;
}
const cookieName = "__Host-gradeviewer";
export const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
const setCookie = (token: string, seconds = 60 * 60 * 24 * 90) =>
  `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
function initial(): Vault {
  return {
    revision: random(),
    scans: {},
    cooldown: 0,
    sessions: {},
    failures: 0,
    blockedUntil: 0,
    passwordHash: "",
    metadata: {},
  };
}
function ensure(value: unknown): asserts value {
  if (!value) throw new ApiError(400, "invalidRequest");
}
function metadataReady(scan: Scan, section: string) {
  return ["section", "items", "categories", "periods"].every((r) =>
    scan.done.includes(r + ":" + section + ":"),
  );
}
function snapshotReady(scan: Scan) {
  const complete = (r: string, s = "") => scan.done.includes(r + ":" + s + ":");
  return (
    complete("sections") &&
    scan.sections.every(
      (s) =>
        (scan.owners[s] === "empty" && complete("grades", s)) ||
        (Object.entries(scan.owners).some(
          ([enrollment, owner]) =>
            owner === (scan.owners[s] ?? s) &&
            metadataReady(scan, enrollment) &&
            ((complete("grades") && owner === enrollment) ||
              complete("grades", enrollment)),
        ) &&
          (scan.owners[s] !== undefined ||
            scan.done.includes("gradesDenied:" + s))),
    )
  );
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (
    !request.headers.get("Content-Type")?.startsWith("application/json") ||
    Number(request.headers.get("Content-Length")) > 8192
  )
    throw new ApiError(400, "invalidRequest");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalidRequest");
  let s = "";
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    s += decoder.decode(value, { stream: true });
    if (s.length > 8192) {
      await reader.cancel();
      throw new ApiError(413, "requestTooLarge");
    }
  }
  if (s.length > 8192) throw new ApiError(413, "requestTooLarge");
  try {
    const v = JSON.parse(s);
    ensure(v && typeof v === "object" && !Array.isArray(v));
    return v;
  } catch {
    throw new ApiError(400, "invalidRequest");
  }
}
export class CredentialVault {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}
  protected upstream: Fetcher = fetch;
  fetch(request: Request): Promise<Response> {
    const result = this.queue.then(() => this.handle(request));
    this.queue = result.catch(() => {});
    return result;
  }
  private async read(
    scan: Scan,
    vault: Vault,
    b: Record<string, unknown>,
    now: number,
    upstream: Fetcher = this.upstream,
    prefetched?: Record<string, unknown>,
  ) {
    const resource = String(b.resource),
      section = String(b.section ?? ""),
      extra = String(b.extra ?? "");
    if (
      ![
        "sections",
        "grades",
        "section",
        "items",
        "categories",
        "periods",
        "scales",
        "assignment",
        "assignmentList",
        "folder",
      ].includes(resource)
    )
      throw new ApiError(400, "invalidResource");
    if (
      !["sections", "grades"].includes(resource) &&
      (!validID(section) || !scan.sections.includes(section))
    )
      throw new ApiError(403, "sectionNotEnrolled");
    const collections: Record<string, string> = {
      sections: "section",
      grades: "section",
      items: "assignment",
      categories: "grading_category",
      periods: "grading_period",
      scales: "grading_scale",
      assignmentList: "assignment",
      folder: "folder-item",
    };
    let path =
      resource === "sections"
        ? `users/${scan.account}/sections?limit=200`
        : resource === "grades"
          ? `users/${scan.account}/grades?${section ? "section_id=" + section + "&" : ""}limit=200`
          : resource === "section"
            ? `sections/${section}`
            : `sections/${section}/${({ items: "grade_items", categories: "grading_categories", periods: "grading_periods", scales: "grading_scales", assignmentList: "assignments" } as Record<string, string>)[resource]}?limit=200`;
    if (resource === "grades" && section && !scan.sections.includes(section))
      throw new ApiError(403, "sectionNotEnrolled");
    if (resource === "assignment" || resource === "folder") {
      ensure(validID(extra));
      path =
        resource === "assignment"
          ? `sections/${section}/assignments/${extra}`
          : `courses/${section}/folder/${extra}`;
    }
    const key = resource + ":" + section + ":" + extra;
    if (b.next === true) {
      if (!scan.cursors[key]) throw new ApiError(400, "invalidPagination");
      path = scan.cursors[key];
    } else {
      scan.pages[key] = 0;
      delete scan.cursors[key];
    }
    if ((scan.pages[key] ?? 0) >= 100) throw new ApiError(502, "tooManyPages");
    if (now < vault.cooldown)
      throw new ApiError(
        429,
        "rateLimited",
        Math.ceil((vault.cooldown - now) / 1000),
      );
    const credentials = await unseal<Credentials>(
      scan.credentials,
      this.env.APP_PASSWORD,
    );
    let data: Record<string, unknown>;
    try {
      data = prefetched ?? (await readProvider(path, credentials, upstream));
    } catch (e) {
      if (e instanceof ApiError && e.code === "rateLimited")
        vault.cooldown = Date.now() + (e.retryAfter ?? 60) * 1000;
      if (e instanceof ApiError && e.status === 403) {
        if (resource === "grades" && section)
          scan.done.push("gradesDenied:" + section);
        if (resource === "periods") scan.done.push(key);
      }
      throw e;
    }
    const list = collections[resource]
      ? rows(data, collections[resource])
      : undefined;
    if (resource === "sections") {
      for (const row of list!) {
        const id = String(row.id ?? "");
        if (!validID(id)) throw new ApiError(502, "malformedProvider");
        if (!scan.sections.includes(id)) scan.sections.push(id);
      }
    }
    if (resource === "grades" && section && list!.length === 0)
      scan.owners[section] = "empty";
    if (resource === "grades")
      for (const row of list!) {
        const id = String(row.section_id ?? "");
        if (!validID(id) || row.period === undefined)
          throw new ApiError(502, "malformedProvider");
        if (section) {
          scan.owners[section] = id;
          scan.fingerprints[section] = await hash(JSON.stringify(row));
        } else if (scan.sections.includes(id)) {
          scan.owners[id] = id;
          scan.fingerprints[id] = await hash(JSON.stringify(row));
        }
      }
    // A recent, server-verified enrollment alias can use this scan's fresh
    // bulk grade row. Never trust a browser-supplied owner, extend the link's
    // expiry on reuse, or carry it across accounts/replacement/manual reads.
    if (resource === "grades" && !section && !scan.freshMetadata) {
      for (const enrollment of scan.sections) {
        if (scan.owners[enrollment]) continue;
        const link = vault.gradeLinks?.[enrollment];
        const matches = list!.filter(
          (row) => String(row.section_id) === link?.owner,
        );
        if (
          link?.account === scan.account &&
          link.expires > now &&
          matches.length === 1
        ) {
          scan.owners[enrollment] = link.owner;
          scan.fingerprints[enrollment] = await hash(
            JSON.stringify(matches[0]),
          );
          scan.done.push("grades:" + enrollment + ":");
          scan.cachedOwners ??= [];
          scan.cachedOwners.push(enrollment);
        }
      }
    }
    const next = collections[resource] ? nextPage(data, path) : undefined;
    if (next === path) throw new ApiError(502, "invalidPagination");
    scan.pages[key] = (scan.pages[key] ?? 0) + 1;
    if (next) scan.cursors[key] = next;
    else {
      delete scan.cursors[key];
      if (!scan.done.includes(key)) scan.done.push(key);
    }
    return {
      data,
      next: !!next,
      ...(resource === "grades" && !section ? { owners: scan.owners } : {}),
    };
  }
  private async roots(
    scan: Scan,
    vault: Vault,
    now: number,
    verifiedCredentials?: Credentials,
  ) {
    if (now < vault.cooldown)
      throw new ApiError(
        429,
        "rateLimited",
        Math.ceil((vault.cooldown - now) / 1000),
      );
    const credentials =
      verifiedCredentials ??
      (await unseal<Credentials>(scan.credentials, this.env.APP_PASSWORD));
    // Identity was verified by scan/start. Fetch independent discovery reads
    // together, then process enrollment before resolving the fresh grade owners.
    const [sectionResult, gradeResult] = await Promise.allSettled([
      readProvider(
        `users/${scan.account}/sections?limit=200`,
        credentials,
        this.upstream,
      ),
      readProvider(
        `users/${scan.account}/grades?limit=200`,
        credentials,
        this.upstream,
      ),
    ]);
    for (const r of [sectionResult, gradeResult])
      if (
        r.status === "rejected" &&
        r.reason instanceof ApiError &&
        r.reason.code === "rateLimited"
      )
        vault.cooldown = Date.now() + (r.reason.retryAfter ?? 60) * 1000;
    if (sectionResult.status === "rejected") throw sectionResult.reason;
    // Completed reads may be processed even if the other root hit a cooldown.
    const sections = await this.read(
      scan,
      vault,
      { resource: "sections" },
      now,
      this.upstream,
      sectionResult.value,
    );
    let grades;
    try {
      if (gradeResult.status === "rejected") throw gradeResult.reason;
      grades = {
        ok: true,
        value: await this.read(
          scan,
          vault,
          { resource: "grades" },
          now,
          this.upstream,
          gradeResult.value,
        ),
      };
    } catch (error) {
      const e =
        error instanceof ApiError ? error : new ApiError(500, "requestFailed");
      grades = {
        ok: false,
        error: e.code,
        status: e.status,
        retryAfter: e.retryAfter,
      };
    }
    return { sections, grades };
  }
  private async handle(request: Request) {
    let vault: Vault | undefined;
    try {
      if (!this.env.APP_PASSWORD || this.env.APP_PASSWORD.length < 12)
        throw new ApiError(503, "deploymentPasswordRequired");
      vault = (await this.ctx.storage.get<Vault>("vault")) ?? initial();
      const now = Date.now(),
        fingerprint = await hash(this.env.APP_PASSWORD);
      if (vault.passwordHash !== fingerprint) {
        vault.sessions = {};
        vault.scans = {};
        vault.passwordHash = fingerprint;
      }
      vault.sessions = Object.fromEntries(
        Object.entries(vault.sessions).filter(([, expiry]) => expiry > now),
      );
      vault.scans = Object.fromEntries(
        Object.entries(vault.scans).filter(([, scan]) => scan.expires > now),
      );
      const url = new URL(request.url),
        route = url.pathname.slice(5),
        post = request.method === "POST";
      if (request.method !== "GET" && !post)
        throw new ApiError(405, "methodNotAllowed");
      if (
        post &&
        (request.headers.get("Origin") !== url.origin ||
          request.headers.get("Sec-Fetch-Site") === "cross-site")
      )
        throw new ApiError(403, "originRejected");
      const token = request.headers
        .get("Cookie")
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1);
      const session = token ? await hash(token) : "",
        authenticated = !!vault.sessions[session];
      let result: Response;
      if (route === "login" && post) {
        if (now < vault.blockedUntil)
          throw new ApiError(
            429,
            "loginLimited",
            Math.ceil((vault.blockedUntil - now) / 1000),
          );
        const b = await body(request);
        if (
          typeof b.password !== "string" ||
          !(await equal(b.password, this.env.APP_PASSWORD))
        ) {
          vault.failures++;
          if (vault.failures >= 5) {
            vault.blockedUntil = now + 15 * 60 * 1000;
            vault.failures = 0;
          }
          throw new ApiError(401, "incorrectAppPassword");
        }
        const id = random();
        vault.sessions[await hash(id)] = now + 90 * 86400000;
        const ids = Object.keys(vault.sessions);
        if (ids.length > 10) delete vault.sessions[ids[0]];
        vault.failures = 0;
        result = json({ ok: true }, 200, { "Set-Cookie": setCookie(id) });
      } else if (route === "status" && !post) {
        result = json({
          authenticated,
          connected: authenticated && !!vault.credentials,
          account: authenticated ? vault.account : undefined,
          revision: authenticated ? vault.revision : undefined,
          cooldown: authenticated ? vault.cooldown : undefined,
        });
      } else {
        if (!authenticated) throw new ApiError(401, "unlockRequired");
        if (route === "logout" && post) {
          delete vault.sessions[session];
          result = json({ ok: true }, 200, { "Set-Cookie": setCookie("", 0) });
        } else if (route === "disconnect" && post) {
          vault = initial();
          vault.passwordHash = fingerprint;
          result = json({ ok: true }, 200, { "Set-Cookie": setCookie("", 0) });
        } else if (route === "scan/start" && post) {
          const b = await body(request);
          let credentials: Credentials;
          if (b.key !== undefined || b.secret !== undefined) {
            ensure(
              typeof b.key === "string" &&
                typeof b.secret === "string" &&
                b.key.trim().length > 0 &&
                b.key.length < 1000 &&
                b.secret.trim().length > 0 &&
                b.secret.length < 1000,
            );
            credentials = {
              key: (b.key as string).trim(),
              secret: (b.secret as string).trim(),
              account: "",
            };
          } else {
            if (!vault.credentials) throw new ApiError(409, "connectRequired");
            try {
              credentials = await unseal<Credentials>(
                vault.credentials,
                this.env.APP_PASSWORD,
              );
            } catch {
              throw new ApiError(409, "reenterSchoologyKeys");
            }
          }
          if (now < vault.cooldown)
            throw new ApiError(
              429,
              "rateLimited",
              Math.ceil((vault.cooldown - now) / 1000),
            );
          const me = await readProvider("users/me", credentials, this.upstream),
            account = String(me.uid ?? me.id ?? "");
          if (!validID(account)) throw new ApiError(502, "malformedProvider");
          if (vault.account && vault.account !== account)
            throw new ApiError(409, "disconnectBeforeSwitchingAccounts");
          credentials.account = account;
          const id = random();
          if (Object.keys(vault.scans).length >= 3)
            delete vault.scans[Object.keys(vault.scans)[0]];
          vault.scans[id] = {
            id,
            expires: now + 15 * 60 * 1000,
            account,
            credentials: await seal(credentials, this.env.APP_PASSWORD),
            sections: [],
            owners: {},
            done: [],
            cursors: {},
            pages: {},
            fingerprints: {},
            reused: [],
            replacement: b.key !== undefined,
            freshMetadata: b.refreshMetadata === true || b.key !== undefined,
            cachedOwners: [],
          };
          result = json({
            scan: id,
            account,
            revision: vault.revision,
            ...(b.includeRoots === true
              ? {
                  roots: await this.roots(
                    vault.scans[id],
                    vault,
                    Date.now(),
                    credentials,
                  ),
                }
              : {}),
          });
        } else if (route === "scan/reuse" && post) {
          const b = await body(request),
            scan = vault.scans[String(b.scan)];
          const sections = b.sections === undefined ? [b.section] : b.sections;
          ensure(
            Array.isArray(sections) &&
              sections.length > 0 &&
              sections.length <= 32 &&
              sections.every((s) => typeof s === "string") &&
              new Set(sections).size === sections.length,
          );
          if (
            !scan ||
            scan.replacement ||
            scan.freshMetadata ||
            sections.some((section) => {
              const cached = vault!.metadata?.[section];
              return (
                !scan.sections.includes(section) ||
                !cached ||
                cached.account !== scan.account ||
                cached.expires < now ||
                cached.fingerprint !== scan.fingerprints[section]
              );
            })
          )
            throw new ApiError(409, "metadataExpired");
          for (const section of sections) {
            const cached = vault.metadata[section];
            for (const r of ["section", "items", "categories", "periods"])
              scan.done.push(r + ":" + section + ":");
            scan.owners[section] = cached.owner;
            scan.reused.push(section);
          }
          result = json({ ok: true });
        } else if (route === "scan/roots" && post) {
          const b = await body(request),
            scan = vault.scans[String(b.scan)];
          if (!scan) throw new ApiError(409, "scanExpired");
          result = json(await this.roots(scan, vault, now));
        } else if (["scan/read", "scan/read-batch"].includes(route) && post) {
          const b = await body(request),
            scan = vault.scans[String(b.scan)];
          if (!scan) throw new ApiError(409, "scanExpired");
          if (route === "scan/read")
            result = json(await this.read(scan, vault, b, now));
          else {
            ensure(
              Array.isArray(b.jobs) && b.jobs.length > 0 && b.jobs.length <= 32,
            );
            const jobs = b.jobs as Record<string, unknown>[];
            ensure(
              jobs.every(
                (job) =>
                  job &&
                  typeof job === "object" &&
                  [
                    "grades",
                    "section",
                    "items",
                    "categories",
                    "periods",
                    "scales",
                    "assignment",
                  ].includes(String(job.resource)) &&
                  typeof job.section === "string" &&
                  scan.sections.includes(job.section) &&
                  !job.next &&
                  (job.resource === "assignment"
                    ? typeof job.extra === "string" && validID(job.extra)
                    : job.extra === undefined),
              ),
            );
            ensure(
              new Set(
                jobs.map(
                  (job) =>
                    job.resource + ":" + job.section + ":" + (job.extra ?? ""),
                ),
              ).size === jobs.length,
            );
            const results: unknown[] = new Array(jobs.length);
            // Optional scale reads must wait for all required data, including
            // pagination and authoritative alias resolution. Keep their original
            // result indices so the client can consume a single bounded batch.
            const required = jobs.flatMap((j, i) =>
                j.resource === "scales" ? [] : [i],
              ),
              optional = jobs.flatMap((j, i) =>
                j.resource === "scales" ? [i] : [],
              );
            let scheduled = required;
            // Keep a Free-plan invocation below 50 subrequests, including redirects.
            // Five in-flight reads leave one slot under Cloudflare's six-connection limit.
            let cursor = 0,
              subrequests = 0,
              responseBytes = 0;
            const originalUpstream = this.upstream;
            const upstream: Fetcher = (request) => {
              if (subrequests >= 44) throw new ApiError(502, "batchDeferred");
              subrequests++;
              return originalUpstream(request);
            };
            const run = async () => {
              while (cursor < scheduled.length) {
                const index = scheduled[cursor++];
                try {
                  const value = await this.read(
                    scan,
                    vault!,
                    jobs[index],
                    now,
                    upstream,
                  );
                  const bytes = new TextEncoder().encode(
                    JSON.stringify(value),
                  ).length;
                  if (responseBytes + bytes > 4000000)
                    throw new ApiError(502, "batchDeferred");
                  responseBytes += bytes;
                  results[index] = { ok: true, value };
                } catch (error) {
                  const e =
                    error instanceof ApiError
                      ? error
                      : new ApiError(500, "requestFailed");
                  results[index] = {
                    ok: false,
                    error: e.code,
                    status: e.status,
                    retryAfter: e.retryAfter,
                  };
                }
              }
            };
            await Promise.all(
              Array.from({ length: Math.min(5, scheduled.length) }, run),
            );
            if (snapshotReady(scan)) {
              scheduled = optional;
              cursor = 0;
              await Promise.all(
                Array.from({ length: Math.min(5, scheduled.length) }, run),
              );
            } else
              for (const index of optional)
                results[index] = {
                  ok: false,
                  error: "batchDeferred",
                  status: 502,
                };
            result = json({ results });
          }
        } else if (route === "scan/commit" && post) {
          const b = await body(request),
            scan = vault.scans[String(b.scan)];
          if (!scan) throw new ApiError(409, "scanExpired");
          if (!snapshotReady(scan))
            throw new ApiError(409, "incompleteSnapshot");
          vault.metadata ??= {};
          const links: NonNullable<Vault["gradeLinks"]> = {};
          for (const s of scan.sections) {
            const owner = scan.owners[s] ?? s;
            if (
              owner !== "empty" &&
              Object.entries(scan.owners).some(
                ([enrollment, id]) =>
                  id === owner && metadataReady(scan, enrollment),
              )
            ) {
              links[s] =
                scan.cachedOwners?.includes(s) && vault.gradeLinks?.[s]
                  ? vault.gradeLinks[s]
                  : { account: scan.account, owner, expires: now + 5 * 60000 };
            }
          }
          vault.gradeLinks = links;
          for (const s of scan.sections)
            if (
              !scan.reused.includes(s) &&
              metadataReady(scan, s) &&
              scan.fingerprints[s]
            )
              vault.metadata[s] = {
                account: scan.account,
                fingerprint: scan.fingerprints[s],
                expires: now + 5 * 60000,
                owner: scan.owners[s],
              };
          vault.credentials = scan.credentials;
          vault.account = scan.account;
          vault.revision = random();
          vault.scans = {};
          result = json({ ok: true, revision: vault.revision });
        } else if (route === "scan/cancel" && post) {
          const b = await body(request);
          delete vault.scans[String(b.scan)];
          result = json({ ok: true });
        } else throw new ApiError(404, "notFound");
      }
      await this.ctx.storage.put("vault", vault);
      return result;
    } catch (error) {
      const e =
        error instanceof ApiError ? error : new ApiError(500, "requestFailed");
      if (vault) {
        if (e.code === "rateLimited")
          vault.cooldown = Date.now() + (e.retryAfter ?? 60) * 1000;
        await this.ctx.storage.put("vault", vault);
      }
      return json(
        { error: e.code, retryAfter: e.retryAfter },
        e.status,
        e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {},
      );
    }
  }
}
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    let response: Response;
    if (url.pathname.startsWith("/api/")) {
      if (request.headers.get("Sec-Fetch-Site") === "cross-site")
        response = json({ error: "originRejected" }, 403);
      else if (url.pathname === "/api/releases/latest") {
        if (request.method !== "GET")
          response = json({ error: "methodNotAllowed" }, 405);
        else
          try {
            response = json(await latestRelease());
          } catch {
            response = json({ error: "releaseCheckUnavailable" }, 503);
          }
      } else
        response = await env.VAULT.get(env.VAULT.idFromName("owner")).fetch(
          request,
        );
    } else response = await env.ASSETS.fetch(request);
    const secured = new Response(response.body, response);
    secured.headers.set("X-Content-Type-Options", "nosniff");
    secured.headers.set("Referrer-Policy", "no-referrer");
    secured.headers.set("X-Frame-Options", "DENY");
    secured.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    secured.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (
      url.pathname === "/sw.js" ||
      url.pathname === "/index.html" ||
      url.pathname === "/"
    )
      secured.headers.set("Cache-Control", "no-cache");
    return secured;
  },
};
