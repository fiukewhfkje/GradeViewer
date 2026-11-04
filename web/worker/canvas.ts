import Link from "http-link-header";
import { ApiError } from "./provider";
export const canvasOrigin = "https://osu.instructure.com";
export const canvasCoursesPath =
  "/api/v1/courses?enrollment_type=student&include[]=total_scores&include[]=term&include[]=teachers&per_page=100";
export function canvasURL(input: unknown = canvasOrigin) {
  if (input !== canvasOrigin && input !== canvasOrigin + "/")
    throw new ApiError(400, "invalidRequest");
  return new URL(canvasOrigin);
}
export function canvasAllowed(u: URL) {
  if (
    u.origin !== canvasOrigin ||
    u.username ||
    u.password ||
    u.hash ||
    u.href.length > 2000
  )
    return false;
  if (
    !/^\/api\/v1\/(users\/self\/profile|courses(?:\/[1-9]\d{0,19}\/(assignment_groups|enrollments))?)$/.test(
      u.pathname,
    )
  )
    return false;
  const allowed = new Set([
    "enrollment_type",
    "include[]",
    "per_page",
    "page",
    "user_id",
    "type[]",
  ]);
  return (
    [...u.searchParams.keys()].every((k) => allowed.has(k)) &&
    (!u.searchParams.has("per_page") ||
      /^[1-9]\d{0,2}$/.test(u.searchParams.get("per_page")!)) &&
    (!u.searchParams.has("page") ||
      /^[a-zA-Z0-9_=-]{1,100}$/.test(u.searchParams.get("page")!))
  );
}
export function canvasNext(link: string | null, current: URL, first: URL) {
  if (!link) return;
  if (link.length > 12000) throw new ApiError(502, "malformedCanvas");
  const next = Link.parse(link).rel("next");
  if (!next.length) return;
  if (next.length !== 1) throw new ApiError(502, "malformedCanvas");
  const u = new URL(next[0].uri, current);
  const scope = (url: URL) =>
    [...url.searchParams]
      .filter(([k]) => !["page", "per_page"].includes(k))
      .map((x) => JSON.stringify(x))
      .sort()
      .join(";");
  if (
    !canvasAllowed(u) ||
    u.pathname !== first.pathname ||
    scope(u) !== scope(first)
  )
    throw new ApiError(502, "invalidPortalRedirect");
  return u;
}
