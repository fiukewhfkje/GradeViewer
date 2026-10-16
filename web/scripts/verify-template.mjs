// Exercises the real updater in an isolated generated copy, with signed local release assets.
import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { sign } from "node:crypto";
import assert from "node:assert/strict";
import { sha256, parseJsonc } from "./release-lib.mjs";
const temporary = await mkdtemp(join(tmpdir(), "gradeviewer-template-"));
function run(command, args, cwd = temporary, env = {}) {
  const r = spawnSync(command, args, {
    cwd,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", ...env },
    encoding: "utf8",
  });
  if (r.status !== 0)
    throw new Error(`${command} failed: ${(r.stdout + r.stderr).slice(-2500)}`);
  return r.stdout;
}
try {
  const source = JSON.parse(await readFile("release/gradeviewer-source.json"));
  for (const file of source.files) {
    await mkdir(join(temporary, dirname(file.path)), { recursive: true });
    await writeFile(
      join(temporary, file.path),
      Buffer.from(file.content, "base64"),
    );
  }
  const configuration = parseJsonc(
    await readFile(join(temporary, "wrangler.jsonc"), "utf8"),
  );
  configuration.name = "someone-elses-personal-copy";
  configuration.vars = { PERSONAL_SETTING: "retained" };
  await writeFile(
    join(temporary, "wrangler.jsonc"),
    JSON.stringify(configuration),
  );
  await writeFile(
    join(temporary, ".dev.vars"),
    "APP_PASSWORD=synthetic-local-secret-never-in-release\n",
  );
  // The copy is self-contained: dependencies and builds use only this new root.
  run("npm", ["ci"]);
  run("npm", ["run", "build"]);
  run("npm", ["test"]);
  run("npx", [
    "wrangler",
    "deploy",
    "--dry-run",
    "--outdir",
    ".local-test/worker",
  ]);
  const privateKey = await readFile(".local-test/release-signing.pem"),
    publicKey = await readFile("scripts/release-public-key.pem");
  const stub = join(temporary, ".local-test/release-fixtures");
  await mkdir(stub, { recursive: true });
  for (const version of ["0.1.1", "0.1.0"]) {
    const archive = structuredClone(source);
    archive.version = version;
    for (const file of archive.files)
      if (["package.json", "package-lock.json"].includes(file.path)) {
        const json = JSON.parse(Buffer.from(file.content, "base64"));
        json.version = version;
        if (json.packages?.[""]) json.packages[""].version = version;
        const bytes = Buffer.from(JSON.stringify(json, null, 2) + "\n");
        file.content = bytes.toString("base64");
        file.sha256 = sha256(bytes);
      }
    const bytes = Buffer.from(JSON.stringify(archive)),
      manifest = Buffer.from(
        JSON.stringify({
          schema: 1,
          version,
          localSchema: 1,
          archive: "gradeviewer-source.json",
          archiveSha256: sha256(bytes),
        }),
      );
    await mkdir(join(stub, version), { recursive: true });
    await writeFile(join(stub, version, "gradeviewer-source.json"), bytes);
    await writeFile(join(stub, version, "manifest.json"), manifest);
    await writeFile(
      join(stub, version, "manifest.sig"),
      sign(null, manifest, privateKey).toString("base64"),
    );
  }
  const interceptor = join(stub, "intercept.mjs");
  await writeFile(
    interceptor,
    `import {readFile} from 'node:fs/promises';const version=process.env.TEST_RELEASE;globalThis.fetch=async url=>{if(url.startsWith('https://api.github.com/'))return Response.json({tag_name:'v'+version,draft:false,prerelease:false,assets:['manifest.json','manifest.sig','gradeviewer-source.json'].map(name=>({name,browser_download_url:'https://github.com/fiukewhfkje/GradeViewer/releases/download/v'+version+'/'+name}))});return new Response(await readFile(new URL('./'+version+'/'+url.split('/').at(-1),import.meta.url)));};`,
  );
  run("node", ["--import", interceptor, "scripts/update.mjs"], temporary, {
    TEST_RELEASE: "0.1.1",
  });
  assert.equal(
    JSON.parse(await readFile(join(temporary, "package.json"))).version,
    "0.1.1",
  );
  assert.equal(
    JSON.parse(await readFile(join(temporary, "wrangler.jsonc"))).name,
    configuration.name,
  );
  assert.equal(
    (await readFile(join(temporary, ".dev.vars"), "utf8")).includes(
      "synthetic-local-secret",
    ),
    true,
  );
  assert.equal(
    await readFile(join(temporary, "scripts/release-public-key.pem"), "utf8"),
    publicKey.toString(),
  );
  run("npm", ["ci"]);
  run("npm", ["run", "build"]);
  run(
    "node",
    ["--import", interceptor, "scripts/update.mjs", "0.1.0"],
    temporary,
    { TEST_RELEASE: "0.1.0" },
  );
  assert.equal(
    JSON.parse(await readFile(join(temporary, "package.json"))).version,
    "0.1.0",
  );
  run("npm", ["ci"]);
  run("npm", ["run", "build"]);
  console.log(
    "PASS isolated template install/build/dry-run, signed update, configuration/secret retention and explicit rollback.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
