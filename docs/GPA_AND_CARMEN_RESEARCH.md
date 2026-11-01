# GPA and OSU Carmen investigation — November 1, 2026

This is an investigation requested by the owner. Neither feature is implemented. The initial phase used source and official documentation only. In a follow-up, the owner supplied a portal transcript image for private comparison; its records and GPA values are not copied into this repository. No live student account, credentials, browser cookies or provider responses were accessed. Carmen is a requested possible scope expansion; the released app remains Schoology-only.

## Recommendation

Build a small **estimated semester GPA** feature for Schoology first. Show unweighted and weighted results together above the Grades course grid, with an expandable course breakdown and local settings. Suggest course levels from names, allow corrections, and make credits and grading rules explicit. The requested A values are 4.0 regular, 4.5 Honors and 5.0 AP; unweighted A remains 4.0 for every course.

CarmenCanvas has the necessary general API capabilities for a grade viewer, but **OSU access and session lifecycle remain unverified**. Disabled personal token creation blocks the token-paste setup; it does not establish that own-session cookie reads are impossible. Upstream Canvas source supports session authentication. A small personal cookie-session proof is worth investigating before a broad provider refactor; distribution should follow Canvas's documented OAuth requirements. A local calculator with manually entered course grades/credits could work independently of Carmen access.

## Schoology: available data and current gaps

| Input | Official documentation | Current GradeViewer behavior / implication |
| --- | --- | --- |
| AP/Honors designation or GPA bonus | No dedicated field found in the documented Course, Course Section or Grading Scales contracts. This does not prove that every internal/district integration lacks one. | Use a name-based suggestion plus a persistent local override. Do not treat category/period weights as GPA bonuses. |
| Course names | Section responses document `course_title` and `section_title`. | `parseSection` retains the first available title as `fields.course_name`; preserve both original names for matching when implementing. |
| Credits | Parent Course documents optional `credits`; Section responses document `course_id`. | No parent-course resource is currently exposed by the Worker, and the normalized model has no credit field. Try optional cached parent metadata only after proving student permission; provide manual credit entry. |
| Percentage-to-letter scale | Grading Scales includes levels with `grade`, `cutoff` and `average`. | Scale payloads can be cached, but the parser currently uses type/hide-numeric metadata to interpret numeric totals, not a GPA conversion table. Letter cutoffs are distinct from letter-to-GPA points. |
| Course grade / period | User Grades supplies period and final records. | Each section can produce quarter, semester, exam and year records. Select one appropriate semester result per physical course; do not average every record. |

Official sources: [Course](https://developers.schoology.com/api-documentation/rest-api-v1/course/), [Course Section](https://developers.schoology.com/api-documentation/rest-api-v1/course-section/), [Grading Scales](https://developers.schoology.com/api-documentation/rest-api-v1/grading-scales/) and [User Grades](https://developers.schoology.com/api-documentation/rest-api-v1/user-grades/). These establish documented fields, not their presence or accessibility in the owner's district.

### Suggested course-level detection

Use only original course/section names, with case-insensitive whole-word matching:

- `AP` or `Advanced Placement` suggests AP.
- `Honors` (optionally `Honours`) suggests Honors.
- An ordinary name suggests Regular. Absence of a marker is a fallback assumption, not verified course classification.
- Do not match substrings such as `ap` in `Applied` or `Capstone`. `AP Capstone` does match.
- Explicitly guard `Pre-AP` / `Pre AP`; they must not receive an AP bonus. Abbreviations such as `H`, `HN`, `HNR`, `ACP`, dual enrollment and ambiguous/conflicting names need a manual choice rather than a guessed bonus.

Suggested levels should be visible in the GPA breakdown. A Regular/Honors/AP selector overrides detection, survives refresh/title changes, and is keyed by account and canonical physical course identity, not title. GPA inclusion is its own setting: hiding a card must not silently change GPA. Keep overrides browser-local and clear them with account disconnect.

### Calculation rules

For included courses with usable grades and positive credits:

```text
unweighted GPA = sum(credits × unweighted grade points) / sum(credits)
weighted GPA   = sum(credits × weighted grade points)   / sum(credits)
```

A reasonable proposed high-school preset uses A/B/C/D/F = 4/3/2/1/0 and adds +1.0 for AP or +0.5 for Honors to eligible passing grades. That gives:

| Grade | Unweighted / Regular | Honors | AP |
| --- | --- | --- | --- |
| A | 4.0 | 4.5 | 5.0 |
| B | 3.0 | 3.5 | 4.0 |
| C | 2.0 | 2.5 | 3.0 |

For example, equally credited A grades in one AP, one Honors and one regular course yield **4.50 weighted / 4.00 unweighted**. For unequal credits, use the formula above rather than averaging course point values equally.

The initial A values came from the owner's request; the generic proposal is superseded for Dublin by the verified district table below. Other districts still need their own policy. Never convert a percent by multiplying it by 4/100 or 5/100.

### Dublin policy and private transcript follow-up

The current [2026–2027 Academic Programs and Pathways guide](https://www.dublinschools.net/fs/resource-manager/view/9fee7ad1-f701-493e-96cf-32b6901e5015), linked from [district scheduling](https://www.dublinschools.net/departments/teaching-learning/high-school-families/high-school-scheduling), page 76, supplies this public table. The relevant page was rendered and visually inspected because its scale tables are images and ordinary text extraction omits their contents.

| Grade | Published percent band | Conventional / unweighted | Honors | AP/IB/eligible CCP/CTAG |
| --- | --- | --- | --- | --- |
| A | 93–100 | 4.00 | 4.50 | 5.00 |
| A- | 90–92 | 3.67 | 4.17 | 4.67 |
| B+ | 87–89 | 3.33 | 3.83 | 4.33 |
| B | 83–86 | 3.00 | 3.50 | 4.00 |
| B- | 80–82 | 2.67 | 3.17 | 3.67 |
| C+ | 77–79 | 2.33 | 2.83 | 3.33 |
| C | 73–76 | 2.00 | 2.50 | 3.00 |
| C- | 70–72 | 1.67 | 2.17 | 2.67 |
| D+ | 67–69 | 1.33 | 1.33 | 1.33 |
| D | 63–66 | 1.00 | 1.00 | 1.00 |
| D- | 60–62 | 0.67 | 0.67 | 0.67 |
| F | 59 and below | 0.00 | 0.00 | 0.00 |

The guide explicitly withholds the Honors/AP-family bonus for **D+ and below**. Its published plus/minus values use 3.33/3.67-style steps; do not reuse OSU's 3.3/3.7 table. The transcript comparison agrees with the published point table, credit weighting, exclusion of satisfactory/non-GPA credit and eligible college-course bonuses at the displayed precision. This is evidence from one owner-supplied image, not a live portal/API check. It does not establish whether internal arithmetic uses the published two-decimal points or more precise thirds, or how fractional percentages are rounded at a letter boundary. No personal rows, identities, credit totals, quality-point totals or GPA results are retained here or as fixtures.

The transcript's Weight values behave as GPA credit weights in this comparison, rather than the AP +1.0 or Honors +0.5 difficulty bonus. This is not a verified API field contract. Graduation/earned credit and GPA denominator credit must be distinct: non-GPA satisfactory credit can count toward graduation, while a failure must not disappear merely because it earns zero credit. Repeated rows for separate semesters must remain separate transcript contributions; only multiple provider views of the same course-semester are deduplicated. High-school credit earned before ninth grade and completed college coursework can affect cumulative GPA even when absent from current Schoology enrollments. In-progress rows cannot be treated as completed transcript grades.

The district's [CCP policy](https://www.dublinschools.net/departments/teaching-learning/high-school-families/college-credit-plus) assigns equivalent AP/IB weight in like subjects, with an explicit unweighted financial-literacy counterexample. Therefore CCP cannot be classified solely by an `AP`/`Honors` name search or a universal college-course bonus. Preserve a general 5.0-course override and confirmed GPA inclusion; labels may distinguish AP/IB/CCP/CTAG without adding calculator complexity. High-school transcript credits are not automatically college semester hours for a future OSU GPA calculation.

The same guide describes S/U transfer grades as outside GPA, and the current [school counseling page](https://jerome.dublinschools.net/about/counseling) describes a PE waiver as carrying no grade/credit and Withdrawal Fail as counting as failure. The image supports satisfactory/waiver exclusions; it does not validate every exceptional mark or withdrawal rule. Confirm provider representation and numeric grade-rounding rules before implementing them.

Implementation behavior should be conservative:

1. Reuse canonical physical identities and period association. Count a section's semester once, with its allocated semester credits. Never include its quarter/exam/year totals again. A catalog course's annual credits cannot be applied in full to both semesters without a confirmed allocation.
2. Prefer an interpretable provider-reported letter for that same semester, otherwise a supported semester percent plus a verified or user-confirmed cutoff table. A course's percent-to-letter scale does not establish the district's GPA point table. If letter and percent conflict, expose the mismatch rather than quietly choosing a more favorable grade.
3. Distinguish missing/unsupported grades from real zero or F. Exclude missing, pass/fail and unsupported rows with a visible reason/count. If an expected GPA course lacks a grade or credits, label any computable result partial. No eligible courses means unavailable, not 0.00. An explicit equal-course mode can use equal weights when credits are unknown; label the assumption rather than pretending they are verified credits.
4. Keep baseline GPA separate from hypothetical grade scenarios. For the first version, use baseline course grades only. Do not silently incorporate local assignment changes or asterisked missing-quarter estimates. Any later scenario mode must reuse existing baseline/delta guards and say What-If.
5. Describe the result as an estimated semester GPA. Current Schoology enrollments do not establish an entire transcript, historical grade replacements, all past credits or an official cumulative GPA. If cumulative projection is later requested, accept prior quality points and GPA hours explicitly; do not average term GPAs without their credit denominators.
6. Round only the final displayed GPA. Store settings with account-bound local state, retain them through reconciliation/refresh/update, and preserve the current saved-data/failure behavior.

Synthetic checks for implementation: regular/Honors/AP A values; mixed grades; fractional/unequal credits; no substring or Pre-AP false positives; override persistence; missing and zero grades; exclusion/partial counts; zero denominator; plus/minus/rounding boundaries; one contribution across quarter/semester/exam/year aliases; year-to-semester credit allocation; hidden-card independence; and isolation from hypothetical changes.

### Smallest implementation path

- Add a framework-independent GPA module under `web/src/core/`; keep selection/conversion/calculation there. Reuse `physicalKey`, `semester` and `overall` from `periods.ts`, with an explicit same-semester scope and ambiguity guards instead of assuming the visible card list is a complete GPA roster.
- Extend account-bound local state with policy and per-course inclusion/level/credit overrides. Update persistence/reconciliation/prepared-save/cross-tab paths together; do not add Worker storage for GPA or change the existing credential vault.
- Start with existing titles/grades and editable credits. Optional parent-course credit recovery can follow without blocking fresh grade reads. If added, derive parent IDs from verified enrolled-section metadata, cache/deduplicate by parent course, keep fixed GET routes, and validate credit scope/permission before use. Do not create an arbitrary course-ID/URL forwarding route.
- Add the compact Grades summary and expandable breakdown. The detail should show selected semester, grade, points, credits, level and omissions so users can check the result. Run focused core/persistence tests, build, synthetic Chromium/WebKit flows and release/template checks appropriate to the eventual code changes.

## OSU CarmenCanvas

### Official API access

[OSU's Carmen site](https://carmen.osu.edu/) confirms that CarmenCanvas uses Canvas. However, OTDI's **May 8, 2026** notice says the ability to create personal access tokens has been disabled. The notice says authorized external tools can still work; it does not grant this project authorization or establish that previously created tokens remain usable. [Official token notice](https://it.osu.edu/news/2026/05/08/carmencanvas-personal-access-tokens-disabled).

Canvas's supported application route is OAuth 2.0 using an institution-issued developer key/client ID and secret. Tokens expire and require refresh handling. OSU's published integration process involves OTDI and security/accessibility review; its exact applicability and approval path for this personal, read-only viewer must be established with OSU. LTI approval alone should not be assumed to grant arbitrary student REST API access. [Canvas OAuth overview](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth), [OAuth endpoints](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints), [OSU integrations](https://teaching.resources.osu.edu/toolsets/carmencanvas/guides/carmen-integrations).

For a future single-user prototype, a separately approved key and registered callback to that user's Worker could fit the ownership model. Whether OSU will issue one is unknown. For distribution, copying a common confidential client secret into every user's Worker is not an acceptable design. Registered callbacks and client ownership must fit the existing per-user hosting constraint; do not introduce a shared maintainer authentication service without a separate product decision. No outreach was sent in this investigation.

For the OAuth route, the useful external question is concrete: **Will OSU authorize a student-owned, self-hosted, read-only Canvas API application, issue/enable a scoped developer key, and permit its per-user Worker callback?** The published support contact is `carmen@osu.edu`. No outreach was sent. The owner separately requested investigation of own-session cookies; that distinct technical option is evaluated below, rather than treating OAuth credentials as the only conceivable way to make a request.

### Own-session cookies and the retired Infinite Campus implementation

**Finding: technically plausible, not verified against OSU.** Canvas's current [authentication implementation](https://github.com/instructure/canvas-lms/blob/master/lib/authentication_methods.rb), `load_user`, falls back to a validated browser session when no token-authenticated pseudonym exists. Its [request-forgery protection](https://github.com/instructure/canvas-lms/blob/master/lib/canvas/request_forgery_protection.rb) accepts GET/HEAD requests without a CSRF token. This supports a read-only cookie-session experiment using existing Canvas JSON resources rather than HTML scraping. It does not prove OSU's deployed configuration, session portability/lifetime or permission for a third-party integration. OSU's token-creation notice does not address or establish a ban on cookie authentication.

Git history confirms the owner's recollection:

- `825ed0b` added a manual Cookie-request-header import fallback, scoped to one selected HTTPS Campus origin. It could not infer expiry or renew SSO by itself. [Historical parser](https://github.com/fiukewhfkje/GradeViewer/blob/825ed0bad4a20c4668fbed6930b10be18d261103/Sources/GradeCore/CampusCookies.swift).
- `b0fdea5` added a retained, nonpersistent `WKWebView` for normal interactive sign-in, browser-cookie capture, scoped Campus/identity-provider cookie records and Keychain persistence. `73f0150` hardened renewal/recovery. The native HTTP client selected scoped cookies and retained response rotations. [Last pre-removal browser implementation](https://github.com/fiukewhfkje/GradeViewer/blob/1761c0fc7b4da944a6d551b453cd016ac472e052/GradeViewer/CampusWebSession.swift), [transport](https://github.com/fiukewhfkje/GradeViewer/blob/1761c0fc7b4da944a6d551b453cd016ac472e052/Sources/GradeCore/Networking.swift).
- Historical research records a successful forced SSO renewal and relaunch reuse on the owner's phone. It explicitly does not establish indefinite session lifetime. This is previous Campus evidence, not a new Carmen test. [Recorded evidence](https://github.com/fiukewhfkje/GradeViewer/blob/07a2616/RESEARCH.md).

The old mechanism depended on a native app's privileged WebKit cookie store and Keychain. The current GradeViewer PWA has neither. A `workers.dev` page cannot read cookies belonging to `osu.instructure.com` or inspect a cross-origin sign-in window; HttpOnly also prevents script access to protected cookies. Browser Fetch does not let application code supply a raw Cookie header. Opening Carmen in another tab does not transfer its session to the Worker. These are capture/transport boundaries, not proof that a server-side request with a valid session would fail. [Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy), [HttpOnly cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie), [forbidden request headers](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header).

Two personal-experiment designs are possible:

1. **Explicit manual session import to the user's own Worker.** A local tool or deliberate export can supply only necessary Carmen-origin cookies to a protected HTTPS setup action; keep them encrypted in a separate provider vault record. The Worker can make fixed-host GETs independently of browser CORS and manage response-cookie rotations. Verify identity and a complete snapshot before activation; retain the old snapshot on expiry/failure. This is the smallest portability experiment, but it may need repeated user sign-in/import and is not equivalent to refresh-token renewal. Never put session values in chat, source, logs, URLs, browser grade storage or a maintainer service. Do not export broader OSU identity-provider/SSO cookies just to recreate the native renewal behavior in Cloudflare.
2. **A browser companion that operates in Carmen's signed-in context.** An explicitly installed extension/local helper could mediate selected read-only data or cookie transfer after normal user login/MFA. That adds installation and phone-compatibility work and changes the current PWA-only onboarding. An extension that returns permitted grade data to the user's app could avoid sending session cookies to Cloudflare, but its permissions and account binding still need design. Do not revive retired native tooling to test this idea.

For either experiment, first prove an own-account identity read, enrolled courses and one complete visible grade/assignment read; then check cookie rotation, logout/expiry detection, re-login, Worker portability, rate limits and failure retention. Do not claim an OSU TTL, IP/device binding or natural expiry behavior without measuring it. OSU documents BuckeyePass MFA for sign-in; session reuse cannot guarantee unattended renewal when another challenge is required. [OSU student guide](https://teaching.resources.osu.edu/toolsets/carmencanvas/guides/getting-started-carmen-students).

Technical success is separate from institutional/product support. Canvas's [OAuth documentation](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth) says applications used by multiple users must use OAuth. The reviewed OSU pages do not settle the acceptability of this personal session-export experiment. Keep the recommendation for distribution on the OAuth route and distinguish an unsupported personal proof from an approved general Carmen integration. No cookies were captured/imported and no live proof or session renewal was attempted in this investigation.

### What an approved adapter would read

| Purpose | Candidate Canvas GET resource | Important boundary |
| --- | --- | --- |
| Verify connected identity | `/api/v1/users/self/profile` | Bind all reads to the authenticated student; confirm this scope in the approved key. |
| Courses and course totals | `/api/v1/courses?enrollment_type=student&include[]=total_scores&include[]=term` | Permission/hidden-total settings affect returned data. Filter actual student enrollments and the chosen academic term. |
| Own enrollment grades | `/api/v1/users/self/enrollments` | Use only own enrollments; duplicate section enrollments must not create multiple GPA contributions for one Canvas course. |
| Assignments and own scores | `/api/v1/courses/:id/assignments?include[]=submission` | Missing/unposted/permission-limited data remains missing. No roster or other-student submission reads are needed. |
| Category weights/drop rules | `/api/v1/courses/:id/assignment_groups` | Canvas supports `drop_highest` and `never_drop` as well as `drop_lowest`; the present Schoology calculator cannot blindly represent all of these. |
| Letter cutoffs when accessible | `/api/v1/courses/:id/grading_standards` | Read the applicable course grading standard; no university-wide percent cutoff should be invented. |

References: [Users](https://developerdocs.instructure.com/services/canvas/resources/users), [Courses](https://developerdocs.instructure.com/services/canvas/resources/courses), [Enrollments](https://developerdocs.instructure.com/services/canvas/resources/enrollments), [Assignments](https://developerdocs.instructure.com/services/canvas/resources/assignments), [Assignment Groups](https://developerdocs.instructure.com/services/canvas/resources/assignment_groups) and [Grading Standards](https://developerdocs.instructure.com/services/canvas/resources/grading_standards). These are API candidates, not student-account acceptance evidence.

Start with authoritative visible course totals and assignments. Distinguish Canvas current totals from final totals and actual registrar-posted grades; a field named `final_grade` does not by itself prove a finalized transcript result. Add hypothetical calculations only for tested supported Canvas rules. Keep assignment due dates distinct from score-change dates when constructing history.

The current Worker is fixed to Schoology OAuth 1.0, host/path rules and JSON pagination. Canvas needs a separate fixed-host transport with scoped OAuth token storage/refresh, authorization-state/callback checks, approved GET paths, complete snapshots, safe redirects, [Link-header pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination), and bounded request/retry budgets. Retain the existing Schoology vault/URL/password/session boundary; provider-specific credentials and account/course identity must never collide. Reuse the UI/local storage concepts, not Schoology payload parsing or its authentication signer. No general plugin framework is needed for just a second provider.

### OSU GPA is a separate preset

Use credit-hour weighting with OSU's undergraduate points: **A 4.0, A- 3.7, B+ 3.3, B 3.0, B- 2.7, C+ 2.3, C 2.0, C- 1.7, D+ 1.3, D 1.0, E/EN 0.0**. Do not apply the high-school AP/Honors bonus to OSU courses. The Registrar's GPA formula excludes EM, I, IX, K, KD, NG, P, PA, NP, R, S, U and W; zero listed grade points alone does not mean a mark belongs in the GPA denominator. Other exceptional marks must follow their documented inclusion rules. [Registrar transcript key](https://registrar.osu.edu/student-hub/transcripts-and-verifications/transcript-key/), [Registrar GPA and grading policies](https://registrar.osu.edu/policies-information/university-policy/buckeyes-guide-to-academic-policies/).

The reviewed standard Canvas Course contract does not document registrar credit hours. Accept credit hours from the student's schedule unless a permitted reliable source is verified. Course codes/names do not establish them. Carmen grades can support a current-term projection; official cumulative GPA, transfer/exam credit treatment and grade forgiveness require registrar data beyond an LMS snapshot. The Registrar's numerical percent table is labeled **Law Only** and must not become a universal undergraduate cutoff table.

## Evidence and remaining work

Reviewed current models, parsing, period selection, calculator/scenario rules, refresh/metadata, browser persistence and Worker transport/route boundaries, plus the official sources linked above. The follow-up also reviewed the owner's supplied image privately, visually inspected the public district guide's grading page, and inspected retired Campus source/history plus current upstream Canvas authentication code. Only public policy and general implementation findings enter the repository. Whitespace and local-document link checks cover these documentation changes; no app build/test, live Schoology/Carmen read, cookie capture, OAuth authorization, new physical-device check or deployment is claimed.

Before GPA implementation: use the public Dublin point/bonus table, confirm remaining numeric rounding/provider representation and per-course semester credits, then implement and test the small local feature. For Carmen, the next useful experiment is a narrow own-session read rather than assuming cookies cannot work; validate lifetime/reconnect behavior and policy separately from request success. OAuth remains the documented distribution route, with client/callback ownership to resolve for per-user deployments. Current policies should be checked again before the owner's next academic year.
