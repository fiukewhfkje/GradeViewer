# GradeViewer development instructions

GradeViewer is a Schoology-only React/TypeScript PWA in `web/`, backed by a user-owned Cloudflare Worker. The Swift app, GradeCore, Xcode project, native tests and migration-only calculator comparisons were retired on October 23, 2026 at the owner’s request. Their sources remain in Git history; do not restore native tooling or parity CI.

Read README.md, PROJECT_STATUS.md, TODO.md, ARCHITECTURE.md, RESEARCH.md, docs/PWA_HANDOFF.md and docs/PWA_VALIDATION.md before continuing. docs/PRODUCT_BRIEF.md defines the product scope. docs/PWA_PLAN.md preserves historical migration rationale.

- Keep the app fast, simple, Schoology-only and independent of Muse. No paid tiers, analytics, ads, shared maintainer backend, widgets, planner or speculative features.
- `web/src/core/` is the canonical implementation for parsing, reconciliation and calculations. Never sum deduplicated presentation variants as separate calculator contributions.
- Each user owns the Worker and encrypted Schoology credentials. Grade snapshots, history and hypothetical changes stay in browser-local IndexedDB. Never log credentials, cookies, keys, raw provider responses or student grades. Committed fixtures must be synthetic.
- Never invent provider data or assume a hypothetical provider failure occurred in a student’s account. Distinguish official docs, fixture tests and student-verified behavior.
- Preserve the last successful snapshot on a provider failure. A successful empty response must be schema-valid before removing records. Hypothetical edits must never call provider write endpoints.
- Keep calculated graph points separate from observed history and never invent missing dates. The tooltip shows grade/date only, per the user’s preference.
- Use synthetic tests and headless CLI browsers. No connected-browser/computer-use or mouse/keyboard GUI automation.
- Keep `web/` buildable as an isolated template root. Run appropriate `npm run build`, `npm test`, browser and release-package checks from `web/`; keep CI proportional and do not reintroduce cross-language comparisons.
- Preserve the existing Worker, URL, vault, password, sessions and signed source-update verification boundary during updates. Use existing merge/deployment workflows; repository cleanup alone does not require a new stable tag.
- Use focused commits and preserve Git history. The PWA migration is already merged; do not repeat its merge or recreate published tags.
- Update PROJECT_STATUS.md and TODO.md before ending. Keep docs honest about credentials, district access, physical-device acceptance, deployment and validation limits.
- Widgets are intentionally removed. Do not restore widget routes or native extensions.
