# November 4 testing follow-up

Main now includes the optional selected-IC Settings flow for the owner’s Cloudflare testing, with no stable tag/release. Preserve the existing deployment/password/vault. Actual IC district/identity/phone acceptance remains open. Carmen work must stay on codex/investigate-gpa-carmen and must not deploy. The older migration handoff below is historical; PROJECT_STATUS.md and AGENTS.md contain the current authorization and evidence.

Carmen runtime integration is now implemented on the held branch. Read [Carmen integration](CARMEN_INTEGRATION.md) and [capture status](CARMEN_HANDOFF.md); do not deploy it or treat synthetic results as enrolled-account evidence.

# Current handoff — October 23, 2026

GradeViewer is now a web-only React/TypeScript PWA in `web/`, backed by each user’s Cloudflare Worker. The owner requested retirement of all Swift sources, native dependencies/tests/build setup and migration-only calculator comparisons. Their final 1,200 synthetic comparisons passed before removal. No frozen comparison corpus or native CI dependency remains; focused calculator tests stay in the ordinary web suite. Native history is available at commit `4100e615130b407a4dc5b2901f936d39c789482a` and earlier.

Read [AGENTS.md](../AGENTS.md), [architecture](../ARCHITECTURE.md), [current status](../PROJECT_STATUS.md), [TODO](../TODO.md), [validation](PWA_VALIDATION.md) and the [product brief](PRODUCT_BRIEF.md). [PWA_PLAN.md](PWA_PLAN.md) is historical migration rationale, not active instructions to keep native sources or repeat the migration.

The owner-only session experiment concluded November 9. Carmen remains Experimental in v0.2.3. IC and Carmen session checks start automatically after successful sign-in. The first unlocked status read schedules eligible saved connections from earlier versions. [Carmen integration notes](CARMEN_INTEGRATION.md) cover the LMS switch, compatibility report, bounded recovery and private Worker diagnostics. The [capture handoff](CARMEN_HANDOFF.md) preserves historical evidence. Old Mac/Muse sessions remain separate from the PWA, and enrolled-account acceptance remains open.

## Setup and release boundaries

The supported setup is GitHub template first, then connect that existing repository to Cloudflare with root `web`. Follow [onboarding](PWA_ONBOARDING.md) and [automatic updates](AUTOMATIC_UPDATES.md). Preserve the existing Worker, URL, vault, APP_PASSWORD, sessions and exact signed-source verification boundary. Do not recreate published tags or repeat the completed migration merge. Existing main-branch Cloudflare Builds deploys merged changes; this cleanup does not require a new stable tag.

Last recorded release/deployment evidence is signed v0.1.8 from October 20. It adds the desktop workspace, authenticated account-matched cached startup, guarded semester graph reconstruction and safer per-tab update activation. Its production upgrade, synthetic-state/form preservation and live-asset/provenance checks passed at that time. The October 18 natural scheduled acceptance was not observed in the recorded session. Current cleanup evidence belongs in PROJECT_STATUS.md and PWA_VALIDATION.md; do not treat older test counts as new runs.

## Local verification

Run commands from `web/`:

```sh
npm ci
npm run build
npm test
npm run test:e2e
GRADEVIEWER_BROWSER=webkit npm run test:e2e
npx wrangler deploy --dry-run --outdir .local-test/production
npm run release:package
node scripts/verify-template.mjs
```

Use synthetic fixtures and headless CLI browsers only. No connected-browser or desktop GUI automation. Never print credentials, cookies, raw Schoology responses or real grades. Live provider checks are opt-in, scoped to the user’s own Worker, and unnecessary for native retirement. Protected local captures under ignored `artifacts/` are user-owned evidence, not disposable build caches.

## Remaining acceptance limits

Independent-account onboarding/full-chain update and rollback, real credential retention on that chain, physical iPhone/Android Home Screen behavior and a couple-second expired-open guarantee remain unverified. The last recorded natural-expiry sample was 3.043 seconds / six calls; warm results do not prove every-open speed. See TODO.md for the remaining work. Earlier detailed migration/native handoffs and environment-specific recovery notes remain in Git history.
