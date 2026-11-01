# Optional Carmen session test — November 1, 2026

This is a local diagnostic, not a GradeViewer connection feature. It does not change the Schoology app, Worker, vault or deployment. No live Carmen session has been tested. A successful local result would not establish Cloudflare portability, automatic renewal or general OSU integration approval.

## Required product experience — owner clarification

The owner requires seamless, low-maintenance operation in the PWA on both phone and desktop, following existing GradeViewer behavior. Each device must work independently of a running desktop browser. Routine cookie exports/imports and a desktop-only companion do **not** meet that requirement. The cookie probe below remains optional diagnostic evidence, not the selected product connection method.

Use the existing personal Worker and address as the shared connection point. With institution-approved Canvas OAuth, the owner connects Carmen normally once; the Worker encrypts the account's access/refresh credentials and renews access tokens as needed. Either authenticated PWA reads fresh provider grades through that same connection, even when the other device is off. Preserve normal browser-local history saving and local what-if behavior; no new cloud grade-history or scenario synchronization service is requested. Ordinary revocation/MFA/account reauthorization can still require a normal Reconnect action, rather than promising permanent authorization.

This is the simplest documented design that fits the required experience, **conditional on OSU API approval**. The reviewed [Canvas OAuth flow](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth) requires an institution-issued client ID/secret and documents automatic refresh without repeated authorization. [OSU routes integrations through OTDI](https://teaching.resources.osu.edu/toolsets/carmencanvas/guides/carmen-integrations); no self-service student app-registration route was found. Confirm the read-only REST scopes, registered callback and client ownership with `carmen@osu.edu`. For one personal deployment, an approved key can stay in that owner's Worker. Public template distribution cannot copy a common confidential secret into every owner's Worker; its approval/client arrangement must be resolved separately. No request has been sent and no approved key is available.

Acceptance for eventual implementation: connect with normal OSU sign-in; open the same GradeViewer address on a second device without transferring provider secrets; let an access token expire and verify one coalesced Worker refresh; confirm phone refresh with the desktop off; retain local history/scenarios and saved grades through refresh failures and reauthorization; distinguish invalid authorization from course-specific permission/network failures. Required provider traffic remains account-bound and read-only, apart from fixed OAuth credential-exchange endpoints. Do not change the established Schoology vault/password/session/update boundary or expand into a general provider framework merely to prepare for approval.

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

## Proposed easy reconnect path and evaluated alternatives

The product goal is **Reconnect to Carmen → normal OSU sign-in → resume saved grades**, with no routine cookie copying. This flow is specified here, not implemented or verified.

| Route | Intended experience | Prerequisite / limit |
| --- | --- | --- |
| Approved OAuth | Connect once; refresh access tokens automatically until revoked/re-authentication is required. On failure, retain saved grades and offer Reconnect. | Institution-issued key and accepted per-user callback/client ownership. [Canvas documents refresh tokens](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth); OSU approval remains open. |
| Browser companion | Install once; explicitly pair with the user's GradeViewer origin. Read permitted data in the signed-in Carmen browser context. Reconnect opens normal OSU login and resumes on identity verification, without copying cookies to Cloudflare. | Companion implementation, scoped permissions, origin/account binding, policy and phone support all need validation. Browser APIs can mediate this access; a PWA alone cannot read Carmen's protected cross-origin session. |
| Manual cookie import | Re-export a fresh session when rejected, then verify it before replacing the working connection. | Suitable for the optional proof; likely inconvenient after idle logout. No automatic login/renewal is provided by a copied header. |

For a companion/OAuth implementation, use these states: connected → refresh in progress → either connected, temporary failure with Retry, or verified sign-in requirement with Reconnect. A course-specific 403, network problem or rate limit must not erase the session or open repeated login prompts. During reconnect, retain prior grades/history/local scenarios and open forms; verify the same account plus a complete new snapshot before activation. Require disconnect for an account switch. Stop at any genuine MFA challenge and let the student complete normal sign-in.

OSU documents [QR login for the official Canvas Student app](https://teaching.resources.osu.edu/toolsets/carmencanvas/faqs). That does not establish a general GradeViewer authorization mechanism; do not reuse the official app's private credentials/tokens. No documented self-service route was found that promises seamless standalone-phone-PWA access without integration approval. A browser companion is a possible desktop experiment, but does not establish the owner's required independent phone experience. The chosen product direction is approved OAuth through the existing personal Worker, with actual access still pending. Schoology-only production behavior remains unchanged.
