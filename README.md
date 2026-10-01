# GradeViewer

A native, local-first iPhone grade viewer built with SwiftUI, a smooth native graph, SwiftData, URLSession, Keychain, and WidgetKit. No required backend or third-party runtime dependencies. iOS 17 or later; one original app icon.

The working project is `/Users/ashtonchang/Documents/GradeViewer`. Open `GradeViewer.xcodeproj` for development. Git started on `main` before implementation. The private GitHub repository is https://github.com/fiukewhfkje/GradeViewer; the full history is preserved.

## Current build

Course grades, assignments, collapsible assignment groups, stored grade history, graph point selection, shared local What-If edits/drop/restore/reset, added hypothetical assignments, final calculator, automatic course matching, pull-to-refresh, system/light/dark mode, and small/medium widgets are implemented. Saved grades load internally, but an opaque loading screen covers grade views on launch and every foreground return until each connected provider has supplied fresh data. Failures show a retry/reconnect screen while retaining the saved data. Profile remains accessible. While active, the app checks once a minute; it stops scheduling checks when inactive/backgrounded. Pull down on Grades, course detail, or full assignments for an immediate refresh. Overlapping requests join the same operation, both providers run concurrently, and a completed provider publishes without waiting for the other. Section requests use bounded concurrency. The home list has one current card per physical class. View All Assignments contains one Q1–Q4 pill toggle. Exam grades and assignments appear at the bottom of their associated closing quarter, including Q2 for the first-semester exam. Course Grade shows the associated semester overall; the class overview keeps the current quarter, and the full list follows its selected pill. The course sheet shows Course Grade, Grade Progression, five recent assignments, and View All Assignments. Calculators and resets are inside the course three-dot menu. A failed provider keeps its last successful data.

The graph combines actual locally observed changes with presentation-only calculated prefixes when the complete source data reproduces the reported grade. Calculated points are presentation-only, prefer actual score-update dates, and never become observed history. The hold tooltip shows only grade/date per the user’s preference; the reconstruction basis is described in ARCHITECTURE.md. Incomplete dates retain an actual selectable point instead of inventing a curve. Update labels use available score-change timestamps, not a refresh countdown. A checkmark lasts less than 24 hours; ages over 30 days use completed 30-day months. Campus scoreModifiedDate is parsed first; all five current courses were verified on the phone with update dates and progression curves. The marker traces the smooth curve continuously, while the tooltip selects the nearest event grade/date and jumps only at midpoint thresholds. Distinct assignment contributions retain separate points even when timestamps tie; events have equal horizontal spacing. Interpolated geometry never supplies a displayed percentage. Even one recorded grade renders a flat line. Releasing your finger clears the selection. Assignment titles and update labels use stronger font weights.

Ungraded assignments are omitted from visible lists. The overview retains graded Schoology-only work; the full view uses Schoology categories and the selected quarter, followed by its separate exam section. One stable score-date ordering rule serves every class. Past work and category metadata never change the current grade calculation.

Provider adapters have fixture and transport tests. **Both providers completed successful authenticated grade fetches on this student's iPhone.** Campus detail requests now use sectionID; Schoology handles a returned grade-owner ID that differs from the enrolled section used for accessible metadata. Saved Keychain connections survived reinstall and relaunch. Campus initially returned HTTP 401 on October 1. The user completed normal district sign-in; subsequent installed builds refreshed both providers and retained both Keychain connections. Six Biology wrapper/node title mismatches were repaired; one other assignment detail returned HTTP 403 and retains its score with a neutral title. Campus now saves cookie rotation even after a failed detail fetch and revisits the saved same-origin portal once before requiring sign-in. This cannot guarantee an indefinitely valid district session. Campus uses normal login on the district's own page and then same-origin cookies; the grade resources are based on public client evidence rather than a supported student API contract. Read RESEARCH.md before claiming live compatibility.

## Connect locally

1. On the iPhone, open GradeViewer → Settings → Schoology. Enter your personal consumer key and secret. Leave optional access-token fields empty for personal two-legged API credentials. Tap Connect. Keys are saved to Keychain for a manual retry; the provider becomes Connected only after a successful fetch.
2. Settings → Infinite Campus: tap Find your district to search and sign in inside GradeViewer, or paste your exact HTTPS **Campus Student** login URL, typically `https://<DISTRICT_HOST>/campus/portal/students/<DISTRICT>.jsp`. Modern `/campus/nav-wrapper/student/portal/student/home` addresses are also supported. Sign in on the district page, including SSO if applicable. After login, tap Connect in GradeViewer's toolbar. The app tests grade access and saves only Campus-domain session cookies to Keychain. It never reads or saves your password.
3. Courses match automatically using compatible metadata, explicit matching period boundaries/kind, or a unique pair with matching title words and at least two shared assignment title/points identities. Proven physical section pairs then connect compatible empty periods and semester Finals. Schoology section grading-period metadata reconciles its semester hierarchy with Campus task records. Conflicting teachers, disjoint known terms, and ambiguous sections remain separate. Campus's available reported grade is the display authority; both source variants are retained. Settings has no course-editing or course-matching screens.

Failed setup keeps pending credentials/session cookies in Keychain and offers Retry saved connection or Forget saved connection. A short diagnostic reports request stage/status/type, with no student values. Structural reports in Library/Caches contain only fixed route labels, field types, counts, and safe error labels; normal refresh does not collect these diagnostics.

Use each provider's reconnect flow when access expires. The Campus page restores this app’s unexpired saved Campus cookies before normal navigation. **Disconnect before switching students/accounts.** Disconnect removes that provider's grades and resets local history, mappings, and What-If scenarios. Do not paste credentials into chat, source files, command arguments, or issue reports.

## Build and test from CLI

Xcode 27.0 and Swift 6.4 were used for this session. `project.yml` is the XcodeGen source; the generated Xcode project is committed, so XcodeGen is needed only after project configuration edits. The only Swift package is local GradeCore.

```sh
cd /Users/ashtonchang/Documents/GradeViewer
swift test
# Only after changing project.yml:
xcodegen generate
xcrun simctl list devices available
xcodebuild test -project GradeViewer.xcodeproj -scheme GradeViewer \
  -destination 'platform=iOS Simulator,name=iPhone 17e' \
  -derivedDataPath DerivedData -collect-test-diagnostics never CODE_SIGN_IDENTITY=-
```

Keep simulator signing enabled for the Keychain/App Group tests. `CODE_SIGNING_ALLOWED=NO` builds the UI but removes the entitlements those tests need. `-collect-test-diagnostics never` avoids a simulator diagnostic collection hang observed after a failed UI test; normal `.xcresult` results and screenshot attachments still work.

The UI suite includes a three-iteration launch metric and a 20-screen screenshot matrix. For a short focused run, use `-only-testing:GradeViewerTests` or select the relevant UI test. Export screenshot attachments with:

```sh
xcrun xcresulttool export attachments --path <RESULT_BUNDLE>.xcresult --output-path <OUTPUT_FOLDER>
python3 Scripts/export-screenshots.py <OUTPUT_FOLDER> <NAMED_SCREENSHOT_FOLDER>
```

All UI driving uses XCTest/simctl/devicectl. No computer-use or GUI automation is needed.

## Deterministic visual fixtures

Simulator launch arguments use an in-memory store and do not fetch providers:

```sh
xcrun simctl install <SIMULATOR_ID> DerivedData/Build/Products/Debug-iphonesimulator/GradeViewer.app
xcrun simctl launch <SIMULATOR_ID> com.ashtonchang.GradeViewer --demo -appearance dark --screen=detail
xcrun simctl io <SIMULATOR_ID> screenshot <SCREENSHOT_PATH>.png
```

Wait until presentation animations finish before an immediate simctl screenshot; XCTest's screenshot test waits for the visible navigation screen. Routes: `detail`, `assignments`, `categories`, `whatif`, `final`, `settings`, `widget`; default is grades. `--empty`, `--error`, and `--long-list` exercise empty, retained-cache error, and 2,100-assignment fixtures. `-appearance light|dark|system` overrides the stored appearance for QA. Real app launch uses no fixture arguments. The widget QA route renders the same shared content as the extension, not an actual Home Screen placement.

## Add the widget

The installed build includes a Home Screen widget with small (first course) and medium (first three courses) sizes. Open GradeViewer once so its saved summary is available. Touch and hold an empty Home Screen area → Edit → Add Widget → search GradeViewer → choose a size → Add Widget → Done. [Apple's current steps](https://support.apple.com/en-gb/118610).

Widgets follow the automatically selected current courses and retained ordering. Tap the widget to open Grades. A successful app refresh updates the summary and requests a widget reload; the widget does not poll providers while the app is closed. Profile → Reload widgets requests another reload. Physical Home Screen placement remains a user action, while the extension, shared rendering, App Group transport, and signed installation are validated.

## Connected iPhone

The configured development team is `S5MUKGHJR2`. CLI signing/build and installation succeeded on the connected iPhone 15. The user completed developer trust and confirmed launch; devicectl launch also succeeded. If installing on another device, developer trust must be performed on the phone under Settings → General → VPN & Device Management, selecting the developer profile. Follow Trust/Allow & Restart if offered. See [Apple's developer trust instructions](https://help.apple.com/xcode/mac/current/en.lproj/dev96a12fb84.html).

```sh
xcodebuild build -project GradeViewer.xcodeproj -scheme GradeViewer \
  -destination 'id=<DEVICE_ID>' -derivedDataPath DeviceDerivedData -allowProvisioningUpdates
xcrun devicectl device install app --device <DEVICE_ID> DeviceDerivedData/Build/Products/Debug-iphoneos/GradeViewer.app
xcrun devicectl device process launch --device <DEVICE_ID> com.ashtonchang.GradeViewer
```

The current development provisioning profile expires October 6, 2026. Rebuild/reinstall with the signed-in team when renewal is needed. This is a local development installation, not an App Store release.

## Continue the project

Read PROJECT_STATUS.md and TODO.md first, then ARCHITECTURE.md and RESEARCH.md. The original requirements are preserved in docs/PRODUCT_BRIEF.md. DETAILED_FINAL_REPORT.md explains UI behavior, normalization, desynchronization, observed bugs, validation and remaining limits. MUSE_WATCHER_REPORT.md is a separate implementation handoff with endpoint evidence labels, recommended cadence, session considerations, redacted examples, deduplication/state design, and a live verification checklist. **No Muse watcher was implemented or deployed.**
