# Next work

## Completed

- [x] Native local app, canonical GradeCore, protected SwiftData cache, Keychain credentials and App Group widget summary.
- [x] Both authenticated provider pipelines, Campus section detail IDs, and Schoology enrollment/grade-owner aliases.
- [x] Launch/real foreground and manual refresh, temporary-inactivity suppression, coalescing, parallel provider publication, and bounded section concurrency. Existing active-only one-minute checks preserved; timer cancels on inactivity/background.
- [x] Latest linked scored timestamps on home/detail, Schoology-only recent work, deterministic ordering and presentation deduplication.
- [x] Preserve cookie rotation/deletions in Keychain after failed and successful Campus attempts; one saved-portal recovery attempt and normal reconnect.
- [x] Fix numeric assignment titles through graded-node/wrapper identities and scoped metadata reads; six Biology rows verified repaired.
- [x] Explicit period matching and physical section relationships, one home card per class, quarter-only pills in View All Assignments, and scoped assignment lists. Semester/exam views removed; exam grades/assignments appear at the bottom of their associated closing quarter (Q2 for S1).
- [x] Semester overall above quarter assignments; semester scenario weights require a reproduced reported total; presentation unions never become calculator input.
- [x] Combined Schoology user-grade reads for repeat refreshes, alias fallback, period metadata cache expiry/new-period renewal, and Retry-After handling.
- [x] Reported-grade anchor for calculated graph points; no-op scenario rounding fix; observed history and discrete grade/date tooltip preserved.
- [x] 24-hour checkmark and month labels over 30 days, according to the user’s final preference.
- [x] Foreground loading/failure gate that retains saved data internally without flashing old grades; Profile and dismissal remain available.
- [x] Existing native UI, appearance, local edit/drop/reset, final calculator, original icon, and widget tap routing.

## Final delivery

- [x] Hosted/UI loading-gate and final assignment-pill validation, signed iPhone install/launch, both-provider fresh-data verification, merge/push to main, and merged-branch cleanup. Only the primary Git checkout remains.

## Evidence-driven follow-up

- [x] Diagnose retained data versus Campus authentication: 46 cached records survive, restored cookies accompany repeated HTTP 401, and portal HTML 200 does not restore grades. Add explicit cookie transmission, preserved HttpOnly metadata, masked local Cookie-header import, safe count/status diagnostics, Profile failure status and readable dark Retry. Validate 81 core, 22 hosted and 2 focused UI tests; install signed build.
- [x] Complete fresh SSO and check repeated immediate process relaunches: user confirmed grades, then two relaunches, signed reinstall, and the next automatic active check refreshed both providers successfully. The prior session's rejection is verified; the reason it became invalid is not established.
- [x] Preserve the visited IdP session in device Keychain and use Campus’s documented normal SAML entry for one bounded automatic renewal. Fix shared Campus-page return detection, keep grade transport Campus-only, preserve cookie security metadata, and suppress sign-in loops. User captured SSO; a fresh IdP-only device browser obtained eight Campus cookies and fetched summary/all six details, then normal relaunch restored them. Validate 81 core and 31 hosted tests; signed app/widget build/install passed.
- [x] Simplify Settings to connections and Appearance; hide configured fields on connected provider pages, cookie/SSO/HTTP internals, optional token controls, version boilerplate and widget reload. Keep concise account actions and confirmed Disconnect on provider pages. Persistence and renewal remain automatic. Both focused cleanup UI tests pass; overview/setup/connected screenshots were inspected and the signed build installed.
- [ ] Observe long-term IdP/Campus lifetime and a natural expiration. Short-term automatic SAML renewal is verified on the phone; district-forced credentials/MFA still require the user. Cookie import remains optional recovery, with unverified long-term SSO effectiveness. Do not infer a TTL or fabricate a renewal endpoint.

- [x] Trace the narrow title 403 through scoped detail, assignment catalog, and all 16 accessible folders. Add conservative list/folder recovery and 15-minute unsuccessful-lookup backoff, preserving fresh scores.
- [ ] The remaining title is still denied/absent from provider metadata. Recover only if the provider makes it accessible; do not infer deletion/settings or fabricate a name.
- [ ] Observe naturally populated completed previous-quarter/semester grades and genuine new grade changes.
- [ ] Calibrate actual timezone-less dates, rubric scales, rounding and teacher overrides when a discrepancy is demonstrated.
- [ ] Verify offline/expiry behavior and automatic account identity binding before account switching without disconnect.
- [ ] Observe physical Home Screen widget placement, reload, and taps.
- [ ] Renew development provisioning after October 6, 2026 when needed; wider distribution requires a separate signing/release decision.
- [x] Measure the slow refresh and UI freeze: index repeated matching evidence, reuse date/regex parsers, move normalization/encoding off the UI thread, parallelize independent enrollment/grade reads, bind verified identity to Keychain credentials, and validate responsiveness/local-edit preservation. See docs/PERFORMANCE_REPORT.md.
- [ ] Measure further provider latency/rate limits when a new observed issue justifies it. No sustained Muse watcher was authorized or deployed.

No grade writes, notification server, background polling, paid tier, planner, analytics, or fabricated grades/dates.
