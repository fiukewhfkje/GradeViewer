# GradeViewer

Your personal Schoology grade viewer, in a browser or on your phone.

Cloudflare runs your personal copy; GitHub stores its code. You need a free account on each. Setup happens once, then you use your own website.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/fiukewhfkje/GradeViewer/tree/main/web)

1. Tap **Deploy to Cloudflare** above and sign in to Cloudflare, or create an account. Choose the Free plan if asked.
2. On **Set up your application**, use these settings:

   | What you see | What to do |
   | --- | --- |
   | **Git account** | Tap **New GitHub connection**, sign in to GitHub (or create an account), and approve Cloudflare. Return to Cloudflare and select your GitHub username. If your username is already listed, select it. |
   | **Create private Git repository** | You can check this to keep your personal code copy private. |
   | **Project name** | Keep `gradeviewer`. |
   | **APP_PASSWORD** | Choose a new password just for GradeViewer, **at least 12 characters**. Generate and save it with your password manager; you will enter it to unlock your app. |
   | **Build command** | Keep `npm run build`. |
   | **Deploy command** | Keep `npm run deploy`. |
   | **Enable Preview builds** | Turn this off. You only need your main app. Leave Preview command alone. |

3. Tap **Deploy** and wait for it to finish. Open the website address ending in **workers.dev** that Cloudflare gives you.
4. In **Profile**, unlock with the app password you saved. Tap **Get my Schoology keys**, sign in to your school account, then copy your personal API key and secret into GradeViewer and connect. Your school must allow personal API access.
5. Use the website, or open **Profile → Add to Home Screen** for phone installation instructions. Save your website address; Profile also has a Copy button.

You stay unlocked for up to 90 days per browser. Your password manager can autofill the password when you need it again.

<details>
<summary>Updates and rollback</summary>

Official fixes are checked daily by the **Update GradeViewer** workflow in your GitHub copy; Cloudflare builds the resulting update automatically. To update now or roll back, open your GitHub copy → **Actions → Update GradeViewer → Run workflow**. Leave Version blank for the latest release, or enter an earlier release such as `0.1.0`. Keep GitHub Actions and the Cloudflare Git connection enabled. GitHub can pause schedules in inactive repositories; Run workflow restarts a paused schedule. Reload when the app offers an update.

Deployment preserves your address and secrets. Keep your app password unchanged during updates; changing it revokes sessions and requires entering Schoology keys again. Version 0.1.0 required 20 characters, so copies set up with a shorter password should stay on 0.1.1 or later.

</details>

<details>
<summary>Your data</summary>

Your Schoology keys are encrypted in your own Cloudflare account. Grades, history and local changes stay in each browser. Browser storage clearing or key revocation can require reconnecting. Disconnect before switching students. Grades are read-only; local edits never change Schoology. This PWA does not import the native iPhone app’s local history or edits.

</details>

Development and release evidence: [PWA validation](docs/PWA_VALIDATION.md). The prior Swift app remains available as a behavior reference; its [native setup is archived](docs/NATIVE_SETUP.md).

Current maintainer handoff: [PWA_HANDOFF.md](docs/PWA_HANDOFF.md).
