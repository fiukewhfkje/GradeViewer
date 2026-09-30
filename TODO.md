# Next work

## Completed

- [x] Native local app, Git from the beginning, signed iPhone app/widget installation and launch.
- [x] Both real provider fetches; correct Campus section detail IDs and Schoology grade-owner aliases.
- [x] Persist active/pending credentials safely and reuse them across reinstall/relaunch.
- [x] Supplied-reference layout, dark mode, stronger typography, course/assignment menus, no quarters or polling timer.
- [x] Smooth graph tracing with discrete grade/date thresholds, dim remaining curve, light tooltip, release clearing and first-point flat line.
- [x] Remove manual course Settings screens; unique assignment-evidence matching merged five live course pairs.
- [x] Preserve individual assignment graph points with tied timestamps, equal event spacing, and reconstruction through the latest fetch.
- [x] Parse real scoreModifiedDate; rounded static update labels for every current class.
- [x] Hide ungraded rows and retain Schoology-only graded work; fix the observed missing Biology extra-credit row.
- [x] One deterministic assignment ordering rule across every class; regressions for equal dates and undated scores.
- [x] Schoology categories in full view, historical quarter grades, catalog metadata and physical-row deduplication without changing current calculation basis.
- [x] Remove fake blue +0.01% caused by unchanged overrides/provider rounding.
- [x] Small/medium widget, shared content/App Group validation, add-widget instructions and tap routing.
- [x] Detailed final report and separate Muse report covering all four requested subjects. No watcher deployed.
- [x] Create explicitly requested private GitHub repository and preserve existing history.

## Further evidence-driven validation

- [ ] Reconnect Infinite Campus on the phone: latest authenticated check returned HTTP 401. Cached Campus grades are preserved; Schoology succeeds.

- [ ] Compare additional Bessy/native-portal screens if the user supplies them; exact private Bessy tie-break rules are not documented.
- [ ] Observe naturally populated prior-quarter data and new real grade changes. Fixture coverage establishes local behavior, not future district payloads.
- [ ] Calibrate timezone-less dates, real rubric/rounding/override rules and unusual assignment scales when an actual discrepancy is found.
- [ ] Observe offline relaunch, cookie rotation and eventual session expiry/reconnect. Bind cache to verified account identity before supporting account switching without explicit disconnect.
- [ ] Verify actual Home Screen placement, reload and widget taps on the phone.
- [ ] Measure physical-device cached launch/scrolling if performance issues are observed. Do not treat the earlier debug simulator metric as a device benchmark.
- [ ] Verify changed-since semantics/rate limits before a separate authorized Muse watcher uses sustained polling.
- [ ] Renew development provisioning after October 6, 2026 when needed.

No notification server, continuous app polling, paid tier, planner, analytics or speculative provider workaround.
