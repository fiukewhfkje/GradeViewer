# Carmen diagnostic handoff — November 1, 2026, evening

This is the starting point for a fresh thread. Read `AGENTS.md`, then this file and [the benchmark protocol](CARMEN_SESSION_BENCHMARK.md). Inspect the current Git/filesystem state before treating a saved status as current.

## Scope and delivery

- Work in `/Users/ashtonchang/Documents/GradeViewer`, branch `codex/investigate-gpa-carmen`, origin `https://github.com/fiukewhfkje/GradeViewer.git`. The prior committed benchmark baseline is `1e775cb`; inspect `git log` for subsequent work.
- The production PWA/Worker still supports Schoology only. Carmen is isolated operator tooling, not an installed integration. GPA research is also development-only.
- The owner forbids production deployment, main merges, tags, stable releases and prereleases. Validated development-branch commits/pushes are authorized. Preserve the existing Worker, vault, address, credentials, sessions and updater.
- Do not install a cron or create recurring AI jobs. The owner wants exact commands for Muse’s separate VM, with ordinary code-only ticks and no model invocation. No cron/AI monitor is running here.
- Use headless CLI browsers and synthetic fixtures. The human signs in themselves through the private Cloudflare handoff; never automate passwords, Duo approval or policy acceptance, and never expose credentials or browser URLs.

## Private storage on the owner’s Mac

Persistent root, **outside Git**:

```text
/Users/ashtonchang/Library/Application Support/GradeViewer/CarmenBenchmark/
```

The current attempted trial is:

```text
/Users/ashtonchang/Library/Application Support/GradeViewer/CarmenBenchmark/trial-20261101T231441Z/
```

**Actual state when this handoff was written:** the trial and `active/` directories exist with mode 700; `active/key` exists with mode 600. `active/session.json` does **not** exist. `idle/` does **not** exist. This was a failed fresh-browser launch, not an authenticated capture. A key alone is not a session. No new transfer ZIP or usable two-profile benchmark exists.

The CLI’s private per-profile files are `key` (wrapping key), `session.json` (encrypted scoped browser state and account binding), optional encrypted `pending.json`, and sanitized `observations.jsonl`. A transient `login.html` contains a sensitive browser handoff link and is removed after the attempt; never print its contents or URL. Coordinator state/logs live in a separate owner-only benchmark directory. Never copy these files into Git, fixtures, prompts or public artifacts. Expiration refuses later use but does not delete private files automatically.

Use persistent private storage for multi-day experiments. On a Linux VM, a suitable root is `$HOME/.local/share/gradeviewer-carmen` with mode 700. Do not use OS temporary folders for retained account state. Each profile needs a separate human-completed fresh sign-in; transferring a profile between hosts is not a second authentication and can itself change Duo/device behavior.

## What happened to the original session

The original state was stored under:

```text
/var/folders/rj/q4pkkt7x47xbs5501nyqlx6m0000gn/T/gradeviewer-owner-carmen-PJJV9Z/retry4/
```

An old private archive had been created under `T/gradeviewer-muse-transfer-gduuoivt/carmen-muse-vm.zip`. Both that archive and the original directory were missing on the evening return. A filename-only search found no matching accessible local copy in Downloads/Documents/the temporary root; some OS-protected directories were inaccessible. The owner confirmed they did not retain the ZIP. Do not claim a complete forensic search, a cause of file disappearance, or a measured OSU expiry. No password was saved, so the old session cannot be automatically recovered without a retained copy.

The owner explicitly permits fresh sign-ins for two isolated profiles and is willing to complete OSU/Duo when a window is available. A fresh capture at about **6:14 PM EST** used the persistent trial above but failed at Cloudflare browser launch with sanitized **429**, before OSU navigation. Do not claim a fresh authenticated session or Duo outcome. Further launches have not been scheduled. The precise quota cause/reset ETA is unknown; do not promise a fixed retry time from the generic 429.

## Verified evidence and unknowns

- The original human-completed sign-in verified identity in 254 ms; a later saved-session HTTP identity read took 269 ms without Chromium.
- A later self-profile read passed in 349 ms after about 24½ minutes. At **2:11 PM EST**, identity passed in 288 ms after a 37m19.126s gap.
- At **2:17 PM EST**, identity plus the documented courses/total-scores endpoint passed in 409 ms. At **2:21 PM EST** (`2026-11-01T19:21:01.940Z`), it passed again in 404 ms and explicitly confirmed schema-valid `[]`. Thus the side-chat claim that courses had never been requested is stale.
- The evening original-session check failed locally because its state was missing; **no Carmen request occurred**. There is no multi-hour survival/expiry result.
- Earlier cloud renewal attempts and the fresh evening capture were rejected by Cloudflare before OSU. We have not observed a successful real expired-session renewal, a real renewal-time credential prompt or a renewal-time Duo challenge. Synthetic classifications are not account evidence.
- The owner has no enrolled courses. A valid empty course list verifies authenticated access to the grade-data route; per-course grade parsing, complete snapshots, Worker portability, physical-phone behavior and end-to-end Carmen PWA timing remain unverified.
- OSU documents a two-hour Carmen inactivity logout and separate 24-hour BuckeyePass browser trust. Neither establishes the exact SSO maximum, whether API reads reset inactivity, or how often Duo will actually be required.
- [The support email](CARMEN_SUPPORT_EMAIL.md) is ready for the owner to send to the officially listed `carmen@osu.edu`. It has not been sent.

## Current tooling contract

- `web/scripts/verify-carmen-session.mjs` is the canonical schema/error probe. It checks account identity, then `GET /api/v1/courses?enrollment_type=student&include[]=total_scores&per_page=100`. Output contains only fixed classifications, first-page course count, field-presence/empty/pagination booleans and durations. No identity details, names, scores, raw responses or sensitive URLs.
- `web/scripts/carmen-login-lab.mjs` owns direct sign-in, encrypted state, HTTP checks and browser recovery. `check --no-renew` is measurement-only. `renew` requires a persisted confirmed auth rejection and claims at most one attempt before launch. `reconnect` is human controlled. Missing private state is a local setup failure, never expiry.
- `web/scripts/carmen-benchmark.mjs` runs the active and idle schedules. Every scheduled check is HTTP-only with `--no-renew`. A confirmed failure pauses the probe; **only a separate `renew` command** can try headless recovery. Inconclusive/technical failures also pause rather than retrying every minute.
- The active schedule is five minutes, with actual timestamps/bounds if ticks are late. Idle waits are **2, 4, 8, 16, 24, then 48 hours**, each from the previous successful check, totaling 102 hours. They are not a full quiet week. A later full-week-with-no-requests experiment needs separate explicit retention planning; do not silently exceed the seven-day-from-capture cap. Output says `fullWeekQuietTest: false`.
- Profile provenance/cookie-copy guards reject obvious reuse, but cannot prove independence against manually edited files. Output explicitly says `independenceProven: false`. Use two genuinely separate sign-ins.
- Renewal stages distinguish a confirmed Carmen rejection; browser launch; OSU reached/silent continuation/stable credential prompt; Duo page versus observed challenge; policy/other human steps; verified renewal success; and technical/unknown failures. A password screen is not proof of an exact SSO timeout. A Duo URL or generic failure is not proof Duo was required. Stable prompt checks do not fill/click controls.
- The default local safety limit is 48 hours. Explicit `start --week`/`authorize --week` permits up to seven days from capture; this is not Carmen’s lifetime and does not resurrect already-expired local state. `init --hours=N` bounds a shorter experiment (1–168 hours).

## Resume commands and next actions

1. Check Git status/current tests and the private paths above without printing file contents. Preserve unrelated work. Missing session files mean fresh capture is required.
2. When Cloudflare allows acquisition and the owner is ready, choose **new, nonexistent** profile directory names under the persistent root. The failed `active/` path cannot be reused with `start`; existing directories are deliberately rejected. From `web/`:

   ```sh
   node scripts/carmen-login-lab.mjs start "/ABS/PERSISTENT/TRIAL/active-next" --consent --grades --week
   node scripts/carmen-login-lab.mjs start "/ABS/PERSISTENT/TRIAL/idle-next" --consent --grades --week
   ```

   Run these sequentially, respecting Cloudflare cooldowns. The owner opens the printed private HTML file, completes sign-in/Duo/policy screens and selects Done. Do not begin another capture while the first is waiting. Close each owned browser explicitly (the CLI does this). On 429, stop and report the technical blocker; do not spin on launch.
3. Do not touch the idle profile after successful capture except at its scheduled checks. Initialize only after both independently authenticated profiles verify the course path. The [protocol](CARMEN_SESSION_BENCHMARK.md) gives exact initialization, no-renew checks, one separate renewal, verified resume and VM cron commands. No scheduler is installed by preparing these instructions.
4. A VM run uses `--local-browser` at coordinator initialization and needs its own headless Chromium/Node 24+. Never transfer the Mac’s Cloudflare login. Device/IP migration is an experimental variable; VM timings do not establish Cloudflare timings.
5. Validate changes with the relevant operator tests, build/type check and source-package checks from `web/`; update PROJECT_STATUS/TODO/validation with actual results. Commit/push only this development branch. No releases or deployment.

The immediate blockers are fresh authenticated captures and Cloudflare acquisition, not a known OSU rejection. The owner’s desired eventual PWA behavior remains cached grades immediately, fast HTTP refreshes, automatic silent SSO recovery when possible, and human reconnect only when the observed flow requires it. This measurement protocol does not implement that PWA feature.
