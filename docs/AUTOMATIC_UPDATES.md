# Automatic updates

## Initial setup

Use the short [README steps](../README.md): create a private GitHub copy using **Use this template**, then connect that **existing repository** to Cloudflare with **Advanced settings → Path** set to `web`. Keep the default branch and turn preview builds off. Set a private `APP_PASSWORD` build secret once.

The repository contains `.github/workflows/gradeviewer-update.yml` at its actual root. GitHub template generation copies it, enables Actions and starts its initial push run. No file editing, token setup, initial Commit changes step or manual workflow trigger is needed for ordinary users. The full native/PWA verification workflow is restricted to the official source repository, so copied installations do not spend runner time on the maintainer's macOS/browser CI.

### README in personal copies

A new full GitHub-template copy automatically receives a short root `README.md` linking to the [official current guide](https://github.com/fiukewhfkje/GradeViewer#readme). The existing updater initializes it on the initial default-branch push. It confirms GitHub’s official template relationship, the unchanged initial commit and a clean regular README file before writing. The normal updater commit includes this one parent file without staging unrelated root files. No additional workflow or permission is needed.

App changes are committed into each copy’s `web/` folder when a new signed release is installed. Root `README.md` and `docs/` are not routinely mirrored from the official repository.

The official repository keeps its full README. Existing copies, later scheduled/manual runs and owner README edits are preserved. For an existing template copy, editing the root `README.md` on GitHub to link to the official guide is fine. `web/README.md` remains part of the signed app release and can be replaced by a future release. An old isolated Cloudflare import has no separate root README and is outside this initialization.

Do not use the old public-repository **Deploy to Cloudflare** import as a promise of automatic updates. Its GitHub app currently has administration/contents/checks/deployments access but lacks the separate Workflows permission. A deployment audit published by another project's maintainer records `.github/workflows` being removed on import. Moving the file to another source folder does not grant that missing permission. We cannot safely create GitHub workflows with a Cloudflare API token or an ordinary contents-only build credential.

Sources: [Cloudflare GitHub app permissions](https://api.github.com/apps/cloudflare-workers-and-pages), [GitHub App permission requirements](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps), [Cloudflare's subdirectory behavior](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [firsthand import audit](https://www.mailda.site/docs/receipts/deploy-button-install/).

### What was actually verified

For signed [v0.1.7](https://github.com/fiukewhfkje/GradeViewer/releases/tag/v0.1.7), a new private copy generated directly from the official template [automatically initialized and committed the link README](https://github.com/fiukewhfkje/gradeviewer-readme-probe-20261017/actions/runs/39038673175). The bot commit changed exactly `README.md` and `web/.gradeviewer-update.json`. After an owner README customization, actual signed [rollback to 0.1.6](https://github.com/fiukewhfkje/gradeviewer-readme-probe-20261017/actions/runs/39038770718) and [upgrade to 0.1.7](https://github.com/fiukewhfkje/gradeviewer-readme-probe-20261017/actions/runs/39038974996) preserved that README byte-for-byte. The test repository is archived to stop schedules and retain evidence. [Release CI](https://github.com/fiukewhfkje/GradeViewer/actions/runs/39038732036) passed 145 tests and all existing browser/native/provenance checks. This README test did not create a Cloudflare test Worker or use Schoology data.

The official repository is now configured as a GitHub template. A fresh private copy generated directly from that actual published repository also automatically ran [its root updater](https://github.com/fiukewhfkje/gradeviewer-official-template-probe-20261017/actions/runs/39005050802) and skipped the maintainer’s heavy CI. No workflow was manually created in that copy.

On October 17, 2026, a real **private template repository** was generated through GitHub into a separate private repository under the authenticated maintainer account. No workflow was manually added to that generated repository. GitHub reported the root workflow as **active**, Actions as **enabled**, and started its initial run automatically:

- [Automatic initial run](https://github.com/fiukewhfkje/gradeviewer-install-probe-20261017044121/actions/runs/39003518851).
- [Real signed v0.1.2 verification and push](https://github.com/fiukewhfkje/gradeviewer-install-probe-20261017044121/actions/runs/39003523611).
- [Real signed v0.1.3 verification and push](https://github.com/fiukewhfkje/gradeviewer-install-probe-20261017044121/actions/runs/39003558066).

Both versions used the actual GitHub Sigstore verifier, exact official release tag/workflow/source digest and archive hashes. The personal Worker name and synthetic configuration remained intact. These private evidence links are accessible to the account owner. Fixtures are retained only as evidence and archived after verification to stop their schedules.

The final asset-based v0.1.5 source was also copied directly from the official template: [its automatic initial run passed](https://github.com/fiukewhfkje/gradeviewer-final-template-probe-20261017/actions/runs/39006344618). A separate copied installation [verified and pushed signed v0.1.5](https://github.com/fiukewhfkje/gradeviewer-install-probe-20261017044121/actions/runs/39006151370). An older v0.1.4 template copy hit the REST download failure; the corrected no-version repair command successfully installed verified v0.1.5. That real invocation caught an argument-default defect, fixed with a regression for v0.1.6.

The standard workflow token was also tested against the existing real production Git integration: [the bot push](https://github.com/fiukewhfkje/GradeViewer/actions/runs/39005985578) automatically caused a successful [Cloudflare build/deployment](https://dash.cloudflare.com/9c2bc6dd88dd53aae93c31336faa212a/workers/services/view/gradeviewer/production/builds/ae60033a-bbfd-4cf0-8313-e11303c697f1). The real production PWA then installed 0.1.5 over 0.1.4 through Update now, retaining synthetic IndexedDB grade state and an unsaved second-tab form. This browser test used no real Schoology credentials; metadata checks confirmed the same Worker address, secret binding and vault namespace.

Final signed [v0.1.6](https://github.com/fiukewhfkje/GradeViewer/releases/tag/v0.1.6) also passed [latest-stable update verification/push](https://github.com/fiukewhfkje/gradeviewer-install-probe-20261017044121/actions/runs/39006699282) and [explicit immediate update verification/push](https://github.com/fiukewhfkje/gradeviewer-final-template-probe-20261017/actions/runs/39006743091). The documented no-version repair command installed v0.1.6 on the older full template copy. The real production PWA separately upgraded 0.1.5→0.1.6 with identical synthetic grade-state retention and second-tab form protection; deployed file hashes match the tested build. All four disposable private test repositories are archived and the isolated diagnostic Worker is deleted.

This is **real GitHub integration evidence**, not a genuine independent-account Cloudflare deployment. `Hakabl/gradeviewer` returned 404 to both authenticated GitHub interfaces in this session. The available Cloudflare OAuth login lists only the maintainer's original account, and its Builds API request returned 403. No connected Cloudflare plugin was available. The original production Git integration can still deploy a normal main-branch push; that does not grant access to Hakabl or establish a fresh second-account setup. No claim of independent Cloudflare E2E or physical-phone acceptance is made.

## Daily behavior and trust boundary

The workflow schedules `0 0 * * *` with `timezone: America/New_York`. GitHub handles daylight saving time. This is one daily scheduled check, not an exact deployment-time guarantee. The enabled workflow and schedule configuration were verified; an actual midnight-triggered run has not yet been observed in this delivery session. Runs use the default branch, a concurrency lock and that installation's standard `GITHUB_TOKEN`, with only contents write and checks read. No maintainer Cloudflare credential, shared proxy or personal quota is involved.

Before changing source, the installed updater verifies GitHub keyless provenance for the **exact** `fiukewhfkje/GradeViewer/.github/workflows/pwa.yml` identity, release tag, source commit and hosted runner. It then validates archive/file SHA-256 hashes, schema, package version and safe paths. Secrets, local settings and credential namespace/migration history are preserved. Writes are staged, and an interrupted application restores original files before any push.

The installed small workflow is a stable permission boundary. Ordinary releases can update their verified runtime scripts without editing it. `GITHUB_TOKEN` cannot be assumed to have workflow-file write permission, so the updater does not try to rewrite workflow YAML. A release requiring a different launcher protocol fails closed and needs a reviewed repair. Rolling back to a legacy release preserves the newer verifier/launcher; it does not silently restore the old updater bug.

An unchanged installation records a real check receipt at most every 28 days, providing repository activity without a daily Cloudflare rebuild. This addresses ordinary idle-repository expiry; it cannot override an owner disabling Actions, organization policy, exhausted account limits, revoked Cloudflare access or branch protection. Actual Cloudflare failed check runs cause up to three later source-push retries. Missing/unknown checks are never invented as failures. Repeated failures surface in the updater log and the app reports a release/deployment stall where detectable.

The app compares its running version with deployed installation metadata and official stable release metadata from a fixed, credential-free endpoint on **its own Worker**. Successful release metadata is cached for 15 minutes per Worker isolate. Stable checks use GitHub’s documented latest-release manifest asset route; this avoids the HTTP 429 observed from Cloudflare against the public REST API. The manifest asset’s Last-Modified timestamp supplies the release-age signal. Preview source discovery remains an opt-in GitHub-runner API read. A newer stable release unreceived for more than 48 hours is described as stalled, with possible causes rather than an invented diagnosis. Failed/offline checks never say the installation is current. A copied workflow's source presence does not prove its remote Actions settings remain enabled.

Static-only service-worker updates cache before offering activation. Reload requires explicit consent in each tab; pending saves and open forms block activation. Old app assets remain available while another tab still uses them. API responses, Schoology credentials and grades never enter the app-shell cache.

References: [GitHub schedules and inactivity limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [GITHUB_TOKEN event behavior](https://docs.github.com/en/actions/concepts/security/github_token), [Cloudflare Git builds](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/).

## Immediate development updates

The maintainer's main-branch Cloudflare connection deploys a normal source push immediately. Publishing a release does not make ordinary copies check before midnight.

To update a chosen independent development copy immediately, from `web/`:

```sh
npm run update:copy -- OWNER/REPOSITORY
```

This uses the maintainer's already authenticated `gh` CLI to enable/dispatch that copy's existing updater. The authenticated account must have access to that repository. It does not distribute a maintainer token or require ordinary app users to use GitHub.

For a just-published release, include its version to select it directly while GitHub’s latest-release redirect settles. This brief propagation delay was observed during the real v0.1.6 checks. For a particular release or rollback:

```sh
npm run update:copy -- OWNER/REPOSITORY --version 0.1.7
npm run update:copy -- OWNER/REPOSITORY --version 0.1.3
```

A rollback changes app source, not the existing URL, vault, secret or browser database. The next daily check resumes the selected channel; it can reinstall the latest stable release. Do not use a schema-incompatible older app. v0.1.0 also requires a 20-character password; copies with shorter passwords must remain on v0.1.1 or later.

### Optional preview channel

Prepare preview changes on a development branch and keep `main` on the stable version. Publish a matching tag such as `v0.1.8-rc.1` from that branch using the same reviewed tag-release workflow. It is explicitly published as a **prerelease**, excluded from stable/latest. Only opt the development copy in:

```sh
npm run update:copy -- OWNER/REPOSITORY --preview
```

Preview selection persists in that copy's non-secret receipt. It accepts only signed official releases and selects the highest valid stable/alpha/beta/rc version. The midnight schedule stays the same; run the command again for an immediate check. Return to stable with:

```sh
npm run update:copy -- OWNER/REPOSITORY --stable --version 0.1.7
```

No unsigned branch/main build is accepted as a release.

## Existing installations

Do **not** delete or recreate the Worker, change its password or rotate credentials to install the updater. From an up-to-date checkout of the official GradeViewer repository, a maintainer with authorized GitHub workflow-write access can make one verified repair:

```sh
cd web
npm run repair:copy -- OWNER/REPOSITORY
```

The helper clones the existing copy, verifies the latest stable release (or an optional explicit version), preserves personal settings and storage bindings, installs only the exact reviewed **signed** launcher at the repository root, and pushes normally. It then enables the workflow. The existing Cloudflare Git connection builds the commit. A successful source push is not reported as a successful deployment.

If the account explicitly disables Actions or revokes Cloudflare access later, that account owner must restore the affected authorization. Repository code cannot safely override those account decisions. The app's stalled/repair message is the recovery signal.

## Remaining independent acceptance check

Use a genuinely independent account and the template-first README path, then confirm its Worker automatically deploys two signed versions, rejects a damaged release, preserves its real URL/password/Schoology connection and browser-local changes, and accepts a PWA update. Also confirm rollback and the configured daily/manual triggers. Do not substitute a CLI deploy or synthetic local Worker for this check.

The minimum unavailable access is repository/workflow access to the chosen independent copy, Cloudflare Worker/Builds access to that same independent account, and an authorized initial setup session. No credential values should be pasted into chat or committed. The user plans to repeat their second-account setup after delivery; until then that independent acceptance remains unverified.
