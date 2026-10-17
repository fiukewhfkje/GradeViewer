# Next work

## October 17 automatic updates

- [x] Verify Cloudflare/GitHub import constraints and replace the unsupported automatic-workflow claim with clear template-first setup.
- [x] Include the canonical root launcher, midnight Eastern/DST schedule, automatic initial run, verified script updates, limited deployment retry and monthly check receipt.
- [x] Distinguish official/deployed/ready/stalled/failed update states; preserve unsaved forms and saved data across per-tab service-worker activation.
- [x] Add immediate development updates, opt-in verified previews and a signed one-time repair helper.
- [x] Verify a real generated private GitHub copy, automatic first run, real signed v0.1.2/v0.1.3 pushes and rollback; reject a tampered real manifest.
- [x] Pass 137 tests, 26 Chromium + 26 WebKit flows, isolated template build/test/update/rollback and a Worker dry-run; resolve the pre-existing dependency audit findings.
- [x] Finish remote CI, merge PR #12, publish signed v0.1.4, verify the existing production Git deployment, enable official template metadata and clean the first delivery branch.
- [ ] Finish the measured Cloudflare REST-429 follow-up as v0.1.5: verify the asset route on real Cloudflare, same-version repair, complete CI, actual production PWA upgrade and final cleanup.
- [ ] Complete genuine independent-account Cloudflare setup/update/rollback and real credential/local-state retention acceptance when that account is accessible. Hakabl is 404 to available GitHub access; the sole local Cloudflare account's Builds API is 403. This is not a completed E2E check.


## v0.1.3 update follow-up

- [x] Publish signed v0.1.3 after full release CI, verify deployed asset hashes and clean merged branches.

- [x] Fix Update now after the first service-worker installation without requiring an earlier page reload.
- [x] Verify a genuinely fresh browser context and returning visits both install the new shell through Profile; retain existing scenarios.
- [x] Preserve the published v0.1.2 tag and advance the correction to 0.1.3.

## v0.1.2 UI follow-up

- [x] Restore native chart frame/fill/selection and remove the visible scrubber.
- [x] Isolate phone scrolling and show only a spinner through pull refresh and settling.
- [x] Verify short/reverse/cancelled/repeated pulls, success/failure cleanup, chart gestures and standalone-mode flags with synthetic browsers.
- [x] Tighten Profile's grouped-row spacing and add Check for updates / Update now with current/offline feedback and local-data preservation.
- [x] Remove retired provider references from documentation and consolidate the Schoology-only product/research reports.
- [x] Pass the local build, 121 tests and 25 Chromium browser flows; inspect synthetic screenshots.
- [ ] Verify physical iPhone/Android Home Screen scrolling and refresh; desktop emulation is limited evidence.

## PWA migration — shipped 0.1.0

- [x] Restore checkpoint; implement PWA/core/Worker/vault/sessions/local persistence/scenarios/installation/update UI with fixed read-only provider routes and staged recovery.
- [x] Verify live OAuth/complete hosted snapshots/credential reuse/redeploy/rollback without exporting real records. Repo is public; staging exists.
- [x] Add desktop refresh, guarded phone pull-down, Profile refresh, personal website Copy/Open and installation help.
- [x] Run current local production build, **104 tests and 22 HTTPS Chromium/Worker browser flows**. Last remote green: Chromium/WebKit 22 each, **119 Swift tests + 1,200 Swift/JS comparisons**, real keyless provenance.
- [x] Restore native colors/update/what-if labels and collapsed assignment groups with semester/quarter summaries; verify current Chromium interactions.
- [x] Replace maintainer Ed25519 signing-secret setup with exact-identity GitHub OIDC/Sigstore provenance. Isolated template update/config/secret preservation/rollback passes; real cryptographic verification passes separately in CI.
- [x] Measure actual metadata expiry: **3.367 s after 310 seconds**, steady **1.17–1.39 s**, empty-state/title traversal **6.547 s**. Record evidence without claiming the target met.
- [x] Verify the newly saved CLOUDFLARE_API_TOKEN with Cloudflare (active); register the Builds deployment credential and existing-preview trigger; store the preview password as a secret build variable. No secret values in chat.
- [x] Verify real Git pushes start successful Cloudflare Builds/deployments; reconnect the existing preview after replacement-VM password recovery.
- [x] Eliminate separate deferred scale calls, order required reads before optional scales across chunks, and use five bounded concurrent reads; verify stored credential reuse across automatic redeployment.
- [ ] Improve expired-metadata/late-open performance to the user's couple-second target while retaining complete fresh reads/fixed TTL; latest natural-expiry result **3.043 s / six calls** (was 3.619 s / seven in the resumed baseline). Browser/phone startup remains unmeasured.
- [x] Match native assignment score/excused/ungraded/letter/override presentation, score-only dropped styling and Categories alias; fix closing a selected-period view. Local UI checks pass.
- [ ] Finish physical course-sheet/back/graph/keyboard and installation checks; headless source/navigation checks do not establish phone behavior.
- [x] Clarify Git account selection in both READMEs and write the [setup guide](docs/PWA_ONBOARDING.md).
- [x] Follow up on the user's new-account screenshot: exact setup-screen labels, GitHub connection instructions, preview toggle guidance, password-manager help, and a 12-character minimum consistent across deployment/runtime (v0.1.1; build and 113 tests passed).
- [x] Record user-reported deployment completion on a different account; explain skipped/Back-accessible Cloudflare wizard pages and using the personal app URL after deployment. Defer the reported app UI work as requested.
- [ ] Finish beginner public template signup/permissions/generated copy/Free-plan resources/password setup verification; another-account deployment is user-reported, but fresh signup/Schoology connection/updater completion was not inspected. GitHub integration cannot create a separate repo (403); user requested no more manual setup tasks during this engineering pass. No novice-success claim.
- [x] Verify the real published v0.1.0 updater with actual cryptographic provenance/hashes and personal-config/secret preservation in an isolated copy.
- [ ] Verify actual copied GitHub updater push → Cloudflare build/deploy → rollback, preserving stable URL/vault/secrets/browser state.
- [ ] Complete physical iPhone Safari/Home Screen and Android install/foreground/storage/update checks. Keep native installed until PWA validated.
- [x] Check final implementation/release CI, source/package secret scans and PR description; securely configure the production owner password and encrypted Schoology connection.
- [x] Perform exactly **one migration merge** (`1b60b6f`), publish keyless-signed **v0.1.0** and deploy the configured production instance. Native baseline `3447420` is preserved. Device/new-account/remote-copy limitations remain explicit; they are not claimed as passed.

Read the final delivery section in [PWA_HANDOFF.md](docs/PWA_HANDOFF.md). Production: https://gradeviewer.fiukewhfkje.workers.dev. The previous 80% estimate is historical; release implementation is shipped, with the unchecked validation/performance follow-ups above. Historical native work follows.

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

- [x] Add supported calculated Schoology totals/semesters with visible basis, reject unknown rules and preserve observed history separately.
- [x] Add an atomic/idempotent old-cache upgrade preserving compatible identity/history/scenarios; clear retired Keychain connections only on the updated app. Validate captured-payload preservation locally.
- [x] Pass 85 core/24 hosted tests, nine distinct focused UI cases with the 18-screen appearance matrix, final relevant reruns and the Release simulator build; inspect representative screenshots and verify the captured upgrade and graph endpoints against final sources.
- [x] Commit/push the validated Schoology-only change and deliver through [PR #5](https://github.com/fiukewhfkje/GradeViewer/pull/5) under the user's merge authorization; installation was deferred then completed on October 10.

## Reference and ongoing work

- Preserve the native source and focused delivery history for behavior comparisons.
- Keep provider reads account-bound, read-only and complete before activating a new snapshot.
- Retain unresolved provider data without inventing titles, scores or deletion causes; explicit local removal remains reversible.
- Treat physical phone, novice onboarding and copied deployment verification as open until actually completed.
