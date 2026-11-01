// Opt-in operator lab, never a production route. Account holder signs in directly.
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "playwright-core";
import { random, seal, unseal } from "../worker/crypto.ts";
import {
  createBrowserClient,
  createLocalBrowserClient,
} from "./carmen-browser-client.mjs";
import { probeCarmen } from "./verify-carmen-session.mjs";

const origin = "https://osu.instructure.com";
const ownPath = fileURLToPath(import.meta.url);
const fault = (code) => Object.assign(new Error(code), { code });
const maxBytes = 2_000_000;
const maxAge = 48 * 60 * 60 * 1000;
const week = 7 * 24 * 60 * 60 * 1000;

export async function labDirectory(path, create = false) {
  if (!isAbsolute(path)) throw fault("absolutePrivateDirectoryRequired");
  if (create) await mkdir(path, { mode: 0o700 }); // Existing directory is never adopted.
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.mode & 0o077 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw fault("privateOwnerOnlyDirectoryRequired");
  const actual = await realpath(path);
  const appRoot = await realpath(
    fileURLToPath(new URL("../", import.meta.url)),
  );
  const root = await realpath(join(appRoot, "..")).catch(() => appRoot);
  const location = relative(root, actual);
  if (!location || (!location.startsWith("../") && !isAbsolute(location)))
    throw fault("labMustBeOutsideProject");
  return actual;
}

export async function privateRead(directory, name) {
  const file = await open(
    join(directory, name),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size > maxBytes ||
      info.mode & 0o077 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw fault("privateFileRequired");
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

export function observationFor(report, baselineAt, now = Date.now()) {
  const state = (result) =>
    result?.authenticated === true && !result.error
      ? "accepted"
      : result?.error === "authenticationRejected" || result?.signInRedirect
        ? "signInRequired"
        : result
          ? "inconclusive"
          : "notChecked";
  return {
    version: 1,
    observedAtUTC: new Date(now).toISOString(),
    previousVerifiedAtUTC: new Date(baselineAt).toISOString(),
    idleGapMs: Math.max(0, now - baselineAt),
    initialState: state(report.httpCheck),
    httpStatus:
      Number.isInteger(report.httpCheck?.status) &&
      report.httpCheck.status >= 100 &&
      report.httpCheck.status <= 599
        ? report.httpCheck.status
        : undefined,
    httpDurationMs:
      Number.isFinite(report.httpCheck?.timingsMs?.total) &&
      report.httpCheck.timingsMs.total >= 0
        ? Math.round(report.httpCheck.timingsMs.total)
        : undefined,
    renewalAttempted:
      report.renewal !== undefined ||
      report.timingsMs?.createSessionCLI !== undefined ||
      report.timingsMs?.localBrowserLaunch !== undefined,
    browserRuntime: report.browserRuntime ?? "none",
    renewedState: state(report.renewal),
    renewalDeferred: report.renewalDeferred === true,
    success: report.success === true,
  };
}

export function shouldRenew(result, enabled = true) {
  return (
    enabled &&
    (result.error === "authenticationRejected" ||
      (result.error === "redirectRequiresReview" &&
        result.signInRedirect === true))
  );
}

export function newRenewalStages(carmenSessionRejected = false) {
  return {
    carmenSessionRejected,
    browserLaunched: false,
    osuSignIn: "notObserved",
    duoPageObserved: false,
    duoChallenge: "notObserved",
    credentialsScreenObserved: false,
    humanAction: "notObserved",
    renewalSucceeded: false,
  };
}

// Each confirmed HTTP rejection authorizes at most one explicit recovery.
// Claim before launch so a technical failure/crash cannot cause an auto retry.
export async function claimRenewal(directory, saved, key, now = Date.now()) {
  const lock = join(directory, ".renewal-claim");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") throw fault("renewalAlreadyAttempted");
    throw error;
  }
  try {
    const current = (await loadSession(directory)).saved;
    if (
      current.identity !== saved.identity ||
      current.lastAuthFailure?.at !== saved.lastAuthFailure?.at ||
      !Number.isFinite(current.lastAuthFailure?.at) ||
      current.lastAuthFailure.at > now ||
      current.lastAuthFailure.at < (current.verifiedAt ?? 0)
    )
      throw fault("confirmedAuthenticationFailureRequired");
    if (current.lastAuthFailure.renewalAttemptedAt !== undefined)
      throw fault("renewalAlreadyAttempted");
    const claimed = {
      ...saved,
      lastAuthFailure: { ...current.lastAuthFailure, renewalAttemptedAt: now },
    };
    await saveSession(directory, claimed, key);
    return claimed;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function recordObservation(directory, observation) {
  const file = await open(
    join(directory, "observations.jsonl"),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_APPEND |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size > 5_000_000 ||
      info.mode & 0o077 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw fault("privateFileRequired");
    await file.write(JSON.stringify(observation) + "\n");
  } finally {
    await file.close();
  }
}

export async function saveSession(directory, value, key) {
  return saveEncrypted(directory, "session.json", value, key);
}

export async function savePending(directory, value, key) {
  return saveEncrypted(directory, "pending.json", value, key);
}

async function saveEncrypted(directory, name, value, key) {
  const temporary = join(directory, "pending-" + random());
  try {
    await writeFile(temporary, JSON.stringify(await seal(value, key)), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, join(directory, name));
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function loadSession(directory, pending = false) {
  const key = await privateRead(directory, "key");
  const saved = await unseal(
    JSON.parse(
      await privateRead(directory, pending ? "pending.json" : "session.json"),
    ),
    key,
  );
  if (
    saved.version !== 1 ||
    (!pending && typeof saved.identity !== "string") ||
    !Number.isFinite(saved.createdAt) ||
    saved.createdAt > Date.now() ||
    (saved.authorizedUntil !== undefined &&
      (!Number.isFinite(saved.authorizedUntil) ||
        saved.authorizedUntil <= saved.createdAt ||
        saved.authorizedUntil - saved.createdAt > week)) ||
    Date.now() > (saved.authorizedUntil ?? saved.createdAt + maxAge) ||
    !Array.isArray(saved.state?.cookies) ||
    !Array.isArray(saved.state?.origins)
  )
    throw fault("invalidOrExpiredLabState");
  return { key, saved };
}

export function scopeState(state) {
  const allowed = (hostname) =>
    hostname === "osu.instructure.com" ||
    hostname === "webauth.service.ohio-state.edu" ||
    /^[a-z0-9-]+\.duosecurity\.com$/.test(hostname);
  return {
    cookies: state.cookies.filter(
      (c) =>
        allowed(c.domain.replace(/^\./, "")) ||
        [
          "service.ohio-state.edu",
          "ohio-state.edu",
          "duosecurity.com",
        ].includes(c.domain.replace(/^\./, "")),
    ),
    origins: state.origins.filter((o) => {
      try {
        const u = new URL(o.origin);
        return u.protocol === "https:" && allowed(u.hostname);
      } catch {
        return false;
      }
    }),
  };
}

// Playwright manages cookie scope and Set-Cookie rotation for ordinary HTTP reads.
// Its API client buffers a body; reject advertised oversize before buffering and
// cap unadvertised size before conversion/JSON parsing. Never expose the body.
export function managedFetcher(api, timeoutMs = 15_000) {
  return async (url) => {
    if (
      ![
        origin + "/api/v1/users/self/profile",
        origin +
          "/api/v1/courses?enrollment_type=student&include[]=total_scores&per_page=100",
      ].includes(url)
    )
      throw fault("unexpectedLabRequest");
    let response;
    try {
      response = await api.get(url, {
        headers: { Accept: "application/json" },
        maxRedirects: 0,
        maxRetries: 0,
        timeout: Math.max(1, Math.min(15_000, timeoutMs)),
        failOnStatusCode: false,
      });
    } catch (error) {
      // Playwright errors can contain cookies in their call logs. Only retain a
      // fixed category; never print/store the message or raw exception.
      const message = String(error?.message ?? "");
      throw Object.assign(fault("networkUnavailable"), {
        networkReason: /closed|disposed|destroyed/i.test(message)
          ? "contextClosed"
          : /timeout|ETIMEDOUT/i.test(message)
            ? "timeout"
            : /certificate|CERT_/i.test(message)
              ? "tls"
              : /ENOTFOUND|EAI_AGAIN/i.test(message)
                ? "dns"
                : /ECONNRESET|ECONNREFUSED|socket/i.test(message)
                  ? "connection"
                  : "unclassified",
      });
    }
    try {
      // headers() folds multiple Set-Cookie fields with newlines, which Fetch
      // Headers correctly rejects. Preserve the individual header fields.
      const headers = new Headers(
        response.headersArray().map(({ name, value }) => [name, value]),
      );
      if (Number(headers.get("content-length")) > maxBytes)
        throw fault("responseTooLarge");
      const body = await response.body();
      if (body.byteLength > maxBytes) throw fault("responseTooLarge");
      return new Response(
        [204, 205, 304].includes(response.status()) ? null : body,
        { status: response.status(), headers },
      );
    } finally {
      await response.dispose();
    }
  };
}

export async function readAccount(api, saved, grades, timeoutMs = 15_000) {
  let identity;
  const report = await probeCarmen({
    managedCookies: true,
    consent: true,
    grades,
    timing: true,
    expectedIdentity: saved?.identity,
    onIdentity: (value) => {
      identity = value;
    },
    fetcher: managedFetcher(api, timeoutMs),
  });
  return { report, identity };
}

// Inspect only fixed gate booleans. Never read form values, page text, names,
// URLs into logs, click a policy/MFA control, or infer Duo from a timeout alone.
export async function humanGate(page) {
  try {
    const url = new URL(page.url());
    if (
      url.origin === origin &&
      (await page
        .getByRole("heading", { name: /acceptable use policy/i })
        .first()
        .isVisible())
    )
      return "policy";
    for (const frame of page.frames()) {
      const host = new URL(frame.url()).hostname;
      if (
        /^[a-z0-9-]+\.duosecurity\.com$/.test(host) &&
        (await frame
          .getByText(
            /verify your identity|check for a duo push|choose an authentication|enter.*passcode|log in with duo|approve.*duo/i,
          )
          .first()
          .isVisible())
      )
        return "duo";
    }
    if (
      ["webauth.service.ohio-state.edu", "osu.instructure.com"].includes(
        url.hostname,
      ) &&
      (await page.locator('input[type="password"]').first().isVisible())
    )
      return "credentials";
    if (
      ["webauth.service.ohio-state.edu", "osu.instructure.com"].includes(
        url.hostname,
      ) &&
      (await page
        .getByRole("heading", {
          name: /terms of use|terms and conditions|additional verification|action required|change your password/i,
        })
        .first()
        .isVisible()) &&
      (await page
        .locator('button[type="submit"], input[type="submit"]')
        .first()
        .isVisible())
    )
      return "other";
  } catch {
    /* Unsupported/changed page or navigation: inconclusive, not Duo. */
  }
  return undefined;
}

export async function attemptRenewal({
  browser,
  saved,
  grades = false,
  interactive = false,
  handoff = async () => {},
  deadlineMs = 25_000,
  read = readAccount,
  onStage = () => {},
  signal,
  createRequest = (state) => request.newContext({ storageState: state }),
  onPendingState = async () => {},
  stages = newRenewalStages(),
  clock = () => performance.now(),
  pause = () => new Promise((done) => setTimeout(done, 1000)),
}) {
  const began = clock();
  if (signal?.aborted) throw fault("cancelled");
  onStage("restoreBrowserState");
  // Initial handoff uses only this newly created browser's fresh default context;
  // silent restoration remains isolated in a new browser context.
  const context =
    interactive && !saved
      ? browser.contexts()[0]
      : await browser.newContext(saved ? { storageState: saved.state } : {});
  const page = await context.newPage();
  const observeURL = (value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return;
      if (
        url.hostname === "webauth.service.ohio-state.edu" &&
        stages.osuSignIn === "notObserved"
      )
        stages.osuSignIn = "reached";
      if (/^[a-z0-9-]+\.duosecurity\.com$/.test(url.hostname))
        stages.duoPageObserved = true;
    } catch {
      /* Never persist a URL or exception. */
    }
  };
  page.on?.("framenavigated", (frame) => observeURL(frame.url()));
  const cutoff = clock() + deadlineMs;
  // Only normal navigation and fixed human-gate checks. Never fill or click.
  onStage("normalSignInNavigation");
  await page.goto(origin + "/", {
    waitUntil: "domcontentloaded",
    timeout: Math.max(1, Math.min(20_000, cutoff - clock())),
  });
  let handoffState = interactive ? "pending" : "done";
  if (interactive) {
    onStage("generatePrivateHandoff");
    const cdp = await context.newCDPSession(page);
    const view = await cdp.send("Cloudflare.getLiveView", {
      mode: "tab",
      expiresInMs: 300_000,
    });
    const live = new URL(view.devtoolsFrontendUrl);
    if (
      live.protocol !== "https:" ||
      live.hostname !== "live.browser.run" ||
      live.searchParams.get("mode") !== "tab"
    )
      throw fault("invalidLiveView");
    cdp.once("Cloudflare.handoffComplete", (event) => {
      handoffState = event.success === true ? "done" : "failed";
    });
    await cdp.send("Cloudflare.handoff", {
      instructions:
        "Complete OSU sign-in and any first-use screens yourself. Review any policy yourself. Select Done only when Carmen is ready; select Failed to stop. The test will then perform only the agreed read-only check.",
      timeout: Math.max(1, Math.round(cutoff - clock())),
    });
    await handoff(live.href);
  }
  onStage("awaitVerifiedAccount");
  let gateCandidate, gateSeenAt;
  while (clock() < cutoff && !signal?.aborted) {
    if (handoffState === "failed")
      return {
        report: { authenticated: false, error: "humanSignInRequired" },
        renewalMs: Math.round(clock() - began),
      };
    // Human interaction happens only in Cloudflare Live View. URL checks keep
    // the short handoff browser alive, without periodic Carmen HTTP traffic.
    const url = new URL(page.url());
    observeURL(url.href);
    const reason = await humanGate(page);
    if (reason === "duo") stages.duoChallenge = "observed";
    if (reason === "credentials") stages.credentialsScreenObserved = true;
    if (reason) {
      if (gateCandidate !== reason) {
        gateCandidate = reason;
        gateSeenAt = clock();
      }
      // Give ordinary SSO redirects a chance to leave a transient gate. A
      // stable prompt is evidence; a timeout or merely visiting Duo is not.
      if (
        (!interactive || handoffState === "done") &&
        clock() - gateSeenAt >= 1000
      ) {
        stages.humanAction = reason;
        if (reason === "credentials") stages.osuSignIn = "credentialsRequested";
        return {
          report: {
            authenticated: false,
            error: "humanSignInRequired",
            humanReason: reason,
          },
          renewalMs: Math.round(clock() - began),
        };
      }
    } else gateCandidate = undefined;
    if (
      !reason &&
      handoffState === "done" &&
      url.origin === origin &&
      !/^\/(?:login|logout)(?:\/|$)/.test(url.pathname)
    ) {
      // Verify with the same ordinary HTTP client used by later checks, rather
      // than coupling the identity request to a navigating browser context.
      const state = scopeState(await context.storageState());
      // Preserve the human-completed login privately even if the subsequent
      // diagnostic transport fails. This is not an activated/verified account.
      await onPendingState(state);
      const api = await createRequest(state);
      try {
        const result = await read(api, saved, grades, cutoff - clock());
        if (result.report.authenticated && !result.report.error) {
          stages.renewalSucceeded = true;
          if (!interactive && stages.osuSignIn === "reached")
            stages.osuSignIn = "continuedSilently";
          return {
            ...result,
            state: scopeState({
              ...state,
              cookies: (await api.storageState()).cookies,
            }),
            renewalMs: Math.round(clock() - began),
          };
        }
        return {
          report: result.report,
          renewalMs: Math.round(clock() - began),
        };
      } finally {
        await api.dispose();
      }
    }
    // CDP is cloud-browser activity, not Carmen keepalive or OSU idle evasion.
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send("Browser.getVersion");
    } finally {
      await cdp.detach();
    }
    await pause();
  }
  return {
    report: {
      authenticated: false,
      error: signal?.aborted
        ? "cancelled"
        : interactive
          ? "humanSignInRequired"
          : "renewalInconclusive",
    },
    renewalMs: Math.round(clock() - began),
  };
}

const safeErrors = new Set([
  "cancelled",
  "absolutePrivateDirectoryRequired",
  "privateOwnerOnlyDirectoryRequired",
  "labMustBeOutsideProject",
  "privateFileRequired",
  "invalidOrExpiredLabState",
  "invalidLiveView",
  "gradePermissionRequired",
  "labAlreadyExists",
  "confirmedAuthenticationFailureRequired",
  "renewalAlreadyAttempted",
]);
const htmlEscape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--consent")) {
    console.log(JSON.stringify({ error: "accountHolderPermissionRequired" }));
    process.exitCode = 1;
    return;
  }
  const [mode, path, ...flags] = args;
  if (
    !["start", "check", "renew", "reconnect", "authorize"].includes(mode) ||
    !path ||
    flags.some(
      (flag) =>
        ![
          "--consent",
          "--grades",
          "--no-renew",
          "--local-browser",
          "--week",
        ].includes(flag),
    ) ||
    (["start", "reconnect"].includes(mode) &&
      (flags.includes("--no-renew") || flags.includes("--local-browser"))) ||
    (["check", "renew", "reconnect"].includes(mode) &&
      flags.includes("--week")) ||
    (mode === "renew" && flags.includes("--no-renew")) ||
    (mode === "authorize" &&
      flags.some((f) => !["--consent", "--week", "--grades"].includes(f)))
  ) {
    console.log(
      JSON.stringify({
        error: "useStartOrCheckWithPrivateDirectoryAndConsent",
      }),
    );
    process.exitCode = 1;
    return;
  }
  process.umask(0o077);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let directory, client, api;
  const report = {
    accountDataPrinted: false,
    productionChanged: false,
    timingsMs: {},
  };
  let stage = "privateLabSetup";
  let baselineAt;
  let observedAt;
  let recoveryBegan;
  const timed = async (label, operation) => {
    const began = performance.now();
    try {
      return await operation();
    } finally {
      (report.timingsMs[label] ??= []).push(
        Math.round(performance.now() - began),
      );
    }
  };
  try {
    directory = await labDirectory(path, mode === "start");
    let key, saved;
    if (mode === "start") {
      key = random();
      await writeFile(join(directory, "key"), key, { mode: 0o600, flag: "wx" });
    } else {
      try {
        ({ key, saved } = await loadSession(directory));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        ({ key, saved } = await loadSession(directory, true));
        report.resumedPendingSession = true;
      }
      if (mode === "authorize") {
        if (report.resumedPendingSession)
          throw fault("invalidOrExpiredLabState");
        await saveSession(
          directory,
          {
            ...saved,
            authenticationId: saved.authenticationId ?? random(),
            authorizedUntil: flags.includes("--week")
              ? saved.createdAt + week
              : saved.authorizedUntil,
            gradesPermitted:
              saved.gradesPermitted || flags.includes("--grades"),
          },
          key,
        );
        report.success = true;
        report.authorizationUpdated = true;
        return; // Explicit local authorization only; no provider request.
      }
      if (flags.includes("--grades") && !saved.gradesPermitted)
        throw fault("gradePermissionRequired");
    }
    const createdAt = saved?.createdAt ?? Date.now();
    const metadata = {
      createdAt,
      authenticationId: saved?.authenticationId ?? random(),
      authorizedUntil:
        saved?.authorizedUntil ??
        createdAt + (flags.includes("--week") ? week : maxAge),
    };
    if (mode === "check") {
      baselineAt = saved.verifiedAt ?? saved.createdAt;
      api = await request.newContext({ storageState: saved.state });
      const result = await readAccount(api, saved, flags.includes("--grades"));
      observedAt = Date.now();
      report.httpCheck = result.report;
      if (result.report.authenticated && !result.report.error) {
        await saveSession(
          directory,
          {
            ...saved,
            identity: result.identity,
            state: scopeState({
              ...saved.state,
              cookies: (await api.storageState()).cookies,
            }),
            verifiedAt: Date.now(),
            lastAuthFailure: undefined,
            courseTotalsVerifiedAt: flags.includes("--grades")
              ? Date.now()
              : saved.courseTotalsVerifiedAt,
          },
          key,
        );
        await rm(join(directory, "pending.json"), { force: true });
        report.success = true;
        return;
      }
      if (shouldRenew(result.report)) {
        saved = { ...saved, lastAuthFailure: { at: observedAt } };
        await saveSession(directory, saved, key);
      }
      if (!shouldRenew(result.report, !flags.includes("--no-renew"))) {
        if (flags.includes("--no-renew")) report.renewalDeferred = true;
        report.success = false;
        return;
      }
      // Preserve rotated cookie state from the rejected read for normal SSO.
      saved.state = scopeState({
        ...saved.state,
        cookies: (await api.storageState()).cookies,
      });
    }
    if (mode === "renew" || mode === "check")
      saved = await claimRenewal(directory, saved, key);
    report.renewalStages = newRenewalStages(
      mode === "renew" || mode === "check",
    );
    recoveryBegan = performance.now();
    report.browserRuntime = flags.includes("--local-browser")
      ? "vm-local"
      : "cloudflare";
    client = flags.includes("--local-browser")
      ? createLocalBrowserClient(timed)
      : createBrowserClient(directory, timed);
    stage = "cloudBrowserLaunch";
    const { browser } = await client.open();
    report.renewalStages.browserLaunched = true;
    const interactive = ["start", "reconnect"].includes(mode);
    const result = await attemptRenewal({
      browser,
      saved,
      grades: flags.includes("--grades"),
      interactive,
      deadlineMs: interactive ? 240_000 : 25_000,
      stages: report.renewalStages,
      signal: controller.signal,
      onPendingState: async (state) => {
        await savePending(
          directory,
          {
            version: 1,
            ...metadata,
            identity: saved?.identity,
            state,
            gradesPermitted:
              saved?.gradesPermitted ?? flags.includes("--grades"),
          },
          key,
        );
        report.encryptedPendingStateSaved = true;
      },
      onStage: (next) => {
        stage = next;
      },
      handoff: async (url) => {
        const file = join(directory, "login.html");
        await writeFile(
          file,
          '<!doctype html><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'"><title>Private Carmen test</title><h1>Private Carmen session test</h1><p>The account holder signs in directly, including MFA and any first-use policy decision. Select Done in the browser view only after Carmen is ready. The script waits for Done before checking the profile. This link grants access to the test browser; keep it private.</p><p><a rel="noreferrer" href="' +
            htmlEscape(url) +
            '">Open private OSU sign-in</a></p><p>The session closes after four minutes. No password is saved. Only agreed self-account reads and encrypted OSU/Carmen/Duo state are retained until ' +
            new Date(metadata.authorizedUntil).toISOString() +
            ". Later checks refuse expired state. Delete the private directory after testing; expiration does not erase the files automatically.</p>",
          { mode: 0o600, flag: "wx" },
        );
        console.log(
          JSON.stringify({
            awaitingAccountHolder: true,
            privateInstructionsFile: file,
            timeoutSeconds: 240,
          }),
        );
      },
    });
    report.renewal = result.report;
    report.timingsMs.renewal = [result.renewalMs];
    if (result.state && result.identity) {
      await saveSession(
        directory,
        {
          version: 1,
          ...metadata,
          identity: result.identity,
          verifiedAt: Date.now(),
          courseTotalsVerifiedAt: flags.includes("--grades")
            ? Date.now()
            : saved?.courseTotalsVerifiedAt,
          gradesPermitted: saved?.gradesPermitted ?? flags.includes("--grades"),
          state: result.state,
        },
        key,
      );
      report.encryptedStateSaved = true;
      await rm(join(directory, "pending.json"), { force: true });
      report.success = true;
    } else report.success = false;
  } catch (error) {
    report.success = false;
    report.failedStage = stage;
    const details =
      String(error?.message ?? "") +
      String(error?.stderr ?? "") +
      String(error?.stdout ?? "");
    report.error = safeErrors.has(error?.code)
      ? error.code
      : error?.code === "ENOENT" &&
          stage === "privateLabSetup" &&
          mode !== "start"
        ? "privateLabStateMissing"
        : error?.code === "EEXIST"
          ? "labAlreadyExists"
          : /Browser time limit exceeded for today/i.test(details)
            ? "dailyBrowserBudgetExceeded"
            : /\b429\b|too many requests/i.test(details)
              ? "cloudflareRateLimited"
              : "labFailed";
  } finally {
    if (client && !(await client.cleanup())) report.cleanupFailed = true;
    if (recoveryBegan !== undefined)
      report.timingsMs.browserRecoveryTotal = [
        Math.round(performance.now() - recoveryBegan),
      ];
    await api?.dispose().catch(() => {});
    if (directory) {
      await rm(join(directory, "login.html"), { force: true });
      await rm(join(directory, "wrangler.log"), { force: true });
      if (baselineAt !== undefined && observedAt !== undefined) {
        const observation = observationFor(report, baselineAt, observedAt);
        try {
          await recordObservation(directory, observation);
          report.observationLogSaved = true;
        } catch {
          report.observationLogSaved = false;
        }
        report.observation = observation;
      }
      if (mode === "renew" && report.renewalStages) {
        try {
          await recordObservation(directory, {
            version: 1,
            event: "separateRenewal",
            observedAtUTC: new Date().toISOString(),
            stages: report.renewalStages,
            error: report.error ?? report.renewal?.error ?? null,
            success: report.success === true,
            timingsMs: report.timingsMs,
          });
          report.observationLogSaved = true;
        } catch {
          report.observationLogSaved = false;
        }
      }
    }
    console.log(JSON.stringify(report));
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    if (!report.success || report.cleanupFailed) process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => "")) === ownPath
)
  await main();
