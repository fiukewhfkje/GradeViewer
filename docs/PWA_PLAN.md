# GradeViewer PWA plan — October 16, 2026

Status: resumed and implemented as release candidate 0.1.0. The application, security/persistence layer, installation assets, signed release/update machinery and synthetic suites now exist. Live OAuth identity and a full snapshot succeeded. See [PWA_VALIDATION.md](PWA_VALIDATION.md) for current evidence and the external Cloudflare/public-release/physical-phone gates. The investigation below preserves the original design rationale; its old network/checkpoint observations are historical.

## Goal and scope

Build a TypeScript PWA matching the current GradeViewer app's screens, grade behavior and interactions. Installation should use an ordinary website and Add to Home Screen, eliminating development provisioning and weekly re-signing. Each user deploys into their own Cloudflare account, with no maintainer-hosted API, shared credentials or shared compute quota.

Setup and updates are primary acceptance criteria alongside grade correctness. The user should not need a Mac, Xcode, a terminal, Git commands, a purchased domain or a manually created Cloudflare API token. Account creation/verification and school sign-in still require the user. Keep the README short and put troubleshooting/developer material elsewhere.

Follow-up decisions: the user plans to make this repository public once the work is complete. Treat public source as a release prerequisite, not a blocker to developing privately, and do not request another distribution decision now. The implementation should handle persistent credential storage without asking the user to design it.

Cloud development is supported here: Node 24.19.0 and npm 11.9.0 are installed, a local Node assertion/Web Crypto encryption round trip passed, and headless Chromium 154 executed a synthetic DOM/JavaScript check through its local DevTools API. Chromium's dump-dom smoke commands timed out; the API-driven check succeeded. These are runtime checks, not a PWA test suite. Swift/Xcode are unavailable here; native simulator testing requires a Mac, but TypeScript development does not. The current network policy is enforced and excludes api.schoology.com; both credential variable readiness observations are now ready. That does not validate the credentials against Schoology. Provider-free unit/integration/browser tests can run here; live Schoology access requires the network restriction to be resolved, and final iPhone Safari/Home Screen behavior needs actual iPhone validation.


## What was actually verified

| Evidence | Finding | Limit |
| --- | --- | --- |
| Local process environment | SCHOOLOGY_API_KEY and SCHOOLOGY_API_SECRET are both present and nonempty. | Values were not displayed, transmitted or saved. Runtime readiness is unknown; authentication was not tested. |
| Current native source | Networking.swift signs OAuth 1.0 HMAC-SHA1 requests, defaults to empty token/token secret, checks users/me before student reads, and re-signs bounded redirects. | Source review, not new live provider evidence. |
| Current credential setup | Settings.swift accepts key/secret; AppStore.swift verifies a full snapshot before activation, preserves the previous connection on commit failure, and rejects account changes. Keychain.swift uses device-only, when-unlocked storage. | A browser cannot reuse the native Keychain or SwiftData store. |
| Unauthenticated network probes | HEAD and OPTIONS to the API failed with proxy tunnel HTTP 403 before reaching Schoology. | This is an environment access failure, not a Schoology 403, CORS failure or invalid-key result. No credentials or student reads were involved. |
| Official documentation | Schoology supports personal two-legged OAuth; users/me can redirect and requires a new signature. Cloudflare supports full-stack Workers and deployment templates. | Documentation establishes a viable design, not a successful deployment or district compatibility. |

Relevant implementation references: [OAuth and transport](../Sources/GradeCore/Networking.swift), [connection settings](../GradeViewer/Settings.swift), [activation and refresh](../GradeViewer/AppStore.swift), [secure native storage](../GradeViewer/Keychain.swift), and [current behavior](../ARCHITECTURE.md).

## Browser feasibility and authentication

The PWA is feasible with a small backend in each user's Cloudflare account. A browser-only transplant of the existing network transport is not a viable baseline.

- A cross-origin request with an Authorization header triggers CORS preflight. Schoology would need to allow the PWA origin, GET and that header, and supply appropriate CORS headers on actual responses, including errors. Reading Retry-After also needs response-header exposure. Adding CORS headers to the PWA itself cannot grant permission on Schoology's origin.
- Actual Schoology CORS behavior was not measured. Do not claim it allows or denies browser requests based on this environment's proxy failure. A future permitted header-only preflight can establish the unauthenticated configuration; real browser behavior still needs validation.
- Schoology documents redirects from users/me and requires freshly signed redirected requests. Browser Fetch with manual redirects exposes an opaque-redirect response, without a readable Location header. Automatic following does not let application code regenerate the OAuth signature for each target. This is an independent obstacle even if CORS permits a request.
- Installing the PWA, using a service worker or choosing no-cors does not remove browser restrictions. An opaque response cannot supply usable grade JSON. Do not depend on extensions or third-party CORS proxies.
- Keep the existing personal two-legged OAuth flow: user key/secret, empty oauth_token, HMAC-SHA1, a fresh nonce/timestamp and signatures over the actual URL/query. No Schoology password or copied SSO cookie is required.
- School API permission remains necessary. Schoology's current security notice limits personal keys to the owner's data; another person's or the maintainer's keys cannot substitute. Its 90-day access-token notice matters if three-legged OAuth is added; do not assume that a personal consumer key expires on that schedule.

Sources: [Schoology authentication](https://developers.schoology.com/api-documentation/authentication/), [Schoology authentication update](https://developers.schoology.com/api-documentation/important-api-authentication-update/), [Fetch response filtering](https://fetch.spec.whatwg.org/#concept-filtered-response-opaque-redirect), and [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

## Proposed architecture

One Cloudflare Worker deployment serves both the PWA's static assets and its /api routes on one HTTPS origin. The PWA calls only its own API. The Worker makes server-side Schoology requests, where browser CORS enforcement does not apply, and follows allowed redirects with fresh signatures.

- Client: TypeScript, React and Vite, with a small dependency set; IndexedDB for courses, observations, scenarios and metadata; a manifest and service worker for installation and app-shell updates. Domain parsing, reconciliation, calculations and graph preparation stay in a framework-independent TypeScript core.
- Worker: TypeScript, fixed Schoology route/query allowlists and GET-only upstream transport. Derive the student identity from the authenticated connection rather than accepting an arbitrary user ID. Restrict metadata to verified enrollments. Validate every redirect and pagination URL against HTTPS, the exact API host/path and bounded traversal rules. Never expose an arbitrary URL forwarding endpoint.
- Storage: a SQLite-backed Durable Object for minimal owner/session, encrypted credential and cooldown state. Do not store grade snapshots/history/scenarios in a hosted database. Parse provider data and retain metadata on the client where practical. Schoology payloads pass through the user's Worker, so Cloudflare and the deployment owner are part of the trust boundary.
- Preserve the native sequence: owner verification, fresh enrollments/complete grades, bounded required metadata reads, then optional scale/title recovery. Coalesce refreshes, retain failure state and server cooldowns, and prevent multiple tabs/devices from multiplying requests unnecessarily.
- Keep responses small and work bounded. Split a cold refresh into bounded API calls rather than putting every page/folder read into one Worker invocation. Avoid large server-side grade parsing or SSR on the Free plan.
- No frontend secret environment variables, VITE-prefixed credentials, embedded default keys, public shared proxy or fallback to the maintainer's infrastructure.

Cloudflare currently documents a Free-plan allowance of 100,000 Worker requests/day, 10 ms CPU/request and 50 external subrequests/invocation; redirects count. Network waiting is separate from CPU. SQLite Durable Objects are available on Free. These are implementation budgets to validate, not a promise of unlimited or cost-free usage for every account. Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [static assets](https://developers.cloudflare.com/workers/static-assets/), and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Secure Settings entry and owner setup

Protect the deployment before it accepts or returns credentials. A hard-to-guess URL and a first-visitor-claims-owner screen are insufficient authentication.

The baseline setup proposal is one private app unlock secret chosen during Cloudflare deployment and saved as a Worker secret, followed by a persistent session in the installed app. Explain this field in plain language and support a password-manager-generated value. It is distinct from the Schoology API secret. The deployment spike must prove this prompt works without a dashboard-editing tutorial or token creation. Do not ship a common/default unlock secret. A simpler authenticated provisioning method can replace this proposal if it proves equally safe in the spike.

1. On first use, verify the deployment's unlock secret over HTTPS and issue a random, revocable, expiring session in a Secure, HttpOnly, SameSite=Strict, host-only cookie. Keep only hashed opaque session identifiers in server storage. Apply origin/CSRF checks and bounded login attempts; persist sessions to avoid routine repeat setup.
2. Settings shows Get my Schoology keys, two paste fields, and Connect. Link to the official credentials page in a separate tab, preserve progress while the user signs in, explain the two fields briefly, trim surrounding whitespace, and mask the secret. Do not read the Schoology page, clipboard or school login automatically.
3. Send the entered credentials in an HTTPS request body after owner authentication. Clear fields after use. Never put secrets in URLs, client persistence, service-worker caches, logs, analytics or error reports; never return the saved secret through an API.
4. Store credentials using authenticated encryption, with the wrapping/encryption root held in Worker secret material separately from the stored ciphertext. A concrete option is a random data-encryption key wrapped by a domain-separated key derived from the high-entropy deployment secret. Generate nonces/keys in code; do not make users generate encryption keys in a terminal. Test secret rotation/recovery and preserve existing secrets across redeploys.
5. Verify users/me and the full first snapshot before activating a connection. Keep pending attempts isolated and preserve the prior working credentials/snapshot on any failure. Require an explicit disconnect before changing students.
6. Connected settings shows status, Update connection and Disconnect, matching the native flow. Disconnect revokes relevant sessions/credentials and clears the local account's grades/history/scenarios; server logout must not leave another open tab showing cleared-account data.

Persist the encrypted vault in Durable Object storage and the browser session in a persistent cookie, independently of Worker process memory. A normal reload, process restart or redeploy must retain the connection. Browser data clearing/session expiry can require unlocking again; Schoology revocation requires updated Schoology credentials. Never describe cookies as permanent or emulate native Keychain with plaintext localStorage. Include restart/redeploy/session-expiry regression coverage before calling persistence complete.

Use a strict Content Security Policy, same-origin connections, escaped provider text, no third-party runtime scripts, private/no-store API responses and static-assets-only service-worker caching. Disable request-body/header and raw-response logging. HttpOnly prevents direct JavaScript cookie reads; XSS can still abuse an active session, so it does not replace those controls. Server-side signing necessarily decrypts credentials inside the user's Worker; this is not end-to-end encryption from Cloudflare.

Personal keys may have permissions beyond reading grades. The Worker must expose no Schoology write method, even when local settings/scenario APIs use POST or DELETE. No Cloudflare account-management token belongs in the PWA; Settings updates the application vault, not Cloudflare's management API.

Sources: [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [Schoology key management](https://uc.powerschool-docs.com/en/schoology/latest/api-key-management).

## Native parity checklist

| Area | Required PWA behavior |
| --- | --- |
| Navigation and appearance | Current Grades/Profile layout, course sheet, assignments/categories and final calculator; small-phone density, light/dark/system themes, accessible menus and forms. Match the current app, not removed historical screens. |
| Course grades | One card per physical section; authoritative interpretable reported totals; the same associated semester summary on home/detail; existing fallback rules and precision. |
| Assignments and periods | Typed/wrapper identities, no name-based deduplication, Q1/Q2 separation, named ungraded rows, stable ordering, inclusive local calendar days and read-only exam footer. |
| Local scenarios | Shared decimal/signed/extra-credit editing, drop/undrop/reset, direct Add Grade popup, reversible local removal/restore, and the existing semester-delta guards. No provider writes. |
| Graphs and estimates | Current progression math, real dates and discrete grade/date tooltips; separate observations/reconstruction, preserved small real changes and conservative asterisked quarter estimates. |
| Refresh | Launch, real foreground return, pull/Retry and active-only minute checks; one in-flight refresh, bounded retries, shared Retry-After deadlines and optional metadata recovery. |
| Freshness and failure | Preserve the current fresh-data gate and reachable Profile/Retry. Retain saved data internally on failure. An offline app shell must not silently label cached grades as fresh or replace them with an empty snapshot. |
| Persistence | Atomic/versioned IndexedDB writes, stable identities and unchanged observations/scenarios across refresh/update. Handle failed writes, browser data clearing and account disconnect explicitly. |
| Installation and updates | Standalone display, correct icon/safe areas, deep-link reloads, controlled service-worker updates and retained local state. No Apple development signing. |

Use current GradeCore and its synthetic regressions as the reference. The recorded 118 core/26 hosted tests are previous native evidence, not tests run in this investigation. Generate deterministic synthetic reference outputs for the TypeScript port rather than simplifying the rules or importing protected captures.

Functional and visual parity are feasible targets; identical OS facilities are not. A PWA cannot use the native app's Keychain, read its SwiftData sandbox, guarantee indefinite storage, or run an unrestricted background timer. The current app already avoids background polling. Automatic transfer of native credentials/local observations/scenarios is unavailable; fresh Schoology reads can recover provider-accessible data, not overwritten historical grades. Plan a separate explicit, credential-free export/import if preservation of native-only history/scenarios is required.

Request persistent browser storage where supported and handle refusal/eviction. If local backup/export is added to protect observations, make it an explicit encrypted download with no credential payload or automatic cloud upload. Test both Safari and the installed Home Screen app; do not assume they always share session state. Sources: [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) and [Apple Home Screen installation](https://support.apple.com/en-euro/guide/iphone/iph42ab2f3a7/ios).

## Setup experience and distribution

Target user journey:

1. Open GitHub and click Set up GradeViewer. A short sentence explains that Cloudflare hosts their private copy and provides a Free plan.
2. Create/verify their own Cloudflare account, connect GitHub, and accept the prefilled deployment. Choose the private app unlock secret when prompted. Generate resource names, storage bindings, schema setup and build commands automatically.
3. Open their app, unlock it once, and use Settings to get/paste their own Schoology key and secret. If the school disables API access, provide a clear explanation and short administrator-help text rather than a broken retry loop.
4. Use the app in the browser or follow a short illustrated Add to Home Screen guide. Keep the app's URL stable across updates.

The official Deploy button can create a user's repository/project/resources; it requires public source and only supports Workers applications. A subdirectory must be self-contained. This repo is currently documented as private, so distribution needs either a reviewed public PWA template/repository or an explicit visibility decision. Do not publish the existing repository or history as part of this investigation. Source: [Cloudflare deployment buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/).

Keep the web application isolated in a self-contained directory with its own package/lockfile, Worker configuration, build/deploy commands and synthetic fixtures. Do not depend on files above the template root or require building Swift. Test an entirely new account and a newly generated repository; a maintainer's configured environment is not onboarding evidence.

## Releases and updates

A GitHub Release does not itself update someone else's copied repository or Cloudflare deployment. A service-worker update only delivers the code already deployed to that user's URL. Resolve both layers before calling setup finished.

- Publish tested, versioned releases with release notes, source and deployable artifacts, checksums/authenticity verification and declared schema compatibility. Never include local configuration, credentials, captures or grade databases.
- Prove a no-terminal update action against a new user's generated repository. A candidate is a small deployment launcher that resolves a verified stable release on explicit redeploy, records the exact version and retains the existing URL/secrets/bindings. Validate Cloudflare Builds permissions and artifact verification before choosing it; do not assume template clones have GitHub's Sync fork feature.
- If that candidate fails, prove the simplest GitHub/Cloudflare supported update workflow and document its actual clicks. Do not fall back to asking users for broad API tokens or a terminal without revisiting the setup design.
- Activate a new service worker at a safe boundary after local edits are saved. Keep prior assets available during transition and version API contracts and IndexedDB migrations so mixed versions cannot corrupt state.
- Test a second release, failed deployment, rollback, revoked connection and interrupted migration. A fresh successful deployment alone does not meet the release criterion.

## Implementation sequence after authorization

1. Prove deployment, protected setup and updates first using synthetic data only. Verify automatic resource creation, secure session/vault lifecycle, Free-plan budgets and a release-to-existing-installation upgrade/rollback. Stop broad implementation if these cannot meet the setup goal.
2. Port the framework-independent GradeCore behavior to TypeScript with synthetic reference tests for parsing, identity, periods, calculations, scenarios, precision and graph events.
3. Reproduce the native UI and interactions with synthetic fixtures, including missing data, empty/error states, long names/lists and both themes. Add atomic IndexedDB persistence and the current freshness gate.
4. Implement the fixed-route Worker Schoology transport, mock provider responses, freshly signed redirects, owner binding, pagination, bounded concurrency, metadata rules, cooldowns and failure-safe connection activation. Provider networking stays disabled by default in development and CI.
5. Complete manifest/service-worker installation, touch/layout/accessibility validation, multi-tab/account clearing and storage/update recovery on supported browsers and an installed iPhone PWA. Use CLI/API-based verification and synthetic captures; no connected-user browser or desktop GUI automation.
6. Separately arrange a narrowly scoped live compatibility check when network access and consent for actual account reads exist. Avoid logging/saving raw responses. Verify the user's account and an independent district where possible; never claim universal Schoology coverage.
7. Ship only after the fresh-account setup and second-release update gates pass. Replace the README's main setup path with the short tested PWA steps, retaining native/developer instructions separately. Publish no secrets or personal records.

## Remaining gates and blockers

| Gate | Current status | Effect |
| --- | --- | --- |
| Browser-only native transport | Cannot preserve documented redirect handling and secure server-held secrets. | Use the per-user same-origin Worker design. |
| Live network/CORS validation | Proxy rejects the Schoology tunnel; actual CORS and credential validity are untested. | Blocks a live proof in this environment, not synthetic work or the proposed architecture. |
| School API access | A normal school login does not guarantee permission to generate/use personal keys. | Schools that deny access remain blocked; the app cannot remove that requirement. |
| Public template | Repo docs say private; public-template route has not been published or tested. | Must resolve source distribution before the promised Deploy-button onboarding. |
| Secure provisioning and updates | Design proposed; no new-account deployment, secret provisioning or existing-install update has run. | Must prove early rather than claim one-click setup or automatic upstream updates. |
| Native storage/OS equivalence | Browser storage and app sandboxes differ from Keychain/SwiftData. | Match observable app behavior; disclose data transfer/storage limits and test recovery. |
| Provider omissions | The native research already records inaccessible metadata, missing scores and unavailable past revisions. | Preserve those limits; a PWA cannot recover data Schoology does not expose. |

Conclusion: proceed with this architecture when development is requested, beginning with the deployment/security/update proof. There is no established architectural blocker to the PWA plus per-user Worker, but full functionality and frictionless onboarding have not yet been demonstrated.
