# Next work

## GPA and Carmen investigation — November 1, 2026

- [x] Add HTTP-only/no-renew observations and private timestamped logging; validate with 171 tests/build/package. Prepare a private Muse handoff for deterministic cron with no recurring model use.
- [x] Delete both newly created Codex follow-up schedules at the owner's request before either ran. No Codex session-check automation remains; Muse/system cron has not been installed by this task.
- [ ] Have Muse set up the chosen lightweight experiment: minute ticks gate local due times; sparse HTTP-only checks measure idle behavior. Frequent HTTP polling is a separate active-use experiment and must not be labeled idle expiry. Log actual timing, stop after the finite 48-hour test, and retain branch-only/no-release scope.

- [x] Use the owner's own account for an explicitly permitted identity-only initial sign-in and saved-session check: 254 ms / 269 ms, second check HTTP-only with no Chrome. No grades were requested; retain secrets/state only in the private encrypted lab.
- [x] Fix live-test completion/cookie-header bugs: wait for explicit human Done through first-use screens, preserve multiple Set-Cookie fields, stage encrypted pending state before identity verification and sanitize transport diagnostics. Add regression evidence; no automatic policy/MFA acceptance.
- [ ] After an agreed quiet interval, recheck the owner's saved session and measure actual expired-session renewal/MFA frequency once Cloudflare allows browser launch. Warm-SSO attempts were blocked at launch by 429, so no silent-renewal timing, idle lifetime, Worker portability or grade retrieval is established. Preserve branch-only release hold.

- [x] Prepare the isolated friend-login lab: private direct sign-in/MFA handoff, managed HTTP cookie rotation, same-account checks, encrypted external session state, bounded silent renewal and sanitized timings. Validate with synthetic/headless tests and public-only Cloudflare handoff/cleanup; [friend instructions](docs/CARMEN_FRIEND_TEST.md). No friend account has been accessed.

- [x] Record the owner's release hold in AGENTS.md: retain GPA/Carmen work on the GitHub development branch; no main merge, release tag/publication, stable-installation update or production deploy until explicitly lifted.
- [x] Make silent automatic Carmen reconnect the default intended active-refresh behavior, with usable account-matched cached grades throughout; show manual Reconnect only for verified human sign-in. Separate API grade-retrieval timing from browser/login timing and mark the current totals probe as partial.
- [ ] Implement and validate that automatic reconnect once actual-account session portability/renewal is proven. Keep one coalesced bounded renewal across devices, distinct provider-session/disconnection states, saved-data retention through slow/error/quota paths, and separate warm/cold/expired-session full-snapshot timing. This remains branch-only under the release hold.

- [x] Investigate weighted/unweighted Schoology GPA and OSU Carmen feasibility using current source and official documentation; record [findings, policy gaps and implementation path](docs/GPA_AND_CARMEN_RESEARCH.md). No feature implementation or live student reads were part of this work.
- [x] Use the privately supplied transcript as a comparison and verify the public Dublin table: plus/minus 3.33/3.67-style values, no difficulty bonus for D+ and below, conditional CCP weighting and non-GPA credit exclusions. Retain public rules only, with no personal image/rows/totals in source or fixtures.
- [ ] Implement estimated semester GPA when requested: use the documented Dublin point/bonus table, local level/inclusion/credit overrides including eligible CCP/CTAG, confirmed percentage rounding/provider representation and semester credits, one contribution per physical course-semester, visible partial results and baseline/scenario separation. Distinguish GPA attempted credit from earned/graduation credit. Add focused core/persistence/browser coverage.
- [x] Inspect Git history for Campus cookies and upstream Canvas session authentication. Own-session GETs are technically plausible; the earlier OAuth-only conclusion was too broad. Native WebKit capture/Keychain renewal cannot be copied directly into a PWA.
- [x] Verify the documented Carmen two-hour idle timeout and separate BuckeyePass 24-hour trust option; write [short consent/capture instructions and an honest reconnect design](docs/CARMEN_SESSION_TEST.md). Prepare a private-file opt-in diagnostic with synthetic security/error/output checks; no live cookie test or app connection UI is complete.
- [x] Record the owner's hard requirement: seamless low-maintenance phone/desktop PWA use, either device operating independently, and existing local history/what-if behavior. Routine cookie transfers and a desktop-dependent companion are not product solutions; no separate cloud history/scenario sync is requested.
- [x] Clarify the no-personal-token constraint: OSU's disabled student-generated tokens differ from app-issued OAuth access/refresh tokens; the earlier OAuth proposal used the latter after institutional app approval and normal student authorization. The latest owner requirement excludes that approval-dependent route. The August 11, 2026 notice confirms students still cannot generate personal tokens despite the instructor exception. No exported browser cookies are needed for the OAuth design, but approval remains unavailable and the connection is not implemented/tested.
- [x] Incorporate the owner's additional no-institutional-approval requirement; approved OAuth is no longer the selected product path. Test real cloud-browser primitives with synthetic cookies/local storage and existing vault encryption, plus public-only OSU login reachability. Record the [on-demand browser candidate, quotas and evidence](docs/CARMEN_BROWSER_RESEARCH.md).
- [x] Add public-browser phase timings and opt-in sanitized HTTP-read timings; run three public-only login navigation samples and write the [controlled lifetime/renewal protocol](docs/CARMEN_SESSION_BENCHMARK.md). Specify cached-grade retention with a separate reconnect-required state; no Carmen UI/session-lifetime claim is made.
- [ ] With explicit account-holder permission, test cloud-browser normal sign-in, narrow own-session API access, isolated-Worker cookie portability/rotation, restoration/SSO renewal after idle and overnight, actual browser seconds and repeated physical-phone refresh with desktop off. Do not promise a sufficient ten-minute budget or low maintenance before measurement. Use existing personal Worker/crypto/local history and preserve its current URL/vault/password/session/update boundary; no production binding/provider is added yet. A successful personal test does not establish approved multi-user distribution.
- [ ] Optional diagnostic only: if the account holder explicitly wants the cookie proof, validate narrow own-session GET access without exporting OSU SSO cookies. No capture/live test has been performed; a successful result alone does not meet the required product experience.

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
