# PWA release candidate 0.1.0 — October 16, 2026

The implementation is on `pwa-migration` ([draft PR #9](https://github.com/fiukewhfkje/GradeViewer/pull/9)), based on native build 9 (`3447420`). Use one final merge to preserve that comparison point. No public release or hosted deployment is established by local tests.

## Implemented behavior

`web/` is a self-contained React/TypeScript/Vite project. Its own Worker serves the UI and same-origin API; every user deploys into their own Cloudflare account. No shared maintainer proxy or grade database exists. Native source remains the behavior reference and is unchanged; the primary README now describes the PWA, with native setup archived in `NATIVE_SETUP.md`.

Grades/Profile navigation, associated semester summaries, dated quarter assignment scopes, read-only exams, categories, recent/all assignments, graph exploration, final calculator, signed decimal edits, extra credit, drop/undrop/reset, Add Grade, local removal/restore and inverse quarter estimates are implemented. Unknown rules/scales stay unavailable. Calculated progression/estimates do not create observed history. Selected regression expectations were ported from the Swift tests; Swift/Xcode were unavailable, so the full Swift suite/differential comparison was not executed here.

The interface supports small phones, desktop browsers, light/dark/system themes and safe areas. Profile permanently shows **Your personal website**, its address, Copy/Open controls and iOS/Android installation help. Browser installation removes weekly Apple development signing. A PWA does not import the native app's Keychain/history/scenarios; browsers/devices keep separate local stores.

## Authentication and persistence

- For a private Git import, the deploy helper accepts APP_PASSWORD as a Cloudflare **build secret** and securely applies it as the Worker runtime secret using stdin before deployment. Users do not need to create a Cloudflare API token or visit a second runtime-secret screen. Ordinary redeploys retain existing runtime secrets.
- Deploy with a private password-manager-generated `APP_PASSWORD` of at least 20 characters. The empty `.dev.vars.example` declares the secret; package.json explains it in Cloudflare's setup prompt. There is no shared default or first-visitor owner claim.
- A random session uses a persistent `__Host-` Secure/HttpOnly/SameSite=Strict cookie, expires after 90 days and can be revoked. Only its hash is stored. Origin checks, password-attempt limits, strict CSP and no-store API responses apply. Sessions survive process restart/redeploy but are not guaranteed permanent browser storage.
- Schoology credentials are accepted only from an authenticated owner. A random AES-GCM data key encrypts them, and a domain-separated key derived from the high-entropy Worker password wraps that key with separate nonces/AAD. Durable Object ciphertext is separate from the root secret. Cloudflare executes the decryption/signing code; this is not encryption from Cloudflare itself.
- `users/me` verifies identity on every scan before student reads. Disconnect is required to change accounts. Credentials remain staged until complete reads parse successfully and the browser prepares its snapshot. The server commits credentials, then IndexedDB atomically activates the prepared state. Reload can finish an interrupted activation. Failed replacements retain the prior connection and snapshot.
- Browser grades/history/scenarios and account-bound metadata use versioned IndexedDB. Persistent storage is requested where supported. Browser storage loss cannot recover local-only history or edits; fresh reads recover provider-accessible data. Changing the app password revokes sessions and requires entering Schoology keys again; ordinary updates preserve it.
- The Worker accepts only fixed, GET-only Schoology routes for the verified owner/enrolled sections. It re-signs bounded safe redirects, validates page paths/query scopes, caps response/request sizes and pagination, and shares provider cooldowns. Required reads precede optional metadata recovery. One invocation handles one page/read, keeping cold refreshes split across requests.
- Unchanged complete metadata can be reused for five minutes using account/section/grade-fingerprint receipts, without sliding expiry. Manual refresh bypasses it. Verified numeric scales can fall back for one hour on the same account/section/scale. Inaccessible titles have a 15-minute local retry deadline; manual refresh can retry while respecting Schoology cooldowns. Browser Web Locks coalesce overlapping tabs where supported; each tab also has one in-flight refresh.
- Launch and real foreground return require fresh data. Routine refresh failures retain the current presentation; saved data stays internal behind a foreground failure gate. Profile/Retry remain reachable. No API, credentials or grade responses enter the service-worker cache; it caches only the app shell and installs updates on an explicit reload.

## Verification run here

Run commands from `web/`:

```sh
npm ci
npm run build
npm test
npm run test:e2e
npx wrangler deploy --dry-run --outdir .local-test/production
npm run release:package
node scripts/verify-template.mjs
```

- Production TypeScript/Vite build passed; Wrangler packaged the production Worker/Durable Object/assets configuration in dry-run mode.
- 91 synthetic tests passed: calculator/parser/reconciliation/period/estimate/progression regressions, cryptography/OAuth/transport, owner/vault/session lifecycle, signed-release integrity/path checks, and cold/warm snapshot integration. Unchanged five-section warm refreshes require three provider reads rather than the cold 23. Metadata expiry does not slide; manual refresh renews it.
- 21 Chromium/local Worker+SQLite integration checks passed: private API, owner unlock/full connection, home/detail consistency, graph, shared decimal edit, drop/reset, Add Grade/removal, period scopes/ungraded rows, categories/final calculator, 320px phone/dark/profile/URL/install help, rejected account replacement, reload/scenarios, interrupted activation recovery, Worker restart, offline freshness gate, shell-only caches, controlled service-worker update, failure retention/Retry/Profile, multiple tabs, new-browser unlock with saved Schoology keys, disconnect, and separate desktop sample mode. Screenshots live under ignored `web/.local-test/e2e/`; all data is synthetic.
- An isolated generated copy passed dependency installation, production build, unit tests and Worker dry-run. The actual updater script accepted a locally signed 0.1.1 release, preserved the personal Worker name/configuration and local secret file, rebuilt successfully, then explicitly rolled back to signed 0.1.0 and rebuilt. These were test versions, not public releases.
- Production dependency audit found zero known vulnerabilities at the time of the run. Source/artifact credential-value scans report only booleans/counts; never expose values.

Live checks are explicit opt-ins and are excluded from normal tests/CI:

```sh
npm run verify:live
npm run verify:live:snapshot
```

The runtime reported unrestricted/enforced networking. An unauthenticated Schoology probe returned the expected 401. Authenticated production OAuth `users/me` succeeded, and the production Worker/client snapshot pipeline completed with 45 course-period records bound to the verified account. Credentials, student records, cookies and responses remained in ephemeral process memory; only counts/booleans were exported. Final cold and warm runs both completed (67 and 22 same-origin API calls in this account; counts include session/staging/cache-control calls, not just upstream reads). This establishes one account's live access, not all districts, CORS, hosted Cloudflare performance or a physical-phone result.

## Releases and automatic updates

Use `0.1.0` / Git tag `v0.1.0` for the first public release. `scripts/package-release.mjs` creates a source archive, SHA-256 file/archive hashes and an Ed25519-signed manifest. It includes only explicit template roots/files, not dependencies, browser stores, local secret files, native captures or the signing private key. Public verification key: `web/scripts/release-public-key.pem`. The generated private key is ignored at `web/.local-test/release-signing.pem`; preserve it securely and configure the maintainer repository's `RELEASE_SIGNING_KEY` Actions secret before using automated release publishing. Never attach it to a PR/release or paste it into chat.

The root PWA workflow runs synthetic checks before tagged release publishing. The copied template's **Update GradeViewer** workflow checks official stable GitHub releases daily or on **Run workflow**. It validates the pinned public-key signature, archive/file hashes, version/schema and safe paths before changing application files. It preserves the personal Worker name/routes/settings and does not overwrite secrets or workflow files. Its push should trigger the user's Cloudflare Git connection. The user can explicitly select an older signed compatible release to roll back. Workflows themselves are retained because copied repositories' default workflow token is not intended to rewrite workflow definitions; workflow changes require a separately reviewed migration.

This mechanism requires public release assets/source, GitHub Actions permission to push, an enabled schedule and an active Cloudflare Builds Git connection. GitHub may pause inactive repository schedules. These are real external dependencies. The local verified updater does not establish the hosted webhook/build trigger. A service-worker reload delivers an already deployed version; it cannot update a Cloudflare deployment by itself.

## Remaining release gates

1. Authorize a real Cloudflare account and deploy the branch/template to verify resource provisioning, secret prompt, stable workers.dev address, actual Free-plan limits and process/redeploy persistence. No Cloudflare credentials are configured here; `wrangler whoami` reports unauthenticated. Do not use a centrally hosted Sites app or a shared temporary account as a substitute.
2. Enable public reviewed template/release access at publication. The current GradeViewer repository is private; Cloudflare explicitly requires public source for the Deploy button. No visibility change has been performed. Review source/history before publication; publishing an isolated reviewed template is possible if repository history should remain private.
3. Configure the release signing secret with a GitHub account that can administer Actions secrets. This integration gets HTTP 403 for Actions-secret administration. Existing integration access cannot establish whether an unrelated Cloudflare deployment exists.
4. Exercise copied-repository automatic update → real Cloudflare build/deploy, then rollback with the same URL/secret/Durable Object. Do not label the hosted update chain verified based on the local updater test.
5. Validate Safari and installed Home Screen mode on a physical iPhone, and Chrome/installation on Android: cookie separation, password-manager/paste flow, safe areas, foreground refresh, storage/session loss and controlled updates. Chromium phone emulation is layout/interaction evidence, not actual iOS/Android installation.

Once these gates pass, finish the one migration merge, publish the signed v0.1.0 release and deploy the final version. Branch/staging deployment needed to run these gates is expected before the final release.
