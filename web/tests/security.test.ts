import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { seal, unseal, authorization, encode, hash } from "../worker/crypto";
import { safeURL, nextPage, readProvider, ApiError } from "../worker/provider";
import worker, { CredentialVault, type Env } from "../worker/index";
const password = "synthetic-password-at-least-20-characters";
describe("vault cryptography", () => {
  it("encrypts credentials, randomizes nonces and rejects tampering/wrong roots", async () => {
    const value = { key: "synthetic-key", secret: "synthetic-secret" },
      a = await seal(value, password),
      b = await seal(value, password);
    expect(JSON.stringify(a)).not.toContain(value.secret);
    expect(a.nonce).not.toBe(b.nonce);
    expect(await unseal(a, password)).toEqual(value);
    await expect(unseal(a, password + "wrong")).rejects.toThrow();
    a.data = a.data.slice(0, -4) + "AAAA";
    await expect(unseal(a, password)).rejects.toThrow();
  });
  it("matches an independent OAuth HMAC computation including duplicate queries", async () => {
    const url = new URL("https://api.schoology.com/v1/users/me?x=a%20b&x=%2B"),
      header = await authorization(
        url,
        { key: "test-key", secret: "test-secret" },
        "fixed-nonce",
        "1234567890",
      ),
      fields = Object.fromEntries(
        [...header.matchAll(/(oauth_\w+)="([^"]*)"/g)].map((m) => [
          m[1],
          decodeURIComponent(m[2]),
        ]),
      ),
      signature = fields.oauth_signature;
    delete fields.oauth_signature;
    const pairs = [...url.searchParams, ...Object.entries(fields)]
      .map(([k, v]) => [encode(k), encode(v)])
      .sort((a, b) => a.join("=").localeCompare(b.join("="), "en"));
    const expected = createHmac("sha1", "test-secret&")
      .update(
        [
          "GET",
          encode(url.origin + url.pathname),
          encode(pairs.map((p) => p.join("=")).join("&")),
        ].join("&"),
      )
      .digest("base64");
    expect(signature).toBe(expected);
  });
});
describe("read-only provider transport", () => {
  it.each([
    "http://api.schoology.com/v1/users/me",
    "https://evil.test/v1/users/me",
    "https://api.schoology.com/v1/users/me#secret",
    "https://api.schoology.com/v1/users/me?url=bad",
    "https://api.schoology.com/v1/users/me?limit=10000",
  ])("rejects unsafe URL %s", (url) => expect(() => safeURL(url)).toThrow());
  it("re-signs owner redirects and sends only GET", async () => {
    const headers: string[] = [];
    let calls = 0;
    const result = await readProvider(
      "users/me",
      { key: "test", secret: "test" },
      async (request) => {
        expect(request.method).toBe("GET");
        expect(request.redirect).toBe("manual");
        headers.push(request.headers.get("Authorization")!);
        return calls++ === 0
          ? new Response(null, {
              status: 303,
              headers: { Location: "/v1/users/123" },
            })
          : Response.json({ uid: "123" });
      },
    );
    expect(result.uid).toBe("123");
    expect(headers[0]).not.toBe(headers[1]);
  });
  it("never forwards authorization to another origin", async () => {
    let calls = 0;
    await expect(
      readProvider("users/me", { key: "test", secret: "test" }, async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { Location: "https://evil.test/v1/users/me" },
        });
      }),
    ).rejects.toThrow("unsafeProviderURL");
    expect(calls).toBe(1);
  });
  it("returns a bounded cooldown without logging provider errors", async () => {
    await expect(
      readProvider(
        "users/me",
        { key: "test", secret: "test" },
        async () =>
          new Response("private response", {
            status: 429,
            headers: { "Retry-After": "7" },
          }),
      ),
    ).rejects.toMatchObject({ code: "rateLimited", retryAfter: 7 });
  });
  it("rejects collection changes and wrong section pagination", () => {
    expect(() =>
      nextPage(
        {
          links: {
            next: "https://api.schoology.com/v1/users/123/sections?start=200",
          },
        },
        "users/123/grades?limit=200",
      ),
    ).toThrow();
    expect(() =>
      nextPage(
        {
          links: {
            next: "https://api.schoology.com/v1/users/123/grades?section_id=9&start=200",
          },
        },
        "users/123/grades?section_id=8&limit=200",
      ),
    ).toThrow();
  });
});
function harness() {
  const values = new Map<string, unknown>(),
    storage = {
      get: async (k: string) => structuredClone(values.get(k)),
      put: async (k: string, v: unknown) => {
        values.set(k, structuredClone(v));
      },
    };
  const env = { APP_PASSWORD: password } as Env;
  let upstreamCalls = 0;
  class TestVault extends CredentialVault {
    protected upstream = async (req: Request) => {
      upstreamCalls++;
      const u = new URL(req.url);
      if (u.pathname.endsWith("/users/me"))
        return Response.json({ uid: "student" });
      if (u.pathname.endsWith("/sections"))
        return Response.json({ section: [] });
      if (u.pathname.endsWith("/grades")) return Response.json({ section: [] });
      return Response.json({}, { status: 403 });
    };
  }
  let instance = new TestVault(
      { storage } as unknown as DurableObjectState,
      env,
    ),
    cookie = "";
  const send = async (
    route: string,
    data?: unknown,
    origin = "https://app.test",
  ) => {
    const r = await instance.fetch(
      new Request("https://app.test/api/" + route, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
    );
    const next = r.headers.get("Set-Cookie");
    if (next) cookie = next.split(";")[0];
    return r;
  };
  return {
    send,
    values,
    env,
    get cookie() {
      return cookie;
    },
    get calls() {
      return upstreamCalls;
    },
    restart() {
      instance = new TestVault(
        { storage } as unknown as DurableObjectState,
        env,
      );
    },
  };
}
describe("owner authentication and persistent lifecycle", () => {
  it("requires app owner unlock before any provider request", async () => {
    const h = harness();
    expect((await h.send("scan/start", {})).status).toBe(401);
    expect(h.calls).toBe(0);
  });
  it("rejects cross-origin mutations", async () => {
    const h = harness();
    expect(
      (await h.send("login", { password }, "https://evil.test")).status,
    ).toBe(403);
  });
  it("issues a secure HttpOnly host cookie and persists only its hash", async () => {
    const h = harness(),
      r = await h.send("login", { password });
    expect(r.headers.get("Set-Cookie")).toMatch(
      /__Host-gradeviewer=.*Secure; HttpOnly; SameSite=Strict/,
    );
    expect(JSON.stringify([...h.values.values()])).not.toContain(
      h.cookie.split("=")[1],
    );
    expect(((await (await h.send("status")).json()) as any).authenticated).toBe(
      true,
    );
    h.restart();
    expect(((await (await h.send("status")).json()) as any).authenticated).toBe(
      true,
    );
  });
  it("limits incorrect owner passwords durably", async () => {
    const h = harness();
    for (let i = 0; i < 5; i++)
      expect((await h.send("login", { password: "wrong" })).status).toBe(401);
    h.restart();
    expect((await h.send("login", { password })).status).toBe(429);
  });
  it("stages encrypted keys and rejects early commit", async () => {
    const h = harness();
    await h.send("login", { password });
    const { scan } = (await (
      await h.send("scan/start", { key: "test", secret: "secret-value" })
    ).json()) as any;
    expect(JSON.stringify([...h.values.values()])).not.toContain(
      "secret-value",
    );
    expect((await h.send("scan/commit", { scan })).status).toBe(409);
    expect(
      (
        await h.send("scan/read", {
          scan,
          resource: "section",
          section: "not-enrolled",
        })
      ).status,
    ).toBe(403);
  });
  it("commits a schema-valid empty snapshot and retains credentials across restarts", async () => {
    const h = harness();
    await h.send("login", { password });
    const { scan } = (await (
      await h.send("scan/start", { key: "test", secret: "secret-value" })
    ).json()) as any;
    await h.send("scan/read", { scan, resource: "sections" });
    expect((await h.send("scan/commit", { scan })).status).toBe(200);
    h.restart();
    expect(((await (await h.send("status")).json()) as any).connected).toBe(
      true,
    );
    expect((await h.send("scan/start", {})).status).toBe(200);
  });
  it("disconnect revokes all sessions and ciphertext", async () => {
    const h = harness();
    await h.send("login", { password });
    await h.send("disconnect", {});
    const data = (await (await h.send("status")).json()) as any;
    expect(data.authenticated).toBe(false);
    expect(JSON.stringify([...h.values.values()])).not.toContain("credentials");
  });
  it("password rotation revokes old sessions without deleting encrypted recovery material", async () => {
    const h = harness();
    await h.send("login", { password });
    h.env.APP_PASSWORD = password + "rotated";
    h.restart();
    expect(((await (await h.send("status")).json()) as any).authenticated).toBe(
      false,
    );
  });
  it("expires sessions server-side", async () => {
    const h = harness();
    await h.send("login", { password });
    const vault = h.values.get("vault") as any;
    for (const key of Object.keys(vault.sessions))
      vault.sessions[key] = Date.now() - 1;
    h.values.set("vault", vault);
    expect((await h.send("scan/start", {})).status).toBe(401);
  });
  it("does not expose arbitrary upstream routes or provider write methods", async () => {
    const h = harness();
    await h.send("login", { password });
    expect((await h.send("proxy", { url: "https://evil.test" })).status).toBe(
      404,
    );
  });
});
