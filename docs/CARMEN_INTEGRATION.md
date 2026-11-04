# Carmen development integration — November 4, 2026

This implementation is held on `codex/investigate-gpa-carmen`. It is not deployed, released or merged to main. Main contains the owner's selected Infinite Campus testing feature. No Carmen student records are committed.

## Connection and refresh

Settings has a CarmenCanvas connection card with the same polished sign-in/actions/switches as IC. Carmen can be the only provider; Schoology keys are optional. The owner completes OSU login/MFA in the existing bounded Cloudflare Live View window, returns to GradeViewer and chooses Finish connecting. GradeViewer never enters or stores a university password. The Worker encrypts scoped session cookies and sign-in browser state using the existing app password. Only Canvas cookies enter HTTP grade requests; identity-provider cookies remain in encrypted browser state. HTTP cookie rotations are retained for later requests and browser restoration.

The provider origin is fixed to `https://osu.instructure.com`. All provider requests are GETs, follow a fixed route/query allowlist, and never forward cookies through HTTP redirects. Same-account self-profile verification precedes discovery. RFC Link pagination uses `http-link-header` (MIT), restricted to the original same-origin collection and authorization/filter parameters, at most 20 pages, 45 requests and 4 MB per operation. At most 20 courses sync, with three detail jobs in flight. Oversized, incomplete, ambiguous or invalid responses fail without replacing local grades. A genuine empty course list only clears Carmen after successful identity verification and schema validation.

Canvas courses receive provider/account-scoped identities and share canonical course, assignment, history and calculator structures. Schoology, selected IC and Carmen snapshots replace only their own partition. Provider errors retain saved data; one provider does not prevent another from refreshing. Existing Schoology-first local account identities stay unchanged. A Carmen-first connection creates a stable workspace identity before Schoology is added. Disconnecting Schoology while Carmen is connected removes Schoology/IC locally while retaining Carmen; explicit Carmen disconnect removes Carmen's grades, scenarios and GPA preferences. Signing out locks the app; it does not disconnect providers.

## Documented normalization

- [Courses](https://developerdocs.instructure.com/services/canvas/resources/courses): student-only discovery with total scores, actual enrollment term and teacher display metadata. No inferred assignment IDs, scores, dates, academic credits or cross-provider course linking.
- [Enrollments](https://developerdocs.instructure.com/services/canvas/resources/enrollments): explicit verified-user filter. Omitting grading_period_id requests the whole-course total. Active courses use current_score/current_grade, not final_score (which can count ungraded work as zero). Concluded courses use final fields; an explicit override takes priority. Unposted teacher totals are ignored.
- [Assignment groups](https://developerdocs.instructure.com/services/canvas/resources/assignment_groups) and [submissions](https://developerdocs.instructure.com/services/canvas/resources/submissions): nested assignments/submissions, group weights, points possible and visible numeric scores. Late deductions are already reflected in score and are never subtracted again. Missing is a flag, not an invented zero. Excused, omitted, unpublished and non-graded work is excluded. Explicitly unposted submissions do not expose numeric scores. Only actual due/graded dates enter the normalized model.
- Standard points and weighted-group math uses the existing calculator. Canvas drop rules differ from Schoology's percent-based algorithm, so nonzero drops, grading-period rules, overrides, unsupported types and nonstandard weight totals withhold local math while retaining reported totals. The existing semester what-if reliability guard still requires a reproducible baseline.
- [Pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination): bounded RFC Link handling; unsafe origins, collection changes, changed filters and cycles are rejected.

These are documentation-derived decisions exercised with synthetic fixtures. Actual OSU enrolled-course responses, student endpoint permissions, institution-specific grading rules and cloud SSO renewal remain acceptance work. No enrolled-account evidence is claimed.

## GPA

A separate Ohio State semester GPA card uses the [Registrar's letter points](https://registrar.osu.edu/student-hub/transcripts-and-verifications/transcript-key/). A- is 3.7 and B+ is 3.3; the Dublin high-school scale/settings remain independent. No honors/AP bonus is applied to Carmen. Academic terms use actual Canvas enrollment-term IDs, so per-course date variations do not split one semester. Default/unknown terms do not invent a semester.

The owner enters credits from the schedule. Percent-only Carmen totals do not imply a universal Ohio State letter cutoff; a missing letter stays incomplete unless the user enters a clearly labeled local GPA letter override. What-if letters are temporary. All GPA settings and predictions stay in IndexedDB and never write to Canvas. This is an estimate, not an official transcript calculation.

## Session checks and reconnect

The owner requested a 90-minute session check. Successful human connection enables it, with an immediate Settings switch to disable it. The existing Durable Object alarm makes only a self-profile HTTP read, retains cookie rotation and verifies the same account. It never opens a browser, reads grades, handles MFA or invents refreshed-grade timestamps. Foreground verification postpones the next background check. Rate limits are honored; transient failures have bounded retries, and rejected/denied/changed-account access pauses checks. No external scheduler or model runs on ticks.

Foreground authentication rejection may try one bounded silent SSO recovery using retained state and shared IC/Carmen browser budgets. If SSO needs human action, Reconnect CarmenCanvas opens normal login again, retaining local grades and preferences. No browser keepalive loop runs while the app is closed. Background HTTP activity may or may not extend OSU's session; that must be measured separately.

The owner's service-desk email reports a two-hour Carmen idle setting but explicitly says activity/reset behavior across Canvas, the browser, Duo and Shibboleth is unpredictable. It does not endorse this integration or provide student developer tokens. The UI discloses experimental/unsupported status. No ticket, email address or personal correspondence is committed.

## Actual account evidence

At the owner's explicit request, one saved ACTIVE Mac capture was checked once on November 4 at 15:16:43.731Z, HTTP-only with no renewal. Self-profile returned 401 in 316 ms. No courses/grades were fetched and no browser opened; the independent idle capture was untouched. The prior verified course result had been a schema-valid empty array. This establishes current rejection of that saved session, not a measured two-hour lifetime or the account's current course contents. See [the private-capture handoff](CARMEN_HANDOFF.md). No captured Mac state was imported into the application Worker.
