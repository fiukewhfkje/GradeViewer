// Explicit, opt-in production-path verification. All storage is ephemeral memory.
import "fake-indexeddb/auto";
import { build } from "esbuild";
import { randomBytes } from "node:crypto";
const credentials = {
  key: process.env.SCHOOLOGY_API_KEY,
  secret: process.env.SCHOOLOGY_API_SECRET,
};
if (!credentials.key || !credentials.secret)
  throw new Error("Configured Schoology credentials are required.");
const compiled = await build({
  stdin: {
    contents:
      "export {CredentialVault} from './worker/index'; export {readSnapshot} from './src/refresh'; export {emptyState} from './src/core/model';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { CredentialVault, readSnapshot, emptyState } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
const storage = new Map(),
  password = randomBytes(32).toString("hex"),
  vault = new CredentialVault(
    {
      storage: {
        get: async (k) => structuredClone(storage.get(k)),
        put: async (k, v) => {
          storage.set(k, structuredClone(v));
        },
      },
    },
    { APP_PASSWORD: password },
  );
const nativeFetch = globalThis.fetch;
let cookie = "",
  requests = 0;
globalThis.fetch = async (path, init = {}) => {
  if (!String(path).startsWith("/api/")) return nativeFetch(path, init);
  requests++;
  const headers = new Headers(init.headers);
  headers.set("Origin", "https://verification.invalid");
  headers.set("Cookie", cookie);
  const response = await vault.fetch(
    new Request("https://verification.invalid" + path, { ...init, headers }),
  );
  if (response.headers.has("Set-Cookie"))
    cookie = response.headers.get("Set-Cookie").split(";")[0];
  return response;
};
try {
  await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const status = await (await fetch("/api/status")).json();
  const state = await readSnapshot(emptyState(), status, credentials);
  const coldRequests = requests;
  requests = 0;
  const warmStatus = await (await fetch('/api/status')).json();
  const warm = await readSnapshot(state, warmStatus);
  console.log(
    JSON.stringify({
      authenticated: true,
      completeSnapshot: true,
      coursePeriods: state.courses.length,
      allAccountBound: state.courses.every(
        (c) => c.fields.user_id === state.account,
      ),
      coldRequests,
      warmRequests: requests,
      warmSnapshotComplete: warm.courses.length === state.courses.length,
    }),
  );
} catch (e) {
  console.log(
    JSON.stringify({
      completeSnapshot: false,
      error: e.code ?? e.message,
      status: e.status,
      requests,
    }),
  );
  process.exitCode = 1;
} finally {
  storage.clear();
  globalThis.fetch = nativeFetch;
}
