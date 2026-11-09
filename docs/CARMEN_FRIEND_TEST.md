# Carmen compatibility report

On your own GradeViewer installation with v0.2.2 or later, open **Settings → Connections → CarmenCanvas**. Turn on **Use Carmen as main LMS**, connect Carmen, then tap **Copy compatibility report** and paste it into your message. The report shares field paths, JSON types and parser results. Cookies, account identifiers and grades stay private. If clipboard access is blocked, copy the selectable JSON shown in Settings. [GradeViewer setup](../README.md#set-up-your-copy).

## Historical operator lab

For the current owner experiment, read the [self-contained handoff](CARMEN_HANDOFF.md) first. It records the persistent Mac storage path, missing original state, fresh-capture blocker and two-profile/no-renew protocol. Use persistent storage outside Git, not a temporary directory, for retained account state.

Ready for a supervised experiment, not a supported Carmen connection. The account holder signs in directly through a private Cloudflare Live View. No password, cookie header, HAR, browser-state file or screenshot of credentials should be pasted into chat. Production and stable releases remain untouched.

The owner’s original identity and course-total HTTP reads passed, including a schema-valid empty course list. That temporary state/archive is now missing; the evening check made no Carmen request. Cloudflare creation was blocked before its daily reset; two fresh owner-controlled local captures then passed, and a blank Cloudflare browser worked after reset. Their friend is not needed; the current private Muse export is ready, with experiment initialization still pending on the VM.

## Short instructions for the account holder

1. Agree to **read-only checks of your own Carmen profile and, if you choose, first-page enrolled-course totals**, plus encrypted storage of the necessary OSU/Carmen/Duo login state on the operator's computer for a 48-hour session/renewal test. The temporary browser runs in the owner's Cloudflare account. No assignments/account settings are changed. This is broader session access than a scoped API token; it is optional and may be stopped at any time.
2. When the operator starts the test, open its private sign-in link and complete normal OSU sign-in/BuckeyePass yourself. Keep the link private: it grants control of the temporary browser. The handoff has a four-minute limit; do not start it before you are present.
3. Finish any first-use screens yourself, including reviewing any policy and deciding whether to accept it. When Carmen is ready, select **Done** in Cloudflare Live View; select **Failed** to stop. Arriving at a Canvas URL alone is not completion. Then let the test finish. The script saves an encrypted pending session before verifying identity, then optionally checks course totals and closes its remote browser. Pending state is not an activated account; it can be retried through `check` without repeating the human login if a transport failure occurs. Results show only fixed status labels, counts, booleans and timings, not your name, course names, grades or session secrets.
4. Arrange an agreed idle period for a later check (for example, more than two hours or overnight). Normal school work takes priority; using the test session during the interval makes that idle trial inconclusive. Delete the test's private directory at the end; state expires for further checks after 48 hours but files are not automatically erased. Logging out/revoking OSU sessions may also require ordinary account actions and has not been verified to invalidate every exported copy instantly.

## Operator commands

Use the existing authenticated Wrangler account and Node 24+ with `web/` dependencies installed. This creates temporary Browser Run sessions, consuming real free-plan quota, but deploys no Worker and does not change the production vault. The lab directory must be new, absolute, outside the project and owner-only. A same-directory private wrapping key protects the encrypted session from accidental plaintext disclosure; anyone who can read both key and ciphertext can recover it. This is not OS Keychain storage or protection against compromise of the operator's account.

Only after the holder agrees to the scope, from `web/`:

```sh
# Identity + optional course totals; --grades requires explicit holder permission.
node scripts/carmen-login-lab.mjs start /absolute/private/new-carmen-lab --consent --grades

# Later: ordinary HTTP first; one silent browser renewal only on confirmed expiry.
node scripts/carmen-login-lab.mjs check /absolute/private/new-carmen-lab --consent --grades
```

Omit `--grades` for identity-only permission. A later explicit `authorize PATH --consent --grades` can broaden an unexpired lab only with holder permission. The default limit remains 48 hours; the controlled owner benchmark explicitly uses `--week`. `start` refuses an existing directory so an accidental command cannot replace an account/session. An account switch is refused after identity has been verified and bound. A pending first-login session has no verified identity yet; it is activated only after a valid profile response. `check` can resume encrypted pending state when no verified session exists. A later human sign-in requirement is reported without launching interactive login automatically. `reconnect PATH --consent --grades` lets the human sign into the same bound profile while preserving its original deadline. A new consented `start` in a different private directory establishes a separate test session.

The ordinary `check` example above may recover automatically. For lifetime measurement, use `check PATH --consent --grades --no-renew`; only a separately invoked `renew PATH --consent --grades` may recover after its recorded rejection. Follow the [controlled protocol](CARMEN_SESSION_BENCHMARK.md) for five-minute/idle scheduling and exact VM commands.

The start command prints a **private local `login.html` path**, never the signed Live View URL. Open that local file and give its link only to the present account holder through a trusted private channel. Do not attach/commit the file or paste its link in this chat. The HTML and Wrangler log are removed when the process finishes. Do not enable Playwright debug/trace/recording logs or take screenshots while credentials are present. No agent/computer-use tool enters the password or MFA.

Ordinary `check` uses Playwright's HTTP-only API client with a managed cookie jar; it does not launch Chrome if the session is valid. The jar respects cookie scope/rotation, rejects redirects and uses fixed self-profile/course-total GETs. Separate response-header fields preserve multiple Set-Cookie values; folding them through Playwright's lossy headers object caused the initial diagnostic failure and is now regression-tested. This is **Node HTTP acceptance, not Cloudflare Worker portability**. On verified authentication rejection/sign-in redirect, the lab restores the encrypted state in remote Chrome, navigates normally, verifies the same account and saves refreshed state only on success. It never fills a password, clicks a challenge or alters account settings. Renewal navigation/verification has a 25-second deadline; browser launch/cleanup add bounded CLI steps. Human input is reported separately. Known permission/rate/network failures do not trigger browser renewal.

Only Carmen, the current OSU Web Login host/parent cookie domains and Duo state are retained. Playwright storage state is not a complete browser profile; sessionStorage/device keys and unlisted identity hosts are not preserved. Additional OSU login behavior can therefore fail the experiment without establishing a universal session-lifetime result. The API client buffers responses, rejecting advertised oversized bodies before buffering and unadvertised bodies before JSON conversion above 2 MB. No complete assignment snapshot is fetched.

Follow [the controlled benchmark](CARMEN_SESSION_BENCHMARK.md) for separate idle baselines, retrieval/renewal timings and eventual Worker/phone/cache acceptance. First sign-in success would establish only the narrow test, not the finished PWA or weeks of unattended access.
