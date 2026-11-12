import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import * as repository from "../src/repository";
import { planRefreshRetry, retryBufferMs } from "../src/refresh-retry";
import { emptyState } from "../src/core/model";

afterEach(() => repository.clear());
describe("one automatic Schoology retry", () => {
  it("waits the complete server cooldown plus a buffer and never shortens it", () => {
    const first = planRefreshRetry(undefined, "account", 120, 1000);
    expect(first).toEqual({
      account: "account",
      due: 121000 + retryBufferMs,
      phase: "waiting",
    });
    expect(planRefreshRetry(first, "account", 1, 2000).due).toBe(first.due);
    expect(planRefreshRetry(first, "account", 240, 2000).due).toBe(
      242000 + retryBufferMs,
    );
    expect(
      planRefreshRetry({ ...first, phase: "attempted" }, "account", 60, 2000)
        .phase,
    ).toBe("failed");
  });
  it("claims the persisted allowance once across concurrent tabs and retains failure until success or a manual reset", async () => {
    await repository.save({ ...emptyState(), account: "account" });
    await repository.rememberAccess("account", Date.now() + 3600000);
    const first = await repository.planRetry("account", 60);
    expect(await repository.claimRetry("account", first.due - 1)).toBe(false);
    expect(await repository.claimRetry("another-account", first.due)).toBe(
      false,
    );
    expect(
      await Promise.all([
        repository.claimRetry("account", first.due),
        repository.claimRetry("account", first.due),
      ]),
    ).toEqual([true, false]);
    const failed = await repository.planRetry("account", 120);
    expect(failed.phase).toBe("failed");
    expect(await repository.claimRetry("account", failed.due)).toBe(false);
    await repository.finishRetry("account", true);
    expect(await repository.refreshRetry()).toBeUndefined();
    expect((await repository.planRetry("account", 60)).phase).toBe("waiting");
  });
  it("blocks a locked, expired or mismatched local account and never refunds an interrupted attempt", async () => {
    await repository.save({ ...emptyState(), account: "account" });
    const ticket = await repository.planRetry("account", 60);
    expect(await repository.claimRetry("account", ticket.due)).toBe(false);
    await repository.rememberAccess("account", ticket.due + 1000);
    expect(await repository.claimRetry("account", ticket.due + 1001)).toBe(
      false,
    );
    await repository.lock();
    expect(await repository.claimRetry("account", ticket.due)).toBe(false);
    await repository.unlock();
    await repository.rememberAccess("account", ticket.due + 1000);
    await repository.save({ ...emptyState(), account: "another-account" });
    expect(await repository.claimRetry("account", ticket.due)).toBe(false);
    await repository.save({ ...emptyState(), account: "account" });
    expect(await repository.claimRetry("account", ticket.due)).toBe(true);
    expect((await repository.refreshRetry())?.phase).toBe("attempted");
    expect(await repository.claimRetry("account", ticket.due + 1000)).toBe(
      false,
    );
  });
});
