# Project status — September 29, 2026

GradeViewer lives at `/Users/ashtonchang/Documents/GradeViewer`, under Git on main. Baseline: `3b6a20e`; use `git log -1` for the current implementation hash. No remote was created.

## Current implementation

- Native SwiftUI, Swift Charts, SwiftData, Keychain, WebKit, URLSession and WidgetKit; no backend or third-party runtime package.
- UI follows the supplied references: flat Grades/Profile footer, warm cream/charcoal rounded cards, original course names, Course Grade → Grade Progression → five recent assignments → View All Assignments. No visible quarters, refresh timer, category link block, or calculator links in the overview. Calculators/resets/source comparisons are in the course three-dot menu. Assignment edit/drop/undrop/reset menus share persistent local scenarios. Assignment groups begin collapsed.
- Cached data renders before one startup refresh; subsequent refreshes are manual pull-to-refresh. No polling or foreground refresh timer. Static update labels use available source score-change dates; absent dates are omitted.
- Graph hold/drag shows grade/date. Actual observed snapshots remain separate from calculated prefixes. Prefixes are built off the main thread with the canonical calculator only when the complete source baseline agrees and scored assignments have usable dates. The tooltip identifies calculated points and due-date fallback. Incomplete dates keep the actual observed point.
- Both provider connections completed full authenticated fetches on the student's iPhone. Keys/cookies are saved in Keychain; failed setup retains a separate pending item for Retry/Forget. Both active connections survived the final reinstall/relaunch with zero pending items.
- Canonical source-aware reconciliation, Campus display priority, retained disagreements, conservative automatic matches, explicit matching, stable identity/history, differential persistence, cached-data retention on failures, and current-term selection internally.
- Small/medium widgets read a protected atomic summary, follow current visible courses and order, and make no network calls. No Muse watcher was implemented or deployed; its separate handoff is MUSE_WATCHER_REPORT.md.

## Actual validation

- **33 GradeCore tests passed**, including provider parsing/transport, OAuth signing, alias resolution, Campus section-ID detail routing, privacy, disabled ordinary diagnostics, calculations, matching, history and calculated progression. Campus detail-ID regression failed before its correction and passed afterward.
- **11 hosted iOS tests passed**: disposable SwiftData, scenarios/mappings, cache-first startup, current-term selection, Keychain, App Group widget summary, Campus URLs/cookie scope and safe diagnostics.
- **9 current UI tests passed across targeted runs**: navigation/appearance, edit/drop/restore, empty/retained-cache failure, long names, category reset, chart hold, 20-screen light/dark matrix, clean overview/menu navigation, and selectable first-observation chart. An initial menu test failed because its synthetic future-term fixture lacked dates; the dated fixture and focused rerun passed. Final navigation and all 20 screenshots were rerun after the toolbar/chart/name refinements. The earlier launch-metric test also passed (10 distinct UI tests including that historical metric; 54 distinct tests overall, not one final all-tests run).
- Final light/dark screenshots exported from XCTest and inspected, including grades, overview, collapsed assignments, menus/scenarios, calculators, settings, widget shared content, long names, empty and error states. CLI/XCTest only; no computer-use automation.
- Live Campus: summary HTTP 200 JSON plus six corrected section-detail requests HTTP 200 JSON; full fetch success. Live Schoology: complete user/sections/grades/metadata/items/categories pipeline success after alternate grade-owner handling. Reports contain only allowlisted structural types/counts/statuses, no student values.
- Final signed iPhone 15 app/widget build succeeded, installed, and launched via devicectl after the user unlocked the phone. Safe debug-only verification confirmed cache loaded, both saved connections restored, no storage error, zero pending setup, and five current courses. All five calculation baselines agree; four yield calculated progression prefixes. One has incomplete dates and one observed point. Available cached Campus records had no score-update date, so no fabricated update label is shown.
- Debug signed app plus widget: **5.5 MB** on disk. Previous debug simulator launch metric: 2.468 s average over three launches with construction of a 2,100-assignment fixture; this is not a final physical-device startup benchmark.

## Corrected bugs

Campus detail requests used `_id` instead of sectionID, producing authenticated HTTP 200 empty arrays. Schoology assumed the enrolled section ID must equal the grade-owner ID; a real response differed, and requesting grade items through the returned owner was forbidden. Metadata now remains on the accessible enrolled ID, canonical grades use their actual owner, and unambiguous aliases deduplicate safely.

District lookup previously opened Safari with a separate cookie session; it now stays in the same sign-in view. Modern Dublin Student home paths now derive `/campus/` correctly. Failed Connect previously discarded keys/cookies; pending Keychain entries retain them securely. Other corrected regressions include stationary chart selection, split identity reuse, unavailable scenarios when every contribution is dropped, current-term selection over future terms, and simulator test signing for Keychain/App Groups.

## Remaining limits

Exact displayed values still need comparison with the native portals; timezone, advanced rubric/rounding, teacher metadata, account identity binding, eventual session expiry and cookie rotation are not fully calibrated. Calculated progression is a replay of currently available scores, not a recovered historical audit log. Actual Home Screen widget placement/reload remains unverified. Provisioning expires October 6, 2026; renew with the normal signed build/install flow. Disconnect before changing accounts. See TODO.md and RESEARCH.md.
