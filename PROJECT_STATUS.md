# Project status — September 29, 2026

GradeViewer is a native iOS app in `/Users/ashtonchang/Documents/GradeViewer`, on Git main. Private remote: https://github.com/fiukewhfkje/GradeViewer. The original baseline (`3b6a20e`) and prior implementation commits are preserved. Use `git log -1` for the final implementation hash.

## Current behavior

- Native SwiftUI/Path graph, SwiftData, Keychain, WebKit, URLSession and WidgetKit. No server or third-party runtime package.
- Warm cream/charcoal rounded cards, flat Grades/Profile footer, original class names and stronger typography. Course Grade → Grade Progression → five recent graded assignments → View All Assignments. No quarter controls or refresh timer. Tools stay inside three-dot menus.
- Continuous smooth graph sampling shares the drawing geometry; the remaining line dims while held, with halo and light grade/date bubble. Releasing the finger clears selection. A single grade draws a flat line. Calculated-prefix basis is documented outside the tooltip. Actual locally observed history remains separate.
- Campus scoreModifiedDate provides true score-update dates. Static labels round elapsed hours/days without a timer. Every current course has a verified update date and progression curve.
- Ungraded assignments stay out of visible lists; zero, extra credit, and distinct graded Schoology-only work remain. All classes share deterministic score-date ordering. The Biology reference extra-credit assignment was verified in Schoology, absent from Campus, and now appears second in the overview.
- Full assignments use evidenced Schoology category associations and include graded historical work from the same physical class/task across cached quarters. Metadata can classify historical grades without creating scores. Deduplication and current calculation basis remain separate from this presentation.
- Local hypotheses remove stale/no-op overrides and apply only their computed delta to the reported grade. Provider rounding cannot create a fake blue +0.01% result. Real scenarios persist and can be reset.
- Both authenticated providers work; saved Keychain connections survive reinstall/relaunch, with zero pending entries. A failed provider retains its last complete successful data.
- Small/medium widgets use a protected App Group summary and no credentials/network calls. Widget tap opens Grades. Open the app once, then Home Screen → hold empty area → Edit → Add Widget → GradeViewer.

## Validation performed

- **42 core tests passed** on final core source. Provider parsing/transport, OAuth signing, aliases/detail routing, privacy, calculations, reconciliation/history, continuous monotone curves, timestamp selection, no-op rounding, Schoology categories, past-quarter deduplication/catalog, Schoology-only recent grades, stable date ordering and label rounding.
- **11 hosted iOS tests passed** on the updated app: disposable SwiftData, scenarios/mappings, cache-first startup/current-term selection, Keychain, shared widget content/App Group, Campus URL/cookie scope and diagnostics.
- **14 current UI test cases passed across focused runs**, excluding the earlier launch metric. Includes navigation/appearance, edit/drop/reset/restore, empty/retained-cache errors, long names, category actions, graph interaction/release/continuous movement, first-point charts, no-op scenarios, Schoology past-quarter categories, Schoology-only recent work, held-tooltip appearances, and the 20-screen light/dark matrix. This is not a claim of one final all-tests run. The final category/overview changes received focused reruns.
- Held graph screenshots inspected in both modes. Visual inspection found a light-mode tooltip layering problem after the gesture tests passed; layering was corrected and the focused tests/screenshots rerun. An earlier disabled hit-testing modifier was corrected before successful real gesture tests.
- All five live classes inspected with protected count/boolean reports. Both connections restored, no storage/provider error, all calculation baselines reliable, all score-date update labels present, Schoology categories associated for every class. Current-period Schoology-only graded work is retained; identical physical rows are deduplicated.
- Full authenticated Campus summary + six section details and the Schoology user/sections/grades/metadata/items/categories pipeline succeeded. Muse report includes redacted reconstructed shapes and single-run latency measurements. No 429/Retry-After observed; no session TTL or sustained polling test.
- Final signed iPhone 15 app and widget build succeeded. Debug signed app bundle, including extension: **5.9 MB**. Earlier simulator launch metric (2.468 s average, synthetic 2,100-assignment fixture) is historical, not a final physical-device performance measurement.

## Important corrections

Campus detail routing must use sectionID, not opaque _id. Schoology grade-owner IDs can differ from enrollment metadata IDs; accessible metadata stays on the enrolled ID. Real Campus timestamps are scoreModifiedDate. Overview source coverage previously lost a legitimate Schoology-only Biology grade. Sorting mixed due dates into recent-score chronology and lacked stable ties. Truncated age labels differed at hour boundaries. Graph hit testing and light-mode tooltip layering required separate corrections. Hypothetical baseline rounding must not appear as a user change.

## Remaining limits

No private Bessy sorting/normalization algorithm was found. The supplied screenshots and public feature descriptions guide the UI. Source disagreements are retained rather than guessed away. Timezone-less dates, unusual rubrics/teacher overrides, account identity binding and eventual session expiry/rotation need further real-case calibration. Historical chart prefixes are reconstructed from current scores, not an old provider audit log. Previous-quarter behavior is verified with synthetic fixtures; current live data did not demonstrate naturally populated prior-quarter grades. Home Screen widget placement/reload is a user action and has not been observed on the physical phone. Development provisioning expires October 6, 2026. No Muse watcher was built or deployed.
