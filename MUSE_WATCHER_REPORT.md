# Muse Schoology watcher research handoff

GradeViewer supports Schoology only. No watcher has been implemented or deployed, and GradeViewer has no Muse dependency. This report is research for a separate service. Verified original-account reads, documented endpoints and proposed behavior must remain distinct. Never export credentials, cookies, raw responses or student records.

## Verified read paths

### Schoology — V

Base: `https://api.schoology.com/v1/`. Each GET receives a freshly signed OAuth 1.0 header.

| Read | Actual result | Use |
| --- | --- | --- |
| `GET users/me` | Same-host HTTPS 303 followed by a freshly signed HTTP 200 user read | Resolve the authorized user |
| `GET users/{userID}/sections` | HTTP 200; enrolled-section discovery succeeded | Discover authorized sections; follow pagination |
| `GET users/{userID}/grades?section_id={enrolledSectionID}` | HTTP 200; full grade snapshot parse succeeded | Student period assignments and final grades |
| `GET sections/{enrolledSectionID}` | HTTP 200 for processed graded sections | Course metadata/options |
| `GET sections/{enrolledSectionID}/grade_items` | HTTP 200 for processed graded sections | Assignment titles, dates, points, factors and category metadata |
| `GET sections/{enrolledSectionID}/grading_categories` | HTTP 200 for processed graded sections | Categories, weights and methods |

**Observed alias case:** the user grades response can return a `section_id` different from the requested enrolled-section ID. Direct `grade_items` through that returned owner was HTTP **403**. Metadata/items/categories through the enrolled-section ID succeeded. Use the enrolled ID for accessible metadata requests; retain the returned grade-owner ID for grade identity. Do not rewrite every URL to the returned owner.

GradeViewer accepts the requested owner if present, otherwise only a single unambiguous grade-section row; multiple unmatched rows are a schema failure. Metadata must still match the enrolled ID. Both IDs are retained in provenance. Grade owners are deduplicated to avoid processing aliases twice. Empty valid grade-section arrays are allowed for nongraded enrollments. No official linking mechanism was established; this is V response behavior plus L regression coverage.

Actual grade shape includes `section[]`, `period[]`, `period[].assignment[]` (a direct array in the observed response), `final_grade[]`, `grading_category[]`, `assignment_id`, `type`, `exception`, `grade`, `max_points`, `scale_id`, `scale_type`, and `timestamp`. Do not assume every period uses an `assignment.grade` wrapper; GradeViewer accepts both shapes.

**Not V:** `timestamp` changed-since semantics, enrollment-scoped section grades, webhook subscriptions, and reminders as a complete change journal. Schoology documents [changed-since grades](https://developers.schoology.com/api-documentation/rest-api-v1/grade/), but this session tested full grades without that filter. [Event triggers](https://developers.schoology.com/api-documentation/rest-api-triggers-v1/) require administrator authority; student API keys do not establish it.


## Authentication and persistence

### Schoology

**D/V:** personal consumer key + consumer secret sign two-legged OAuth 1.0 requests, with empty `oauth_token`. The app also supports optional token/token-secret credentials, but this student's personal-key flow is the one observed. Login does not exchange those keys for an OAuth 2 bearer/refresh token. A successful identity read returns a user object; the same signing credentials authorize subsequent reads. [Authentication documentation](https://developers.schoology.com/api-documentation/authentication/).

Use HMAC-SHA1 per OAuth 1.0, a fresh nonce and current Unix timestamp, correct encoded parameter sorting, and a fresh signature on each redirect. Only follow the approved HTTPS API origin/path. GradeViewer uses Apple's HMAC primitive and an RFC 5849 signature regression; Muse should use a maintained OAuth 1 library.

**Observed persistence:** the keys were entered locally, saved in iOS Keychain, and successfully reused across app reinstalls and relaunches. Failed setup also keeps a pending Keychain item, so a parsing error does not force re-entry. Successful verification promotes it to active credentials.

**Lifetime: unknown.** No expiration/revocation interval was measured. There is no verified silent renewal endpoint. Re-signing a new request refreshes its nonce/signature, not the underlying authorization. If keys are revoked or rejected, reconnect with the supported credential flow. Treat 401 as authentication rejection; diagnose 403 as access denial rather than automatically assuming expiry. The observed owner-ID 403 was a permission/routing issue and was fixed without new keys.


The active PWA stores encrypted Schoology keys in each user's Cloudflare Worker; the native Keychain evidence above describes the retired native app in Git history. A separate watcher must manage its own authorized secret storage and verify users/me before student reads. Do not reuse browser owner sessions as provider credentials.

## Rate limits and incremental evidence

The reviewed [PowerSchool system requirements](https://uc.powerschool-docs.com/en/schoology/latest/system-requirements) describe a default 50-credit public API bucket refilled every five seconds, with GET generally costing one credit. This is a documented default, not an account-specific measured quota or recommended polling frequency. No daily quota was observed. Real optional metadata reads have encountered 429/cooldowns; honor Retry-After and stop queued work. No sustained 5-second or 15-second polling trial, student webhook subscription or complete incremental grade-change journal was verified. Full grades plus periodic reconciliation remain the demonstrated read path.

## Proposed independent service

Use deterministic code while idle, with no model calls. Begin with a modest measured read cadence; use bounded concurrency and exponential backoff with jitter. Validate any changed-since mechanism before relying on it, since score edits can leave a rounded overall unchanged. Only adopted administrator-authorized triggers could replace polling.

Retain stable account/section/period/typed-item identities and compare canonical scores, exception flags and overalls. A failed or malformed response preserves the last successful baseline; only a schema-valid empty response can remove records. Commit state and an outbox event atomically, using stable event IDs and acknowledged delivery so restart/retry does not duplicate a notification. A real score edit must be distinct from a newly discovered title. Store only the minimum encrypted credentials and comparison state needed. This is a recommendation, not a deployed service or verified VM authorization/renewal contract.
