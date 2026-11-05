export type CarmenTrigger = "foreground" | "alarm" | "manual";
export type CarmenStage = "profile" | "courses" | "assignments" | "browser";
export type CarmenRecoveryStep = "duo" | "credentials" | "policy" | "unknown";
export interface CarmenEvent {
  at: number;
  type:
    | "connected"
    | "httpSuccess"
    | "coursesRead"
    | "failure"
    | "recoveryStarted"
    | "recovered"
    | "recoveryFailed"
    | "paused"
    | "resumed";
  trigger: CarmenTrigger;
  stage: CarmenStage;
  sessionAgeMs: number;
  sinceLastSuccessMs?: number;
  code?: string;
  category?: string;
  httpStatus?: number;
  durationMs?: number;
}
export interface CarmenDiagnostics {
  startedAt: number;
  sessionStartedAt: number;
  profileChecks: number;
  profileSuccesses: number;
  backgroundChecks: number;
  manualConnections: number;
  recoveriesAttempted: number;
  recoveriesSucceeded: number;
  verifiedUptimeMs: number;
  lastSuccessAt?: number;
  lastCourseReadAt?: number;
  courseCount?: number;
  firstFailure?: CarmenEvent;
  firstRejection?: CarmenEvent;
  lastFailure?: CarmenEvent;
  currentFailure?: CarmenEvent;
  events: CarmenEvent[];
}
export function newCarmenDiagnostics(now: number): CarmenDiagnostics {
  return {
    startedAt: now,
    sessionStartedAt: now,
    profileChecks: 0,
    profileSuccesses: 0,
    backgroundChecks: 0,
    manualConnections: 0,
    recoveriesAttempted: 0,
    recoveriesSucceeded: 0,
    verifiedUptimeMs: 0,
    events: [],
  };
}
export function carmenEvent(
  d: CarmenDiagnostics,
  event: Omit<CarmenEvent, "sessionAgeMs" | "sinceLastSuccessMs">,
) {
  const record: CarmenEvent = {
    ...event,
    sessionAgeMs: Math.max(0, event.at - d.sessionStartedAt),
    sinceLastSuccessMs:
      d.lastSuccessAt === undefined
        ? undefined
        : Math.max(0, event.at - d.lastSuccessAt),
  };
  d.events = [...d.events.slice(-31), record];
  if (event.type === "httpSuccess") {
    // Sampled uptime ends at the last successful check, never at the current
    // clock. Do not count a failed/recovery gap as a surviving connection.
    if (d.lastSuccessAt !== undefined && !d.currentFailure)
      d.verifiedUptimeMs =
        (d.verifiedUptimeMs ?? 0) +
        Math.max(0, event.at - Math.max(d.sessionStartedAt, d.lastSuccessAt));
    d.profileSuccesses++;
    d.lastSuccessAt = event.at;
    delete d.currentFailure;
  }
  if (event.type === "failure" || event.type === "recoveryFailed") {
    d.firstFailure ??= record;
    d.lastFailure = record;
    d.currentFailure = record;
    if (event.category === "authentication") d.firstRejection ??= record;
  }
  if (event.type === "connected") d.manualConnections++;
  if (event.type === "recoveryStarted") d.recoveriesAttempted++;
  if (event.type === "recovered") d.recoveriesSucceeded++;
  if (event.type === "connected" || event.type === "recovered") {
    d.sessionStartedAt = event.at;
    d.lastSuccessAt = event.at;
    delete d.currentFailure;
  }
}
// Never persist arbitrary exception messages, URLs, page text or provider data.
export function carmenFailure(code: string, status?: number) {
  const categories: Record<string, string> = {
    portalSignInRequired: "authentication",
    portalAccessDenied: "accessDenied",
    portalAccountChanged: "accountChanged",
    portalRateLimited: "rateLimit",
    portalTimeout: "timeout",
    portalUnavailable: status && status >= 500 ? "server" : "network",
    malformedCanvas: "response",
    malformedCampus: "response",
    invalidPortalRedirect: "response",
    portalTooLarge: "response",
    portalTooManyCourses: "response",
    portalBrowserBudget: "browserBudget",
    portalBrowserDailyLimit: "browserBudget",
    portalBrowserRateLimited: "browserRateLimit",
    browserUnavailable: "browserUnavailable",
    recoveryDuo: "humanRequired",
    recoveryCredentials: "humanRequired",
    recoveryPolicy: "humanRequired",
    recoveryUnknown: "recoveryUnavailable",
    recoveryTimedOut: "timeout",
    recoveryCleanupFailed: "browserUnavailable",
  };
  return categories[code]
    ? { code, category: categories[code] }
    : { code: "unexpectedFailure", category: "unknown" };
}
