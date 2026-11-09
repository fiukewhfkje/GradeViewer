import { chromium, webkit } from "playwright-core";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
const port = 8901,
  base = `https://localhost:${port}`,
  engine = process.env.GRADEVIEWER_BROWSER ?? "chromium",
  directory =
    engine === "webkit" ? ".local-test/e2e-webkit" : ".local-test/e2e";
assert.ok(["chromium", "webkit"].includes(engine));
// Secure host cookies must be tested over HTTPS: WebKit correctly rejects
// __Host- cookies over plain HTTP, including the localhost exception in Chromium.
// This CA is confined to this synthetic loopback test process and its children.
if (!process.env.GRADEVIEWER_TEST_TLS_CERT) {
  const tls = resolve(".local-test/e2e-tls");
  await mkdir(tls, { recursive: true });
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout",
      tls + "/localhost.key",
      "-out",
      tls + "/localhost.crt",
    ],
    { stdio: "ignore" },
  );
  const originalCA = process.env.NODE_EXTRA_CA_CERTS
    ? await readFile(process.env.NODE_EXTRA_CA_CERTS, "utf8")
    : "";
  await writeFile(
    tls + "/trusted-ca.pem",
    originalCA + "\n" + (await readFile(tls + "/localhost.crt", "utf8")),
  );
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: tls + "/trusted-ca.pem",
      GRADEVIEWER_TEST_TLS_CERT: tls + "/localhost.crt",
      GRADEVIEWER_TEST_TLS_KEY: tls + "/localhost.key",
    },
  });
  process.exit(child.status ?? 1);
}
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
let server,
  browser,
  log = "",
  completed = 0,
  originalDeployment;
async function start() {
  log = "";
  server = spawn(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--config",
      "wrangler.test.jsonc",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--local-protocol",
      "https",
      "--https-cert-path",
      process.env.GRADEVIEWER_TEST_TLS_CERT,
      "--https-key-path",
      process.env.GRADEVIEWER_TEST_TLS_KEY,
      "--persist-to",
      directory + "/state",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (b) => {
      log += b;
    });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/status")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Worker emulator did not start: " + log.slice(-1000));
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  let timer;
  try {
    await Promise.race([
      new Promise((r) => server.once("exit", r)),
      new Promise((r) => {
        timer = setTimeout(r, 4000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function openConnection(page, title) {
  const summary = page
    .locator(".settings-provider > summary")
    .filter({ hasText: title });
  if (!(await summary.evaluate((node) => node.parentElement.open)))
    await summary.click();
}
async function completeCarmenSignIn(page, client) {
  await page
    .getByRole("link", { name: "Open CarmenCanvas", exact: true })
    .click();
  await client.post(base + "/api/fixture/carmen", { data: { signedIn: true } });
  await page
    .getByRole("button", { name: "Reconnect CarmenCanvas", exact: true })
    .waitFor();
  await page.waitForFunction(() => !document.querySelector(".portal-progress"));
}
async function check(name, run) {
  const filter = process.env.GRADEVIEWER_E2E_CHECK;
  if (filter && !filter.split(",").some((part) => name.includes(part.trim())))
    return;
  let timer;
  const started = performance.now();
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out: " + name)),
          60000,
        );
      }),
    ]);
    completed++;
    console.log(`PASS ${name} (${Math.round(performance.now() - started)} ms)`);
  } finally {
    clearTimeout(timer);
  }
}
// Hold the response until the UI assertion completes instead of sleeping for
// seconds and hoping a slow CI runner reaches the assertion before it arrives.
async function holdRequest(page, pattern) {
  let release, received;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const seen = new Promise((resolve) => {
    received = resolve;
  });
  const running = new Set();
  const handler = (route) => {
    const task = (async () => {
      received();
      await gate;
      await route.continue();
    })();
    running.add(task);
    return task.finally(() => running.delete(task));
  };
  await page.route(pattern, handler);
  return {
    received: seen,
    release,
    close: async () => {
      release();
      await Promise.all([...running]);
      await page.unroute(pattern, handler);
    },
  };
}
async function holdFixture(client, kind) {
  const url = base + "/api/fixture/gate?kind=" + kind;
  await client.post(url, { data: { held: true } });
  return {
    received: async () => {
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        if ((await (await client.get(url)).json()).waiting) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Fixture did not receive " + kind + " request");
    },
    release: () => client.post(url, { data: { held: false } }),
    close: () => client.post(url, { data: { held: false } }),
  };
}
try {
  await start();
  const publicKey = execFileSync("openssl", [
    "x509",
    "-in",
    process.env.GRADEVIEWER_TEST_TLS_CERT,
    "-pubkey",
    "-noout",
  ]);
  const spki = execFileSync("openssl", ["pkey", "-pubin", "-outform", "DER"], {
    input: publicKey,
  });
  const certificatePin = createHash("sha256").update(spki).digest("base64");
  browser =
    engine === "webkit"
      ? await webkit.launch()
      : await chromium.launch({
          executablePath:
            process.env.CHROMIUM_PATH ??
            (existsSync("/usr/bin/chromium")
              ? "/usr/bin/chromium"
              : chromium.executablePath()),
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--ignore-certificate-errors-spki-list=" + certificatePin,
          ],
        });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      ignoreHTTPSErrors: true,
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("Synthetic page error:", e.message);
  });
  await check("private API and security headers", async () => {
    const diagnosticsURL = base + "/api/carmen/diagnostics";
    assert.equal((await fetch(diagnosticsURL)).status, 401);
    const operatorHeaders = {
      Authorization:
        "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const diagnostic = await fetch(diagnosticsURL, {
      headers: operatorHeaders,
    });
    assert.equal(diagnostic.status, 200);
    assert.deepEqual(await diagnostic.json(), { diagnostics: null });
    const forbiddenWrite = await fetch(base + "/api/carmen/disconnect", {
      method: "POST",
      headers: {
        ...operatorHeaders,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(forbiddenWrite.status, 401);
    assert.equal(
      (
        await fetch(base + "/api/carmen/compatibility", {
          headers: operatorHeaders,
        })
      ).status,
      401,
    );
    const icDiagnosticURL = base + "/api/campus/diagnostics";
    assert.equal((await fetch(icDiagnosticURL)).status, 401);
    const icDiagnostic = await fetch(icDiagnosticURL, {
      headers: operatorHeaders,
    });
    assert.equal(icDiagnostic.status, 200);
    assert.deepEqual(await icDiagnostic.json(), { diagnostics: null });
    const shell = await fetch(base);
    assert.match(
      shell.headers.get("Content-Security-Policy"),
      /default-src 'self'/,
    );
    assert.equal(shell.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(shell.headers.get("Cache-Control"), "no-cache");
    const installation = await (
      await fetch(base + "/installation.json")
    ).json();
    assert.equal("repository" in installation, false);
    assert.equal("branch" in installation, false);
    const r = await fetch(base + "/api/scan/start", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(r.status, 401);
    assert.match(
      r.headers.get("Content-Security-Policy"),
      /frame-ancestors 'none'/,
    );
    assert.equal(r.headers.get("Cache-Control"), "no-store");
  });
  await check("owner unlock and complete Schoology connection", async () => {
    await page.goto(base);
    await page
      .getByLabel("App password", { exact: true })
      .fill("synthetic-owner-password-for-tests-only");
    await page.getByRole("button", { name: "Unlock app", exact: true }).click();
    await page.getByLabel("Schoology API key", { exact: true }).waitFor();
    assert.equal(await page.getByText("Set up", { exact: true }).count(), 3);
    await openConnection(page, "Infinite Campus");
    assert.equal(
      await page
        .getByRole("button", { name: "Connect Infinite Campus", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByText("Connect Schoology first to add Infinite Campus classes.")
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Reconnect Infinite Campus", exact: true })
        .count(),
      0,
    );
    await page.getByLabel("Schoology API key", { exact: true }).fill("fixture");
    await page
      .getByLabel("Schoology API secret", { exact: true })
      .fill("fixture-secret");
    await page
      .getByRole("button", { name: "Connect Schoology", exact: true })
      .click();
    await page
      .locator(".courses")
      .getByRole("button", { name: /AP Biology/ })
      .waitFor();
    assert.equal(await page.locator(".course").count(), 5);
    await page.screenshot({ path: directory + "/home-light.png" });
  });
  await check(
    "Settings stays contained across phone, split view, laptop and monitor sizes",
    async () => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      assert.doesNotMatch(
        await page.locator(".profile").innerText(),
        /Grades stay on this device|Your private app/,
      );
      const sizes = [
        [320, 568],
        [360, 780],
        [390, 844],
        [600, 800],
        [768, 1024],
        [900, 700],
        [1024, 768],
        [1280, 800],
        [1440, 900],
        [1920, 1080],
        [2560, 1440],
        [3840, 2160],
      ];
      for (const theme of ["light", "dark"]) {
        await page.getByLabel("Theme", { exact: true }).selectOption(theme);
        for (const [width, height] of sizes) {
          await page.setViewportSize({ width, height });
          await page.locator(".app-scroll").evaluate((e) => e.scrollTo(0, 0));
          const result = await page.evaluate(() => {
            const profile = document.querySelector(".profile"),
              p = profile.getBoundingClientRect();
            const cards = [...document.querySelectorAll(".settings-card")].map(
              (e) => e.getBoundingClientRect(),
            );
            const headings = [
              ...document.querySelectorAll(".connection-heading"),
            ];
            const overlaps = headings.some((h) => {
              const nodes = [...h.children].map((e) =>
                e.getBoundingClientRect(),
              );
              return nodes.some((a, i) =>
                nodes
                  .slice(i + 1)
                  .some(
                    (b) =>
                      Math.min(a.right, b.right) >
                        Math.max(a.left, b.left) + 1 &&
                      Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1,
                  ),
              );
            });
            const controls = [
              ...profile.querySelectorAll("button,input,select,a"),
            ].filter((e) => e.getBoundingClientRect().width > 0);
            return {
              overflow:
                profile.scrollWidth > profile.clientWidth + 1 ||
                cards.some(
                  (r) =>
                    r.left < p.left - 1 ||
                    r.right > p.right + 1 ||
                    r.left < 0 ||
                    r.right > innerWidth + 1,
                ),
              overlaps,
              wide: p.width > 1041,
              smallControls: controls
                .filter((e) => e.getBoundingClientRect().height < 32)
                .map((e) => [
                  e.textContent.trim(),
                  e.getBoundingClientRect().height,
                ]),
            };
          });
          assert.equal(result.overflow, false, `${theme} ${width}: overflow`);
          assert.equal(
            result.overlaps,
            false,
            `${theme} ${width}: heading overlap`,
          );
          assert.equal(result.wide, false);
          assert.deepEqual(
            result.smallControls,
            [],
            `${theme} ${width}: small controls`,
          );
          await page.evaluate(
            () =>
              new Promise((r) =>
                requestAnimationFrame(() => requestAnimationFrame(r)),
              ),
          );
          await page.screenshot({
            path: `${directory}/settings-${width}-${theme}.png`,
          });
        }
      }
      await openConnection(page, "Schoology");
      await page
        .getByRole("button", { name: "Update connection", exact: true })
        .click();
      for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () =>
              document.querySelector(".profile").scrollWidth <=
              document.querySelector(".profile").clientWidth + 1,
          ),
          true,
        );
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        await page.screenshot({
          path: `${directory}/settings-form-${width}.png`,
        });
      }
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    },
  );
  await check(
    "returning startup shows saved grades during a slow refresh with one status check",
    async () => {
      await page.waitForFunction(
        () => !document.querySelector(".desktop-refresh")?.disabled,
      );
      const held = await holdFixture(context.request, "provider");
      let statuses = 0,
        scans = 0;
      const count = (request) => {
        if (request.url().endsWith("/api/status")) statuses++;
        if (request.url().endsWith("/api/scan/start")) scans++;
      };
      page.on("request", count);
      try {
        const started = performance.now();
        await page.reload();
        await page
          .locator(".courses")
          .getByRole("button", { name: /AP Biology/ })
          .waitFor({ timeout: 1800 });
        const visibleMs = Math.round(performance.now() - started);
        await held.received();
        assert.equal(await page.locator(".gate").count(), 0);
        assert.equal(await page.locator(".refresh-status").count(), 0);
        await page
          .locator(".courses")
          .getByRole("button", { name: /AP Biology/ })
          .click();
        await page.getByRole("slider").press("End");
        await held.release();
        await page.waitForFunction(
          () => !document.querySelector(".desktop-refresh")?.disabled,
        );
        assert.equal(await page.locator(".chart-tooltip").count(), 1);
        assert.equal(statuses, 1);
        assert.equal(scans, 1);
        console.log(
          `Synthetic returning startup: saved grades visible in ${visibleMs} ms while the fresh scan was held.`,
        );
        await page.getByRole("slider").press("Escape");
        await page.getByLabel("Close course", { exact: true }).click();
      } finally {
        page.off("request", count);
        await held.close();
      }
    },
  );
  await check(
    "cached grades appear before delayed authentication and explicit lock prevents a cached flash",
    async () => {
      let held = await holdFixture(context.request, "status");
      try {
        await page.reload();
        await page
          .locator(".courses")
          .getByRole("button", { name: /AP Biology/ })
          .waitFor({ timeout: 1500 });
        await held.received();
        assert.equal(await page.locator(".gate").count(), 0);
        assert.equal(await page.locator(".refresh-status").count(), 0);
        await held.release();
        await page.waitForFunction(
          () => !document.querySelector(".desktop-refresh")?.disabled,
        );
      } finally {
        await held.close();
      }
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Lock app", exact: true }).click();
      await page.getByLabel("App password", { exact: true }).waitFor();
      await page.unroute("**/api/logout");
      held = await holdFixture(context.request, "status");
      try {
        await page.reload();
        await held.received();
        await page.waitForTimeout(300);
        assert.equal(await page.locator(".course").count(), 0);
        await page.getByLabel("App password", { exact: true }).waitFor();
      } finally {
        await held.close();
      }
      await page
        .getByLabel("App password", { exact: true })
        .fill("synthetic-owner-password-for-tests-only");
      await page
        .getByRole("button", { name: "Unlock app", exact: true })
        .click();
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
    },
  );
  await check(
    "phone pull-to-refresh respects thresholds, cancellation, scrolling and manual refresh rules",
    async () => {
      assert.equal(await page.locator(".desktop-refresh").isVisible(), false);
      const touch =
        engine === "chromium" ? await context.newCDPSession(page) : undefined;
      let scans = 0,
        manual = false;
      const request = (r) => {
        if (r.url().endsWith("/api/scan/start")) {
          scans++;
          manual = r.postDataJSON().refreshMetadata === true;
        }
      };
      page.on("request", request);
      let pullY = 170;
      const send = (type, x = 30, offset = 0) => {
        const y = pullY + offset;
        return touch
          ? touch.send("Input.dispatchTouchEvent", {
              type,
              touchPoints:
                type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y }],
            })
          : page.evaluate(
              ({ type, x, y }) => {
                const kind = {
                  touchStart: "touchstart",
                  touchMove: "touchmove",
                  touchEnd: "touchend",
                  touchCancel: "touchcancel",
                }[type];
                const target = document.querySelector(".app-scroll"),
                  point = { identifier: 1, clientX: x, clientY: y };
                const event = new Event(kind, {
                  bubbles: true,
                  cancelable: true,
                });
                Object.defineProperty(event, "touches", {
                  value:
                    type === "touchEnd" || type === "touchCancel"
                      ? []
                      : [point],
                });
                target.dispatchEvent(event);
              },
              { type, x, y },
            );
      };
      try {
        await page.evaluate(() =>
          document.querySelector(".app-scroll").scrollTo(0, 0),
        );
        // Begin on a course card, below any controls above the grid.
        pullY = Math.ceil(
          (await page.locator(".courses .course").first().boundingBox()).y + 20,
        );
        await send("touchStart");
        await send("touchMove", 30, 25);
        await send("touchEnd");
        // Dispatch the horizontal case to the app directly: Chromium otherwise
        // turns this into its browser-history navigation gesture.
        await page.evaluate(() => {
          const target = document.querySelector("main");
          for (const [type, x, y] of [
            ["touchstart", 160, 170],
            ["touchmove", 300, 185],
            ["touchend", 300, 185],
          ]) {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, "touches", {
              value:
                type === "touchend"
                  ? []
                  : [{ identifier: 1, clientX: x, clientY: y }],
            });
            target.dispatchEvent(event);
          }
        });
        await send("touchStart");
        await send("touchMove", 30, 160);
        await send("touchCancel");
        await page.waitForTimeout(100);
        assert.equal(scans, 0);
        // A second finger cancels the pull without leaving the content offset.
        await page.evaluate(() => {
          const target = document.querySelector(".app-scroll");
          for (const [type, y, count] of [
            ["touchstart", 170, 1],
            ["touchmove", 330, 1],
            ["touchstart", 330, 2],
            ["touchend", 330, 0],
          ]) {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, "touches", {
              value: Array.from({ length: count }, (_, i) => ({
                identifier: i + 1,
                clientX: 30 + i * 30,
                clientY: y,
              })),
            });
            target.dispatchEvent(event);
          }
        });
        await page.locator('.pull-refresh[data-phase="idle"]').waitFor();
        assert.equal(scans, 0);
        assert.equal(
          await page.locator(".pull-refresh").getAttribute("data-visible"),
          "false",
        );
        await page.setViewportSize({ width: 390, height: 500 });
        await page.evaluate(() =>
          document.querySelector(".app-scroll").scrollTo(0, 100),
        );
        assert.ok(
          await page.evaluate(
            () => document.querySelector(".app-scroll").scrollTop > 0,
          ),
        );
        await send("touchStart");
        await send("touchMove", 30, 160);
        await send("touchEnd");
        assert.equal(scans, 0);
        await page.setViewportSize({ width: 390, height: 844 });
        // Let the preceding native scroll/viewport change finish before the next gesture.
        await page.waitForTimeout(300);
        await page.evaluate(() =>
          document.querySelector(".app-scroll").scrollTo(0, 0),
        );
        await page.waitForTimeout(100);
        await send("touchStart");
        await send("touchMove", 30, 80);
        await send("touchMove", 30, 160);
        await page
          .locator('.pull-refresh[data-phase="pulling"][data-visible="true"]')
          .waitFor();
        assert.equal(await page.locator(".pull-refresh").innerText(), "");
        assert.equal(await page.evaluate(() => scrollY), 0);
        await page.route("**/api/scan/roots", async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 350));
          await route.continue();
        });
        const committed = page.waitForResponse(
          (r) => r.url().endsWith("/api/scan/commit") && r.ok(),
        );
        await send("touchEnd");
        await page.locator('.pull-refresh[data-phase="refreshing"]').waitFor();
        await send("touchStart");
        await send("touchMove", 30, 160);
        await send("touchEnd");
        await committed;
        await page.unroute("**/api/scan/roots");
        await page.waitForFunction(
          () => !document.querySelector(".desktop-refresh")?.disabled,
        );
        await page.locator('.pull-refresh[data-phase="idle"]').waitFor();
        // WebKit can publish the idle state one frame before the CSS transition finishes.
        await page.waitForFunction(
          () =>
            getComputedStyle(document.querySelector(".refresh-content"))
              .transform === "matrix(1, 0, 0, 1, 0, 0)",
        );
        assert.equal(
          await page
            .locator(".refresh-content")
            .evaluate((el) => getComputedStyle(el).transform),
          "matrix(1, 0, 0, 1, 0, 0)",
        );
        assert.equal(scans, 1);
        assert.equal(manual, true);
        assert.equal(await page.locator(".course").count(), 5);
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("button", { name: "Refresh grades", exact: true })
            .isVisible(),
          true,
        );
        await page.getByRole("button", { name: "Grades", exact: true }).click();
      } finally {
        page.off("request", request);
        await touch?.detach();
      }
    },
  );
  async function expandAssignmentGroups() {
    for (const group of await page.locator(".assignment-group").all())
      if (!(await group.evaluate((el) => el.open)))
        await group.locator(":scope > summary").click();
  }
  let cId, assignmentTitle;
  await check(
    "straight-points edits project alongside an official semester override",
    async () => {
      await page
        .locator(".courses")
        .getByRole("button", { name: /Computer Science A/ })
        .click();
      const baseline = await page.locator(".summary .grade").innerText();
      const assignment = page.locator(".assignment").first();
      const menu = assignment.locator(".menu summary");
      const score = assignment.locator(".score");
      const original = await score.innerText();
      await menu.click();
      await page
        .getByRole("button", { name: "Edit Grade", exact: true })
        .click();
      const input = page.getByLabel("Score", { exact: true });
      const initial = await input.inputValue();
      assert.ok(initial.length >= 2);
      assert.deepEqual(
        await input.evaluate((el) => [
          el === document.activeElement,
          el.selectionStart,
          el.selectionEnd,
        ]),
        [true, initial.length, initial.length],
      );
      await page.keyboard.press("Backspace");
      assert.equal(await input.inputValue(), initial.slice(0, -1));
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const whatIf = page.getByLabel("What-If grade", { exact: true });
      await whatIf.waitFor();
      assert.match(await whatIf.innerText(), /What-if · S1/);
      const pointsChange = Number(initial.slice(0, -1)) - Number(initial);
      assert.equal(
        await whatIf.locator(".scenario-delta").innerText(),
        ((pointsChange / 320) * 100 * 0.5).toFixed(2) + "%",
      );
      assert.equal(
        await page.getByText("Teacher override", { exact: true }).count(),
        1,
      );
      assert.match(
        await score.innerText(),
        new RegExp("^" + initial.slice(0, -1) + "/"),
      );
      assert.equal(await page.locator(".summary .grade").innerText(), baseline);
      await menu.click();
      await page
        .getByRole("button", { name: "Drop Assignment", exact: true })
        .click();
      await page.locator(".assignment.dropped").waitFor();
      await menu.click();
      await page
        .getByRole("button", { name: "Reset Assignment", exact: true })
        .click();
      await page.locator(".assignment.dropped").waitFor({ state: "detached" });
      assert.equal(await score.innerText(), original);
      await page.getByLabel("Close course", { exact: true }).click();
    },
  );
  await check(
    "semester GPA settings survive a refresh and reload",
    async () => {
      const card = page.locator(".gpa-card");
      await card.locator("summary").click();
      await card.getByRole("button", { name: "Use Dublin GPA scale" }).click();
      await card.getByRole("button", { name: "Edit courses" }).click();
      const biology = card.getByRole("group", { name: "AP Biology" });
      const creditToggle = card.getByRole("switch", {
        name: "Weight by semester credits",
      });
      await creditToggle.focus();
      await page.keyboard.press("Space");
      assert.equal(await creditToggle.isChecked(), true);
      await biology.getByLabel("Level").selectOption("honors");
      await biology.getByLabel("Semester credits").fill("0.5");
      const physics = card.getByRole("group", { name: "AP Physics 1" });
      await physics.getByText("Exclude from GPA", { exact: true }).click();
      assert.equal(await physics.getByRole("switch").isChecked(), true);
      await card.getByRole("button", { name: "Save GPA settings" }).click();
      await card
        .getByText("Credits needed", { exact: false })
        .first()
        .waitFor();
      assert.match(await card.locator("summary").innerText(), /4\.50 \/ 4\.00/);
      await card
        .getByRole("button", { name: "What-if GPA", exact: true })
        .click();
      const projected = card.getByRole("status", {
        name: "What-if GPA estimate",
      });
      await card
        .getByLabel("What-if grade for AP Biology", { exact: true })
        .selectOption("B+");
      assert.match(await projected.innerText(), /3\.83 \/ 3\.33/);
      assert.match(await card.locator("summary").innerText(), /4\.50 \/ 4\.00/);
      assert.equal(
        await card.getByLabel("What-if grade for AP Physics 1").count(),
        0,
      );
      await page.screenshot({ path: directory + "/semester-gpa-what-if.png" });
      const refreshed = page.waitForResponse(
        (r) => r.url().endsWith("/api/scan/commit") && r.ok(),
      );
      await page.reload();
      await card.getByText("4.50 / 4.00").waitFor();
      await refreshed;
      await card.locator("summary").click();
      await page.screenshot({ path: directory + "/semester-gpa.png" });
      assert.equal(await projected.count(), 0);
      await card.getByRole("button", { name: "Edit courses" }).click();
      assert.equal(await physics.getByRole("switch").isChecked(), true);
      assert.equal(await biology.getByLabel("Level").inputValue(), "honors");
      assert.equal(
        await biology.getByLabel("Semester credits").inputValue(),
        "0.5",
      );
      await card.locator("summary").click();
      await page.waitForFunction(
        () => !document.querySelector(".desktop-refresh")?.disabled,
      );
    },
  );
  await check("same home/detail overall and graph", async () => {
    const homeGrade = await page
      .locator(".courses")
      .getByRole("button", { name: /AP Biology/ })
      .locator(".grade")
      .innerText();
    await page
      .locator(".courses")
      .getByRole("button", { name: /AP Biology/ })
      .click();
    assert.equal(await page.locator(".summary .grade").innerText(), homeGrade);
    assert.ok(await page.locator(".chart-line").first().getAttribute("d"));
    assert.equal(
      await page.locator(".chart svg").getAttribute("preserveAspectRatio"),
      "none",
    );
    assert.equal((await page.locator(".chart").boundingBox()).height, 154);
    assignmentTitle = await page
      .locator(".assignment strong")
      .first()
      .innerText();
    await page.screenshot({ path: directory + "/detail-light.png" });
  });
  await check(
    "native graph selection shows grade/date and clears on release",
    async () => {
      const chart = page.getByRole("slider", { name: "Explore grade history" });
      await chart.focus();
      await chart.press("Home");
      assert.equal(await chart.getAttribute("aria-valuenow"), "0");
      assert.match(
        await page.locator(".chart-tooltip strong").innerText(),
        /^-?\d+\.\d{2}$/,
      );
      await chart.press("ArrowRight");
      assert.equal(await chart.getAttribute("aria-valuenow"), "1");
      await page.screenshot({ path: directory + "/chart-selection-light.png" });
      await chart.press("Escape");
      assert.equal(await page.locator(".chart-tooltip").count(), 0);
      if (engine === "chromium") {
        const touch = await context.newCDPSession(page),
          box = await chart.boundingBox();
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: box.x + 30, y: box.y + 70 }],
        });
        await page.locator(".chart-marker").waitFor();
        const scrollTop = await page
          .locator(".app-scroll")
          .evaluate((node) => node.scrollTop);
        for (const dy of [18, -24, 32, -15]) {
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: box.x + 80, y: box.y + 70 + dy }],
          });
          assert.equal(await page.locator(".chart-tooltip").count(), 1);
        }
        assert.equal(
          await page.locator(".app-scroll").evaluate((node) => node.scrollTop),
          scrollTop,
        );
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: box.x + box.width - 30, y: box.y + 70 }],
        });
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await touch.detach();
        assert.equal(await page.locator(".chart-tooltip").count(), 0);
      }
    },
  );
  await check(
    "a grade saved during foreground refresh retains both the edit and new snapshot",
    async () => {
      await page.getByLabel("Course options", { exact: true }).click();
      await page
        .getByRole("button", { name: "Add Grade", exact: true })
        .click();
      await page
        .getByLabel("Name", { exact: true })
        .fill("Saved while refreshing");
      await page.getByLabel("Score", { exact: true }).fill("12");
      await page.getByLabel("Total points", { exact: true }).fill("10");
      const held = await holdFixture(context.request, "provider");
      const started = Date.now();
      try {
        const refreshing = page.waitForRequest((r) =>
          r.url().endsWith("/api/scan/start"),
        );
        await page.evaluate(() => {
          for (const value of ["hidden", "visible"]) {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value,
            });
            document.dispatchEvent(new Event("visibilitychange"));
          }
        });
        await refreshing;
        await held.received();
        assert.equal(
          await page.getByLabel("Name", { exact: true }).inputValue(),
          "Saved while refreshing",
        );
        await page.getByRole("button", { name: "Add", exact: true }).click();
        await held.release();
        await page
          .getByText("Saved while refreshing", { exact: true })
          .waitFor();
        const fetched = await page.evaluate(
          () =>
            new Promise((resolve) => {
              const request = indexedDB.open("gradeviewer");
              request.onsuccess = () => {
                const read = request.result
                  .transaction("state")
                  .objectStore("state")
                  .get("active");
                read.onsuccess = () => {
                  resolve(
                    Math.max(...read.result.courses.map((c) => c.fetched)),
                  );
                  request.result.close();
                };
              };
            }),
        );
        assert.ok(fetched >= started);
        await page
          .getByLabel("Options for Saved while refreshing", { exact: true })
          .click();
        await page
          .getByRole("button", { name: "Remove Grade", exact: true })
          .click();
        await page
          .getByText("Saved while refreshing", { exact: true })
          .waitFor({ state: "hidden" });
      } finally {
        await held.close();
      }
    },
  );
  await check(
    "signed decimal local edit shared by assignment views",
    async () => {
      await page
        .getByLabel("Options for " + assignmentTitle, { exact: true })
        .click();
      await page
        .getByRole("button", { name: "Edit Grade", exact: true })
        .click();
      await page.getByLabel("Score", { exact: true }).fill("-1.25");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByLabel("What-If grade", { exact: true }).waitFor();
      assert.match(
        await page.locator(".scenario-delta").innerText(),
        /^-\d+\.\d{2}%$/,
      );
      await page
        .getByRole("button", { name: "View All Assignments", exact: true })
        .last()
        .click();
      assert.equal(await page.locator(".assignment-group[open]").count(), 0);
      assert.match(await page.locator(".summary").innerText(), /S1 overall/);
      await page
        .getByRole("heading", { name: "Q2 Grade", exact: true })
        .waitFor();
      await expandAssignmentGroups();
      assert.match(
        (await page.locator(".rows").allInnerTexts()).join("\n"),
        /-1.25/,
      );
      assert.equal(
        await page.getByRole("button", { name: "Q1", exact: true }).count(),
        1,
      );
      assert.equal(
        await page.getByRole("button", { name: "Q2", exact: true }).count(),
        1,
      );
    },
  );
  await check("drop, undrop and reset", async () => {
    await page
      .getByLabel("Options for " + assignmentTitle, { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Drop Assignment", exact: true })
      .click();
    await page.locator(".dropped").waitFor();
    assert.equal(await page.locator(".dropped").count(), 1);
    assert.equal(
      await page
        .locator(".dropped .row-text")
        .evaluate((el) => getComputedStyle(el).textDecorationLine),
      "none",
    );
    assert.equal(
      await page
        .locator(".dropped .score")
        .evaluate((el) => getComputedStyle(el).textDecorationLine),
      "line-through",
    );
    await page
      .getByLabel("Options for " + assignmentTitle, { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Undrop Assignment", exact: true })
      .click();
    await page.locator(".dropped").waitFor({ state: "detached" });
    assert.equal(await page.locator(".dropped").count(), 0);
    await page
      .getByLabel("Options for " + assignmentTitle, { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Reset Assignment", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll(".rows")].some((el) =>
          el.textContent.includes("-1.25"),
        ),
    );
    assert.doesNotMatch(
      await page.locator(".rows").first().innerText(),
      /-1.25/,
    );
  });
  await check("direct Add Grade, extra credit and removal", async () => {
    await page.getByLabel("Course options", { exact: true }).click();
    await page.getByRole("button", { name: "Add Grade", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Synthetic extra credit");
    await page.getByLabel("Score", { exact: true }).fill("110.5");
    await page.getByLabel("Total points", { exact: true }).fill("100");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Added Grades", { exact: true }).waitFor();
    await expandAssignmentGroups();
    await page
      .getByLabel("Options for Synthetic extra credit", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove Grade", exact: true })
      .click();
    await page
      .getByText("Synthetic extra credit", { exact: true })
      .waitFor({ state: "detached" });
    assert.equal(
      await page.getByText("Synthetic extra credit", { exact: true }).count(),
      0,
    );
  });
  await check("period scopes and named ungraded rows", async () => {
    await page.getByRole("button", { name: "Q1", exact: true }).click();
    await expandAssignmentGroups();
    await page.getByText("Upcoming assignment", { exact: true }).waitFor();
    assert.equal(
      await page
        .locator(".assignment")
        .filter({ has: page.getByText("Upcoming assignment", { exact: true }) })
        .locator(".score")
        .innerText(),
      "—",
    );
    assert.ok(
      (await page.locator(".rows").allInnerTexts())
        .join("\n")
        .includes("Not graded"),
    );
    await page.getByRole("button", { name: "Q2", exact: true }).click();
  });
  await check("final calculator and categories navigation", async () => {
    await page.getByLabel("Course options", { exact: true }).click();
    await page
      .getByRole("button", { name: "Final Grade Calculator", exact: true })
      .click();
    await page.getByLabel("Current grade (%)", { exact: true }).fill("80");
    await page.getByLabel("Target grade (%)", { exact: true }).fill("90");
    await page.getByLabel("Final weight (%)", { exact: true }).fill("20");
    await page.getByText("130%", { exact: true }).waitFor();
    await page.getByLabel("Back", { exact: true }).click();
    await page.getByLabel("Course options", { exact: true }).click();
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    await page.getByLabel("Practice", { exact: true }).waitFor();
    await page.getByLabel("Close course", { exact: true }).click();
    await page
      .locator(".courses")
      .getByRole("button", { name: /AP Biology/ })
      .waitFor();
  });
  await check(
    "phone layout, dark mode, personal URL and installation help",
    async () => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      assert.equal(
        await page.getByLabel("Website address", { exact: true }).inputValue(),
        base,
      );
      await page.getByLabel("Theme", { exact: true }).selectOption("dark");
      await page.screenshot({ path: directory + "/profile-dark.png" });
      await page
        .getByRole("button", { name: "Add to Home Screen", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "iPhone / iPad", exact: true })
        .waitFor();
      await page
        .getByRole("heading", { name: "Android", exact: true })
        .waitFor();
      await page.getByLabel("Close dialog", { exact: true }).click();
      await page.setViewportSize({ width: 320, height: 693 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({ path: directory + "/profile-small-dark.png" });
      await page.setViewportSize({ width: 390, height: 844 });
    },
  );
  await check(
    "Settings update check reports current version and offline state",
    async () => {
      await page
        .getByRole("button", { name: "Check for updates", exact: true })
        .click();
      await page.getByText("You’re up to date.", { exact: true }).waitFor();
      await context.setOffline(true);
      await page
        .getByRole("button", { name: "Check for updates", exact: true })
        .click();
      await page
        .getByText("You’re offline. Connect to check for updates.", {
          exact: true,
        })
        .waitFor();
      await context.setOffline(false);
    },
  );
  await check(
    "official release pending, stalled and unavailable states",
    async () => {
      const release = async (value) =>
        fetch(base + "/api/fixture/release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        });
      for (const [value, message] of [
        [
          { version: "0.99.0", publishedAt: new Date().toISOString() },
          "Update available:",
        ],
        [
          {
            version: "0.99.0",
            publishedAt: new Date(Date.now() - 72 * 3600000).toISOString(),
          },
          "Update stalled:",
        ],
        [
          { version: "0.1.3", failure: true },
          "Couldn’t check official releases",
        ],
      ]) {
        await release(value);
        await page
          .getByRole("button", { name: "Check for updates", exact: true })
          .click();
        await page.getByRole("status").filter({ hasText: message }).waitFor();
      }
      await release({ version: "0.1.3" });
    },
  );
  await check(
    "failed credential replacement retains current connection and local data",
    async () => {
      const before = await page.evaluate(async () => {
        const r = indexedDB.open("gradeviewer");
        return new Promise((resolve) => {
          r.onsuccess = () => {
            const q = r.result
              .transaction("state")
              .objectStore("state")
              .get("active");
            q.onsuccess = () => resolve(JSON.stringify(q.result));
          };
        });
      });
      await openConnection(page, "Schoology");
      await page
        .getByRole("button", { name: "Update connection", exact: true })
        .click();
      await page
        .getByLabel("Schoology API key", { exact: true })
        .fill("fixture-other");
      await page
        .getByLabel("Schoology API secret", { exact: true })
        .fill("fixture-secret");
      await page
        .getByRole("button", { name: "Connect Schoology", exact: true })
        .click();
      await page
        .getByText(
          "Disconnect before connecting a different Schoology account.",
          { exact: true },
        )
        .first()
        .waitFor();
      const status = await (
        await context.request.get(base + "/api/status")
      ).json();
      assert.equal(status.connected, true);
      assert.equal(status.account, "sample-student");
      const after = await page.evaluate(async () => {
        const r = indexedDB.open("gradeviewer");
        return new Promise((resolve) => {
          r.onsuccess = () => {
            const q = r.result
              .transaction("state")
              .objectStore("state")
              .get("active");
            q.onsuccess = () => resolve(JSON.stringify(q.result));
          };
        });
      });
      assert.equal(after, before);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    },
  );
  await check(
    "reload keeps session, connection and local scenarios",
    async () => {
      await page.reload();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .click();
      await page
        .getByLabel("Options for " + assignmentTitle, { exact: true })
        .click();
      await page
        .getByRole("button", { name: "Edit Grade", exact: true })
        .click();
      await page.getByLabel("Score", { exact: true }).fill("102.25");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByLabel("What-If grade", { exact: true }).waitFor();
      await page.reload();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .click();
      assert.match(await page.locator(".rows").first().innerText(), /102.25/);
      await page.getByLabel("Close course", { exact: true }).click();
    },
  );
  await check(
    "interrupted local activation recovers the prepared snapshot on reload",
    async () => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await openConnection(page, "Schoology");
      await page
        .getByRole("button", { name: "Update connection", exact: true })
        .click();
      await page
        .getByLabel("Schoology API key", { exact: true })
        .fill("fixture");
      await page
        .getByLabel("Schoology API secret", { exact: true })
        .fill("fixture-secret");
      await page.evaluate(() => {
        const original = IDBObjectStore.prototype.put;
        let failed = false;
        IDBObjectStore.prototype.put = function (value, key) {
          if (key === "active" && !failed) {
            failed = true;
            throw new DOMException(
              "Synthetic storage interruption",
              "QuotaExceededError",
            );
          }
          return original.call(this, value, key);
        };
      });
      await page
        .getByRole("button", { name: "Connect Schoology", exact: true })
        .click();
      await page
        .getByText(
          "Your browser could not save grades. Free some storage and retry.",
          { exact: true },
        )
        .first()
        .waitFor();
      const pending = await page.evaluate(async () => {
        const request = indexedDB.open("gradeviewer");
        return new Promise((resolve) => {
          request.onsuccess = () => {
            const get = request.result
              .transaction("state")
              .objectStore("state")
              .get("pending");
            get.onsuccess = () => resolve(!!get.result);
          };
        });
      });
      assert.equal(pending, true);
      await page.reload();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .click();
      assert.match(await page.locator(".rows").first().innerText(), /102.25/);
      await page.getByLabel("Close course", { exact: true }).click();
    },
  );
  await check(
    "Worker process restart preserves encrypted vault and sessions",
    async () => {
      await stop();
      await start();
      await page.reload();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
      assert.equal(
        (await (await context.request.get(base + "/api/status")).json())
          .connected,
        true,
      );
    },
  );
  await check(
    "previously unlocked browser opens saved grades offline without a loading gate",
    async () => {
      await page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
      });
      // Saved cards now appear before background refresh finishes. This case
      // tests an offline launch, not cutting a live scan's connection in WebKit.
      await page.waitForFunction(
        () => !document.querySelector(".desktop-refresh")?.disabled,
      );
      await context.setOffline(true);
      await page.reload();
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .waitFor();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
      assert.equal(await page.locator(".course").count(), 5);
      assert.equal(await page.locator(".gate").count(), 0);
      await page.getByRole("alert").waitFor();
      assert.match(
        await page.locator("body").innerText(),
        /connection|internet|unavailable/i,
      );
      await context.setOffline(false);
      await page.reload();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
    },
  );
  await check("service worker caches shell only", async () => {
    const urls = await page.evaluate(async () => {
      const values = [];
      for (const key of await caches.keys())
        for (const req of await (await caches.open(key)).keys())
          values.push(req.url);
      return values;
    });
    assert.ok(urls.length > 3);
    assert.equal(
      urls.some((u) => u.includes("/api/")),
      false,
    );
    assert.equal(
      await page.evaluate(() => document.cookie.includes("gradeviewer")),
      false,
    );
  });
  await check(
    "controlled service-worker update retains local changes",
    async () => {
      const originalIndex = await readFile("dist/index.html"),
        originalWorker = await readFile("dist/sw.js");
      originalDeployment = { index: originalIndex, worker: originalWorker };
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await openConnection(page, "Schoology");
      await page
        .getByRole("button", { name: "Update connection", exact: true })
        .click();
      await page
        .getByLabel("Schoology API key", { exact: true })
        .fill("fixture-unsaved");
      const otherTab = await context.newPage();
      await otherTab.goto(base);
      await otherTab
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
      const firstVisit = await browser.newContext({
        ignoreHTTPSErrors: true,
        storageState: await context.storageState(),
      });
      const freshPage = await firstVisit.newPage();
      try {
        // This page mounts before its first worker claims it; it is never reloaded
        // until Update now is clicked. A captured startup-controller flag fails here.
        await freshPage.goto(base);
        await freshPage
          .locator(".courses")
          .getByRole("button", { name: /AP Biology/ })
          .waitFor();
        await freshPage.waitForFunction(
          () => !!navigator.serviceWorker.controller,
        );
        await writeFile(
          "dist/index.html",
          originalIndex
            .toString()
            .replace(
              "</head>",
              '<meta name="synthetic-update" content="verified"/></head>',
            ),
        );
        execFileSync("node", ["scripts/service-worker.mjs"]);
        await page.waitForTimeout(500);
        await freshPage
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await freshPage
          .getByRole("button", { name: "Check for updates", exact: true })
          .click();
        await freshPage
          .getByRole("button", { name: "Update now", exact: true })
          .waitFor();
        await Promise.all([
          freshPage.waitForNavigation({ waitUntil: "load" }),
          freshPage
            .getByRole("button", { name: "Update now", exact: true })
            .click(),
        ]);
        assert.equal(
          await freshPage
            .locator('meta[name="synthetic-update"]')
            .getAttribute("content"),
          "verified",
        );
        await freshPage
          .locator(".courses")
          .getByRole("button", { name: /AP Biology/ })
          .waitFor();
        // This page shares the original tab's worker and really changes its controller.
        await otherTab
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await otherTab
          .getByRole("button", { name: "Check for updates", exact: true })
          .click();
        await otherTab
          .getByRole("button", { name: "Update now", exact: true })
          .waitFor();
        await Promise.all([
          otherTab.waitForNavigation({ waitUntil: "load" }),
          otherTab
            .getByRole("button", { name: "Update now", exact: true })
            .click(),
        ]);
        assert.equal(
          await otherTab
            .locator('meta[name="synthetic-update"]')
            .getAttribute("content"),
          "verified",
        );
        assert.equal(
          await page.locator('meta[name="synthetic-update"]').count(),
          0,
        );
        // Another tab activated the new worker. This tab must retain its form.
        assert.equal(
          await page
            .getByLabel("Schoology API key", { exact: true })
            .inputValue(),
          "fixture-unsaved",
        );
        await page
          .getByRole("button", { name: "Update now", exact: true })
          .click();
        await page
          .getByText("Save or close your open changes before updating.", {
            exact: true,
          })
          .waitFor();
        assert.equal(
          await page
            .getByLabel("Schoology API key", { exact: true })
            .inputValue(),
          "fixture-unsaved",
        );
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Check for updates", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Update now", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Reload to update", exact: true })
          .waitFor();
        await Promise.all([
          page.waitForNavigation({ waitUntil: "load" }),
          page.getByRole("button", { name: "Update now", exact: true }).click(),
        ]);
        assert.equal(
          await page
            .locator('meta[name="synthetic-update"]')
            .getAttribute("content"),
          "verified",
        );
        await page
          .locator(".courses")
          .getByRole("button", { name: /AP Biology/ })
          .waitFor();
        await page
          .locator(".courses")
          .getByRole("button", { name: /AP Biology/ })
          .click();
        assert.match(await page.locator(".rows").first().innerText(), /102.25/);
        await page.getByLabel("Close course", { exact: true }).click();
      } finally {
        await otherTab.close();
        await firstVisit.close();
      }
      // Keep the tested deployment stable for later cases. Restore only after shutdown.
    },
  );
  await check(
    "failure retains records and Settings/Retry remain usable",
    async () => {
      // A server-side fixture works with service workers in both engines.
      // Browser request interception does not cover WebKit service-worker fetches.
      await context.request.post(base + "/api/fixture/failure", {
        data: { enabled: true },
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Refresh grades", exact: true })
        .click();
      await page
        .getByText("Schoology is unavailable. Your saved data is retained.", {
          exact: true,
        })
        .waitFor();
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      assert.equal(await page.locator(".course").count(), 5);
      await page.reload();
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await page.getByText("Showing saved grades.", { exact: false }).waitFor();
      assert.equal(await page.locator(".course").count(), 5);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("heading", { name: "Your personal website", exact: true })
        .waitFor();
      await context.request.post(base + "/api/fixture/failure", {
        data: { enabled: false },
      });
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
    },
  );
  await check(
    "a second tab refresh preserves the open course and unsaved grade form",
    async () => {
      await page.locator(".courses .course").first().click();
      await page.getByLabel("Course options", { exact: true }).click();
      await page
        .getByRole("button", { name: "Add Grade", exact: true })
        .click();
      await page
        .getByLabel("Name", { exact: true })
        .fill("Keep this unsaved form");
      const other = await context.newPage();
      await other.goto(base);
      await other
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
      await other.waitForFunction(
        () => !document.querySelector(".desktop-refresh")?.disabled,
      );
      await page.waitForTimeout(100);
      assert.equal(
        await page.getByLabel("Name", { exact: true }).inputValue(),
        "Keep this unsaved form",
      );
      await page.getByLabel("Close dialog", { exact: true }).click();
      await page.getByLabel("Close course", { exact: true }).click();
      await other.close();
    },
  );
  await check(
    "a new browser unlocks without pasting Schoology keys again",
    async () => {
      const second = await browser.newContext({
          viewport: { width: 390, height: 844 },
          ignoreHTTPSErrors: true,
        }),
        secondPage = await second.newPage();
      try {
        await secondPage.goto(base);
        await secondPage
          .getByLabel("App password", { exact: true })
          .fill("synthetic-owner-password-for-tests-only");
        await secondPage
          .getByRole("button", { name: "Unlock app", exact: true })
          .click();
        await secondPage
          .getByRole("button", { name: "Grades", exact: true })
          .click();
        await secondPage
          .locator(".courses")
          .getByRole("button", { name: /AP Biology/ })
          .waitFor();
        assert.equal(await secondPage.locator(".course").count(), 5);
        assert.equal(
          await secondPage.locator(".desktop-refresh").isVisible(),
          true,
        );
        assert.equal(
          await secondPage
            .getByLabel("Schoology API secret", { exact: true })
            .count(),
          0,
        );
      } finally {
        await second.close();
      }
    },
  );
  await check(
    "emulated Home Screen refresh settles after success, cancellation and failure",
    async () => {
      // Standalone flags are fixtures, not a physical iOS/Android install claim.
      const installed = await browser.newContext({
        viewport: { width: 390, height: 700 },
        isMobile: true,
        hasTouch: true,
        ignoreHTTPSErrors: true,
        storageState: await context.storageState(),
      });
      await installed.addInitScript(() => {
        Object.defineProperty(navigator, "standalone", { value: true });
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query) =>
          query === "(display-mode: standalone)"
            ? new Proxy(original(query), {
                get: (target, property) =>
                  property === "matches"
                    ? true
                    : Reflect.get(target, property, target),
              })
            : original(query);
      });
      const appPage = await installed.newPage();
      let touch;
      try {
        await appPage.goto(base);
        await appPage
          .locator(".courses")
          .getByRole("button", { name: /AP Biology/ })
          .waitFor();
        assert.equal(await appPage.evaluate(() => navigator.standalone), true);
        touch =
          engine === "chromium"
            ? await installed.newCDPSession(appPage)
            : undefined;
        let pullY = 0;
        const send = async (type, offset = 0) => {
          const y = pullY + offset;
          if (touch)
            return touch.send("Input.dispatchTouchEvent", {
              type,
              touchPoints:
                type === "touchEnd" || type === "touchCancel"
                  ? []
                  : [{ x: 100, y }],
            });
          await appPage.evaluate(
            ({ type, y }) => {
              const event = new Event(
                {
                  touchStart: "touchstart",
                  touchMove: "touchmove",
                  touchEnd: "touchend",
                  touchCancel: "touchcancel",
                }[type],
                { bubbles: true, cancelable: true },
              );
              Object.defineProperty(event, "touches", {
                value:
                  type === "touchEnd" || type === "touchCancel"
                    ? []
                    : [{ identifier: 1, clientX: 100, clientY: y }],
              });
              document.querySelector(".app-scroll").dispatchEvent(event);
            },
            { type, y },
          );
        };
        let scans = 0;
        appPage.on("request", (r) => {
          if (r.url().endsWith("/api/scan/start")) scans++;
        });
        const pull = async () => {
          await appPage
            .locator(".app-scroll")
            .evaluate((el) => el.scrollTo(0, 0));
          pullY = Math.ceil(
            (await appPage.locator(".courses .course").first().boundingBox())
              .y + 20,
          );
          await send("touchStart");
          await send("touchMove", 80);
          await send("touchMove", 170);
        };
        await pull();
        await send("touchMove", 10); // Reversing below the threshold disarms it.
        await send("touchEnd");
        await appPage.locator('.pull-refresh[data-phase="idle"]').waitFor();
        assert.equal(scans, 0);
        await pull();
        await send("touchCancel");
        await appPage.locator('.pull-refresh[data-phase="idle"]').waitFor();
        assert.equal(scans, 0);
        await pull();
        await appPage.screenshot({
          path: directory + "/standalone-spinner.png",
        });
        const committed = appPage.waitForResponse(
          (r) => r.url().endsWith("/api/scan/commit") && r.ok(),
        );
        await send("touchEnd");
        await committed;
        await appPage.locator('.pull-refresh[data-phase="idle"]').waitFor();
        assert.equal(scans, 1);
        assert.equal(await appPage.evaluate(() => scrollY), 0);
        assert.equal(await appPage.locator(".course").count(), 5);
        await installed.request.post(base + "/api/fixture/failure", {
          data: { enabled: true },
        });
        await pull();
        await send("touchEnd");
        await appPage.getByRole("alert").waitFor();
        await appPage.locator('.pull-refresh[data-phase="idle"]').waitFor();
        assert.equal(scans, 2);
        assert.equal(await appPage.locator(".course").count(), 5);
        // The state timer can precede WebKit's final CSS animation frame.
        await appPage.waitForFunction(
          () =>
            getComputedStyle(document.querySelector(".refresh-content"))
              .transform === "matrix(1, 0, 0, 1, 0, 0)",
        );
        assert.equal(
          await appPage
            .locator(".refresh-content")
            .evaluate((el) => getComputedStyle(el).transform),
          "matrix(1, 0, 0, 1, 0, 0)",
        );
      } finally {
        await context.request.post(base + "/api/fixture/failure", {
          data: { enabled: false },
        });
        await touch?.detach();
        await installed.close();
      }
    },
  );
  await check(
    "IC sign-in finishes automatically and selected courses survive expiry and reconnect",
    async () => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      // Model the external window without navigating a real popup to a synthetic sign-in page.
      await page.evaluate(() => {
        window.open = () => {
          document.body.dataset.campusPopup = "open";
          return {
            document: { body: {} },
            location: {
              replace(url) {
                document.body.dataset.campusDestination = url;
              },
            },
            close() {
              document.body.dataset.campusPopup = "closed";
            },
          };
        };
      });
      await openConnection(page, "Infinite Campus");
      const connect = page.getByRole("button", {
        name: "Connect Infinite Campus",
        exact: true,
      });
      assert.equal(await connect.isEnabled(), true);
      const openSignIn = page.getByRole("link", {
        name: "Open Campus Student",
      });
      await context.request.post(base + "/api/fixture/campus", {
        data: { startLimited: true },
      });
      await connect.click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Cloudflare’s daily browser time is used up" })
        .waitFor();
      assert.equal(
        await page.locator("body").getAttribute("data-campus-popup"),
        null,
      );
      assert.equal(await openSignIn.count(), 0);
      await context.request.post(base + "/api/fixture/campus", {
        data: { startLimited: false },
      });
      let progress = await holdRequest(page, "**/api/campus/progress");
      try {
        await connect.click();
        await openSignIn.waitFor();
        assert.equal(
          await page.locator("body").getAttribute("data-campus-popup"),
          null,
        );
        await openSignIn.click();
        assert.equal(
          await page.locator("body").getAttribute("data-campus-destination"),
          "/api/fixture/portal-window?provider=campus",
        );
        assert.equal(
          await page.locator("body").getAttribute("data-campus-popup"),
          "open",
        );
        assert.equal(
          await page.getByRole("button", { name: "Finish connecting" }).count(),
          0,
        );
        await context.request.post(base + "/api/fixture/campus", {
          data: { signedIn: true },
        });
        progress.release();
        await page
          .getByRole("heading", { name: "Choose your classes", exact: true })
          .waitFor();
      } finally {
        await progress.close();
      }
      assert.equal(
        await page.locator("body").getAttribute("data-campus-popup"),
        "closed",
      );
      await page
        .getByRole("switch", { name: /Synthetic IC-only course/ })
        .check();
      let schoologyScans = 0;
      const countSchoology = (request) => {
        if (request.url().endsWith("/api/scan/start")) schoologyScans++;
      };
      page.on("request", countSchoology);
      await page
        .getByRole("button", { name: "Save IC courses", exact: true })
        .click();
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      const ic = page
        .locator(".courses")
        .getByRole("button", { name: /Synthetic IC-only course/ });
      await ic.waitFor();
      page.off("request", countSchoology);
      assert.equal(
        schoologyScans,
        0,
        "IC selection must not refresh Schoology",
      );
      assert.match(await ic.innerText(), /90/);
      await page.locator(".gpa-card").evaluate((card) => {
        card.open = true;
      });
      const icGpa = page
        .locator(".gpa-card li")
        .filter({ hasText: "Synthetic IC-only course" });
      assert.match(await icGpa.innerText(), /A-/);
      assert.doesNotMatch(await icGpa.innerText(), /No semester grade/);
      await ic.click();
      assert.match(await page.locator(".summary").innerText(), /S1 overall/);
      assert.match(await page.locator(".summary .grade").innerText(), /90/);
      // A first IC connection has no prior local observations. Provider-dated
      // assignments still reconstruct the semester through both weight levels.
      const icChart = page.getByRole("slider", {
        name: "Explore grade history",
      });
      assert.ok(Number(await icChart.getAttribute("aria-valuemax")) >= 5);
      await icChart.focus();
      await icChart.press("Home");
      assert.match(await page.locator(".chart-tooltip").innerText(), /50\.00/);
      await icChart.press("End");
      assert.match(await page.locator(".chart-tooltip").innerText(), /90\.00/);
      await icChart.press("Escape");
      await page.getByText("Synthetic work", { exact: true }).first().waitFor();
      await page
        .getByRole("button", { name: "View All Assignments", exact: true })
        .click();
      await page
        .locator(".pills")
        .getByRole("button", { name: "Q1", exact: true })
        .click();
      assert.match(await page.locator(".summary").innerText(), /S1 overall/);
      await page.getByLabel("Practice", { exact: true }).click();
      await page.getByText("Earlier synthetic work", { exact: true }).waitFor();
      await page
        .locator(".pills")
        .getByRole("button", { name: "Q2", exact: true })
        .click();
      assert.match(await page.locator(".summary .grade").innerText(), /90/);
      await page.getByLabel("Close course", { exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      assert.equal(
        await page.getByRole("switch", { name: "Keep connected" }).count(),
        0,
      );
      const campusStatus = (
        await (await context.request.get(base + "/api/status")).json()
      ).portals.campus;
      assert.equal(campusStatus.maintenance, true);
      assert(campusStatus.nextMaintenance > Date.now());
      await context.request.post(base + "/api/fixture/campus", {
        data: { courseDelayMs: 1200 },
      });
      const chooseIC = page.getByRole("button", {
        name: "Choose IC courses",
        exact: true,
      });
      await chooseIC.click();
      await page
        .getByRole("heading", { name: "Choose your classes", exact: true })
        .waitFor({ timeout: 500 });
      await page.getByText("Loading IC courses…", { exact: true }).waitFor();
      await page.getByText(/Both copies of a class count toward GPA/).waitFor();
      await page
        .getByRole("switch", { name: /Synthetic IC-only course/ })
        .waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await chooseIC.click();
      assert.equal(
        await page
          .getByRole("switch", { name: /Synthetic IC-only course/ })
          .isVisible(),
        true,
      );
      assert.equal(
        await page.getByText("Loading IC courses…", { exact: true }).count(),
        0,
      );
      const expired = await context.request.post(base + "/api/fixture/campus", {
        data: { expireSession: true },
      });
      assert.deepEqual(await expired.json(), { expired: true });
      await page
        .getByRole("button", { name: "Save IC courses", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({
          hasText: "Reconnect Infinite Campus to refresh your grades.",
        })
        .waitFor();
      await page
        .getByRole("heading", { name: "Choose your classes" })
        .waitFor({ state: "hidden" });
      await page
        .locator(".portal-actions .primary", {
          hasText: "Reconnect Infinite Campus",
        })
        .waitFor();
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await ic.waitFor();
      progress = await holdRequest(page, "**/api/campus/progress");
      try {
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await page
          .locator("summary", { hasText: "Infinite Campus" })
          .locator('[data-health="error"]')
          .waitFor();
        await page
          .getByRole("button", {
            name: "Reconnect Infinite Campus",
            exact: true,
          })
          .click();
        await openSignIn.click();
        const signedIn = await context.request.post(
          base + "/api/fixture/portal-window?provider=campus",
          { headers: { Origin: base } },
        );
        assert.equal(signedIn.ok(), true);
        progress.release();
        await page
          .locator("summary", { hasText: "Infinite Campus" })
          .locator('[data-health="connected"]')
          .waitFor();
      } finally {
        await progress.close();
      }
      await page
        .getByRole("button", { name: "Choose IC courses", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("switch", { name: /Synthetic IC-only course/ })
          .isChecked(),
        true,
      );
      await page.screenshot({ path: directory + "/settings-campus.png" });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Disconnect Infinite Campus",
          exact: true,
        })
        .click();
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".courses .course").length === 5,
      );
    },
  );
  await check(
    "Carmen experiment switches LMS views without losing sessions, grades or diagnostics",
    async () => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const before = await (
        await context.request.get(base + "/api/status")
      ).json();
      let schoologyScans = 0;
      const countSchoology = (request) => {
        if (request.url().endsWith("/api/scan/start")) schoologyScans++;
      };
      page.on("request", countSchoology);
      await page
        .locator("summary", { hasText: "CarmenCanvas" })
        .getByText("Experimental", { exact: true })
        .waitFor();
      await openConnection(page, "CarmenCanvas");
      const copyReport = page.getByRole("button", {
        name: "Copy compatibility report",
      });
      assert.equal(await copyReport.isEnabled(), false);
      await page
        .getByRole("button", { name: "Connect CarmenCanvas", exact: true })
        .click();
      await completeCarmenSignIn(page, context.request);
      const otherConnections = page.locator(".connection-heading > strong", {
        hasText: /^(Schoology|Infinite Campus)$/,
      });
      await page
        .getByRole("switch", { name: /Use Carmen as main LMS/ })
        .check();
      assert.equal(await otherConnections.count(), 0);
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".courses .course").length === 1,
      );
      page.off("request", countSchoology);
      assert.equal(
        schoologyScans,
        0,
        "Connecting/switching to Carmen must not scan Schoology",
      );
      await page
        .locator(".courses")
        .getByRole("button", { name: /Synthetic Carmen Calculus/ })
        .waitFor();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            async write(items) {
              const blob = await items[0].getType("text/plain");
              document.body.dataset.copiedCarmenReport = await blob.text();
            },
          },
        });
      });
      await copyReport.click();
      await page
        .getByRole("status")
        .filter({ hasText: "Report copied." })
        .waitFor();
      const copied = await page
        .locator("body")
        .getAttribute("data-copied-carmen-report");
      const report = JSON.parse(copied);
      assert.equal(report.signIn.result, "ok");
      assert.equal(report.sync.result, "ok");
      assert.deepEqual(
        report.sync.responses.enrollments.fields["$[].grades.current_score"],
        ["number"],
      );
      assert.doesNotMatch(
        copied,
        /Synthetic Carmen Calculus|synthetic-canvas-session|https:\/\//,
      );
      await page.evaluate(() => {
        navigator.clipboard.write = async () => {
          throw new Error("Clipboard denied");
        };
      });
      await copyReport.click();
      const fallback = page.getByRole("textbox", {
        name: "Carmen compatibility report",
      });
      await fallback.waitFor();
      assert.deepEqual(JSON.parse(await fallback.inputValue()), report);
      assert.equal(
        await page.getByRole("switch", { name: "Keep connected" }).count(),
        0,
      );
      const carmenStatus = (
        await (await context.request.get(base + "/api/status")).json()
      ).portals.carmen;
      assert.equal(carmenStatus.maintenance, true);
      assert(carmenStatus.nextMaintenance > Date.now());
      await page
        .locator("summary", { hasText: "CarmenCanvas" })
        .getByText("Connected", { exact: true })
        .waitFor();
      assert.equal(await page.getByText(/Total verified uptime/).count(), 0);
      assert.equal(
        await page
          .getByRole("button", { name: "Check connection", exact: true })
          .count(),
        0,
      );
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page
            .locator(".profile")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          true,
        );
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .locator(".portal-connection")
        .filter({ hasText: "CarmenCanvas" })
        .screenshot({ path: directory + "/settings-carmen-experiment.png" });
      await context.request.post(base + "/api/fixture/carmen", {
        data: { empty: true },
      });
      const refreshed = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/carmen/snapshot") && response.ok(),
      );
      await page
        .getByRole("button", { name: "Refresh grades", exact: true })
        .click();
      await refreshed;
      await page
        .locator("summary", { hasText: "CarmenCanvas" })
        .getByText("Connected", { exact: true })
        .waitFor();
      assert.equal(
        (await (await context.request.get(base + "/api/status")).json()).portals
          .carmen.diagnostics.courseCount,
        0,
      );
      const operatorResult = await (
        await fetch(base + "/api/carmen/diagnostics", {
          headers: {
            Authorization:
              "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        })
      ).json();
      assert.equal(operatorResult.diagnostics.courseCount, 0);
      assert.doesNotMatch(
        JSON.stringify(operatorResult),
        /synthetic-canvas-session|_normandy_session|Synthetic Carmen Calculus|"subject"|"cookies"/,
      );
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await page
        .getByRole("heading", { name: "No Carmen grades yet", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("switch", { name: /Use Carmen as main LMS/ })
        .uncheck();
      assert.equal(await otherConnections.count(), 2);
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".courses .course").length === 5,
      );
      const after = await (
        await context.request.get(base + "/api/status")
      ).json();
      assert.equal(after.account, before.account);
      assert.equal(after.schoologyConnected, true);
      assert.equal(after.portals.carmen.connected, true);
      assert.equal(after.portals.carmen.maintenance, true);
      await page.reload();
      await page
        .locator(".courses")
        .getByRole("button", { name: /AP Biology/ })
        .waitFor();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await openConnection(page, "CarmenCanvas");
      await page
        .getByRole("button", { name: "Disconnect CarmenCanvas", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Connect CarmenCanvas", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".courses .course").length === 5,
      );
    },
  );
  await check("disconnect clears data and revokes sessions", async () => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await openConnection(page, "Schoology");
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page
      .getByRole("button", { name: "Disconnect and clear data", exact: true })
      .click();
    await page.getByLabel("App password", { exact: true }).waitFor();
    assert.equal(
      (await (await context.request.get(base + "/api/status")).json())
        .connected,
      false,
    );
    const count = await page.evaluate(async () => {
      const r = indexedDB.open("gradeviewer");
      return new Promise((resolve) => {
        r.onsuccess = () => {
          const q = r.result.transaction("state").objectStore("state").count();
          q.onsuccess = () => resolve(q.result);
        };
      });
    });
    assert.equal(count, 0);
  });
  await check(
    "Carmen standalone connection, GPA, expiry, reconnect, and independent Schoology removal",
    async () => {
      await page.goto(base);
      await page
        .getByLabel("App password", { exact: true })
        .fill("synthetic-owner-password-for-tests-only");
      await page
        .getByRole("button", { name: "Unlock app", exact: true })
        .click();
      await openConnection(page, "CarmenCanvas");
      const carmenMode = page.getByRole("switch", {
        name: /Use Carmen as main LMS/,
      });
      await carmenMode.check();
      await carmenMode.and(page.locator(":enabled")).waitFor();
      await page.reload();
      await openConnection(page, "CarmenCanvas");
      assert.equal(await carmenMode.isChecked(), true);
      assert.equal(
        await page.getByLabel("Schoology API key", { exact: true }).count(),
        0,
      );
      await page
        .getByRole("button", { name: "Connect CarmenCanvas", exact: true })
        .click();
      await completeCarmenSignIn(page, context.request);
      await page.screenshot({ path: directory + "/settings-carmen.png" });
      const status = await (
        await context.request.get(base + "/api/status")
      ).json();
      assert.equal(status.schoologyConnected, false);
      assert.equal(status.portals.carmen.maintenance, true);
      assert(status.portals.carmen.nextMaintenance > Date.now());
      assert.match(status.account, /^workspace:/);
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      const card = page
        .locator(".courses")
        .getByRole("button", { name: /Synthetic Carmen Calculus/ });
      await card.waitFor();
      assert.match(await card.innerText(), /86/);
      await card.click();
      await page
        .getByText("Synthetic Carmen homework", { exact: true })
        .first()
        .waitFor();
      await page.getByLabel("Close course", { exact: true }).click();
      await page
        .locator(".gpa-card summary")
        .filter({ hasText: "Ohio State semester GPA" })
        .click();
      await page
        .getByRole("button", { name: "Use Ohio State GPA scale", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Edit courses", exact: true })
        .click();
      await page.getByLabel("Semester credits", { exact: true }).fill("3");
      await page
        .getByRole("button", { name: "Save GPA settings", exact: true })
        .click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".gpa-card summary")].some((e) =>
          e.textContent.includes("3.00"),
        ),
      );
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await context.request.post(base + "/api/fixture/carmen", {
        data: { failure: true },
      });
      await page
        .getByRole("button", { name: "Refresh grades", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: /Carmen/ })
        .waitFor();
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await card.waitFor();
      await context.request.post(base + "/api/fixture/carmen", {
        data: { failure: false },
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Reconnect CarmenCanvas", exact: true })
        .click();
      await completeCarmenSignIn(page, context.request);
      assert.equal(
        (await (await context.request.get(base + "/api/status")).json())
          .account,
        status.account,
      );
      await page
        .getByRole("switch", { name: /Use Carmen as main LMS/ })
        .uncheck();
      await page
        .getByLabel("Schoology API key", { exact: true })
        .fill("fixture");
      await page
        .getByLabel("Schoology API secret", { exact: true })
        .fill("fixture-secret");
      await page
        .getByRole("button", { name: "Connect Schoology", exact: true })
        .click();
      await page
        .locator(".courses .course")
        .filter({ hasText: "AP Biology" })
        .waitFor();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await openConnection(page, "Schoology");
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Disconnect and clear data", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Connect Schoology", exact: true })
        .waitFor();
      await page
        .getByRole("switch", { name: /Use Carmen as main LMS/ })
        .check();
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await card.waitFor();
      assert.equal(await page.locator(".courses .course").count(), 1);
      assert.equal(
        (await (await context.request.get(base + "/api/status")).json())
          .account,
        status.account,
      );
      assert.match(await page.locator(".gpa-card summary").innerText(), /3.00/);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Disconnect CarmenCanvas", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Connect CarmenCanvas", exact: true })
        .waitFor();
      // Return to the locked state before the desktop Schoology flow.
      assert.equal(
        (
          await context.request.post(base + "/api/disconnect", {
            data: {},
            headers: { Origin: base },
          })
        ).status(),
        200,
      );
      await page.reload();
      await page.getByLabel("App password", { exact: true }).waitFor();
    },
  );
  await check(
    "desktop grades and Settings use the normal Schoology connection",
    async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByLabel("App password", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Try sample grades", exact: true })
        .waitFor({ state: "detached" });
      assert.equal(await page.locator(".courses .course").count(), 0);
      await page
        .getByLabel("App password", { exact: true })
        .fill("synthetic-owner-password-for-tests-only");
      await page
        .getByRole("button", { name: "Unlock app", exact: true })
        .click();
      await page
        .getByLabel("Schoology API key", { exact: true })
        .fill("fixture");
      await page
        .getByLabel("Schoology API secret", { exact: true })
        .fill("fixture-secret");
      await page
        .getByRole("button", { name: "Connect Schoology", exact: true })
        .click();
      await page
        .locator(".courses .course")
        .filter({ hasText: "AP Biology" })
        .waitFor();
      await page.screenshot({ path: directory + "/desktop-grades.png" });
      const cards = await page.locator(".courses .course").all();
      const first = await cards[0].boundingBox(),
        second = await cards[1].boundingBox();
      assert.equal(first.y, second.y);
      assert.ok(second.x > first.x);
      assert.ok((await page.locator(".app").boundingBox()).width > 900);
      assert.equal(await page.locator(".sidebar-courses").isVisible(), true);
      assert.equal(await page.locator("header").innerText(), "My grades");
      assert.doesNotMatch(
        await page.locator("footer").innerText(),
        /GradeViewer|at a glance/,
      );
      assert.equal(
        await page.locator("footer img").evaluate((icon) => icon.naturalWidth),
        192,
      );
      await cards[0].click();
      assert.equal(
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .isVisible(),
        true,
      );
      const graphBox = await page.locator(".graph-section").boundingBox(),
        recentBox = await page.locator(".recent-assignments").boundingBox();
      assert.ok(recentBox.x > graphBox.x + graphBox.width);
      const chart = page.getByRole("slider");
      assert.equal(
        await chart.evaluate((el) => getComputedStyle(el).cursor),
        "default",
      );
      await chart.hover({ position: { x: 10, y: 20 } });
      await page.locator(".chart-tooltip").waitFor();
      const left = Number(await chart.getAttribute("aria-valuenow"));
      const bounds = await chart.boundingBox();
      await chart.hover({ position: { x: bounds.width - 10, y: 20 } });
      await page.waitForFunction(
        (left) =>
          Number(
            document.querySelector(".chart").getAttribute("aria-valuenow"),
          ) > left,
        left,
      );
      await page.locator(".graph-section h2").hover();
      await page.locator(".chart-tooltip").waitFor({ state: "hidden" });
      await chart.press("End");
      const expected = (
        await page.locator(".summary .grade").innerText()
      ).replace(/[%()\s]/g, "");
      assert.equal(
        Number(await page.locator(".chart-tooltip strong").innerText()),
        Number(expected),
      );
      const marker = await page.locator(".chart-marker").boundingBox(),
        plot = await chart.boundingBox();
      assert.ok(marker.y >= plot.y && marker.y < plot.y + plot.height);
      await page.screenshot({ path: directory + "/desktop-detail.png" });
      await page
        .locator(".sidebar-courses button")
        .filter({ hasText: "AP Physics 1" })
        .click();
      assert.match(await page.locator("header h1").innerText(), /AP Physics 1/);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.screenshot({ path: directory + "/desktop-profile.png" });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(
        (await (await context.request.get(base + "/api/status")).json())
          .connected,
        true,
      );
      assert.equal(
        (
          await context.request.post(base + "/api/disconnect", {
            data: {},
            headers: { Origin: base },
          })
        ).status(),
        200,
      );
    },
  );
  await check(
    "blank enrollments stay omitted and retired hide controls are absent",
    async () => {
      const fresh = await browser.newContext({ ignoreHTTPSErrors: true });
      try {
        const blank = await fresh.newPage();
        await blank.goto(base);
        await blank
          .getByLabel("App password", { exact: true })
          .fill("synthetic-owner-password-for-tests-only");
        await blank
          .getByRole("button", { name: "Unlock app", exact: true })
          .click();
        await blank
          .getByLabel("Schoology API key", { exact: true })
          .fill("fixture-blank");
        await blank
          .getByLabel("Schoology API secret", { exact: true })
          .fill("fixture-secret");
        await blank
          .getByRole("button", { name: "Connect Schoology", exact: true })
          .click();
        await blank.locator(".courses").waitFor();
        assert.equal(await blank.locator(".courses .course").count(), 5);
        assert.doesNotMatch(
          await blank.locator(".courses").innerText(),
          /Ungraded synthetic class|New synthetic class/,
        );
        await blank
          .locator(".courses .course")
          .filter({ hasText: "AP Biology" })
          .click();
        await blank.getByLabel("Course options", { exact: true }).click();
        assert.equal(
          await blank
            .getByRole("button", { name: "Hide class", exact: true })
            .count(),
          0,
        );
        await blank.getByLabel("Close course", { exact: true }).click();
        await blank
          .locator('header button[aria-label="Refresh grades"]:not([disabled])')
          .waitFor();
        await blank.evaluate(
          () =>
            new Promise((resolve, reject) => {
              const request = indexedDB.open("gradeviewer", 1);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => {
                const db = request.result,
                  tx = db.transaction("state", "readwrite"),
                  store = tx.objectStore("state");
                const active = store.get("active");
                active.onsuccess = () => {
                  const value = active.result;
                  value.courses[0].hidden = true;
                  value.courses.push({
                    ...structuredClone(value.courses[0]),
                    id: "legacy-blank",
                    title: "Legacy blank placeholder",
                    grade: {},
                    history: [],
                    fields: { metadata_only: "true" },
                  });
                  store.put(value, "active");
                };
                tx.oncomplete = () => {
                  db.close();
                  resolve();
                };
                tx.onerror = () => reject(tx.error);
              };
            }),
        );
        await blank.route("**/api/status", (route) => route.abort("failed"));
        await blank.reload();
        await blank.locator(".courses").waitFor();
        assert.equal(await blank.locator(".courses .course").count(), 5);
        assert.equal(
          await blank
            .locator(".courses .course")
            .filter({ hasText: "AP Biology" })
            .count(),
          1,
        );
        assert.doesNotMatch(
          await blank.locator(".courses").innerText(),
          /Legacy blank placeholder/,
        );
        await blank
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        assert.equal(
          await blank
            .getByRole("heading", { name: "Hidden classes", exact: true })
            .count(),
          0,
        );
      } finally {
        await fresh.close();
      }
    },
  );
  await check(
    "fresh opens and real returns refresh once; idle time and cooldown expiry stay quiet",
    async () => {
      const isolated = await browser.newContext({ ignoreHTTPSErrors: true });
      try {
        const quiet = await isolated.newPage();
        await quiet.clock.install();
        let scans = 0;
        quiet.on("request", (request) => {
          if (request.url().endsWith("/api/scan/start")) scans++;
        });
        const unlocked = await isolated.request.post(base + "/api/login", {
          headers: { Origin: base },
          data: { password: "synthetic-owner-password-for-tests-only" },
        });
        assert.equal(unlocked.ok(), true);
        const connected = (
          await (await isolated.request.get(base + "/api/status")).json()
        ).connected;
        await quiet.goto(base);
        if (!connected) {
          await quiet
            .getByLabel("Schoology API key", { exact: true })
            .fill("fixture");
          await quiet
            .getByLabel("Schoology API secret", { exact: true })
            .fill("fixture-secret");
          await quiet
            .getByRole("button", { name: "Connect Schoology", exact: true })
            .click();
        }
        await quiet.locator(".courses").waitFor();
        const ready = () =>
          quiet
            .locator(
              'header button[aria-label="Refresh grades"]:not([disabled])',
            )
            .waitFor();
        await ready();
        assert.equal(scans, 1);
        await quiet.clock.fastForward("30:00");
        await quiet.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        );
        assert.equal(scans, 1);
        const resumed = quiet.waitForResponse(
          (r) => r.url().endsWith("/api/scan/commit") && r.ok(),
        );
        await quiet.evaluate(() => {
          for (const value of ["hidden", "visible", "visible"]) {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value,
            });
            document.dispatchEvent(new Event("visibilitychange"));
          }
        });
        await resumed;
        await ready();
        assert.equal(scans, 2);
        await isolated.request.post(base + "/api/fixture/rate-limit", {
          data: { enabled: true },
        });
        await quiet.getByLabel("Refresh grades", { exact: true }).click();
        await quiet
          .getByRole("alert")
          .filter({ hasText: "Schoology is limiting requests" })
          .waitFor();
        assert.equal(scans, 3);
        await quiet.clock.fastForward(2000);
        await quiet
          .getByRole("button", { name: "Retry", exact: true })
          .waitFor();
        assert.equal(
          await quiet
            .getByRole("button", { name: "Retry", exact: true })
            .isEnabled(),
          true,
        );
        await quiet.clock.fastForward("30:00");
        assert.equal(scans, 3);
        assert.equal(await quiet.locator(".courses .course").count(), 5);
        await isolated.request.post(base + "/api/fixture/rate-limit", {
          data: { enabled: false },
        });
        const retried = quiet.waitForResponse(
          (r) => r.url().endsWith("/api/scan/commit") && r.ok(),
        );
        await quiet.getByRole("button", { name: "Retry", exact: true }).click();
        await retried;
        await ready();
        assert.equal(scans, 4);
        const reopened = quiet.waitForResponse(
          (r) => r.url().endsWith("/api/scan/commit") && r.ok(),
        );
        await quiet.reload();
        await reopened;
        await ready();
        assert.equal(scans, 5);
      } finally {
        await isolated.request.post(base + "/api/fixture/rate-limit", {
          data: { enabled: false },
        });
        await isolated.close();
      }
    },
  );
  await check(
    "password change and dashboard reset preserve the Schoology connection",
    async () => {
      const original = "synthetic-owner-password-for-tests-only";
      const next = "synthetic-new-password-for-tests-only";
      const reset = "synthetic-dashboard-reset-for-tests-only";
      const login = (client, password) =>
        client.post(base + "/api/login", {
          data: { password },
          headers: { Origin: base },
        });
      const current = await browser.newContext({ ignoreHTTPSErrors: true });
      const other = await browser.newContext({ ignoreHTTPSErrors: true });
      const settings = await current.newPage();
      try {
        assert.equal((await login(current.request, original)).status(), 200);
        assert.equal((await login(other.request, original)).status(), 200);
        await settings.clock.install();
        await settings.goto(base);
        await settings.locator(".courses").waitFor();
        await settings
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await settings
          .getByRole("button", { name: "Change app password", exact: true })
          .click();
        const dialog = settings.getByRole("dialog", {
          name: "Change app password",
          exact: true,
        });
        await dialog
          .getByLabel("Current password", { exact: true })
          .fill(original);
        await dialog.getByLabel("New password", { exact: true }).fill(next);
        await dialog
          .getByLabel("Confirm new password", { exact: true })
          .fill(next);
        await dialog
          .getByRole("button", { name: "Save password", exact: true })
          .click();
        const confirmation = settings.getByText("App password changed.", {
          exact: true,
        });
        await confirmation.waitFor();
        await settings.clock.fastForward(5000);
        await confirmation.waitFor({ state: "hidden" });
        const status = await (
          await current.request.get(base + "/api/status")
        ).json();
        assert.equal(status.authenticated, true);
        assert.equal(status.schoologyConnected, true);
        assert.equal(
          (await (await other.request.get(base + "/api/status")).json())
            .authenticated,
          false,
        );
        assert.equal((await login(other.request, original)).status(), 401);
        assert.equal((await login(other.request, next)).status(), 200);
        assert.equal((await login(other.request, reset)).status(), 200);
        assert.equal((await login(current.request, next)).status(), 401);
        assert.equal(
          (await (await other.request.get(base + "/api/status")).json())
            .schoologyConnected,
          true,
        );
        assert.equal(
          (
            await other.request.post(base + "/api/scan/start", {
              headers: { Origin: base },
              data: {},
            })
          ).status(),
          200,
        );
        assert.equal(
          (
            await other.request.post(base + "/api/password", {
              headers: { Origin: base },
              data: { currentPassword: reset, newPassword: next },
            })
          ).status(),
          200,
        );
        assert.equal((await login(current.request, reset)).status(), 401);
      } finally {
        await current.close();
        await other.close();
      }
    },
  );
  assert.deepEqual(errors, []);
  console.log(`Completed ${completed} browser/integration checks.`);
} catch (e) {
  console.error(e);
  if (browser) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    for (let i = 0; i < pages.length; i++) {
      console.error(
        "Synthetic browser state:",
        await pages[i]
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
      await pages[i]
        .screenshot({ path: directory + `/failure-${i}.png` })
        .catch(() => {});
    }
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
  if (originalDeployment) {
    await writeFile("dist/index.html", originalDeployment.index);
    await writeFile("dist/sw.js", originalDeployment.worker);
  }
}
