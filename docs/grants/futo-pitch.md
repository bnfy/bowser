# FUTO pitch — Blanc (draft)

> Short email-style pitch for https://futo.org (rolling submissions,
> **grantapps@futo.org** — verified against futo.org/grants 2026-07-06).
> Review and send personally — nothing has been sent.

Subject: Grant inquiry — Blanc, an independent ad-blocking-first desktop browser

Hi there,

I'm the founder of Bananify Creative and the developer of Blanc Browser
(https://blancbrowser.com, https://github.com/bnfy/blanc), an independent,
source-visible proprietary desktop web browser for macOS/Windows/Linux with
one premise: the browser itself should get out of the way so the user can
focus on the website itself.

The experience is deliberately lean and minimal, but still has the web
browsing features that users expect in modern browsers. Ad and tracker
blocking runs at the network layer of the app without add-ons. Private
tabs stay out of history and use a separate in-memory session. A fresh
profile asks before search suggestions or a pseudonymous launch ping can
send data; both choices can be switched off. Blanc also makes the ordinary
service requests a browser needs for filter lists, update checks, and any
optional sync or supporter activation the user enables. The privacy policy
documents those requests and the exact launch-ping fields.

It's shipping today on three desktop platforms, with signed and notarized
macOS builds and auto-updates, and was recently accepted into Apple's
password-manager-resources dataset.

The gap between "shipping" and "viable for normal people" is a short,
concrete list: passkey/WebAuthn platform-authenticator support (currently
gated behind OS-vendor allowlists that exclude independent browsers — I
want to both implement it and document the path publicly), Windows/Linux
parity, and an accessibility pass on the custom chrome.

I'm seeking on the order of $10–20k to fund six months of focused
part-time work on exactly that list. Happy to share roadmap, architecture
notes, or anything else useful.

Thanks for considering it!

Bananify Creative
blancbrowser.com
