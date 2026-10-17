# GradeViewer

Your personal Schoology grade viewer, in a browser or on your phone. Your own Cloudflare account runs the app; grades and local changes stay in your browser. You need free GitHub and Cloudflare accounts.

## Set up your copy

1. **[Create your GradeViewer copy](https://github.com/new?template_owner=fiukewhfkje&template_name=GradeViewer&name=gradeviewer&visibility=private).** Sign in to GitHub, keep the name `gradeviewer`, choose **Private**, and create the repository. Keep **Include all branches** off. This includes the automatic updater; you do not create or edit any code.
2. Open **[Cloudflare setup](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)** → **Continue with GitHub**. On **Select a repository**, choose your GitHub account, select the `gradeviewer` copy you just created, then click **Next**. If asked to authorize Cloudflare, include that copy. This link skips the empty projects page.
3. On **Set up your application**, confirm the repository at the top is **your account / gradeviewer**, then use these settings:

   | Setting | Value |
   | --- | --- |
   | Project name | `gradeviewer` |
   | Build command | Enter `npm run build` in the empty field. |
   | Deploy command | Replace `npx wrangler deploy` with `npm run deploy`. |
   | Preview command | Leave `npx wrangler preview`; it is unused with preview builds off. |
   | Enable Preview builds | **Off** |
   | Protect with Cloudflare Access | Leave **Off**; GradeViewer uses its own app password. |
   | Advanced settings → Root directory | `web` |
   | Advanced settings → Build variables and secrets | Add a **Secret** named `APP_PASSWORD`: a new password of at least 12 characters. Generate and save it with your password manager. |

   Expand **Advanced settings** to enter the last two settings, then click **Deploy**. The empty build field and default deploy command must be changed as shown above.

4. Open and bookmark your new **workers.dev** website. In **Profile**, unlock with your saved app password. Tap **Get my Schoology keys**, sign in to Schoology, and connect using your own personal API key and secret. Your school must allow personal API access.
5. Use the website, or choose **Profile → Add to Home Screen** for phone installation instructions. Return through your personal website address.

**Why create the GitHub copy first?** Cloudflare's public-repository import can omit GitHub Actions workflows. GitHub's template-copy path includes and enables the updater automatically. You do not need a token, a terminal, a manual workflow file, or an initial “Commit changes” step. The verified GitHub-copy/update results and the remaining independent Cloudflare verification limit are recorded in [the update guide](https://github.com/fiukewhfkje/GradeViewer/blob/main/docs/AUTOMATIC_UPDATES.md).

## Updates

Your copy checks verified official stable releases daily at **12:00 AM Eastern**, following EST/EDT. Cloudflare deploys a verified source update to your existing address. GitHub scheduling and deployment can run late.

In **Profile → Check for updates**:

- **Up to date:** no newer official stable release exists.
- **Update available:** a newer release is waiting for your copy's scheduled update/deployment.
- **Update ready:** choose **Update now** after saving or closing open changes.
- **Stalled / unavailable:** the app explains the detected delay or failed check; saved data is retained.

Newly deployed app versions also show a discreet update notice when the app opens or returns to the foreground. Other tabs keep their open forms until you accept an update in each tab.

Already installed through the old Cloudflare button? A copy without the updater needs a **one-time repair**. Keep its Worker, address and password; see [existing installations](https://github.com/fiukewhfkje/GradeViewer/blob/main/docs/AUTOMATIC_UPDATES.md#existing-installations). Recreating the Worker is unnecessary.

## Your data

Schoology keys are encrypted in your own Cloudflare account. Grades, history and hypothetical changes stay in each browser. Ordinary updates preserve the Worker, password, connection and browser storage. Clearing browser storage can lose local-only history and edits. Changing the app password revokes sessions and requires reconnecting Schoology. Disconnect before switching students.

There are no subscriptions, ads, analytics, provider grade writes or shared maintainer grade servers. The PWA does not import the native app's local history or edits.

For maintainers: [immediate development updates, preview releases and rollback](https://github.com/fiukewhfkje/GradeViewer/blob/main/docs/AUTOMATIC_UPDATES.md#immediate-development-updates). [Validation evidence](https://github.com/fiukewhfkje/GradeViewer/blob/main/docs/PWA_VALIDATION.md) · [current status](https://github.com/fiukewhfkje/GradeViewer/blob/main/PROJECT_STATUS.md) · [archived native setup](https://github.com/fiukewhfkje/GradeViewer/blob/main/docs/NATIVE_SETUP.md).
