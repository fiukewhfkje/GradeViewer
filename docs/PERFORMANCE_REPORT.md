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
