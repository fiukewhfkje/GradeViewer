# Next work

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
