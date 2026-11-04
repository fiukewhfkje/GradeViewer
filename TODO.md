# Current follow-up — November 4

- [x] Retain verified blank Schoology enrollments with no invented grades; reuse their metadata and keep aliases deduplicated.
- [x] Add reversible class hiding across periods, independently of GPA exclusions.
- [x] Complete browser checks for blank enrollments, hide/restore persistence, GPA retention and responsive Settings.
- [ ] Read the selected IC course's actual period/task metadata and fix semester/GPA normalization using supported provider data/rules.
- [ ] Deploy validated follow-up only to the owner's existing Worker; keep Carmen separate and undeployed.
- [ ] Resume the stable release only after the owner lifts the latest stop.

# Next work

## Automatic Cloudflare builds — November 4

- [x] Diagnose the rollback/version conflict at the separate secret upload and deploy code plus password in one operation.
- [x] Observe a successful automatic Cloudflare build with the corrected deployment helper and verify the live assets and existing vault/password bindings.

## Graphs and IC selection — November 4

- [x] Show generic labels for unnumbered periods and limit displayed graph points to the last 60 days. Keep single-point lines and stored history.
- [x] Remove the requested Settings footnotes and explain separate IC classes and duplicate GPA contributions.
- [x] Open the course picker immediately, reuse its list during a Settings visit, and test with delayed synthetic provider responses.

## Desktop app polish — November 4

- [x] Replace the sidebar lettermark with the app icon, remove duplicate labels and the tagline, and tighten desktop spacing.

## Automatic IC sign-in — November 4

- [x] Fix Workerd’s Illegal invocation in the IC transport and reproduce the correction in the remote runtime without credentials or Browser Run.
- [x] Overlap local import deployment with sign-in and close the captured local Campus window before import verification.
- [x] Confirm the owner’s real session persists on Cloudflare and the restored normal Worker can fetch the IC course list.

- [x] Prepare the temporary browser in Settings before offering the sign-in link. Report startup and daily quota errors without opening a blank tab.

- [x] Recognize the short Student Profile URL, verify and close the temporary browser automatically, and show the result in Settings.
- [x] Validate automatic capture, close and normalization in local Chromium with an HttpOnly fixture. Prepare an opt-in local check for the account holder.
- [x] Confirm automatic capture, local Chrome closure and a normalized snapshot of one real class with the owner’s district sign-in.
- [ ] Verify a real district sign-in reaches the course picker after Browser Run capacity is available. Check local Live View closure on desktop and phone.

## IC browser use and graph hover — November 4

- [x] Use Browser Run only for explicit IC sign-in and reconnect. Overlap Live View setup and the first navigation.
- [x] Show the graph tooltip on mouse hover with the normal cursor. Preserve touch and keyboard input.
- [ ] Confirm sign-in timing and full SSO using the owner’s district and account.


## IC sign-in, Settings and cached startup — November 4

- [x] Recover the historical district-finder flow and modern Student URL handling. Remove the pasted-address setup.
- [x] Rework Settings into bounded, independently flowing columns and remove repeated grade-loading UI. Add account/expiry-bound immediate local cache restoration with an explicit local lock.
- [x] Validate both themes across 12 phone/split/tablet/laptop/monitor sizes, expanded forms, cached-before-status startup, offline reuse and locking.
- [x] Deploy the IC/UI follow-up to the existing owner Worker and carry it to the held Carmen branch.


## IC owner testing and Carmen development — November 4, 2026

- [x] Implement the optional Settings IC course checklist, shared course/GPA model, independent snapshot/history identities, read-only session transport and reconnect retention. Polish the connection card/actions and replace native checkboxes with styled switches.
- [x] Keep only main and the Carmen investigative branch locally/remotely; retain clean old release worktrees detached.
- [x] Complete cross-browser/source verification: 186 tests, 31 flows in each engine, source packaging, Worker dry-run, zero-vulnerability dependency audit and isolated-template update/rollback pass.
- [x] Verify real synthetic cookie restore/persistent CDP capture/Live View/cleanup and deploy IC through main to the owner’s existing Worker. Five asset hashes, unchanged vault binding, secret-password presence and locked unauthenticated API verify; no stable tag/release was created.
- [ ] Owner/friend acceptance: actual district login, strict IC roster identity shape, assignment/period/rule compatibility, selected-class GPA and physical phone/reconnect behavior. No live IC account was available during implementation.
- [ ] Finish Carmen on codex/investigate-gpa-carmen using documented Canvas schemas and synthetic fixtures; no deployment. Keep 90-minute HTTP session maintenance bounded and distinguish an attempted keepalive from verified session extension. The owner will arrange enrolled-course testing later.


## v0.1.10

- [x] Align GPA switches and add a temporary letter-grade what-if estimate.
- [ ] Confirm signed publication and the owner’s Cloudflare deployment.

## v0.1.9

- [x] Verify local assignment editing, straight-points grades, the teacher override display and the Dublin semester GPA estimate.
- [x] Confirm signed publication and the owner’s Cloudflare deployment.
- [ ] Compare the estimate with a confirmed same-semester roster and check the editor on a physical phone.

## Native retirement — October 23, 2026

- [x] Remove Swift sources, GradeCore package, Xcode project, signing configuration, native assets, tests, fixtures and helper scripts; retain them in Git history.
- [x] Remove native build caches and project-local signing overrides.
- [x] Remove the macOS/Swift CI job and all cross-language calculator comparison machinery. The final 1,200 synthetic comparisons passed; the owner requested removing them rather than maintaining a frozen corpus. Keep focused web calculator regressions.
- [x] Replace native development instructions and architecture with the active PWA model; remove obsolete native setup instructions and links.
- [x] Verify the integrated v0.1.8 web-only production build, 152 tests, 28 flows per browser, Worker dry-run, source packaging and isolated-template update/rollback; record actual local evidence.

## October 20 responsiveness and stable release (completed)

- [x] Add a desktop sidebar/course grid and wider course/Profile layouts; inspect synthetic screenshots.
- [x] Show authenticated account-matched saved grades during background refresh, remove duplicate startup status reads and defer optional returning-open title traversal.
- [x] Keep held graph selection during vertical drift, follow display frames and scale the tracing marker to the desktop plot.
- [x] Replace quarter-to-quarter graph jumps with guarded weighted semester progression and authoritative semester observations.
- [x] Separate update activation/loading state, wait for controller takeover and avoid offering the running shell again.
- [x] Preserve open courses/forms across another tab's refresh and merge local edits saved during a refresh.
- [x] Finish local browser/template checks, remote release gates, signed stable v0.1.8 publication and immediate deployment to the existing owner URL. Final CI passes 152 tests, 28 flows per browser, 119 Swift tests and 1,200 calculation comparisons; live assets and real published provenance verify.
- [x] Verify the retained real production v0.1.7 PWA installs v0.1.8 with identical synthetic local state and second-tab form retention, explicit activation in both tabs, and no repeated update notice.
- [ ] Complete physical iPhone/Android acceptance and measure real account latency; synthetic startup/gesture/browser evidence does not establish those results.

## Remaining PWA follow-ups

- [ ] Observe the brother’s natural midnight Eastern stable-update check. The intended October 18, 2026 run has no recorded acceptance evidence; do not infer success from its date passing.
- [ ] Complete independent-account Cloudflare signup/setup, Schoology connection, automatic update and rollback, including real credential/local-state retention. Prior maintainer-account and synthetic checks do not establish that full chain.
- [ ] Validate physical iPhone Safari/Home Screen and Android installation, scrolling/pull refresh, course/back/graph/keyboard, foreground return, storage and updates. Headless emulation is limited evidence.
- [ ] Improve and measure expired-metadata/late-open refresh toward the requested couple-second target while retaining complete fresh reads and fixed TTL. Last recorded natural-expiry sample: 3.043 seconds / six calls; phone startup/render timing remains unmeasured.

Preserve account-bound read-only complete snapshots, reversible local changes, the existing Worker/vault/password and signed source-update verification. Never invent provider omissions, missing scores/dates or successful validation. Earlier native/migration checklists remain in Git history; current evidence is in [PROJECT_STATUS.md](PROJECT_STATUS.md) and [PWA_VALIDATION.md](docs/PWA_VALIDATION.md).
