// Explicit opt-in only: use your own deployed Worker, never CI or another user's site.
// Real grade responses stay in memory; only counts and boolean results are printed.
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const target = new URL(
  process.env.GRADEVIEWER_TEST_URL ?? "https://invalid.invalid",
);
if (
  target.protocol !== "https:" ||
  !target.hostname.endsWith(".workers.dev") ||
  target.username ||
  target.password ||
  target.port ||
  target.pathname !== "/" ||
  target.search ||
  target.hash
)
  throw new Error(
    "Set GRADEVIEWER_TEST_URL to your own HTTPS workers.dev origin.",
  );
const mode = process.argv[2] ?? "refresh";
if (!["connect", "refresh", "disconnect"].includes(mode))
  throw new Error("Choose connect, refresh, or disconnect.");
const password =
  process.env.GRADEVIEWER_TEST_PASSWORD ??
  (process.env.GRADEVIEWER_TEST_PASSWORD_FILE
    ? (
        await readFile(process.env.GRADEVIEWER_TEST_PASSWORD_FILE, "utf8")
      ).trim()
    : "");
if (password.length < 20)
  throw new Error("A private test app password is required.");
const credentials =
  mode === "connect"
    ? {
        key: process.env.SCHOOLOGY_API_KEY,
        secret: process.env.SCHOOLOGY_API_SECRET,
      }
    : undefined;
if (credentials && (!credentials.key || !credentials.secret))
  throw new Error("Configured Schoology credentials are required for connect.");

const compiled = await build({
  stdin: {
    contents:
      "export {readSnapshot} from './src/refresh'; export {emptyState} from './src/core/model';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { readSnapshot, emptyState } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
const nativeFetch = globalThis.fetch;
let cookie = "",
  requests = 0,
  coldMetrics;
const timings = [];
function routeMetrics(offset) {
  const reads = timings.slice(offset);
  return Object.fromEntries(
    [...new Set(reads.map((t) => t.route))].map((route) => {
      const values = reads.filter((t) => t.route === route);
      return [
        route,
        {
          requests: values.length,
          totalMs: Math.round(values.reduce((sum, t) => sum + t.ms, 0)),
        },
      ];
    }),
  );
}
globalThis.fetch = async (path, init = {}) => {
  if (!String(path).startsWith("/api/"))
    throw new Error("Unexpected verification request.");
  const headers = new Headers(init.headers);
  headers.set("Origin", target.origin);
  if (cookie) headers.set("Cookie", cookie);
  requests++;
  const started = performance.now();
  const response = await nativeFetch(new URL(path, target), {
    ...init,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(35000),
  });
  const resource = init.body ? JSON.parse(init.body).resource : undefined;
  const batchErrors =
    path === "/api/scan/read-batch"
      ? ((await response.clone().json()).results ?? []).flatMap((r, i) =>
          r.ok
            ? []
            : [
                {
                  resource: JSON.parse(init.body).jobs[i].resource,
                  code: r.error,
                  status: r.status,
                },
              ],
        )
      : undefined;
  timings.push({
    route: path + (resource ? ":" + resource : ""),
    ms: performance.now() - started,
    ...(batchErrors?.length ? { batchErrors } : {}),
  });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  if (response.headers.has("Set-Cookie")) {
    const value = response.headers.get("Set-Cookie");
    assert.match(value, /Secure/);
    assert.match(value, /HttpOnly/);
    assert.match(value, /SameSite=Strict/);
    cookie = value.split(";")[0];
  }
  return response;
};
async function status() {
  const response = await fetch("/api/status");
  assert.equal(response.status, 200);
  return response.json();
}
try {
  assert.equal((await status()).authenticated, false);
  const privateResponse = await fetch("/api/scan/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(privateResponse.status, 401);
  const login = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  assert.ok(cookie.startsWith("__Host-gradeviewer="));
  const authenticated = await status();
  assert.equal(authenticated.authenticated, true);
  if (mode === "disconnect") {
    assert.equal(
      (await fetch("/api/disconnect", { method: "POST", body: "{}" })).status,
      200,
    );
    assert.equal((await status()).authenticated, false);
    console.log(
      JSON.stringify({
        hosted: true,
        disconnected: true,
        sessionRevoked: true,
      }),
    );
  } else {
    if (mode === "refresh") assert.equal(authenticated.connected, true);
    const coldStarted = performance.now(),
      coldOffset = timings.length;
    const state = await readSnapshot(emptyState(), authenticated, credentials);
    const coldMs = performance.now() - coldStarted;
    coldMetrics = {
      coldMs: Math.round(coldMs),
      coldRequests: timings.length - coldOffset,
    };
    assert.ok(state.courses.every((c) => c.fields.user_id === state.account));
    const connected = await status();
    assert.equal(connected.connected, true);
    const coldRequests = timings.length - coldOffset - 1;
    // An optional title lookup can establish a real provider cooldown after
    // fresh grades succeed. Respect it before starting benchmark-only repeats.
    if (connected.cooldown > Date.now()) {
      const remaining = connected.cooldown - Date.now();
      if (remaining > 120000)
        throw new Error("Provider cooldown exceeds benchmark window.");
      console.log(
        JSON.stringify({
          providerCooldownSeconds: Math.ceil(remaining / 1000),
          coldMs: Math.round(coldMs),
        }),
      );
      while (Date.now() <= connected.cooldown)
        await new Promise((r) =>
          setTimeout(r, Math.min(30000, connected.cooldown - Date.now() + 50)),
        );
    }
    const samples = Number(process.env.GRADEVIEWER_BENCHMARK_RUNS ?? 3);
    assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 5);
    const warmRuns = [];
    let previous = state;
    for (let i = 0; i < samples; i++) {
      requests = 0;
      const offset = timings.length,
        started = performance.now();
      const warm = await readSnapshot(previous, await status());
      assert.equal(warm.courses.length, state.courses.length);
      assert.equal(warm.account, state.account);
      warmRuns.push({
        ms: Math.round(performance.now() - started),
        requests,
        routes: routeMetrics(offset),
      });
      previous = warm;
    }
    let expiredRun;
    if (process.env.GRADEVIEWER_BENCHMARK_EXPIRY === "1") {
      const expiry = Date.now() + 310000;
      console.log(
        JSON.stringify({ waitingForMetadataExpiry: true, seconds: 310 }),
      );
      while (Date.now() < expiry)
        await new Promise((r) =>
          setTimeout(r, Math.min(30000, expiry - Date.now())),
        );
      requests = 0;
      const offset = timings.length,
        started = performance.now();
      const expired = await readSnapshot(previous, await status());
      assert.equal(expired.courses.length, state.courses.length);
      expiredRun = {
        ms: Math.round(performance.now() - started),
        requests,
        completeSnapshot: true,
        routes: routeMetrics(offset),
      };
    }
    console.log(
      JSON.stringify({
        hosted: true,
        authenticated: true,
        completeSnapshot: true,
        reusedStoredCredentials: mode === "refresh",
        coursePeriods: state.courses.length,
        allAccountBound: true,
        warmSnapshotComplete: true,
        coldRequests,
        coldMs: Math.round(coldMs),
        warmRuns,
        expiredRun,
      }),
    );
  }
} catch (e) {
  // Do not print remote responses, assertion values, account IDs, stacks, or URLs.
  console.log(
    JSON.stringify({
      hosted: true,
      passed: false,
      code: e.code ?? "verificationFailed",
      status: e.status,
      requests,
      ...(coldMetrics ?? {}),
      timings: timings.map((t) => ({ ...t, ms: Math.round(t.ms) })),
    }),
  );
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
}
