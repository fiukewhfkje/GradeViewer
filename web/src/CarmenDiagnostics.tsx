import { useState, useEffect, useEffectEvent, useRef } from "react";
import type { PortalStatus } from "./api";

function uptime(ms: number) {
  const minutes = Math.floor(Math.max(0, ms) / 60000),
    hours = Math.floor(minutes / 60),
    days = Math.floor(hours / 24);
  return days
    ? `${days}d ${hours % 24}h`
    : hours
      ? `${hours}h ${minutes % 60}m`
      : `${minutes}m`;
}

export function carmenHealth(
  status: PortalStatus,
  now = Date.now(),
  intervalMinutes = 90,
) {
  const d = status.diagnostics,
    fault = d?.currentFailure;
  if (!status.connected) return { label: "Not connected", tone: "neutral" };
  if (fault?.category === "accessDenied")
    return { label: "Access denied", tone: "error" };
  if (fault?.category === "requestBlocked")
    return { label: "Check blocked", tone: "warning" };
  if (status.needsReconnect) return { label: "Sign-in needed", tone: "error" };
  if (fault?.stage === "profile" || fault?.stage === "browser")
    return { label: "Access unconfirmed", tone: "warning" };
  if (
    d?.lastSuccessAt &&
    now - d.lastSuccessAt <= (intervalMinutes + 5) * 60000
  )
    return { label: "Alive", tone: "alive" };
  return { label: "Check overdue", tone: "warning" };
}
export function CarmenDiagnostics({
  status,
  busy,
  check,
  refresh,
  provider = "carmen",
}: {
  status: PortalStatus;
  busy: boolean;
  check: () => void;
  refresh: () => void;
  provider?: "carmen" | "campus";
}) {
  const [now, setNow] = useState(Date.now());
  const dueRefresh = useEffectEvent(refresh);
  const dueReads = useRef({ deadline: 0, count: 0 });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const deadline = status.nextMaintenance;
    if (!status.maintenance || !deadline || busy) return;
    if (dueReads.current.deadline !== deadline)
      dueReads.current = { deadline, count: 0 };
    if (dueReads.current.count >= 3) return;
    // Read saved diagnostics shortly after the expected alarm. This never
    // probes Carmen or refreshes grades; delayed alarms get at most three reads.
    const timer = setTimeout(
      () => {
        if (document.visibilityState !== "visible") return;
        dueReads.current.count++;
        dueRefresh();
      },
      Math.max(60000, deadline - Date.now() + 15000),
    );
    return () => clearTimeout(timer);
  }, [status.nextMaintenance, status.maintenance, busy]);
  const d = status.diagnostics,
    title = provider === "campus" ? "Infinite Campus" : "Carmen",
    health = carmenHealth(status, now, provider === "campus" ? 20 : 90);
  const reason =
    status.recoveryBlocked === "duo"
      ? "Sign in again to approve Duo."
      : status.recoveryBlocked === "credentials"
        ? "Your Ohio State sign-in needs to be renewed."
        : status.recoveryBlocked === "policy"
          ? "Ohio State needs your attention during sign-in."
          : status.needsReconnect
            ? "Sign in again to restore the connection."
            : d?.currentFailure?.category === "rateLimit"
              ? `${title} is limiting requests. Checks will wait.`
              : d?.currentFailure?.category === "accessDenied"
                ? `${title} denied access.`
                : d?.currentFailure?.category === "requestBlocked"
                  ? `${title} blocked the connection check. Details are saved for troubleshooting.`
                  : d?.currentFailure
                    ? "The last connection check failed. Details are saved for troubleshooting."
                    : undefined;
  return (
    <div className="portal-body carmen-diagnostics">
      <div className="carmen-health-heading">
        <strong>Session</strong>
        <span className="connection" data-health={health.tone}>
          <span className="status-dot" />
          {health.label}
        </span>
      </div>
      <p className="muted">
        {d?.lastSuccessAt
          ? `Last verified ${new Date(d.lastSuccessAt).toLocaleString()}.`
          : "No successful check yet."}
        {!status.nextMaintenance ? " Background checks paused." : ""}
      </p>
      <p
        className="muted carmen-uptime"
        title="Time confirmed between successful checks. Updates with each check and excludes failed recovery gaps."
      >
        Total verified uptime · {uptime(d?.verifiedUptimeMs ?? 0)}
      </p>
      {reason && (
        <p className="portal-notice" role="status">
          {reason}
        </p>
      )}
      <button className="secondary full" disabled={busy} onClick={check}>
        Check connection
      </button>
    </div>
  );
}
