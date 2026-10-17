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
  await Promise.race([
    new Promise((r) => server.once("exit", r)),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
}
async function check(name, run) {
  let timer;
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
    console.log("PASS " + name);
  } finally {
    clearTimeout(timer);
  }
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
    const shell = await fetch(base);
    assert.match(
      shell.headers.get("Content-Security-Policy"),
      /default-src 'self'/,
    );
    assert.equal(shell.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(shell.headers.get("Cache-Control"), "no-cache");
    const installation = await (await fetch(base + "/installation.json")).json();
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
    await page.getByLabel("Schoology API key", { exact: true }).fill("fixture");
    await page
      .getByLabel("Schoology API secret", { exact: true })
      .fill("fixture-secret");
    await page
      .getByRole("button", { name: "Connect Schoology", exact: true })
      .click();
    await page.getByRole("button", { name: /AP Biology/ }).waitFor();
    assert.equal(await page.locator(".course").count(), 5);
    await page.screenshot({ path: directory + "/home-light.png" });
  });
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
      const send = (type, x = 30, y = 170) =>
        touch
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
      try {
        await page.evaluate(() =>
          document.querySelector(".app-scroll").scrollTo(0, 0),
        );
        await send("touchStart");
        await send("touchMove", 30, 195);
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
        await send("touchMove", 30, 330);
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
        await send("touchMove", 30, 330);
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
        await send("touchMove", 30, 250);
        await send("touchMove", 30, 330);
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
        await send("touchMove", 30, 330);
        await send("touchEnd");
        await committed;
        await page.unroute("**/api/scan/roots");
        await page.waitForFunction(
          () => !document.querySelector(".desktop-refresh")?.disabled,
        );
        await page.locator('.pull-refresh[data-phase="idle"]').waitFor();
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
          .getByRole("button", { name: "Profile", exact: true })
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
  await check("same home/detail overall and graph", async () => {
    const homeGrade = await page
      .getByRole("button", { name: /AP Biology/ })
      .locator(".grade")
      .innerText();
    await page.getByRole("button", { name: /AP Biology/ }).click();
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
    await page.getByRole("button", { name: /AP Biology/ }).waitFor();
  });
  await check(
    "phone layout, dark mode, personal URL and installation help",
    async () => {
      await page.getByRole("button", { name: "Profile", exact: true }).click();
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
    "Profile update check reports current version and offline state",
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
      await page.getByRole("button", { name: /AP Biology/ }).waitFor();
      await page.getByRole("button", { name: /AP Biology/ }).click();
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
      await page.getByRole("button", { name: /AP Biology/ }).waitFor();
      await page.getByRole("button", { name: /AP Biology/ }).click();
      assert.match(await page.locator(".rows").first().innerText(), /102.25/);
      await page.getByLabel("Close course", { exact: true }).click();
    },
  );
  await check(
    "interrupted local activation recovers the prepared snapshot on reload",
    async () => {
      await page.getByRole("button", { name: "Profile", exact: true }).click();
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
      await page.getByRole("button", { name: /AP Biology/ }).waitFor();
      await page.getByRole("button", { name: /AP Biology/ }).click();
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
      await page.getByRole("button", { name: /AP Biology/ }).waitFor();
      assert.equal(
        (await (await context.request.get(base + "/api/status")).json())
          .connected,
        true,
      );
    },
  );
  await check(
    "offline shell gates stale grades and preserves saved snapshot",
    async () => {
      await page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
      });
      await context.setOffline(true);
      await page.reload();
      await page
        .getByRole("button", { name: "Profile", exact: true })
        .waitFor();
      assert.equal(await page.locator(".course").count(), 0);
      await page.getByRole("alert").waitFor();
      assert.match(
        await page.locator("body").innerText(),
        /connection|internet|unavailable/i,
      );
      await context.setOffline(false);
      await page.reload();
      await page.getByRole("button", { name: /AP Biology/ }).waitFor();
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
      await page.getByRole("button", { name: "Profile", exact: true }).click();
      await page
        .getByRole("button", { name: "Update connection", exact: true })
        .click();
      await page
        .getByLabel("Schoology API key", { exact: true })
        .fill("fixture-unsaved");
      const otherTab = await context.newPage();
      await otherTab.goto(base);
      await otherTab.getByRole("button", { name: /AP Biology/ }).waitFor();
      const firstVisit = await browser.newContext({
        ignoreHTTPSErrors: true,
        storageState: await context.storageState(),
      });
      const freshPage = await firstVisit.newPage();
      try {
        // This page mounts before its first worker claims it; it is never reloaded
        // until Update now is clicked. A captured startup-controller flag fails here.
        await freshPage.goto(base);
        await freshPage.getByRole("button", { name: /AP Biology/ }).waitFor();
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
          .getByRole("button", { name: "Profile", exact: true })
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
        await freshPage.getByRole("button", { name: /AP Biology/ }).waitFor();
        // This page shares the original tab's worker and really changes its controller.
        await otherTab
          .getByRole("button", { name: "Profile", exact: true })
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
          .getByRole("button", { name: "Profile", exact: true })
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
        await page.getByRole("button", { name: /AP Biology/ }).waitFor();
        await page.getByRole("button", { name: /AP Biology/ }).click();
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
    "failure retains records and Profile/Retry remain usable",
    async () => {
      // A server-side fixture works with service workers in both engines.
      // Browser request interception does not cover WebKit service-worker fetches.
      await context.request.post(base + "/api/fixture/failure", {
        data: { enabled: true },
      });
      await page.getByRole("button", { name: "Profile", exact: true }).click();
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
      await page
        .getByRole("heading", { name: "Fresh grades unavailable", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Profile", exact: true }).click();
      await page
        .getByRole("heading", { name: "Your personal website", exact: true })
        .waitFor();
      await context.request.post(base + "/api/fixture/failure", {
        data: { enabled: false },
      });
      await page.getByRole("button", { name: "Grades", exact: true }).click();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.getByRole("button", { name: /AP Biology/ }).waitFor();
    },
  );
  await check(
    "a second tab synchronizes local changes without refresh loops",
    async () => {
      const other = await context.newPage();
      await other.goto(base);
      await other.getByRole("button", { name: /AP Biology/ }).waitFor();
      await page.waitForTimeout(250);
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
        await secondPage.getByRole("button", { name: /AP Biology/ }).waitFor();
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
        await appPage.getByRole("button", { name: /AP Biology/ }).waitFor();
        assert.equal(await appPage.evaluate(() => navigator.standalone), true);
        touch =
          engine === "chromium"
            ? await installed.newCDPSession(appPage)
            : undefined;
        const send = async (type, y = 180) => {
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
          await send("touchStart");
          await send("touchMove", 260);
          await send("touchMove", 350);
        };
        await pull();
        await send("touchMove", 190); // Reversing below the threshold disarms it.
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
  await check("disconnect clears data and revokes sessions", async () => {
    await page.getByRole("button", { name: "Profile", exact: true }).click();
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
    "desktop sample mode stays separate from real persistent data",
    async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page
        .getByRole("button", { name: "Try sample grades", exact: true })
        .click();
      await page.getByRole("button", { name: /AP Biology/ }).waitFor();
      await page.screenshot({ path: directory + "/desktop-demo.png" });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(
        (await (await context.request.get(base + "/api/status")).json())
          .connected,
        false,
      );
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
