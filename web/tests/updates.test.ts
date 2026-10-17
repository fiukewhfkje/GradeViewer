import { expect, it, vi } from "vitest";
import { checkForAppUpdate } from "../src/updates";

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
