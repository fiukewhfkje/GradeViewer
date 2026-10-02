# GradeViewer

A simple native iPhone app for Schoology and Infinite Campus grades, assignments, grade progression, and local What-If/final calculators. iOS 17+, Apple frameworks, and the local GradeCore package. No server, subscription, analytics, or widget.

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
4. Open GradeViewer → **Profile**, and connect either or both providers below.

Keep the **same team and bundle identifier** when updating an existing installation, and install over it instead of deleting the app. Changing its identity creates a separate app/Keychain scope. This repository does not provide App Store or TestFlight distribution.

## Connect your school accounts

- **Schoology:** sign in to [your API credentials page](https://app.schoology.com/api), generate/retrieve your personal API key and secret if your school permits it, then enter them in Profile → Schoology → Connect. These are API credentials, not your password. If your student account cannot generate keys, your district must permit API access; Campus can still be used by itself. [Schoology authentication](https://developers.schoology.com/api-documentation/authentication/), [API key management](https://uc.powerschool-docs.com/en/schoology/latest/api-key-management).
- **Infinite Campus:** Profile → Infinite Campus → **Find your district**, choose Campus Student, complete the district's normal login/SSO, then tap **Connect** in GradeViewer's toolbar. Alternatively paste your exact HTTPS Campus Student login URL. Parent portals are not supported. GradeViewer stores session cookies, never your Campus password.

Credentials and reusable sessions stay in that installation's device Keychain. Cloning the repository does not copy anyone's sign-in or grades. Never put keys, cookies, passwords, or exported student data in source files, chat, or issues. **Disconnect before switching students/accounts.** Schoology checks its credential owner; Campus's current grade resources do not provide a verified account-binding contract.

Grades refresh on launch, return from the background, pull-to-refresh, and once a minute while active. A failed refresh retains the last successful data internally and offers Retry/Profile; foreground grade screens wait for fresh data. Short Schoology rate limits get one bounded retry after the server's delay. Campus can reuse a captured district SSO session, but required credentials/MFA still need normal sign-in.

Automatic checks can reuse Schoology titles/category rules for up to five minutes only when the complete freshly read grade data is unchanged. Changed grades refresh that metadata immediately; pull-to-refresh bypasses this reuse. Optional title lookups stop on a rate limit without rejecting complete fresh grades, and the next refresh still honors the server's cooldown.

If a provider asks to wait, GradeViewer resumes automatically when its cooldown ends while the app is active. Foreground grades show the wait/countdown until fresh data is available; a cooldown does not require reconnecting or repeatedly tapping Retry.

Both providers worked on the original student's iPhone. Campus uses authenticated portal resources without a supported public student API contract, so other districts may differ. Matching requires unique compatible evidence; ambiguous courses stay separate. Neither provider compatibility nor automatic matching can honestly be guaranteed for every account. Calculators stay local and require source rules that reproduce the reported grade.

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

For synthetic simulator UI checks, launch with `--demo`; optionally add `-appearance dark` and `--screen=detail` (also `assignments`, `categories`, `whatif`, `final`, `settings`). Demo uses an isolated in-memory store and makes no provider requests. Do not add fixture arguments to a real installation.

[PROJECT_STATUS.md](PROJECT_STATUS.md) records actual validation and remaining limits. [ARCHITECTURE.md](ARCHITECTURE.md) describes matching, calculation provenance, and session security; [RESEARCH.md](RESEARCH.md) distinguishes provider documentation from public-client and live evidence. [TODO.md](TODO.md) tracks remaining work. No Muse watcher is implemented or required.
