# Muse: student grade watcher handoff

Prepared September 29, 2026. Repository: https://github.com/fiukewhfkje/GradeViewer (private). GradeViewer works independently. **No Muse watcher has been implemented or deployed.** This report directly covers the four requested subjects: working student endpoints, login/session behavior, redacted request/response examples, and observed rate limits.

Evidence: **V** = this student's authenticated request and relevant parse succeeded; **D** = official documentation; **P** = public client evidence; **L** = local fixture tests; **R** = proposed implementation. V is scoped to the requests described, not a guarantee of every district, every account permission, or an indefinite session.

## 1. Endpoints that actually work with this student login

### Infinite Campus — V

District application base:

`https://dublincityoh.infinitecampus.org/campus/`

The student's authenticated home is `/campus/nav-wrapper/student/portal/student/home?appName=dublincity`. Derive the base from the actual Student portal; do not use the nested `/portal/` as the root.

| Read | Actual result | Use |
| --- | --- | --- |
| `GET resources/portal/grades` | HTTP 200 JSON array; complete parse succeeded | Whole-student schools, terms, courses, tasks and reported overall grades |
| `GET resources/portal/grades/detail/{sectionID}` | All six distinct detail requests HTTP 200 JSON objects; complete parse succeeded | Task/term categories, assignments and scores |

**Critical correction:** use the summary course's `sectionID`, not its `_id`, for the detail route. GradeViewer initially used `_id` and got authenticated HTTP 200 empty arrays. Correcting the route returned the expected detail objects. Five details had categories; one legitimately had none. This was reproduced in a regression test before correction.

Observed nesting is `schools[] → terms[] → courses[] → gradingTasks[]` in summary, and `details[] → task + categories[] → assignments[]` in detail. Match detail task/term to the summary task/term. Keep those identities separate. Do not combine grading tasks or future quarters into an annual average.

Assignments expose `scoreModifiedDate` (string or null), `dueDate`, `assignedDate`, `objectSectionID`, `scorePoints`, `totalPoints`, `multiplier`, `assignmentName`, and `score`. Task objects also expose `modifiedDate`. The initial timestamp parser missed `scoreModifiedDate`; it is now the first score-update timestamp. This fixed all five displayed courses' update labels and progression availability. A null score-update date must remain absent, not become fetch time.

The endpoint choice originally came from [Grades++ public worker](https://github.com/jonathanjma/Infinite-Campus/blob/main/extension/service_worker.js), [detail parsing](https://github.com/jonathanjma/Infinite-Campus/blob/main/extension/pages/class.js), and [the home-page sectionID reference](https://github.com/jonathanjma/Infinite-Campus/blob/main/extension/pages/main.js). These supplied P evidence; the successful reads above supply V evidence. No third-party implementation was copied.

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

### Campus event feeds — P only, untested

The historical [Node client](https://github.com/tonyzimbinski/infinite-campus/blob/master/index.js) references `prism?x=notifications.Notification-retrieve&limitCount=200` and `notifications.NotificationUser-countUnviewed`. Neither was tried with this district. Roster is also unnecessary for GradeViewer's initial fetch. Do not present these as working 2026 student endpoints. Do not mark notifications read or update viewed state. A count is not a complete event journal.

## 2. Login/session: what it returns, lifetime, refresh and recovery

### Schoology

**D/V:** personal consumer key + consumer secret sign two-legged OAuth 1.0 requests, with empty `oauth_token`. The app also supports optional token/token-secret credentials, but this student's personal-key flow is the one observed. Login does not exchange those keys for an OAuth 2 bearer/refresh token. A successful identity read returns a user object; the same signing credentials authorize subsequent reads. [Authentication documentation](https://developers.schoology.com/api-documentation/authentication/).

Use HMAC-SHA1 per OAuth 1.0, a fresh nonce and current Unix timestamp, correct encoded parameter sorting, and a fresh signature on each redirect. Only follow the approved HTTPS API origin/path. GradeViewer uses Apple's HMAC primitive and an RFC 5849 signature regression; Muse should use a maintained OAuth 1 library.

**Observed persistence:** the keys were entered locally, saved in iOS Keychain, and successfully reused across app reinstalls and relaunches. Failed setup also keeps a pending Keychain item, so a parsing error does not force re-entry. Successful verification promotes it to active credentials.

**Lifetime: unknown.** No expiration/revocation interval was measured. There is no verified silent renewal endpoint. Re-signing a new request refreshes its nonce/signature, not the underlying authorization. If keys are revoked or rejected, reconnect with the supported credential flow. Treat 401 as authentication rejection; diagnose 403 as access denial rather than automatically assuming expiry. The observed owner-ID 403 was a permission/routing issue and was fixed without new keys.

### Infinite Campus

**V user flow:** normal district Campus Student login inside the same nonpersistent WKWebView used for Find your district. User completes the district page and any SSO normally. On authenticated home, Connect obtains Campus-origin cookies, verifies summary plus all details, and saves the session cookie jar to Keychain. Passwords are never saved; reusable SSO-provider cookies from visited IdP hosts are now retained only in the device’s Keychain and are never exported. An unrelated Safari login has a separate cookie session.

**What it returns:** the browser login establishes a server cookie session and reaches Student home. Those cookies authorize the grade JSON resources above. This is a browser session, not a verified public student OAuth/token contract. A universal programmatic login POST body was not established.

GradeViewer stores cookie name/value/domain/path/Secure/HttpOnly/SameSite/expiry, retains origin scope, explicitly sends URL-selected cookies from its ephemeral URLSession jar, and persists the jar after every fetch attempt, including failures that rotate/delete cookies. Legacy Keychain payloads decode without the optional security metadata or SSO session. A failed connection keeps a separate pending session for manual retry/forget. The saved session survived reinstall/relaunch and fetched successfully again. The earlier optional local Cookie-header import UI was removed during the requested Settings cleanup; normal SAML persistence now works behind the scenes. A copied request header would not convey expiry/renewal metadata.

**Lifetime: unknown.** Actual server TTL, keepalive policy, expiry, SSO restrictions on a VM, and cross-IP portability were not measured. Successful repeated reads do not prove permanent login. Normal Campus browser SAML can reuse an already authenticated IdP session, according to the [official SAML configuration documentation](https://kb.infinitecampus.com/help/sso-service-provider-configuration). GradeViewer now keeps that session in device Keychain and attempts one bounded renewal after Campus authentication rejection; a new full grade fetch must succeed. This is not a verified VM renewal contract. A session cookie without Expires does not define server-side lifetime; even an Expires value would only describe cookie metadata. The official mobile app's Stay Logged In option is not a lifetime guarantee for this independent session. [Student support](https://www.infinitecampus.com/support/parents-and-students).

**Refresh:** use the existing origin-scoped cookie jar for ordinary read requests; apply Set-Cookie updates through the HTTP cookie jar and save after success or failure. This preserves any server-issued rotation/deletion but does not prove a renewal protocol. No separate Campus refresh-token or keepalive endpoint was verified. If reads return login HTML, a login redirect, or 401, preserve the last successful baseline and ask for a normal browser reconnect. Diagnose 403 once. Do not loop login attempts or store the raw password for silent relogin.

**Latest V observation:** an existing SSO-created session returned grade-summary 401 with nine restored eligible cookies, then saved-portal HTML 200, then grade-summary 401. All cached records remained. The student reported immediate failure and SSO-only authentication; no TTL was measured. Fresh normal SSO succeeded; two immediate process relaunches, signed reinstall, and the next automatic active check returned summary/all-detail 200. This proves recovery and short-term reuse on that phone, not why the previous session became invalid, cross-device cookie portability, or perpetual login.

**VM setup:** iOS Keychain credentials were not transferred. Muse needs separately authorized local credential entry and a normal browser login on its VM, or a future explicitly authorized secure transfer. Store secrets outside source/Git/logs with restricted permissions; preserve cookie domain/path/Secure/expiry and browser attributes supported by the chosen jar. Interactive SSO/MFA remains interactive. Never use the historical password-in-query-string `verify.jsp?nonBrowser=true...` route.

## 3. Redacted example requests and responses

The following are **trimmed reconstructions of observed response shapes** with every identifier, title, score, date, credential and signature replaced. They are not raw response dumps. `<NUMBER>` means an actual JSON number in the observed data; placeholder strings are for redaction, not literal field types. Optional fields and additional keys are omitted. Event/delta endpoints are deliberately excluded from V examples.

### A. Schoology full student grades — V

```http
GET /v1/users/<REDACTED_USER_ID>/grades?section_id=<REDACTED_ENROLLED_SECTION_ID> HTTP/1.1
Host: api.schoology.com
Accept: application/json
Authorization: OAuth realm="Schoology API", oauth_consumer_key="<REDACTED>", oauth_nonce="<NEW_NONCE>", oauth_signature_method="HMAC-SHA1", oauth_timestamp="<CURRENT_UNIX_SECONDS>", oauth_token="", oauth_version="1.0", oauth_signature="<REDACTED>"
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "section": [{
    "section_id": "<REDACTED_GRADE_OWNER_ID>",
    "period": [{
      "period_id": "<REDACTED_PERIOD_ID>",
      "period_title": "<REDACTED_TERM>",
      "assignment": [{
        "assignment_id": "<NUMBER>", "type": "<REDACTED_KIND>",
        "grade": "<NUMBER>", "max_points": "<NUMBER>",
        "exception": "<NUMBER>", "scale_id": "<NUMBER>",
        "scale_type": "<NUMBER>", "timestamp": "<NUMBER>"
      }]
    }],
    "final_grade": [{"period_id": "<REDACTED_PERIOD_ID>", "grade": "<NUMBER>", "scale_id": "<NUMBER>"}],
    "grading_category": [{"id": "<NUMBER>", "title": "<REDACTED_CATEGORY>", "weight": "<NUMBER>"}]
  }],
  "links": {}
}
```

Fetch metadata with the **enrolled** ID, even if the returned grade owner differs:

```http
GET /v1/sections/<REDACTED_ENROLLED_SECTION_ID>/grade_items HTTP/1.1
Host: api.schoology.com
Authorization: OAuth <FRESH_REDACTED_PARAMETERS>
Accept: application/json
```

HTTP 200; grade-item collection contains titles, IDs, due dates, maximum points and grading metadata. Follow `links.next` before treating it as complete. A saved-grade exception is not automatically a numeric zero; honor scale/exception meaning and retain the reported overall when calculation rules are insufficient.

### B. Campus summary — V

```http
GET /campus/resources/portal/grades HTTP/1.1
Host: dublincityoh.infinitecampus.org
Accept: application/json
Cookie: <REDACTED_ORIGIN_SCOPED_COOKIE_JAR>
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
[{
  "schoolID": "<NUMBER>",
  "terms": [{
    "termID": "<NUMBER>", "termName": "<REDACTED_TERM>",
    "courses": [{
      "sectionID": "<NUMBER>", "_id": "<REDACTED_OTHER_ID>",
      "courseName": "<REDACTED_COURSE>",
      "gradingTasks": [{"taskID": "<NUMBER>", "progressPercent": "<NUMBER>", "progressScore": "<REDACTED_LETTER>"}]
    }]
  }]
}]
```

### C. Campus section detail — V

```http
GET /campus/resources/portal/grades/detail/<REDACTED_SECTION_ID> HTTP/1.1
Host: dublincityoh.infinitecampus.org
Accept: application/json
Cookie: <REDACTED_ORIGIN_SCOPED_COOKIE_JAR>
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "details": [{
    "task": {"termID": "<NUMBER>", "taskID": "<NUMBER>", "modifiedDate": "<REDACTED_DATE>"},
    "categories": [{
      "groupID": "<NUMBER>", "name": "<REDACTED_CATEGORY>",
      "weight": "<NUMBER>", "isWeighted": "<BOOLEAN_OR_NUMBER>",
      "assignments": [{
        "objectSectionID": "<NUMBER>", "assignmentName": "<REDACTED_TITLE>",
        "scorePoints": "<REDACTED_NUMERIC_STRING>", "totalPoints": "<NUMBER>",
        "multiplier": "<NUMBER>", "score": "<REDACTED_STRING>",
        "assignedDate": "<REDACTED_DATE>", "dueDate": "<REDACTED_DATE>",
        "scoreModifiedDate": "<REDACTED_DATE_OR_NULL>"
      }]
    }]
  }]
}
```

A null scoreModifiedDate is legitimate, particularly for ungraded rows. Detail reads are section-scoped and contain multiple terms/tasks; filter locally by both. A structural mismatch is not an empty successful replacement snapshot. Preserve last successful data until a full parse succeeds.

## 4. Rate limits and measurements actually noticed

**V observations:** no HTTP 429 or Retry-After was observed in the successful fetches. One Schoology wrong-owner metadata attempt was 403; wrong Campus detail identifiers returned 200 empty arrays. Neither is evidence of throttling. No load test or sustained polling was performed.

The most recent explicit diagnostic run measured elapsed time around each URLSession request, including device network/server time; these are single-session samples, not percentile benchmarks or rate limits. Connection reports are bounded, so Schoology ranges below describe retained samples, not an exhaustive request trace.

| Read | Payload bytes | Observed elapsed time |
| --- | --- | --- |
| Campus summary | 58,368 | about 637 ms |
| Campus six section details | 970–41,062 each | about 107–210 ms each |
| Schoology retained student-grade reads | 112–13,109 | about 155–919 ms |
| Schoology retained section metadata | 988–1,096 | about 114–131 ms |
| Schoology retained grade-item collections | 16,257–22,426 | about 151–200 ms |
| Schoology retained category collections | 117–332 | about 95–202 ms |

Campus's seven summary/detail responses totaled **176,025 bytes** in this sample. Frequent full-detail polling multiplies that work and needs evidence, not guesswork. No ETag/Last-Modified/cache-validator behavior or session TTL was measured.

**Schoology D:** [PowerSchool system requirements](https://uc.powerschool-docs.com/en/schoology/latest/system-requirements) publishes a default 50 public API-credit bucket refilled every five seconds, GET generally costing one credit, with 429/Retry-After on exhaustion. This is a documented default, not a measured account-specific quota or permission to consume the entire bucket continuously. No daily quota was observed.

**Campus:** no supported student-portal quota was found in the official sources reviewed. The successful sample establishes access, not an approved polling frequency. Respect 429/Retry-After if encountered and retain cached state.

## Watcher implementation guidance — R, independent of the app

1. Use deterministic code, a maintained OAuth 1 client, an origin-scoped cookie jar, SQLite, and a secret store on the existing VM. Zero model calls while idle. Do not scrape screenshots or ask a model to interpret every response.
2. First fetch a complete successful baseline without notifying. Store provider + user + section + term + task/kind + assignment identity and source values. Do not sum two providers' copies of the same score.
3. Validate Schoology timestamp filtering with a genuine naturally occurring grade change before using a cursor. Use a small overlap, deduplicate by stable identity + semantic fingerprint, and commit cursor advancement only after all pages succeed. A delta must not delete assignments absent from that delta.
4. Validate any Campus event feed before adopting it. Otherwise use a modest summary check and periodic full-detail reconciliation: a score edit can leave the rounded overall unchanged. No fixed aggressive cadence is endorsed by the current evidence; begin a low-frequency trial and measure.
5. Compare semantic score/possible/exception/overall/category-rule state, excluding fetched-at, JSON ordering, and cosmetic formatting. Preserve zero, null/ungraded, excused, extra credit and task/term distinctions.
6. Commit state, cursors and an outbox event atomically. Use stable event IDs, coalescing and acknowledged delivery so restarts do not wake Muse twice for one change. Independent Campus overall changes remain real events even if a Schoology assignment also changed.
7. On network/5xx/schema failure retain the baseline and back off with jitter. On 429 honor Retry-After. On dead authentication pause that provider and request one reconnect; do not wake Muse on every unchanged/error poll.
8. Before sustained operation verify naturally occurring changes, cursor semantics, session expiry/reconnect, response-size/latency at the trial cadence, actual account identity, and cross-provider matches. Do not manufacture school data or configure admin webhooks with student authority.

GradeViewer's normalization/calculation code and regression fixtures are available in the private repository. Its chart prefixes are presentation calculations, not a provider audit log; a watcher must compare real source snapshots. No credentials, cookies, raw student payloads, HAR files, device databases or personal grades are included in this handoff or Git history.
