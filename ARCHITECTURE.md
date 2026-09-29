# Architecture

## Runtime

GradeViewer is one native SwiftUI iPhone application and one WidgetKit extension. There is no GradeViewer server, analytics, advertising SDK, cloud account, or required external watcher. The only package is the local GradeCore Swift package, built from the same repository. Apple frameworks handle networking, OAuth cryptography, persistence, credentials, charts, and widgets.

`SchoologyProvider` / `InfiniteCampusProvider` → typed source courses → `Reconciler` → canonical `Course` / `Assignment` → SwiftData cache → SwiftUI. The widget reads a separate small App Group summary. It never receives credentials or assignment records.

## Canonical model

`Term`, `GradingCategory`, `Score`, `OverallGrade`, `SourceCourse`, `SourceAssignment`, `Provenance`, `Course`, `Assignment`, `GradeHistorySnapshot`, and `Hypothesis` live in GradeCore. Source identity includes provider, section, term, task/item kind, and provider ID. Two providers' raw IDs are never interchangeable. A course has one or more complete source records; an assignment has one or more source variants. Selected original fields and IDs remain in provenance for debugging; full student payloads are not written to logs.

Course identity includes term/task. Campus standards/tasks never get averaged together or collapsed into a single annual grade. Multiple tasks are separate labeled rows. Term names remain the providers' own labels. The app displays a term picker when needed.

## Matching and display

1. Auto-match only a unique course pair across different providers with exact normalized course title, term label, and nonempty teacher name. Normalization folds case, diacritics, punctuation, and whitespace. Missing or ambiguous metadata leaves separate courses.
2. Explicit course matches saved locally override metadata matching. Settings → Match courses handles different provider course/term labels. This mapping changes local presentation only.
3. Within a matched course, assignments match only when normalized title, UTC due-calendar day, and points possible agree, and there is exactly one candidate from each provider. Missing dates and ambiguous repeated titles remain separate. Metadata without timezone is currently parsed as UTC; district timezone calibration is still required during live validation.
4. Campus supplies the displayed overall grade when available; otherwise a source with a grade is selected. An actual zero is available data. For assignments, a scored/excused Campus variant wins, with a scored Schoology variant as fallback. All variants remain stored, even on disagreement.
5. A source disagreement can be inspected from the course or assignment detail. The normal list contains no provider diagnostics.
6. On a new source joining an existing canonical entity, retain its identity, history, order, and visibility. When a merged entity splits after metadata changes, only one split inherits the old identity; regression tests cover both courses and assignments.

The scoring basis is always one complete provider's source course, normally the displayed Campus course. Reconciled assignments from both providers are for presentation; they are never summed twice in a calculator.

## Persistence and startup

SwiftData uses its local SQLite store with CloudKit explicitly disabled. CourseRecord stores one canonical course payload, including its source records and history. ScenarioRecord stores local hypotheses. MappingRecord stores explicit provider matches. Differential saves insert, update, or delete individual records; they do not delete and rebuild the database. Saves roll back on error.

Startup synchronously loads the cache into an observable store, then starts an asynchronous refresh. UI always renders cached values first. URLSession and provider fetch/parsing run asynchronously; assignments use lazy scrolling. Read-only source snapshots are committed only after an entire provider refresh succeeds. Failed providers retain their previous data. A successful empty provider result removes only that provider's records. A malformed response must not be interpreted as an empty successful snapshot.

History records changes of at least 0.01 percentage point, a letter-grade change, or a display-provider change. Unchanged refreshes do not add snapshots. First observation begins history; the chart does not fabricate earlier history from assignments. Demo history is synthetic and isolated.

## Authentication and transport

Schoology accepts personal OAuth 1.0 consumer key/secret, plus optional access-token/secret. Requests use CryptoKit HMAC-SHA1, as specified by OAuth 1.0. HMAC implementation is Apple's; a protocol test checks the RFC 5849 signature vector. Redirects, including `/users/me`, get a fresh nonce and signature. Pagination and redirects remain within the approved HTTPS origin/path. Schoology's documented HTTP pagination links are upgraded only for its own API host.

Campus opens the user's actual HTTPS Campus Student portal in a nonpersistent WKWebView. District lookup runs inside the same view and remembers the selected student portal before SSO navigation. Safari login sessions are separate; the app never tries to extract Safari cookies. No login-page scripts are injected and no password fields are read. SSO page navigation remains user-driven. Connect obtains Campus-origin cookies from WKHTTPCookieStore and tests grade access before saving the session. SSO cookies are excluded. ASWebAuthenticationSession was considered; no public student OAuth/callback contract was found, and that API does not provide a general export of a website's Safari session cookies.

Credentials and Campus cookies are stored in app-scoped Keychain items using `WhenUnlockedThisDeviceOnly`. Campus passwords are never stored by GradeViewer. URLSession uses an ephemeral private cookie jar, HTTPS, same-origin reads, standard TLS validation, and no disk cache. New response cookies are persisted after successful Campus refresh. Expiration/rejection preserves cached grades and asks for reconnect. A 429 pauses further attempts until Retry-After; no retry storm.

This app supports one student's own accounts. Disconnect before changing accounts; it removes that provider's data and resets local history/scenarios/mappings. Live account identity binding, actual district SSO behavior, and Campus response schemas still require credentialed verification. Never silently mix students.

## Calculations

The calculator supports total points, weighted categories, equal category weights, points or average-percent category aggregation, assignment multipliers, category exclusions, excused/explicitly dropped items, ungraded exclusion, extra-credit numerator points, and dropping lowest scores. Empty weighted categories are omitted and active weights are renormalized. Intermediate values are not rounded.

Unsupported/missing rules do not generate a made-up number. What-If first checks that the complete visible source assignments reproduce the reported overall within 0.15 percentage point. If not, it gives a concise actual mismatch message. This is not evidence that the student's account contains hidden grades. The documented Campus portal visibility caveat is in RESEARCH.md. Rubric scales, district rounding/overrides, and advanced drop rules need live calibration before claiming parity.

Hypothetical edits, drops, restores, and resets in overview, assignment lists, categories, and What-If share the same ScenarioRecord. They never call a provider write endpoint. Real grades and grade history remain unaffected. The final calculator uses `(target - current × (1 - finalWeight)) / finalWeight`; the user enters the syllabus weight, and impossible/extra-credit targets are explicit.

## UI and widget

Screens use restrained warm neutrals, native navigation/sheets/forms, clear grade alignment, and one original chart icon. System/light/dark appearance persists in UserDefaults. Graph long-press and drag selects the nearest actual snapshot and shows percentage/date. Selection remains visible after release and the next touch selects another point. Screens omit promotions, subscription UI, decorative statistics, inspirational copy, alternate icons, and notification infrastructure.

App Group: `group.com.ashtonchang.GradeViewer`. The app writes an atomic, protected summary and reloads widget timelines after updates. WidgetKit shows one course in a small widget and up to three in a medium widget. Timeline policy is `.never`: the app explicitly reloads it; there is no network polling in the widget. Hidden courses and courses outside the selected term are excluded. Term selection and successful refreshes update the shared summary. A stale summary is labeled with its age.

## Validation boundaries

Core tests run on macOS with `swift test`. Hosted iOS tests use disposable in-memory SwiftData, test Keychain items, and a simulator-only App Group fixture. XCTest drives the UI from CLI; no computer-use tools are used. HTTP tests use URLProtocol stubs, never real schools. Production provider success, district/session expiry, server latency, and rate-limit behavior cannot be inferred from fixtures. See PROJECT_STATUS.md for actual results.
