# Provider assignment audit — October 8, 2026

**Decision: switch GradeViewer to Schoology only. No IC-exclusive assignment was found in the five current classes.**

Read-only USB captures contained both complete last-successful provider snapshots, about nine minutes old at the initial capture. A second capture contained the same snapshots. A new live refresh did not complete before phone access ended; this is a cached account audit, not a claim of a new live provider fetch or future parity.

| Current class (Q1) | IC rows / graded | Schoology rows / graded | IC rows accounted for |
| --- | ---: | ---: | ---: |
| AP Biology | 10 / 10 | 62 / 15 | 10 |
| AP Calculus BC | 11 / 7 | 11 / 7 | 11 |
| AP Computer Science A | 32 / 22 | 34 / 24 | 32 |
| AP Physics 1 | 12 / 10 | 12 / 10 | 12 |
| AP Statistics | 12 / 12 | 12 / 12 | 12 |
| **Total** | **77 / 61** | **131 / 68** | **77** |

Most pairs match normalized titles. Biology includes two truncated IC titles and six untitled Schoology grades: each has a mutually unique score/points/update-day counterpart and corresponding named Schoology catalog metadata. Matching was one-to-one; equal counts alone were not treated as proof. All other retained periods were checked: IC has no additional assignments there. Its one unmatched course shell is empty; two historical Schoology-only courses remain available.

Schoology includes seven additional graded rows (five Biology, two Computer Science). The captured snapshots omit reported overall grades; canonical calculations using the cached category basis reproduce all five IC totals within the existing 0.15 percentage-point tolerance. This is observed snapshot agreement, not proof of exact teacher rules or future grades/overrides/account behavior. The October 10 live installation established that student API reads hide category methods/drop counts. Omitted fields retain the original points/zero-drops defaults with available weights and the normal Course Grade label. Reported interpretable totals take priority; explicit unsupported category rules leave the calculation unavailable. A custom-scale overall is not used as a percentage and does not block an independent assignment calculation. The editing features are unchanged.

The change removes IC parsing, networking, cookie/SSO/browser login, profile/settings, refresh/freshness dependencies, cross-provider matching and obsolete fixtures/tests. Upgrade-only code retains compatible history/identity/local edits and clears retired Keychain items after the cache opens successfully. No credentials, identifiers, score values, or raw responses are included here. Installation was deferred on October 8. The October 10 build 7 installation, corrected live totals and fresh-connection history checks are recorded in [PROJECT_STATUS.md](../PROJECT_STATUS.md); a controlled pre/post speedup has not been measured.

Validation passed: 85 core tests, 24 hosted app tests, nine distinct focused UI cases (including 18 light/dark screenshots), Release simulator build, and a read-only captured-payload upgrade check retaining all 68 current graded rows, five home cards, 20 observations and matching graph endpoints.
