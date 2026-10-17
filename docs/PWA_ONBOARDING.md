# Set up your own GradeViewer

Cloudflare runs your personal app. GitHub keeps a copy of its code so updates
can deploy automatically. You need a free account on each; you do not need to
use Git commands or a terminal.

1. Open [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/fiukewhfkje/GradeViewer/tree/main/web).
2. Sign in to Cloudflare or create an account. Complete any email verification
   it requests, and use the Free plan if asked.
3. The setup button normally opens **Set up your application** (the last
   step) with GradeViewer already selected. Follow the table below. You do not
   need to go back through the earlier steps.

| Field on Cloudflare's screen | What to do |
| --- | --- |
| **Git account** | Tap **New GitHub connection**. Sign in to GitHub or create an account, approve Cloudflare's access, then return to Cloudflare and select your GitHub username. If your username is already listed, select it. GitHub is separate from your Cloudflare account. |
| **Create private Git repository** | You can check this. It keeps your personal copy of the app's code private. A repository is simply where GitHub stores that code. |
| **Project name** | Leave `gradeviewer`. |
| **APP_PASSWORD** | Choose a unique GradeViewer unlock password of **at least 12 characters**. Have your password manager generate and save it. It protects your app and is separate from your school password and Schoology API secret. |
| **Build command** | Leave `npm run build`. |
| **Deploy command** | Leave `npm run deploy`. |
| **Enable Preview builds** | Turn this off; you only need the main app. Leave Preview command alone. |

4. Tap **Deploy**, wait for success, then open the website ending in
   **workers.dev**. Cloudflare creates the app and its credential storage for
   you. The address looks like
   `https://gradeviewer.<your-subdomain>.workers.dev`; the bare
   `<your-subdomain>.workers.dev` address is not your app.
   Once deployment finishes, bookmark that personal website and use it to
   return to GradeViewer. The Deploy to Cloudflare button starts another
   setup; the Cloudflare wizard is not part of the GradeViewer app.
5. In **Profile**, enter your saved app password and tap **Unlock app**.
   Accept your browser's Save Password offer, if shown. The browser stays
   unlocked for up to 90 days. If no offer appears, add a password-manager
   entry with your personal website address and app password.
6. Tap **Get my Schoology keys**, sign in to your school account, then copy
   your own API key and secret into GradeViewer and connect. Your school
   must permit personal API access.
7. Use the website or choose **Profile → Add to Home Screen**. Profile also
   shows your personal website address with Copy/Open buttons. Save that
   address so you can return to your own app.

If you already opened Cloudflare's setup form before the v0.1.1 update, it may
still show the old 20-character description and source. Restart from the
button before entering a shorter password. Already deployed apps keep their
existing password; do not change it merely to update.

Cloudflare/GitHub signup, email verification and authorizing their connection
still require the account owner. School sign-in and obtaining personal API
keys are separate. This is a personal deployment flow, not a verified
one-click setup.

## If Back shows a different setup page

These are earlier steps in Cloudflare's app-creation wizard. Seeing them does
not, by itself, indicate that your GradeViewer deployment failed.

| Page | What to do if it appears |
| --- | --- |
| **Make something new** | Choose **Connect GitHub** and finish the account connection if asked. |
| **Select a repository** | Under **Clone a public repository via Git URL**, keep `https://github.com/fiukewhfkje/GradeViewer/tree/main/web` and tap **Next**. You do not need to select an unrelated repository from the list above it. |
| **Set up your application** | This is the final page described above. It is expected for the setup button to open here directly. |

The user's screenshots show the earlier pages and they reported sometimes
reaching the final page directly. The exact earlier navigation/account state
was not reproduced, so this guide does not claim to identify its cause. After
a successful deployment, leave this wizard and open your personal workers.dev
website; do not deploy another copy merely to revisit setup screens.

## Evidence still needed from a beginner

Record whether a person with no Git or Cloudflare experience can finish using
the screen-by-screen instructions above. Record confusing labels, every unavoidable account or
verification action, whether Free is available without adding payment details,
whether a repository and Worker appear automatically, and whether the app
unlocks and connects. Do not record passwords, API keys, cookies or grade data.
The user reached Cloudflare's fresh-account form and reported confusion about
the Git connection and 20-character password requirement. The guide now uses
the form's exact labels, explains both accounts, and recommends disabling
unneeded preview builds. The user subsequently reported that **Deploy
finished successfully on a different account and the app appeared set up**.
That is user-reported deployment completion, not a directly inspected
new-account signup or proof of Schoology unlock/connection, automatic updates,
rollback, or physical installation. They still found the wizard confusing and
reported poor app UI; they explicitly deferred the UI work until later.

An authenticated Git push to the maintainer's preview now starts a real
Cloudflare build/deployment. That proves the existing-account pipeline, not
new-account signup. Creating a separate test repository through the current
GitHub integration returned HTTP 403, `Resource not accessible by integration`.
The separate-repository chain remains unverified; do not repeat the declined
manual validation-copy request.

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
