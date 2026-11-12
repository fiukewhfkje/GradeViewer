# Three-stage refresh comparison — November 12, 2026

This is the requested **before / middle / after** comparison: original production code (`aea38d3`), completed first pass (`9fa3f85`) and completed second-pass code. All three use exactly the same benchmark/fixture hashes, 16 scenarios and nine independently seeded timed samples plus one discarded warm-up per scenario. The archived implementations are checked against every measured production file in their declared Git refs. The second-pass report records its exact implementation hashes before commit.

These are **local synthetic timings**, not measured changes to the owner's deployment. The owner reported roughly 3–4 seconds on first open and 3–3.5 seconds manually. The slower fixture deliberately models longer I/O; its numerical similarity to that report does not establish the owner's actual provider latency or predict a device result. No live grade requests, human sign-in, Browser Run quota or production deployment were used.

The driver runs the real Worker, status/start coordinator, parsing, reconciliation and complete browser-local activation. Default delays are 80 ms per app round trip and 80 ms per provider read; uneven IC details take `[320, 40, 40, 320, 40, 40]` ms. The two slower combined cases use 120 ms app round trips and 250 ms provider reads. The profile-bound IC case exercises the existing verified-profile jar behavior, including its existing omission of unsupported roster verification; this pass does not broaden that policy. Owner login/connector sign-in, fixture priming, React rendering and actual Worker/WAN/storage performance are outside the timed interval. Each measured refresh begins before status and ends after complete local persistence, never at cached first paint.

| Scenario | Original p50 / p95 ms | Pass 1 p50 / p95 ms | Pass 2 p50 / p95 ms | Faster vs original / pass 1 | App requests | Provider reads |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial key connection | 839.9 / 857.3 | 767.2 / 776.1 | 773.6 / 776.3 | 7.9% / -0.8% | 4 → 3 → 3 | 23 → 23 → 23 |
| Connected account, new browser | 856.5 / 857.9 | 763.7 / 773.4 | 688.3 / 691.3 | 19.6% / 9.9% | 4 → 3 → 2 | 23 → 23 → 23 |
| Schoology warm open | 513.1 / 516.9 | 422.2 / 430.7 | 346.2 / 348.7 | 32.5% / 18.0% | 4 → 3 → 2 | 3 → 3 → 3 |
| Schoology warm alias | 515.0 / 518.7 | 420.5 / 427.3 | 347.9 / 350.4 | 32.4% / 17.3% | 4 → 3 → 2 | 3 → 3 → 3 |
| Schoology expired metadata | 856.6 / 861.2 | 759.0 / 780.2 | 687.4 / 693.4 | 19.8% / 9.4% | 4 → 3 → 2 | 23 → 23 → 23 |
| Schoology full manual | 861.8 / 864.4 | 769.9 / 777.6 | 686.7 / 690.2 | 20.3% / 10.8% | 4 → 3 → 2 | 23 → 23 → 23 |
| Repeated unavailable titles | 3347.7 / 3364.9 | 761.5 / 775.6 | 686.8 / 689.6 | 79.5% / 9.8% | 19 → 3 → 2 | 38 → 23 → 23 |
| IC one course | 418.8 / 420.5 | 416.9 / 420.4 | 335.7 / 336.5 | 19.8% / 19.5% | 2 → 2 → 1 | 3 → 3 → 3 |
| IC six equal-time details | 501.4 / 503.1 | 499.3 / 503.3 | 418.1 / 419.6 | 16.6% / 16.3% | 2 → 2 → 1 | 8 → 8 → 8 |
| IC six uneven details | 982.2 / 982.5 | 696.0 / 697.5 | 617.7 / 619.3 | 37.1% / 11.2% | 2 → 2 → 1 | 8 → 8 → 8 |
| Schoology + IC warm | 850.8 / 855.3 | 759.9 / 767.0 | 430.9 / 434.0 | 49.4% / 43.3% | 5 → 4 → 2 | 6 → 6 → 6 |
| Schoology + IC full manual | 1195.5 / 1197.4 | 1104.8 / 1113.8 | 753.0 / 756.0 | 37.0% / 31.8% | 5 → 4 → 2 | 26 → 26 → 26 |
| Schoology + six IC full manual | 1275.9 / 1283.6 | 1194.3 / 1197.5 | 839.1 / 844.3 | 34.2% / 29.7% | 5 → 4 → 2 | 31 → 31 → 31 |
| Schoology + IC expired metadata | 1193.4 / 1197.1 | 1110.9 / 1114.7 | 760.0 / 762.5 | 36.3% / 31.6% | 5 → 4 → 2 | 26 → 26 → 26 |
| Slower Schoology + IC manual | 2924.3 / 2929.3 | 2798.8 / 2803.2 | 2032.3 / 2037.2 | 30.5% / 27.4% | 5 → 4 → 2 | 26 → 26 → 26 |
| Slower Schoology + profile-bound IC manual | 2672.2 / 2676.2 | 2549.5 / 2553.5 | 1796.2 / 1796.9 | 32.8% / 29.5% | 5 → 4 → 2 | 25 → 25 → 25 |

The small 0.8% initial-key-connection slowdown versus pass one is noise; it is not presented as an improvement. That path deliberately keeps the original credential-validation/setup sequence. Nearest-rank p95 is the maximum of nine samples, so these are small-sample engineering measurements rather than population/device guarantees. The older, separately recorded first-pass evidence below remains historical; the table above remeasures all three implementations under one harness.

The larger second-pass gain comes from measuring and fixing the **whole Schoology + IC path**. Previously it waited for Schoology to complete before starting IC. `refresh/start` now combines owner-authenticated status and fresh snapshot startup, overlaps independent provider HTTP work, and returns each provider's result separately. A normal combined refresh uses two app requests instead of five originally/four after pass one. IC-only refresh uses one instead of two, without forcing a Schoology scan. Unsupported older Workers fall back safely; a lost/network-failed combined response is not retried automatically.

The global pool holds no more than **five complete response bodies**, including error/cancellation paths; Schoology and IC keep their own previous ceilings (five and three). Warm combined refresh uses three global slots instead of two because two different providers overlap; neither provider's own peak increases. The initial invocation remains under **44 total subrequests including redirects**, with IC's roster/summary/selected-detail allowance reserved. Excess Schoology work uses the existing deferred-read path. A 429 is recorded at headers so queued work for that provider stops before fetching; the other provider can still finish. Competing cooldowns retain the longest delay, including in the client-visible error. Tests cover failures before/after discovery, lost responses, body cancellation/error/abort, malformed versus verified empty data, account/Lock/coalescing/prepared-save guards, independent provider commits and local edits made during reads.

Schoology credentials are decrypted once per invocation instead of once per metadata job. The Schoology-only full-manual fixture drops from **46 → 46 → 2 decryptions**; combined full manual drops from **50 → 50 → 6**. This reuses only already-verified key material within that call, never grade responses or authentication across calls. Each refresh still verifies the provider identity and signs its own enrolled read requests. Portal health is returned from the saved connection already in memory instead of reloading/decrypting it for another status request.

Normal provider-read counts remain identical in all three stages: full Schoology **23**, Schoology + one IC **26**, and IC-only **3** in the roster-bound fixture. The earlier unavailable-title backoff remains the conditional read reduction (**38 → 23 → 23**), while required catalogs still renew. Metadata expiry is unchanged, manual refresh stays complete, fresh score reads remain, and the spinner covers the actual reads and local activation. The single Schoology cooldown retry and its waiting/running/failure messages remain bounded and persisted across tabs/reloads. No recurring idle polling, broader metadata caching, higher Schoology concurrency or inline 429 retry was introduced.

Raw reports: [original](benchmarks/refresh-2026-11-12-pass2-before.json), [first pass](benchmarks/refresh-2026-11-12-pass2-middle.json), [second pass](benchmarks/refresh-2026-11-12-pass2-after.json). They include all samples, p50/p95, app/provider counts, per-provider/global peaks, decryption counts, implementation/harness hashes and normalized output digests. All digests match; timing/observation-history metadata is excluded and covered by regressions. The comparator rejects increased provider reads, increased per-provider peaks, a global peak over five, increased decryptions or changed normalized outputs.

Re-run the final implementation from `web/`:

```sh
npm run benchmark:refresh -- --compare ../docs/benchmarks/refresh-2026-11-12-pass2-middle.json --output .local-test/refresh-pass2/latest.json
```

For archived stages, extract `web/` from the indicated Git ref into an isolated ignored directory, copy the same benchmark script/driver and synthetic fixture worker into it, use the same installed dependencies, and invoke the script with `--source-ref aea38d3` or `--source-ref 9fa3f85`. The script checks every measured production hash against that ref before accepting its provenance. Hosted signing/release verification and live device acceptance are separate; no release or deployment is claimed here.

---

# GradeViewer refresh benchmark — November 12, 2026

These are **local synthetic measurements**, not the owner's deployed Worker, physical-phone latency or Schoology/IC response-time guarantees. The owner's reported first-open refresh of roughly 3–4 seconds and manual refresh of roughly 3–3.5 seconds are useful observations, not an instrumented before/after result. No production deployment or live provider request was used in this work.

The benchmark runs the real `CredentialVault`, Schoology refresh coordinator, IC `PortalService`, parsers/reconciliation and local activation. It uses in-memory Durable Object storage, fake IndexedDB, synthetic records and real wall-clock delays: 80 ms per app round trip, 80 ms per normal provider read, and IC detail times `[320, 40, 40, 320, 40, 40]` ms for the uneven case. Each scenario has one discarded warm-up and nine independently seeded measured samples. Owner login, connector sign-in, setup/priming, React rendering, service-worker startup and actual WAN/Worker storage latency are outside the timed interval. The interval starts before status and ends after the complete provider snapshot is saved locally; it is not a cached-display timer.

The baseline uses production sources archived from `aea38d3` with the same benchmark driver and synthetic fixture harness copied into that isolated root. Reports were recorded before the optimization commit, so their Git source field identifies the same base commit with `dirty: true`; per-file implementation hashes identify the exact code measured. The harness/data hashes match, and every scenario's normalized grade/assignment/rule digest matches before/after (wall-clock stamps and observation history are excluded from that digest and covered separately by regression tests).

| Scenario | Before p50 / p95 (ms) | After p50 / p95 (ms) | Median faster | App requests | Provider reads | Peak provider concurrency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Schoology cold connection | 866.8 / 874.6 | 784.8 / 791.1 | 9.5% | 4 → 3 | 23 → 23 | 5 |
| Schoology warm open | 522.6 / 526.6 | 437.6 / 440.0 | 16.3% | 4 → 3 | 3 → 3 | 2 |
| Schoology warm alias | 522.3 / 525.7 | 433.4 / 437.8 | 17.0% | 4 → 3 | 3 → 3 | 2 |
| Schoology expired metadata | 869.2 / 871.8 | 780.7 / 784.6 | 10.2% | 4 → 3 | 23 → 23 | 5 |
| Schoology full manual | 867.3 / 871.2 | 780.4 / 782.9 | 10.0% | 4 → 3 | 23 → 23 | 5 |
| Schoology repeated unavailable titles | 3392.2 / 3398.6 | 782.1 / 786.5 | 76.9% | 19 → 3 | 38 → 23 | 5 |
| IC one selected course | 424.7 / 427.5 | 423.9 / 426.6 | 0.2% | 2 → 2 | 3 → 3 | 1 |
| IC six equal-time details | 507.5 / 508.9 | 507.4 / 510.6 | 0.0% | 2 → 2 | 8 → 8 | 3 |
| IC six uneven details | 988.0 / 989.4 | 706.8 / 707.6 | 28.5% | 2 → 2 | 8 → 8 | 3 |

Nearest-rank p95 is the maximum of these nine samples; this is a small local sample. Sub-percent changes in one-course/equal-time IC cases are noise, and those cases show no meaningful improvement. Uneven multi-course IC improves because a completed slot no longer waits for the slowest member of its fixed batch. No extra request or higher concurrency produces the gain.

Schoology saves one browser–Worker round trip by returning bounded metadata/reuse results from the initial verified scan. Full manual refresh still reads all required metadata, and the existing five-minute automatic metadata/alias lifetime is unchanged. Changed/expired fingerprints, pagination, ambiguous aliases and older Workers retain the fallback path. The initial identity, discovery, metadata and redirects share a 44-subrequest cap and the same five-read scheduler. This also avoids one vault read/write cycle on common refresh paths.

The unavailable-title scenario intentionally omits one catalog title per synthetic course and makes its extra detail/list/folder lookups fail to resolve it. Honoring the existing 15-minute failure backoff on repeated manual refresh reduces 38 provider reads to 23 (39.5% fewer), while all required grade/catalog reads still run. A fresh catalog can still supply a newly available title immediately. This conditional saving does not describe a failure in the owner's account, nor a general 77% speedup.

IC stays at three concurrent detail reads. Its HTTP cookie/session verification remains intact; ordinary refresh never launches a browser. Failure stops queued details, drains peers, retains rotated cookies and honors the longest 429 cooldown from the in-flight group. The normal one-course case has no useful scheduling optimization.

A separate, owner-requested Schoology recovery flow makes **one** full retry after `Retry-After + 5 seconds`, only while visible, online and unlocked. The allowance is persisted and atomically claimed across tabs. Rejection, network/status failure or interruption spends the allowance; another 429 cannot re-arm it. Successful refresh or a deliberate manual attempt starts a new episode. Waiting/running/failure messages describe the actual state, and success clears them. The busy icon still covers real fresh reads and local activation. There is no recurring idle grade polling or inline 429 retry. This recovery adds one explicitly bounded attempt after throttling; it is not included in successful-path read counts above and cannot guarantee that providers never throttle.

[Raw before samples](benchmarks/refresh-2026-11-12-before.json) · [raw after samples](benchmarks/refresh-2026-11-12-after.json). Re-run from `web/` on the same machine/Node version:

```sh
npm run benchmark:refresh -- --compare ../docs/benchmarks/refresh-2026-11-12-before.json --output .local-test/refresh-benchmark/latest.json
```

The comparison rejects mismatched harness/conditions, changed normalized outputs, increased provider-read counts or increased peak concurrency. Exact provider quotas, deployed timing, radio conditions, React rendering and physical-device behavior require their own acceptance evidence. These measurements do not establish a two-second expired-open guarantee. No metadata-caching expansion, production update or new stable release was performed.

---

# GradeViewer PWA performance evidence

These are previously measured cloud-workspace → Cloudflare Worker → Schoology timings from October 16, 2026. They are not physical phone or browser-render measurements. Current validation details live in [PWA validation](PWA_VALIDATION.md).

| Path | Observed elapsed time | Scope |
| --- | ---: | --- |
| Initial serial PWA implementation | 13.623 s cold; 3.6–3.9 s steady | Earlier implementation |
| Parallel reads and bounded batching | 1.171–1.393 s steady | Six same-origin calls |
| Natural metadata expiry after 310 seconds | 3.043 s | Six calls, before final startup consolidation |
| Production warm refresh | 1.417 s | Five calls, 45 complete account-bound course-period records |
| Initial production connection | 3.274 s | Includes initial setup |
| New browser with optional title recovery | 6.515 s | Stored Schoology credentials reused |

Fresh roots are read concurrently after account verification. Required metadata precedes optional scale/title recovery. Provider requests use a bounded five-read pool, fixed cache expiry and shared cooldowns. Manual refresh bypasses metadata reuse while honoring rate limits. Complete fresh scores are still requested; latency improvements do not depend on presenting cached grades as fresh.

A two-second expired-open target remains unmet by the last measured sample. Provider limits and optional title/folder traversal can delay cold setup. Spinner animation and scroll improvements are UI corrections, not evidence of faster provider responses. Physical iPhone/Android startup and refresh timings remain unmeasured.

Live measurements are opt-in against the user's own Worker; never export real records or repeatedly probe Schoology for UI work. Synthetic fixtures cover development. Native historical benchmarks remain in Git history and are not evidence for PWA performance.
