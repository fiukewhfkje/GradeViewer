# PWA verification — October 16, 2026

Release candidate `0.1.0`, branch `pwa-migration`, [draft PR #9](https://github.com/fiukewhfkje/GradeViewer/pull/9), native baseline `3447420`. No final migration merge, version tag or public PWA release has occurred. See [PWA_HANDOFF.md](PWA_HANDOFF.md) for precise resumption instructions and account/environment details.

## Implementation and parity evidence

The self-contained `web/` app includes the React/TypeScript UI, Schoology ports, user-owned Worker/SQLite encrypted credential vault, browser-local grade/history/scenario persistence, atomic prepared-save recovery, fresh-on-open gate, controlled static-shell PWA updates, personal URL/installation help and bounded read-only provider transport. It includes native-style local grade edits/drop/add/reset/removal, semester summaries, dated quarters/exams, progression, estimates and final calculator. Latest UI corrections restore native colors/update labels/what-if delta and collapsible assignment groups with semester/quarter cards.

Current local production build passes. **104 tests** pass (54 core, 21 security, 10 legacy release/JSONC, 6 provenance policy, 10 snapshot/batching, 3 deploy helper). **22 Chromium HTTPS + Worker/SQLite E2E checks** pass against the latest UI/helper source, covering connection, gestures, shared scenarios, grouping/quarter scopes, layout, persistence, restart/recovery, offline fresh gating, static-only cache, controlled SW updates, provider-failure retention, tabs, new-browser credential reuse and disconnect. Screenshots use synthetic records only.

[Remote CI 38987163698](https://github.com/fiukewhfkje/GradeViewer/actions/runs/38987163698), head `5fd3f0c`, passed Chromium and WebKit (22 flows each), **119 Swift tests**, **1,200 direct Swift/JavaScript calculation comparisons**, and **real GitHub provenance generation/verification**. This run includes the latest grouping/helper implementation; the handoff commit changes documentation only. Calculator differential evidence is not exhaustive parser/graph/UI equivalence. Native Sources remain unchanged.

HTTPS fixture testing preserves production cookie security. WebKit's plain-HTTP `__Host-` cookie rejection was correct. Local test CA/pinning is confined to synthetic loopback processes; public network TLS is not disabled. Real phone installation remains untested. Chromium's vertical touch input is native CDP; WebKit's gesture input is synthetic dispatch.

## Hosted results and performance

Staging [gradeviewer-preview](https://gradeviewer-preview.fiukewhfkje.workers.dev) is in the owner's account. Production OAuth and complete account-bound snapshots passed with 45 course-period records. A new process/login reused encrypted Schoology credentials after redeploy and rollback. Real records/responses stayed in process memory; only counts/booleans/timings were exported. The old unauthenticated 401 was expected; authenticated access works.

| Measurement | Result | Limit |
| --- | --- | --- |
| Original serial cold / steady | 13.623 s / 3.6–3.9 s | Historical implementation |
| Latest steady refreshes | 1.393 / 1.171 / 1.187 s; 6 API calls | Cloud workspace, not phone |
| Full refresh after actual 310-second metadata expiry | **3.367 s**, 7 API calls, complete snapshot | Still above user's couple-second target |
| Empty browser state / optional title traversal | 6.547 s, 24 API calls | Includes discovery and optional recovery; provider cooldowns can add delay |

The Worker checks identity first, reads independent discovery roots concurrently and batches up to 32 validated jobs with at most four in-flight reads, 44 provider subrequests including redirects and 4 MB aggregate output. Deferred reads use another invocation; provider cooldowns stop queued requests. Fixed five-minute metadata/alias expiry, manual bypass and required-before-optional reads remain. Do not present warm results as every-open results.

Opt-in live tests are excluded from CI. From `web/`, use `npm run verify:hosted -- refresh` with your own `GRADEVIEWER_TEST_URL` and private password file; `GRADEVIEWER_BENCHMARK_EXPIRY=1` performs the natural-expiry measurement. Do not export live responses or hammer Schoology.

## Credentials and privacy

Deployment requires a private APP_PASSWORD of at least 20 characters. The deploy helper moves the build secret to the selected Worker's runtime via stdin; ordinary updates preserve it. Persistent sessions use hashed opaque IDs and 90-day Secure/HttpOnly/SameSite=Strict host cookies, origin checks and revocation. AES-GCM envelope encryption separates ciphertext from the Worker root secret. Cloudflare executes decryption/signing; this is not encryption from Cloudflare.

Schoology identity is verified before student reads, account changes require disconnect, and staged credentials activate only after full parsing/prepared browser persistence. Failure retains the prior connection/snapshot. Grades/history/scenarios remain in versioned IndexedDB. Browser storage loss cannot recover local-only edits/history. Changing APP_PASSWORD revokes sessions and requires re-entering Schoology keys; native Keychain/history does not import.

Only fixed enrolled-section Schoology GETs are allowed. OAuth redirects re-sign; pagination, payloads and reads are bounded. No provider writes, analytics or shared maintainer grade proxy exists. No API response enters SW cache. Static document/asset CSP/nosniff/frame/referrer/permissions headers are deployed through `_headers` as well as API wrappers.

## Releases and updates

Releases now use **GitHub keyless Sigstore provenance**, eliminating maintainer signing-secret setup. Schema-2 manifests contain archive/file SHA-256 hashes and source commit. The official release workflow signs `manifest.json` with GitHub OIDC; assets include `gradeviewer-source.json`, `manifest.json`, `provenance.json`.

Before writing, the copied updater uses `gh attestation verify` to require the exact official repository/workflow, release tag/source digest and hosted runner, then checks schema/hashes/paths. It preserves personal Worker settings, secrets and workflow files. Daily/manual source updates should push into Cloudflare Builds. Real provenance passed in CI. An isolated template install/build/test/dry-run, updater/config/secret preservation and explicit rollback passed locally with a fixture verifier; that fixture is not cryptographic evidence. Legacy Ed25519 vectors remain tests; no RELEASE_SIGNING_KEY is needed.

## Open release gates

1. Apply the saved CLOUDFLARE_API_TOKEN to the active environment; finish Builds deployment credential/trigger configuration. Existing OAuth can deploy and administer Builds, but its token-creation scope was omitted and creation returned 403. Last active runtime still lacked the user's newly saved token. Do not ask for its value in chat.
2. Finish expired-metadata/first-open performance and remaining native UI/UX audit. Current 3.367-second expiry run does not meet the requested couple-second result.
3. Prove public beginner signup/template deployment and Free-plan resources/secret prompt. Repo is public; the source form correctly prefilled scripts/password description, but the Git-account dropdown confused the user. CLI deployment does not prove ease for new users.
4. Verify actual copied-repository automatic update → Cloudflare build/deploy and rollback at a stable URL, retaining credentials/local state.
5. Validate physical iPhone Safari/Home Screen and Android installation/foreground/storage/update behavior. Keep native installed until verified.
6. Check final CI and source/package credentials; choose a secure owner production password; then one migration merge, signed v0.1.0 publication and final production deployment.

The latest deployed staging version is `2b0869cf-25da-4e23-b623-f0b8c2413d72`; the new grouped-assignment/helper source still needs redeployment. Production GradeViewer has not been created by this migration. The user's other Workers and Mac resigning script were untouched.
