# Carmen lifetime, renewal latency and reconnect acceptance

This is the next real-account test protocol, not a completed Carmen integration. The owner wants infrequent manual sign-in, normal phone/desktop PWA operation and saved grades during renewal. The owner provided their own interactive sign-in; its encrypted session is available privately. Saved-session identity and course-total HTTP reads have passed. Actual idle lifetime, successful silent renewal timing and Duo frequency remain unmeasured. Public-login/platform timings are recorded below separately.

Owner clarification: **automatic silent reconnect is the default** after a confirmed expired Carmen session during normal active use. Show authenticated, account-matched saved grades immediately and keep them usable during both renewal and grade retrieval. The manual Reconnect button is the fallback for verified password/MFA input, not a prerequisite for trying silent SSO. All GPA/Carmen work remains GitHub-development-branch-only under the owner's release hold; do not merge to main, publish tags/releases or deploy to production.

## What actually runs

Renewal would be deterministic headless Playwright/Puppeteer code invoked by the personal Worker: restore encrypted browser state, navigate to Carmen, allow normal SSO redirects, verify the same account, export updated session state and close Chrome. There is no AI screenshot/click loop, and the student runs no terminal command. [Cloudflare supports programmatic Playwright control](https://developers.cloudflare.com/browser-run/cdp/playwright/). If normal SSO requires user input, the code stops and offers Cloudflare's [interactive login handoff](https://developers.cloudflare.com/browser-run/features/human-in-the-loop/); it must not fill a stored OSU password or bypass MFA.

The CLI is an operator testing tool, not the product UI. A direct HTTP renewal could be considered only if actual traces establish a stable, scoped normal flow; it is not already implemented or assumed possible. Rendering a real browser is the current candidate for SSO compatibility. Browser restoration does not itself renew an expired server-side session.

## Current timing evidence — three public-only samples

On November 1, 2026, the isolated diagnostic produced these wall-clock timings in milliseconds:

| Phase | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: |
| Get existing Cloudflare credential via CLI | 333 | 335 | 393 |
| Create cloud browser via CLI | 892 | 1,349 | 1,487 |
| Attach Playwright over CDP | 357 | 437 | 559 |
| Open a new page | 87 | 149 | 203 |
| Navigate Carmen → public OSU sign-in | 570 | 645 | 662 |
| Total through public sign-in, including CLI credential step | 2,458 | 2,696 | 3,304 |
| Explicit remote-session closure via CLI | 598 | 610 | 738 |

Every sample reached the public OSU sign-in host with HTTP 200 and closed its browser. This total ends at document-content loading: it excludes password entry, MFA, authenticated SSO, API verification, state persistence and grade refresh. Three samples are exploratory, not tail-latency evidence. CLI process overhead and this machine's network are included; Worker bindings have not been benchmarked. These are wall times, not measured/billed Browser Run usage.

The diagnostic now reports fixed-label `timingsMs` for public navigation and synthetic state handling. Its synthetic mode separately verifies encrypt/close/restore across distinct browsers: one timed successful run took 264 ms to export/encrypt state and 772 ms to decrypt/create a restored browser context. These are exploratory synthetic values, not Carmen renewal latency; both browsers were explicitly closed. One extra immediate launch was rejected before a browser was created; that sanitized run did not preserve an exact provider error, so no cause is claimed. The diagnostic now identifies known quota/rate-limit messages without exposing raw errors. Space separate invocations by at least 20 seconds, follow any reported cooldown and close owned browsers explicitly. No retry loop or keepalive is used.

The [friend-login lab and short consent instructions](CARMEN_FRIEND_TEST.md) now implement the operator handoff, encrypted test-state storage, ordinary Node HTTP checks and bounded browser renewal attempt. The owner has now used them for explicitly permitted identity-only sign-in and saved-session reads. Their Node transport is not the isolated Worker proof required below.

## Original-account baseline

The owner's supervised identity-only sign-in was verified in 254 ms after the human selected Done; a later ordinary HTTP saved-session read took 269 ms with no Chrome launch. The roughly 64-second initial browser interval included waiting for human login/MFA/first-use handling and is **not** silent renewal latency. No grades were requested, so there is still no complete grade-retrieval measurement. Two warm-SSO attempts were blocked at cloud-browser launch, with the later error classified as 429/rate limited; no expired-session renewal was observed. Leave the saved session idle before the next lifetime trial instead of polling it or retrying browser launch repeatedly.

Initial live-test failures were lab bugs rather than measured OSU expiry. The human handoff now requires explicit Done before profile verification, preserving time for first-use screens; no policy is accepted automatically. Multiple response-cookie headers are preserved individually. Completed sign-in state is encrypted as pending before verification so diagnostic failures can be retried without throwing away the human login; only a verified profile activates the bound account.

## Canonical experiment — two independently authenticated profiles

The owner’s November 1 specification supersedes the earlier two quiet checks and identity-only 48-hour plan. Use two separate human-completed sign-ins for the same account, each from a fresh browser profile. Copies of one cookie jar are not independent sessions. The coordinator rejects identical authentication IDs, shared Carmen session-cookie values, different accounts and profiles without verified course-total access. These are accidental-copy guards; they cannot prove independence after arbitrary manual editing.

| Probe | Requests | What it measures |
| --- | --- | --- |
| Active | One HTTP check every five minutes for up to seven days | Survival under active API use; confirmed failures bound expiry between the last success and the failed check. |
| Idle | Wait 2h, then 4h, 8h, 16h, 24h and finally 48h, each from the preceding successful verification | Survival after each actual quiet gap. The waits total 102 hours, not 48 hours. A successful check may reset the idle timer. |

Every check verifies the same-account self-profile and then `GET /api/v1/courses?enrollment_type=student&include[]=total_scores&per_page=100`. Success requires both checks and schema-valid course data. `[]` is success with no visible totals, not an error. HTML, malformed JSON/schema, 403, 429 and network failures are inconclusive, never expiry. Only 401 or a recognized sign-in redirect confirms an authentication failure. The courses request is the documented [Canvas courses/total-scores path](https://developerdocs.instructure.com/services/canvas/resources/courses); it reads the first page only and does not validate every assignment or per-course grade parsing for an unenrolled account.

Normal checks use Playwright’s standalone HTTP client, not Chromium. At a confirmed auth failure, the checker attempts one bounded normal headless SSO recovery, verifies the same account and course path, persists rotated state and closes the browser. A visible recognized Duo, policy or password prompt is logged separately. An unrecognized page, navigation timeout or browser quota failure is inconclusive, not proof that Duo was required. Gate recognition is deliberately narrow and may need adjustment for OSU page changes; it never reads values, fills passwords or clicks MFA/policy controls.

Renewal frequency comes from repeated expiry/recovery episodes across the trial, not from idle checks alone. `renewalMs` measures navigation/verification; `recoveryTotalMs` also includes browser launch, state persistence and explicit closure. These are elapsed diagnostic wall times, not billed Cloudflare browser usage. Logs and status keep silent renewals, human Duo, policy, credentials, unclassified human input and inconclusive attempts separate. A zero-sample Duo fraction is `null`. Recorded-attempt Duo bounds include unknown outcomes: password/policy stops can hide a later Duo challenge, and an inconclusive recovery cannot prove Duo was unnecessary. These bounds describe the recorded sample, not a population confidence interval. Do not infer a weekly human-login rate from one success.

The five-minute schedule keeps a fixed cadence, skipping missed slots rather than catching up in a burst. A minute cron can run slightly late. Logs retain the actual last-success-to-auth-failure window; only a roughly five-minute observed gap supports roughly five-minute precision. Rate limits, transport outages, sleep and missed ticks widen uncertainty. This is active-use survival, not idle expiry.

## Provision and schedule without model calls

Commands below run from `web/`; replace `/PRIVATE` with an absolute owner-only directory **outside the repository**. Node 24+ is required. The browser sign-ins happen only when the account holder is ready and normal browser acquisition is available. No passwords or session files belong in prompts, Git or cron arguments.

```sh
node scripts/carmen-login-lab.mjs start /PRIVATE/active --consent --grades --week
node scripts/carmen-login-lab.mjs start /PRIVATE/idle --consent --grades --week
```

Each command creates a fresh private directory and prints the path of a private login HTML file. The human completes OSU/Duo/first-use screens and selects Done. Each verified capture has its own authentication ID. Do not use `check`, browse, or poll the idle profile after capture. Its first due time is two hours after its course verification, even if coordinator setup happens later. A late setup must be reported as a longer actual gap.

The default lab limit remains 48 hours. Explicit `start --week` authorizes at most seven days from capture. To use an already authenticated **unexpired** original profile as the active probe, the owner can explicitly extend its local authorization and grant course-read scope, then verify once:

```sh
node scripts/carmen-login-lab.mjs authorize /PRIVATE/active --consent --grades --week
node scripts/carmen-login-lab.mjs check /PRIVATE/active --consent --grades --no-renew
```

This is an authorization limit in the lab, not an extension of OSU’s session. It never resurrects expired local state. Reconnects preserve the original limit; the checker refuses state after it. Expiration does not delete private files automatically.

Initialize only after both profiles have independently signed in and verified the course path:

```sh
node scripts/carmen-benchmark.mjs init /PRIVATE/benchmark /PRIVATE/active /PRIVATE/idle --consent
node scripts/carmen-benchmark.mjs tick /PRIVATE/benchmark --consent
node scripts/carmen-benchmark.mjs status /PRIVATE/benchmark --consent
```

For Muse’s separate VM, use `init ... --consent --local-browser` to select that VM’s own headless Chromium for recovery. It needs Playwright/Chromium but no Cloudflare credentials or quota. HTTP-only ticks do not start a browser. VM/IP/device migration may itself trigger authentication and is a separate confound; VM renewal latency cannot establish Cloudflare Worker latency or billed usage. See [portable VM scope](CARMEN_VM_TEST.md).

An ordinary OS cron can invoke the following every minute, with absolute Node/repository/private paths. This is a code-only tick, not an LLM task:

```cron
* * * * * cd /ABS/GradeViewer/web && /ABS/node scripts/carmen-benchmark.mjs tick /PRIVATE/benchmark --consent >> /PRIVATE/benchmark/cron.log 2>&1
```

Create `cron.log` with mode 600 first. Ticks only read local due times until a probe is due, use a lock, persist an in-flight marker before requesting, and stop provider/browser access at the earliest profile authorization deadline or seven-day trial end. A stale crash lock must be reviewed and removed only after confirming no tick process is running. An interrupted in-flight check then requires a fresh verified check and explicit `resume`; it is never automatically repeated. Remove the cron entry after completion. No cron or recurring model job has been installed here; the previous two Codex schedules were deleted before running.

On a verified human prompt, failed cleanup or inconclusive response, that probe pauses rather than retrying every minute. Keep notifications quiet on ordinary success; report a pause, cleanup failure or trial completion. For a human-required pause:

```sh
node scripts/carmen-login-lab.mjs reconnect /PRIVATE/idle --consent --grades
node scripts/carmen-benchmark.mjs resume /PRIVATE/benchmark idle --consent
```

For a transient error, make an explicit normal `check --consent --grades` after investigating/cooldown, then `resume`. A new successful course verification is required. The resumed timestamp is recorded as an external intervention. A confirmed-expiry idle phase advances to its next wait after recovery; an inconclusive phase repeats its same wait from the new successful baseline. Other use of a captured profile contaminates quiet intervals. The coordinator detects changed local verification timestamps, but cannot detect every use elsewhere; report such interventions.

## Evidence as of November 1

At the owner’s request, the existing original session passed HTTP identity verification at **19:11:45.934Z (2:11 PM EST)** in **288 ms**, after 37m19.126s since its previous successful check. At **19:17:05.139Z (2:17 PM EST)** it passed identity plus the real course-total endpoint in **409 ms total** (identity 285 ms; courses 125 ms; rounded phases). A further check at **19:21:01.940Z (2:21 PM EST)** took **404 ms** and explicitly confirmed the schema-valid empty course list (`[]`). No browser/relogin was needed. This resets the original profile’s activity baseline; it does not establish a long idle lifetime. Account data was not printed.

The owner then requested a fresh independent idle sign-in. Both a first launch and a spaced retry returned sanitized Cloudflare 429 before OSU navigation; an inventory read confirmed zero active cloud browsers. This is a browser-provider failure, not a Carmen expiry. No second authenticated profile or running two-probe trial is claimed until the human sign-in succeeds. The original session’s explicit local authorization has been extended to seven days with course-read permission; the old single-session VM archive is superseded for this experiment.

OSU documents [two-hour Carmen inactivity logout](https://it.osu.edu/news/2025/08/18/technology-updates-autumn-2025) and [24-hour BuckeyePass browser trust separately](https://it.osu.edu/security/services/buckeyepass). Neither proves an absolute OSU SSO lifetime or weeks of unattended renewal. The [support email draft](CARMEN_SUPPORT_EMAIL.md) asks the Carmen team for exact configuration and permitted student access methods; it has not been sent.

## Grade retrieval is a separate measurement

The measured 2.46–3.30 seconds is **not** time to fresh grades. Existing `--grades --timing` reports `timingsMs.courseTotals` separately from identity verification, but reads only the first course-total page. It does not fetch every assignment, category or page, build a complete snapshot or measure phone rendering. A quick first-page total response cannot establish the speed of the complete grade viewer.

For actual-account acceptance, record these three cases separately: an ordinary refresh with a valid session; a cold complete snapshot with required metadata; and expired-session recovery followed by a complete refresh. Measure identity verification, ordinary API retrieval, any browser renewal, parsing/reconciliation, IndexedDB persistence and UI activation independently, plus total time to the fresh complete snapshot. Record sanitized phase durations/request counts only. Include pagination and whatever assignment/category metadata the implementation actually needs; do not extrapolate from Schoology timings or unauthenticated Carmen navigation. A first-screen total and a fully loaded course detail may have different completion times and must not be presented as the same result.

The saved snapshot should become visible before that work starts once app authentication/account matching permits it. A slow renewal or retrieval keeps the existing quiet Updating grades state and usable cached courses; it must not turn into a blocking login/loading screen or a forced browser popup. Complete verified snapshots still activate atomically. No speed threshold, end-to-end Carmen timing or complete retrieval implementation is established yet.

## PWA behavior to implement with the Carmen connection

The current Schoology app already restores an authenticated, account-matched complete snapshot before fetching and keeps it visible on provider failure with Showing saved grades / Retry. Reuse that behavior for Carmen, keeping the PWA's own password/session lock separate from Carmen authentication. This document does not claim a Carmen button exists today.

| Observed connection state | PWA response |
| --- | --- |
| Ordinary refresh or automatic renewal | Keep courses, history, what-if edits and open forms visible; show a quiet Updating grades indicator. |
| Confirmed expired Carmen session, no cooldown | Automatically attempt one coalesced silent renewal, then resume ordinary grade retrieval. Keep the saved snapshot visible; no manual reconnect click or interactive popup is required for this attempt. |
| Verified human sign-in required | Show **Carmen needs you to sign in. Showing saved grades.** with **Reconnect to Carmen**. Open the interactive login only after the button is pressed. |
| Network/provider failure or quota cooldown | Keep saved grades, show Retry or the cooldown; do not prompt for a new login or spend browser quota repeatedly. |
| Same-account reconnect and complete new snapshot | Close the login view, resume normal reads and atomically reconcile the snapshot. |
| Different account or PWA lock | Keep account isolation: require explicit disconnect/account change or app unlock; do not show another account's data. |

Keep configured connection/account state distinct from provider-session validity. In the current app, reporting `connected: false` can cause local state clearing; Carmen expiry must **not** be mapped to disconnected. A verified session failure should yield a separate reconnect-required state without deleting the configured account or last snapshot. Persist renewed credentials only after same-account verification. Coalesce renewal in the Worker across devices, with bounded attempts and cooldowns, rather than trusting per-tab locks alone.

The PWA learns expiry on its next real request or a confirmed Worker result; there is no reliable timer that senses server revocation while the PWA is closed/offline. Do not poll merely to predict expiry or keep a session alive. A documented timeout can inform testing but must not trigger a forced login when the session still works.
