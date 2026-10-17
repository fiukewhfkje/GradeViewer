import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  symlink,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error Plain Node release tooling.
import * as updater from "../scripts/update.mjs";
const { applyRelease, update, mergeConfiguration } = updater;
// @ts-expect-error Plain Node release tooling.
import { sha256 } from "../scripts/release-lib.mjs";
// @ts-expect-error Plain Node release tooling.
import { workflow } from "../scripts/updater-workflow.mjs";
// @ts-expect-error Plain Node release tooling.
import { installationInfo } from "../scripts/installation.mjs";
// @ts-expect-error Plain Node release tooling.
import { cloudflareBuildStatus } from "../scripts/deployment-status.mjs";
// @ts-expect-error Plain Node release tooling.
import { releaseArguments } from "../scripts/publish-release.mjs";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const config = {
  name: "independent-worker",
  account_id: "synthetic-account",
  vars: { PERSONAL: "keep" },
  env: { test: { vars: { CUSTOM: "keep" } } },
  durable_objects: {
    bindings: [
      {
        name: "VAULT",
        class_name: "CredentialVault",
        script_name: "existing-vault",
      },
    ],
  },
  migrations: [{ tag: "v1", new_sqlite_classes: ["CredentialVault"] }],
};
async function checkout() {
  const cwd = await mkdtemp(join(tmpdir(), "gradeviewer-updater-test-"));
  directories.push(cwd);
  await mkdir(join(cwd, "scripts"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ version: "0.1.3" }),
  );
  await writeFile(join(cwd, "wrangler.jsonc"), JSON.stringify(config));
  await writeFile(
    join(cwd, ".dev.vars"),
    "APP_PASSWORD=synthetic-private-value",
  );
  await writeFile(join(cwd, "scripts/update.mjs"), "existing trusted verifier");
  return cwd;
}
function release(
  extra: Record<string, string> = {},
  version = "0.1.4",
  protocol: number | undefined = 1,
) {
  const values = {
    "package.json": JSON.stringify({ version }),
    "package-lock.json": JSON.stringify({ version }),
    "wrangler.jsonc": JSON.stringify({
      ...config,
      name: "upstream-default",
      vars: {},
      account_id: "upstream-account",
    }),
    "worker/index.ts": "synthetic release code",
    "src/App.tsx": "synthetic app",
    "scripts/update.mjs": "new verified updater",
    ...extra,
  };
  const archive = Buffer.from(
    JSON.stringify({
      version,
      files: Object.entries(values).map(([path, value]) => {
        const bytes = Buffer.from(value);
        return {
          path,
          content: bytes.toString("base64"),
          sha256: sha256(bytes),
        };
      }),
    }),
  );
  const manifest = Buffer.from(
    JSON.stringify({
      schema: 2,
      verification: "github-attestation",
      version,
      sourceCommit: "a".repeat(40),
      localSchema: 1,
      updaterProtocol: protocol,
      archive: "gradeviewer-source.json",
      archiveSha256: sha256(archive),
    }),
  );
  return { archive, manifest };
}
it("places the exact canonical workflow at both full-repository and isolated-template roots", async () => {
  const paths = [".github/workflows/gradeviewer-update.yml"];
  if (
    (await readFile("../AGENTS.md", "utf8").catch(() => "")).includes(
      "GradeViewer development",
    )
  )
    paths.push("../.github/workflows/gradeviewer-update.yml");
  for (const path of paths) expect(await readFile(path, "utf8")).toBe(workflow);
  expect(workflow).toContain(
    "cron: '0 0 * * *'\n      timezone: America/New_York",
  );
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("contents: write");
});
it("detects a Cloudflare-style copy with workflows omitted instead of claiming automatic setup succeeded", async () => {
  const cwd = await checkout();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "ignore" });
  git("init", "--initial-branch=main");
  git(
    "remote",
    "add",
    "origin",
    "https://github.com/synthetic-owner/personal-copy.git",
  );
  expect(await installationInfo(cwd, {})).toMatchObject({
    repository: "synthetic-owner/personal-copy",
    automation: "missing",
  });
  await mkdir(join(cwd, ".github/workflows"), { recursive: true });
  await writeFile(
    join(cwd, ".github/workflows/gradeviewer-update.yml"),
    workflow,
  );
  expect(await installationInfo(cwd, {})).toMatchObject({
    automation: "installed",
  });
});
it("preserves Worker identity, personal configuration, encrypted-vault binding, secrets and installed workflow", async () => {
  const cwd = await checkout();
  await mkdir(join(cwd, ".github/workflows"), { recursive: true });
  await writeFile(
    join(cwd, ".github/workflows/gradeviewer-update.yml"),
    workflow,
  );
  const r = release({
    ".github/workflows/gradeviewer-update.yml": "changed permissions",
  });
  await applyRelease(r.manifest, r.archive, { cwd });
  expect(
    JSON.parse(await readFile(join(cwd, "wrangler.jsonc"), "utf8")),
  ).toMatchObject(config);
  expect(await readFile(join(cwd, ".dev.vars"), "utf8")).toBe(
    "APP_PASSWORD=synthetic-private-value",
  );
  expect(
    await readFile(
      join(cwd, ".github/workflows/gradeviewer-update.yml"),
      "utf8",
    ),
  ).toBe(workflow);
  expect(await readFile(join(cwd, "scripts/update.mjs"), "utf8")).toBe(
    "new verified updater",
  );
});
it("keeps the installed verifier through rollback and legacy releases", async () => {
  for (const [rollback, protocol] of [
    [true, 1],
    [false, undefined],
  ] as const) {
    const cwd = await checkout(),
      r = release({}, "0.1.2", protocol);
    // Explicit undefined is represented by deleting the protocol field.
    const manifest = JSON.parse(r.manifest.toString());
    if (protocol === undefined) delete manifest.updaterProtocol;
    await applyRelease(Buffer.from(JSON.stringify(manifest)), r.archive, {
      cwd,
      rollback,
    });
    expect(await readFile(join(cwd, "scripts/update.mjs"), "utf8")).toBe(
      "existing trusted verifier",
    );
  }
});
it("rejects tampering, unsupported launchers, secret paths and symlink parents before changing files", async () => {
  for (const kind of ["tamper", "protocol", "secret", "symlink"]) {
    const cwd = await checkout();
    const r = release(
      kind === "secret" ? { "src/.env.production": "forbidden" } : {},
      "0.1.4",
      kind === "protocol" ? 2 : 1,
    );
    if (kind === "symlink") await symlink(tmpdir(), join(cwd, "worker"));
    await expect(
      applyRelease(
        r.manifest,
        kind === "tamper" ? Buffer.from("tampered") : r.archive,
        { cwd },
      ),
    ).rejects.toThrow();
    expect(
      JSON.parse(await readFile(join(cwd, "package.json"), "utf8")).version,
    ).toBe("0.1.3");
  }
});
it("restores originals when a checkout write fails midway", async () => {
  const cwd = await checkout(),
    r = release();
  let writes = 0;
  await expect(
    applyRelease(r.manifest, r.archive, {
      cwd,
      move: async (from: string, to: string) => {
        if (++writes === 2) throw new Error("synthetic disk failure");
        await rename(from, to);
      },
    }),
  ).rejects.toThrow("disk failure");
  expect(
    JSON.parse(await readFile(join(cwd, "package.json"), "utf8")).version,
  ).toBe("0.1.3");
});
it("does not mutate the checkout or fetch source until provenance has been verified", async () => {
  const cwd = await checkout(),
    r = release();
  const assets = [
    "manifest.json",
    "provenance.json",
    "gradeviewer-source.json",
  ];
  const metadata = {
    tag_name: "v0.1.4",
    draft: false,
    prerelease: false,
    assets: assets.map((name) => ({
      name,
      browser_download_url: `https://github.com/fiukewhfkje/GradeViewer/releases/download/v0.1.4/${name}`,
    })),
  };
  let sourceReads = 0;
  await expect(
    update(undefined, {
      cwd,
      get: async (url: string) => {
        if (url.endsWith("/latest"))
          return Buffer.from(JSON.stringify(metadata));
        if (url.endsWith("manifest.json")) return r.manifest;
        if (url.endsWith("provenance.json")) return Buffer.from("{}");
        sourceReads++;
        return r.archive;
      },
      verify: async () => {
        throw new Error("signature rejected");
      },
    }),
  ).rejects.toThrow("signature rejected");
  expect(sourceReads).toBe(0);
  expect(
    JSON.parse(await readFile(join(cwd, "package.json"), "utf8")).version,
  ).toBe("0.1.3");
});
it("commits a monthly keepalive without rebuilding every unchanged day", async () => {
  const cwd = await checkout();
  const options = {
    cwd,
    get: async () =>
      Buffer.from(
        JSON.stringify({ tag_name: "v0.1.3", draft: false, prerelease: false }),
      ),
  };
  await update(undefined, {
    ...options,
    now: new Date("2026-10-01T04:00:00Z"),
  });
  const first = await readFile(join(cwd, ".gradeviewer-update.json"), "utf8");
  await update(undefined, {
    ...options,
    now: new Date("2026-10-02T04:00:00Z"),
  });
  expect(await readFile(join(cwd, ".gradeviewer-update.json"), "utf8")).toBe(
    first,
  );
  await update(undefined, {
    ...options,
    now: new Date("2026-10-29T04:00:00Z"),
  });
  expect(
    await readFile(join(cwd, ".gradeviewer-update.json"), "utf8"),
  ).not.toBe(first);
});
it("refuses a conflicting credential namespace or migration history", () => {
  expect(() =>
    mergeConfiguration(config, {
      migrations: [{ tag: "v1", deleted_classes: ["CredentialVault"] }],
    }),
  ).toThrow("Migration history conflict");
  expect(() =>
    mergeConfiguration(config, {
      durable_objects: {
        bindings: [{ name: "VAULT", class_name: "OtherVault" }],
      },
    }),
  ).toThrow("namespace");
});
it("uses only actual Cloudflare checks and bounds deployment retries", async () => {
  expect(
    cloudflareBuildStatus({
      check_runs: [
        {
          app: { slug: "github-actions" },
          status: "completed",
          conclusion: "failure",
        },
      ],
    }),
  ).toBe("unknown");
  expect(
    cloudflareBuildStatus({
      check_runs: [
        {
          app: { slug: "cloudflare-workers-and-pages" },
          status: "completed",
          conclusion: "failure",
        },
      ],
    }),
  ).toBe("failed");
  const cwd = await checkout();
  const options = {
    cwd,
    get: async () =>
      Buffer.from(
        JSON.stringify({ tag_name: "v0.1.3", draft: false, prerelease: false }),
      ),
    deployment: () => "failed",
  };
  for (let i = 1; i <= 3; i++) {
    await update(undefined, options);
    expect(
      JSON.parse(await readFile(join(cwd, ".gradeviewer-update.json"), "utf8"))
        .deploymentRetries,
    ).toBe(i);
  }
  await expect(update(undefined, options)).rejects.toThrow("failed repeatedly");
});
it("publishes previews only as explicit prereleases and protects the stable latest channel", () => {
  const env = {
    GITHUB_REPOSITORY: "fiukewhfkje/GradeViewer",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: "v0.1.4-rc.1",
  };
  expect(releaseArguments("0.1.4-rc.1", env)).toEqual(
    expect.arrayContaining(["--prerelease", "--latest=false"]),
  );
  expect(
    releaseArguments("0.1.4", { ...env, GITHUB_REF_NAME: "v0.1.4" }),
  ).toContain("--latest");
  expect(() => releaseArguments("0.1.4", env)).toThrow();
});
