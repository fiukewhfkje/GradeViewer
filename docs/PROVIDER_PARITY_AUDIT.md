# Schoology assignment and calculation audit

Schoology is GradeViewer's sole supported provider. This file retains the useful Schoology evidence from the October 8–15, 2026 audits; current release evidence lives in [PROJECT_STATUS.md](../PROJECT_STATUS.md).

The original cached-account audit retained 131 Schoology assignment rows, including 68 graded rows across five current classes. These were last-successful snapshots, not a new live refresh. The upgrade check preserved those 68 graded rows, five home cards, 20 observations and corresponding graph endpoints. No credentials, resource IDs, score values or raw responses are included here.

Fresh student API reads later established that category methods/drop counts can be hidden. Omitted fields retain the documented client points/zero-drops defaults with available weights; they do not prove the teacher's hidden rules. Reported interpretable totals take priority. Explicit unsupported rules withhold calculations. Numeric/percent scales are verified before interpreting custom-scale totals.

The October 15 title audit resolved all graded Biology titles and matched all 30 assignment rows in the student's Schoology comparison, including 28 graded rows. One extra API-only untitled grade could not be resolved after complete reachable metadata/folder reads. Its cause was not inferred. At the user's direction that identity was removed locally with a restore action; raw source data was preserved and no Schoology write occurred.

Dates, points, category, period and item-kind conflicts prevent metadata borrowing. Equal counts or similar titles alone do not prove assignment identity. Scenario calculations never double-count presentation variants. Original-account evidence does not establish every district's API permissions or future total agreement.
