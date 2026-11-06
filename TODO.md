# Parallel session diagnostics — November 6

- [x] Read both saved records. IC reached 37h 35m with 140/140 successful HTTP checks. Carmen reached 36h 19m with 29 successful checks since sign-in. Neither recorded an authentication rejection or automatic recovery attempt.
- [ ] Observe the first authentication rejection, if one occurs, and record the last-success/first-rejection interval and any Carmen recovery or human sign-in outcome. The current observations establish lower bounds under active checks. Maximum lifetime and idle behavior remain open.

# Parallel overnight diagnostics — November 5

- [x] Read both saved Worker records without provider requests or Browser Run. IC: 42/42 successful checks, 24 alarms; Carmen: 11 successful checks after the original setup 403, five alarms, successful fresh connection and empty course discovery. Both have about 9h 19m sampled verified uptime and no automatic recovery attempts.
- [x] Separate overnight alarm events from manual/foreground activity. Carmen's five alarms follow 90-minute intervals; retained IC alarms follow about 20 minutes with one successful 24m 27s gap of unknown cause.
- [x] Re-read saved diagnostics at 08:44 EST: unchanged recent successes and zero automatic re-login/recovery attempts. Confirm the Worker uses encrypted cookie jars; operator diagnostics cannot expose cookie values or establish individual rotations. No new provider probe or experiment change.
- [x] Clarify counter semantics from source: 24 scheduled IC alarm checks plus 18 app-driven checks, including automatic app-open/foreground refresh and provider Settings actions. These are not counts of manual refresh presses; `manual` identifies Check connection, while grade refresh uses `foreground`. Preserve no idle grade polling.

# Parallel session checks — November 4

- [x] Read the actual saved Carmen failure: first profile GET returned 403 before course discovery; do not label this an expired session or proven permission denial.
- [x] Correct Canvas request headers and add bounded, sanitized rejection details without launching another cloud browser.
- [x] Add independent IC 20-minute HTTP maintenance, pause/reconnect controls and compact health/uptime; retain Carmen's 90-minute experiment.
- [x] Store separate private IC/Carmen diagnostics readable after provider rejection, with no grade/cookie/identity contents.
- [x] Validate and deploy owner development commit 479149d. Verify both private diagnostic reads and the existing app/vault authorization boundaries.
- [x] Fresh Carmen sign-in and subsequent IC/Carmen automatic successes begin the parallel live lifetime test, verified from saved November 5 diagnostics. Neither idle extension nor a universal 30-minute IC session is established.

# Carmen owner-only experiment — November 4

- [x] Keep main/stable separate and incorporate current shared fixes into Carmen development.
- [x] Add reversible main-LMS selection without disconnecting either provider or deleting saved data.
- [x] Add 90-minute HTTP maintenance with bounded silent recovery and explicit human-action stops.
- [x] Keep Settings minimal; store detailed diagnostics on the Worker with a narrowly scoped private operator retrieval key, honest health indicators and recovery documentation; correct the unconditional 24-hour MFA assumption.
- [x] Pass build/type check and 294 local tests.
- [x] Complete headless Chromium/WebKit (37 flows each), isolated package/update and Worker checks; inspect compact phone Settings and 320/768/1440 containment.
- [x] Deploy development 963efe8 (0.2.2-alpha.0) only to the existing owner Worker; verify six asset hashes, unchanged vault/password/browser bindings, locked APIs and read-only private operator retrieval. Main/stable remain unchanged.
- [x] Pass hosted development CI in both browser engines (run 41964207144), with release jobs skipped.
- [x] Owner completes fresh Carmen sign-in to begin measurements; November 5 saved diagnostics confirm the connection and overnight checks. No old Mac/Muse session was imported.
- [ ] Observe actual recovery outcomes and human-action frequency over time; do not promise two-week uptime.

# IC graph follow-up — November 4

- [x] Read task-level category/score-percent options and backfill fresh IC semester curves through the existing baseline-checked calculator.
- [x] Validate 209 tests, both full 35-flow browser suites, packaging and Worker dry-run locally without Browser Run.
- [x] Complete isolated-template install/build/update-fixture/configuration-secret retention/rollback checks.
- [x] Complete both hosted browser suites, verify the existing owner deployment and publish signed v0.2.1 from aad372b; downloaded hashes/provenance/latest-stable status pass.
- [ ] Confirm the owner graph after a normal IC refresh; new account results were not captured during this fix.
- [x] Trace flat semester graphs with dated assignments to the explicit-weight reconstruction gate; run the 44 existing graph/IC tests.
- [x] Normalize verified, parent-specific IC composite calculation weights so compatible dated assignment prefixes can reconstruct semester history. Preserve observed history, baseline validation and withholding when rules are incomplete; do not infer weights from matching totals.

# Held Carmen branch sync — November 4

- [x] Carry main 0.2.0 refresh/CI changes into the Carmen development branch without merging Carmen into main.
- [x] Validate both provider-specific callbacks, 285 tests, 37 flows per browser, build, packaging and Worker dry-run.
- [x] Keep Carmen outside main/stable publication; the latest owner-only deployment exception supersedes the earlier undeployed hold. Enrolled-account acceptance and any broader release remain pending.

# Stable 0.2.0 follow-up — November 4

- [x] Remove idle polling, repeated visible-event scans, automatic cooldown-expiry retry and inline 429 retry; retain fresh opens/returns and manual refresh.
- [x] Refresh only IC for IC settings actions, preserving Schoology cooldown and provider/account boundaries.
- [x] Replace fixed browser-test delays with controlled fixture responses/alarms and consolidate duplicate CI checks.
- [x] Complete build/type check, 207 tests, all 35 flows in each browser, package/dry-run, isolated-template update/rollback and production dependency audit.
- [x] Complete hosted CI and measure the new workflow: 2:00 overall and 44/46-second browser suites in the first completed run.
- [x] Publish v0.2.0 from main 4f8da78, verify downloaded provenance/hashes/latest status and the existing owner Worker, and carry shared fixes onto the undeployed Carmen branch at 9d542bb.

# Current follow-up — November 4

- [x] Restore omission of blank Schoology enrollments and remove class hide/restore controls at the owner's request.
- [x] Clear the temporary blank placeholders and retired hide flags when reading saved snapshots and interrupted recovery, preserving real grades and edits.
- [x] Validate the restored course filtering, removed hide controls, cached cleanup and retained IC semester/GPA flow.
- [x] Deploy main f6eeb69 to the owner Worker, verify assets and vault/password/auth boundaries, and carry the rollback to the undeployed Carmen branch at 9b29ccc.
- [x] Read the selected IC course's actual period/task metadata and normalize composite Final semester spans using explicit child references and reported totals.
- [x] Complete local semester/GPA normalization and browser validation.
- [x] Deploy the semester correction through bed8049 and verify assets, vault/password bindings, locked APIs and successful main CI.
- [ ] Confirm semester display/GPA with an owner refresh; no numeric student-grade capture was used for this fix.
- [x] Deploy the blank-course/hide follow-up only to the owner's existing Worker; verify assets and vault/password/auth boundaries. Keep Carmen separate and undeployed.
- [x] The owner lifted the main release hold; v0.2.0 is published. Carmen remains held and undeployed.

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
- [x] Deploy the IC and Settings follow-up to the existing owner Worker. Verify all five public asset hashes and vault binding preservation. Merge the follow-up into the held Carmen branch.
- [ ] Confirm district SSO and grade import with a student account and check physical devices.


## IC owner testing and Carmen development — November 4, 2026

- [x] Implement the optional Settings IC course checklist, shared course/GPA model, independent snapshot/history identities, read-only session transport and reconnect retention. Polish the connection card/actions and replace native checkboxes with styled switches.
- [x] Keep only main and the Carmen investigative branch locally/remotely; retain clean old release worktrees detached.
- [x] Complete cross-browser/source verification: 186 tests, 31 flows in each engine, source packaging, Worker dry-run, zero-vulnerability dependency audit and isolated-template update/rollback pass.
- [x] Verify real synthetic cookie restore/persistent CDP capture/Live View/cleanup and deploy IC through main to the owner’s existing Worker. Five asset hashes, unchanged vault binding, secret-password presence and locked unauthenticated API verify; no stable tag/release was created.
- [ ] Owner/friend acceptance: actual district login, strict IC roster identity shape, assignment/period/rule compatibility, selected-class GPA and physical phone/reconnect behavior. No live IC account was available during implementation.
- [x] Finish Carmen runtime on codex/investigate-gpa-carmen using documented Canvas schemas and synthetic fixtures; no deployment. Implemented bounded 90-minute HTTP session maintenance with opt-out, cookie rotation, identity binding, retries and rejection pause; this does not establish session extension. The owner will arrange enrolled-course testing later.
- [x] Validate Carmen build/type checking, 264 tests, 33 browser flows in each engine, 99-file source package, isolated-template update/rollback and zero-vulnerability dependency audit. Keep the current owner production IC assets unchanged.
- [ ] Carmen acceptance: enrolled-course response/permissions, actual graded/ungraded/override cases, credits/letters against the schedule, cloud human sign-in/reconnect, physical-phone UI and a measured 90-minute keepalive trial. A saved ACTIVE capture currently rejects authentication; no current course contents were verified.


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

## Selected Infinite Campus courses and Settings — November 4, 2026

- [x] Reassess IC using Git history, the current PWA core, official documentation and synthetic probes. Record the account-specific removal decision, historical native SSO evidence and unmeasured session lifetime in [the report](docs/INFINITE_CAMPUS_REASSESSMENT.md).
- [x] Rename Profile to Settings with a settings icon and matching navigation/help/docs/browser selectors. Keep the change on the development branch.
- [x] Record the owner's selected-course design: optional IC connection/checklist in Settings; Schoology stays automatic; no linking, mapping screens or cross-provider deduplication. Use the same grade/GPA UI for supported normalized IC data.
- [x] Record the owner's fast reconnect requirement: silent renewal first, one-click normal sign-in when needed, automatic resume with selections/history/local edits retained, and independent usable Schoology data. No 30-day lifetime or renewal-speed guarantee is established.
- [ ] With explicit account-holder consent, prove an IC PWA-compatible sign-in/capture path, verified same-student binding, Worker HTTP reads/rotation and silent/human reconnect. Do not reuse Carmen sessions or assume the retired native WebKit capture works in a PWA.
- [ ] Once access is proven and implementation is requested, add strict IC normalization, saved selected-section configuration, provider-scoped identities/history/snapshot partitions and period visibility. Reuse existing course/GPA controls with valid semester data; retain incomplete states when only quarter grades or unsupported rules are available. Add synthetic failure/empty/reconnect-retention and browser coverage. No IC runtime feature is implemented yet.

## Grade editing and GPA development

- [x] Keep assignment edit and drop available when a what-if course total cannot be calculated; place the edit caret after the current score.
- [x] Show the official grade with a separate what-if projection, including explicitly marked teacher overrides.
- [x] Add the Dublin GPA estimate and move course levels, semester credits and exclusions behind Edit courses.
- [x] Align GPA switches, add a temporary letter-grade what-if estimate, and publish/deploy v0.1.10 with verified provenance and signed update preservation.
- [x] Show a teacher override example in sample mode and use % for the what-if delta.
- [x] Reproduce the straight-points mismatch and use the points calculation when it uniquely matches a reported quarter total.
- [x] Verify the matching course’s metadata read-only and use straight points when weighting is off and category weights are zero or absent.
- [ ] If the original affected snapshot is available with the student’s consent, identify which condition disabled editing in the old build and confirm how the course combines categories.
- [ ] Compare the estimate with an owner-confirmed same-semester roster and check the new score editor on a physical phone.
- [x] Publish and deploy the approved v0.1.9 app changes. Carmen work stays development-only.

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
