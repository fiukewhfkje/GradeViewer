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
  private async handle(request: Request) {
    let vault: Vault | undefined;
    try {
      if (!this.env.APP_PASSWORD || this.env.APP_PASSWORD.length < 20)
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
          };
          result = json({ scan: id, account });
        } else if (route === "scan/reuse" && post) {
          const b = await body(request),
            scan = vault.scans[String(b.scan)],
            section = String(b.section),
            cached = vault.metadata?.[section];
          if (
            !scan ||
            scan.replacement ||
            !scan.sections.includes(section) ||
            !cached ||
            cached.account !== scan.account ||
            cached.expires < now ||
            cached.fingerprint !== scan.fingerprints[section]
          )
            throw new ApiError(409, "metadataExpired");
          for (const r of ["section", "items", "categories", "periods"])
            scan.done.push(r + ":" + section + ":");
          scan.owners[section] = cached.owner;
          scan.reused.push(section);
          result = json({ ok: true });
        } else if (route === "scan/read" && post) {
          const b = await body(request),
            scan = vault.scans[String(b.scan)];
          if (!scan) throw new ApiError(409, "scanExpired");
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
          if (
            resource === "grades" &&
            section &&
            !scan.sections.includes(section)
          )
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
            if (!scan.cursors[key])
              throw new ApiError(400, "invalidPagination");
            path = scan.cursors[key];
          } else {
            scan.pages[key] = 0;
            delete scan.cursors[key];
          }
          if ((scan.pages[key] ?? 0) >= 100)
            throw new ApiError(502, "tooManyPages");
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
            data = await readProvider(path, credentials, this.upstream);
          } catch (e) {
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
          const next = collections[resource] ? nextPage(data, path) : undefined;
          if (next === path) throw new ApiError(502, "invalidPagination");
          scan.pages[key] = (scan.pages[key] ?? 0) + 1;
          if (next) scan.cursors[key] = next;
          else {
            delete scan.cursors[key];
            if (!scan.done.includes(key)) scan.done.push(key);
          }
          result = json({ data, next: !!next });
        } else if (route === "scan/commit" && post) {
          const b = await body(request),
            scan = vault.scans[String(b.scan)];
          if (!scan) throw new ApiError(409, "scanExpired");
          const complete = (r: string, s = "") =>
            scan.done.includes(r + ":" + s + ":");
          const metadataReady = (s: string) =>
            ["section", "items", "categories", "periods"].every((r) =>
              complete(r, s),
            );
          if (
            !complete("sections") ||
            !scan.sections.every(
              (s) =>
                (scan.owners[s] === "empty" && complete("grades", s)) ||
                (Object.entries(scan.owners).some(
                  ([enrollment, owner]) =>
                    owner === (scan.owners[s] ?? s) &&
                    metadataReady(enrollment) &&
                    ((complete("grades") && owner === enrollment) ||
                      complete("grades", enrollment)),
                ) &&
                  (scan.owners[s] !== undefined ||
                    scan.done.includes("gradesDenied:" + s))),
            )
          )
            throw new ApiError(409, "incompleteSnapshot");
          vault.metadata ??= {};
          for (const s of scan.sections)
            if (
              !scan.reused.includes(s) &&
              metadataReady(s) &&
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
      else
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
