# First consented Carmen test

Ready for a supervised experiment, not a supported Carmen connection. The account holder signs in directly through a private Cloudflare Live View. No password, cookie header, HAR, browser-state file or screenshot of credentials should be pasted into chat. Production and stable releases remain untouched.

## Short instructions for the friend

1. Agree to **read-only checks of your own Carmen profile and, if you choose, first-page enrolled-course totals**, plus encrypted storage of the necessary OSU/Carmen/Duo login state on the operator's computer for a 48-hour session/renewal test. The temporary browser runs in the owner's Cloudflare account. No assignments/account settings are changed. This is broader session access than a scoped API token; it is optional and may be stopped at any time.
2. When the operator starts the test, open its private sign-in link and complete normal OSU sign-in/BuckeyePass yourself. Keep the link private: it grants control of the temporary browser. The handoff has a four-minute limit; do not start it before you are present.
3. After Carmen opens, let the test finish. The script verifies identity, optionally checks course totals and closes its remote browser. Results show only fixed status labels, booleans and timings, not your name, course names, grades or session secrets.
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

Omit `--grades` for identity-only permission. It cannot be added later to a lab that did not initially permit it. `start` refuses an existing directory so an accidental command cannot replace an account/session. An account switch is refused after storage. A later human sign-in requirement is reported; it does not launch interactive login automatically or overwrite the last stored state. A new consented `start` in a different private directory can establish a fresh test session.

The start command prints a **private local `login.html` path**, never the signed Live View URL. Open that local file and give its link only to the present account holder through a trusted private channel. Do not attach/commit the file or paste its link in this chat. The HTML and Wrangler log are removed when the process finishes. Do not enable Playwright debug/trace/recording logs or take screenshots while credentials are present. No agent/computer-use tool enters the password or MFA.

Ordinary `check` uses Playwright's HTTP-only API client with a managed cookie jar; it does not launch Chrome if the session is valid. The jar respects cookie scope/rotation, rejects redirects and uses fixed self-profile/course-total GETs. This is **Node HTTP acceptance, not Cloudflare Worker portability**. On verified authentication rejection/sign-in redirect, the lab restores the encrypted state in remote Chrome, navigates normally, verifies the same account and saves refreshed state only on success. It never fills a password, clicks a challenge or alters account settings. Browser renewal is bounded to 25 seconds; human input is reported separately. Known permission/rate/network failures do not trigger browser renewal.

Only Carmen, the current OSU Web Login host/parent cookie domains and Duo state are retained. Playwright storage state is not a complete browser profile; sessionStorage/device keys and unlisted identity hosts are not preserved. Additional OSU login behavior can therefore fail the experiment without establishing a universal session-lifetime result. The API client buffers responses, rejecting advertised oversized bodies before buffering and unadvertised bodies before JSON conversion above 2 MB. No complete assignment snapshot is fetched.

Follow [the controlled benchmark](CARMEN_SESSION_BENCHMARK.md) for separate idle baselines, retrieval/renewal timings and eventual Worker/phone/cache acceptance. First sign-in success would establish only the narrow test, not the finished PWA or weeks of unattended access.
