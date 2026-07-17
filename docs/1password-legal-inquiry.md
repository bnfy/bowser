# 1Password SDK — terms/compliance inquiry

**Purpose:** Blanc's built-in 1Password fill (branch `feature/1password-fill`) is technically proven feasible (see `docs/superpowers/specs/2026-07-12-1password-autofill-spike-design.md` → Findings). Before building the *shippable* engine, one clause in 1Password's [API and SDK Terms of Service](https://1password.com/legal/api-sdk-terms-of-service) — **§4.1(e)**, the competitive/replication restriction — needs written confirmation from 1Password. This file holds the inquiry and (later) their reply, so the answer lives beside the code that depends on it.

**Status:** ☑ drafted · ☑ sent (2026-07-12) · ☑ reply received (2026-07-12) · ☑ **resolved — but not answered**

> **Outcome: 1Password does not pre-approve compliance, as a matter of policy** (reply below). They did **not** say the use is prohibited, and did not assert §4.1(e) applies — they declined to rule either way and pointed to our own counsel. **The original gate ("get written confirmation before building the shippable engine") is therefore unachievable and is retired.** See *Revised gate* below.
>
> **Personal/dev use is unaffected and was never in question** — a user running a local integration against their own vault is the documented intended use of desktop-app integrations. The current dev build on this branch is fine to keep using. The open question was only ever **distribution to end users**.

---

## Research summary (2026-07-12, two independent passes converged)

Apparently **permitted by the published terms; no partner program or vendor allowlist required** — `DesktopAuth` is user-authorized with no code-signature gate (the barrier that blocked the old native-messaging path). Supporting points:

- **Code license is MIT** (`@1password/sdk` + native `@1password/sdk-core`).
- The **API/SDK Terms grant** "incorporate and distribute the SDK… as part of an Application, on an integrated (not standalone) basis."
- The [desktop-integration security model](https://developer.1password.com/docs/sdks/desktop-app-integrations/) explicitly anticipates third-party binaries it can't code-verify, leaving the trust decision to the user.
- Autofill is a **documented SDK use case** ([SDK concepts](https://www.1password.dev/sdks/concepts/) defines website-matching rules + credential field IDs) — *supporting evidence, not explicit permission for a third-party browser implementation*.

**Open clause — §4.1(e):** no product that "competes directly or indirectly with 1Password… or replicates a substantial portion of the functionality of the Services." Blanc reads as complementary (requires 1Password installed + subscribed; no vault/sync of its own), but "indirectly" is broad enough to warrant written confirmation.

**Caveat:** the above is an AI-assisted reading of a legal document, not legal advice. A human (ideally counsel) should read the actual §4.1(e) text before a shipping commitment.

**Accurate note on the auth model:** `DesktopAuth` grants the approved process temporary access to the *whole authorized account* (expiring per 1Password's session rules; approval via Touch ID, account password, or another configured method). Blanc's v1 read-only behavior is a function of it calling only list/read operations — **not** a scope limit imposed by the SDK. Don't describe it as "per-use" or "read-only authorization."

---

## Draft inquiry email

**To:** 1Password developer / partner relations *(if no direct contact: developer-portal support or `support@1password.com`, asking to be routed to developer relations)*
**Subject:** API/SDK Terms question — independent browser using `DesktopAuth` for opt-in autofill (§4.1(e))

Hello,

I'm building **Blanc**, an independent Electron-based web browser (not affiliated with, endorsed by, or certified by 1Password). Blanc has no browser-extension runtime, so rather than an extension I'd like to integrate 1Password directly via the JavaScript SDK's desktop app integration (`DesktopAuth`). Before investing in a shippable implementation, I want to confirm this is permitted under the API and SDK Terms of Service.

**Intended behavior (v1):**

In v1, Blanc will invoke only list and read operations. Users must explicitly enable SDK integration and authorize the Blanc process through the 1Password desktop app. Authorization is scoped per account and process and expires according to 1Password's documented session rules. Blanc will decrypt only the user-selected item and will not persist, log, sync, or transmit retrieved credentials. Blanc does not provide its own vault, sync, or password-management service — it retrieves a user-selected item from the user's existing 1Password account and fills it into the matching page.

To be precise about the security model: I understand `DesktopAuth` grants the approved process temporary access to the authorized account (via Touch ID, account password, or another configured method), not a per-item or read-only grant. Blanc's read-only behavior is a property of the operations it calls, not a limit on the authorization your SDK issues.

Your SDK documentation describes website-matching behavior for autofill, which I read as supporting evidence that autofill is an intended SDK use. I recognize, though, that it doesn't specifically address a third-party browser distributing this to end users — which is exactly why I'm asking directly rather than assuming.

**My questions:**

1. Does this integration comply with **§4.1(e)** of the API and SDK Terms (the restriction on products that compete directly or indirectly with 1Password, or replicate a substantial portion of the Services' functionality)? Blanc is intended to be complementary — it requires an active 1Password installation and subscription and adds no vault or sync of its own — but I'd appreciate your confirmation given the breadth of "indirectly."

2. Is any **security review, registration, or written approval** required before public distribution of an application that bundles the SDK and uses `DesktopAuth`?

3. Are there specific **end-user terms, disclaimers, or brand-usage requirements** you'd want included beyond what's in the API/SDK Terms and Brand Guidelines?

I'm glad to share more detail on the implementation or credential-handling design. Thank you for your time.

Best regards,
[Your name] — Bananify (the studio behind Blanc)
[contact email] · [blancbrowser.com]

---

## Shipping obligations to fold into the real-engine spec (once §4.1(e) is cleared)

Paperwork/policy layer — *not code blockers*, and the spike already satisfies the data-handling ones:

- End-user terms: 1Password warranty/support disclaimer, no 1Password participation in the agreement, protection against reverse-engineering bundled components, appropriate liability limits.
- Privacy-policy disclosure of the integration and credential handling.
- Use of the 1Password name/logo strictly per their Brand Guidelines; no implied endorsement/certification.
- Reasonable credential-grade security; notify 1Password of relevant incidents within 24 hours.
- Track SDK versions — v0 releases have short support windows and the terms require compatibility with current versions.

**Already satisfied by the spike's design:** reveal-one-item (no bulk decrypt), no persist/log/sync/transmit of credentials, main-process-only handling, data minimized to the selected item's built-in fields.

---

## 1Password's reply

**Received:** 2026-07-12, 7:19 AM · **From:** `support@1password.com` ·
**Contact:** Brendan Rodgers, Sr Technical Representative — 1Password Support ·
**Re:** "API/SDK Terms question — independent browser using DesktopAuth for opt-in autofill (§4.1(e))"

> Hello Anthony,
>
> Thank you for reaching out. We appreciate you taking the time to share the details of your project.
>
> We aren't able to pre-approve compliance under our API and SDK Terms of Service. If you have questions about whether your intended use is permitted, we'd recommend having your own legal counsel review the terms directly.
>
> Thanks again for your interest in 1Password.

### What this does and doesn't say

- **Does not** state the use is prohibited, and **does not** assert §4.1(e) applies. No compliance determination was made either way.
- **Does** establish that pre-approval is unavailable as a matter of policy — support is not authorized to issue legal rulings on their own terms. This is the standing answer to this class of question, not a signal about the merits.
- **Consequence:** waiting for 1Password's written confirmation is not a viable plan. The question routes to our own counsel or to an explicit risk decision.

## Revised gate (replaces "wait for 1Password")

**Distribution to end users** is now a judgment call, not a blocked-on-vendor item. Options:

| Option | Cost | Risk |
|---|---|---|
| **Counsel review** — what 1Password recommended | A few hours of a software-licensing attorney on one focused question (§4.1(e) vs. the behavior described above) | Resolves it properly; the actual answer to the question asked |
| **Risk-accept and ship** | None upfront | Realistic worst case is a request to stop → run the spike-teardown procedure (plan Task 6). Not existential, but real |
| **Personal-only** *(current state)* | None | Zero terms risk; feature stays local to the developer |
| **Shelve distribution, keep the work** | None | Branch + specs stay intact if the picture changes (clearer guidance, a partner program, or counsel later) |

**Current decision (2026-07-12): personal-only / distribution shelved.** The dev
build stays in use; the shippable engine is not being built. Revisit if/when
counsel review is worth the cost or 1Password's published guidance changes.

**Standing arguments for the record** (if this is revisited — *product/legal
reasoning, not legal advice*): the API/SDK Terms grant "incorporate and distribute
the SDK… as part of an Application, on an integrated (not standalone) basis";
autofill is a **documented** SDK use case (the concepts page defines website-matching
rules + credential field IDs); the desktop-integration security model explicitly
anticipates third-party binaries it cannot code-verify and leaves the trust decision
to the user; and Blanc requires an active 1Password installation + subscription and
adds no vault, sync, or password management of its own — complementary rather than
competitive. The open ambiguity is the breadth of "indirectly" in §4.1(e).
