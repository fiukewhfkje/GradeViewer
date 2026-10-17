# GradeViewer implementation report

The active application is a Schoology-only PWA in `web/`. Production is [GradeViewer](https://gradeviewer.fiukewhfkje.workers.dev). The original native app remains in the repository as the behavior reference. Current release and verification evidence is maintained in [PROJECT_STATUS.md](PROJECT_STATUS.md) and [PWA validation](docs/PWA_VALIDATION.md).

## Grades and local scenarios

Course cards and detail summaries share the same semester overall. Assignments retain real provider scores, dates and provenance. Quarter scopes, collapsible category groups, named ungraded work and read-only exam rows stay available. Edit/drop/reset/restore/remove/Add Grade operate locally against a reproducible calculation basis. No provider write endpoints exist.

## Progression and refresh

The chart reconstructs dated assignment prefixes only when the complete baseline is reliable. It keeps observed history separate, preserves real small changes and never invents unavailable dates or score revisions. The native GradeCurve geometry uses evenly spaced events and monotone interpolation. Held selection traces the line while showing the nearest actual event's grade/date; release clears it. The PWA uses the native chart height, neutral line, rounded background and gradient fill.

Phone refresh belongs to the app scroll view. A single vertical pull from the top reveals only a spinner. Release past the threshold starts one refresh and retains the indicator until completion; cancellation and short gestures settle without a request. Profile exposes an accessible refresh action. Foreground fresh-data gating and failure retention remain part of the data layer.

## Profile and installation

Profile groups the Schoology connection, appearance, personal website and app actions. The website can be copied or opened; installation instructions cover iPhone/iPad and Android. Each deployment belongs to its user. A copied repository receives verified official source updates through GitHub Actions and Cloudflare Builds.

## Storage and security

The user's Worker stores encrypted API credentials and hashed owner sessions. Browser-local IndexedDB holds grades, history and scenarios. The service worker caches only the app shell. Native reference storage uses SwiftData and installation-scoped Keychain. These are distinct storage models; the PWA does not import native history or edits.

Build, fixture, browser and release evidence must be read with its recorded scope. Headless browser checks do not establish physical Home Screen behavior or a universal refresh latency guarantee. No Muse watcher is implemented or deployed.
