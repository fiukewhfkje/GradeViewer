# PWA verification — October 16, 2026

[Production](https://gradeviewer.fiukewhfkje.workers.dev) is deployed and connected. [PR #9](https://github.com/fiukewhfkje/GradeViewer/pull/9) merged once as `1b60b6f`, retaining native baseline `3447420`. [Signed v0.1.0](https://github.com/fiukewhfkje/GradeViewer/releases/tag/v0.1.0) is published; [release CI](https://github.com/fiukewhfkje/GradeViewer/actions/runs/38990029814) is green. Final delivery evidence is in PROJECT_STATUS.md; historical staging measurements remain below.

## v0.1.1 setup follow-up

The user's screenshot confirms the fresh-account Cloudflare form, with **New GitHub connection**, project/password/build/deploy fields and preview-build toggle. Both READMEs and the [setup guide](PWA_ONBOARDING.md) now use those exact labels and explain what to keep or select. This is observed setup friction, not evidence of a completed novice deployment.

The password minimum is now 12 characters throughout the deployment/runtime and user-facing text. Build and **113 synthetic tests passed**, including an 11-character rejection before deployment changes and a 12-character successful deployment/unlock. Existing rotation/session/encrypted-credential lifecycle checks still pass. No extra live Schoology/performance runs were needed for this change. Earlier 111-test and v0.1.0 evidence below is historical. Rollback compatibility: v0.1.0 still requires a 20-character password; a new copy using 12–19 characters must remain on v0.1.1 or later. The patch does not change or migrate encryption keys.

## Implementation and parity evidence

The self-contained `web/` app includes the React/TypeScript UI, Schoology ports, user-owned Worker/SQLite encrypted credential vault, browser-local grade/history/scenario persistence, atomic prepared-save recovery, fresh-on-open gate, controlled static-shell PWA updates, personal URL/installation help and bounded read-only provider transport. It includes native-style local grade edits/drop/add/reset/removal, semester summaries, dated quarters/exams, progression, estimates and final calculator. Latest UI corrections restore native colors/update labels/what-if delta and collapsible assignment groups with semester/quarter cards.

Current local production build passes. **111 tests** pass (54 core, 21 security, 10 legacy release/JSONC, 6 provenance policy, 12 snapshot/batching, 3 deploy helper, 5 assignment-score presentation). **22 Chromium HTTPS + Worker/SQLite E2E checks** pass against the latest UI/helper source, covering connection, gestures, shared scenarios, grouping/quarter scopes, layout, persistence, restart/recovery, offline fresh gating, static-only cache, controlled SW updates, provider-failure retention, tabs, new-browser credential reuse and disconnect. Screenshots use synthetic records only.

[Remote CI 38989768644](https://github.com/fiukewhfkje/GradeViewer/actions/runs/38989768644), head `8061990`, passed Chromium and WebKit (22 flows each), **119 Swift tests**, **1,200 direct Swift/JavaScript calculation comparisons**, and **real GitHub provenance generation/verification**. This run includes the native score/category/navigation corrections and batching changes. Two fixture-only failures from the preceding run were corrected: Swift JSON comparison now sorts keys, and the cooldown fixture controls response order. Native production sources remain unchanged. Calculator differential evidence is not exhaustive parser/graph/UI equivalence. Native Sources remain unchanged.

HTTPS fixture testing preserves production cookie security. WebKit's plain-HTTP `__Host-` cookie rejection was correct. Local test CA/pinning is confined to synthetic loopback processes; public network TLS is not disabled. Real phone installation remains untested. Chromium's vertical touch input is native CDP; WebKit's gesture input is synthetic dispatch.

## Hosted results and performance

Staging [gradeviewer-preview](https://gradeviewer-preview.fiukewhfkje.workers.dev) is in the owner's account. Production OAuth and complete account-bound snapshots passed with 45 course-period records. A new process/login reused encrypted Schoology credentials after redeploy and rollback. Real records/responses stayed in process memory; only counts/booleans/timings were exported. The old unauthenticated 401 was expected; authenticated access works.

| Measurement | Result | Limit |
| --- | --- | --- |
| Original serial cold / steady | 13.623 s / 3.6–3.9 s | Historical implementation |
| Latest steady refreshes | 1.393 / 1.171 / 1.187 s; 6 API calls | Cloud workspace, not phone |
| Full refresh after actual 310-second metadata expiry | **3.367 s**, 7 API calls, complete snapshot | Still above user's couple-second target |
| Resumed baseline after actual 310-second expiry | 3.619 s, 7 API calls | Before final scheduling changes |
| Final expired refresh, deployed `41fe8e0` | **3.043 s**, 6 API calls, complete 45-record account-bound snapshot | Natural 310-second wait; still above a two-second target; cloud workspace, not phone |
| Empty browser state / optional title traversal | 6.547 s, 24 API calls | Includes discovery and optional recovery; provider cooldowns can add delay |

The Worker checks identity first, reads independent discovery roots concurrently and batches up to 32 validated jobs with at most five in-flight reads, 44 provider subrequests including redirects and 4 MB aggregate output. Expired metadata can renew alongside authoritative alias discovery. Optional scale jobs share that invocation only after all required snapshot reads complete, including pagination; otherwise they defer. Deferred reads use another invocation; provider cooldowns stop queued requests. Fixed five-minute metadata/alias expiry, manual bypass and required-before-optional reads remain. Do not present warm results as every-open results.

Opt-in live tests are excluded from CI. From `web/`, use `npm run verify:hosted -- refresh` with your own `GRADEVIEWER_TEST_URL` and private password file; `GRADEVIEWER_BENCHMARK_EXPIRY=1` performs the natural-expiry measurement. Do not export live responses or hammer Schoology.

## Credentials and privacy

Deployment requires a unique private APP_PASSWORD of at least 12 characters (reduced from 20 in v0.1.1). Password-manager generation is recommended. The deploy helper moves the build secret to the selected Worker's runtime via stdin; ordinary updates preserve it. Persistent sessions use hashed opaque IDs and 90-day Secure/HttpOnly/SameSite=Strict host cookies, origin checks and revocation. AES-GCM envelope encryption separates ciphertext from the Worker root secret. Cloudflare executes decryption/signing; this is not encryption from Cloudflare.

Schoology identity is verified before student reads, account changes require disconnect, and staged credentials activate only after full parsing/prepared browser persistence. Failure retains the prior connection/snapshot. Grades/history/scenarios remain in versioned IndexedDB. Browser storage loss cannot recover local-only edits/history. Changing APP_PASSWORD revokes sessions and requires re-entering Schoology keys; native Keychain/history does not import.

Only fixed enrolled-section Schoology GETs are allowed. OAuth redirects re-sign; pagination, payloads and reads are bounded. No provider writes, analytics or shared maintainer grade proxy exists. No API response enters SW cache. Static document/asset CSP/nosniff/frame/referrer/permissions headers are deployed through `_headers` as well as API wrappers.

## Releases and updates

Releases now use **GitHub keyless Sigstore provenance**, eliminating maintainer signing-secret setup. Schema-2 manifests contain archive/file SHA-256 hashes and source commit. The official release workflow signs `manifest.json` with GitHub OIDC; assets include `gradeviewer-source.json`, `manifest.json`, `provenance.json`.

Before writing, the copied updater uses `gh attestation verify` to require the exact official repository/workflow, release tag/source digest and hosted runner, then checks schema/hashes/paths. It preserves personal Worker settings, secrets and workflow files. Daily/manual source updates should push into Cloudflare Builds. Real provenance passed in CI. An isolated template install/build/test/dry-run, updater/config/secret preservation and explicit rollback passed locally with a fixture verifier; that fixture is not cryptographic evidence. Legacy Ed25519 vectors remain tests; no RELEASE_SIGNING_KEY is needed.

## Completed release work and remaining verification limits

1. Completed: the new environment contains the active CLOUDFLARE_API_TOKEN; Cloudflare verification and actual Worker/Builds calls succeed. The preview now has a registered deployment credential, Git trigger and secret APP_PASSWORD. Multiple real push events successfully built and deployed the existing preview. Runtime readiness metadata still reports unknown; actual API authorization was verified without exposing values.
2. Finish expired-metadata/first-open performance and remaining native UI/UX audit. The latest 3.043-second expiry run remains above the requested couple-second result.
3. Prove public beginner signup/template deployment and Free-plan resources/secret prompt. Repo is public; the source form correctly prefilled scripts/password description, but the Git-account dropdown confused the user. CLI deployment does not prove ease for new users.
4. Verify actual copied-repository automatic update → Cloudflare build/deploy and rollback at a stable URL, retaining credentials/local state.
5. Validate physical iPhone Safari/Home Screen and Android installation/foreground/storage/update behavior. Keep native installed until verified.
6. Completed: final CI/source credential checks, secure production password, one migration merge, signed v0.1.0 publication and configured production deployment. The user requested delivery without more manual setup tasks; items 2–5 retain the unverified limits stated above.

The latest implementation staging version is `499b5769-79d1-492e-b61c-d67cb9b903d7`, from successful push-event build `04ed5e25-0c41-4896-ade9-ebd152eca4ad` at `41fe8e0`. Preview recovery reconnected successfully with 45 account-bound course-period records. Both the grouped UI/helper and subsequent score/navigation/batching changes are deployed. Production GradeViewer is deployed at https://gradeviewer.fiukewhfkje.workers.dev with an encrypted configured Schoology connection and automatic main-branch Builds. The user's other Workers and Mac resigning script were untouched.

The [three-entry setup guide](PWA_ONBOARDING.md) clarifies the Git account dropdown. GitHub rejected creating a separate private validation repository through the integration (403, Resource not accessible by integration). No copy was created. The user asked to continue engineering without more manual setup requests; separate-copy and physical-device success are not claimed.

The final expiration run reused stored credentials and retained its browser-state fixture in memory across an automatic preview redeploy during the idle wait. Its warm control was 1.759 s; empty-browser/title discovery was 8.328 s. An intermediate 4.245 s run exposed deferred scales falling back into four separate calls; the final fix orders required jobs before scales across chunks and retries deferrals in a batch. The final expiry used two batch calls and no separate scale calls. These samples do not establish a two-second guarantee or phone startup/render speed.

Final production evidence: fresh login after automatic deployment reused encrypted keys, committed all 45 account-bound records, and measured 1.417 s / five calls warm. New-browser title discovery was 6.515 s; initial production connect was 3.274 s. The latest code combines scan startup and discovery while preserving identity-before-student-reads and opens the fresh gate immediately after full commit/activation. The actual updater verified the published v0.1.0 provenance/hashes and retained personal config/secrets in an isolated source copy; the copied remote GitHub/Cloudflare chain and a downgrade across published versions remain unverified.
