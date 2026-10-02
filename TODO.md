# Next work

## Completed

- [x] Native local app, canonical GradeCore, protected SwiftData grade/history cache and device Keychain credentials.
- [x] Both provider pipelines, read-only transport, Schoology enrollment/grade-owner alias handling and Campus section detail IDs.
- [x] Concurrent/coalesced foreground and manual refresh, bounded section reads, failure retention, foreground fresh-data gate and active-only minute checks.
- [x] Conservative course/assignment matching, period hierarchy, reported Campus display authority, local calculation provenance, quarter exam footer and shared What-If behavior.
- [x] Campus cookie persistence/rotation/deletion, normal browser SSO capture/renewal, saved/legacy session decoding and concise connection pages.
- [x] Explicitly remove widget target, WidgetKit imports, App Group entitlements/cache, shared models/rendering, preview route, URL scheme and widget-only tests.
- [x] Portable signing defaults and ignored local override preserving the original app identity; concise README for cloning, device setup, personal school credentials and Apple limits.
- [x] Audit tracked files/history for recognized credential patterns and sensitive files; keep source fixtures synthetic and personal signing ignored.
- [x] Fix physical section links changing across quarters, category borrowing from incompatible periods, mappings overriding known conflicts, placeholder/repeated match evidence and missing-point assignment merging.
- [x] Verify Schoology credential owner on refresh and empty snapshots, roll back credentials after failed local connection commit, clear stale throttle deadlines on reconnect, harden pagination/path scopes/parser bounds and unify metadata conflict checks.
- [x] Reproduce short Schoology throttling in a fixture; pause queued reads for server cooldown, bound retries and verify cancellation. Confirm both saved providers refresh on the original phone afterward.
- [x] Preserve quarter-only UI for existing quarter districts; support equivalent labels and semester-only provider periods.
- [x] Record 101 core/31 hosted results, all 22 UI cases across full/focused runs, inspected light/dark/small-phone layouts, final clean-copy validation and signed original-device refresh/relaunch.
- [x] Trace the performance pass and later changes; reproduce optional-title throttles rejecting fresh grades and delaying other sections, then move recovery after required reads and preserve server cooldowns across relaunch.
- [x] Reduce unchanged seven-section repeat requests from 24 to 3 in fixtures with five-minute account/section-bound metadata reuse; verify changed grades, manual bypass, fixed expiry, incomplete-cache repair and valid empty/malformed responses.
- [x] Validate 109 core/32 hosted/four focused UI tests, a separate neutral-signing clone's 32 hosted tests, and the prepared signed device build locally.

## Evidence-driven follow-up

- [ ] When the user reconnects the original phone by USB, install the prepared local revision over the existing app with the same bundle/team, then measure warm launch, background return and expired-metadata/title recovery. Phone verification is intentionally deferred; do not push the local work during this hold.
- [ ] Observe natural Campus/IdP expiry. Short-term renewal is verified; required credentials/MFA cannot be bypassed. Do not invent a TTL.
- [ ] Establish a legitimate Campus student identity contract before supporting account switches without disconnect or claiming cross-provider identity verification.
- [ ] Verify another student's own district/account and physical installation; fixture/clean-clone tests do not establish live district compatibility.
- [ ] Recover the remaining neutral assignment title only if the provider makes matching metadata accessible; do not infer a deleted assignment or teacher setting.
- [ ] Observe naturally populated completed periods and genuine new grades; calibrate timezone-less dates, rubric scales, rounding or teacher overrides only with demonstrated discrepancies.
- [ ] Rebuild/reinstall when local development provisioning expires. Wider distribution needs a separate App Store/TestFlight signing/release decision.
- [ ] Measure further provider latency/rate limits only when a new observed issue justifies it; the measured refresh fixes are documented in docs/PERFORMANCE_REPORT.md.

No widgets, grade-write endpoints, notification server, background polling, paid tier, planner, analytics or invented grades/dates. No Muse watcher was implemented or deployed.
