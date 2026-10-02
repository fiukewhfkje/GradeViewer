# Project status — October 2, 2026

GradeViewer is a native local iPhone app. The GitHub remote is private; friends need repository access and their own Apple/school accounts. No server, Muse watcher, App Store release, or TestFlight deployment exists. Use `git log -1` for the delivered revision.

## Current behavior

- SwiftUI, SwiftData, Keychain, WebKit, URLSession, and the canonical local GradeCore package. No paid tier, ads, analytics, backend, WidgetKit extension, App Group, shared widget cache, widget models/preview, or widget URL scheme.
- The committed project uses neutral bundle/signing defaults. An ignored `Signing.local.xcconfig` retains the original checkout's existing team and bundle ID, so installing over the existing app preserves its data and Keychain scope. Other clones use their own unique ID/team. Keychain service follows the app bundle ID.
- Schoology rechecks `users/me` before student reads, binds even an empty successful snapshot to that identity, and rejects unexpected owner changes. Verified enrollment aliases, combined grade reads, bounded concurrency, metadata expiry and title-lookup backoff remain. Catalog/wrapper/detail/folder metadata now share conflict validation.
- Campus uses normal district Student login/SSO. Reusable Campus and visited identity-provider cookies stay in Keychain; grade requests remain Campus-only. SSO entries come from observed navigation or a saved session, with no Dublin-specific fallback. Existing saved sessions retain their format and entry. A district change requires disconnect; same-district student identity binding remains a limit.
- Rejected sessions can attempt one bounded normal browser SAML renewal, verified by the complete grade fetch. Eventual credentials/MFA remain user actions. Cookie scope/security flags/rotation/deletion, legacy decoding, cancellation and sign-in-loop suppression remain covered.
- New connections preserve active credentials if snapshot serialization/local saving fails. Pending setup remains available for retry; a successful reconnect clears its old rate-limit deadline. Credentials/session cookies are never stored in source or shared summaries.
- Schoology short HTTP 429 cooldowns pause queued reads for Retry-After and retry each affected GET at most once. Waits over 30 seconds or repeated throttles return to provider backoff; cancellation stops waiting. This preserves completed initial-fetch work through a brief rate limit.
- Matching requires mutual unique period candidates and a consistent one-to-one physical section relationship across all evidenced periods. Ambiguous/conflicting sections, known teacher/date/kind conflicts and repeated/placeholder assignment evidence cannot produce a merge. Missing points or placeholder titles cannot deduplicate assignments. Category fallback rejects incompatible known periods.
- Equivalent quarter labels stay visible; known disjoint dates cannot share a selected home term merely by having the same label. Quarter districts retain the requested Q1–Q4 selector. Semester-only districts use their actual semesters. Exam assignments remain read-only under the uniquely associated quarter; reported semester totals and calculator provenance remain separate.
- Launch/real background return and pull-to-refresh coalesce concurrent provider reads. The active-only minute check remains. Each provider publishes after a complete successful snapshot; failed providers retain their previous data. Foreground grades wait for both connected providers to provide fresh data; Profile/retry remain usable.
- Existing clean course list/detail, discrete grade/date chart tooltip, separate observed/calculated history, timestamp ordering, system/light/dark appearance, local edit/drop/reset/add and final calculator remain. Presentation variants never become duplicate calculator contributions.

## Audit validation

### Repository follow-up — October 2, 2026

A fresh clone of the GitHub default branch passed all **101 GradeCore XCTest
cases** with `swift test`. Selected parsing, calculation, assignment ordering,
cookie, and grade-curve paths were reviewed for small, low risk improvements;
no additional runtime fix was established in this pass. Only this status record
and TODO were updated. Hosted/UI tests, device installation, and authenticated
provider requests were not repeated. The detailed October 1 results below are
historical evidence, not new October 2 validation.

### October 1 implementation audit

- `swift test`: **101 GradeCore tests passed**, covering the matching regressions, identity/empty-snapshot checks, malformed pagination, URL scope/default ports, parser bounds, shared metadata conflicts and bounded throttle recovery, plus the previous provider/calculation/history tests.
- Hosted XCTest: **31 tests passed**, including disposable Keychain round trips, legacy Campus/SSO restoration, failed connection activation rollback, refresh failure retention and local persistence.
- UI: **22 distinct cases verified across the full run and focused reruns**. The first full run exposed an undated legacy-period assignment-view regression; it was fixed and the failing case passed on iPhone 13 mini, along with period/settings regressions. The final equal-width period pills also passed their focused UI test. The 18-screen light/dark matrix passed; small-phone and main-screen screenshots were inspected.
- A clean copy of the final source with no personal signing file built and passed **31 hosted tests** under the neutral app identity and ad-hoc simulator signing.
- Signed original-iPhone update installed over the existing app with its original bundle/team, no App Group entitlement and no embedded extension. Launch retained both Keychain connections. An observed Schoology 429 included Retry-After: 10; a subsequent refresh succeeded for both providers, with no storage/refresh errors, five home cards and five matched semesters. The final app was then launched normally without verification arguments. Another person's account/district/device is not yet live-verified.
- A targeted scan of **199 historical Git blobs** found no recognized private-key/token/OAuth-header patterns or sensitive-file paths. Current fixtures are synthetic; no personal signing file, provider credentials, cookies, database, or response capture is tracked. The scan is limited to its recognized patterns.

## Previous student-device evidence

Both authenticated providers succeeded on the original student's iPhone, and Keychain connections survived normal reinstall/relaunch. Protected reports previously showed five home cards, a semester association for each, and calculated endpoints reproducing reported grades. Six Biology title mismatches were repaired. One other detail still returned HTTP 403 and was absent from accessible catalogs/folders; its valid score and neutral title were preserved. No server-side cause is established.

After the student captured SSO through normal login, a fresh browser with zero Campus cookies and 19 saved IdP cookies obtained eight Campus cookies and fetched the summary/all six details with HTTP 200. This verified short-term normal SAML renewal on that phone, not indefinite lifetime. The earlier rejected session and its cause remain distinct from that later success. See RESEARCH.md and docs/PERFORMANCE_REPORT.md for detailed evidence labels and measurements.

## Remaining limits

- Campus resources have public-client/live evidence, not a supported public student API contract. One district/account has live verification; other district schemas and embedded SSO policies may differ.
- Campus same-district student identity binding is not established; disconnect before switching students. Cross-provider accounts must belong to the same student. Schoology's binding cannot prove that a Campus login belongs to the same person.
- Provider metadata can be incomplete or ambiguous. Universal 100% automatic matching is not defensible; unresolved sources stay separate. One inaccessible assignment title remains.
- Observe natural session expiration, genuine new grades, completed prior-quarter data, timezone-less dates, rubric/rounding and teacher overrides when real evidence warrants it.
- Free Personal Team installs expire seven days after provisioning and require rebuild/reinstall. Keep an existing installation's team/bundle ID and install over it. Developer Mode/trust and another person's physical installation require their own device/account actions.
