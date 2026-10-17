// Exercises the real updater in an isolated generated copy, with signed local release assets.
import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
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
  const publicKey = await readFile("scripts/release-public-key.pem");
  const stub = join(temporary, ".local-test/release-fixtures");
  await mkdir(stub, { recursive: true });
  const current = source.version;
  const pieces = current.split(".").map(Number);
  const newer = `${pieces[0]}.${pieces[1]}.${pieces[2] + 1}`;
  for (const version of [newer, current]) {
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
          schema: 2,
          verification: "github-attestation",
          sourceCommit: "a".repeat(40),
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
      join(stub, version, "provenance.json"),
      JSON.stringify({ synthetic: true, manifestSha256: sha256(manifest) }),
    );
  }
  const interceptor = join(stub, "intercept.mjs");
  await writeFile(
    interceptor,
    `import {readFile} from 'node:fs/promises';const version=process.env.TEST_RELEASE;globalThis.fetch=async url=>{if(url.startsWith('https://api.github.com/'))return Response.json({tag_name:'v'+version,draft:false,prerelease:false,assets:['manifest.json','provenance.json','gradeviewer-source.json'].map(name=>({name,browser_download_url:'https://github.com/fiukewhfkje/GradeViewer/releases/download/v'+version+'/'+name}))});return new Response(await readFile(new URL('./'+version+'/'+url.split('/').at(-1),import.meta.url)));};`,
  );
  // Only this isolated application/preservation test substitutes gh. The real
  // Sigstore verifier is exercised against an actual GitHub attestation in CI.
  const fixtureBin = join(stub, "bin");
  await mkdir(fixtureBin, { recursive: true });
  await writeFile(
    join(fixtureBin, "gh"),
    `#!/usr/bin/env node
import fs from 'node:fs';import crypto from 'node:crypto';
const args=process.argv.slice(2), path=args[2], bundle=args[args.indexOf('--bundle')+1];
const bytes=fs.readFileSync(path), manifest=JSON.parse(bytes), proof=JSON.parse(fs.readFileSync(bundle));
const valid=proof.synthetic && proof.manifestSha256===crypto.createHash('sha256').update(bytes).digest('hex') &&
  args.includes('fiukewhfkje/GradeViewer') && args.includes('fiukewhfkje/GradeViewer/.github/workflows/pwa.yml') &&
  args.includes('refs/tags/v'+manifest.version) && args.includes(manifest.sourceCommit) && args.includes('--deny-self-hosted-runners');
process.exit(valid?0:1);
`,
    { mode: 0o755 },
  );
  const fixturePath = fixtureBin + ":" + process.env.PATH;
  run("node", ["--import", interceptor, "scripts/update.mjs"], temporary, {
    TEST_RELEASE: newer,
    PATH: fixturePath,
  });
  assert.equal(
    JSON.parse(await readFile(join(temporary, "package.json"))).version,
    newer,
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
    ["--import", interceptor, "scripts/update.mjs", current],
    temporary,
    { TEST_RELEASE: current, PATH: fixturePath },
  );
  assert.equal(
    JSON.parse(await readFile(join(temporary, "package.json"))).version,
    current,
  );
  run("npm", ["ci"]);
  run("npm", ["run", "build"]);
  console.log(
    "PASS isolated template install/build/dry-run, attested-update fixture, configuration/secret retention and explicit rollback (cryptographic provenance is checked separately in CI).",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
