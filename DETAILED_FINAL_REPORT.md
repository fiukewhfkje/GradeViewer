# GradeViewer detailed final report

September 29, 2026. Native iOS app, local repository `/Users/ashtonchang/Documents/GradeViewer`, private GitHub repository [fiukewhfkje/GradeViewer](https://github.com/fiukewhfkje/GradeViewer). The original Git history is retained. The exact final commit is recorded in the delivered validation record and Git HEAD.

## What the app now does

GradeViewer uses the supplied Bessy screenshots for screen structure: a simple Grades/Profile footer, warm light and charcoal dark appearances, rounded cards, original course names, and aligned green grades. Course sheets show Course Grade, Grade Progression, five recent graded assignments, and View All Assignments. Calculators, resets and source comparisons are in the course three-dot menu. Assignment menus share persistent local edit/drop/undrop/reset state. There is no quarter picker, refresh timer, subscription banner or promotional block in the overview.

Assignment titles and update labels have stronger font weights. Ungraded rows are omitted from visible lists, including the full view; real numeric zero and extra credit remain. This is a presentation filter, not deletion of fetched records. The full view uses collapsible Schoology categories and includes graded work from earlier cached quarters belonging to the same physical class/task. Category lists begin collapsed to keep the screen clean.

Cached grades render first. The app performs one asynchronous startup refresh; later refreshes are manual pull-to-refresh. There is no continuous polling, foreground timer, required server or third-party runtime dependency. The widget reads a small local summary rather than fetching both providers. The final signed debug app bundle including its widget is approximately 5.9 MB. No final physical-device launch/scroll benchmark was measured; the earlier 2.468-second simulator average used a synthetic 2,100-assignment fixture and is not a claim about ordinary iPhone performance.

## Graph behavior and its data

The graph uses a native SwiftUI Path and one monotone cubic curve shared by rendering and finger sampling. Moving within the interval between two recorded grades changes the selection continuously; it does not jump to the nearest recorded point. Monotone interpolation avoids extra highs/lows between endpoints. A single recorded grade produces a flat line that can still be selected.

While held, the selected prefix stays at full contrast, the rest dims, and the selected point gets a halo and dot. A light rounded bubble shows the grade to two decimal places and a numeric date. The requested Calculated/due-date qualifier has been removed from the bubble. Finger release clears the bubble, marker and dimming. Gesture tests check actual touch handling and movement; a separate synthetic held-state preview supplies visual screenshots. Visual inspection caught a light-mode layering problem despite passing gesture tests, so the layering was corrected and inspected again in both appearances.

Actual locally observed grade changes are stored separately from calculated prefixes. Before enough observed changes exist, the app can replay currently available scored assignments through the canonical calculator, ordered by actual score-change date, to build presentation-only prefixes. This is allowed only when the complete source baseline reproduces its reported overall within 0.15 percentage point and dates are usable. Due dates are a fallback only when score-change dates are absent; unusable/future chronology keeps the actual observation rather than inventing a curve. Prefixes never become historical observations in storage. These curves are reconstructed from current scores, not an old provider audit log. That limitation remains here even though the user requested a clean tooltip.

The live Campus payload's scoreModifiedDate was initially missed. Adding it before other timestamp fallbacks supplied true update dates for all five current classes and fixed a course whose future due date had blocked reconstruction. All five now have update-date labels and calculated progression availability in the protected device verification.

## The missing Biology row, order and timestamps

The user's comparison showed a recent Biology extra-credit assignment in Bessy but absent from GradeViewer. Narrow device diagnostics checked only fixed booleans/counts. They confirmed that reference assignment was graded in the associated Schoology snapshot and absent from the Campus snapshot. No numeric Campus score had been discarded by the parser. The overview had only used Campus-backed current-course rows, so it excluded legitimate Schoology-only work.

The overview now includes distinct graded Schoology rows through the evidenced class association, retaining Campus variants when the same assignment is linked. The reference extra-credit row is second after the correction, matching the supplied comparison. It does not become a hypothetical contribution to a Campus calculation. Schoology-only and historical rows outside the current calculator basis remain viewable without pretending an edit can change the reported Campus grade.

One ordering rule serves every class: real score-update dates newest first; undated scored work after dated work; then due date newest first, normalized title and stable ID for exact ties. A future due date cannot displace an assignment with a known recent grading date. Explicit secondary sorting prevents equal-date rows changing order after a refresh. Tests cover reversed input order and missing dates, and protected phone checks cover all five classes. Every graded row remains accessible in the full view; the overview intentionally previews five.

Relative labels originally truncated elapsed hours/days. They now round to the nearest unit, which addresses the one-hour differences around the supplied screenshot boundaries. This changes formatting, not provider timestamps or time zones. There is no ticking timer. A missing score-update date does not become the fetch time or due date in an updated label.

Bessy's exact sorting, date-rounding, reconciliation and refresh algorithms were not found in public documentation. Its [website](https://www.bessy.io/) and [FAQ](https://www.bessy.io/faq) establish features and menu structure; the screenshots establish visible chronology/layout. The explicit equal-date rule above is GradeViewer's implementation choice. Additional side-by-side screenshots can further calibrate parity; no proprietary Bessy code was accessed, copied or decompiled.

## How Schoology and Campus are normalized

Both adapters produce typed GradeCore source courses, assignments, terms, categories, scores and reported overalls. Provenance retains the provider and its own section/task/period/item IDs. Provider IDs never substitute for one another. Raw student responses and credential values are not written to diagnostics or Git.

Canonical course auto-matching requires a unique cross-provider pair with exact normalized course title, term name and nonempty teacher. Normalization folds case, diacritics, punctuation and spacing. Ambiguous or missing metadata leaves separate records; saved manual mappings can explicitly join them. Within a canonical matched course, assignments auto-match only when normalized title, UTC due-calendar day and points possible agree, with one candidate per provider. Missing dates or repeated titles stay separate. Existing identities, history, ordering and visibility survive ordinary refreshes and a new source joining a record; split records cannot both inherit one old identity.

Campus's reported overall is the display authority when available, including an actual zero. Scored/excused Campus assignment variants take precedence, with scored Schoology fallback. Both variants remain stored on disagreement. Calculators always use one complete source course, normally Campus, rather than summing the deduplicated presentation rows from both systems.

Schoology category presentation has a separate conservative association: prefer an already linked Schoology source, otherwise require the exact class name, at least two shared assignment title/points pairs and one unique grade owner. Within that established class association, a unique title/points pair can provide category metadata even when provider due dates differ. This does not weaken canonical course matching or switch the calculation basis. Ambiguous class association supplies no borrowed categories.

Schoology's grade-item catalog is retained independently of period grades. This allows metadata from another quarter to categorize a graded Campus row. A catalog entry without a score cannot create a visible grade. Physical item IDs suppress duplicate catalog records even when due dates are absent. The full view gathers older graded rows from the same Campus section/grading task or Schoology grade owner, deduplicating physical assignments and preferring the current variant. The homepage and course overall retain the current period internally.

## What desynchronization means here

GradeViewer does not write back to either provider or attempt to force their values to agree. Source snapshots remain independently attributable. When Schoology has a grade that Campus has not supplied, the assignment can be shown without replacing Campus's overall. Differences can be inspected through source details. The documented district integration supports grade passback, but this session did not establish which district process caused the observed Biology difference. [PowerSchool integration guide](https://uc.powerschool-docs.com/en/schoology/latest/infinite-campus-implementation-and-configuration-guide).

A provider snapshot replaces its old data only after its whole fetch and parse succeeds. If one provider fails while the other succeeds, the failed provider's last complete data remains. A malformed response is not treated as a successful empty snapshot. Saves update individual local records and roll back on failure rather than deleting the entire database. Unchanged refreshes do not add history points.

The fake blue +0.01% issue came from comparing a recomputed baseline against the reported provider grade even when no meaningful local edit existed. Stale and unchanged overrides are now normalized away. Reliable scenarios apply only the computed change to the reported grade: reported + scenario calculation − baseline calculation. A rounding offset therefore does not appear as a user change. Blue text/delta badges require a material local hypothesis; real edits and drops remain persistent and resettable.

## Provider access and persisted login

Both full authenticated provider pipelines succeeded on the student's phone. Campus detail requests must use the summary's sectionID, not opaque _id. Using _id returned HTTP 200 empty arrays; correct sectionIDs returned six complete detail objects. Schoology's grade-owner ID can differ from the enrolled section ID. Accessible metadata/items/categories requests stay on the enrolled ID; grade identity retains the returned owner, accepted only when unambiguous. Direct metadata through the wrong owner returned 403 and was not evidence of session expiry.

Schoology keys are entered locally and stored in Keychain. Campus uses normal district Student login in the same nonpersistent in-app browser as district search, then stores only Campus-origin cookies in Keychain. The app does not read or store the password. Safari sessions are separate. Failed setup retains a separate pending item for retry; successful verification promotes active credentials. Both active connections survived repeated reinstalls/relaunches, with zero pending setup and no storage/provider error in final verification.

Neither provider's authorization lifetime was measured. Schoology uses freshly signed OAuth 1.0 requests, not an OAuth 2 refresh-token exchange. Campus persists any cookie rotation after successful reads, but no universal renewal endpoint or permanent-session guarantee was established. Actual rejection preserves cached grades and requires reconnect. Disconnect before changing students/accounts; automatic account identity binding remains unfinished.

## Widget: how to use it

Open GradeViewer once so it writes the summary. On the iPhone Home Screen, touch and hold an empty area → Edit → Add Widget → search GradeViewer → choose small or medium → Add Widget → Done. Small shows the first visible course; medium shows up to three. Profile → Edit courses controls order/visibility. Tap the widget to open Grades. Successful app refreshes update its protected atomic App Group summary and request a reload. Profile → Reload widgets requests one manually. [Apple's widget instructions](https://support.apple.com/en-gb/118610).

The widget has no credentials or provider networking, and no polling timeline. The signed extension, shared renderer and App Group transport are tested. Actual Home Screen placement and observed reload behavior on the physical phone remain user-side validation; this report does not claim that placement was performed.

## Muse handoff

[MUSE_WATCHER_REPORT.md](MUSE_WATCHER_REPORT.md) directly covers all four requested items: verified student endpoints; login/session material, persistence, unknown lifetime and recovery; reconstructed observed request/response shapes with every secret/student value redacted; and observed limits/latency. It labels documented, public-client, live-verified, fixture and proposed behavior separately.

Campus's verified reads are resources/portal/grades and resources/portal/grades/detail/{sectionID}. Schoology's verified reads are users/me, enrolled sections, user grades scoped to enrolled sections, section metadata, grade_items and grading_categories. The report includes the users/me redirect/signing case and enrolled/grade-owner alias correction. No HTTP 429 or Retry-After was observed; no sustained polling/load test or approved Campus cadence was established. Schoology's documented default API-credit bucket is distinguished from account-specific measured limits. Muse needs separately authorized credentials/browser login on its VM; iOS secrets were not transferred. No watcher was built or deployed.

## Validation and deployment

42 core tests passed on final core source. Eleven hosted iOS tests passed for persistence, scenarios, startup, Keychain, URLs/cookies, diagnostics and widget sharing. Fourteen current UI cases passed across focused runs, including the 20-screen light/dark matrix, graph movement/release/held appearances, real local menu scenarios, Schoology categories/past-quarter fixture and Schoology-only recent grade ordering. These are cumulative focused results, not one claimed final all-tests run. Final category/catalog/overview edits received relevant reruns. Initial failures and visual defects were investigated and corrected; tests were not weakened to obtain a pass.

Signed app/widget build, installation and launch on the attached iPhone 15 succeeded. Protected reports verify five current classes, restored connections, update dates, reliable baselines and Schoology category availability without exporting scores, names, IDs, dates, cookies or keys. Synthetic light/dark screenshots were exported and inspected. Naturally populated prior-quarter live grades were not available to demonstrate historical behavior, so that claim is limited to fixture validation.

The explicitly requested GitHub repository is private and the complete local commit history is preserved, without force-push or history rewriting. Build products, caches, student databases, HAR files and secrets are excluded. The delivered validation record records the final commit and remote verification.

Remaining practical limits: unusual rubrics/rounding/teacher overrides and timezone-less fields may require district-specific evidence; account identity binding and eventual session expiry need validation; physical Home Screen widget placement is unobserved; no final physical-device performance benchmark was run. The development provisioning profile expires October 6, 2026 and will need the normal signed rebuild/install renewal. This is a development installation, not an App Store release.
