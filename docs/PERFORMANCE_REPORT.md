# GradeViewer performance report — October 1, 2026

The original phone measurements below document commit `9202b32`. The October 2 investigation at the end records newer local fixes and validation; no new authenticated phone speedup is claimed.

## Result and scope

A full, authenticated repeat refresh on the connected iPhone 15 improved from **10.401118 seconds** in the measured baseline to a **1.273169-second median** across three final repeat samples: **87.76% less elapsed time**, or **8.17× faster**. The three final samples were **1.044988, 1.325548, and 1.273169 seconds**. Fresh scores were requested from both providers in every sample. No sample used cached grade scores to produce this speedup.

The baseline also reproduced a **4.649346-second main-actor scheduling stall**. Final repeat samples measured **32.801–34.316 ms** maximum extra scheduling delay, with a **33.586-ms median**. That is **99.28% lower** in this probe. It demonstrates removal of the measured multi-second UI block; it is not a rendered-FPS measurement or a guarantee against every possible future OS/app stall.

This pass changes local parsing/matching execution, request sequencing, optional title recovery, and scene-trigger handling. Quarter pills, Q2/Q4 exam placement, semester Course Grade, assignments/categories, grade history, What-If/final calculators, widgets, appearance, credential persistence, manual refresh, and the existing active-only one-minute refresh cadence remain. Automatic return refresh follows the user's final preference. Temporary inactive transitions do not start another fetch; an actual background return does.

## Exact phone measurements

All times below are milliseconds, rounded only for this table. These are observed samples, not claimed service-level guarantees.

| Version/path | Full refresh | Campus provider span | Schoology provider span | Maximum extra main-actor scheduling delay |
|---|---:|---:|---:|---:|
| Baseline | 10401.118 | 1095.594 | 5687.984 | 4649.346 |
| Indexed matching + worker | 1969.124 | 752.260 | 1834.152 | 32.550 |
| Worker encoding | 1953.166 | 940.372 | 1809.029 | 32.643 |
| Final: title recovery due | 2442.382 | 909.081 | 2290.656 | 49.679 |
| Final repeat 1 | 1044.988 | 834.139 | 876.208 | 34.316 |
| Final repeat 2 | 1325.548 | 918.646 | 1200.803 | 32.801 |
| Final repeat 3 | 1273.169 | 790.185 | 1138.083 | 33.586 |

The phone retained **46 canonical course/period/task records** and reported **zero provider errors** with the fresh-presentation gate opened in every row above. That count includes historical/future periods and grading tasks; it does not mean 46 Home Screen classes. The untitled scored-source-row count remained **one**. The report exports counts and timing only, not grade values or resource identities.

**Provider spans need careful interpretation.** They measure the provider call from AppStore through its completion on the main actor. The baseline Schoology span includes time waiting for that blocked actor to resume. Its 5.688-to-about-1-second change does not mean Schoology's server itself became five times faster. The important directly measured improvement is end-to-end refresh and removal of the synchronous reconciliation windows.

### Baseline stage breakdown

| Main-actor stage | Baseline elapsed ms |
|---|---:|
| Reconcile Campus result against retained sources | 4510.661 |
| Save/publish Campus result, including JSON encoding | 59.291 |
| Reconcile Schoology result against retained sources | 4590.071 |
| Save/publish Schoology result, including JSON encoding | 61.972 |

The two reconciliation calls consumed **9.100732 seconds** of synchronous work. They account for most of the **10.401118-second** total, and individually line up with the multi-second scheduling delay. The baseline Schoology HTTP requests generally took approximately **100–400 ms**; section parsing took **21.234–87.088 ms** per section. Optimizing network transport alone would have left the dominant UI block intact.

### Final repeat stage breakdown

| Final sample | Campus reconciliation + JSON encoding, worker ms | Campus save/publish, main ms | Schoology reconciliation + JSON encoding, worker ms | Schoology save/publish, main ms |
|---|---:|---:|---:|---:|
| 1 | 53.462 | 27.814 | 55.541 | 14.894 |
| 2 | 54.567 | 16.104 | 62.139 | 13.435 |
| 3 | 53.406 | 16.215 | 72.965 | 12.154 |

Worker stages are elapsed spans that include scheduling, and now include encoding. They are not pure CPU samples and should not be compared as identical work to the baseline reconciliation-only column. Save/publish includes SwiftData, course publication, term selection, and widget update together; this pass did not separately time those components.

## Findings and implemented fixes

1. **Repeated matching evidence dominated refresh and froze the UI.** Pairwise matching rebuilt normalized titles/teachers, period descriptors, date extraction, and assignment label sets for the same sources repeatedly. Reconciliation now constructs one immutable evidence index per snapshot, then applies the same compatible-metadata, period/task, mutual-uniqueness, and ambiguity rules. Evidence is recomputed for each fresh snapshot; it is not a cross-refresh grade cache.

2. **Snapshot processing ran on the main actor.** Reconciliation and deterministic JSON encoding now run in a user-initiated detached worker using Sendable value snapshots. SwiftData mutation stays on its owning context and commits changed payloads atomically. The publication path checks the snapshot revision and rebases if local order/visibility/mapping changed during the worker. Failed encoding/persistence retains the old successful snapshot and cannot open the fresh-data gate. Connection setup uses the same worker path.

3. **Date/regex construction amplified matching and parsing cost.** Configured ISO/plain-date parsers and constant period regexes are reused. A lock protects ISO formatters across parallel provider tasks. Numeric epochs retain their direct fast path. Explicit period start/end dates bypass redundant title-date extraction. Format, fractional-second, timezone-offset, epoch/millisecond, and concurrent-reader correctness tests pass.

4. **Independent Schoology requests were serialized.** Fresh enrollment discovery and combined user-grade requests now run concurrently, with owner/enrollment alias validation after both complete. First connection and unresolved aliases retain the conservative section-read fallback. Existing bounded concurrency and four HTTP connections per host remain; no unbounded parallel fetch was introduced.

5. **Identity discovery added two repeat-request round trips.** A successful users/me identity is stored beside the exact credential set in Keychain. Subsequent reads use that verified identity, while continuing to authenticate every fresh request. Legacy credentials decode without it; replacing credentials clears it. Authentication failures and Retry-After still propagate normally. Combined-grade tests verify fresh changed scores, enrollment aliases, no redundant users/me request, and retained 401/429 behavior.

6. **The same unsuccessful title request delayed every refresh.** Recovery now checks exact compatible identities through a scoped assignment list and a bounded course-folder traversal (three reads concurrently, at most 32 folders, cycle/duplicate protection, no provider-location URL following). If no accessible title is supplied, a persisted **15-minute optional-title retry deadline** prevents repeating those reads on every open. Changed scores/timestamps or a newly titled fresh grade-item entry bypass the deadline. Grades, grade-item catalogs, categories, and enrollments are still read fresh. Positive recovered titles retain their prior reuse behavior.

7. **Temporary scene inactivity triggered an unnecessary refresh/loading gate.** App switcher, Control Center, and system prompts can make a scene inactive without actually leaving the app. A new automatic foreground pass is now armed only on real background entry. Leaving does not start requests; returning starts or joins one pass. A completion while backgrounded cannot uncover the gate. Manual refresh, coalescing, and the original active-minute cadence remain, with that timer cancelled on inactivity/background.

The measured Schoology request count dropped from **26 to 23 HTTP responses per ordinary repeat refresh**. The final count comprises one fresh enrollment list, one fresh combined-grade list, seven section metadata reads, seven category reads, and seven grade-item catalog reads. These are account-specific observed counts, not a fixed number promised for other students.

## The remaining HTTP 403

The student's one unresolved assignment detail repeatedly returned **HTTP 403 with an empty body**. Other authenticated grade/metadata reads succeeded. The requested enrollment and returned grade owner are identical for this item, so the earlier alias mismatch is excluded here. Its identity/title is absent from the accessible **26-row assignment list** and all **16 reachable course folders**, which returned successful responses. The traversal completed below its 32-folder bound.

A first recovery attempt in the final pipeline took **2.442382 seconds** overall, versus about 1.0–1.3 seconds for the three repeat samples. That slower sample is explicitly included above. It performed **41 Schoology HTTP reads**: the normal 23 plus one refused detail, one assignment list, and 16 folders. Repeat samples performed no refused-detail/list/folder retry while the deadline remained valid.

The provider's denial/title itself remains unresolved: a teacher setting, deletion, or provider defect is not established by an empty 403 response. The app preserves the valid score and neutral title instead of guessing or forcing reconnect. The implemented fix is safe fallback and bounded retry cost; it does not falsely claim the server now permits that detail. Successful list/folder recovery is demonstrated with synthetic fixtures, not with that blocked live item. [Schoology Assignment documentation](https://developers.schoology.com/api-documentation/rest-api-v1/assignment/), [Course Folder documentation](https://developers.schoology.com/api-documentation/rest-api-v1/course-folder/).

## Local benchmark and UI checks

The same isolated command, `swift test --filter PerformanceTests`, measured these synthetic Mac debug benchmarks before/after:

| Synthetic workload | Before ms | Final comparable run ms | Improvement |
|---|---:|---:|---:|
| 1,200 date parses over six supported formats | 311.348 | 126.405 | 59.40% less time; 2.46× faster |
| 96-source, six-class period reconciliation; 48 expected pairs | 249.617 | 20.224 | 91.90% less time; 12.34× faster |

These are local microbenchmarks, not iPhone launch/network timings. Assertions validate the parsed formats and all 48 two-provider matches. The full final Core run also passed the added concurrent date-reader case.

The simulator launch responsiveness test used six synthetic classes with **350 assignments each (2,100 total)**. Three measured first-frame-responsive launch values were **2.242267, 2.277558, and 2.469515 seconds**, with **2.330-second reported average** and **4.286% relative standard deviation**. There was no corresponding pre-pass simulator launch baseline, so no launch-speed improvement is claimed from this test.

## Validation and delivery

- **77 GradeCore tests passed**, including matching/ambiguity, provider schema/empty responses, score/exclusion rules, period hierarchy, title fallback/conflict/retry behavior, auth/throttling, ordering, graph rounding, calculator correctness, and date concurrency.
- **20 hosted app tests passed**, including persistence, Keychain credential/identity replacement, provider coalescing and partial failure, freshness gating, failed serialization, large-refresh main-actor responsiveness and local-edit retention, actual background-return behavior, transient-inactivity suppression, manual refresh, and active-cadence cancellation.
- Three focused UI cases passed during this pass: long-list responsive launch, quarter pills/semester grade/exam scoping, and fresh-launch failure gate/Profile recovery. The gate case was also rerun after the lifecycle changes. Existing prior light/dark quarter/calculator UI checks remain documented separately.
- Signed app/widget build succeeded without compiler warnings, installed on the USB-connected iPhone 15, and launched successfully. Both provider sessions survived reinstalls; measured final runs returned zero provider errors and opened fresh presentation. Final launch uses normal arguments, without profiling flags.
- Git delivery uses the existing authenticated repository. The final response/`git log -1` identify the delivered commit. Only the primary checkout was used; no extra Git worktree needs archiving. No server backend is required or deployed.

## Measurement method and practical limits

The phone runs used a signed **Debug** build on the same connected iPhone and the same existing local course/session data. URLSession still bypasses HTTP/grade caches. Stable period metadata uses the already existing one-hour metadata cache; verified identity and unsuccessful-title retry state are the new repeat-path caches. The slow first recovery path is reported separately so it is not hidden by the median.

`--profile-refresh` writes a protected JSON report with elapsed spans, counts, booleans, and fixed route/error labels. It does not run the heavier `--verify-layout` graph/layout report. A main-actor task sleeps for 16 ms during refresh; the reported maximum is wake-up lateness beyond those 16 ms. Normal application launch does not enable that probe or structural HTTP collection. No raw responses, grades, dates of student work, resource identifiers, URLs, credentials, cookies, or tokens were exported or committed; provider diagnostics report schema types/counts only. Raw timing/count artifacts are ignored by Git under artifacts/performance.

This is one measured baseline and three final repeat samples, with intermediate and recovery samples disclosed. Network/server/device scheduling varied, and no p95/p99 latency, release-vs-debug speed, memory/energy profile, OS hang trace, or exhaustive future-provider guarantee was measured. The remaining normal latency is predominantly fresh provider reads plus small publication work; guaranteeing instant fresh data would require assumptions this pass does not make. Functionality tests and live success/count evidence support preservation of existing behavior, not an absolute promise about every possible future response.

## October 2: history investigation and local regression fix

The user reports approximately one-second launches sometimes, followed by much slower launches/returns after time passes. The phone was unavailable. Git history and synthetic requests establish the following, without asserting which request failed on that phone:

| Revision | Relevant behavior |
|---|---|
| `9202b32` | Indexed matching, worker reconciliation/encoding, combined grades, cached credential identity and 15-minute unsuccessful-title backoff. Original measured phone performance above. |
| `825ed0b` | Explicit Campus cookie transport; no removal of the performance worker/index. |
| `b0fdea5` | Saved IdP cookies and one bounded browser SSO renewal after authentication rejection. Healthy Campus reads do not start that browser. |
| `97bdca8` | Credential-owner recheck before Schoology student reads and a shared wait/retry for short Schoology HTTP 429 responses. Optional title reads also inherited that wait and still rejected the entire grade refresh on throttling. Portable signing/widget removal do not cause that request wait. |

The later throttle change combines badly with older expiry paths: optional title recovery becomes due after 15 minutes, period metadata after an hour. An optional title 429 can delay freshness and discard otherwise complete fetched scores. Because title recovery ran inside each section worker, its cooldown could also delay later sections' still-queued required reads. Three new regressions reproduced the rejection, redundant repeat requests and cross-section interference before their fixes.

Required reads now finish for every section before optional title recovery starts. Optional detail/list/folder reads stop immediately on a 429 or active cooldown, preserve fresh scores, and defer their titles for at least 15 minutes or the longer server delay. Authentication rejection and cancellation still propagate. A successful snapshot retains a server cooldown in its protected source payload and AppStore restores it on process relaunch; subsequent fresh reads honor that deadline. Required reads retain their bounded short-throttle retry. No server quota or authentication boundary is bypassed.

Automatic checks reuse parsed section metadata for at most five minutes only when the **complete freshly fetched section-grade row** has the same normalized SHA-256 digest, verified owner/enrollment/user and complete cached period count. Scores, points, exceptions, timestamps, totals, row removals and new periods changing invalidate reuse. Manual refresh bypasses this cache when starting a refresh; concurrent callers still join one operation. Metadata-only edits can take up to five minutes to appear automatically. Original metadata timestamps do not slide, period expiry stays independent, and incomplete cached periods cannot be reused as a complete metadata result. The canonical parser/calculator/matching rules are retained.

### Local evidence

| Synthetic check | Historical/starting result | Final result |
|---|---:|---:|
| Seven-section unchanged repeat HTTP requests | 24 at `97bdca8` | 3 (identity, enrollments, complete grades) |
| 96-source reconciliation on this Mac, debug | 30.066 ms at `9202b32`; 21.360 ms at `97bdca8` | 20.706 ms |
| Same 2,100-assignment fixture construction, median of five sequential samples | 85.694 ms at `9202b32` | 92.804 ms |

The fixture construction has a small local cost increase, not a multi-second CPU stall. The original worker/index performance pass remains effective. Request counts are asserted against URLProtocol stubs; the owner check has no simulated redirect, so real account counts can differ. These numbers do not claim an 8× phone speedup or prove this student's current slowdown is entirely throttling.

`swift test` passed **109 tests**, hosted XCTest **32**, and a separate neutral-signing local clone **32** hosted tests. Four focused UI cases passed, including freshness gating and launch responsiveness with 2,100 assignments. Exported light/dark assignment and failure-gate screenshots were inspected. The current simulator launch metric was **3.306224, 3.372442, 3.238763 seconds**, average **3.306 seconds**, RSD **1.651%**. It is higher than the original 2.330-second run; these are different sessions and no paired historical simulator comparison establishes its cause. The paired local fixture probe above excludes a return to the original multi-second reconciliation cost.

The signed original-identity device app built successfully and passed strict signature verification with no embedded extension/widget route. It remains prepared locally at `DeviceDerivedData/Build/Products/Debug-iphoneos/GradeViewer.app`. No phone installation, school authentication, remote push or deployment occurred. Ignored local logs, failing-before/passing-after regressions, comparison sources and XCTest results remain under `artifacts/performance/`.

When USB is available, install over the original app and collect protected `--profile-refresh` timing/count reports for initial warm launch, normal background return, and expired metadata/title recovery. Campus SSO renewal can still require up to its existing 20-second browser bound after rejection, and required reads still honor actual server delays. Those need real device/account evidence before assigning the remaining intermittent latency to a provider or session.
