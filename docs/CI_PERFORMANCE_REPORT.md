# CI and release preparation measurements — November 12, 2026

This is the first CI pass. The later [follow-up report](FURTHER_PERFORMANCE_REPORT.md) records native locked browsers, focused WebKit coverage, isolated browser-check overlap and a fresh deployed-code baseline. The figures and container decision below remain the historical measurements for this first pass.

This pass changes development verification and source packaging. It does not change provider traffic, publish a release or deploy a Worker. The loading/motion preview is separate and remains available on synthetic localhost.

## Changes retained

- Functional browser flows use the existing Reduce motion behavior. Dedicated Chromium/WebKit contexts still test full motion, preference changes, interrupted disclosures, loader truthfulness, navigation and open forms. Both engines continue to run all 42 flows.
- Synthetic sign-in progress waits at a Worker barrier until the fixture sign-in is ready. This exercises the real automatic completion path without waiting for the next two-second timer. The former page-route barrier was unreliable for requests routed through a service worker; its unused helper is removed.
- Related pure input variants share 284 named unit checks instead of 336 separately registered checks. Every table input and assertion is retained. The six consolidated files have the same 418 `expect` call sites before/after. Authentication, cooldowns, request budgets, data preservation, calculations and update verification retain their coverage. This consolidation does **not** materially improve unit runtime.
- CI overlaps independent unit checks with Chromium build/browser work. It waits for the unit process and fails if the unit checks, build or browser checks fail. The browser build must succeed before browser testing starts. WebKit remains independent; release publication still requires both matrix jobs to succeed.
- Source packaging uses only Node built-ins and repository files. The PR provenance check no longer installs dependencies just to package source. The release job no longer installs/builds a third time after both verification jobs built/type-checked the same tagged source. Matching official-tag publication and exact workflow/tag/commit provenance policies are unchanged.
- The pinned Playwright container and version compatibility check remain. A native-runner experiment completed WebKit but crashed a Chromium target; it was rejected. No test or timeout was relaxed to accept it.

## Measurement method and limits

Hosted runs use the same development branch, lockfile, two engines and synthetic fixtures. The original run includes the completed motion UI at `c744563`; the accepted final source is recorded in the raw hosted report. Browser requests stay inside the local fixture Worker. Container pulls, runner scheduling and machine speed vary, so these are observed run comparisons rather than a latency guarantee.

Local unit and release-preparation measurements use Node 26.7.0 on the same Mac, with one discarded warm-up and three measured samples. The packaging comparison freezes the `c744563` source in an isolated copy. Before: `npm ci`, `npm run build`, `npm run release:package`. After: remove only that isolated copy's dependencies, then `npm run release:package`. All eight generated source archives have the identical SHA-256. Dependency-free packaging also passes with Node 24, matching CI. Package output remains local and unsigned.

The local unit medians are **6.832 → 6.951 seconds**, effectively unchanged. Source release preparation improves **7.003 → 0.206 seconds**, about **97%**. Removing repeated setup, browser animation waits and polling waits supplies the practical improvement.

| Hosted measurement | Before | After |
| --- | ---: | ---: |
| Slowest verification job | 154 s | 124 s |
| Complete dispatch, including scheduling/cleanup | 159 s | 129 s |
| WebKit browser step | 92 s | 58 s |

The verification path improves about **20%** in this pair. The complete dispatch improves about **19%**. The intermediate container run took 133 seconds for its slowest job; overlapping unit checks reduces that to 124 seconds. Runner/image timing varies, so the individual job/step samples remain available rather than being treated as a guarantee.

[Before hosted run](https://github.com/fiukewhfkje/GradeViewer/actions/runs/43274508084) · [Accepted final hosted run](https://github.com/fiukewhfkje/GradeViewer/actions/runs/43277337084). Both complete all 42 flows in each browser; the final run also passes all 284 unit checks, build/type check and production Worker dry-run. PR attestation and tag publication jobs are correctly skipped on these development dispatches.

## Evidence and reproduction

- [Raw local samples, input counts and archive digests](benchmarks/ci-2026-11-12-local.json).
- [Raw hosted run/step measurements and rejected experiment](benchmarks/ci-2026-11-12-hosted.json).
- Run `npm test -- --reporter=json` at each source revision for unit measurements, discarding the first of four runs. The raw report records the named-case counts and all measured samples.
- For packaging, extract `web/` from `c744563` into an ignored isolated copy inside the repository, run the before/after commands above and compare `release/gradeviewer-source.json` hashes. Do not remove dependencies or state from a real installation for the benchmark.
- Repeat hosted verification with `gh workflow run pwa.yml --ref codex/grade-refresh-optimizations`. Its dispatch path runs verification only; release publication requires the official matching tag.

[Playwright's CI documentation](https://playwright.dev/docs/ci) describes container and native dependency installation options. [GitHub's caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) documents dependency-cache behavior. This pass retains the existing npm cache and proven browser container.

No new tag, signature, release, main merge or deployment was performed. Actual GitHub publication/attestation service latency and Cloudflare build/upload latency have not been benchmarked by publishing or deploying; the measured release improvement is preparation, and the full release still has its existing verification/signing/publication gates.
