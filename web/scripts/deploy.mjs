import { spawn } from "node:child_process";
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
export async function deploy(environment = process.env, run = invoke) {
  const password = environment.APP_PASSWORD;
  if (password && password.length < 20)
    throw new Error("Choose an APP_PASSWORD of at least 20 characters.");
  const childEnv = { ...environment };
  delete childEnv.APP_PASSWORD;
  // Cloudflare's import form exposes build secrets before runtime settings exist.
  // Apply that one password as a runtime secret without placing it in argv or a file.
  if (password)
    await run(
      ["secret", "bulk"],
      childEnv,
      JSON.stringify({ APP_PASSWORD: password }),
    );
  await run(["deploy"], childEnv);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await deploy();
