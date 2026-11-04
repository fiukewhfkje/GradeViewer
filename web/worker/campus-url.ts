import { ApiError } from "./provider";
export const campusLogin = "https://www.infinitecampus.com/login";

// Keep only a reusable Student destination; never retain SAML assertions or relay queries.
export function campusURL(input: unknown, observed = false): URL {
  if (typeof input !== "string" || input.length > 8000)
    throw new ApiError(400, "invalidCampusURL");
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new ApiError(400, "invalidCampusURL");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !/^([a-z0-9-]+\.)+infinitecampus\.(org|com)$/.test(u.hostname) ||
    u.hostname === "www.infinitecampus.com"
  )
    throw new ApiError(400, "invalidCampusURL");
  const legacy = /^\/campus\/portal\/students\/[a-zA-Z0-9_-]+\.jsp$/.test(
    u.pathname,
  );
  const modern =
    /^\/campus\/nav-wrapper\/student\/portal\/student\/(?:home|grades)(?:\/)?$/.test(
      u.pathname,
    );
  const sso =
    observed &&
    u.pathname.match(/^\/campus\/SSO\/([a-zA-Z0-9_-]+)\/portal\/students\/?$/);
  if (!legacy && !modern && !sso) throw new ApiError(400, "invalidCampusURL");
  const app = modern ? u.searchParams.get("appName") : null;
  if (app && !/^[a-zA-Z0-9_-]{1,100}$/.test(app))
    throw new ApiError(400, "invalidCampusURL");
  if (
    !observed &&
    (u.hash ||
      [...u.searchParams.keys()].some((k) => k !== "appName" || !modern) ||
      u.searchParams.getAll("appName").length > 1)
  )
    throw new ApiError(400, "invalidCampusURL");
  u.search = "";
  u.hash = "";
  if (sso) u.pathname = `/campus/portal/students/${sso[1]}.jsp`;
  else if (modern) {
    u.pathname = "/campus/nav-wrapper/student/portal/student/home";
    if (app) u.searchParams.set("appName", app);
  }
  return u;
}
export function observedCampusPortal(input: string): string | undefined {
  try {
    return campusURL(input, true).href;
  } catch {
    return undefined;
  }
}
