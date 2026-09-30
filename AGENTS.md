# GradeViewer development instructions

Read README.md, PROJECT_STATUS.md, TODO.md, ARCHITECTURE.md, and RESEARCH.md before continuing. docs/PRODUCT_BRIEF.md preserves the user's detailed scope.

- Keep the native app fast, simple, local, and independent of Muse. No paid tiers, analytics, ads, backend, alternate icons, planner, or speculative features.
- Use Apple frameworks; GradeCore is the canonical implementation for parsing, reconciliation, and calculations. Never sum deduplicated presentation variants as separate calculator contributions.
- Never invent provider data or assume a hypothetical provider failure occurred in this student's account. Distinguish official docs, public-client evidence, fixture tests, and student-verified behavior.
- Store credentials and session cookies only in Keychain. Never log raw responses, cookies, keys, or student grades. Source fixtures must stay synthetic.
- Preserve last successful data on a provider failure. A successful empty response must be schema-valid before removing records. Hypothetical edits must never call provider write endpoints.
- Use CLI tooling and XCTest for simulator/device work. The user explicitly prohibits computer use and mouse/keyboard GUI automation.
- Modify project.yml and regenerate the committed Xcode project for target/build changes. Simulator Keychain/App Group tests require ad-hoc signing, not CODE_SIGNING_ALLOWED=NO. Run swift test for GradeCore changes and relevant hosted/UI tests for app changes.
- Keep calculated graph points separate from observed history, describe their basis in the project docs, and never invent missing dates. The tooltip shows grade/date only, per the user’s explicit preference.
- Update PROJECT_STATUS.md and TODO.md before ending. Keep docs honest about credentials, device trust, district verification, and Home Screen widget testing.
