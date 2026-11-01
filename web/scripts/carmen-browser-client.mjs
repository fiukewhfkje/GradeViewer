// Operator-only Browser Run adapter. Never print child-process errors or URLs.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const project = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);
export function createBrowserClient(
  directory,
  timed = async (_, task) => task(),
) {
  let token;
  const sessions = new Map();
  async function command(args) {
    const { stdout } = await execute(
      process.execPath,
      [join(project, "node_modules/wrangler/bin/wrangler.js"), ...args],
      {
        cwd: project,
        timeout: 25_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
        },
      },
    );
    return JSON.parse(stdout.trim());
  }
  return {
    async open() {
      if (!token) {
        const credential = await timed("cloudflareCredentialsCLI", () =>
          command(["auth", "token", "--json"]),
        );
        assert.equal(typeof credential.token, "string");
        assert.ok(credential.token);
        token = credential.token;
      }
      const session = await timed("createSessionCLI", () =>
        command([
          "browser",
          "create",
          "--keepAlive",
          "60",
          "--json",
          "--open=false",
        ]),
      );
      assert.match(session.sessionId, /^[a-f0-9-]{36}$/);
      sessions.set(session.sessionId, undefined);
      const endpoint = new URL(session.webSocketDebuggerUrl);
      assert.equal(endpoint.protocol, "wss:");
      assert.equal(endpoint.hostname, "api.cloudflare.com");
      assert.equal(endpoint.port + endpoint.username + endpoint.password, "");
      assert.match(
        endpoint.pathname,
        /^\/client\/v4\/accounts\/[a-f0-9]+\/browser-(?:rendering|run)\/devtools\/browser\/[a-f0-9-]{36}$/,
      );
      assert.ok(endpoint.pathname.endsWith("/" + session.sessionId));
      const browser = await timed("connectCDP", () =>
        chromium.connectOverCDP(endpoint.href, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15_000,
        }),
      );
      sessions.set(session.sessionId, browser);
      return { id: session.sessionId, browser };
    },
    async close(id) {
      assert.ok(sessions.has(id));
      try {
        await sessions.get(id)?.close();
      } finally {
        await timed("closeSessionCLI", () =>
          command(["browser", "close", id, "--json"]),
        );
        sessions.delete(id);
      }
    },
    async cleanup() {
      let success = true;
      for (const id of sessions.keys()) {
        try {
          await this.close(id);
        } catch {
          success = false;
        }
      }
      token = undefined;
      return success;
    },
  };
}
