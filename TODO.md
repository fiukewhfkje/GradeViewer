# Next work

## Required user actions

- [x] Trust the installed development profile on the iPhone and confirm launch. User confirmed launch and devicectl also launched it successfully.
- [ ] Enter Schoology credentials and the district Campus Student URL/login locally in GradeViewer Settings. Never collect them in chat or Git.

## Highest-value next session

- [ ] Verify one actual Schoology account: user redirect, complete section pagination, student grade permissions, grade_items kinds, categories, overall grades, and current terms. Correct fixtures to redacted structural examples only after observing the real schema.
- [ ] Verify Campus normal login/SSO and the currently authenticated summary/detail resources. Validate opaque course/task identifiers and complete data before enabling any new endpoint. If embedded SSO is rejected, research the district's supported flow instead of storing passwords or bypassing auth.
- [ ] Compare app grades with both native portals, including a real zero, extra credit, letter/rubric values, category weighting, and dates. Calibrate district timezone and rounding. Verify manual matches for differently named courses.
- [ ] Verify session survival on relaunch, successful cookie rotation, and reconnect after observed expiry. Bind cached data to verified provider account identity before supporting account switching without disconnect.
- [ ] Validate Home Screen widget rendering, actual reloads, stale summary, hiding/order changes, and tapping it on the trusted physical device. Shared content and App Group transport are already tested; Home Screen placement is not.
- [ ] Measure cached physical-device launch/scrolling after real data is available. Existing launch metric is debug simulator fixture performance only.
- [ ] Update MUSE_WATCHER_REPORT.md with student-verified paths, actual permissions, redacted session behavior, response bytes/latency, and responsible trial cadence. Its current event-feed candidates are not proof of 2026 district support. Do not implement/deploy the watcher here.

## Later, only when supported by evidence

- [ ] Add change-aware Schoology app refresh after real permissions and delta semantics are verified; retain full-snapshot reconciliation for recovery. The initial app refreshes full snapshots only on open/manual request.
- [ ] Add any demonstrated district-specific calculation rules with focused regression tests. Keep reported source grades authoritative when rules cannot reproduce them.
- [ ] Broaden Dynamic Type/VoiceOver QA if a real accessibility/layout issue appears. Standard text sizing and chart accessibility are already used.

Do not add notification servers, continuous app polling, accounts, premium UI, or other scope expansion.
