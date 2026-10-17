# GradeViewer

Your personal Schoology grade viewer, in a browser or on your phone. Your own Cloudflare account runs the app; grades and local changes stay in your browser. You need free GitHub and Cloudflare accounts.

## Set up your copy

Follow these steps in order. Everything happens in your browser.

1. **Create your free accounts.** If you do not have GitHub, [sign up for GitHub](https://github.com/signup) and finish its email verification. Then [sign up for Cloudflare](https://dash.cloudflare.com/sign-up): enter your email and a password, click **Create Account**, and open Cloudflare's verification email. Stay signed in to both accounts. Use the **Free** plan if asked. You do not need to buy or add a domain.

2. **Create your GradeViewer copy.** Open **[Create your GradeViewer copy](https://github.com/new?template_owner=fiukewhfkje&template_name=GradeViewer&name=gradeviewer&visibility=private)**. Keep the name `gradeviewer`, choose **Private**, leave **Include all branches** off, and create the repository. Your copy includes the automatic updater.

3. **Connect your copy to Cloudflare.** Open **[Cloudflare setup](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)**. If Cloudflare shows a welcome or domain-setup page after signup, use this link to go to app setup. Select your Cloudflare account if asked, then click **Continue with GitHub**.

   If asked to connect GitHub, sign in to the same GitHub account you used above and allow Cloudflare to access your new `gradeviewer` repository. Back in Cloudflare, on **Select a repository**, choose your GitHub account, select `gradeviewer`, then click **Next**.

4. **Fill in the deployment form.** On **Set up your application**, check that the repository at the top is **your account / gradeviewer**. Enter these values:

   | Field | What to enter |
   | --- | --- |
   | Project name | `gradeviewer` |
   | Build command | `npm run build` |
   | Deploy command | `npm run deploy` |
   | Preview command | Leave `npx wrangler preview` unchanged. |
   | Enable Preview builds | Turn **Off**. The Preview command will not run. |
   | Protect with Cloudflare Access | Leave **Off**. GradeViewer has its own app password. |

   Copy the commands exactly. Replace Cloudflare's default Deploy command with `npm run deploy`.

   Open **Advanced settings**, then fill in these fields:

   | Field | What to enter |
   | --- | --- |
   | Path | Replace `/` with `web`. |
   | API token | Keep Cloudflare's default selection. |
   | Variable name | `APP_PASSWORD` |
   | Variable value | Choose a new GradeViewer password of at least 12 characters. Save it in your password manager. |
   | Encrypt | Leave checked. |

   The password in **Variable value** is what you will enter to unlock GradeViewer in step 6.

5. **Deploy and save your website.** Click **Deploy** and wait for a successful deployment. If Cloudflare asks you to choose a `workers.dev` subdomain, choose an available name. Open the website address Cloudflare gives you and bookmark it. It will look like `https://gradeviewer.your-name.workers.dev`.

6. **Connect Schoology.** On your new website, open **Profile** and unlock with the `APP_PASSWORD` you saved in step 4. Tap **Get my Schoology keys**, sign in to Schoology, and follow the instructions to connect your personal API key and secret. Your school must allow personal API access.

You can now use GradeViewer at your bookmarked address. To install it on your phone, open **Profile → Add to Home Screen** and follow the instructions there. Future updates are automatic; you do not repeat setup.

**Why create the GitHub copy first?** It includes automatic updates. The old **Deploy to Cloudflare** import can omit the updater. [Setup details and verification](docs/AUTOMATIC_UPDATES.md).

## Updates

Your copy checks verified official stable releases daily at **12:00 AM Eastern**, following EST/EDT. Cloudflare deploys a verified source update to your existing address. GitHub scheduling and deployment can run late.

In **Profile → Check for updates**:

- **Up to date:** no newer official stable release exists.
- **Update available:** a newer release is waiting for your copy's scheduled update/deployment.
- **Update ready:** choose **Update now** after saving or closing open changes.
- **Stalled / unavailable:** the app explains the detected delay or failed check; saved data is retained.

Newly deployed app versions also show a discreet update notice when the app opens or returns to the foreground. Other tabs keep their open forms until you accept an update in each tab.

Already installed through the old Cloudflare button? A copy without the updater needs a **one-time repair**. Keep its Worker, address and password; see [existing installations](docs/AUTOMATIC_UPDATES.md#existing-installations). Recreating the Worker is unnecessary.

## Your data

Schoology keys are encrypted in your own Cloudflare account. Grades, history and hypothetical changes stay in each browser. Ordinary updates preserve the Worker, password, connection and browser storage. Clearing browser storage can lose local-only history and edits. Changing the app password revokes sessions and requires reconnecting Schoology. Disconnect before switching students.

There are no subscriptions, ads, analytics, provider grade writes or shared maintainer grade servers. The PWA does not import the native app's local history or edits.

For maintainers: [immediate development updates, preview releases and rollback](docs/AUTOMATIC_UPDATES.md#immediate-development-updates). [Validation evidence](docs/PWA_VALIDATION.md) · [current status](PROJECT_STATUS.md) · [archived native setup](docs/NATIVE_SETUP.md).
