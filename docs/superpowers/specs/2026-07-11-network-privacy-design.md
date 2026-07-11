# Network Privacy — No-VPN Decision, Security Messaging, and Three Leak-Hardening Features

Prompted by a July 2026 feasibility exploration of a Brave-style built-in VPN.
The outcome is a decision record (no VPN), a marketing push around the
security architecture Blanc already ships, and three app features that harden
the network-privacy story Blanc fully controls: WebRTC leak protection,
encrypted DNS, and a per-site shield report.

## Decision record: Blanc will not build or resell a VPN

Considered 2026-07-11, prompted by an analysis of Brave's VPN model
(Guardian partnership, system-wide WireGuard, macOS Network Extension +
Windows elevated service, separate subscription). Two forms were evaluated
and both rejected:

**A — System-wide VPN (the Brave model).** Technically coherent, and the
analysis of *how* was sound: an infrastructure partner, a Blanc-signed
Network Extension on macOS, an elevated WireGuard service on Windows, a
separate recurring subscription. Rejected on *whether*:

- **Partner leverage doesn't exist at Blanc's scale.** Guardian partners
  with Brave because Brave brings millions of users. A v0.15 indie browser
  brings reseller-economics conversations no meaningful volume. Without a
  partner, Blanc would be operating a VPN company — servers, abuse desks,
  capacity planning — as a side feature of a solo-maintained browser.
- **The support queue is asymmetric.** VPN users attribute every blocked
  IP, captcha wall, slow stream, and corporate-VPN conflict to the VPN.
  For a solo operator this becomes the entire support surface.
- **"No-logs" is a legal claim, not copy.** It requires independent audits,
  jurisdiction planning, and legal exposure that a browser's privacy page
  never carries.
- **Two new privileged native components** (Network Extension, Windows
  service), each with its own signing, entitlement, update, and crash
  story. The WebAuthn provisioning-profile chain is the small preview;
  a packet-tunnel provider is that, times a component that can take down
  the user's entire network connectivity.
- **Thin margins.** Reseller VPN economics only clear the operational
  overhead at subscriber volumes far beyond plausible near-term reach.

**B — Browser-only encrypted proxy (the Opera model).** Simpler (Electron
`session.setProxy()`, no privileged components) but shares the partner,
cost, and abuse problems — and adds an honesty problem: calling a browser
proxy a "VPN" is exactly the criticism Opera earns. Partial protection
invites partial trust.

**C — Chosen: own the layer Blanc actually controls.** The positioning
inverts: **Blanc is the browser that respects the VPN you already chose.**
Concretely that means two different things, not one: WebRTC hardening
*prevents proxy bypass* (a genuine VPN-respecting fix), while encrypted
DNS is an *independent trust choice* — browser DoH can itself bypass a
VPN provider's intended resolver, which is why Mullvad recommends
disabling browser DoH while its VPN is active. So Blanc offers WebRTC
hardening plus explicit DNS control — including deferring DNS to the
VPN/system resolver via Off — rather than competing with
Mullvad/Proton/IVPN on their turf, and it
finally *says out loud* the security architecture it already ships. The
competitive read supports this: Firefox's VPN was a commercial flop,
Opera's proxy is disrespected, and Brave's VPN reads to much of its own
audience as upsell bloat. Not having a VPN is not the gap it appears to be
— having one *dishonestly* would be.

This record exists so the question doesn't get relitigated from scratch:
revisit only if Blanc's scale changes the partner-leverage math (think
hundreds of thousands of MAU) *and* the operational appetite changes.

## Scope

Two tracks, one spec:

1. **Track 1 — site messaging**: a dedicated security page inventorying
   what's already shipped, plus homepage/features-index touch-ups. Zero app
   code; can deploy immediately.
2. **Track 2 — app features**: WebRTC leak protection, encrypted DNS
   (DoH), and the shield report panel. Each lands with settings where
   applicable (WebRTC and DNS; the shield report has none), its substrate
   updates, parity-spec entries, and a same-release addition to the
   security page.

Hard rule connecting them: **the site claims only what has shipped.** The
security page gains a feature's section in the same release cycle that
ships the feature, never before (per the status-language discipline:
"shipped" = merged + released).

---

## Track 1 — `site/features/security.html` + touch-ups

### The page

New page following the existing `features/*` pattern exactly: breadcrumb
(`home / features / security`), `feature-hero--detail` hero, copy-grid
sections, `feature-close` CTA, per-page `<meta>` CSP-free static HTML,
canonical + OG pointing at `https://blancbrowser.com/features/security`,
sitemap entry with lastmod. Working title/H1 direction: **"Private by
architecture."** Voice: the site's existing plain-answers register — no
fear marketing, no dark-web imagery, no padlock clichés.

Sections, in order (every claim is true in v0.15.5 today):

1. **Blocking is the architecture, not an add-on.** One short paragraph
   positioning network-layer ad/tracker blocking, linking to the existing
   ad-blocking feature page rather than duplicating it.
2. **Every page runs sandboxed.** All web content runs with Chromium's
   sandbox, context isolation, and no Node integration; Blanc's own pages
   live on a privileged internal scheme that ordinary web content cannot
   reach into, and internal-page APIs re-verify the caller's origin in the
   main process on every call.
3. **No extension runtime — on purpose.** Framed as a deliberate
   attack-surface decision: removing the runtime eliminates an entire
   class of privileged third-party code running inside the browser, and
   the main reason people install one — ad blocking — is built in at a
   deeper layer than Manifest V3 allows.
   Honest about the trade: if you need a specific extension, Blanc isn't
   your browser today.
4. **Sync the server can't read.** Off by default. Keys derived from your
   passphrase on your device (scrypt → HKDF, AES-256-GCM); the server
   stores ciphertext blobs it cannot read, index, or merge. The passphrase
   is never stored, never sent.
5. **Passkeys live in the Secure Enclave.** Touch ID WebAuthn with
   device-bound keys minted in Apple's Secure Enclave — they never leave
   the chip, and Blanc is signed and provisioned by Apple to hold them.
   (macOS-specific; say so.)
6. **Permissions ask first.** Camera, mic, location, notifications — an
   explicit Blanc prompt per site, decisions remembered per origin,
   private-tab decisions never written to disk.
7. **One ping, and you can turn it off.** The telemetry stance stated
   plainly: a small **pseudonymous** launch ping (version/OS plus a random
   install id that maps to an install, never a person — no browsing data,
   no browser-fingerprinting data), opt-out in Settings, and a one-click
   install-id reset. "Anonymous" is off-limits here: a stable install id is
   pseudonymous, and the privacy policy already describes it correctly —
   the security page must not contradict Blanc's own disclosure. Links to
   the privacy policy for the full accounting.

Visuals: reuse the existing live-island figure system (`.demo-island` +
`shots/` + `<picture>`) where a visual earns its place — the shield count
in the pill and the private-tab island state already exist as captures.
No new screenshot pipeline. No fabricated ratings or JSON-LD additions
beyond what the page pattern already carries.

### Touch-ups elsewhere

- **`features.html`**: add a security row/tile in the index linking to the
  new page, same treatment as the existing five.
- **`index.html` FAQ** ("A few straight answers"): two new entries —
  - *"Is Blanc actually private?"* — three sentences, links to the
    security page and privacy policy.
  - *"Why doesn't Blanc have a VPN?"* — the decision record distilled to
    ~4 sentences: a VPN is a service business with your traffic in the
    middle; done honestly it means audits, infrastructure, and a support
    organization; done dishonestly it's a proxy wearing a trench coat.
    **The M1 version of this answer stays within what's shipped**: Blanc
    puts its privacy work where the browser actually is — blocking at
    the network layer, sandboxing every page, refusing a third-party
    extension runtime. Only when M2/M3 ship does the entry gain the
    sentence about WebRTC proxy-bypass prevention and deferring DNS to
    your VPN (the Off position) — same hard rule as the security page,
    never before. This turns the absence into a trust asset.
- **Nav/footer/sitemap**: whatever the existing feature pages get, no
  more. `sitemap.xml` gains the URL.

Constraints (standing site rules): no personal name or home city;
attribution is to Bananify, the studio; footer keeps "built independently ·
no investors"; deploy via `npx wrangler pages deploy site
--project-name=blancbrowser`; canonical domain is blancbrowser.com.

### When Track 2 features ship

Each feature adds one section to the security page in the same release
cycle: WebRTC leak protection ("Keep WebRTC from oversharing"),
encrypted DNS ("DNS queries, encrypted in transit"), shield report
("See what was blocked"). Titles are working directions; the
final copy must respect each feature's stated privacy boundary (see the
feature sections below — no "closed entirely," no "hidden from your
ISP"). Drafting those sections is part of each feature's milestone, not
this page's initial ship.

---

## Track 2 — the three app features

Common threads: all three new setting keys are **device-local (not in
`SYNCED_KEYS`) in v1** — a strict WebRTC policy tuned for a VPN on one
machine shouldn't silently break video calls on a machine without one, and
DNS choice is inherently per-network (corporate resolvers, captive
portals). Revisit syncing when mobile parity makes it meaningful. All
settings additions go through the S5 substrate — and that is more than a
JSON edit: `settings-schema/build.mjs` hardcodes the known enum lists,
default parsing, drift comparisons against `settings.js`, and the
generated Swift/Kotlin fields, so each milestone **explicitly extends the
generator** for its new keys (`webrtcPolicy`; `secureDns` +
`secureDnsTemplate`). Updating `schema.json` alone would leave the drift
guard and mobile artifacts blind to the new settings. Then `npm run
settings:build`, keep `settings.js` in lockstep, and `substrate:check`
stays green. New slash commands go through the S3 substrate
(`copy/slash-commands.json` + `overlay.js` + `pages/shortcuts.js`).

### Feature 1 — WebRTC leak protection (F26)

**What.** WebRTC can advertise IP addresses that bypass a proxy or VPN
tunnel. Chromium exposes per-`webContents` IP-handling policies; Blanc
selects a hardened default and adds a disable-direct-UDP option, justified
directly by Electron's documented policy semantics (no reliance on what
other browsers ship).

**Behavior.**
- Default for every tab: `default_public_interface_only` — WebRTC uses
  only the default route's public interface; no multi-homed or
  non-default-route address exposure. This should generally preserve
  video calls.
- "Disable direct UDP" mode (Settings → Privacy toggle):
  `disable_non_proxied_udp` — per Electron's definition, WebRTC uses TCP
  unless the configured proxy itself supports UDP. This stops WebRTC from
  opening direct UDP paths that bypass an application-level proxy. It is
  **not relay-only enforcement**, and no copy anywhere may describe it as
  closing the leak entirely. Honest copy: "may break or degrade some
  video calls."

**Settings.** New key `webrtcPolicy: 'standard' | 'strict'`, default
`'standard'`, sanitized against the enum in `settings.js`; schema.json
gains the enum + default + a note mapping the values to Chromium policies.
Not synced (see above). No slash command — this is a set-once setting.

**Integration.** `webContents.setWebRTCIPHandlingPolicy(...)` applied
wherever tab webContents are minted in `main.js` (`createTab` and adopted
`window.open`/context-menu children), both normal and private sessions.
On settings change, re-apply live by iterating the `tabs` Map (same
pattern as `setAdBlockEnabled` in the `onSettingsChanged` listener).

**Settings UI.** Privacy section of `blanc://settings`: a two-option
control ("Standard — hide non-default addresses" / "Disable direct UDP —
for proxy users; may break or degrade some video calls"). The stored enum
ids stay `standard`/`strict`; only the labels carry the honest wording.

**Parity.** New `spec/features.md` F26 entry (contract: WebRTC exposes no
addresses beyond the default route's public interface; a
disable-direct-UDP mode exists where the platform allows). New divergence **D18**: iOS
WKWebView exposes no WebRTC IP-handling policy — the iOS contract
downgrades to "platform default behavior, documented"; Android WebView
support to be assessed when the port reaches this feature.

**Verification.** Unit: settings sanitize accepts/rejects the enum.
Manual: browserleaks.com/webrtc in **three network contexts, tested
separately** — a direct connection, a system-wide VPN, and an
application-level proxy — documenting the ICE-candidate behavior observed
in each. Expected: standard hides local/multi-homed addresses in all
three; disable-direct-UDP additionally prevents direct UDP candidates
when an application-level proxy is configured. No test result may be
written up as demonstrating relay-only behavior.

### Feature 2 — Encrypted DNS / DoH (F25)

**What.** DoH encrypts DNS lookups between Blanc and the chosen resolver,
hiding query *contents in transit* from on-path observers (ISP, public
Wi-Fi operators). The boundary is stated honestly everywhere this
feature surfaces — Settings copy, security page, release notes:

- It does **not** hide which sites you visit from the network —
  destination IPs remain visible, and hostnames may still be inferred or
  exposed through TLS metadata when Encrypted Client Hello isn't
  available. DoH is not anonymity.
- It **moves** DNS visibility to the chosen resolver. Picking a provider
  is a trust decision, and the UI says so in those words.
- **Auto does not guarantee encrypted DNS** — it upgrades
  opportunistically and falls back to plaintext by design; only the
  strict provider positions guarantee encryption or hard-fail.

Chromium's built-in resolver supports DNS-over-HTTPS; Electron exposes it
via `app.configureHostResolver({ secureDnsMode, secureDnsServers })`
(process-wide — covers normal *and* private sessions in one call; call
after `ready`, re-callable at runtime for live settings changes).

**Behavior.** One setting, four positions:
- `auto` (default): `secureDnsMode: 'automatic'` — upgrade to the
  resolver's DoH endpoint when the OS resolver is a known DoH provider,
  fall back silently otherwise. Zero-breakage default; matches Chrome's
  shipping posture.
- `off`: `secureDnsMode: 'off'` — always use the OS resolver. For
  corporate networks, users who've configured system-wide encrypted DNS
  already, and **VPN users whose provider runs its own resolver** —
  browser DoH would route DNS around the tunnel's resolver, and several
  VPN providers (Mullvad by name) recommend leaving browser DoH off while
  connected. The Settings copy for this position says so.
- A named provider (`cloudflare`, `quad9`, `mullvad`):
  `secureDnsMode: 'secure'` with that provider's template — DNS goes only
  to the chosen resolver, hard-fail rather than fall back. Resolvers
  differ on filtering, so the picker labels each with what it actually
  does rather than pretending they're interchangeable:
  - Cloudflare `https://cloudflare-dns.com/dns-query` — standard,
    unfiltered.
  - Quad9 `https://dns.quad9.net/dns-query` — blocks known-malware
    domains and validates DNSSEC; that filtering *is* Quad9's signature
    service and the label says so.
  - Mullvad `https://dns.mullvad.net/dns-query` — base variant,
    unfiltered.

  Ad/tracker filtering remains the job of Blanc's own blocker; the
  per-provider labels exist so nobody gets filtering they didn't choose.
- `custom`: `secureDnsMode: 'secure'` with a user-supplied template
  (NextDNS-style per-profile URLs). Validation grammar, applied to the
  **raw string** — a generic `new URL()` round-trip percent-encodes the
  template braces, so the implementation validates deliberately rather
  than normalizing: `https://` scheme, no credentials (userinfo), no
  fragment, ≤ 2,048 characters, and either no template variable or a
  single terminal `{?dns}`.

**Settings.** Two keys: `secureDns: 'auto' | 'off' | 'cloudflare' |
'quad9' | 'mullvad' | 'custom'` (default `'auto'`) and
`secureDnsTemplate: string` (default `''`, used only when `custom`).
Both sanitized in `settings.js`; schema.json gains a `secureDnsModes`
enum list with labels + both defaults. Not synced.

**Integration.** `main.js` calls `configureHostResolver` once after
`ready` from the current setting. The `onSettingsChanged` listener
reapplies it **only when `secureDns` or `secureDnsTemplate` actually
changed** (not on every settings write), then clears the host-resolver
cache on both browsing sessions (`ses.clearHostResolverCache()`) so the
switch is observably live without a restart. No other per-session work;
private tabs inherit by construction (document this in the code comment —
it's a feature, not an accident).

**Settings UI.** Privacy section: provider picker + a custom-URL field
that appears only for `custom`. Captive-portal caveat in the copy for
strict modes: "Hotel and airport login pages may fail to load while a
strict provider is set — switch to Auto to get through, then back."

**Parity.** F25 entry (contract: an encrypted-DNS control with
auto/off/provider/custom positions; strict positions never silently fall
back). New divergence **D17**: on iOS, in-app DoH inside WKWebView isn't
controllable — the OS handles encrypted DNS via Settings/configuration
profiles, so the iOS contract is "document and defer to OS"; Android has
OS-level Private DNS (DoT) with per-app DoH to be assessed at port time.

**Verification.** Unit: sanitize accepts the enum and rejects templates
violating the grammar — http://, non-URL, oversize, embedded credentials,
fragments, a non-terminal or repeated `{?dns}`. Manual, **on macOS,
Windows, and Linux** —
Electron's built-in-resolver defaults differ by platform, and this is a
desktop parity contract, not a single-machine check: set Cloudflare,
visit `one.one.one.one/help` → "Using DNS over HTTPS (DoH): Yes"; set
custom with a garbage-but-valid-shape template → navigation fails
(proving no silent fallback); Auto → browsing works everywhere; change
provider with the app running → the switch takes effect without a
restart (cache-clear working).

### Feature 3 — Shield report panel (F27)

**What.** The pill's shield count becomes a door instead of a number:
click it (or `/shield`) and a compact overlay lists the blocked hosts
responsible for the count — ad and tracker requests both, since the
blocker covers both — with per-host counts, the weekly total, and the
existing per-site allow action. Pathological pages overflow into a
summarized bucket rather than an exhaustive list (see Data layer), so the
copy says "see what was blocked," never "exactly." Transparency makes the
already-shipped differentiator legible — and it's the feature the
security page's "see what was blocked" claim rests on.

**Data layer.** The `request-blocked` handler in `main.js` (which today
increments `tab.blockedCount` and the weekly counter) additionally
records blocked hostnames + counts from the Ghostery request's hostname —
with two hard constraints:

- **Bounded.** A hostile page can generate blocked requests to unlimited
  unique subdomains and grow an unbounded map in the main process until
  the browser dies. Cap tracked hosts at **200 per tab**; once full,
  **every blocked request whose hostname is not already tracked** counts
  toward a single overflow bucket rendered as "+N more blocked requests"
  — distinguishing new from repeated untracked hosts would require
  storing them, so none is attempted. Equivalently: overflow ≡
  `blockedCount − sum(tracked counts)`, which keeps the report's total
  identical to the pill's count by construction. (Counts for
  already-tracked hosts keep incrementing normally.)
- **Isolated from broadcasts.** The data lives in a separate
  `blockedHostsByTab` Map keyed by tab id — deliberately *not* a property
  on the tab record, so `tabs:updated` serialization (which spreads tab
  properties into ~10 broadcasts/s while anything loads) is structurally
  incapable of picking it up. It reaches the overlay only through a
  dedicated `chrome:shield-report` request returning the **active tab's**
  capped report on demand, plus targeted refresh pushes only while the
  shield overlay is actually showing.

**In-memory only, never persisted** — reset where `blockedCount` resets
(navigation), freed on tab close. This keeps the report private-tab-safe
with zero special-casing (nothing ever touches a store) and adds no new
persistence surface for normal tabs either; the only persisted artifact
remains the existing local weekly counter — a single number, no
hostnames, never transmitted.
List attribution ("blocked by EasyPrivacy") is **out of scope for v1**:
the engine compiles both lists into one matcher and the block event
doesn't carry provenance cheaply. The report shows host + count, honestly.

**UI.** A new overlay mode `'shield'` alongside `'panel' | 'palette' |
'find'` in `main.js`'s `overlayMode` — *not* a list-state inside the
command panel, because the panel's list area is input-driven (tab switcher
/ slash commands / Quick Switcher per F1) and a report doesn't belong to
that input contract. Like `find`, the shield capsule keeps tight overlay
bounds so the page stays clickable; Escape and blur dismiss; the standard
re-stack guard (re-`addChildView` on tab attach) applies. Contents:

- Header: favicon + hostname, "N requests blocked on this page".
- Body: blocked hostnames sorted by count, monospace, quiet — the ledger
  aesthetic the start page already uses.
- Footer: "N blocked this week" (existing `adblockWeekStats`), an
  "allow ads on this site" action (existing `chrome:adblock-exempt-active`
  IPC), and the global toggle state with a link to Settings.
- Empty state (0 blocked): "Nothing blocked here yet." — no scolding, no
  filler.

**Entry points.** The pill's shield count chip becomes clickable
(`chrome:*` message → main shows overlay mode `'shield'`); new `/shield`
slash command ("See what was blocked on this page") added to the S3
substrate + `overlay.js` + `pages/shortcuts.js`. The pill chip stays
hidden at a zero count (unchanged from today) — so at zero, the report,
its empty state, and the per-site allow action are reachable **via
`/shield` only**. That asymmetry is deliberate: the pill stays quiet, the
command is always there.

**Parity.** F27 entry (contract: the shield count expands to a per-page
report of blocked hosts where the engine can enumerate them). Extend
**D13** (shield count fidelity): `WKContentRuleList` blocks silently —
no per-request callback, no count — so on iOS the report degrades to a
**protection-status summary only** (no count, no host list), and its
entry point is the binary "protected / paused" indicator D13 already
mandates (decided 2026-07-07), not a shield count.

**Verification.** Unit: blockedHosts accumulation, the 200-host cap,
overflow accounting (overflow always equals `blockedCount − sum(tracked)`),
reset-on-navigation, and tab-close cleanup — extract the recording into a
testable helper. Acceptance: extend
the existing F12 scenario — load the tracker fixture, open the shield
report, assert the blocked host is listed; `/allow-ads` empties it.
Manual: known ad-heavy site, count in pill matches sum in report.

---

## Sequencing

| Milestone | Contents | Ships |
| --- | --- | --- |
| M1 | Security page + FAQ entries + index touch-ups | Immediately (site deploy only) |
| M2 | WebRTC leak protection (F26, D18, S5) | Next app release |
| M3 | Encrypted DNS (F25, D17, S5) | With or after M2 — M2+M3 make a coherent "network privacy" release |
| M4 | Shield report (F27, D13 note, S3) | Own release; largest UI surface |

M2 and M3 each include: new settings + the S5 generator extension for
their keys (`settings-schema/build.mjs`, not just `schema.json`). M4 has
no settings — its substrate work is S3 (the `/shield` slash-command
copy). All of M2–M4 include: substrate build/check green, parity spec
entries, unit tests, the security-page section for that feature, and the
release-notes copy. Each gets its own implementation plan
(writing-plans) when picked up; this spec is the contract they build to.

## Non-goals

- Any VPN or proxy service, in any form (see decision record).
- Fingerprint resistance — an arms race even Brave only partially wins;
  claiming it dishonestly is worse than not claiming it.
- CNAME uncloaking — not feasible in Electron (Chromium's `webRequest`
  cannot see CNAME records; that's a Firefox-only API).
- Relay-only WebRTC enforcement — Chromium/Electron's policy surface
  doesn't provide it; `disable_non_proxied_udp` ("disable direct UDP") is
  the honest maximum, and the copy never claims more.
- HTTPS-only mode — deferred, not rejected; HSTS + Chromium upgrades
  cover most of it, and it can be its own small spec later.
- Filter-list attribution in the shield report (v1 shows hosts + counts).
- Syncing `webrtcPolicy` / `secureDns` / `secureDnsTemplate`
  (device-local v1; revisit with mobile).
- A `/vpn-check` leak-test command — a real leak test requires calling an
  external service, which is itself a privacy leak; the settings copy and
  the security page explain the protections instead.
