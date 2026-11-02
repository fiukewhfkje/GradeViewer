# Carmen diagnostic handoff — November 1, 2026, after 7 PM EST

This is the starting point for a fresh thread. Read AGENTS.md, this file, [the protocol](CARMEN_SESSION_BENCHMARK.md) and [the Muse handoff](CARMEN_MUSE_HANDOFF.md). Inspect Git/filesystem state before treating a saved status as current.

## Scope

- Repository `/Users/ashtonchang/Documents/GradeViewer`, branch `codex/investigate-gpa-carmen`, origin `https://github.com/fiukewhfkje/GradeViewer.git`. Inspect `git log` for the final commit; the preceding baseline was `6e1551a`.
- Carmen remains isolated operator tooling. Production PWA/Worker/provider settings still support Schoology only. GPA/Carmen work must not merge to main, deploy, publish a stable/prerelease or create tags. Validated branch pushes are authorized. Preserve the existing app/vault/address/sessions/updater.
- The owner authorized two human sign-ins and a private transfer to Muse's VM. The human signed into two separate local Chromium processes through `--local-sign-in`; no passwords, Duo approvals or policy decisions were automated. This explicit human-capture exception is recorded in AGENTS. Automated tests and recovery remain headless CLI; do not use connected-browser/computer-use tools.
- No cron, recurring AI task or VM installation has been performed here. The owner will send the private ZIP and prompt to Muse, whose ordinary code-only cron is the intended experiment host. No model invocation on ticks. The app must remain independent of Muse.

## Exact persistent Mac locations — outside Git

```text
/Users/ashtonchang/Library/Application Support/GradeViewer/CarmenBenchmark/
  CURRENT.json
  README.txt
  cloudflare-reset-probe.json
  trial-20261101T234105Z/
    active/key
    active/session.json
    active/observations.jsonl
    idle/key
    idle/session.json
    capture-summary.json
    cloudflare-account.json
    muse-handoff/carmen-muse-experiment.zip
    muse-handoff/SEND-TO-MUSE.md
    muse-handoff/carmen-muse-experiment/
```

`CURRENT.json` is the private pointer to the current trial and artifact. Root/trial/profile directories have mode 700, keys/encrypted state/private metadata/ZIP mode 600. Source/wrapper files in the private extracted bundle are owner-readable/executable as needed. Check actual files/modes rather than assuming a key implies authentication.

**Both active and idle encrypted sessions exist and were verified for the same account**, with distinct authentication IDs and session-cookie copy guards passing. Those guards cannot mathematically prove independence after arbitrary manual edits; output deliberately says `independenceProven: false`. Actual captures used two fresh independent browser processes, not copied login state.

The per-profile `key` unwraps encrypted `session.json`; optional `pending.json` is not an activated verified account. Never print/paste these files or copy them into Git/fixtures/prompts. The ZIP includes both session envelopes and their wrapping keys, but no OSU password or Mac Cloudflare OAuth credential. The private Cloudflare account ID only binds the expected account; it does not authorize API access. Expiration refuses later use but does not erase files automatically.

Do not use temporary folders for retained captures. The earlier `/var/folders/rj/q4pkkt7x47xbs5501nyqlx6m0000gn/T/gradeviewer-owner-carmen-PJJV9Z/retry4/` and temporary transfer ZIP were missing on the evening return. The owner had not retained the old ZIP. The requested multi-hour original-session check therefore made no Carmen request; its expiry remains unknown. Do not infer why the files disappeared. The older persistent failed trial `trial-20261101T231441Z/active` contains only an unbound key and is not the current session.

## Actual account evidence

- Original initial/saved-session identity reads passed in 254/269 ms. Later identity passed in 349 ms after about 24½ minutes; at 2:11 PM EST it passed in 288 ms after a 37m19.126s gap.
- Original courses/total-scores reads passed at 2:17 PM in 409 ms and at 2:21 PM in 404 ms, explicitly confirming schema-valid `[]`. The side-chat claim that courses had never been requested was stale.
- Fresh local captures: active verified **2026-11-01T23:43:13.340Z (6:43 PM EST)**, identity/courses 385 ms; idle verified **23:43:13.975Z**, 338 ms. Both returned real valid empty course lists. Their browsers then closed. Initial human-inclusive browser intervals were about two minutes each, **local rather than Cloudflare usage**.
- At **2026-11-02T00:16:08.303Z (7:16 PM EST November 1)**, the active profile passed a post-browser-close HTTP-only/no-renew check in 385 ms after a 32m54.963s gap. Its rotated cookies were saved. This was pre-trial transport verification, not a running five-minute experiment. The idle profile has had **no extra request since capture**.
- Authorization ends no later than **2026-11-08T23:41:13.829Z (November 8, 6:41 PM EST)**, seven days from original capture setup. Do not extend it silently. A new session test can be separately authorized if more time is needed.
- The owner has no enrolled courses. This proves the authenticated grade-data request path, not enrolled-course parsing, complete snapshots, physical phones, Worker portability, actual expired-session renewal or steady-state MFA frequency.

## Cloudflare 429 investigation and browser budget

The current Mac Wrangler login is an OAuth login to one Cloudflare account; earlier browser logs matched that account. There was no Cloudflare account/API-token environment override. Changing ChatGPT accounts does not change these cached Cloudflare credentials.

Before UTC midnight, browser creation returned generic **Rate limit exceeded**, with no Retry-After. Account authentication/listing worked, zero browsers were active and Cloudflare reported Browser Run operational. GraphQL account analytics reported **654,396 ms (10m54s)** of browser time on November 1, above the documented Free allowance of 600,000 ms/day. Billing-plan read was unavailable (403), so the status tool reports `planVerified: false`; do not invent billing details or claim an exact limiter implementation.

After the UTC-day reset (**7 PM EST November 1**), account analytics reported zero for the new day before a blank-browser test. The same CLI/account then successfully launched and explicitly closed a browser at **2026-11-02T00:02:19.508Z**, with **2,836 ms lease wall time through close acknowledgement**. No OSU page was visited. Thus the 429 cleared at the documented daily reset, consistent with exhausting the effective Free allowance. This is not full SSO recovery timing or exact billed duration. A one-shot reset probe initially failed technically; the later successful result is retained in `cloudflare-reset-probe.json`. No probe process or retry loop is still running.

The owner requires browser usage WELL below ten minutes/day. The trial's routine unattended-recovery target is **at most 120 seconds per rolling 24 hours**, with account-wide telemetry checked too. `carmen-browser-budget.mjs` reports per-probe/runtime calendar-day and rolling-24h totals, max lease, missing costs and deferrals. Wall time is not exact billing, analytics may lag/be sampled, and initial/manual/other-account workloads also need headroom. VM timing does not prove Cloudflare usage. A budget pass alone does not prove infrequent manual login.

`carmen-experiment.mjs tick --observe-recovery` always logs no-renew HTTP measurement first, then separately invokes at most one recovery per tick. It spaces Cloudflare acquisitions, holds at the rolling routine target, avoids creation when account telemetry leaves under 120 seconds of Free headroom, and defers unknown budgets instead of repeatedly launching. Future PWA design must coalesce across devices, retain cached grades and display a clear temporary-refresh/retry state rather than raw 429s. That PWA UI/Worker feature is not implemented or deployed.

## Tooling and next steps

- `verify-carmen-session.mjs`: canonical same-account profile plus `GET /api/v1/courses?enrollment_type=student&include[]=total_scores&per_page=100`, strict JSON/schema, first-page counts/field-presence only. Valid `[]` is success. HTML/malformed/403/429/network/5xx are not expiry. Only a 401 or reviewed sign-in redirect confirms rejection. No names/identity/grades/secrets in output.
- `carmen-login-lab.mjs`: `start`/`reconnect` human captures, default 48h or explicit `--week`; `check --no-renew` HTTP only; `renew` requires a persisted rejection and claims one attempt before launch. Stages separate Carmen rejection, OSU reached/silent continuation/credentials, Duo page/challenge, policy/other human steps and technical/unknown results. A credential screen does not prove an exact SSO timeout.
- `carmen-benchmark.mjs`: active every five minutes; idle 2/4/8/16/24/48h from each successful verification. Total waits 102h, max quiet gap 48h. This is not a week without requests; output says `fullWeekQuietTest: false`. Actual last-success-to-failure timestamps bound expiry; network errors/missed ticks widen uncertainty. Repeated recovery episodes are required for human-action frequency.
- `carmen-experiment.mjs`: portable init/tick/status/budget runner. Default Cloudflare recovery requires Muse's own authorized Wrangler login to the owner's account; Mac OAuth is not transferred. Pinned Wrangler supports `login --device`, useful on the remote VM. Init verifies the account binding, performs one controlled no-renew baseline for each profile on the VM, then starts its timers. Repeated successful initialization is refused before resetting a baseline. This initial migration baseline is not an idle-expiry observation.
- `carmen-cloudflare-status.mjs PRIVATE_ROOT --consent`: read-only account usage/listing. Add `--probe-launch` only for a deliberate one-shot blank browser, which is explicitly closed. No Carmen requests. Do not use it as a repeated launch loop.

**Immediate next action:** give Muse the private ZIP and [copy/paste prompt](CARMEN_MUSE_HANDOFF.md). It includes exact install, owner Cloudflare device-login if needed, initial baseline, cron, status and budget commands. Actual Linux/Muse installation has not been tested here. No experiment cron or coordinator has been initialized on the Mac. Do not claim the seven-day experiment is already running.

After VM takeover, **do not request Carmen using the Mac copies**: that could reset/contaminate the shared server sessions or stale rotated state. Read sanitized Muse observations instead. A first Cloudflare human prompt from Mac-captured state can reflect device/host migration; do not call it an exact SSO timeout or stable MFA frequency. Do not automatically type passwords, approve Duo or accept policies. Keep notifications quiet on ordinary success and report meaningful pauses, cleanup/budget failures and completion.

The [support email](CARMEN_SUPPORT_EMAIL.md) to `carmen@osu.edu` remains unsent. OSU documents two-hour Carmen inactivity and separate 24-hour BuckeyePass browser trust, but exact SSO maxima/API activity effects are not established. The eventual Canvas settings option remains contingent on real parsing, user interaction, renewal reliability and budget evidence. No release, main merge, production deployment or paid upgrade is authorized.
