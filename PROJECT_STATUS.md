# Project status — September 29, 2026

## Working implementation

GradeViewer lives at `/Users/ashtonchang/Documents/GradeViewer`, with Git on `main`. Baseline commit: `3b6a20e`. No remote repository was created. The implementation commit is the current repository HEAD; use `git log -1` for its hash.

- Native SwiftUI course list and sheets, assignments, collapsible categories, term selection, light/dark/system appearance, original chart icon, hidden/reordered courses, and explicit cross-provider course matches.
- Local SwiftData cache loads before asynchronous refresh. Entire successful provider snapshots update differentially; provider failures keep cached data. Material grade changes add local history without duplicate snapshots.
- Swift Charts selection on hold/drag displays the nearest actual grade and date. It remains selected after release.
- Local What-If: edit scores, drop/restore/reset assignments from recent/all/category views; shared persisted scenario and course delta; add hypothetical assignments; final-grade calculator. Source records and history are unchanged by hypotheses. Unsupported/mismatched calculation baselines do not generate false estimates.
- Schoology OAuth 1.0 read adapter, pagination, assignment/category/grade parsing, and optional access tokens; credentials entered locally and stored in Keychain.
- Campus normal student login in a nonpersistent WebKit view, same-origin cookies in Keychain, authenticated summary/detail adapter, reconnect on rejected sessions, fresh response cookies persisted. **District lookup now opens inside the same sign-in view**, following the user's report that the old Safari lookup did not connect the app. The selected student portal is retained across SSO navigation. Safari cookies are never extracted.
- Canonical source-aware models, conservative unique course/assignment matching, explicit matches, Campus display priority, retained disagreements, scoped source IDs, and stable history/identity when matching changes.
- Small/medium WidgetKit extension reads a protected atomic App Group summary; no widget network calls or credentials. Its summary follows the selected term, visible courses, and saved ordering.
- Detailed research/architecture docs, original product brief, README build/setup commands, TODO, and a separate Muse watcher report. No watcher was implemented or deployed.

## Validation actually performed

- `swift test`: **26 GradeCore tests passed**, including both parsers, ambiguous/malformed/duplicate data, reconciliation splits, zero/extra credit, weighted/equal/percent calculations, drops/multipliers, What-If/final math, history, partial failure, 2,100-assignment fixtures, RFC OAuth signature, and stubbed expired/forbidden/throttled/redirect HTTP responses.
- Ad-hoc-signed iOS hosted suite: **8 tests passed** on iPhone 17e / iOS 27 simulator. In-memory SwiftData differential saves, immediate cached startup, scenarios, explicit mapping persistence, Campus URL/cookie scope, disposable Keychain round trip, App Group widget summary, and selected-term/hidden-course widget filtering.
- UI tests passed across focused runs: course navigation/appearance; numeric edit/drop/restore; empty and retained-cache failure; graph stationary hold; expanded-category drop/reset; launch metric; 20-screen light/dark screenshot matrix. **Long course-name visibility passed in both appearances** on the small simulator, bringing UI coverage to **8 distinct passing tests** (42 tests total across targeted runs).
- Debug simulator launch metric, with 2,100 synthetic assignments and fresh fixture construction each launch: **2.468 s average until first responsive frame**, three iterations. This includes simulator/app-launch overhead and is not a physical-device cached-startup benchmark. Core long-list serialization/reconciliation test took 0.088 s in its passing run.
- Screenshots exported from XCTest and inspected for course list/detail/chart, assignments, categories including dropped state, What-If, final calculator, settings, empty/error, widget shared content, long class names, and both appearances on a small iPhone simulator. First immediate simctl captures were transient; they were replaced with stable XCTest captures.
- Signed physical iPhone 15 build **succeeded**, including the embedded widget. Installed via devicectl. Developer trust was initially required; the user completed it and confirmed app launch. A subsequent devicectl launch also succeeded. The district-lookup fix was signed and reinstalled; a launch attempt while the phone was locked was rejected by iOS, not an app crash. The subsequent small widget selected-term filtering fix is signed/build-verified and will be installed after the pending interactive login result, to avoid interrupting the WebKit sign-in session.
- Debug signed app including widget: **4.9 MB** on disk. Zero third-party runtime packages.

## Bugs found and corrected

- A stationary chart hold did not select a point; replaced the gesture with native chart selection driven from touch/drag location. Focused interaction test passed and its grade/date tooltip was visually checked.
- A previously merged course/assignment could give the same ID to two rows after a metadata split. Added reproducing regression tests, fixed identity inheritance, and both now pass.
- Unsigned simulator runs could not access Keychain/App Group containers. Added generated Info.plists for signed test targets and used ad-hoc simulator signing; both storage tests now pass.
- District lookup initially left GradeViewer for Safari, creating a separate cookie session. Lookup now remains inside the sign-in view and discovers the selected student portal.
- If every scenario contribution is removed, the summary now shows an unavailable hypothetical result rather than falling back to the real grade. Assignment menu actions are disabled for source-only assignments absent from the chosen calculation basis.

## Incomplete / live verification limits

**No provider endpoint has yet been verified using this student's successful in-app authentication.** The reported login so far was in Safari, which cannot supply the app's separate WebKit session. The updated in-app flow is installed; the user was asked to sign in again there and tap Connect. Schoology credentials must also be entered locally.

Campus's student JSON resources and schemas come from historical public clients, not a current official student API contract. District SSO, real permissions, complete terms/tasks, teacher fields, timezone, rubric/letter/rounding rules, session duration, and actual request latency/limits remain unverified. Read RESEARCH.md and the evidence labels in MUSE_WATCHER_REPORT.md.

Widget shared view/transport and signed extension build are verified. Actual Home Screen placement/reload is not yet verified. The development provisioning profile expires October 6, 2026; renew through the normal signed build/install flow. Account replacement without explicit disconnect is not supported; identity binding must be verified before extending that flow.

## Next highest-value actions

Complete local provider login, compare one actual course and assignment with the portals, calibrate parser/rules using observed structures, verify offline relaunch/expiry, and update the Muse report with actual student-authenticated results. See TODO.md. Keep real secrets and grades out of reports, fixtures, and logs.
