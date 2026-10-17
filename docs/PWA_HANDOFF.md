# GradeViewer PWA handoff — October 16, 2026

## v0.1.1 setup follow-up

The user reached Cloudflare's setup form from another account and reported confusion and an excessive 20-character password requirement. Both READMEs and PWA_ONBOARDING now explain each visible field, account connection and preview toggle. APP_PASSWORD's minimum is 12 in both deployment and runtime; template/error/help text agrees, with password-manager generation/saving guidance. Build and 113 tests passed. Version is 0.1.1 for the existing keyless patch-release workflow. Do not rotate the owner's existing production password or repeat the migration merge. The user subsequently reported Deploy completed on a different account and the app appeared set up. Their screenshots show earlier Cloudflare wizard steps revealed by Back; direct entry to the final page is expected from the template button, but the exact earlier account/navigation state was not reproduced. The guide now explains both paths and returning via the personal workers.dev URL. This is user-reported deployment, not inspection of fresh signup/Schoology connection/copied updater. They said the app UI looks poor and explicitly deferred fixing it until later. Signed v0.1.1 is published; release CI 38996834210 passed. Production build `58b15b29-97c6-46d2-8bcd-9963cec33e8f` succeeded and live assets match. Copies using 12–19 characters must stay on v0.1.1 or later because v0.1.0 still requires 20; existing longer passwords work with both. Current environment revision 7 reports enforced unrestricted networking and all four configured runtime variables ready; actual Cloudflare access also succeeds.

## v0.1.2 follow-up

Current source restores the native filled chart, spinner-only phone refresh with an isolated scroll view, tighter grouped Profile rows and Check for updates / Update now. Version 0.1.2 uses the existing release/deployment pipeline. Local build, 121 tests and 25 Chromium browser flows pass. Standalone flags are emulated; physical Home Screen behavior is not claimed. See PROJECT_STATUS.md and PWA_VALIDATION.md for delivery evidence. Documentation is Schoology-only; earlier superseded research remains in Git history.

## Final delivery

The migration is complete as a shipped v0.1.0 implementation. Do not repeat the migration merge, recreate production, or recreate the v0.1.0 tag.

- Owner's connected production app: **https://gradeviewer.fiukewhfkje.workers.dev**. Schoology is already configured; the owner unlocks once with the private password handoff file `/workspace/.gradeviewer-private/GradeViewer-your-private-login.txt`. Never print its contents or include it in source/archive uploads.
- Exactly one migration merge: [PR #9](https://github.com/fiukewhfkje/GradeViewer/pull/9), merge `1b60b6fc91c8de57c66f3acc666bfed44afe6417`. Native baseline `3447420` and focused history are preserved; native production Sources/GradeViewer files are unchanged.
- [Signed release v0.1.0](https://github.com/fiukewhfkje/GradeViewer/releases/tag/v0.1.0) is published with source, manifest and GitHub keyless provenance. [Release CI](https://github.com/fiukewhfkje/GradeViewer/actions/runs/38990029814) passed. Actual published-release updater verification and personal-config/secret preservation passed in an isolated source copy using the real gh verifier.
- Production Builds trigger `5cbb41f5-53d3-48ce-ab05-8e08e5b27c3e`, Worker tag `f4b2eeb230fe46289a94c228de57d937`, branch `main`, root `web`, deploy `npm run deploy -- --name gradeviewer`. Production password is a secret build variable; do not replace it with the preview password. Production merge-push build `ef0a181d-3aad-416f-8de6-8110ad146bcd` deployed version `d87f8c7b-1e0d-45e6-9a5a-77ec9ad0e4c4` and retained encrypted credentials.
- Post-deployment real owner verification completed 45 account-bound course-period records using stored keys. Warm refresh: 1.417 s / five calls. Initial production connect: 3.274 s; new-browser optional title recovery: 6.515 s. Last naturally expired sample, before final round-trip consolidation: 3.043 s. No two-second or physical-phone guarantee.
- The user explicitly asked to finish their configured deployment and receive a brief/URL, without more manual setup requests or unrelated testing. Physical phone installs, novice fresh-account signup and copied-remote-repo push/deploy/true published-version rollback remain unverified; GitHub repo creation returned 403. Do not repeat the declined copied-repo request or claim those checks passed. See PROJECT_STATUS.md for final evidence.

## Original checkpoint and recovery history

The sections below preserve earlier migration checkpoints. Their paused/no-release statements describe history and are superseded by the final delivery above.


The user requested a clean handoff to a new thread so its cloud environment can load a newly added `CLOUDFLARE_API_TOKEN`. The new environment has now loaded it and work has resumed. Resume the existing migration; do not restart the port or merge it immediately.

## Resumed environment and Builds setup

- The token is present and `/user/tokens/verify` returned HTTP 200/success/active. Runtime metadata still says unknown; actual Worker/Builds API calls succeed. Never print the token or request its value in chat.
- Registered the token with Builds and created the existing-preview trigger `1d53640c-9634-4591-bde3-78b1d1b3a6ed`, targeting immutable Worker tag `79eabb0a21434d8f9c070284c6771647`. Branch `pwa-migration`, root `web`, build `npm run build`, deploy `npm run deploy -- --name gradeviewer-preview`. APP_PASSWORD is a secret build variable. Real push-event builds have now deployed successfully to the existing preview. The initial build was `8191c650-2470-46df-8a65-630345ac8b7d`; later implementation pushes also deployed.
- This is a replacement VM. Old private local passwords and OAuth files are absent. The preview-only recovery password is stored outside the repository at `/workspace/.gradeviewer-private/preview-owner-password`, with private permissions. The recovery password has been applied to the same preview Worker, and the configured Schoology keys successfully reconnected it. Subsequent deployments keep that password and vault. No production password has been selected.
- Fresh install/build passed. The resumed implementation now passes 111 tests and 22 Chromium flows locally; CI and latest timing evidence are recorded in PROJECT_STATUS.md.
- Final implementation CI [38989236441](https://github.com/fiukewhfkje/GradeViewer/actions/runs/38989236441) is green at `41fe8e0`; its push-event build deployed version `499b5769-79d1-492e-b61c-d67cb9b903d7`. The latest natural-expiry refresh is **3.043 s / six API calls**, complete and account-bound after a real 310-second wait spanning redeployment. A two-second target is still unmet. No browser/physical-phone timing claim.
- The user asked to continue without further manual setup requests or unrelated testing. Repository creation through the integration is actually blocked (403); physical phones are unavailable in this cloud environment. Do not repeat the copied-repository request or fabricate those checks. The earlier implementation/CI evidence and all remaining release gates below still apply. Historical statements that the running environment lacks the Cloudflare token are superseded by this section.

## Start here

- Public repository: https://github.com/fiukewhfkje/GradeViewer
- Branch: `pwa-migration`; draft PR #9: https://github.com/fiukewhfkje/GradeViewer/pull/9
- Native comparison baseline/main: `3447420689f2f1157ad26d01947a7a7e607216fb`. Native `Sources/` are unchanged. No migration merge, `v0.1.0` tag or public PWA release has occurred.
- Current source lives in `web/`, a self-contained deployment/template root. Package version: `0.1.0`. Read root AGENTS.md and its required docs, then this file and PWA_VALIDATION.md. Earlier planning/checkpoint prose is historical.
- On a fresh machine, clone the public `pwa-migration` branch. The accompanying source ZIP contains the tracked repository, with no credentials, dependencies, real student records or `.git`; GitHub retains full history.

## Latest user requirements

Finish the PWA for desktop web, iPhone and Android; preserve the native app's UI/UX and grade behavior. Better implementations are allowed, but do not treat a different attractive demo as parity. Keep Grades/Profile, native styling, collapsible assignment groups, semester summary/quarter cards, graph, local editing/drop/add/reset/removal, period scopes and read-only exam footer. Profile must show a copyable/openable personal workers.dev address and installation help. Desktop gets a refresh button; phones use pull-down, detected with viewport width and coarse pointer, plus an accessible Profile refresh control.

The user wants a complete, correct refresh in a couple of seconds, including opening after time has passed. Warm-only timings do not satisfy this. They explicitly require evidence that people with no Cloudflare account and no Git knowledge can set up their own copy easily. Eliminate safe-to-automate steps. Each user's Cloudflare account owns its quota and encrypted credentials; grades/history/local scenarios remain browser-local. Never centralize student requests on a maintainer service.

Use focused commits and **one final migration merge only when complete/confident**, then release/deploy. Start releases at `0.1.0`. Signed upstream fixes should automatically update independent copies. Preserve native history for comparison. Keep native installed until the PWA is validated; PWA needs no weekly re-signing. Native local history/edits do not import. The user's Mac resigning script has not been changed.

No connected browser, desktop mouse/keyboard or computer-use automation. Headless CLI browsers are allowed. No subagents were used or requested. Never print credentials/cookies/auth headers/provider responses or real grades. Screenshots/CI fixtures are synthetic; real verification keeps records in memory.

## Verified implementation

React/TypeScript/Vite PWA; Schoology parser/calculator/period/reconciliation/progression ports; local scenarios; versioned IndexedDB with prepared-write recovery; foreground fresh-data gate, retry, failure retention and tab coordination. Static app-shell service worker has controlled updates and never caches API responses. Static `_headers` enforce document/asset security because Cloudflare assets-first responses bypass Worker wrappers.

The user-owned Worker/SQLite Durable Object provides high-entropy APP_PASSWORD owner unlock, hashed opaque 90-day sessions in a Secure/HttpOnly/SameSite=Strict `__Host-` cookie, revocation/origin checks/rate limits, AES-GCM envelope-encrypted Schoology credentials, account binding and staged activation after complete snapshot parsing/prepared browser persistence. Only fixed enrolled-section GET routes are signed; redirects re-sign OAuth and pagination/payloads/cooldowns are bounded. There is no shared default password or first-visitor owner claim.

Refresh reads `users/me` before student data. `/api/scan/roots` fetches independent enrollment/bulk-grade roots together, then resolves ownership in order. `/api/scan/read-batch` validates up to 32 unique enrolled-section jobs before reads, with at most five concurrent reads, 44 total provider subrequests including redirects, and a 4 MB aggregate response budget. Excess work is deferred into individual invocations. Cooldowns stop queued reads. Metadata/alias receipts expire after a fixed five minutes; manual refresh bypasses reuse. Required reads precede optional title recovery. A transient required providerUnavailable/502 gets one bounded retry.

Deploy helper transfers a Cloudflare APP_PASSWORD build secret into the runtime secret through stdin, without exposing it in argv/child env. Ordinary redeploys preserve runtime secrets. It now forwards explicitly selected Worker arguments to both secret setup and deployment, preventing staging password/deploy name mismatches.

Latest UI corrections restore native green values, parenthesized course percentages, update icons, blue what-if grade/delta, provider update dates during local edits, collapsible assignment groups/Added Grades, semester summary plus quarter card and the read-only exam footer. Course screens hide the base tab bar while fresh. All Assignments orders graded rows then named ungraded rows. Finish the remaining native UI source audit below; do not claim every native interaction is exhaustively matched.

## Exact verification state

- Current local source: production build **passed**, **111 unit/security/integration/presentation tests passed**, **22 Chromium HTTPS + local Worker/SQLite E2E checks passed**, including the latest grouping/quarter UI and selected-Worker deployment helper.
- Last complete remote CI: https://github.com/fiukewhfkje/GradeViewer/actions/runs/38989236441 (head `41fe8e0`). **Chromium 22, WebKit 22, native-reference and real release-provenance checks all passed.** This run includes the score/category/navigation fixes, combined metadata/alias batching and required-before-optional scale scheduling. Native production sources remain at the baseline; only a native test's JSON key ordering was corrected.
- Native CI: **119 Swift tests** and **1,200 direct synthetic Swift/JavaScript comparisons** passed. The comparison covers calculator baselines/scenarios/error codes/reliability/final math; it is not a differential test of every parser/graph/UI behavior. Two Swift test expressions were split/typed to satisfy the CI compiler; expected behavior was unchanged.
- Fresh isolated template install/build/tests/Worker dry-run and update/configuration/secret preservation/explicit rollback passed. Current local template test substitutes a strictly scoped fixture `gh` verifier; real cryptographic provenance verification passed separately in GitHub CI.
- Real Schoology OAuth and hosted complete snapshots succeeded with **45 course-period records**, account-bound. Stored credential reuse after a new login/redeploy/rollback succeeded. Real records stayed in memory; screenshots contain synthetic data only. The old anonymous 401 was expected; authenticated access is working.
- Source/history checks previously found no configured credential values or recognized private credentials across 753 historical objects. Recheck new source/archive before publication.

Browser test detail: WebKit correctly rejected secure host cookies over HTTP localhost, so E2E now uses an ephemeral local HTTPS certificate. Node trusts only that test CA (plus existing configured CA); Chromium pins its certificate key for service-worker fetches; browser test contexts ignore the local certificate error. Internet TLS is not disabled. Synthetic fixture provider failures are induced server-side because WebKit service-worker fetches bypass page request interception. Touch gesture physics use Chromium CDP; WebKit's touch input check is synthetic event dispatch. Neither establishes physical iOS installation.

## Performance evidence and next optimization

These are cloud-workspace → real Cloudflare Worker → Schoology timings, not phone measurements.

- Original serial implementation: full cold 13.623 s; steady 3.6–3.9 s.
- Before latest parallel/root work: cold 9.087 s; steady 1.797/1.818 s.
- Latest steady runs: **1.393 / 1.171 / 1.187 s**, six same-origin API calls each. Separate prior runs were 1.184/1.210/1.171 s.
- A real **310-second wait**, retaining state only in memory, then full expired-metadata refresh: **3.367 s**, seven same-origin calls, complete snapshot passed. This remains above the user's couple-second target.
- Fresh-browser/empty-state discovery with optional unresolved-title traversal: **6.547 s**, 24 calls. Another run took 3.272 s before a provider cooldown. Provider limits and optional title/folder recovery can still delay first setup/late opens; do not present 1.2 s as every-open performance.

Repeat (opt-in, own Worker only, never CI):

```sh
cd web
GRADEVIEWER_TEST_URL=https://gradeviewer-preview.fiukewhfkje.workers.dev \
GRADEVIEWER_TEST_PASSWORD_FILE=.local-test/hosted-owner-password \
GRADEVIEWER_BENCHMARK_EXPIRY=1 npm run verify:hosted -- refresh
```

The expiry option waits 310 seconds in short asynchronous chunks after warm reads. The script respects any cooldown after optional title recovery before benchmark-only repetitions. It prints counts/routes/timings only. Do not hammer the live account; use synthetic performance fixtures for development and one measured opt-in run after changes.

Resumed measurements attributed much of the latency to discovery/batching, then eliminated separate deferred scale calls and raised the bounded pool to five. The final expired sample is 3.043 s (6 API calls), versus the resumed 3.619 s baseline (7); warm control 1.759 s and empty-state/title recovery 8.328 s. The expiry run retained stored credentials across an automatic redeploy. Next: reduce remaining required-read latency and optional title/folder costs; preserve complete fresh grade/metadata checks and fixed cache expiry. Do not satisfy the target by showing stale grades or extending TTL. Consider parallel scheduling/optional enrichment carefully with transactional activation, credentials and shared cooldowns intact. Add real browser startup/render timings without taking screenshots of real records.

## Cloudflare state and environment blocker

- Existing staging: **https://gradeviewer-preview.fiukewhfkje.workers.dev**
- Account: `9c2bc6dd88dd53aae93c31336faa212a`; base subdomain `fiukewhfkje.workers.dev` alone is not an app URL.
- Latest implementation staging version: **499b5769-79d1-492e-b61c-d67cb9b903d7**, deployed from `41fe8e0` by successful push-event build `04ed5e25-0c41-4896-ade9-ebd152eca4ad`. The grouped UI/helper and subsequent navigation/batching changes are deployed.
- No production `gradeviewer` Worker has been deployed by this migration. Other projects' Workers were untouched.
- Wrangler device OAuth works for direct deployments. A second approved official Cloudflare CLI OAuth grant works for Builds API reads/writes, but the server **omitted `account_api_tokens:create` from its granted scopes**. Token creation returned 403. Do not claim that approval granted token creation or ask for the same approval again without new evidence.
- User added `CLOUDFLARE_API_TOKEN` in this chat's cloud environment editor. **It was still absent in the running process and runtime readiness metadata (revision 5)** at handoff. User confirmed the correct editor. A new thread/environment may load the saved configuration. First recheck environment_status and the configured CLI normally. Distinguish a saved draft from applied readiness. Never ask for the token value in chat or print it.
- Requested token template: **Edit Cloudflare Workers**, scoped to the user's account. Once present, verify `/user/tokens/verify` without printing the token; retain the returned token ID privately. Register that deployment credential through Builds `/accounts/{id}/builds/tokens` using the separately authorized Builds OAuth grant if the token itself lacks Builds Configuration permission.
- Builds now has the verified deployment credential and preview trigger described above. The existing repository connection is: repo connection UUID **d4141194-9bf0-49fb-afb0-327753d94ad0**, GitHub owner ID **116608087**, repo ID **1396734528**. Use immutable Worker `tag`, not its name, as Builds `external_script_id`.
- Configured staging trigger: branch `pwa-migration`, root `web`, build `npm run build`, deploy `npm run deploy -- --name gradeviewer-preview`; APP_PASSWORD is a secret build variable. The helper applies it to the same Worker. Real Git push → build → deployed version is verified. Separate-copy official-release update/rollback remains unverified.
- Official Builds API schema/docs were read. Use documented APIs and the account's authorized identities; do not bypass the proxy, relay arbitrary GitHub API calls around permission failures or disable TLS.

Ignored private local files in the existing VM: `web/.local-test/hosted-owner-password`, `cf-build-auth.json`, `cf-api.mjs`, `cf-build-login.mjs`, and deployment/token/connection metadata. Do not print or include them in a handoff ZIP. Wrangler auth is in its standard protected config. If the VM is replaced, these files may be absent. Reauthorize only when necessary. The preview's random test password is not the user's chosen production password. A new VM can rotate the **preview only** password with authorized CLI access and reconnect using configured Schoology keys; rotation revokes sessions and the old encrypted credentials need replacement. Do not pretend the owner can unlock with an unknown fixture password.

GitHub's integration permits code/PR/Actions operations, but repository administration/Actions-secret access returned 403 even after a user-approved extra GitHub CLI login. The proxy still applies the integration's identity. **Do not repeat GitHub device login as a fix or bypass injected credentials.** User manually made the repository public. A resumed attempt to create a private copied-repository validation target returned 403, `Resource not accessible by integration`. No repository was created. The user asked to continue engineering without further manual setup requests; do not repeat the request or the failed login workaround.

## Releases: keyless provenance replaces the old signing-secret gate

**No `RELEASE_SIGNING_KEY` setup is needed anymore.** This was removed safely in commit `11f5e15` and real CI passed. Do not send the user back to GitHub secret settings.

`scripts/package-release.mjs` produces schema-2 manifest/source archive with archive and per-file SHA-256 hashes. The release workflow uses `actions/attest-build-provenance@v3` with GitHub OIDC, `id-token: write`, `attestations: write`. Release assets are `gradeviewer-source.json`, `manifest.json`, **`provenance.json`**. It no longer reads a private signing key.

The copied updater downloads only official stable assets, invokes a current `gh attestation verify` with exact official repo/workflow, `refs/tags/v<version>`, manifest source commit and hosted-runner requirement, then checks archive/file hashes/schema/safe paths before writing. It preserves personal Worker settings/secrets/workflows. Daily/manual copied-repo workflow has GH_TOKEN from its own standard workflow token; its push should trigger Cloudflare Builds. Real hosted copied-repo push/build/update/rollback is still unverified. Public release must exist before automatic updates can succeed.

Existing Ed25519 verification vectors/public-key fixture remain in release tests; the ignored historical private key is no longer a release dependency. Never print/publish/attach it. No key transfer is required for the new thread. System gh here is old 2.46; an official checksum-verified gh 2.102 binary was downloaded under ignored `web/.local-test/tooling/`. Current Ubuntu CI supplies a recent verifier. The production updater fails closed if gh/provenance verification fails.

## Remaining work, in order

1. Completed in the resumed environment: Cloudflare token verification, Builds credential/trigger/secret configuration, successful push-event staging builds/deployments and preview reconnection. Keep the same URL/vault/password; unrelated projects remain untouched.
2. Finish performance work for expired metadata/late opens; the latest measured 3.043 s is still above a two-second result. First-connect/title recovery can be slower. Add browser/phone timing evidence.
3. Finish native UI/UX audit using `GradeViewer/Views.swift`, `Calculators.swift`, Settings and native history. The latest grouping/semester/quarter corrections have local checks. Resumed source review corrected assignment score display for letter-only/excused/ungraded and locally overridden letter scores, score-only dropped presentation and the native CategoriesView alias. It also fixed closing a selected-period view. Physical course-sheet/back/keyboard/chart behavior remains unverified. Do not claim exhaustive parity from calculator comparisons alone.
4. Prove beginner onboarding on the public template, including new accounts/permissions, the Git-account dropdown, generated repo and Free-plan build/resource/APP_PASSWORD setup. User screenshots proved correct commands/password description are prefilled, but the user was confused by the Git dropdown. CLI deployment is not evidence that novices can complete signup. Write/test a plain three-field guide and count unavoidable sign-in/verification actions. No terminal/token/database steps for end users.
5. Exercise actual copied-repo official release update → GitHub push → Cloudflare build/deploy and rollback, preserving URL, vault, browser state and password. Finish physical iPhone Safari/Home Screen and Android installation/foreground/storage/update checks. WebKit/Chromium emulation does not establish physical installs.
6. Review current CI, source/package secret scan and docs. Update PR #9 description to final implementation. Choose/set the owner's production APP_PASSWORD securely. Once confident/gates pass, perform **one merge** retaining focused commits/native baseline, publish signed `v0.1.0`, deploy and report a brief result with links and evidence.

Rough progress at handoff: **about 80% overall**. Most core implementation and substantial verification are complete. Setup automation/ease evidence, performance target, final UI/device checks and actual migration merge/release/deployment remain. This is an engineering estimate, not test coverage or a promise that the remaining work is trivial.
