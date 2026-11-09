# Carmen support email draft — not sent

To: carmen@osu.edu

Subject: CarmenCanvas session lifetimes and student read-only grade access

Hi Carmen team,

I have an OSU account and am looking into Carmen support for a personal, read-only grade viewer that works on phone and desktop. It would only access my own courses and grades, and I’m trying to understand whether it can work reliably without frequent manual sign-ins.

I saw the August 11 update saying students cannot generate personal access tokens. Could you help with these questions, or route them to the appropriate authentication team?

1. What are the idle timeout and absolute maximum lifetime of a CarmenCanvas browser session? Does an authenticated request to the Canvas courses API, including total scores, count as activity and reset the idle timeout?
2. What are the separate idle and absolute lifetimes of the OSU single sign-on session? After the Canvas session expires, when can normal SSO redirects renew it without a password or another Duo approval?
3. How does BuckeyePass’s 24-hour “Trust Browser” option interact with these sessions? Is there a fixed maximum before Duo is required again, and would restoring a browser session on the same cloud host affect that trust?
4. Is there a supported way for a student to authorize read-only access to their own grades without a personal API token or an institution-approved OAuth application? If not, is using their own normal signed-in session with a headless browser only for normal SSO recovery permitted? Any password, Duo or policy prompt would still be handled manually.
5. Are there Carmen-specific API request limits or recommended polling intervals? For a short diagnostic, would checking the self-profile and courses-with-total-scores endpoints once every five minutes be acceptable?

Documentation links or configuration values would be very helpful. I don’t need anyone’s credentials or a change to MFA policy—just clarification of the supported access methods and session behavior.

Thanks,
[Your name]

---

Contact verified against OSU’s [student Carmen guide](https://teaching.resources.osu.edu/toolsets/carmencanvas/guides/getting-started-carmen-students). The student-token statement is from the [August 11, 2026 notice](https://it.osu.edu/news/2026/08/11/carmencanvas-personal-access-tokens). This file is a draft for the owner to send; no email was sent or account draft created.
