# Infinite Campus reassessment — November 4, 2026

Implementation follow-up: the owner subsequently requested implementing IC on main and deploying only to their existing Worker for testing, without a stable release. The Settings connection/checklist, strict IC adapter, shared course/GPA UI, independent snapshot partitions and bounded browser/HTTP session flow are now implemented. Actual IC district/identity compatibility remains unverified; the roster parser accepts only a single explicit student identity and rejects unsupported shapes. The remainder preserves the original investigation and its evidence limits; current test/deployment status is in [PROJECT_STATUS.md](../PROJECT_STATUS.md). Carmen stays development-only.

## Decision and owner preferences

An optional IC connection with a saved course checklist is a reasonable way to cover a class whose teacher uses only IC. Keep Schoology's automatic course discovery. In **Settings → Infinite Campus**, sign in and select the additional IC classes to include. Do not introduce course linking, mapping screens, fuzzy matching, assignment deduplication, or automatic source switching. The owner explicitly rejected linking as setup overhead.

Each selected IC class uses IC's own totals, assignments and rules throughout. Normalize that data into the existing TypeScript grade model so it can use the normal course screens, local scenarios and GPA editor. Selecting courses is separate from combining provider records. If someone selects a class they already have through Schoology, this design does not detect or merge the duplicate; they can deselect the IC class. It does not guarantee a deduplicated cross-provider GPA roster.

The owner requested renaming Profile to **Settings**; that label/icon change is implemented on the development branch. The IC connection, checklist and reconnect flow below are proposed, not implemented. Released provider support remains Schoology-only.

## What Git history actually establishes

| Revision | Evidence | Implication |
| --- | --- | --- |
| `b07df33` | The original detail request incorrectly used `_id`. Historical authenticated tests got HTTP 200 with empty arrays; using `sectionID` returned the expected detail data. | Transport success alone cannot establish a valid empty gradebook. |
| `97bdca8` | Matching regressions covered sections paired differently between quarters, ambiguous same-name sections, teacher/date conflicts and repeated assignment titles. | These were cross-provider identity problems, not evidence that IC cannot be parsed. |
| `b0fdea5`, `73f0150` | Native WebKit captured scoped Campus and visited identity-provider cookies; Keychain retained them and HTTP reads saved rotations/deletions. Normal browser SSO renewal was bounded and verified by a complete grade fetch. | Cookie capture and renewal worked in the retired native app. |
| `07a2616` | The recorded phone renewal test started with zero Campus cookies and 19 saved IdP cookies, obtained eight Campus cookies, then fetched summary and all six details successfully. Relaunch reuse also passed. | This proves short-term native renewal, not a 30-day session lifetime or PWA portability. |
| `d511f9b` | An untitled Schoology row and named IC row appeared separately in presentation. A guarded score/points/update-day association repaired that demonstrated duplicate without adding calculator contributions. | Presentation enrichment introduced a second matching problem beyond course matching. |
| `ff40de6` | IC was removed after a cached audit found all 77 IC assignment rows, including 61 graded rows, represented in the owner's five current Schoology classes. | The removal was based on redundancy for that account. It never established parity for other students or future classes. |

Historical sources: [pre-removal parser](https://github.com/fiukewhfkje/GradeViewer/blob/1761c0fc7b4da944a6d551b453cd016ac472e052/Sources/GradeCore/Parsing.swift), [reconciler](https://github.com/fiukewhfkje/GradeViewer/blob/1761c0fc7b4da944a6d551b453cd016ac472e052/Sources/GradeCore/Reconciler.swift), [matching regressions](https://github.com/fiukewhfkje/GradeViewer/blob/1761c0fc7b4da944a6d551b453cd016ac472e052/Tests/GradeCoreTests/MatchingAuditTests.swift), [renewal/recovery record](https://github.com/fiukewhfkje/GradeViewer/blob/07a2616/RESEARCH.md), and [original removal audit](https://github.com/fiukewhfkje/GradeViewer/blob/ff40de6/docs/PROVIDER_PARITY_AUDIT.md). No retired native tooling needs restoring.

The friend's reported IC-only class was not accessed. This investigation does not establish whether its Schoology section is absent, has no grade row, or exists without scores. The proposed IC checklist accommodates these cases without diagnosing the friend's account from the report alone.

## Parsing and normalization

The historical adapter read JSON, not scraped grade-page HTML:

```text
GET {districtApplicationBase}/resources/portal/grades
GET {districtApplicationBase}/resources/portal/grades/detail/{sectionID}
```

The first response contained schools → terms → courses → grading tasks. Detail data contained task/term records → categories → assignments. That shape already mapped to the same general grade model. These routes have historical original-account evidence; no new authenticated IC request was made here, and current official student help does not document their JSON contract.

| IC evidence | Normalized meaning |
| --- | --- |
| Verified connection/account, school/calendar, section | Provider-scoped physical course identity; select the course once, not every quarter/task. |
| Term plus grading task/standard | Distinct grade scope within the course; do not count each scope as a separate class. |
| `objectSectionID` / verified assignment identity | Stable assignment identity within its source and grade scope. Never derive it from title, score or list position. |
| Category identity, weights and calculation options | Existing category/points rules when those options are actually available and supported. |
| `scorePoints`, `totalPoints`, multiplier, exemptions and exclusions | Numeric contribution and participation rules; distinguish absent scores from real zero and retain extra credit. |
| In-progress versus posted total/mark | Preserve the reported basis consistently; do not silently pair one basis's percentage with the other's letter grade. |
| Due/score-modified dates | Real chronology and inclusive local school-day boundaries; never invent earlier score revisions. |

Do not restore the old parser unchanged. It inferred only weighted categories versus points from `isWeighted` and defaulted category aggregation to points. Current [IC calculation documentation](https://kb.infinitecampus.com/help/grade-calculation-options-instruction) separately describes percentage averaging, rubric methods, cumulative grading and rollups. Unknown rules must remain unknown rather than make an editable but incorrect baseline. Preserve missing/late flags without manufacturing a zero score.

IC also distinguishes posted and in-progress grades, tasks and standards in its [student tools](https://kb.infinitecampus.com/help/tools-in-campus-student). Its [composite rules](https://kb.infinitecampus.com/help/establish-composite-grading-rules) can build a semester from child tasks and their relative weights. The old implementation sometimes borrowed Schoology's semester date range for an IC Final task attached to the closing quarter. Without linking, that information must come from IC's own verified structure; the task name alone cannot manufacture a full semester range or weights.

The [portal configuration documentation](https://kb.infinitecampus.com/help/portal-setup-admin) permits hidden assignments to participate in totals. This is a documented possibility, not a finding about the friend. A reported total can still be displayed when its individual inputs or rules cannot support a local calculation.

## Normal refresh and local data

Reuse launch, real foreground return, pull/Retry and coalesced active checks. Fetch the IC summary for discovery and selected-course status, then bounded detail reads only for selected sections. The summary itself may contain unselected course totals; selecting one course does not imply the provider exposes a one-course discovery response. Course-list management should not fetch every section's assignments just to populate its checklist.

Save selected section identities as small configuration tied to the verified IC connection in the user's Worker, so another device using that Worker can reuse the selection. Keep snapshots, observed history, GPA preferences and hypothetical changes in browser-local IndexedDB. Store credentials/cookies encrypted in the personal Worker, never in the selection list or browser grade state. Worker storage of selection configuration is proposed; no grade-history cloud sync is requested.

Refresh partitions must be independent: a complete successful Schoology snapshot replaces only Schoology records, and a complete successful selected-IC snapshot replaces only IC records. IC failure retains its last complete snapshot while Schoology can finish normally. A complete, identity-verified, schema-valid empty result can remove absent records within that provider's selected scope. Authentication HTML, malformed data or a failed selected detail cannot do that. Rebase local edits against the latest saved state before atomic activation, as the existing refresh does.

Four in-memory synthetic probes against the current TypeScript code confirmed assumptions that need extending before IC records can simply be appended:

- `physicalKey()` uses a bare section/grade-owner ID. Equal numeric IDs from different providers currently group together; provider/account namespaces must prevent that collision without changing existing Schoology identities or saved GPA keys.
- `reconcile()` currently labels every new reported observation `schoology`.
- Calling `reconcile()` with only the newly successful Schoology rows removes previous IC rows; a caller must retain the other provider's partition.
- `visibleCourses()` chooses one global period label/kind. A selected IC course with a different valid term label can disappear even with distinct IDs. Course visibility must support the actual periods of both sources without asking users to map terms.

These are expected limitations of today's Schoology-only code, not regressions affecting current supported users. Extend the canonical core and persistence contract narrowly; do not reintroduce the old automatic cross-provider reconciler.

## GPA and the course screens

Expose selected IC classes in the same course UI and **Estimated semester GPA → Edit courses** list, with the same level suggestions, credits, exclusions and temporary letter-grade previews. The numerical GPA calculation can be shared once normalized IC semester records reach it; it does not need a separate IC GPA calculator or linking workflow.

This fixes missing GPA contributions only when the added class has a usable semester total/letter or a supported, fully specified semester rollup. Today's GPA code marks a quarter-only class **No semester grade**. A current-quarter percentage must not masquerade as a semester grade, and multiple tasks/standards cannot become multiple GPA contributions. Unsupported or incomplete classes remain visible as incomplete; including IC does not make the estimate an official transcript GPA.

Namespaced physical course IDs protect separate providers. They intentionally do not identify the same real class across both providers. With no linking or deduplication, selecting an overlapping IC course can still duplicate it in the estimate; the selected-only scope is how this design avoids that in normal use.

Reported totals, local what-if changes and historical observations keep their existing separation. Graph reconstruction and semester propagation can share current logic only when IC supplies the required rule, period and date evidence. Missing evidence withholds the projection rather than inventing an identical-looking result.

## Sign-in, lifetime and fast reconnect

The historical capture used native `WKHTTPCookieStore`, not JavaScript in an ordinary portal tab. Browser [same-origin restrictions](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy) and [HttpOnly cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) mean a PWA cannot just open the district login page and read its cookies afterward. A managed browser in the user's cloud account is a candidate for recreating the experience, using the existing isolated browser/session research as reference. That is not yet an IC PWA connection or a verified district-login solution.

IC's [SSO documentation](https://kb.infinitecampus.com/help/sso-service-provider-configuration) describes reuse of an existing IdP session. Its [student login help](https://www.infinitecampus.com/support/parents-and-students) describes Stay Logged In for the official mobile apps; it does not establish a 30-day grant for GradeViewer. The old implementation retained each cookie's offered expiry and saved server rotations/deletions; it did not extend server authorization. Neither the historical tests nor this investigation establish the interval before human sign-in is required.

The owner's requested recovery behavior is:

1. Ordinary refresh uses HTTP, with rotated cookies retained. Only a verified authentication rejection can start one bounded, coalesced silent SSO renewal.
2. If human input is required, keep saved grades usable and show **Reconnect Infinite Campus** in Settings and beside affected IC data. Keep Schoology usable independently.
3. One click opens the normal district sign-in; the account holder handles credentials/MFA and any policies. On successful same-account verification, close/resume automatically, retain the selected courses/history/local edits and refresh them. Do not ask the user to select classes again or transfer cookies manually.
4. Network errors, permission failures and cooldowns offer the appropriate Retry/status rather than unnecessary relogin. Expiry means reconnect required, not disconnected; it must not clear account data.

Seamless renewal, fast phone sign-in, server-side student binding, Worker HTTP portability, actual expiry windows and browser quota cost need an explicitly consented IC test. The native implementation explicitly lacked established same-district student identity binding; do not carry that gap into the PWA. One-click entry/resume can be designed now, but the duration of district password/MFA interaction cannot be guaranteed.

The official [OneRoster integration](https://kb.infinitecampus.com/help/oneroster-api) instead requires configured district/vendor connection credentials. The reviewed contract does not establish a self-service student credential flow that replaces this session experiment.

## Implementation order and evidence limit

First prove IC sign-in, account verification, Worker HTTP reads, rotation and reconnect with consent and private state outside Git. Then implement the strict TypeScript adapter, selected-course configuration, independent snapshot partitions and provider-aware period/history/GPA behavior. Finally expose the Settings checklist and exercise synthetic course selection, failed-detail/empty results, expiry/reconnect retention, local edits, GPA and multi-device behavior. No linking screen belongs in these steps.

This investigation used Git history, current source, current primary documentation and four synthetic in-memory probes. It read no private capture, cookies or student account and changed no production state. No IC feature, 30-day lifetime, live parsing compatibility, PWA SSO renewal or physical-device result is claimed. The Settings rename has separate validation recorded in [PWA validation](PWA_VALIDATION.md). All work remains on the existing development branch; no main merge, release or deployment is part of this task.
