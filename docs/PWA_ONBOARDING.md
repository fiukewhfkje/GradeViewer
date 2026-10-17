# Set up your own GradeViewer

The [README setup guide](../README.md#set-up-your-copy) starts with creating free GitHub and Cloudflare accounts, including email verification. It gives the complete browser-only sequence through Schoology connection and phone installation. Follow those six steps in order.

## Can the link open the final form directly?

The setup link above opens **Create an app** directly. Choosing **Continue with GitHub**, your account and the existing repository still comes before **Set up your application**. We have not verified a supported link that skips those selections for an existing private copy.

The old **Deploy to Cloudflare** button imports a public repository into a new copy. That import can omit the automatic updater, so it is not the supported shortcut. See Cloudflare's [deploy-button documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/) and [build configuration reference](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) for the two setup flows and field meanings.

## If you already used the old Cloudflare button

Keep the existing Worker, address, password and connection. A copy missing its automatic updater needs a [one-time verified repair](AUTOMATIC_UPDATES.md#existing-installations), not a recreated Worker. The old public-repository import can omit GitHub workflows; the GitHub-template-first path avoids that import.

## Updates

Copies check official stable releases daily at midnight Eastern, following daylight saving time. After your website deploys the update, the app offers **Update now**. Save/close open changes before accepting. A delay or failure keeps saved data and displays a useful status. Ordinary users do not need to open GitHub to run workflows.

The maintainer can [update a development copy immediately](AUTOMATIC_UPDATES.md#immediate-development-updates), including an optional verified preview channel.

## Verification limits

The GitHub template copy, enabled root updater, automatic first run, real signed release verification and repository pushes were verified on real private repositories. The existing production Cloudflare integration also deployed a standard workflow-token push, and its PWA update retained synthetic browser data/open forms. A fresh **independent Cloudflare account** and physical iPhone/Android Home Screen acceptance remain unverified. Exact evidence and account-access limits are in [the update guide](AUTOMATIC_UPDATES.md) and [PWA validation](PWA_VALIDATION.md). Do not interpret a CLI deploy, local fixture or browser emulation as that missing evidence.
