import { describe, expect, it } from "vitest";
import { PortalService, browserJar } from "../worker/portal";
import { hash, seal } from "../worker/crypto";
import {
  campusSummary,
  campusDetail,
  campusState,
  campusPortal,
} from "./campus-fixture";

async function fixture() {
  const values = new Map<string, unknown>();
  const password = "synthetic-portal-pool-password";
  const account = (
    await hash(new URL(campusPortal).origin + "\0" + "101")
  ).replace(/[^a-zA-Z0-9]/g, "");
  values.set(
    "portal-campus",
    await seal(
      {
        browserMs: 0,
        connection: {
          portal: campusPortal,
          account,
          selected: Array.from({ length: 6 }, (_, i) => `1:${100 + i}`),
          jar: browserJar(
            campusState,
            new URL(campusPortal).origin,
          ).serializeSync(),
        },
      },
      password,
    ),
  );
  const storage = {
    get: async (key: string) => structuredClone(values.get(key)),
    put: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
    delete: async (key: string) => values.delete(key),
    getAlarm: async () => undefined,
    setAlarm: async () => {},
  } as unknown as DurableObjectStorage;
  const summary = structuredClone(campusSummary);
  const course = summary[0].terms[0].courses[0];
  summary[0].terms[0].courses = Array.from({ length: 6 }, (_, i) => ({
    ...course,
    sectionID: 100 + i,
  }));
  const calls: { section: string; cookie: string }[] = [];
  const pending = new Map<string, (response: Response) => void>();
  let active = 0,
    peak = 0;
  const service = new PortalService(
    storage,
    password,
    undefined,
    async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/roster"))
        return Response.json({ personID: "101" });
      if (url.pathname.endsWith("/grades")) return Response.json(summary);
      const section = url.pathname.split("/").at(-1)!;
      calls.push({ section, cookie: request.headers.get("Cookie") ?? "" });
      active++;
      peak = Math.max(peak, active);
      try {
        return await new Promise<Response>((resolve) =>
          pending.set(section, resolve),
        );
      } finally {
        active--;
      }
    },
  );
  return { service, calls, pending, peak: () => peak, active: () => active };
}

describe("bounded portal detail scheduling", () => {
  it("refills three slots as each read finishes and retains rotated cookies", async () => {
    const h = await fixture();
    const snapshot = h.service.handle("snapshot");
    await expect.poll(() => h.calls.length).toBe(3);
    h.pending.get("101")!(
      Response.json(campusDetail, {
        headers: {
          "Set-Cookie":
            "rotation=synthetic-rotated; Path=/campus; Secure; HttpOnly",
        },
      }),
    );
    await expect.poll(() => h.calls.length).toBe(4);
    expect(h.calls[3].section).toBe("103");
    expect(h.calls[3].cookie).toContain("rotation=synthetic-rotated");
    h.pending.get("102")!(Response.json(campusDetail));
    await expect.poll(() => h.calls.length).toBe(5);
    h.pending.get("103")!(Response.json(campusDetail));
    await expect.poll(() => h.calls.length).toBe(6);
    for (const section of ["100", "104", "105"])
      h.pending.get(section)!(Response.json(campusDetail));
    expect(await snapshot).toMatchObject({ courses: expect.any(Array) });
    expect(h.peak()).toBe(3);
    expect(h.active()).toBe(0);
  });
  it("stops queued work on 429, drains peers and honors the saved cooldown without retrying", async () => {
    const h = await fixture();
    // Attach rejection handling before resolving a gated response.
    const snapshot = h.service
      .handle("snapshot")
      .catch((error: unknown) => error);
    await expect.poll(() => h.calls.length).toBe(3);
    h.pending.get("100")!(
      new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
    );
    await expect.poll(() => h.active()).toBe(2);
    // Give the transport's rejection to the scheduler before its peers finish.
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.pending.get("101")!(Response.json(campusDetail));
    h.pending.get("102")!(Response.json(campusDetail));
    expect(await snapshot).toMatchObject({
      code: "portalRateLimited",
      retryAfter: 120,
    });
    expect(h.calls).toHaveLength(3);
    expect(h.active()).toBe(0);
    expect(await h.service.status()).toMatchObject({
      connected: true,
      needsReconnect: false,
      cooldown: expect.any(Number),
    });
    await expect(h.service.handle("snapshot")).rejects.toMatchObject({
      code: "portalRateLimited",
    });
    expect(h.calls).toHaveLength(3);
  });
  it("retains a peer's 429 cooldown even when another read already failed", async () => {
    const h = await fixture();
    const snapshot = h.service
      .handle("snapshot")
      .catch((error: unknown) => error);
    await expect.poll(() => h.calls.length).toBe(3);
    h.pending.get("100")!(new Response(null, { status: 401 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.pending.get("101")!(
      new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
    );
    h.pending.get("102")!(Response.json(campusDetail));
    expect(await snapshot).toMatchObject({
      code: "portalRateLimited",
      retryAfter: 120,
    });
    expect(h.calls).toHaveLength(3);
    await expect(h.service.handle("snapshot")).rejects.toMatchObject({
      code: "portalRateLimited",
    });
    expect(h.calls).toHaveLength(3);
  });
  it("keeps the longest cooldown when in-flight peers return different 429 delays", async () => {
    const h = await fixture();
    const snapshot = h.service
      .handle("snapshot")
      .catch((error: unknown) => error);
    await expect.poll(() => h.calls.length).toBe(3);
    h.pending.get("100")!(
      new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.pending.get("101")!(
      new Response(null, { status: 429, headers: { "Retry-After": "1" } }),
    );
    h.pending.get("102")!(Response.json(campusDetail));
    expect(await snapshot).toMatchObject({
      code: "portalRateLimited",
      retryAfter: 120,
    });
    expect((await h.service.status()).cooldown).toBeGreaterThan(
      Date.now() + 119000,
    );
    expect(h.calls).toHaveLength(3);
  });
});
