import { describe, expect, it } from "vitest";
import { pooledFetcher } from "../worker/request-pool";

describe("shared provider response budget", () => {
  it("holds slots through streaming bodies and releases on EOF and cancellation", async () => {
    let calls = 0;
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const fetcher = pooledFetcher(async () => {
      calls++;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controllers.push(controller);
          },
        }),
        {
          headers: [
            ["Set-Cookie", "first=synthetic; Path=/"],
            ["Set-Cookie", "second=synthetic; Path=/"],
          ],
        },
      );
    }, 2);
    const first = await fetcher(new Request("https://fixture.test/1"));
    const second = await fetcher(new Request("https://fixture.test/2"));
    const third = fetcher(new Request("https://fixture.test/3"));
    expect(calls).toBe(2);
    expect(first.headers.getSetCookie()).toHaveLength(2);
    controllers[0].close();
    await first.text();
    const final = await third;
    expect(calls).toBe(3);
    const fourth = fetcher(new Request("https://fixture.test/4"));
    await second.body!.cancel();
    const last = await fourth;
    expect(calls).toBe(4);
    await final.body!.cancel();
    await last.body!.cancel();
  });
  it("releases failed reads and drops an aborted queued request before fetching it", async () => {
    let calls = 0;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = pooledFetcher(async () => {
      calls++;
      if (calls === 2) throw new Error("synthetic network failure");
      return new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
        }),
      );
    }, 1);
    const response = await fetcher(new Request("https://fixture.test/1"));
    const cancelled = new AbortController();
    const aborted = fetcher(
      new Request("https://fixture.test/aborted", { signal: cancelled.signal }),
    ).catch((error: unknown) => error);
    cancelled.abort();
    controller.error(new Error("synthetic stream failure"));
    await expect(response.text()).rejects.toThrow("synthetic stream failure");
    expect(await aborted).toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
    await expect(
      fetcher(new Request("https://fixture.test/2")),
    ).rejects.toThrow("synthetic network failure");
    const final = await fetcher(new Request("https://fixture.test/3"));
    expect(calls).toBe(3);
    await final.body!.cancel();
  });
});
