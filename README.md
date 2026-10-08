# GradeViewer

A simple native iPhone app for Schoology grades, assignments, grade progression, local grade edits/additions, and a final calculator. iOS 17+, Apple frameworks, and the local GradeCore package. No server, subscription, analytics, or widget.

## Install on your iPhone

You need a Mac with **Xcode 26 or later** (tested with Xcode 27), an Apple Account, and your own school sign-in. A free Personal Team works for development installs, but Apple requires rebuilding/reinstalling after **7 days**. [Apple account limits](https://developer.apple.com/help/account/basics/about-your-developer-account).

1. Obtain GitHub access from the owner if this repository is private, then clone it:
   ```sh
   git clone https://github.com/fiukewhfkje/GradeViewer.git
   cd GradeViewer
   open GradeViewer.xcodeproj
   ```
2. In Xcode → Settings → Apple Accounts, sign in. Select the **GradeViewer app target → Signing & Capabilities**, enable automatic signing, choose **your team**, and set a unique bundle identifier, such as `com.yourname.GradeViewer`. There is only one app to sign; no App Group is needed.
3. Connect and unlock your iPhone, trust the Mac, select the **GradeViewer** scheme and your phone, and press Run. If prompted, enable **Settings → Privacy & Security → Developer Mode**, restart, and confirm. If iOS asks for developer trust, follow **Settings → General → VPN & Device Management**. [Apple's device setup](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices), [Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).
4. Open GradeViewer → **Profile**, and connect Schoology below.

Keep the **same team and bundle identifier** when updating an existing installation, and install over it instead of deleting the app. Changing its identity creates a separate app/Keychain scope. This repository does not provide App Store or TestFlight distribution.

## Connect your school accounts

Sign in to [your API credentials page](https://app.schoology.com/api), retrieve your personal API key and secret if your school permits it, then enter them in Profile → Schoology → Connect. These are API credentials, not your password. District API access is required. [Schoology authentication](https://developers.schoology.com/api-documentation/authentication/), [API key management](https://uc.powerschool-docs.com/en/schoology/latest/api-key-management).

Credentials stay in that installation's device Keychain. Cloning does not copy sign-in or grades. **Disconnect before switching students/accounts.** Schoology verifies the credential owner before reading student data.

Grades refresh on launch, real background return, pull-to-refresh, and once a minute while active. A failed refresh preserves saved data; foreground grade screens wait for fresh Schoology data and offer Retry/Profile. Short rate limits receive one bounded retry after the server's delay; longer waits resume automatically while active.

Unchanged complete grade reads may reuse title/category metadata for five minutes. Changed grades and manual refresh renew it immediately. Optional title throttles preserve fresh scores and the provider's cooldown. Missing metadata leaves an untitled row; different assignments are never deduplicated by name.

Reported Schoology totals take priority. When a complete snapshot omits an overall, supported category rules produce a **Calculated** total and local calculator basis. Unknown rules/scales leave it unavailable. Calculated chart points remain separate from observed history; no dates or grades are invented.

[The assignment audit](docs/PROVIDER_PARITY_AUDIT.md) found every IC assignment represented in Schoology for the original student's five current classes. IC is removed from login, settings, networking, refresh and matching. Existing installations migrate compatible history/local edits and clear retired connections on their next update; keep your same team/bundle ID and install over the existing app. This account's snapshot agreement does not guarantee future or district-wide parity.

## Develop or install with CLI / an AI assistant

Read [AGENTS.md](AGENTS.md) first. Personal signing can be kept out of the generated project:

```sh
cp Signing.local.xcconfig.example Signing.local.xcconfig
```

Set `DEVELOPMENT_TEAM` to your Apple team ID and `GRADEVIEWER_BUNDLE_ID` to your unique identifier in that ignored file. The committed project automatically includes it; no regeneration is needed. Do not copy another person's local file. The original checkout retains its existing installation identity there.

```sh
swift test
xcrun simctl list devices available
# Replace the simulator name with one installed on your Mac.
xcodebuild test -project GradeViewer.xcodeproj -scheme GradeViewer \
  -destination 'platform=iOS Simulator,name=iPhone 17e' \
  -derivedDataPath DerivedData -collect-test-diagnostics never CODE_SIGN_IDENTITY=-

xcrun devicectl list devices
xcodebuild build -project GradeViewer.xcodeproj -scheme GradeViewer \
  -destination 'id=<DEVICE_ID>' -derivedDataPath DeviceDerivedData -allowProvisioningUpdates
xcrun devicectl device install app --device <DEVICE_ID> \
  DeviceDerivedData/Build/Products/Debug-iphoneos/GradeViewer.app
xcrun devicectl device process launch --device <DEVICE_ID> "$BUNDLE_ID"
```

Set `BUNDLE_ID` to the same identifier you configured. Apple Account login, Developer Mode, and device trust may require manual action. Keep simulator signing enabled for Keychain tests. The generated Xcode project is committed; **XcodeGen is only needed after editing `project.yml`** (`xcodegen generate`). Do not commit personal signing overrides to the project.

For synthetic simulator UI checks, launch with `--demo`; optionally add `-appearance dark` and `--screen=detail` (also `assignments`, `categories`, `final`, `settings`). Course options → Add Grade opens a popup for name, score, and total points; added grades stay local and can be edited or removed from the normal lists. Demo uses an isolated in-memory store and makes no provider requests. Do not add fixture arguments to a real installation.

[PROJECT_STATUS.md](PROJECT_STATUS.md) records actual validation and remaining limits. [ARCHITECTURE.md](ARCHITECTURE.md) describes matching, calculation provenance, and session security; [RESEARCH.md](RESEARCH.md) distinguishes provider documentation from public-client and live evidence. [TODO.md](TODO.md) tracks remaining work. No Muse watcher is implemented or required.
