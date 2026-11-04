# GradeViewer product brief

GradeViewer is a simple, personal Schoology grade viewer with optional selected Infinite Campus classes. The active product is the React/TypeScript PWA in `web/`, backed by a user-owned Cloudflare Worker. The TypeScript core and focused web regressions define current behavior; the retired native app remains in Git history. Earlier superseded requirements remain in Git history.

## Product and ownership

- Schoology discovers courses automatically; personal student API access must be permitted by the school. Optional Infinite Campus classes are selected in Settings. Keep the setup free of course linking, mappings and cross-provider assignment deduplication. IC is currently for owner testing, with district compatibility unverified.
- Each user owns their Cloudflare deployment and encrypted credentials. Grade snapshots, history and hypothetical changes stay in that browser.
- No subscriptions, ads, analytics, central student-data service, Muse dependency, widgets or speculative features.
- Browser and installed Home Screen modes should feel like the native app. Keep the app fast, restrained and easy to use.

## Grades and calculations

Show current courses, reported grades and available letter grades, assignments, categories, recent grading activity and progression. Reported interpretable totals take priority; use canonical calculations only where supported. Never invent missing scores, dates, teacher rules or provider history.

Preserve semester summaries, quarter assignment scopes and read-only exam placement. The course graph tracks that same uniquely associated semester, rather than joining raw quarter percentages. Reconstruct weighted semester events only when the declared component weights reproduce the semester baseline; preserve actual semester observations and withhold unsupported reconstruction. Calculators must use one canonical Schoology contribution per assignment. Local edit, drop, restore, reset, removal and Add Grade actions never write to Schoology. The final calculator uses the entered syllabus weight. Keep calculated graph points separate from observed history; the tooltip contains only the selected event's grade and date.

## Presentation

Use the native app's warm light/dark palette, green grades, course cards, compact course navigation, neutral filled progression chart and collapsible assignment groups. Support system, light and dark appearance. Settings uses grouped connection, appearance, personal website and app controls. Provide a copyable/openable personal address, Home Screen installation help and a Check for updates action that installs a ready app-shell update without losing local data.

Desktop uses a persistent navigation/course sidebar, a course-card grid and side-by-side grade/graph and recent-assignment panels. Phone navigation stays compact. A held chart owns its touch gesture, including vertical finger drift; selection follows display frames and clears on release or cancellation.

On phones, pull down from the top to reveal a spinner, release past the threshold to refresh, hold the indicator until completion and settle smoothly. There are no pull/release text prompts. A cancelled or short gesture must not refresh. Normal scrolling, chart gestures and form controls keep their interactions. Browser refresh and app refresh must not compete. Desktop and accessible Settings controls provide manual refresh too.

## Refresh and persistence

Refresh on launch, actual foreground return and active checks, coalescing in-flight requests. A previously unlocked browser immediately shows its account-matched saved snapshot using an unexpired local access receipt, before the network session check. Background refresh is quiet, with no repeated updating label or blocking loading screen. Keep saved grades visible offline and on provider failure with a saved-data notice and Retry. Explicit Lock app blocks cached startup until the app password is entered again, even when server logout cannot complete; expired receipts and account mismatches never grant cached access. Live API authentication is unchanged. First connection still waits for complete verified grades. Preserve open forms and merge local edits into a refreshed snapshot. Honor server cooldowns and bounded retries; returning opens defer optional title traversal to manual refresh. Updates preserve the user's URL, vault, sessions and browser-local data, compare cached shell identity and wait for service-worker takeover before reload.

## Verification and delivery

Use synthetic fixtures and headless CLI browsers, including small phones, desktop, light/dark, offline/failure, touch cancellation, held chart selection and installed-mode assumptions. Inspect screenshots. No connected-browser or desktop GUI automation. Never print credentials, real student records, cookies or raw provider responses. Keep native history in Git; do not restore Swift tooling or migration-only parity checks.

Run relevant build, unit, browser and release checks; use focused commits, reviewed delivery and the existing signed source-release/update workflow. Update PROJECT_STATUS.md, TODO.md and PWA validation with actual evidence and limits. Physical iPhone/Android installation cannot be claimed from desktop browser emulation.
