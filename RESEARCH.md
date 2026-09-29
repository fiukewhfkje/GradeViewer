# Research notes

Researched September 29, 2026. Classifications: **documented** means published by the provider; **public client evidence** means visible source/client behavior; **tested locally** means fixtures or simulator; **student verified** means tested with this user's real authenticated account. No student-verified provider requests have been made yet.

## Infinite Campus: chosen path

Campus's [OneRoster API documentation](https://kb.infinitecampus.com/help/oneroster-api) describes access for third-party systems given integration credentials. It does not supply a public student OAuth grant. District/vendor integration is a different authority from the student's portal login. No district credential, paid integration, or GradeViewer backend is assumed.

The official [parent/student help](https://www.infinitecampus.com/support/parents-and-students) documents district-specific Campus Student login and the normal mobile Stay Logged In option. The [Campus Student Portal guide](https://kb.infinitecampus.com/help/campus-student-portal) describes current grade/assignment tools and recent score/grade updates. It does not publish a student JSON API contract, session TTL, or renewal token protocol.

Public source evidence supports trying these authenticated browser resources relative to the district's application base:

- `GET resources/portal/grades`
- `GET resources/portal/grades/detail/{course._id}`
- `GET resources/portal/roster` (not needed by the initial app)

Sources: [Grades++ service worker](https://github.com/jonathanjma/Infinite-Campus/blob/main/extension/service_worker.js), [its detail parsing](https://github.com/jonathanjma/Infinite-Campus/blob/main/extension/pages/class.js), and [unofficial Node client](https://github.com/tonyzimbinski/infinite-campus/blob/master/index.js). GitHub reported last pushes January 16, 2024 and August 30, 2024 respectively. These are **historical public implementations**, not proof of compatibility with the user's 2026 district. The detail identifier is the provider's opaque `_id`, not an assumed section number. Original Swift parsing was written from observed field structure; no third-party implementation was copied.

License/reuse decision: Node client is GPL-3.0 and uses the deprecated `request` ecosystem; Grades++ has no declared license. Neither is a suitable dependency or source for copying into this native app. Their endpoints and field observations inform independent integration research. Apple's URLSession/WebKit are sufficient for the small read-only adapter.

The Node client's `verify.jsp` login sends credentials in a query string. It is deliberately **not implemented**. GradeViewer opens the exact student portal page; the student handles login/SSO normally, then the app stores only same-origin session cookies in Keychain. The public source also shows old `prism` notification reads, worth validating for Muse but not blindly using as a current contract.

Apple's [WKWebsiteDataStore documentation](https://developer.apple.com/documentation/webkit/wkwebsitedatastore) supports a nonpersistent store with WKHTTPCookieStore. [ASWebAuthenticationSession's documented workflow](https://developer.apple.com/documentation/authenticationservices/authenticating-a-user-through-a-web-service) requires a cooperating authentication callback. A normal Campus portal cookie session does not establish that callback. A district SSO provider may reject embedded views; actual user flow remains a validation gate.

## Documented calculation caveat

[Campus Portal Setup](https://kb.infinitecampus.com/help/portal-setup-admin) states that teachers can hide portal assignments/scores while including them in the calculation. This is a provider capability, **not an observation about this student's account**. GradeViewer never fabricates hidden assignment rows. The app only reports a calculation mismatch when its actual visible data cannot reproduce the reported grade. Unsupported grading rules are similarly evidence-based; source overall grades remain the display authority.

## Schoology

[Authentication documentation](https://developers.schoology.com/api-documentation/authentication/) describes OAuth 1.0 and personal two-legged keys, with an empty `oauth_token`, as well as three-legged token/secret credentials. The app supports both input formats, HMAC-SHA1 signing, and freshly signed `/users/me` redirects. No raw Schoology password is needed.

Read-only initial adapter endpoints:

| Endpoint relative to `https://api.schoology.com/v1/` | Purpose |
| --- | --- |
| `users/me` | Identify the authorized user |
| `users/{id}/sections` | Enrolled sections, following pagination |
| `sections/{id}` | Course title and grading configuration |
| `users/{id}/grades?section_id={section}` | Student grades, period totals |
| `sections/{id}/grade_items` | Assignment/discussion/assessment metadata |
| `sections/{id}/grading_categories` | Category methods, weights, drop count |

Sources: [User](https://developers.schoology.com/api-documentation/rest-api-v1/user/), [Course Section](https://developers.schoology.com/api-documentation/rest-api-v1/course-section/), [Grade](https://developers.schoology.com/api-documentation/rest-api-v1/grade/), [Assignment](https://developers.schoology.com/api-documentation/rest-api-v1/assignment/), [Grading Categories](https://developer.schoology.com/api-documentation/rest-api-v1/grading-categories/). Permissions must be verified for this student's keys. Missing optional metadata is not silently interpreted as complete grading rules. The initial app uses full successful provider snapshots on launch/manual refresh; incremental watcher logic is separate.

The grades documentation offers a `timestamp` changed-since query. [Event Triggers](https://developers.schoology.com/api-documentation/rest-api-triggers-v1/) requires school admin Trigger UI access. [Receiving Event Objects](https://developers.schoology.com/api-documentation/rest-api-triggers-v1/event_objects/) includes grades-save events, making webhooks preferable **if** a district grants the needed access. Student credentials alone do not establish that authority. [Reminders](https://developers.schoology.com/api-documentation/rest-api-v1/reminders/) is not documented as a complete grade-change log.

[PowerSchool system requirements](https://uc.powerschool-docs.com/en/schoology/latest/system-requirements) publishes a default bucket of 50 public API credits, refilled every five seconds; GET costs one, and exhausted requests return 429/Retry-After. This is a published default, not observed throughput for this account. Campus student-portal limits were not found. See MUSE_WATCHER_REPORT.md for responsible request estimates and verification gates.

## Bessy and the supplied references

The [Bessy website](https://www.bessy.io/) documents What-If, grade charts, dark mode, and iOS grade-change notifications. The [blog index](https://www.bessy.io/blog) dates the iOS release March 14, 2023, Android announcement March 21, notifications August 22, final calculator December 5, and Campus web-login guide September 19, 2024. [App Store listing](https://apps.apple.com/app/id6445881079) publicly describes grades, simulation, progression, widgets, final calculator, and dark mode; this is feature research, not a guarantee of current distribution or ownership.

The [Campus web-login guide](https://www.bessy.io/blog/how-to-infinite-campus) explains that a mobile login is used to generate a code for its web client because Campus does not provide the equivalent Schoology web login mechanism. It does **not** disclose a supported student OAuth contract or enough detail to reproduce Bessy's private login internals. No code-generation transfer or Bessy service is reused.

[Notification history](https://www.bessy.io/blog/notifications) describes three notification styles and the original paid feature. GradeViewer omits paid tiers and 24/7 push infrastructure per the brief. Muse may independently implement checking later. No alternate icons, ads, planning, accounts, analytics, or premium gates are included.

The user's screenshots are the main layout reference: grades first, simple course sheet, progression graph with held-point grade/date, recent assignments, menus for edit/drop/reset/restore, collapsible categories, and shared hypothetical course result. GradeViewer implements these with original code and assets. Screenshots were viewed directly; proprietary Bessy code, images, icons, credentials, and binaries were not accessed.

## Remaining live verification

The student's Schoology credentials and exact Campus Student portal URL/login must be entered locally. Then verify actual JSON field names, complete pagination, current/enrolled terms, task identifiers, teacher metadata, letter/rubric grades, timezone, category rules, and known scores. Measure session renewal/expiry and request latency/size with redacted metrics. Do not change status to student verified until those checks actually succeed. A simulator fixture pass only validates our interpretation of the synthetic schema.
