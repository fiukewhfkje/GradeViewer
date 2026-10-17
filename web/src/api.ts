export class RequestError extends Error {
  constructor(
    public code: string,
    public retryAfter?: number,
    public status?: number,
  ) {
    super(code);
  }
}
export interface Status {
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
    );
  return value as T;
}
const messages: Record<string, string> = {
  networkUnavailable:
    "Unable to reach your site. Check your internet connection and retry.",
  unlockRequired: "Unlock your app in Profile.",
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
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? (messages[error.message] ??
      "Unable to complete this request. Your saved data is retained.")
    : "Unable to complete this request.";
