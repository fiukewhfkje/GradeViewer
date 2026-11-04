# GradeViewer development instructions

GradeViewer is a Schoology-primary React/TypeScript PWA with optional selected Infinite Campus courses in `web/`, backed by a user-owned Cloudflare Worker. The Swift app, GradeCore, Xcode project, native tests and migration-only calculator comparisons were retired on October 23, 2026 at the owner’s request. Their sources remain in Git history; do not restore native tooling or parity CI.

Read README.md, PROJECT_STATUS.md, TODO.md, ARCHITECTURE.md, RESEARCH.md, docs/PWA_HANDOFF.md and docs/PWA_VALIDATION.md before continuing. docs/PRODUCT_BRIEF.md defines the product scope. docs/PWA_PLAN.md preserves historical migration rationale.

- Keep the app fast, simple and independent of Muse. Schoology discovers courses automatically and omits empty gradebooks; Infinite Campus imports only selected IC-exclusive courses. Do not add blank-course placeholders or class hide/restore controls. Do not add course linking or cross-provider assignment merging. No paid tiers, analytics, ads, shared maintainer backend, widgets, planner or speculative features.
- `web/src/core/` is the canonical implementation for parsing, reconciliation and calculations. Never sum deduplicated presentation variants as separate calculator contributions.
- Each user owns the Worker and encrypted Schoology credentials. Grade snapshots, history and hypothetical changes stay in browser-local IndexedDB. Never log credentials, cookies, keys, raw provider responses or student grades. Committed fixtures must be synthetic.
- Never invent provider data or assume a hypothetical provider failure occurred in a student’s account. Distinguish official docs, fixture tests and student-verified behavior.
- Preserve the last successful snapshot on a provider failure. A successful empty response must be schema-valid before removing records. Hypothetical edits must never call provider write endpoints.
- Keep calculated graph points separate from observed history and never invent missing dates. The tooltip shows grade/date only, per the user’s preference.
- Use synthetic tests and headless CLI browsers. No connected-browser/computer-use or mouse/keyboard GUI automation.
- At the owner's explicit request for two visible sign-in windows, isolated local Chromium captures may use `--local-sign-in` for human input only. The agent must not fill credentials, approve Duo or accept policies. Automated tests and renewal stay headless; this exception does not authorize connected-browser/computer-use tools.
- Validate browser-dependent behavior with local synthetic fixtures first. Use the owner's Cloudflare Browser Run quota only when a necessary check cannot be performed locally or answered through read-only diagnostics. For that check, use a single short session with a defined timeout, explicitly close it on success or failure, and verify cleanup. Avoid repeated live probes while diagnosing a failure.
- Keep `web/` buildable as an isolated template root. Run appropriate `npm run build`, `npm test`, browser and release-package checks from `web/`; keep CI proportional and do not reintroduce cross-language comparisons.
- Preserve the existing Worker, URL, vault, password, sessions and signed source-update verification boundary during updates. Use existing merge/deployment workflows; repository cleanup alone does not require a new stable tag.
- Use focused commits and preserve Git history. The PWA migration is already merged; do not repeat its merge or recreate published tags.
- GPA/Carmen work stays on the owner's GitHub development branch until the owner explicitly lifts the release hold. Do not merge it to `main`, create release tags or GitHub releases (including prereleases), update stable installations or deploy it to production. Branch pushes and local validation remain authorized.
- Before continuing isolated Carmen diagnostics, read `docs/CARMEN_HANDOFF.md` for the persistent private storage path, actual capture status, evidence, commands and blockers. Never assume a session exists from a directory/key alone; keep private state outside Git.
- Update PROJECT_STATUS.md and TODO.md before ending. Keep docs honest about credentials, district access, physical-device acceptance, deployment and validation limits.
- Widgets are intentionally removed. Do not restore widget routes or native extensions.

- November 4 authorization: implement IC on main and deploy only to the owner’s existing Cloudflare Worker for testing, with no new stable tag/release. Finish Carmen on `codex/investigate-gpa-carmen` without deploying it. Keep only those two branches. The proposed 90-minute Carmen HTTP keepalive is an unverified lifetime experiment, not a promise that requests reset the server idle timeout.

- Carmen runtime is implemented only on the held investigative branch. Read docs/CARMEN_INTEGRATION.md for normalization, standalone workspaces, separate OSU GPA and HTTP-only session-maintenance limits. Keep the branch undeployed and distinguish synthetic checks from enrolled-account acceptance.

- November 4 presentation follow-up: restore the IC district-finder browser flow, support modern Student home destinations, and keep Settings contained from phone through large monitor. The owner explicitly requested immediate cached grades and removal of the persistent updating/loading UI. An unexpired account-matched browser unlock receipt permits local cached startup before the network check; explicit Lock, receipt expiry and account mismatch must still block it. Provider/API authentication remains unchanged. Keep Carmen undeployed.
