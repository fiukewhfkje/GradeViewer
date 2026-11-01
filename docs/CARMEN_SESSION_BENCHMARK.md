# Carmen lifetime, renewal latency and reconnect acceptance

This is the next real-account test protocol, not a completed Carmen integration. The owner wants infrequent manual sign-in, normal phone/desktop PWA operation and saved grades during renewal. No student account/session is available to the operator, so authenticated lifetime and renewal timing cannot currently be measured. Public-login/platform timings are recorded below separately.

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

The [friend-login lab and short consent instructions](CARMEN_FRIEND_TEST.md) now implement the operator handoff, encrypted test-state storage, ordinary Node HTTP checks and bounded browser renewal attempt. They have not been used with a real account. Their Node transport is not the isolated Worker proof required below.

## How to measure the real lifecycle

Use a consenting student's dedicated test session and private encrypted state in an isolated Worker, leaving production untouched. The holder performs normal sign-in themselves and explicitly permits narrow self-identity reads plus retaining only required Carmen/SSO session state for the experiment. Do not send cookies or browser-state files in chat. No grade reads are needed to measure session lifetime; complete grade access remains a separate compatibility gate.

1. **Establish the baseline.** Verify the account with one self-profile GET from ordinary Worker HTTP. Retain its account binding privately, persist valid rotated cookies, and record only status, time and duration. Do not infer Worker cookie portability from a successful browser-context request.
2. **Test real idle periods.** Stop Carmen use, test polling and background requests for an agreed interval. After roughly 90 minutes, 135 minutes and overnight, use independent fresh baselines for each trial and make one self-profile check. Multiple checks on the same evolving session may refresh its activity; they cannot establish its original idle expiry. If the student uses that test session during the interval, mark the trial inconclusive. Leave other school work undisturbed.
3. **Classify before renewal.** A schema-valid same-account identity is success. Authentication rejection or a verified sign-in redirect can trigger renewal. A course-specific 403, network error, 429, malformed response or generic HTML must not be called expiry. No response should clear saved grades. Record failure categories, not redirect URLs or response bodies.
4. **Time one normal renewal.** On confirmed sign-in requirement, restore the last valid state in a new browser and measure launch, state restoration, SSO navigation, same-account verification, capture/encrypted persistence and closure separately. Report successful unattended renewal, human sign-in required, temporary failure or quota cooldown. Do not count an unauthenticated redirect to OSU as success. A human requirement ends the automatic interval; separately measure wait-for-user and subsequent completion.
5. **Repeat after overnight and longer gaps.** If normal SSO renews automatically after Carmen expiry, check whether that remains true after 24–48 hours and later days, with explicit holder permission and no background maintenance traffic. Record manual interventions and cumulative browser runtime over actual daily use. Only observed results can support a claim such as one manual sign-in per week; cookie timestamps alone cannot.
6. **Exercise failure and device behavior.** Phone works with desktop off; two simultaneous refreshes share one renewal; quota/network failures retain the old snapshot; genuine login shows a single Reconnect action; successful same-account reconnect resumes refresh. Physical-phone interaction still needs acceptance.

OSU documents [two-hour Carmen inactivity logout](https://it.osu.edu/news/2025/08/18/technology-updates-autumn-2025). BuckeyePass documents [24-hour browser trust separately from app-session timeout](https://it.osu.edu/security/services/buckeyepass). Neither is evidence that OSU login can be renewed unattended for weeks. The question is how long ordinary SSO remains usable **without a password/MFA intervention**, not simply the longest cookie expiry date.

The existing local cookie-header probe can screen current access and time reads with explicit permission:

```sh
# From web/; owner-only external file, consent rules in CARMEN_SESSION_TEST.md.
node scripts/verify-carmen-session.mjs /absolute/private/carmen-cookie.txt --consent --timing
```

It reports `timingsMs.identity` and `timingsMs.total` without identity/grade values. Optional `--grades` times the separate first-page course-total read. It neither saves rotated cookies nor restores SSO, so a stale exported header alone cannot establish the true renewable session lifetime. Do not run it repeatedly throughout an intended idle interval. No authenticated benchmark is claimed from the synthetic timing regression.

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
