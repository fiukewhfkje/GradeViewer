# Optional Carmen session test — November 1, 2026

This is a local diagnostic, not a GradeViewer connection feature. It does not change the Schoology app, Worker, vault or deployment. No live Carmen session has been tested. A successful local result would not establish Cloudflare portability, automatic renewal or general OSU integration approval.

## Required product experience — owner clarification

The owner requires **no institutional app approval, seamless independent phone/desktop PWA access, and low maintenance**. Approved OAuth is therefore excluded from the current proposed solution. OSU's [August 11 notice](https://it.osu.edu/news/2026/08/11/carmencanvas-personal-access-tokens) confirms students still cannot generate personal tokens; the instructor exception does not provide student access. Manual cookie renewal and a running desktop companion also fail the intended product experience.

The current candidate is an **on-demand cloud browser in the user's own Cloudflare account**: normal interactive OSU sign-in, encrypted session state in the personal Worker, ordinary read-only HTTP grade refreshes when its cookie session works, and browser launch only for sign-in/renewal. Either PWA would use that same connection with the other device off. Existing browser-local history/what-if behavior remains; no cloud grade-history service is requested. See [cloud-browser findings, actual platform proof and quota analysis](CARMEN_BROWSER_RESEARCH.md).

The remote-browser primitives and public OSU login reachability have now been tested. **Actual student sign-in, Worker cookie portability, renewal frequency, ten-minute free-budget sufficiency and physical-phone acceptance have not.** No implementation should promise low maintenance before these tests. This alternative uses browser-session cookies internally, but avoids routine user cookie copying; it does not create access without normal account authorization. Production remains Schoology-only and no account has been accessed.

The private-file test below remains an optional narrow diagnostic. It cannot establish automatic renewal or the required phone/desktop workflow. It does not export identity-provider cookies; a future cloud-browser proof needs a separate, explicit account-holder permission scope before retaining any SSO state.

## Short instructions for the account holder

1. Agree explicitly to the test: **read your own Canvas identity and, only if you also agree, enrolled-course grade totals; no account changes and no names/grades/cookies printed or saved in results.** You can run the probe yourself and share only its result, or authorize the local Codex operator to run it for you.
2. On a computer in Chrome/Edge, sign into [CarmenCanvas](https://osu.instructure.com/) normally, including BuckeyePass if prompted.
3. Open Developer Tools → **Network**. In that same tab, open `https://osu.instructure.com/api/v1/users/self/profile`. Select the `profile` request, then **Headers → Request Headers → Cookie**. Copy only its value. This request uses Canvas's [self-profile endpoint](https://developerdocs.instructure.com/services/canvas/resources/users).
4. Put that single value in a private plain-text file **outside the repository** on the computer running the probe. Use owner-only permissions (`chmod 600 /absolute/path/to/carmen-cookie.txt` on macOS/Linux). Do not paste it into this chat, send a HAR/cURL dump, or export cookies from OSU's identity-provider login pages. If sharing the session with the consenting operator, use a private channel rather than a public/chat transcript; testing locally yourself avoids transferring it.
5. Give Codex only the file path and confirm the account holder's permitted scope. After the test, delete the local cookie file. The student can log out of Carmen to end that browser session; whether OSU invalidates all exported copies immediately still needs verification.

No terminal command should contain the cookie value. Do not send a screenshot of the cookie or profile response. If the request has no Cookie header, stop and report that fact without exporting other credentials.

## Run the probe

The probe uses Node.js 24 or later and no third-party libraries. From `web/`:

```sh
# Identity only; --consent means the account holder explicitly permitted this test.
node scripts/verify-carmen-session.mjs /absolute/path/to/carmen-cookie.txt --consent

# Optional second read, only when grade-total access was also permitted.
node scripts/verify-carmen-session.mjs /absolute/path/to/carmen-cookie.txt --consent --grades
```

It makes at most two fixed-host HTTPS GET requests, does not follow redirects or retry, bounds each request to 15 seconds and each response to 2 MB, and never saves a response. File loading rejects project-local, symlink, oversized, non-owner or group/world-readable files. Its output contains only fixed error labels, booleans and HTTP status, never cookie values, identities, course names, grade values, response bodies, redirect destinations or exception messages.

`authenticated: true` means a schema-valid self-profile response was accepted now. `courseTotalsChecked` means the optional first page parsed; `visibleTotalsPresent` means that page supplied at least one visible current total. An empty list or missing totals is not a failed login. `courseListHasMorePages` explicitly marks partial discovery; this diagnostic is not a complete snapshot and does not request assignments or another student's records. [Canvas course fields](https://developerdocs.instructure.com/services/canvas/resources/courses).

`cookieRotationOffered` reports only whether a response offered cookies. The probe does not import/persist them or implement a cookie jar; it deliberately does not claim renewal. A second read can therefore expose a session-rotation issue that a future transport would need to handle. It does not produce an exact expiry prediction. A 401, 403, redirect, HTML response and network failure receive different labels rather than all being called expiry. No result should be interpreted as a reason to discard saved application grades.

## Lifetime evidence

- OSU OTDI's [August 18, 2025 announcement](https://it.osu.edu/news/2025/08/18/technology-updates-autumn-2025) documents **two-hour inactivity logout** for CarmenCanvas, with active Carmen use retaining the session. It does not say whether this particular API probe resets activity or how an exported session behaves from Cloudflare. Rechecking continuously would interfere with an idle-lifetime measurement.
- [BuckeyePass](https://it.osu.edu/security/services/buckeyepass) separately describes the Trust Browser option suppressing another passcode for **24 hours** and says BuckeyePass does not change application session timeout. This is not a 24-hour or 30-day Carmen-cookie guarantee, nor a promise of unattended sign-in.
- A Cookie request header has no expiry attributes. Browser cookie storage/Set-Cookie may advertise a client expiry, but server revocation, idle logout and SSO challenges remain separate. The historical Campus record proves short-term renewal, not a measured 30-day TTL.

For a later idle test, perform one successful baseline, close Carmen and make no Carmen/probe requests during the agreed interval, then check once after more than two hours. The student should use a time when this does not interrupt their work. That establishes one observed outcome, not a universal expiry period. Do not schedule background polling or make a lifetime claim from a cookie's timestamp alone.

## Reconnect behavior and earlier alternatives

The product goal is **Reconnect to Carmen → normal OSU sign-in → resume saved grades**, with no routine cookie copying. This flow is specified here, not implemented or verified.

| Route | Intended experience | Prerequisite / limit |
| --- | --- | --- |
| Approved OAuth — excluded by current requirement | Connect once; refresh access tokens automatically until revoked/re-authentication is required. On failure, retain saved grades and offer Reconnect. | Institution-issued key and accepted per-user callback/client ownership. [Canvas documents refresh tokens](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth); OSU approval remains open. |
| Browser companion — does not establish independent phone access | Install once; explicitly pair with the user's GradeViewer origin. Read permitted data in the signed-in Carmen browser context. Reconnect opens normal OSU login and resumes on identity verification, without copying cookies to Cloudflare. | Companion implementation, scoped permissions, origin/account binding, policy and phone support all need validation. Browser APIs can mediate this access; a PWA alone cannot read Carmen's protected cross-origin session. |
| Manual cookie import — diagnostic only | Re-export a fresh session when rejected, then verify it before replacing the working connection. | Suitable for the optional proof; likely inconvenient after idle logout. No automatic login/renewal is provided by a copied header. |

For an eventual connection, use these states: connected → refresh in progress → either connected, temporary failure with Retry, or verified sign-in requirement with Reconnect. A course-specific 403, network problem or rate limit must not erase the session or open repeated login prompts. During reconnect, retain prior grades/history/local scenarios and open forms; verify the same account plus a complete new snapshot before activation. Require disconnect for an account switch. Stop at any genuine MFA challenge and let the student complete normal sign-in.

OSU documents [QR login for the official Canvas Student app](https://teaching.resources.osu.edu/toolsets/carmencanvas/faqs). That does not establish a general GradeViewer authorization mechanism; do not reuse the official app's private credentials/tokens. Cloudflare's cloud-browser approach now has a separate [evidence and acceptance record](CARMEN_BROWSER_RESEARCH.md). Its low-maintenance behavior remains unverified; no real Carmen connection is shipped.
