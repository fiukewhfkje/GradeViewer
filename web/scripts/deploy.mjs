import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const wrangler = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
function invoke(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      env,
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", () =>
      reject(new Error("Unable to start the Cloudflare deployment tool.")),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Cloudflare deployment command failed.")),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}
export async function deploy(
  environment = process.env,
  run = invoke,
  args = [],
) {
  const password = environment.APP_PASSWORD;
  if (password && password.length < 12)
    throw new Error("Choose an APP_PASSWORD of at least 12 characters.");
  const childEnv = { ...environment };
  delete childEnv.APP_PASSWORD;
  if (!password) return run(["deploy", ...args], childEnv);
  // Upload the password with this code version. Separate secret edits can fail
  // after a rollback or accidentally deploy a different version first.
  const directory = await mkdtemp(join(tmpdir(), "gradeviewer-deploy-"));
  try {
    const secretsFile = join(directory, "secrets.json");
    await writeFile(secretsFile, JSON.stringify({ APP_PASSWORD: password }), {
      mode: 0o600,
      flag: "wx",
    });
    await run(["deploy", ...args, "--secrets-file", secretsFile], childEnv);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await deploy(process.env, invoke, process.argv.slice(2));
