# GradeViewer

Your personal Schoology grade viewer, in a browser or on your phone.

[![Set up GradeViewer](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/fiukewhfkje/GradeViewer/tree/main/web)

1. Tap **Set up GradeViewer**. Cloudflare hosts your own private copy and offers a Free plan. Sign in/create your Cloudflare and GitHub accounts, accept the suggested setup, and choose a private **app password** of at least 20 characters. Your password manager can generate it. Keep this password.
2. Open the website Cloudflare gives you. In **Profile**, unlock with your app password, then tap **Get my Schoology keys**. Paste your personal API key and secret and connect. Your school must allow API access.
3. Use the website, or open **Profile → Add to Home Screen** for iPhone/Android instructions. **Your personal website** always shows its address with a Copy button.

**Git account** means your GitHub username. If that list is empty, use the GitHub connection control beside it, approve Cloudflare on GitHub, then return and choose your username.

Official fixes are checked daily by the **Update GradeViewer** workflow in your GitHub copy; Cloudflare builds the resulting update automatically. To update now or roll back, open your GitHub copy → **Actions → Update GradeViewer → Run workflow**. Leave Version blank for the latest release, or enter an earlier release such as `0.1.0`. Keep GitHub Actions and the Cloudflare Git connection enabled. GitHub can pause schedules in inactive repositories; Run workflow restarts a paused schedule. Reload when the app offers an update.

Your Schoology keys are encrypted in your own Cloudflare account. Grades, history and local changes stay in each browser. Browser storage clearing or key revocation can require reconnecting. Disconnect before switching students. Grades are read-only; local edits never change Schoology.

Deployment preserves your address and secrets. Keep your app password unchanged during updates; changing it revokes sessions and requires entering Schoology keys again. This PWA does not import the native iPhone app’s local history or edits.

Development and release evidence: [PWA validation](docs/PWA_VALIDATION.md). The prior Swift app remains available as a behavior reference; its [native setup](docs/NATIVE_SETUP.md) is archived.

Release candidate: source is public and a staging Worker is verified. Beginner signup/build automation, expired-open performance and physical-phone gates remain; the migration is not merged/released yet. Current handoff: [PWA_HANDOFF.md](docs/PWA_HANDOFF.md).
