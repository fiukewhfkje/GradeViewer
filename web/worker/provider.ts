import { authorization, type Credentials } from "./crypto";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
export type Fetcher = (request: Request) => Promise<Response>;
export const origin = "https://api.schoology.com";
export const validID = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
export function safeURL(input: string | URL, expected?: URL) {
  const u = new URL(input);
  if (
    u.origin !== origin ||
    u.username ||
    u.password ||
    u.hash ||
    !/^\/v1\/(?:users|sections|courses)\/[a-zA-Z0-9_/-]+$/.test(u.pathname) ||
    u.pathname.includes("//")
  )
    throw new ApiError(502, "unsafeProviderURL");
  if (
    expected &&
    (u.pathname !== expected.pathname ||
      [...u.searchParams.keys()].some(
        (k) =>
          !["limit", "start", "offset"].includes(k) &&
          u.searchParams.get(k) !== expected.searchParams.get(k),
      ))
  )
    throw new ApiError(502, "invalidPagination");
  if (
    [...u.searchParams.keys()].some(
      (k) => !["limit", "start", "offset", "section_id"].includes(k),
    )
  )
    throw new ApiError(502, "unsafeProviderURL");
  for (const k of ["limit", "start", "offset"])
    if (
      u.searchParams.has(k) &&
      (!/^\d{1,7}$/.test(u.searchParams.get(k)!) ||
        Number(u.searchParams.get(k)) > 100000 ||
        (k === "limit" && Number(u.searchParams.get(k)) > 200))
    )
      throw new ApiError(502, "invalidPagination");
  return u;
}
export function rows(data: unknown, key: string): Record<string, unknown>[] {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !(key in data)
  )
    throw new ApiError(502, "malformedProvider");
  const v = (data as Record<string, unknown>)[key],
    list = Array.isArray(v) ? v : [v];
  if (list.some((r) => !r || typeof r !== "object" || Array.isArray(r)))
    throw new ApiError(502, "malformedProvider");
  return list as Record<string, unknown>[];
}
export async function readProvider(
  path: string,
  c: Pick<Credentials, "key" | "secret">,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>> {
  let url = safeURL(origin + "/v1/" + path);
  for (let redirects = 0; redirects < 4; redirects++) {
    let response: Response;
    try {
      response = await fetcher(
        new Request(url, {
          headers: {
            Authorization: await authorization(url, c),
            Accept: "application/json",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(25000),
        }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "batchDeferred")
        throw error;
      throw new ApiError(502, "providerUnavailable");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (!location) throw new ApiError(502, "invalidRedirect");
      const next = safeURL(new URL(location, url));
      if (
        next.pathname !== url.pathname &&
        !(
          url.pathname === "/v1/users/me" &&
          /^\/v1\/users\/[a-zA-Z0-9_-]+$/.test(next.pathname)
        )
      )
        throw new ApiError(502, "invalidRedirect");
      await response.body?.cancel();
      url = next;
      continue;
    }
    if (response.status === 429) {
      const raw = response.headers.get("Retry-After"),
        seconds =
          raw && /^\d+$/.test(raw)
            ? Number(raw)
            : raw
              ? Math.ceil((Date.parse(raw) - Date.now()) / 1000)
              : 60;
      throw new ApiError(
        429,
        "rateLimited",
        Math.max(1, Number.isFinite(seconds) ? seconds : 60),
      );
    }
    if (!response.ok)
      throw new ApiError(
        response.status === 401 || response.status === 403
          ? response.status
          : 502,
        response.status === 401
          ? "schoologyCredentialsRejected"
          : response.status === 403
            ? "schoologyAccessDenied"
            : "providerUnavailable",
      );
    if (Number(response.headers.get("Content-Length")) > 4000000)
      throw new ApiError(502, "providerTooLarge");
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError(502, "malformedProvider");
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4000000) {
        await reader.cancel();
        throw new ApiError(502, "providerTooLarge");
      }
      chunks.push(value);
    }
    try {
      const b = new Uint8Array(size);
      let n = 0;
      for (const chunk of chunks) {
        b.set(chunk, n);
        n += chunk.length;
      }
      const data = JSON.parse(new TextDecoder().decode(b));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw 0;
      return data;
    } catch {
      throw new ApiError(502, "malformedProvider");
    }
  }
  throw new ApiError(502, "tooManyRedirects");
}
export function nextPage(data: Record<string, unknown>, path: string) {
  const links = data.links as Record<string, unknown> | undefined,
    next = links?.next;
  if (next == null || next === "") return undefined;
  if (typeof next !== "string") throw new ApiError(502, "invalidPagination");
  const original = new URL(origin + "/v1/" + path),
    u = safeURL(new URL(next, original), original);
  if (
    u.searchParams.get("section_id") !== original.searchParams.get("section_id")
  )
    throw new ApiError(502, "invalidPagination");
  return u.pathname.slice(4) + u.search;
}
