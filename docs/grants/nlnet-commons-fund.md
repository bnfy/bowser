# NLnet Commons Fund application — Blanc (draft)

> Draft for NLnet's standard application form. **Status 2026-07-06:** the
> NGI Zero Commons Fund closed its final call on 2026-06-01, and NLnet has
> paused regular open calls while transitioning to a new "Open Internet
> Stack" effort — regular calls reopen after the summer (check
> https://nlnet.nl/propose/ around September 2026). The questions below
> match NLnet's long-standing form and should carry over. Nothing here has
> been submitted. **Eligibility blocker:** Blanc is currently proprietary
> (`UNLICENSED`) even though its source repository is visible. Do not submit
> this open-source grant application unless the licensing decision changes.

## Project name

Blanc — a minimal, user-agency-first desktop browser shell

## Website / repository

https://blancbrowser.com · https://github.com/bnfy/blanc

## Abstract (max ~1200 chars)

Blanc is an independent, source-visible proprietary desktop browser for
macOS, Windows, and Linux that treats user agency as the baseline, not an
extension.
Ad and tracker blocking (EasyList/EasyPrivacy) is wired in at the network
layer of the browser itself — independent of any extension store and of
Manifest V3's declarativeNetRequest limits, which are steadily narrowing
what user-installed blockers may do. The interface is a single floating
"island" replacing the tab strip and toolbar, private tabs never touch
disk history, permissions are explicit, and the app's default-on
pseudonymous launch ping is disclosed on first run and can be switched off.
This grant funds work that strengthens Blanc as a practical daily browser:
WebAuthn
platform-authenticator (passkey) support, which today is gated behind
OS-vendor allowlists that exclude independent browsers; feature parity for
the Windows/Linux builds; hardened, reproducible filter-list update
infrastructure; and an accessibility pass on the custom-drawn chrome.

## Have you been involved with projects or organisations relevant to this project before?

Blanc is built and maintained by an independent developer (BNFY). The
project has already cleared one gate that matters for legitimacy:
inclusion in Apple's password-manager-resources browser dataset
(apple/password-manager-resources PR #1137, merged July 2026).

## Requested amount

EUR 15,000

## Explain what the requested budget will be used for

Six months of part-time development, in four deliverables:

1. Passkey/WebAuthn platform-authenticator support — pursue Apple's
   com.apple.developer.web-browser.public-key-credential entitlement,
   implement the credential flows, document the process publicly so other
   independent shells can follow it (~EUR 5,000).
2. Windows/Linux feature parity with the macOS build, including
   distribution hardening (signing, update channel) (~EUR 4,000).
3. Filter-list infrastructure: reproducible engine builds, update
   pipeline, and cosmetic-filtering hardening (~EUR 3,000).
4. Accessibility audit and fixes for the custom-drawn chrome (screen
   reader labels, keyboard-only operation, contrast) (~EUR 3,000).

## Compare your own project with existing or historical efforts

Firefox forks (LibreWolf, Waterfox) inherit Gecko's UI and Mozilla's
churn; Chromium forks with business models attached (Brave) bundle
crypto/ads; ungoogled-chromium is a de-Googling patchset, not a product a
non-technical person can adopt. Blanc differs in that it is a *shell*:
a deliberately small, auditable codebase (~single-digit-thousands of
lines around the Chromium engine via Electron) where blocking, privacy
behavior, and UI are all first-party code — small enough for one person
to understand end-to-end, which is precisely the property that makes
user-agency guarantees easier to inspect, while the current proprietary
license limits reuse.

## What are significant technical challenges you expect to solve during the project?

Vendor allowlists for platform authenticators (the entitlement process is
opaque and undocumented for independent browsers); keeping network-level
blocking robust as sites adapt to cosmetic filtering; making an
Electron-based shell accessible when the chrome is fully custom-drawn;
reproducible cross-platform release infrastructure for a one-person team.

## Describe the ecosystem of the project, and how you will engage with relevant actors and promote the outcomes

Users: people who want a quiet, blocking-by-default browser without a
corporate agenda. Ecosystem: EasyList/EasyPrivacy maintainers (upstream
filter lists), Ghostery's adblocker library (engine), the Electron
project, and Apple's password-manager-resources dataset. Technical outcomes
and documentation can land in the publicly visible repo under Blanc's current
license; the entitlement documentation in particular fills a gap every
independent browser project currently hits blind.
