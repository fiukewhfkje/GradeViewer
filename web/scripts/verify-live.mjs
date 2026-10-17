// Opt-in only. Never run in CI. Credentials and provider payloads stay in memory.
import { build } from "esbuild";
const key = process.env.SCHOOLOGY_API_KEY,
  secret = process.env.SCHOOLOGY_API_SECRET;
if (!key || !secret) {
  console.log(JSON.stringify({ credentialsPresent: false }));
  process.exit(1);
}
const compiled = await build({
  stdin: {
    contents: "export {readProvider} from './worker/provider';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { readProvider } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
try {
  const result = await readProvider("users/me", { key, secret });
  console.log(
    JSON.stringify({
      networkReached: true,
      authenticated: !!(result.uid ?? result.id),
    }),
  );
} catch (e) {
  console.log(
    JSON.stringify({
      networkReached: e.code !== "providerUnavailable",
      authenticated: false,
      error: e.code ?? "unavailable",
      status: e.status,
    }),
  );
  process.exitCode = 1;
}
