# GradeViewer setup check

The migration is a release candidate. The normal README button will work from
`main/web` after the final migration merge. To test the current candidate, use
[Set up the candidate](https://deploy.workers.cloudflare.com/?url=https://github.com/fiukewhfkje/GradeViewer/tree/pwa-migration/web).
This creates a separate copy in your accounts.

## Three entries to check

| Entry | What to choose |
| --- | --- |
| Git account | Your **GitHub username**. This is where Cloudflare will create your source copy; it is separate from your Cloudflare account. If the list is empty, use the GitHub connection control beside it, approve Cloudflare on GitHub, then return and select your username. |
| Project/repository name | Accept the suggested name, or choose a short personal name. Leave the suggested build and deploy commands in place. |
| APP_PASSWORD | Generate a private password of at least 20 characters with your password manager and save it. This unlocks your app; it is separate from your school password and Schoology API secret. |

Choose the Free plan when a plan choice appears. Cloudflare should create the
Worker and its credential storage automatically. Open the resulting
`https://<your-app>.<your-subdomain>.workers.dev` address; the bare
`<your-subdomain>.workers.dev` address is not the app.

In Profile, unlock with the saved app password. Tap **Get my Schoology keys**,
sign in to your school account, paste your own API key and secret, and connect.
Your school must permit personal API access. Profile shows your personal app
address with Copy/Open and Add to Home Screen instructions.

There are three GradeViewer setup entries above. Cloudflare/GitHub account
creation, their requested email verification, and GitHub authorization/app
installation remain actions for the account owner. School sign-in and obtaining
personal API keys are separate. The number of signup/verification prompts has
**not** been counted in a fresh-account walkthrough; do not advertise a verified
click count or one-click setup.

## Evidence still needed from a beginner

Record whether a person with no Git or Cloudflare experience can finish using
the three entries above. Record confusing labels, every unavoidable account or
verification action, whether Free is available without adding payment details,
whether a repository and Worker appear automatically, and whether the app
unlocks and connects. Do not record passwords, API keys, cookies or grade data.
The user previously reached the prefilled build/password form but was confused
by the Git account list; this guide clarifies that specific field.

An authenticated Git push to the maintainer's preview now starts a real
Cloudflare build/deployment. That proves the existing-account pipeline, not
new-account signup. Creating a separate test repository through the current
GitHub integration returned HTTP 403, `Resource not accessible by integration`.
The account owner must create a copy through the setup flow (or supply an
accessible existing copy) before the separate-repository chain can be checked.

## Phone acceptance check

Use your own deployed copy and keep the native app installed during validation.
On iPhone, check Safari and the app installed through Share → Add to Home
Screen. On Android, check Chrome and the installed app. For each:

1. Unlock/connect once, close and reopen, and confirm the connection survives.
2. Edit/drop/reset a local assignment and add/remove a local grade. Check both
   Recent and All Assignments, period groups, Back/Close, chart grade/date
   selection, small-screen layout, keyboard and light/dark appearance.
3. Leave the app in the background for more than five minutes, then reopen.
   Time until complete fresh grades appear. A failed/offline read must offer
   Retry/Profile while retaining saved data internally.
4. Reload after a deployment and accept the offered app update. Verify the same
   address, connection, local edits and history remain. Also test ordinary
   browser and installed-app storage independently; they may differ.
5. After an official release exists, run **Update GradeViewer** in the copied
   repository, observe Cloudflare deploy it, then select an earlier published
   version and verify rollback with the same retained state.

Report pass/fail, device/browser versions, timings and confusing controls only.
Headless Chromium/WebKit results do not establish these physical-device checks.

Cloudflare's documented setup behavior:
[Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/).
