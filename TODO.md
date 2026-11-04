# Next work

## Grade editing and GPA development

- [x] Keep assignment edit and drop available when a what-if course total cannot be calculated; place the edit caret after the current score.
- [x] Show the official grade with a separate what-if projection, including explicitly marked teacher overrides.
- [x] Add the Dublin GPA estimate and move course levels, semester credits and exclusions behind Edit courses.
- [x] Show a teacher override example in sample mode and use % for the what-if delta.
- [ ] If the original affected snapshot is available with the student’s consent, identify which condition disabled editing in the old build.
- [ ] Compare the estimate with an owner-confirmed same-semester roster and check the new score editor on a physical phone.
- [ ] Owner acceptance before cutting the next stable; Carmen work stays development-only.

## GPA and Carmen investigation — November 1, 2026

- [x] Fix Muse's reported HTTP proxy gap with one measurement-options helper for both standalone request contexts. Respect environment proxy/bypass settings without logging values. Validate regression, 202 tests/build, actual no-session proxied Canvas 401/JSON, and a private replacement ZIP changing only the lab source and README; preserve all original private state and deadlines.
- [ ] Have Muse stage the proxy-fix ZIP separately, replace only the installed lab script, run its no-session environment-proxy smoke and retry the failed init. Wrangler/account authorization already passed there per the owner; no successful VM baseline/coordinator/cron is claimed. Ensure cron inherits its proxy environment privately. Preserve the November 8 authorization end and do not poll Mac copies.
- [x] Investigate Cloudflare 429 with authenticated account/session checks and read-only usage analytics; observe creation returning after UTC reset. Retain the 654,396 ms old-day report and 2,836 ms post-reset blank-browser lease without claiming exact billing or SSO recovery time.
- [x] Capture two independent owner sign-ins in local human-controlled windows, save encrypted cookies/state in persistent private storage outside Git, verify both course paths and a post-close active HTTP read. Leave the idle profile untouched. Update the self-contained handoff and private CURRENT.json.
- [x] Add routine browser-budget measurement/guards, actual Cloudflare versus local runtime separation, one recovery per tick, acquisition spacing and budget/unknown deferrals. Prepare the private two-profile Muse ZIP and exact device-login/init/cron/status/budget instructions; validate with 201 tests/build/source packaging and offline bundle checks.
- [x] Owner sent the original private bundle to Muse and authorized Wrangler there; superseded by the proxy-correction/retry task above. VM baseline and cron remain pending.
- [ ] Observe natural expiry and repeated Cloudflare recovery episodes; measure routine browser use WELL below ten minutes/day (trial target at most two minutes), practical human sign-in frequency and migration effects before implementing/enabling a Canvas option. Enrolled-course parsing/full snapshots/phone acceptance remain unverified.

- [x] Verify the side-chat proposal against current source/primary docs; correct stale claims about the already-tested course endpoint and explicitly extended local authorization.
- [x] Separate scheduled HTTP-only/no-renew measurement from a one-attempt, separately invoked recovery observation. Record safe OSU/Duo/policy/technical stages, first-page counts/score-field presence, actual expiry windows and provenance/quiet-week limitations; validate with build and 189 tests.
- [x] Add a self-contained [fresh-thread handoff](docs/CARMEN_HANDOFF.md), exact persistent Mac storage paths and actual file status, linked from AGENTS/PWA handoff. Original temporary state/archive are missing; the evening status attempt made no provider request. No original multi-hour lifetime can be reported.
- [x] Supersede the earlier fresh-capture blocker: both local owner captures now exist and are verified. The failed 6:14 PM key-only directory is historical; use the current handoff/trial instead.

- [x] Implement the two-profile benchmark: active five-minute checks, sequential 2/4/8/16/24/48h idle gaps, schema-valid course/total-score reads, explicit seven-day lab authorization, real expiry bounds, bounded silent recovery and separately recorded human/unknown outcomes. Keep normal refreshes HTTP-only and preserve unknown Duo cases in sample bounds.
- [x] At the owner’s request, check the existing session now: identity accepted at 2:11 PM EST (288 ms); course-total path accepted at 2:17 PM (409 ms) and 2:21 PM (404 ms, valid empty list). No browser/relogin was needed. Draft an unsent email to carmen@osu.edu using OSU’s official contact listing.
- [x] Supersede the earlier idle-only capture task: the original temporary active state is now missing too; both fresh captures are pending above. Never clone one session to create the second probe.
- [x] Prepare the owner/Muse private export and exact bounded-trial commands. Actual VM initialization/trial remains pending above; no local cron was installed.

- [x] At the owner's explicit request, prepare a private portable session/checker bundle for Muse's VM, without an OSU password, Schoology secrets or Cloudflare credentials. Add local headless renewal mode and fix symlinked CLI entry handling; validate with 172 tests/build/export checks. No provider read or idle reset occurred.
- [x] Supersede the earlier single-profile VM quiet-check plan with the two-profile benchmark above. The old uploaded archive is not two independent sessions and keeps its original 48-hour identity-only scope; no VM install/cron is claimed.

- [x] Clarify the Muse benchmark for the owner's actual question: normal `check --consent` automatically attempts silent renewal on authentication rejection; log normal/auto-renewed/human-attention/error outcomes after quiet gaps. No-renew mode remains available for isolated expiry observations, not the default automatic-recovery benchmark. No cron/model schedule/provider call was started.

- [x] At the owner's request, perform one additional HTTP-only saved-session check: accepted after 24m31.615s idle in 349 ms, no Chrome/renewal/grades. Log actual timing privately and update the Muse handoff baseline; no scheduled AI checks were re-enabled.

- [x] Add HTTP-only/no-renew observations and private timestamped logging; validate with 171 tests/build/package. Prepare a private Muse handoff for deterministic cron with no recurring model use.
- [x] Delete both newly created Codex follow-up schedules at the owner's request before either ran. No Codex session-check automation remains; Muse/system cron has not been installed by this task.
- [x] Supersede the original sparse-only 48-hour plan with the explicit active/idle seven-day protocol above. Keep the distinction between active-use survival and idle expiry and retain branch-only/no-release scope.

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
