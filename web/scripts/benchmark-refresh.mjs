// Synthetic only: runs the real refresh coordinator and Worker with local transports.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const samples = Number(option("--samples", "9"));
if (!Number.isInteger(samples) || samples < 3 || samples > 50)
  throw new Error("Use 3–50 samples.");
const directory = resolve(".local-test/refresh-benchmark");
await mkdir(directory, { recursive: true });
const hashes = async (paths) =>
  Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
const implementation = await hashes([
  "src/refresh.ts",
  "src/portal-refresh.ts",
  "src/repository.ts",
  "worker/index.ts",
  "worker/portal.ts",
  "worker/provider.ts",
]);
const harness = await hashes([
  "scripts/benchmark-refresh.mjs",
  "tests/refresh-benchmark.ts",
  "tests/fixture-worker.ts",
  "tests/campus-fixture.ts",
  "tests/schoology-fixture.ts",
]);
const bundle = resolve(directory, "runner.mjs");
await build({
  entryPoints: ["tests/refresh-benchmark.ts"],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const { benchmarkRefresh } = await import(pathToFileURL(bundle).href);
const report = await benchmarkRefresh(samples);
report.source = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
report.dirty = !!execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).trim();
report.recordedAt = new Date().toISOString();
report.node = process.version;
report.implementation = implementation;
report.harness = harness;
const comparison = option("--compare");
if (comparison) {
  const before = JSON.parse(await readFile(comparison, "utf8"));
  if (JSON.stringify(before.conditions) !== JSON.stringify(report.conditions))
    throw new Error("Benchmark conditions differ.");
  if (JSON.stringify(before.harness) !== JSON.stringify(report.harness))
    throw new Error("Benchmark harness differs.");
  for (const result of report.results) {
    const prior = before.results.find((x) => x.scenario === result.scenario);
    if (!prior || prior.digest !== result.digest)
      throw new Error("Snapshot changed: " + result.scenario);
    if (
      result.providerRequests > prior.providerRequests ||
      result.peakConcurrency > prior.peakConcurrency
    )
      throw new Error("Provider load increased: " + result.scenario);
    result.beforeMedianMs = prior.medianMs;
    result.improvementPercent =
      Math.round((1 - result.medianMs / prior.medianMs) * 1000) / 10;
  }
}
const output = resolve(option("--output", directory + "/latest.json"));
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.table(
  report.results.map(({ samplesMs, digest, ...summary }) => summary),
);
console.log("Synthetic benchmark saved to " + output);
