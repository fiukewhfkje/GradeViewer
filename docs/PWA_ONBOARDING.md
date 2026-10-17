# Set up your own GradeViewer

Follow the five short [README steps](../README.md). The supported setup creates your GitHub copy **first**, then connects that existing copy to Cloudflare. This includes the updater without asking you to create or edit a workflow.

You need your own free GitHub and Cloudflare accounts. Account signup, email verification and approving their connection are normal one-time account steps. You do not need Git commands or an API token.

1. Use **Create your GradeViewer copy** in the README. Keep `gradeviewer`, choose **Private**, leave **Include all branches** off and create it.
2. In Cloudflare **Workers & Pages → Create application**, connect GitHub and select **your newly created copy**.
3. Set **Root directory / Path** to `web`. Keep build `npm run build` and deploy `npm run deploy`. Add a private **build secret** called `APP_PASSWORD`, with a password of at least 12 characters. Save it in your password manager. Turn preview builds off and deploy.
4. Open and bookmark the personal **workers.dev** website. The bare account subdomain is not the app; use the full `https://gradeviewer.<your-subdomain>.workers.dev` address.
5. Open **Profile**, unlock with your saved password, then use **Get my Schoology keys** to obtain and connect your own personal key and secret. Your school must permit API access. **Add to Home Screen** provides phone installation instructions.

Use your personal website thereafter. Creating another copy or deploying another Worker is not part of normal updates. You stay unlocked for up to 90 days per browser.

## If you already used the old Cloudflare button

Keep the existing Worker, address, password and connection. A copy missing its automatic updater needs a [one-time verified repair](AUTOMATIC_UPDATES.md#existing-installations), not a recreated Worker. The old public-repository import can omit GitHub workflows; the GitHub-template-first path avoids that import.

## Updates

Copies check official stable releases daily at midnight Eastern, following daylight saving time. After your website deploys the update, the app offers **Update now**. Save/close open changes before accepting. A delay or failure keeps saved data and displays a useful status. Ordinary users do not need to open GitHub to run workflows.

The maintainer can [update a development copy immediately](AUTOMATIC_UPDATES.md#immediate-development-updates), including an optional verified preview channel.

## Verification limits

The GitHub template copy, enabled root updater, automatic first run, real signed release verification and repository pushes were verified on real private repositories. The existing production Cloudflare integration also deployed a standard workflow-token push, and its PWA update retained synthetic browser data/open forms. A fresh **independent Cloudflare account** and physical iPhone/Android Home Screen acceptance remain unverified. Exact evidence and account-access limits are in [the update guide](AUTOMATIC_UPDATES.md) and [PWA validation](PWA_VALIDATION.md). Do not interpret a CLI deploy, local fixture or browser emulation as that missing evidence.
