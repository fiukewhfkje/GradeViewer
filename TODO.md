# Next work

## Completed

- [x] Native local app, canonical GradeCore, protected SwiftData cache, Keychain credentials and App Group widget summary.
- [x] Both authenticated provider pipelines, Campus section detail IDs, and Schoology enrollment/grade-owner aliases.
- [x] Every-foreground and manual refresh, active-only one-minute checks, coalescing, parallel provider publication, and bounded section concurrency.
- [x] Latest linked scored timestamps on home/detail, Schoology-only recent work, deterministic ordering and presentation deduplication.
- [x] Preserve cookie rotation/deletions in Keychain after failed and successful Campus attempts; one saved-portal recovery attempt and normal reconnect.
- [x] Fix numeric assignment titles through graded-node/wrapper identities and scoped metadata reads; six Biology rows verified repaired.
- [x] Explicit period matching and physical section relationships, one home card per class, semester/quarter/exam pills only in View All Assignments, and scoped assignment lists. Separate period menu removed at the user's request.
- [x] Semester overall above quarter assignments; semester scenario weights require a reproduced reported total; presentation unions never become calculator input.
- [x] Combined Schoology user-grade reads for repeat refreshes, alias fallback, period metadata cache expiry/new-period renewal, and Retry-After handling.
- [x] Reported-grade anchor for calculated graph points; no-op scenario rounding fix; observed history and discrete grade/date tooltip preserved.
- [x] 24-hour checkmark and month labels over 30 days, according to the user’s final preference.
- [x] Foreground loading/failure gate that retains saved data internally without flashing old grades; Profile and dismissal remain available.
- [x] Existing native UI, appearance, local edit/drop/reset, final calculator, original icon, and widget tap routing.

## Final delivery in progress

- [ ] Finish hosted/UI loading-gate validation, final signed iPhone install/launch, merge/push, and clean Git checkout.

## Evidence-driven follow-up

- [ ] One other Schoology assignment detail returns HTTP 403. Preserve its score and neutral title; recover only if the provider supplies accessible metadata.
- [ ] Observe naturally populated completed previous-quarter/semester grades and genuine new grade changes.
- [ ] Calibrate actual timezone-less dates, rubric scales, rounding and teacher overrides when a discrepancy is demonstrated.
- [ ] Verify offline/expiry behavior and automatic account identity binding before account switching without disconnect.
- [ ] Observe physical Home Screen widget placement, reload, and taps.
- [ ] Renew development provisioning after October 6, 2026 when needed; wider distribution requires a separate signing/release decision.
- [ ] Measure further provider latency/rate limits only when a real performance issue justifies it. No sustained Muse watcher was authorized or deployed.

No provider writes, notification server, background polling, paid tier, planner, analytics, or fabricated grades/dates.
