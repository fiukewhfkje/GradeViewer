# Carmen cloud-browser investigation — November 1, 2026

The owner requires **no institutional app approval, independent phone/desktop PWA access, and low maintenance**. Approved OAuth fails the first requirement; manual cookie copying and an always-on desktop companion fail the intended experience. The current experiment is an on-demand browser in each owner's Cloudflare account. This is a candidate, not a working Carmen connection or a proven maintenance guarantee. Production remains Schoology-only.

## Candidate flow

1. From the authenticated personal PWA, Connect opens a short-lived interactive cloud-browser view. The student completes normal OSU sign-in/BuckeyePass directly; no personal Canvas token, registered OAuth client, extension or running laptop is needed for this proposed flow. Cloudflare documents browser-based [Live View](https://developers.cloudflare.com/browser-run/features/live-view/) and [human login handoff](https://developers.cloudflare.com/browser-run/features/human-in-the-loop/).
2. The Worker verifies the Canvas account, encrypts the necessary session state with the existing vault machinery, and closes the browser. Both devices use the same personal Worker connection. Grades/history/scenarios continue following existing browser-local behavior.
3. Normal grade refreshes should use fixed-host, read-only Worker HTTP requests with the Carmen cookie jar, including response-cookie rotation. **These requests do not run Browser Run.** Cookie portability from remote Chrome to Worker fetch is an unverified requirement, not established by browser-state restoration.
4. Only when ordinary reads establish that sign-in is required, restore a short-lived browser and attempt the normal SSO flow. If OSU accepts the restored SSO state, capture the new Carmen session and close it. If it presents MFA, offer Reconnect with the interactive view. Never store the OSU password or automate MFA/challenge bypass. Do not use background keepalive requests merely to defeat idle logout.

The owner's selected behavior is to attempt that silent renewal automatically during an active refresh while authenticated, account-matched cached grades remain usable. A manual Reconnect click is needed only for verified human sign-in, not for the initial silent attempt. Slow renewal/retrieval must not block the cached view. Keep renewal attempts coalesced and bounded across devices; failures/cooldowns retain data rather than reopening browsers repeatedly. This is an implementation contract, not a shipped Carmen feature. GPA/Carmen changes remain on the GitHub development branch under the release hold, without main merges, release tags/publications or production deployment.

Cloudflare's [Worker browser binding](https://developers.cloudflare.com/browser-run/reference/browser-binding-api/) supplies browser access without asking the student for an OSU API token or requiring a separate Cloudflare API token in the product UI. The diagnostic uses the operator's existing Wrangler deployment login. Browser state is broader access than a scoped OAuth token: retain only confirmed necessary origins, encrypt it, and keep it out of PWA storage, logs and responses. Do not silently add OSU-wide SSO storage to the current Schoology vault. A real-account proof requires the account holder's explicit permission.

Implementation should use an official Cloudflare browser SDK/binding and existing crypto rather than a new CDP/auth framework. Existing `playwright-core` suffices for the isolated CLI proof; no dependency or production binding has been added. Session recording stays off. Live View URLs carry bearer access and must only be delivered through authenticated, uncached responses; never log or commit them. Verify the account after handoff rather than trusting a Done button. Production work must preserve the existing URL, password, vault, app sessions and signed updater.

## Is ten minutes enough?

The [current Browser Run limits](https://developers.cloudflare.com/browser-run/limits/) are **10 browser minutes per account per day**, three concurrent browsers and one new browser per 20 seconds on Workers Free. The time is shared with other Browser Run use in that Cloudflare account. It counts startup, navigation, human sign-in and idle time until explicit closure; it is not time spent viewing GradeViewer. Exhausting the daily budget returns 429 for new browser work until the next UTC day. Short-term throttling also returns 429 and can supply Retry-After.

For illustration, with no other browser usage:

| Browser time per login/renewal | Maximum within 600 seconds |
| --- | --- |
| 30 seconds | 20 |
| 60 seconds | 10 |
| 120 seconds | 5 |

These are arithmetic examples, **not measured OSU performance**. Ordinary Worker refreshes would consume zero browser seconds only after cookie portability is proven. If a new browser is needed for every grade refresh, frequent checking could exhaust the allowance; this would not yet meet the desired free, low-maintenance experience. The experiment is justified by avoiding app registration and desktop dependence, not by an established claim that the quota is sufficient.

Canvas has a separate [dynamic, request-cost-based throttle](https://developerdocs.instructure.com/services/canvas/basics/file.throttling), rather than a documented fixed number of refresh clicks per day. Inspect its cost/remaining headers where present, bound read concurrency, and honor 429/cooldown rather than spinning up another browser. Proposed Worker coordination should combine simultaneous phone/desktop requests into one renewal, prevent refresh spam from launching browsers, and reuse current metadata. Retain saved grades on quota/provider failures; a quota error must not be classified as an expired session. Worker request/CPU/subrequest quotas also remain separate from browser time; [Workers Free documents 100,000 requests/day](https://developers.cloudflare.com/workers/platform/limits/), not 100,000 full grade snapshots.

## Actual evidence

On November 1, an isolated Browser Run experiment using the existing authenticated Cloudflare account:

- Created a real remote Chrome, generated a page-mode Live View URL and received HTTP 200 for its hosted UI. No person used that view and no mobile interaction was verified.
- Set **synthetic** HttpOnly cookies/local storage, encrypted their exported state using `web/worker/crypto.ts`, explicitly terminated the remote session, and restored/decrypted the state in a different remote Chrome. The restored cookie remained HttpOnly and the synthetic local storage matched. This proves platform primitives, not OSU authentication persistence or a full persistent Chrome profile.
- Separately navigated an unauthenticated remote Chrome to `https://osu.instructure.com/`, which reached `webauth.service.ohio-state.edu` with HTTP 200. No credentials were entered, form submitted, account accessed or student API requested. Public login reachability does not prove that OSU accepts cloud sign-in, remembered-device state or Worker requests.
- Closed the test browsers; no production Worker/configuration, vault, password, deployment or release was changed. Results contain only status/booleans. Signed URLs, Cloudflare credentials and browser state are not committed.

The reproducible diagnostic is `web/scripts/verify-carmen-browser.mjs`. It requires Node 24+, existing web dependencies and an authenticated Wrangler login with Browser Run access. **It consumes real browser quota** and operates only on sessions it creates. From `web/`:

```sh
# Two remote browsers, synthetic state only; no OSU requests.
node scripts/verify-carmen-browser.mjs --synthetic

# One remote browser; unauthenticated public sign-in navigation only.
node scripts/verify-carmen-browser.mjs --public-login
```

Neither command signs into an account or tests actual cookies, API access or renewal. No flag prints a Live View link or deployment token. Wrangler output is captured into a private temporary directory and removed; only sanitized results reach stdout. An explicit mode is required before retrieving credentials or creating resources. This is an operator diagnostic, not a phone onboarding feature.

## Renewal mechanics, timing and saved-grades behavior

[The session benchmark protocol](CARMEN_SESSION_BENCHMARK.md) separates existing-cookie lifetime, silent SSO renewal and human password/MFA intervention. Three public-only timing samples took 2.458–3.304 seconds through initial OSU sign-in navigation, including CLI setup; they do not measure authenticated renewal. The proposed production renewal is deterministic headless browser code triggered by the Worker, with interactive handoff only when normal OSU sign-in requires it. The PWA should retain saved grades throughout and report a separate reconnect-required state, not disconnect the account or erase the snapshot. Neither that Carmen UI nor authenticated renewal is implemented.

## Direct sign-in experiment

An [operator-only friend-login lab](CARMEN_FRIEND_TEST.md) now provides the missing private human handoff and encrypted test-state capture/check path. Synthetic/headless validation and public-only handoff/cleanup pass; no person has signed in through it yet. Ordinary checks use a managed HTTP jar in Node, not a deployed Worker, so a successful result would still leave Worker portability and the actual PWA unverified. The lab is not a production provider feature or a stable release.

## Gate before choosing this for the product

With a consenting student, prove normal human sign-in through Live View; same-account read-only totals/assignment access; Carmen-only cookie use and rotation in an **isolated Worker**; automatic SSO renewal after more than two idle hours; overnight/later-day restoration; physical-phone interaction with desktop off; complete snapshot/failure retention; and actual cumulative browser seconds per renewal. OSU documents [two-hour Carmen inactivity logout](https://it.osu.edu/news/2025/08/18/technology-updates-autumn-2025) and [separate 24-hour BuckeyePass browser trust](https://it.osu.edu/security/services/buckeyepass). Neither promises unattended renewal or a particular reauthentication frequency.

Record timing/status only, not private grades or cookies. A brief browser launch on occasional renewal could fit free usage well. Repeated human MFA or browser-per-refresh requirements could fail the owner's constraints. Until measured, this is the strongest current candidate to test under those constraints, not a verified best solution. Technical own-session access also does not establish approval for distributing a multi-user integration; Canvas documents OAuth for such applications. Do not describe this experiment as institutionally approved.
