# GradeViewer PWA performance evidence

These are previously measured cloud-workspace → Cloudflare Worker → Schoology timings from October 16, 2026. They are not physical phone or browser-render measurements. Current validation details live in [PWA validation](PWA_VALIDATION.md).

| Path | Observed elapsed time | Scope |
| --- | ---: | --- |
| Initial serial PWA implementation | 13.623 s cold; 3.6–3.9 s steady | Earlier implementation |
| Parallel reads and bounded batching | 1.171–1.393 s steady | Six same-origin calls |
| Natural metadata expiry after 310 seconds | 3.043 s | Six calls, before final startup consolidation |
| Production warm refresh | 1.417 s | Five calls, 45 complete account-bound course-period records |
| Initial production connection | 3.274 s | Includes initial setup |
| New browser with optional title recovery | 6.515 s | Stored Schoology credentials reused |

Fresh roots are read concurrently after account verification. Required metadata precedes optional scale/title recovery. Provider requests use a bounded five-read pool, fixed cache expiry and shared cooldowns. Manual refresh bypasses metadata reuse while honoring rate limits. Complete fresh scores are still requested; latency improvements do not depend on presenting cached grades as fresh.

A two-second expired-open target remains unmet by the last measured sample. Provider limits and optional title/folder traversal can delay cold setup. Spinner animation and scroll improvements are UI corrections, not evidence of faster provider responses. Physical iPhone/Android startup and refresh timings remain unmeasured.

Live measurements are opt-in against the user's own Worker; never export real records or repeatedly probe Schoology for UI work. Synthetic fixtures cover development. Native historical benchmarks remain in Git history and are not evidence for PWA performance.
