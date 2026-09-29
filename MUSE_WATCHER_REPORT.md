# Muse grade watcher report

Prepared September 29, 2026. GradeViewer has no dependency on this watcher. No watcher was implemented or deployed.

## Read this first: evidence and release gate

**No endpoint has yet been verified with the user's real student authentication.** Schoology keys and the district Campus session have not been supplied locally. This report gives exact documented paths, historical public-client candidates, a concrete implementation design, and the outstanding validation checklist. It must not be represented as an already verified production endpoint inventory.

Evidence labels used below:

- **D**: official published documentation; account permissions not personally verified.
- **P**: publicly visible source implementation; may be obsolete or district-specific.
- **L**: GradeViewer fixture/unit/simulator tests; not server validation.
- **V**: this user's authenticated request succeeded. Currently **none**.
- **R**: proposed engineering choice/inference; not provider behavior.

Muse can implement the deterministic state machine and fixture tests now. Before enabling sustained checking, complete one normal authenticated baseline and a genuine subsequent score-edit/grade-change observation on both providers. Do not manufacture a grade, hammer a school, or infer endpoint success from HTTP 200 alone.

## Recommended architecture (R)

One systemd service on the existing Linux VM; ordinary Python or another maintained language with HTTP sessions, OAuth 1 support, SQLite, and a secret store. Prefer a maintained OAuth signing library rather than reimplementing OAuth on Linux. Zero model calls while idle. No new cloud database or account service. A successful meaningful state diff creates one outbox event; only the outbox consumer wakes Muse. Authentication errors and unchanged state must never wake Muse repeatedly.

Schoology priority: administrator-authorized grades webhooks if available; otherwise the documented student changed-since grade endpoint per section. Campus priority: validate a read-only notification/event feed in the district's current authenticated client; use it to fetch only affected details. If unavailable, poll one whole-student overall-grade summary moderately, and periodically reconcile detail scores to catch changes that leave the overall unchanged. The latter limitation is unavoidable without a trustworthy event feed.

## Exact endpoint inventory

### Schoology (base `https://api.schoology.com/v1/`)

All below require a newly signed OAuth 1.0 Authorization header over HTTPS. User ID and enrollment IDs are distinct.

| Method and path | Purpose/queries | Status | Suitable for checking? |
| --- | --- | --- | --- |
| `GET users/me` | Resolve the authorized user; may redirect | D/L | Once at login; re-sign redirects |
| `GET users/{USER_ID}/sections` | Course discovery; follow `links.next`; `limit` paging | D | Baseline and occasional roster changes |
| `GET sections/{SECTION_ID}` | Course settings/title | D | Metadata cache; periodic reconciliation |
| `GET users/{USER_ID}/grades?section_id={SECTION_ID}&timestamp={CURSOR}` | Student grade updates; section_id required; timestamp is server changed-since | D/L parsing | Preferred student detection candidate |
| `GET sections/{SECTION_ID}/grades?enrollment_id={ENROLLMENT_ID}&timestamp={CURSOR}` | Enrollment-scoped grade updates | D | Alternative only if student permissions allow; never query all students |
| `GET sections/{SECTION_ID}/grade_items` | Assignment/discussion/assessment metadata; paginated | D/L | Initial load, missing IDs, occasional metadata refresh |
| `GET sections/{SECTION_ID}/grading_categories` | Category weights/method/drop rules | D/L | Cache; refresh after configuration changes |
| `GET triggers/targets` / `GET triggers/subscriptions` | Existing school webhook configuration | D | Admin-only authority gate; no periodic student probe |
| `POST triggers/targets` / `PUT triggers/subscriptions` | Configure a webhook target and subscriptions | D | Requires admin authorization; Muse must not configure with student authority |
| `GET reminders/{type}` or `{realm}/{realm_id}/reminders/{type}` | Reminder collections | D | Not a documented complete score-change journal |

Sources supporting the paths: [User](https://developers.schoology.com/api-documentation/rest-api-v1/user/), [Course Section](https://developers.schoology.com/api-documentation/rest-api-v1/course-section/), [Grade](https://developers.schoology.com/api-documentation/rest-api-v1/grade/), [Assignment](https://developers.schoology.com/api-documentation/rest-api-v1/assignment/), [Categories](https://developer.schoology.com/api-documentation/rest-api-v1/grading-categories/), [Triggers](https://developers.schoology.com/api-documentation/rest-api-triggers-v1/), and [Reminders](https://developers.schoology.com/api-documentation/rest-api-v1/reminders/).

### Infinite Campus (district application base, commonly `https://<DISTRICT_HOST>/campus/`)

The application's path can vary. Derive it from the actual Campus Student URL; do not assume the hostname or guess the district. Normal authentication cookies must be restricted to their original host/path and HTTPS.

| Method and relative path | Purpose/queries | Status | Suitable for checking? |
| --- | --- | --- | --- |
| `GET portal/students/{DISTRICT}.jsp` | Open district login; subsequent form/SSO flow varies | D concept/P path | Interactive initial login only |
| `GET resources/portal/grades` | Student schools/terms/courses/grading tasks, overall percentages | P/L parsing | Moderate summary polling candidate after V validation |
| `GET resources/portal/grades/detail/{COURSE_OPAQUE_ID}` | Tasks/categories/assignments/scores | P/L parsing | Fetch on event/summary change, plus occasional reconciliation |
| `GET resources/portal/roster?_expand=%7BsectionPlacements-%7Bterm%7D%7D` | Schedule/section discovery | P | Baseline only if needed |
| `GET prism?x=notifications.Notification-retrieve&limitCount=200` | Historical public client's notification collection | P, historical | Best event-feed candidate to validate; no current guarantee |
| `GET prism?x=notifications.NotificationUser-countUnviewed` | Historical unseen count | P, historical | Poor primary detector: a count can be reset independently |

[Grades++ source](https://github.com/jonathanjma/Infinite-Campus/blob/main/extension/service_worker.js) reads grades and detail; [its parsing](https://github.com/jonathanjma/Infinite-Campus/blob/main/extension/pages/class.js) shows category/assignment structure. The [Node client](https://github.com/tonyzimbinski/infinite-campus/blob/master/index.js) shows roster and notification paths. These repositories were last pushed in 2024; they are research candidates rather than current supported contracts. Its notification read parses `data.NotificationList.Notification`, including notificationID, creationTimestamp, notificationTypeID, linkUrl, and linkContext. Types 3 and 4 were described there as course-grade and assignment updates. Validate those classifications against the actual district before using them.

**Do not use** the old query-string-password `verify.jsp?nonBrowser=true...` login. Do not use endpoints that mark notifications read/viewed, toggleRead, updateLastViewed, or markAllRead. A watcher must not change the user's notification state.

The official [Campus Student guide](https://kb.infinitecampus.com/help/campus-student-portal) describes recent grade/assignment updates, supporting investigation of a current feed; it does not publish the JSON endpoint behind them. [OneRoster](https://kb.infinitecampus.com/help/oneroster-api) is a district integration route and is not a student's personal login API. No student webhook subscription or supported changed-since Campus grade endpoint was found in the official material reviewed.

## Login and session behavior

### Schoology

**D:** Personal consumer key and secret use two-legged OAuth 1.0 with empty oauth_token. Token and token-secret fields apply when using an authorized three-legged grant. The API does not exchange personal key/secret credentials for a cookie session; they sign each request. Persist the relevant secrets, the resolved user/enrollment mapping, and cursors separately. Signing needs a unique nonce and current timestamp every time, including after redirects. [Authentication](https://developers.schoology.com/api-documentation/authentication/)

**Unknown:** No measured expiry time or actual token-renewal behavior for this student's credentials. Do not assume a standard OAuth 2 refresh token. Personal keys can be revoked or permissions removed. A token-based integration must use the application's supported OAuth 1 authorization flow when reauthorization is needed. Do not invent a silent renewal endpoint.

**R:** Treat 401 as dead/revoked authentication; stop normal checks and request one reconnect. Treat 403 as permission failure requiring diagnosis, not automatically as expiry. A replay/nonce error can indicate bad signing or clocks; correct that deterministically rather than asking the student for new keys. TLS/network/5xx failures do not invalidate stored credentials.

### Infinite Campus

**D:** User visits the district's Campus Student page and completes normal student login or district SSO. The official mobile app offers Stay Logged In. These documented behaviors do not establish the TTL of a third-party browser session. [Student login help](https://www.infinitecampus.com/support/parents-and-students)

**GradeViewer implementation:** Nonpersistent WKWebView, in-app district lookup or a supplied student URL, user-entered password/SSO, Campus-origin cookie extraction after login, read-only verification, and Keychain cookie persistence. Safari login sessions are separate and are not imported. Raw passwords and identity-provider cookies are not saved by GradeViewer. No password appears in URLs or logs. This is an implementation choice awaiting V validation.

**Muse implication:** iOS Keychain cannot simply be read from Linux. Muse needs a separately authorized local browser login/session on its VM, or an explicitly authorized encrypted session transfer mechanism developed later. GradeViewer has no session-export feature. Linux initial login must be interactive if SSO/MFA requires it; a headless browser is not grounds to bypass those controls. Do not maintain the student's raw password just for automatic relogin.

**Cookie persistence:** Preserve name/value/domain/path/Secure/HttpOnly/expiry/SameSite attributes in the Linux cookie jar; never flatten all cookies into one cross-host header. Store secrets encrypted or through systemd LoadCredential/OS secret storage with restricted permissions. Cookie expiry is metadata, not a guarantee the server still accepts it. A cookie with no Expires is a session cookie, not permanent authorization.

**Unknown:** Actual cookie names, TTL, keepalive policy, SSO restrictions, refresh/renewal endpoint, and whether cookies work from a second host/IP. None was measured. Persist Set-Cookie rotations after successful responses. This preserves a server-issued renewal if one occurs; it does not guarantee indefinite access. Full user relogin may eventually be necessary.

**R:** 401, a login redirect, or HTML where grade JSON is expected means reconnect. 403 may be permission denial or session policy and needs one diagnosis. A 200 JSON payload with missing required grade structure is a schema error; quarantine it and retain the last baseline. After one dead-session determination, suspend that provider until reconnect. Never loop login attempts. Verify a fresh grade-summary request before replacing a usable session.

## Redacted request/response examples

These are **synthetic structural examples**, not captures from the student. Do not treat placeholder field availability as V evidence.

### 1. Resolve Schoology user (D)

```http
GET /v1/users/me HTTP/1.1
Host: api.schoology.com
Accept: application/json
Authorization: OAuth realm="Schoology API", oauth_consumer_key="<REDACTED_KEY>", oauth_nonce="<NEW_NONCE>", oauth_signature_method="HMAC-SHA1", oauth_timestamp="<UNIX_SECONDS>", oauth_token="", oauth_version="1.0", oauth_signature="<REDACTED_SIGNATURE>"
```

If a 303 points to `/v1/users/<STUDENT_ID>`, follow only the approved API origin and generate an entirely fresh OAuth header. Trimmed illustrative response:

```json
{"uid":"<STUDENT_ID>"}
```

### 2. Schoology changed-since grades (D)

```http
GET /v1/users/<STUDENT_ID>/grades?section_id=<SECTION_ID>&timestamp=<CURSOR_MINUS_OVERLAP> HTTP/1.1
Host: api.schoology.com
Accept: application/json
Authorization: OAuth <FRESH_REDACTED_PARAMETERS>
```

Illustrative trimmed structure:

```json
{"section":[{"section_id":"<SECTION_ID>","period":[{"period_id":"<TERM_ID>","assignment":{"grade":[{"assignment_id":"<ASSIGNMENT_ID>","grade":"<SCORE>","max_points":"<POSSIBLE>","timestamp":"<SERVER_UPDATE_SECONDS>","type":"assignment","exception":0}]}}],"final_grade":[{"period_id":"<TERM_ID>","grade":"<OVERALL>","scale_id":0}]}]}
```

Validate whether unchanged period/overall data is still returned with timestamp filtering. A changed-since response is a **delta**, never a complete replacement snapshot. Follow all pagination before advancing a cursor. Fetch grade-item metadata when a new ID appears. Zero scores are real; null/ungraded, incomplete, and excused are distinct states.

### 3. Campus session establishment (D concept, exact flow unknown)

```http
GET /campus/portal/students/<DISTRICT>.jsp HTTP/1.1
Host: <DISTRICT_HOST>
```

The student completes the real rendered form/SSO/MFA. Do not invent one universal POST body. A normal authenticated session may produce cookies resembling this shape; the name is deliberately a placeholder:

```http
Set-Cookie: <SESSION_COOKIE_NAME>=<REDACTED_COOKIE>; Path=/campus; Secure; HttpOnly
```

### 4. Campus notification candidate (P)

```http
GET /campus/prism?x=notifications.Notification-retrieve&limitCount=200 HTTP/1.1
Host: <DISTRICT_HOST>
Accept: application/json
Cookie: <SESSION_COOKIE_NAME>=<REDACTED_COOKIE>
```

Historical public-client structural example:

```json
{"data":{"NotificationList":{"Notification":[{"notificationID":"<EVENT_ID>","notificationTypeID":"4","creationTimestamp":"<TIME>","linkUrl":"<RELATIVE_COURSE_PATH>","linkContext":"<CONTEXT>"}]}}}
```

Never log the raw notification text, which may contain student data. Never blindly visit a returned absolute link; map a validated grade event to a known same-origin read endpoint. A finite notification window may be truncated; reconcile after downtime or possible overflow. Count changes alone cannot prove which score changed.

### 5. Campus summary and affected detail (P)

```http
GET /campus/resources/portal/grades HTTP/1.1
Host: <DISTRICT_HOST>
Accept: application/json
Cookie: <SESSION_COOKIE_NAME>=<REDACTED_COOKIE>
```

```json
[{"schoolID":"<SCHOOL_ID>","terms":[{"termID":"<TERM_ID>","termName":"<TERM>","courses":[{"sectionID":"<SECTION_ID>","_id":"<OPAQUE_DETAIL_ID>","courseName":"<COURSE>","gradingTasks":[{"taskID":"<TASK_ID>","progressPercent":"<OVERALL>","progressScore":"<LETTER>"}]}]}]}]
```

```http
GET /campus/resources/portal/grades/detail/<OPAQUE_DETAIL_ID> HTTP/1.1
Host: <DISTRICT_HOST>
Accept: application/json
Cookie: <SESSION_COOKIE_NAME>=<REDACTED_COOKIE>
```

```json
{"details":[{"task":{"termID":"<TERM_ID>","taskID":"<TASK_ID>"},"categories":[{"name":"<CATEGORY>","weight":"<WEIGHT>","isWeighted":true,"assignments":[{"objectSectionID":"<ASSIGNMENT_ID>","assignmentName":"<ASSIGNMENT>","scorePoints":"<SCORE>","totalPoints":"<POSSIBLE>","multiplier":1,"dueDate":"<DUE>"}]}]}]}
```

The opaque course `_id` is the detail reference. Do not substitute sectionID without validating the current client. Preserve task and term boundaries. Missing progressPercent must not erase a valid posted percent; numeric zero must not fall through to another value.

## Rates, latency, size, and caching

**Schoology D:** Current [PowerSchool system requirements](https://uc.powerschool-docs.com/en/schoology/latest/system-requirements) publishes 50 default public API credits refilled every five seconds; read requests generally cost one, writes three. API/web buckets are separate. Exhaustion returns 429 with Retry-After. This is not permission to continuously consume the maximum bucket, and not proof the user's district has that exact configuration. No account-specific daily quota was observed.

**Campus:** No official student-portal polling rate limit was found in the reviewed material. No throttling status/error body, sustained cadence, response size, latency, ETag, Last-Modified, or cache behavior has been measured. Do not report invented limits or pretend every-five-second polling is approved.

**R cadence assessment:**

| Cadence | Expected role |
| --- | --- |
| 5 seconds | Not the default; no current Campus evidence supports it. Prefer events/webhooks. |
| 15 seconds | Possible short active window for a validated lightweight feed; measure and respect district policy first. |
| 30 seconds | Consider for a validated lightweight notification feed during school hours, not full detail gradebooks. |
| 60 seconds | Conservative initial active-hours read cadence, pending actual district validation; still not an official guarantee. |
| 300 seconds | Suggested overnight/off-hours fallback. |

Start Schoology at 60 seconds during configured school hours and 300 outside; Campus at 60 seconds for one validated feed or summary, with details on change and a detail reconciliation every 10–15 minutes. Randomize phases, serialize requests per provider, back off on transient failures, and honor Retry-After (both seconds and HTTP-date formats). 403/auth/schema errors require suspension/diagnosis, not backoff forever.

After V validation, use conditional requests **only when** the server actually supplies and respects validators. Do not add random cache-busting parameters by habit. A 304 preserves the state and cursor. Test whether normal cache-control is sufficient to see genuine score updates.

For 8 Schoology sections: all-day per-section polling is 138,240 reads/day at 5s, 46,080 at 15s, 23,040 at 30s, or 11,520 at 60s. A proposed 8-hour school window at 60s plus 16 hours at 300s is 5,376 reads/day before metadata/change details. One Campus summary/feed at that same schedule adds 672 reads/day. Eight Campus detail reads every 15 minutes all day add 768; limiting reconciliation to active hours reduces it. These are calculated estimates, not observed traffic. Effective webhook detection avoids idle grade reads entirely, apart from periodic recovery reconciliation.

Polling detection delay is typically between zero and one polling interval **plus provider publication delay**; average interval/2 assumes uniformly timed updates. “Near-instant” cannot be promised for a polling-only Campus fallback. A teacher's SIS/LMS sync delay is outside Muse's control.

## Minimal durable state and SQLite proposal (R)

Persist only provider cursors, subject/section mappings, normalized latest records and hashes, seen feed IDs, last successful complete snapshot, backoff deadlines, explicit cross-provider matches, and an event outbox. Secrets belong outside this SQLite data file. Keep sensitive grade records encrypted at rest if the host/storage threat model requires it.

```sql
CREATE TABLE provider_state (
  provider TEXT PRIMARY KEY,
  subject_ref TEXT NOT NULL,
  cursor_seconds INTEGER,
  last_success TEXT,
  blocked_reason TEXT,
  retry_after TEXT
);
CREATE TABLE grade_state (
  provider TEXT NOT NULL,
  source_key TEXT NOT NULL,
  course_key TEXT NOT NULL,
  term_key TEXT NOT NULL,
  task_key TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  semantic_json TEXT NOT NULL,
  semantic_hash TEXT NOT NULL,
  source_updated TEXT,
  seen_generation INTEGER,
  PRIMARY KEY(provider, source_key)
);
CREATE TABLE course_match (
  canonical_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_course_key TEXT NOT NULL,
  PRIMARY KEY(provider, source_course_key)
);
CREATE TABLE seen_feed_event (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY(provider, event_id)
);
CREATE TABLE outbox (
  event_key TEXT PRIMARY KEY,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
```

Identifiers are local references, not names in log output. The initial baseline does not emit changes. Canonical semantic hashes include score, points possible, exception/status, relevant overall values, category/multiplier changes, and term/task identity; exclude fetched_at, JSON ordering, cosmetic text formatting, and provider-specific update timestamps from the semantic fingerprint.

## Reliable detection and deduplication (R)

Schoology maintains a cursor **per section**. Query with a small timestamp overlap (e.g. 120 seconds, an engineering setting to validate), deduplicate by source identity and semantic content, and advance to the greatest successfully processed server grade timestamp only after all pages are committed. Never advance to the VM wall clock merely because a response is empty. Clock skew and timestamp inclusion semantics need a real edit test. Run occasional complete reconciliation for deletion, missed metadata, and cursor recovery.

Campus feed processing tracks stable event IDs, not notification count/read state. If an ID is new, coalesce affected courses briefly and fetch their detail once. A summary detector hashes all relevant term/task overalls. A changed overall fetches affected details; periodic detail reconciliation catches score edits whose overall remains unchanged. Never infer removed assignments from an incremental feed's silence.

Cross-provider course matching should use explicit mappings first, then unique normalized names, term, and teacher. Missing/ambiguous metadata requires a mapping instead of fuzzy guesses. Assignment matching uses unique title + due-calendar date + possible points within a matched course, with original provider IDs retained. Calibrate provider date/timezones. Do not match recurring “Quiz” titles without reliable dates or IDs.

If Schoology publishes a score first, emit once from the known source. When Campus later reflects the same logical score, add its provenance and suppress a duplicate assignment-score notification. However, an independently changed Campus overall is meaningful and may warrant an event; do not suppress it merely because the assignment matched. If values disagree, retain both; do not present a reconciliation policy as proof one was entered incorrectly. Keep a canonical emitted score fingerprint and a separate canonical emitted overall fingerprint. Time windows alone are inadequate deduplication keys.

A later teacher score edit emits a new transition even when the assignment ID is unchanged. A deletion/removal is recognized only after a successfully fetched **complete** source snapshot, preferably confirmed once or backed by a trusted deletion event. Session expiry, 403, truncated pages, HTML, schema changes, and failed requests must never generate mass deletions. Missing from a delta is not removed.

## Sanitized event format (R)

Outbox examples contain fake labels and no session material. In the live event delivered privately to Muse, include only information needed for the intended wakeup. Log the event ID/type and counts, not raw grades.

```json
{
  "type":"grade_changed",
  "event_id":"<STABLE_TRANSITION_HASH>",
  "course":"<COURSE_LABEL>",
  "assignment":"<ASSIGNMENT_LABEL_OR_NULL>",
  "term":"<TERM_LABEL>",
  "old_score":{"earned":"<VALUE_OR_NULL>","possible":"<VALUE_OR_NULL>","status":"graded"},
  "new_score":{"earned":"<VALUE_OR_NULL>","possible":"<VALUE_OR_NULL>","status":"graded"},
  "old_overall":"<VALUE_OR_NULL>",
  "new_overall":"<VALUE_OR_NULL>",
  "provider":"schoology",
  "timestamp":"<UTC_OBSERVED_TIME>",
  "source_updated_at":"<PROVIDER_TIME_OR_NULL>",
  "source_ids":[{"provider":"schoology","course":"<LOCAL_COURSE_REF>","assignment":"<LOCAL_ASSIGNMENT_REF>"}]
}
```

Use numeric values/null in real events; the placeholders above deliberately redact values. Distinguish observed_at from provider_updated_at; some Campus records may have no reliable source update timestamp. Include added/edited/removed distinctions if Muse needs them. Avoid student names/IDs, cookies, tokens, passwords, and full raw provider JSON in wakeup payloads.

## Implementation pseudocode (R)

```text
on startup:
  load configuration, credentials, SQLite state
  validate an authenticated baseline for each provider
  if first connection: commit baseline without notifications

loop using monotonic deadlines, with no model calls:
  for each due, unblocked provider:
    fetch allowed feed/delta/summary using bounded pagination
    validate status, content type, required schema, subject scope
    if authentication rejected:
      mark provider blocked; request reconnect once; keep last state
    else if throttled or temporary failure:
      schedule Retry-After/backoff with jitter; keep last state
    else if schema changed:
      quarantine sanitized diagnostic; suspend destructive diffs
    else:
      resolve affected course detail and missing metadata
      begin transaction
        normalize and compare semantic states
        reconcile explicitly mapped cross-provider identities
        create only new meaningful transitions in outbox
        update rows, seen IDs, complete-snapshot generations
        advance applicable cursors after all pages succeeded
      commit
      schedule next check without overlapping work

outbox worker:
  deliver a coalesced meaningful GradeChanged event to Muse
  mark delivered only after acknowledged
  use event_id as an idempotency key
```

Checkpoint score state, cursors, and outbox in the same transaction. If interrupted before commit, replay safely; if after commit but before delivery acknowledgement, the stable event key prevents duplicate wakeups. Bound task coalescing and pagination so outage recovery cannot accumulate unbounded work.

## VM deployment and security (R)

A dedicated unprivileged systemd service, Restart=on-failure with a sensible restart delay, persistent SQLite under a restricted StateDirectory, LoadCredential or an equivalent encrypted secret mechanism, and sanitized journald logs are sufficient. Use systemd hardening appropriate to the selected HTTP/browser workflow. Do not expose a new listener for polling. If a district-authorized webhook becomes available, add only the required HTTPS receiver on the existing VM, validate origin/authenticity according to the actual provider contract, and fetch authorized state to confirm events. Do not invent an undocumented webhook signature header.

Idle checking uses deterministic code. Model wakeups should be limited to a genuine relevant grade transition, completion/failure needing user action, or a single reconnect request. No model-driven heartbeat chatter or per-poll LLM interpretation. Keep source credentials out of Git, shell command arguments, exception traces, exported HAR files, backup bundles, and this report.

## Required V validation before sustained operation

1. Enter Schoology credentials locally and complete `/users/me`, sections, one section's grades/grade_items/categories. Record methods/path, status, permission, page count, server time, redacted field structure, latency/bytes. Do not record secrets or personal scores here.
2. Make one genuine naturally occurring new/edited grade observation with timestamp filtering; verify overlap, inclusive/exclusive semantics, returned period overalls, and cursor safety.
3. Sign into the exact district Campus Student page normally. Verify summary and opaque-ID detail requests. Confirm task/term schema, assignment identity, missing/excused/drop flags, weighting, and date timezone.
4. Validate the current Campus recent-score/notification feed using the actual client or authorized requests; compare stable event IDs, edit behavior, overflow, and whether reads are nonmutating. Retire the historical prism candidate if the district no longer uses it.
5. Observe session rotation and eventual expiry, including HTML/login redirects. Demonstrate one reconnect and recovery without fake deletions. Do not infer a TTL from one successful hour.
6. Measure a low-frequency trial first, including normal response size/latency and cache validators. Record any actual throttling. Change cadence only with evidence.
7. Observe the same assignment in both systems and a later score edit; verify one score wakeup and correct handling of an independently changed Campus overall.

Until these checks are complete, the report's exact endpoints remain D/P candidates. Update this file with a redacted V matrix instead of making undocumented claims.
