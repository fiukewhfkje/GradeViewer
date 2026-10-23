# Architecture

GradeViewer is a Schoology-only React/TypeScript PWA. `web/` is the self-contained build, deployment and template root. The retired Swift app and its build/test infrastructure remain in Git history. `web/src/core/` owns current grade behavior; no Swift or macOS tooling is needed.

## Browser and Worker

React/Vite renders Grades, Profile, course details, assignments, local scenarios and the final calculator. `web/src/core/` provides framework-independent models, parsing, calculations, periods/estimates, reconciliation and progression. `refresh.ts` coordinates fresh reads; `repository.ts` stores versioned IndexedDB snapshots, observations, scenarios and metadata, with prepared-save recovery.

Each user owns a Cloudflare Worker and SQLite Durable Object. `web/worker/` stores encrypted API credentials, hashed owner sessions, cooldowns and bounded verification/cache receipts. Grade snapshots, history and scenarios remain in the browser. APP_PASSWORD unlocks the deployment; AES-GCM envelope encryption protects the credential vault. Cloudflare executes decryption/signing and is part of the trust boundary. Password changes revoke sessions and require reconnecting Schoology.

Only fixed, enrolled-section Schoology GET routes are signed. Identity verification precedes student reads; redirects are re-signed and origin/path/pagination/payload limits are enforced. Pending credentials activate only after complete parsing and prepared browser persistence. Failure retains the prior connection and snapshot; switching students requires disconnect. No provider write endpoints exist.

## Grade identities and calculations

Section/grade-owner/period and typed assignment IDs define identity; titles never merge distinct assignments. Reconciliation preserves course identity, ordering, visibility, observations and explicit local removals. Only a complete schema-valid successful snapshot replaces saved data, including a valid empty result.

Reported interpretable numeric/letter totals take priority. Verified numeric/percent scales permit numeric overall interpretation; unsupported or hidden scales do not become percentages. Omitted student-hidden category methods/drop counts retain points/zero defaults, with provenance rather than a claim about hidden teacher rules. Explicit unsupported rules, incomplete numeric contributions and letter-only assignments withhold unsupported calculations. Each assignment contributes once, including local editing, drops and additions.

Home and detail share the uniquely associated semester summary. Quarter scopes retain their own assignments/rules; exams appear read-only under the uniquely containing dated quarter and do not enter that quarter’s calculation. Date-only and timezone-free midnight boundaries cover the full local school day; explicitly zoned timestamps retain their exact instant. Semester scenarios require a reproducible baseline within 0.15 percentage point and apply only the local delta. The final calculator uses the entered syllabus weight.

A missing-quarter estimate inverses a reported semester using explicit, unambiguous component weights and known totals. Blank exams contribute neither grade nor weight; a reported zero is real. Unsupported scales, ambiguous dates/components, overrides or unstable propagated rounding uncertainty withhold the estimate. Estimates remain presentation-only, disclose their basis and never create assignment scores, observed history or scenario baselines. Actual reported/calculated totals take priority.

## Progression and refresh

Progression combines actual observations with separately calculated dated assignment prefixes, using each period’s canonical baseline. It never invents dates or overwritten provider score revisions. Actual observations win at identical timestamps. Matching reconstruction may align within one hundredth only inside the same assignment interval; genuine small observed changes and new assignment events stay visible. Evenly spaced events and monotone interpolation supply geometry; tooltips contain the selected actual event’s grade/date only.

Launch, actual foreground return, manual refresh and active checks coalesce in-flight reads. Grade screens wait for a complete fresh snapshot while Profile/Retry remain reachable. Failure preserves saved data. Metadata/alias receipts have fixed expiry; manual refresh bypasses reuse while honoring server cooldowns. Required reads precede optional scale/title recovery. Bounded batches enforce concurrency, subrequest and aggregate payload budgets. See [performance evidence](docs/PERFORMANCE_REPORT.md) for measurements and limits.

## Installation, updates and validation

The static-only service worker caches the app shell, never API responses. Controlled per-tab activation preserves browser-local data and open forms. Static `_headers` and API wrappers enforce security headers.

GitHub template-first setup copies the root updater launcher; Cloudflare connects that repository with root `web`. Signed source releases update each copy through GitHub Actions at midnight America/New_York; Cloudflare Builds deploys to its existing address. Exact official repository/workflow/tag/commit provenance and file hashes are verified before writes. Personal configuration, secrets and workflow permissions are preserved. Initial template copies may initialize a short root README; later owner edits remain untouched. See [automatic updates](docs/AUTOMATIC_UPDATES.md).

Build, unit/security/integration tests, synthetic Chromium/WebKit flows and release packaging use Node tooling from `web/`. Migration-only Swift comparisons were removed after their final 1,200-case pass; focused calculator regressions remain in `web/tests/core.test.ts`. Physical phone, independent-account setup and performance claims require their own evidence. See [current status](PROJECT_STATUS.md) and [validation](docs/PWA_VALIDATION.md).
