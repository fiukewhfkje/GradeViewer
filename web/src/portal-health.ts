import { useEffect, useEffectEvent, useRef } from "react";
import type { PortalStatus } from "./api";

export type ConnectionTone = "neutral" | "connected" | "error";

export function portalHealth(
  status: PortalStatus | undefined,
  provider: "campus" | "carmen" = "carmen",
): {
  label: string;
  tone: ConnectionTone;
} {
  if (!status?.connected) return { label: "Set up", tone: "neutral" };
  if (status.needsReconnect)
    return {
      label: provider === "campus" ? "Sign-in needed" : "Disconnected",
      tone: "error",
    };
  const fault = status.diagnostics?.currentFailure;
  if (
    (provider === "campus" && fault?.category === "authentication") ||
    fault?.category === "accessDenied" ||
    fault?.category === "requestBlocked" ||
    fault?.trigger === "alarm" ||
    (fault?.stage === "profile" &&
      (fault.httpStatus !== undefined ||
        fault.category === "network" ||
        fault.category === "timeout")) ||
    fault?.stage === "browser"
  )
    return provider === "campus"
      ? { label: "Check delayed", tone: "neutral" }
      : { label: "Disconnected", tone: "error" };
  return { label: "Connected", tone: "connected" };
}

export function usePortalHealth(
  status: PortalStatus | undefined,
  busy: boolean,
  refreshStatus: () => Promise<void>,
  provider: "campus" | "carmen",
) {
  const readStatus = useEffectEvent(refreshStatus);
  const dueReads = useRef({ deadline: 0, count: 0 });

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
  return portalHealth(status, provider);
}
