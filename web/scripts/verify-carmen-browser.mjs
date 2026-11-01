// Isolated platform research. Never signs in or reads a student API endpoint.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserClient } from "./carmen-browser-client.mjs";
import { random, seal, unseal } from "../worker/crypto.ts";

const fixture = "https://gradeviewer-synthetic.invalid";
const mode = process.argv.slice(2);

// An explicit mode is required before retrieving any deployment credential.
if (mode.length !== 1 || !["--synthetic", "--public-login"].includes(mode[0])) {
  console.log(JSON.stringify({ error: "explicitResearchModeRequired" }));
  process.exit(1);
}

process.umask(0o077);
const directory = await mkdtemp(join(tmpdir(), "gradeviewer-browser-proof-"));
const owned = new Set();
const report = {
  syntheticOnly: mode[0] === "--synthetic",
  studentDataRequested: false,
  created: 0,
  closed: 0,
  timingsMs: {},
};
let browser;
let stage = "cloudflareCredentials";

// Durations describe this CLI/CDP probe, not Worker-binding or authenticated SSO
// performance. Never include URLs, headers or response values in timing labels.
async function timed(label, operation) {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    (report.timingsMs[label] ??= []).push(
      Math.round(performance.now() - started),
    );
  }
}

const client = createBrowserClient(directory, timed);
async function launch() {
  const session = await client.open();
  browser = session.browser;
  owned.add(session.id);
  report.created++;
  return session.id;
}
async function close(id) {
  await client.close(id);
  browser = undefined;
  owned.delete(id);
  report.closed++;
}

async function fixturePage(context) {
  await context.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(fixture + "/")
      ? route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><title>Synthetic session</title><p>GradeViewer synthetic session only</p>",
        })
      : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(fixture + "/", { timeout: 15_000 });
  return page;
}

try {
  stage = "firstBrowser";
  const first = await launch();
  const createdAt = Date.now();
  const context = browser.contexts()[0];

  if (mode[0] === "--public-login") {
    stage = "publicSignInNavigation";
    const page = await timed("newPublicPage", () => context.newPage());
    const response = await timed("publicSignInNavigation", () =>
      page.goto("https://osu.instructure.com/", {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      }),
    );
    const host = new URL(page.url()).hostname;
    report.httpStatus = response?.status() ?? null;
    report.reachedOSUSignIn = host === "webauth.service.ohio-state.edu";
    report.success = response?.ok() === true && report.reachedOSUSignIn;
    stage = "closePublicSignIn";
    await close(first);
  } else {
    stage = "syntheticStateAndLiveView";
    const page = await fixturePage(context);
    const cdp = await context.newCDPSession(page);
    const live = await timed("generateLiveView", () =>
      cdp.send("Cloudflare.getLiveView", {
        mode: "tab",
        expiresInMs: 60_000,
      }),
    );
    const liveURL = new URL(live.devtoolsFrontendUrl);
    assert.equal(liveURL.protocol, "https:");
    assert.equal(liveURL.hostname, "live.browser.run");
    assert.equal(liveURL.searchParams.get("mode"), "tab");
    report.liveViewGenerated = true;
    const view = await fetch(liveURL, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(view.ok);
    await view.body?.cancel();
    report.liveViewPageAvailable = true;
    await context.addCookies([
      {
        name: "synthetic_session",
        value: "synthetic-not-an-osu-cookie",
        url: fixture,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    await page.evaluate(() =>
      localStorage.setItem("synthetic-storage", "restored"),
    );
    const password = random(); // Ephemeral, never persisted or printed.
    const envelope = await timed("exportAndEncryptSyntheticState", async () =>
      seal(await context.storageState(), password),
    );
    assert.ok(
      !JSON.stringify(envelope).includes("synthetic-not-an-osu-cookie"),
    );
    report.encryptedWithExistingVault = true;
    stage = "closeFirstBrowser";
    await close(first);

    // Free accounts allow one new browser per 20 seconds. No session is kept idle.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 21_000 - (Date.now() - createdAt))),
    );
    stage = "restoredBrowser";
    const second = await launch();
    assert.notEqual(first, second);
    report.separateBrowserInstances = true;
    const restored = await timed("decryptAndRestoreSyntheticState", async () =>
      browser.newContext({
        storageState: await unseal(envelope, password),
      }),
    );
    const restoredPage = await fixturePage(restored);
    assert.equal(
      await restoredPage.evaluate(() =>
        localStorage.getItem("synthetic-storage"),
      ),
      "restored",
    );
    const cookies = await restored.cookies(fixture);
    assert.ok(
      cookies.some(
        (c) =>
          c.name === "synthetic_session" &&
          c.value === "synthetic-not-an-osu-cookie" &&
          c.httpOnly,
      ),
    );
    assert.ok(
      !(await restoredPage.evaluate(() => document.cookie)).includes(
        "synthetic_session",
      ),
    );
    report.httpOnlyCookieRestored = true;
    report.localStorageRestored = true;
    stage = "closeRestoredBrowser";
    await close(second);
    report.success = true;
  }
} catch (error) {
  report.success = false;
  report.failedStage = stage;
  // Child-process errors can embed signed URLs/tokens. Inspect only for these
  // fixed categories; never serialize the error, stdout or stderr.
  const details = String(error?.stderr ?? "") + String(error?.stdout ?? "");
  if (/Browser time limit exceeded for today/i.test(details))
    report.error = "dailyBrowserBudgetExceeded";
  else if (/\b429\b|too many requests/i.test(details))
    report.error = "cloudflareRateLimited";
} finally {
  try {
    await browser?.close();
  } catch {
    /* Cleanup continues via HTTP. */
  }
  const remaining = owned.size;
  if (!(await client.cleanup())) report.cleanupFailed = true;
  else report.closed += remaining;
  await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
if (!report.success || report.cleanupFailed) process.exitCode = 1;
