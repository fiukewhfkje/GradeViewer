> Scope update (October 8, 2026): the user authorized removing all IC integration if the assignment audit established parity. That condition is met in the captured account; GradeViewer is now Schoology-only. Prior widget/Muse/deployment instructions below remain superseded by later explicit preferences and current AGENTS.md.

# Current scope override — October 8, 2026

The user removed the dedicated What-If calculator button/page and the ± score controls. Course options should instead open an Add Grade popup directly, for name, score, and total points. Existing local edit/drop/reset behavior and extra-credit scores remain; added grades must remain accessible in the normal course views. Use a category choice only when the course's actual weighting requires it. The historical What-If page requirements below are superseded.

The user explicitly removed the widget and all its dependencies. The original widget requirements and screenshot routes below are historical and superseded. Preserve the original student's installed app identity/session while making new clones independently configurable; never distribute credentials or grade caches.

Build a native iOS app called GradeViewer.

Repository name: GradeViewer
App name: GradeViewer

You have broad autonomy. This project may span multiple Codex sessions over the next several days, so work incrementally, leave the repository in a clean state, and maintain enough documentation that a future Codex session can continue without needing the original chat.

Do not ask me minor implementation or design questions. Research uncertain technical details yourself and choose the simplest reliable approach.

Only stop for me when you genuinely need:
- credentials that I must enter locally,
- an Apple signing / Developer Mode / trust action,
- an external account action only I can perform,
- or a major product decision that materially changes scope.

Otherwise, keep working.

==================================================
PRODUCT GOAL
==================================================

GradeViewer is a very simple, fast, native iPhone grade viewer.

It should be conceptually similar to Bessy:

- open app
- immediately see current grades
- tap a course
- see its grade, grade history, recent assignments, categories, etc.
- useful What-If / grade calculator features
- no ads
- no subscription
- no premium lockouts
- no unnecessary complexity

This is NOT a startup or SaaS product.

Do not build:
- user accounts
- a hosted grade database
- social features
- AI features
- a school planner
- an LMS replacement
- unnecessary backend infrastructure

The iPhone app should work independently and locally.

==================================================
BESSY RESEARCH
==================================================

Before or while implementing, research Bessy's publicly documented current and historical functionality.

Use legitimate public sources such as:
- Bessy's website
- Bessy's blog / FAQ
- App Store listing
- public screenshots
- public release notes / version history
- older public pages where useful
- public reviews

The Bessy screenshots attached to this Codex task are an important visual reference.

Research Bessy/Bessy+ features so useful functionality is not accidentally omitted.

Do NOT:
- decompile Bessy
- extract proprietary source code
- bypass its security
- copy its branding/logo/assets
- reuse proprietary artwork

This is an independent implementation.

==================================================
UI: KEEP IT VERY SIMPLE
==================================================

Use the attached Bessy screenshots as the main reference for screen structure, information hierarchy, simplicity, and density.

It is okay for GradeViewer to be quite similar in overall layout philosophy to Bessy because the goal is specifically to avoid overdesigned AI-generated UI.

However:
- use original code
- use original iconography/assets
- do not copy Bessy branding
- do not attempt a literal copyrighted pixel-perfect reproduction

The desired UI should remain very simple.

Think:
- course list
- grade prominently visible
- simple course-detail screen
- grade graph
- recently graded assignments
- settings
- calculators / What-If when requested

DO NOT add random filler copy.

Absolutely avoid AI-generated text like:
- "Stay on top of your academic journey"
- "Welcome back!"
- "Track your academic success"
- "Your progress at a glance"
- inspirational copy
- obvious explanatory subtitles
- redundant descriptions

Most screens should contain almost entirely:
- actual grade data
- useful labels
- useful controls

Do not add content merely to fill space.

Avoid:
- excessive gradients
- glassmorphism
- giant rounded cards everywhere
- excessive shadows
- giant hero headers
- decorative stats
- streaks
- achievements
- random insight cards
- unnecessary icons
- excessive animation
- excessive colors
- unnecessary dashboards
- nested card layouts

Use typography, spacing, alignment, subtle color, and native iOS conventions to create polish.

When uncertain whether something should exist, REMOVE IT.

Before considering each screen done, do a deletion pass:
- remove unnecessary text
- remove redundant labels
- remove unnecessary cards
- remove decorative clutter

==================================================
APP ICON
==================================================

Create one clean GradeViewer app icon.

No alternate icons.

Keep it:
- minimal
- clean
- recognizable at small sizes
- suitable for modern iOS
- original

Avoid cheesy graduation-cap / school-book clip-art.

A subtle grade/chart/data concept is fine.

==================================================
IOS IMPLEMENTATION
==================================================

Use native SwiftUI.

Prefer Apple's own frameworks:
- SwiftUI
- URLSession
- Keychain
- SwiftData and/or SQLite
- Swift Charts
- WidgetKit
- App Groups where needed
- UserNotifications only where locally useful

Minimize third-party dependencies.

Do not introduce a dependency without a real reason.

Optimize for:
- fast launch
- low complexity
- reliability
- smooth scrolling
- easy maintenance

==================================================
LOCAL-FIRST ARCHITECTURE
==================================================

GradeViewer itself should have no required backend.

Sensitive information:
→ store in iOS Keychain

Examples:
- Schoology API credentials
- Schoology session/auth material
- Infinite Campus session/auth material

Ordinary app data:
→ SwiftData or SQLite, whichever is simpler and more reliable

Examples:
- courses
- assignments
- categories
- current grades
- provider mappings
- grade history
- What-If state
- refresh metadata

Small settings:
→ UserDefaults where appropriate

Widget data:
→ local App Group/shared container

Do not add:
- Cloudflare
- Firebase
- Supabase
- Postgres
- remote user accounts
- hosted grade storage

unless an unavoidable technical requirement emerges.

==================================================
REFRESH BEHAVIOR
==================================================

The app should feel instant.

On launch:

1. display cached local grades immediately
2. asynchronously refresh Schoology / Infinite Campus
3. normalize any new data
4. update the UI

Also support pull-to-refresh.

If the network or one provider fails:
- keep showing last known grades
- show a subtle useful status if needed
- do not wipe cached data

The app itself does NOT need to continuously poll in the background for instant notifications.

A separate Muse Linux watcher will handle that later.

==================================================
SCHOOLOGY
==================================================

Implement Schoology support using current supported mechanisms.

I know how to obtain my Schoology API credentials.

Do not hard-code them.

Do not put them in Git.

Provide a simple local setup screen for entering whatever credentials are necessary and securely store them in Keychain.

Research current Schoology documentation and retrieve useful available data such as:
- courses
- assignments
- scores
- grading categories
- due dates
- overall grade information
- useful timestamps / IDs

Prefer supported APIs and incremental/change-aware mechanisms where possible.

==================================================
INFINITE CAMPUS
==================================================

Infinite Campus support is important.

Research this carefully instead of assuming an old implementation.

I am able to log into Infinite Campus normally as a student.

Determine how a legitimate independent iOS client can authenticate the student's own account and retrieve that student's own grades.

Research:
- official Infinite Campus documentation
- Campus Student behavior
- current student authentication/session behavior
- legitimate public/open-source implementations
- publicly observable current client behavior
- how Bessy publicly describes its Infinite Campus login flow

Prefer:
1. supported/documented authentication
2. normal student-authorized session mechanisms
3. legitimate current client mechanisms

Do NOT:
- bypass authentication
- exploit vulnerabilities
- reuse Bessy's credentials
- decompile Bessy
- blindly use obsolete legacy endpoints

If the preferred method allows the user to authenticate through Infinite Campus directly using a web/system authentication flow, use that.

If a native student-login mechanism is required, implement it carefully and securely.

Store resulting session/token material in Keychain.

Avoid storing the raw password persistently unless genuinely unavoidable.

If the session expires, provide a simple reconnect flow.

==================================================
NORMALIZE SCHOOLOGY + INFINITE CAMPUS
==================================================

Implement provider adapters conceptually like:

SchoologyProvider
InfiniteCampusProvider
        ↓
Normalization/Reconciliation
        ↓
Canonical Grade Model
        ↓
UI

The UI should not care where the data came from.

Useful canonical concepts include:
- Course
- Term
- GradingCategory
- Assignment
- Score
- OverallGrade
- GradeHistorySnapshot
- ProviderProvenance

If Schoology and Infinite Campus contain the same logical assignment/course:
- deduplicate them
- preserve source provenance
- preserve enough raw provider values/IDs for debugging
- do not blindly duplicate the assignment

If provider values disagree:
- retain both internally
- choose a sensible display strategy
- document the reconciliation rule

Do not clutter the normal UI with technical provider details unless they matter.

==================================================
FEATURES
==================================================

Implement the useful publicly documented Bessy / Bessy+ features that are technically reasonable.

Do NOT implement alternate app icons.

There is:
- no premium tier
- no ads
- no subscription
- no "Try Bessy+" UI

Everything implemented is simply available.

Desired features include:

- current course grades
- letter grade where appropriate
- assignment lists
- grading categories
- recently graded assignments
- grade history / progression
- clean grade-over-time chart
- What-If grades
- editing hypothetical assignment scores
- adding hypothetical assignments
- dropping/ignoring hypothetical assignments where appropriate
- final-grade calculator
- calculations respecting weighting/category rules
- manual refresh
- refresh on open
- light mode
- dark mode
- system appearance
- hiding/showing courses if useful
- course ordering if useful
- useful widgets

Also research Bessy's feature history and implement useful features I forgot if they clearly fit the scope.

Do not invent unrelated features.

==================================================
GRADE HISTORY
==================================================

Store grade history locally.

When a course's grade materially changes after a successful refresh, save a snapshot.

Do not create pointless duplicate snapshots.

Use Swift Charts or another native Apple framework.

Keep the chart simple and readable.

It should make it obvious how the grade changed over time.

Do not turn it into an analytics dashboard.

==================================================
WIDGET
==================================================

Create a useful WidgetKit widget.

Keep it visually clean and simple.

Likely useful content:
- class name
- current letter grade / percentage
- maybe freshness/update time if useful

Do not overcrowd it.

Use locally shared App Group data.

The widget must not require a server.

==================================================
NO COMPUTER USE
==================================================

Do NOT use Computer Use.

Do NOT use mouse/keyboard GUI automation.

Use Apple's command-line tooling instead.

Where practical use:
- xcodebuild
- simctl
- devicectl
- XCTest
- other CLI/API-accessible Apple tooling

You MAY use the iOS Simulator, but only through CLI/API-driven workflows.

==================================================
VISUAL SCREENSHOT LOOP
==================================================

You should autonomously inspect and improve the UI.

Use a CLI-driven loop:

edit code
→ build
→ launch in Simulator
→ seed deterministic fake grade data
→ capture screenshot PNG
→ inspect the screenshot visually
→ identify problems
→ fix code
→ repeat

Use realistic fixture data.

Test screens including:
- course list
- course detail
- grade graph
- assignments
- categories
- What-If
- final-grade calculator
- settings
- widget
- empty states
- errors
- long class names
- light mode
- dark mode
- small iPhone layout

Inspect screenshots specifically for:
- unnecessary text
- bad spacing
- awkward wrapping
- bad alignment
- oversized elements
- excessive cards
- ugly graph sizing
- clipping
- poor hierarchy
- AI-generated visual slop

Keep iterating without asking me to manually inspect every screen.

==================================================
PHYSICAL IPHONE
==================================================

When GradeViewer is ready enough, install it onto my physically connected iPhone.

Use CLI tooling wherever possible.

Desired process:

xcodebuild
→ development signing
→ devicectl / supported Apple CLI
→ install GradeViewer
→ launch

If Apple requires an unavoidable one-time manual action such as:
- Apple ID login
- selecting Personal Team
- Developer Mode
- device trust
- Keychain signing approval

stop and tell me exactly what I need to do.

Afterward, continue autonomously.

==================================================
TESTING
==================================================

Write meaningful tests, especially around backend/data correctness.

Test:
- Schoology parsing
- Infinite Campus parsing
- provider normalization
- duplicate matching
- provider disagreement
- category weighting
- What-If calculations
- final-grade calculations
- grade history
- offline cached startup
- expired sessions
- partial provider failure
- long assignment lists
- duplicate IDs / weird source data

Use fixture data so most development can proceed without needing my real credentials.

==================================================
ERROR HANDLING
==================================================

Keep user-facing errors simple.

Examples:
- "Schoology needs to be reconnected."
- "Infinite Campus could not refresh."
- "Showing grades from the last successful refresh."

Do not expose huge technical error dumps in the app.

Keep enough diagnostic logs for development while redacting credentials/secrets.

==================================================
MUSE WATCHER RESEARCH
==================================================

Do NOT implement or deploy the Muse watcher.

Instead, while researching Schoology and Infinite Campus for GradeViewer, investigate the best way for a separate 24/7 Linux service to detect new/changed grades with near-real-time latency.

Muse already has a persistent Linux VM and will implement the watcher itself.

The desired watcher should:
- use normal deterministic code while idle
- use zero LLM/model calls while checking
- wake Muse only after a genuine relevant change
- monitor both Schoology and Infinite Campus if possible
- deduplicate the same grade appearing in both systems
- be cheap
- be near-instant
- avoid unnecessary infrastructure
- avoid aggressively hammering school services

Research in priority order:

1. legitimate webhook/event mechanisms
2. notification/event-history feeds accessible with student auth
3. incremental changed-since endpoints
4. lightweight polling as fallback

Do not assume frequent full-gradebook polling is necessary.

==================================================
MUSE_WATCHER_REPORT.md
==================================================

Create a detailed report at:

MUSE_WATCHER_REPORT.md

This report will be given directly to Muse, which will implement the watcher independently.

Muse specifically needs the report to answer these questions:

1. EXACT ENDPOINTS THAT ACTUALLY WORK

Document which Schoology and Infinite Campus endpoints/mechanisms actually worked with the user's normal student authentication.

For every useful endpoint include:
- purpose
- HTTP method
- endpoint/path
- authentication requirements
- important query parameters
- whether it is documented/supported or merely publicly observable
- whether it appears appropriate for periodic checking

Clearly distinguish:
- verified working behavior
- documented behavior not personally verified
- assumptions/inferences

2. LOGIN / SESSION BEHAVIOR

For BOTH providers, document:

- how initial authentication works
- what credentials/material are supplied
- what authentication returns
- token/cookie/session structure at a high level
- what must be persisted
- how long the session appears to last
- whether expiration time is known
- how expiration presents itself
- whether refresh/renewal is available
- exactly how renewal works
- whether full re-login is eventually required
- how Muse should detect a dead session

Do not put real secrets into the report.

3. REDACTED REQUEST/RESPONSE EXAMPLES

Include a few concrete examples of the requests that matter most to the watcher.

For example:
- authentication/session establishment where appropriate
- checking for recently changed grades
- checking a provider notification/event feed
- fetching the detailed grade after a change is detected

Show representative requests and trimmed representative responses.

REDACT:
- API keys
- passwords
- cookies
- tokens
- student IDs if sensitive
- session IDs
- personal grade data

Use placeholders such as:

<REDACTED_TOKEN>
<STUDENT_ID>
<COURSE_ID>

The examples should still contain enough structural detail that Muse can implement the calls correctly.

4. RATE LIMITS / OBSERVED BEHAVIOR

Document:
- official rate limits if published
- observed throttling if encountered
- errors returned when requesting too quickly
- request latency
- response size where relevant
- caching behavior
- whether polling every 5s / 15s / 30s / 60s appears responsible
- recommended cadence
- provider-specific concerns

Do not invent rate limits.

If no official rate limit can be found, say so explicitly.

==================================================
ADDITIONAL MUSE REPORT CONTENT
==================================================

Also include:

- recommended overall architecture
- recommended Schoology detection mechanism
- recommended Infinite Campus detection mechanism
- fallback strategy if event feeds are unavailable
- expected request volume
- minimal state Muse must persist
- simple SQLite schema if useful
- provider deduplication strategy
- cross-provider deduplication strategy
- handling a grade appearing in Schoology first and Campus later
- handling score edits
- handling deleted/removed grades if relevant
- authentication failure behavior
- reconnect behavior
- security recommendations
- sanitized GradeChanged event format
- implementation pseudocode
- recommended deployment style for a persistent Linux VM

A useful event might resemble:

{
  "type": "grade_changed",
  "course": "...",
  "assignment": "...",
  "old_score": ...,
  "new_score": ...,
  "old_overall": ...,
  "new_overall": ...,
  "provider": "...",
  "timestamp": "...",
  "source_ids": [...]
}

The report should be detailed enough that I can hand MUSE_WATCHER_REPORT.md to Muse and simply say:

"Implement the recommended watcher."

Do not make GradeViewer itself depend on Muse.

==================================================
SESSION CONTINUITY
==================================================

Maintain these files:

README.md
ARCHITECTURE.md
RESEARCH.md
PROJECT_STATUS.md
TODO.md
MUSE_WATCHER_REPORT.md

PROJECT_STATUS.md should always contain:
- current working features
- current test status
- incomplete work
- known bugs
- next highest-value tasks

Update it before ending a Codex session.

If a future Codex session begins with little conversation context, read these files and continue.

==================================================
SCOPE PRIORITY
==================================================

Priority order:

1. research providers enough to establish viable architecture
2. build reliable canonical data model
3. get Schoology working
4. get Infinite Campus working if legitimately achievable
5. build simple Bessy-like GradeViewer UI
6. local caching/history
7. What-If/calculator functionality
8. widget
9. thorough simulator screenshot cleanup
10. physical-device installation
11. finish/refine MUSE_WATCHER_REPORT.md

Do not let speculative Muse work block GradeViewer.

Do not chase perfection forever.

==================================================
FINAL OPERATING PRINCIPLES
==================================================

Keep the app boring in the best possible way.

Fast.
Reliable.
Local.
Clean.
Simple.

Backend/data correctness matters more than clever abstractions.

UI restraint matters more than creative redesign.

Do not invent unnecessary text or features.

Use the Bessy screenshots to stay grounded.

Use screenshots of your own running app to catch and remove UI slop.

Research unclear provider behavior rather than guessing.

Make reasonable decisions yourself.

Keep going without asking me trivial questions.

Build GradeViewer.
