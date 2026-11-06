import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { PortalStatus } from "./api";

export type ConnectionTone = "neutral" | "connected" | "warning" | "error";

export function portalHealth(
  status: PortalStatus | undefined,
  now = Date.now(),
  intervalMinutes = 90,
): { label: string; tone: ConnectionTone } {
  if (!status?.connected) return { label: "Set up", tone: "neutral" };
  const fault = status.diagnostics?.currentFailure;
  if (fault?.category === "accessDenied")
    return { label: "Access denied", tone: "error" };
  if (status.needsReconnect) return { label: "Sign-in needed", tone: "error" };
  if (fault?.category === "requestBlocked")
    return { label: "Check blocked", tone: "warning" };
  if (
    fault?.trigger === "alarm" ||
    fault?.stage === "profile" ||
    fault?.stage === "browser"
  )
    return { label: "Access unconfirmed", tone: "warning" };
  const verified = status.diagnostics?.lastSuccessAt ?? status.lastVerified;
  if (verified && now - verified <= (intervalMinutes + 5) * 60000)
    return { label: "Connected", tone: "connected" };
  return status.maintenance
    ? { label: "Check overdue", tone: "warning" }
    : { label: "Connected", tone: "neutral" };
}

export function usePortalHealth(
  status: PortalStatus | undefined,
  intervalMinutes: number,
  busy: boolean,
  refreshStatus: () => Promise<void>,
) {
  const [now, setNow] = useState(Date.now);
  const readStatus = useEffectEvent(refreshStatus);
  const dueReads = useRef({ deadline: 0, count: 0 });
  const verified = status?.diagnostics?.lastSuccessAt ?? status?.lastVerified;
  useEffect(() => {
    if (!verified) return;
    const remaining = verified + (intervalMinutes + 5) * 60000 - Date.now();
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, remaining + 1),
    );
    return () => clearTimeout(timer);
  }, [verified, intervalMinutes]);

  const deadline = status?.nextMaintenance;
  useEffect(() => {
    if (!status?.maintenance || !deadline || busy) return;
    if (dueReads.current.deadline !== deadline)
      dueReads.current = { deadline, count: 0 };
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function checkSavedStatus() {
      if (document.visibilityState !== "visible") return;
      dueReads.current.count++;
      await readStatus().catch(() => {});
      if (active && dueReads.current.count < 3)
        timer = setTimeout(checkSavedStatus, 60000);
    }
    // Read the Worker’s saved status after the alarm, without probing a provider.
    if (dueReads.current.count < 3)
      timer = setTimeout(
        checkSavedStatus,
        Math.max(0, deadline + 15000 - Date.now()),
      );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [status?.maintenance, deadline, busy]);
  return portalHealth(status, now, intervalMinutes);
}
