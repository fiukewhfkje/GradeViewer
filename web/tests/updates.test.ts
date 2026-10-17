import { expect, it, vi } from "vitest";
import {
  checkForAppUpdate,
  activateAppUpdate,
  updateMessage,
} from "../src/updates";

function fixture() {
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  const reg = {
    waiting: null,
    installing: null,
    update: vi.fn(async () => {}),
  };
  return {
    worker,
    reg,
    registration: reg as unknown as ServiceWorkerRegistration,
  };
}
it("offers a cached update without another network check", async () => {
  const { worker, reg, registration } = fixture();
  Object.assign(reg, { waiting: worker });
  expect(await checkForAppUpdate(registration)).toBe(worker);
  expect(reg.update).not.toHaveBeenCalled();
});
it("distinguishes official releases, pending deployments, ready shells, missing automation and stalls", () => {
  const installed = { version: "0.1.3", automation: "installed" as const };
  const now = Date.parse("2026-10-17T12:00:00Z");
  expect(updateMessage("0.1.3", installed, { version: "0.1.3" }, false)).toBe(
    "You’re up to date.",
  );
  expect(
    updateMessage(
      "0.1.3",
      installed,
      { version: "0.1.4", publishedAt: "2026-10-17T10:00:00Z" },
      false,
      now,
    ),
  ).toContain("Update available");
  expect(
    updateMessage(
      "0.1.3",
      installed,
      { version: "0.1.4", publishedAt: "2026-10-14T10:00:00Z" },
      false,
      now,
    ),
  ).toContain("Update stalled");
  expect(
    updateMessage("0.1.3", installed, { version: "0.1.4" }, true),
  ).toContain("Update ready");
  expect(
    updateMessage(
      "0.1.3",
      { ...installed, automation: "missing" },
      { version: "0.1.3" },
      false,
    ),
  ).toContain("one-time setup repair");
  expect(
    updateMessage(
      "0.1.3",
      { ...installed, version: "0.1.4" },
      { version: "0.1.4" },
      false,
    ),
  ).toContain("could not finish caching");
  expect(() =>
    updateMessage("0.1.3", installed, { version: "garbage" }, false),
  ).toThrow();
});
it("reloads only after this tab explicitly requests activation, including an update accepted by another tab", async () => {
  const worker = Object.assign(new EventTarget(), {
    state: "installed",
    postMessage: vi.fn(),
  });
  const reload = vi.fn();
  const result = activateAppUpdate(worker as unknown as ServiceWorker, reload);
  expect(worker.postMessage).toHaveBeenCalledWith({ type: "ACTIVATE" });
  expect(reload).not.toHaveBeenCalled();
  worker.state = "activated";
  worker.dispatchEvent(new Event("statechange"));
  await result;
  expect(reload).toHaveBeenCalledOnce();
  await activateAppUpdate(worker as unknown as ServiceWorker, reload);
  expect(reload).toHaveBeenCalledTimes(2);
});
it("reports no update only after checking the server", async () => {
  const { reg, registration } = fixture();
  expect(await checkForAppUpdate(registration)).toBeUndefined();
  expect(reg.update).toHaveBeenCalledOnce();
});
it("waits for installation and caching to finish", async () => {
  const { worker, reg, registration } = fixture();
  Object.assign(reg, { installing: worker });
  const result = checkForAppUpdate(registration);
  await Promise.resolve();
  Object.assign(reg, { waiting: worker });
  worker.state = "installed";
  worker.dispatchEvent(new Event("statechange"));
  expect(await result).toBe(worker);
});
it("does not report failed installation as an up-to-date app", async () => {
  const { worker, reg, registration } = fixture();
  Object.assign(reg, { installing: worker });
  const result = checkForAppUpdate(registration);
  await Promise.resolve();
  worker.state = "redundant";
  worker.dispatchEvent(new Event("statechange"));
  await expect(result).rejects.toThrow("installation failed");
});
it("propagates network failures and bounds a stalled installation", async () => {
  const { reg, registration } = fixture();
  reg.update.mockRejectedValueOnce(new Error("offline"));
  await expect(checkForAppUpdate(registration)).rejects.toThrow("offline");
  vi.useFakeTimers();
  try {
    Object.assign(reg, { installing: new EventTarget() });
    const result = checkForAppUpdate(registration);
    const rejected = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});
