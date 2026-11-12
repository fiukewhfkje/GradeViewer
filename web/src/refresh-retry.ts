// One allowance per Schoology failure episode, persisted across tabs/reloads.
export interface RefreshRetry {
  account: string;
  due: number;
  phase: "waiting" | "attempted" | "failed";
}
export const retryBufferMs = 5000;
export function planRefreshRetry(
  previous: RefreshRetry | undefined,
  account: string,
  retryAfter: number,
  now = Date.now(),
): RefreshRetry {
  const due =
    now +
    Math.max(1, Number.isFinite(retryAfter) ? retryAfter : 60) * 1000 +
    retryBufferMs;
  return {
    account,
    due: Math.max(due, previous?.account === account ? previous.due : 0),
    phase:
      previous?.account === account && previous.phase !== "waiting"
        ? "failed"
        : "waiting",
  };
}
