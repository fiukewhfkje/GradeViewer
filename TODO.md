# Next work

## PWA migration — release candidate 0.1.0

- [x] Restore the checkpoint and resolve the TypeScript configuration failure.
- [x] Recheck unrestricted networking; verify authenticated Schoology identity and a complete production-path snapshot without exporting real records.
- [x] Implement the TypeScript core, selected native regression cases, secure Worker/vault/sessions, staged activation, account binding, cooldowns and metadata reuse.
- [x] Build the responsive PWA, IndexedDB persistence, local scenarios, phone-install assets/help, visible personal address and controlled app-shell updates.
- [x] Implement signed 0.x releases, isolated template packaging, copied-repository automatic update workflow and explicit rollback; verify generated-copy install/update/rollback locally.
- [x] Run synthetic unit/security/snapshot and browser suites, inspect screenshots, and dry-run the production Worker. See [PWA_VALIDATION.md](docs/PWA_VALIDATION.md) for exact results and final follow-ups.
- [ ] Complete actual public template deployment on a new Cloudflare Free account, preserving the stable URL, Durable Object and secret on redeploy. No Cloudflare authorization is configured here.
- [ ] Configure the maintainer's generated Ed25519 private key as GitHub Actions secret RELEASE_SIGNING_KEY through an account with Actions-secret administration; this integration receives HTTP 403. Never put that key in source or a release artifact.
- [ ] Verify the copied GitHub workflow's push triggers Cloudflare Builds, and exercise actual hosted update/rollback; local source/update tests do not establish this external integration.
- [ ] Validate real Safari/Home Screen and Android installation, session persistence and foreground behavior on physical phones.
- [ ] After those gates pass, merge the focused migration commits once, tag/publish v0.1.0 and deploy. Preserve native baseline 3447420 and do not publish unreviewed repository history.

## October 15 precision follow-up

- [x] Reproduce tiny graph transitions and rounded-input quarter estimate precision; retain actual observations and real assignment changes.
- [x] Anchor matching reconstructed prefixes within their own assignment interval, propagate inverse rounding uncertainty, and handle exact-cent history comparisons consistently.
- [x] Pass 118 core/26 hosted tests and five focused UI flows; inspect synthetic screenshots and preserve grade/score/history provenance.
- [x] Verify build 9 live, foreground and normal refreshes with preserved provider scores/history/scenarios; merge [PR #8](https://github.com/fiukewhfkje/GradeViewer/pull/8) (`8819b3b`), delete the delivery branch and synchronize main. No separate worktree was created.

## October 15 Schoology hardening

- [x] Audit live grade/catalog/scale responses without exporting credentials or grade values; reproduce response-shape, date-boundary, freshness and home/detail discrepancies.
- [x] Recover grade-column/external-tool names, null/blank points and verified numeric custom-scale totals; keep metadata conflict guards and avoid duplicate contributions.
- [x] Use the same reported semester overall on home/detail, retain quarter calculation scope, include final calendar days and retry missing titles on manual refresh while honoring server cooldowns.
- [x] Match all seven Biology screenshot titles and all 30 CSA website rows (28 graded); identify the one extra API-only untitled Homework grade without inventing its title, deletion or score. The real Weekly Programs row stays; the later explicitly authorized local removal of the extra Homework identity persists across refresh/relaunch, with undo and raw-source preservation.
- [x] Verify Physics's reported semester includes its website Q2 score despite the individual-score API omission; do not insert an invented provider row/value.
- [x] Verify live category and quarter/exam weights; add a deterministic, asterisked inverse quarter estimate with blank/scored/zero-exam handling and automatic replacement by actual data. Keep actual assignment scores/history separate.
- [x] Include named no-score assignments in All Assignments, suppress unnamed empty stubs and avoid claiming a missing score was updated.
- [x] Pass 112 core/26 hosted tests, 11 focused UI flows, signed device/Release builds and preserved-data checks; install build 8 with the original identity.
- [x] Verify final foreground/normal launches, merge [PR #7](https://github.com/fiukewhfkje/GradeViewer/pull/7) into main (`ac04e1d`), remove the delivery branch and synchronize the clean checkout. No separate worktree was created.

## October 10 device and history follow-up

- [x] Install over the original phone identity and verify the saved Schoology connection, live totals, graph endpoints, retained course identities, all 20 original observations and saved local scenarios.
- [x] Restore pre-migration defaults for student-hidden category methods/drops; fix null/blank/custom-scale overall handling without rewriting editing behavior. Remove Calculated labels as requested.
- [x] Build the graph across available assignment periods and verify earlier-data retrieval through the actual first-connection network path with zero previous sources. Keep reconstruction separate from observed history and document unavailable score revisions.
- [x] Pass 89 core/24 hosted tests and six focused UI flows, rerun final labels/editing/midyear cases, inspect screenshots, and pass signed device/Release simulator builds. Install build 7 and launch normally.
- [x] Verify a clean local clone's 89 core tests and neutral-signing Release build; push the validated follow-up through [PR #6](https://github.com/fiukewhfkje/GradeViewer/pull/6) under the existing merge authorization.

## October 8 initial Schoology-only delivery (historical)

- [x] Audit complete captured source assignments class by class; find all 77 IC rows represented in Schoology and seven additional graded Schoology rows. Record matching evidence, snapshot-age limits and calculated-total agreement without exposing scores/credentials.
- [x] Remove IC networking, parsing, cookies/SAML/browser login, settings, refresh/freshness and cross-provider matching/UI paths. Retain Schoology owner checks, retries/cache behavior and provider read-only scope.
- [x] Add supported calculated Schoology totals/semesters with visible basis, reject unknown rules and preserve observed history separately.
- [x] Add an atomic/idempotent old-cache upgrade preserving compatible identity/history/scenarios; clear retired Keychain connections only on the updated app. Validate captured-payload preservation locally.
- [x] Pass 85 core/24 hosted tests, nine distinct focused UI cases with the 18-screen appearance matrix, final relevant reruns and the Release simulator build; inspect representative screenshots and verify the captured upgrade and graph endpoints against final sources.
- [x] Commit/push the validated Schoology-only change and deliver through [PR #5](https://github.com/fiukewhfkje/GradeViewer/pull/5) under the user's merge authorization; installation was deferred then completed on October 10.

## Historical completed work

- [x] Replace the What-If calculator button/page with a direct Add Grade popup, remove ± controls and retain normal decimal/extra-credit editing. Keep added grades visible and editable/removable in the normal course views using the same local scenario; pass 123 core/42 hosted/seven focused UI cases and inspect synthetic small-phone screenshots.
- [x] Reproduce the untitled duplicate, recover only mutually unique score/points/update-day presentation links in compatible courses, reject ambiguous/conflicting evidence and existing scored counterparts, and share actions against the original calculator identity. Preserve source data/history and distinct Schoology-only work; validate eight core regressions and the small-phone edit/drop/reset flow. Protected phone checks confirm the reported duplicate is absent and both providers still refresh with all 46 canonical records.
- [x] Merge the Add Grade/untitled duplicate changes in PR #4 (`d511f9b`), verify final signing and original installation identity, install over the original phone, confirm both providers and all 46 records with protected checks, and launch normally. Remove temporary title-specific diagnostics and clean up the completed feature branch.

- [x] Fix editable score formatting and signed-score calculation; retain the decimal keypad with a ± control, clarify enabled Save styling and share valid score edits across Recent, All Assignments, What-If and Add Assignment. Validate 115 core/41 hosted/four focused UI cases, inspect small-phone screenshots and merge PR #3 (`60068dd`). After the user resumed deployment, verify the signed device build and install/launch over the original iPhone app with the same bundle/team. Live provider/phone grade-editing checks were not repeated.

- [x] Reproduce the October 2 Campus TLS stall, distinguish it from expired authentication, and verify that existing saved cookies still refresh and normal SAML renews without a login prompt. Repair silent browser errors/redraw loads, retain failed-renewal cookie rotations, add direct connection retry and bound Campus network/browser waits. Validate 113 core/39 hosted/two focused UI cases, install over the original app, verify the final 0.991-second live refresh and merge PR #2 (`920c274`); clean up the feature branch and leave only the original `main` checkout.

- [x] October 2 repository follow-up: verify all 101 GradeCore tests from a fresh GitHub clone and record the limited review scope without claiming new hosted/UI/device/provider validation.

- [x] Native local app, canonical GradeCore, protected SwiftData grade/history cache and device Keychain credentials.
- [x] Both provider pipelines, read-only transport, Schoology enrollment/grade-owner alias handling and Campus section detail IDs.
- [x] Concurrent/coalesced foreground and manual refresh, bounded section reads, failure retention, foreground fresh-data gate and active-only minute checks.
- [x] Conservative course/assignment matching, period hierarchy, reported Campus display authority, local calculation provenance, quarter exam footer and shared What-If behavior.
- [x] Campus cookie persistence/rotation/deletion, normal browser SSO capture/renewal, saved/legacy session decoding and concise connection pages.
- [x] Explicitly remove widget target, WidgetKit imports, App Group entitlements/cache, shared models/rendering, preview route, URL scheme and widget-only tests.
- [x] Portable signing defaults and ignored local override preserving the original app identity; concise README for cloning, device setup, personal school credentials and Apple limits.
- [x] Audit tracked files/history for recognized credential patterns and sensitive files; keep source fixtures synthetic and personal signing ignored.
- [x] Fix physical section links changing across quarters, category borrowing from incompatible periods, mappings overriding known conflicts, placeholder/repeated match evidence and missing-point assignment merging.
- [x] Verify Schoology credential owner on refresh and empty snapshots, roll back credentials after failed local connection commit, clear stale throttle deadlines on reconnect, harden pagination/path scopes/parser bounds and unify metadata conflict checks.
- [x] Reproduce short Schoology throttling in a fixture; pause queued reads for server cooldown, bound retries and verify cancellation. Confirm both saved providers refresh on the original phone afterward.
- [x] Preserve quarter-only UI for existing quarter districts; support equivalent labels and semester-only provider periods.
- [x] Record 101 core/31 hosted results, all 22 UI cases across full/focused runs, inspected light/dark/small-phone layouts, final clean-copy validation and signed original-device refresh/relaunch.
- [x] Trace the performance pass and later changes; reproduce optional-title throttles rejecting fresh grades and delaying other sections, then move recovery after required reads and preserve server cooldowns across relaunch.
- [x] Reduce unchanged seven-section repeat requests from 24 to 3 in fixtures with five-minute account/section-bound metadata reuse; verify changed grades, manual bypass, fixed expiry, incomplete-cache repair and valid empty/malformed responses.
- [x] Validate 109 core/32 hosted/four focused UI tests, a separate neutral-signing clone's 32 hosted tests, and the prepared signed device build locally.
- [x] Install the local performance fix over the original phone app with the same bundle/team; confirm both connections, five home cards/five matched semesters, warm relaunch, real background return and natural five-minute metadata expiry. Observe optional title HTTP 429 without losing fresh scores. The user subsequently authorized GitHub publication.
- [x] Reproduce and fix the saved-cooldown failure gate; automatically resume short waits, show a countdown for longer waits, and retry at the deadline while active without early requests.
- [x] Fix current rounding offsets altering earlier perfect graph prefixes and duplicate calculated/observed timestamp events. Preserve real observed missing-grade dips and corrections across reopening; verify 112 core/34 hosted/four focused UI tests and install the updated build on the original phone.
- [x] Validate the final neutral-signing clone's 34 hosted tests; push and merge the performance/cooldown/graph fixes into `main` in PR #1 (`3893112`) under the user's authorization. The installed runtime matches the validated source.
- [x] Clean up the merged feature branch locally/remotely and its chat attachment; retain the original `main` checkout, validation evidence and prepared device build.

## Current evidence-driven follow-up

- [ ] Observe the deferred title lookups after their natural 15-minute/server deadline only if further live evidence warrants it. The hardening recovered every current Biology title. One extra CSA Homework grade has no accessible metadata after complete list/folder checks; retain its score without inventing a title or deletion. Keep honoring provider cooldowns and preserving scores.
- [ ] Verify another student's own district/account, earlier/inactive-period accessibility and physical installation; original-account first-connection and fixture checks do not establish district-wide compatibility. No documented full score-change history has been established for fresh installs.
- [ ] Recover unresolved Schoology titles only if the provider makes compatible matching metadata accessible; do not infer a deleted assignment or teacher setting.
- [ ] Observe naturally populated completed periods and genuine new grades; calibrate timezone-less dates, rubric scales, rounding or teacher overrides only with demonstrated discrepancies.
- [ ] Rebuild/reinstall when local development provisioning expires. Build 8 is installed and live-verified on the original phone; wider distribution requires a separate App Store/TestFlight signing/release decision.
- [ ] Measure further provider latency/rate limits only when a new observed issue justifies it; the measured refresh fixes are documented in docs/PERFORMANCE_REPORT.md.

No widgets, grade-write endpoints, notification server, background polling, paid tier, planner, analytics or invented grades/dates. No Muse watcher was implemented or deployed.
