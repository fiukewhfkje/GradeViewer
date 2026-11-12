# Further app and CI optimization — November 12, 2026

This follow-up starts at the previously deployed development source, represented by `5a52b6b`. It preserves the original production/first-pass/second-pass comparison in [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md) and the first CI pass in [CI_PERFORMANCE_REPORT.md](CI_PERFORMANCE_REPORT.md). Main and stable v0.2.4 remain unchanged. The owner explicitly requested another deployment to their existing Worker, without a release.

## Refresh and rendering

The same complete refresh harness ran against an archived `5a52b6b`, the CPU optimization at `cdb216e`, and final source `69211f5` including reversible Schoology visibility. Each stage uses one warm-up and three measured samples for all 16 scenarios. Harness hashes and transport conditions match. Every normalized snapshot digest, app/provider request count and concurrency peak matches. The raw report retains the intermediate sample too.

| Synthetic complete refresh, median | Before this follow-up | After |
| --- | ---: | ---: |
| Schoology manual, full metadata | 688.5 ms | 683.4 ms |
| Schoology warm open | 348.1 ms | 346.6 ms |
| Schoology + one IC course, manual | 767.2 ms | 759.8 ms |
| Schoology + six IC courses, manual | 852.5 ms | 846.5 ms |
| Combined manual, slower transport | 2044.5 ms | 2029.7 ms |

These differences are effectively unchanged. This pass makes **no additional network-refresh speedup claim** and does not change provider scheduling, metadata expiry, authentication, cooldowns or the single persisted retry. The combined ordinary manual case still uses two app requests and 26 provider reads, including full Schoology metadata verification. Fresh score reads on open/foreground return remain intact. Removing required verification or increasing provider concurrency would trade away correctness or quota protection for speculative gains, so neither was accepted.

There is a separate measured rendering improvement. Numeric points/percent graph prefixes now accumulate validated rows once instead of recalculating every earlier prefix. The canonical calculator and graph path share inclusion/validation and arithmetic; excluded/excused/category-excluded rows, multipliers, negative scores and zero-point starts retain their behavior. Weighted/drop-rule courses retain the existing calculator path. Unchanged assignment scores retain their immutable objects instead of cloning them. Number formatting reuses at most three native `Intl.NumberFormat` instances for the app's 0/1/2-digit formats; other precision arguments retain native validation without expanding the cache.

| Synthetic CPU operation, median | Before | After |
| --- | ---: | ---: |
| Points graph, 500 assignments | 19.360 ms | 0.618 ms |
| Points graph, 1500 assignments | 159.933 ms | 1.878 ms |
| Percent graph, 1500 assignments | 184.283 ms | 2.075 ms |
| Weighted-category graph, 1500 assignments | 386.091 ms | 357.532 ms |
| Format points/percent list, 500 assignments | 18.189 ms | 0.415 ms |
| Format points/percent list, 1500 assignments | 56.173 ms | 1.186 ms |

CPU measurements use Node 26.7.0, one discarded warm-up and nine samples at 100/500/1500 synthetic assignments for points, percent and weighted-category methods. Every input is deeply frozen. All 36 calculation, hypothetical, graph and formatted-list output digests match before/after exactly. This measures core CPU work, not a phone's frame rate or the owner's real provider latency. The large graph gain applies to numeric courses; the weighted fallback has only a modest improvement.

## CI changes and safety boundaries

- Both required browser jobs remain. Chromium installs its matching headless shell through the locked Playwright CLI on a native GitHub runner, rather than forcing a full/system Chrome binary. An older full-Chrome native trial failed; this pass does not revive that executable choice. WebKit retains the pinned matching Playwright container and compatibility check: native WebKit installation varied from 28 to 88 seconds and was rejected.
- Chromium retains every one of the 42 original integration/browser checks. WebKit's CI platform profile retains 34. The default local suite still runs all 42 in either engine.
- Eight shared flows run in Chromium and retain their underlying unit coverage: Node-fetch private API/security headers; Add Grade/extra-credit/removal; period scopes/named ungraded rows; update-check current/offline results; official release status variants; failed credential replacement; the complete Carmen LMS-switch scenario; and the standalone Carmen connection/GPA/reconnection/removal scenario. These are exact-name exclusions, so new checks run in both engines by default and stale exclusions fail. GPA setup and blank-enrollment migration remain in WebKit because later IC/retry flows depend on their state; initial attempts to omit them were rejected without weakening downstream assertions.
- WebKit keeps browser-specific motion/reduced-motion, native forms/keyboard/touch/graph selection, responsive layout, cached/offline startup, lock/session cookies, Worker restart, service-worker activation, unsaved forms, cross-tab preservation, IC sign-in/reconnection and the visible cooldown retry.
- Layout assertions still cover all 12 sizes in both themes and four credential-form sizes. Representative screenshots replace redundant artifacts; no layout assertions were removed.
- Four Chromium motion checks run alongside its functional chain. Each process gets a distinct port/origin, inspector port, TLS files, local Worker state and browser process. Motion reads a private copy of built assets, isolated from the functional service-worker update test. Both groups must succeed. The common sign-in bootstrap runs in both groups: Chromium executes 38 functional + 5 motion checks. This includes the duplicated bootstrap, not new product coverage. WebKit's 34 checks remain sequential; its overlapping native trial did not establish a gain. Ordinary `npm run test:e2e` remains sequential.
- Chromium build overlaps browser installation; its unit checks wait for installation because the Carmen lab regression launches a real local headless browser. An initial attempt to run units earlier failed on the missing executable and was corrected without skipping the check. Units and integration checks then overlap, with both exit statuses required.
- All 287 named unit checks remain: two CPU regressions and one visibility regression were added to the previous 284. Removing more would not shorten the measured critical path because they overlap browser work. Exact-tag matching, source packaging validation, GitHub attestation verification, release dependencies and update authentication remain unchanged. No failure is retried or ignored to make a run green.

Hosted before/intermediate/final timings and exact source IDs are retained in [the CI sample report](benchmarks/further-2026-11-12-ci.json). The accepted [final run](https://github.com/fiukewhfkje/GradeViewer/actions/runs/43298124887) passes on `69211f5`. Compared with the [fresh baseline](https://github.com/fiukewhfkje/GradeViewer/actions/runs/43286371588):

| Hosted measurement | Before | Final |
| --- | ---: | ---: |
| Chromium job | 111 s | 76 s |
| WebKit / slowest required job | 111 s | 120 s |
| Sum of required job durations | 222 s | 196 s |
| Entire dispatch including scheduling/cleanup | 116 s | 123 s |

Chromium improves about 32% and combined runner time about 12%. **This follow-up does not improve overall CI completion time in this pair:** WebKit is the remaining critical path. The final source also includes the newly requested hide/restore regression. Intermediate native/profile trials took 96–124 seconds; one native WebKit installation outlier increased its job to 179 seconds. All samples, including the failed setup trial, are retained instead of selecting only the fastest result. The earlier first pass's 154 → 124 second improvement remains a separate historical comparison.

Further deleting WebKit's motion, service-worker, cache, session, IC sign-in or cooldown checks would reduce relevant browser coverage. More unit consolidation would not shorten the critical path. The retained changes reduce Chromium work without that tradeoff; no further speculative infrastructure or weaker release gate was accepted. Runner speed, image pulls, OS setup and scheduling remain variable. Cloudflare upload/publication latency is outside these verification measurements.

## Validation and reproduction

Build/type check and all 287 unit checks pass. The final app implementation passes all 42 Chromium checks in its isolated groups and all 42 sequential WebKit checks locally. Hosted CI passes all 287 units, Chromium 38 + 5, WebKit 34, both builds/type checks and the real production Worker dry-run. A deliberate invalid browser engine causes subprocess and wrapper failure. All 121 source files package locally; isolated template installation/build/unit/Worker dry-run, update-fixture configuration/secret retention and rollback pass. Phone/desktop light/dark hidden-course captures were inspected. Owner deployment receipts are recorded separately in PROJECT_STATUS.md and PWA_VALIDATION.md.

Raw [CPU samples and output hashes](benchmarks/further-2026-11-12-cpu.json) and [refresh samples, request budgets and snapshots](benchmarks/further-2026-11-12-refresh.json) retain the exact measured revisions, implementation/harness hashes and conditions. To reproduce from `web/`:

```sh
node scripts/benchmark-calculations.mjs --output .local-test/cpu.json
node scripts/benchmark-refresh.mjs --samples 3 --source-ref HEAD --output .local-test/refresh.json
npm run test:e2e:ci
GRADEVIEWER_BROWSER=webkit GRADEVIEWER_E2E_PROFILE=platform npm run test:e2e
```

Use the same harness against an archived baseline and pass `--compare` with its report for matched-output checks. Benchmarks and browser runs use synthetic local transports; they make no Schoology/IC/Carmen grade requests or Cloudflare Browser Run launches. The real owner's reported 3–4 second refresh has not been remeasured.

The native runner/headless-shell choice follows [Playwright's browser installation documentation](https://playwright.dev/docs/browsers#chromium-headless-shell). The fixture Worker remains bundled with the real browser SDK: its measured local cold boot was already about 854 ms, so replacing SDK imports with a test-only stub was not worth adding another production/test difference. No dependency or generic test framework was introduced.
