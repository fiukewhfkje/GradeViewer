export class RequestError extends Error {
  constructor(
    public code: string,
    public retryAfter?: number,
    public status?: number,
    public provider?: string,
  ) {
    super(code);
  }
}
export interface PortalStatus {
  connected: boolean;
  needsReconnect: boolean;
  selected: string[];
  maintenance?: boolean;
  nextMaintenance?: number;
  lastKeepalive?: number;
  portal?: string;
  lastVerified?: number;
  cooldown?: number;
}
export interface Status {
  portals?: { campus?: PortalStatus; carmen?: PortalStatus };
  schoologyConnected?: boolean;
  authenticated: boolean;
  connected: boolean;
  account?: string;
  revision?: string;
  cooldown?: number;
}
export async function api<T>(path: string, data?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/" + path, {
      method: data === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: data === undefined ? {} : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      cache: "no-store",
      signal: AbortSignal.timeout(35000),
    });
  } catch {
    throw new RequestError("networkUnavailable");
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new RequestError("invalidResponse");
  }
  if (!response.ok)
    throw new RequestError(
      (value as { error?: string }).error ?? "requestFailed",
      (value as { retryAfter?: number }).retryAfter,
      response.status,
      path.startsWith("carmen/") ? "carmen" : undefined,
    );
  return value as T;
}
const messages: Record<string, string> = {
  malformedCanvas:
    "Carmen returned an unsupported response. Your saved grades are retained.",
  portalTooLarge:
    "The course data exceeds the supported sync limit. Your saved grades are retained.",
  portalTooManyCourses:
    "This account has more courses than the supported sync limit.",
  invalidCampusURL: "Enter your district’s Campus Student sign-in address.",
  schoologyFirst: "Connect Schoology before adding Infinite Campus classes.",
  portalSignInRequired:
    "Infinite Campus needs you to sign in again. Your saved grades are retained.",
  portalSignInExpired: "That sign-in window expired. Open sign-in again.",
  portalAccountChanged:
    "This is a different Infinite Campus student. Disconnect Infinite Campus before switching students.",
  portalDisconnectFirst:
    "Disconnect Infinite Campus before changing districts.",
  campusIdentityUnsupported:
    "This district returned an unsupported student identity. The connection was not changed.",
  malformedCampus:
    "Infinite Campus returned an unsupported response. Your saved grades are retained.",
  portalUnavailable:
    "Infinite Campus could not be reached. Your saved grades are retained.",
  portalAccessDenied:
    "Infinite Campus denied access. Your saved grades are retained.",
  portalRateLimited:
    "Infinite Campus is limiting requests. Please wait and retry.",
  portalBrowserBudget:
    "Sign-in is temporarily unavailable. Please try again later.",
  browserUnavailable:
    "The sign-in window could not open. Please wait and retry.",
  portalPasswordChanged:
    "Your app password changed. Reconnect Infinite Campus.",
  networkUnavailable:
    "Unable to reach your site. Check your internet connection and retry.",
  unlockRequired: "Unlock your app in Settings.",
  incorrectAppPassword: "That app password was not accepted.",
  loginLimited: "Too many attempts. Please wait before trying again.",
  deploymentPasswordRequired:
    "Set an app password of at least 12 characters in your Cloudflare deployment.",
  schoologyCredentialsRejected:
    "Schoology did not accept these API keys. Get a new key and secret and try again.",
  schoologyAccessDenied:
    "Schoology denied API access. Check that your school allows personal API keys.",
  disconnectBeforeSwitchingAccounts:
    "Disconnect before connecting a different Schoology account.",
  reenterSchoologyKeys:
    "Your app password changed. Enter your Schoology keys again to restore the connection.",
  rateLimited: "Schoology is limiting requests. Your saved data is retained.",
  providerUnavailable: "Schoology is unavailable. Your saved data is retained.",
  malformedProvider:
    "Schoology returned an unsupported response. Your saved data is retained.",
  malformed:
    "Schoology returned an unsupported response. Your saved data is retained.",
  storageFailed:
    "Your browser could not save grades. Free some storage and retry.",
  incompleteSnapshot:
    "The snapshot was incomplete. Your saved data is retained.",
};
export const errorMessage = (error: unknown): string => {
  const message =
    error instanceof Error
      ? (messages[error.message] ??
        "Unable to complete this request. Your saved data is retained.")
      : "Unable to complete this request.";
  return error instanceof RequestError && error.provider === "carmen"
    ? message.replaceAll("Infinite Campus", "Carmen")
    : message;
};
