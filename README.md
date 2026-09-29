# GradeViewer

A native, local-first iPhone grade viewer built with SwiftUI, Swift Charts, SwiftData, URLSession, Keychain, and WidgetKit. No required backend or third-party runtime dependencies. iOS 17 or later; one original app icon.

The working project is `/Users/ashtonchang/Documents/GradeViewer`. Open `GradeViewer.xcodeproj` for development. Git started on `main` before implementation; no GitHub remote was created.

## Current build

Course grades, assignments, categories, stored grade history, graph point selection, shared local What-If edits/drop/restore/reset, added hypothetical assignments, final calculator, course ordering/visibility, manual course matching, pull-to-refresh, system/light/dark mode, and small/medium widgets are implemented. Cached grades render before an asynchronous refresh. A failed provider keeps its last successful data.

Provider adapters have fixture and transport tests. **Neither provider has yet been verified against this student's authenticated account.** Campus uses normal login on the district's own page and then same-origin cookies; the grade resources are based on public client evidence rather than a supported student API contract. Read RESEARCH.md before claiming live compatibility.

## Connect locally

1. On the iPhone, open GradeViewer → Settings → Schoology. Enter your personal consumer key and secret. Leave optional access-token fields empty for personal two-legged API credentials. Tap Connect. Keys are saved to Keychain only after a successful fetch.
2. Settings → Infinite Campus: tap Find your district to search and sign in inside GradeViewer, or paste your exact HTTPS **Campus Student** login URL, typically `https://<DISTRICT_HOST>/campus/portal/students/<DISTRICT>.jsp`. Sign in on the district page, including SSO if applicable. After login, tap Connect in GradeViewer's toolbar. The app tests grade access and saves only Campus-domain session cookies to Keychain. It never reads or saves your password.
3. If the same course has different names or term labels across providers, use Settings → Match courses. Ambiguous automatic matches remain separate. Campus's available reported grade is the display authority; both source variants are retained.

Use each provider's reconnect flow when access expires. **Disconnect before switching students/accounts.** Disconnect removes that provider's grades and resets local history, mappings, and What-If scenarios. Do not paste credentials into chat, source files, command arguments, or issue reports.

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

Read PROJECT_STATUS.md and TODO.md first, then ARCHITECTURE.md and RESEARCH.md. The original requirements are preserved in docs/PRODUCT_BRIEF.md. MUSE_WATCHER_REPORT.md is a separate implementation handoff with endpoint evidence labels, recommended cadence, session considerations, redacted examples, deduplication/state design, and a live verification checklist. **No Muse watcher was implemented or deployed.**
