# Google Analytics for getbowser.com and the app launch ping

**Date:** 2026-07-05
**Status:** Approved

## Goal

Surface both website traffic and app launches in one GA4 property (web data
stream "Bowser Website", measurement ID `G-MN8BLY6GE9`) without weakening
Bowser's privacy posture: the app keeps its anonymous, opt-in, no-persistent-ID
launch ping, and the website only loads Google code after explicit visitor
consent.

## Decisions made

- **App:** no GA code ships in Bowser itself. The existing `bowser-ping`
  Cloudflare Worker forwards launch pings to GA server-side (Measurement
  Protocol). Rejected alternatives: GA only on the website (two dashboards),
  and embedding Measurement Protocol in the app with a persistent `client_id`
  (breaks the "anonymous, no persistent id" promise in Settings copy).
- **Website:** consent-gated. GA loads only after the visitor clicks Allow.
  Rejected alternatives: plain ungated gtag (off-brand for a privacy browser,
  GDPR exposure) and cookieless consent-mode pings (fuzzier data, still loads
  Google code without consent).

## Part 1 — site/index.html: consent-gated GA4

- First visit shows a small fixed banner at the bottom of the viewport,
  styled with the page's existing tokens/fonts: one line of copy
  ("Anonymous analytics help us gauge interest — allow?") plus **Allow** and
  **No thanks** buttons.
- The choice is stored in `localStorage` (`ga-consent` = `"granted"` /
  `"denied"`). The banner never reappears once a choice is made.
- Nothing Google-related loads before consent. On Allow — immediately, and on
  every later visit while `ga-consent` is `granted` — inject the standard
  gtag.js snippet for `G-MN8BLY6GE9` dynamically.
- Decline: GA never loads, no cookies, no re-prompt.
- Implementation is ~30 lines of vanilla JS appended to the page's existing
  inline script, wrapped so any failure means "no banner, no GA", never a
  broken page. No consent-management library.
- The site currently has no CSP `<meta>` tag, so no CSP change is needed.
- Deploy: `npx wrangler pages deploy site --project-name getbowser`.

## Part 2 — cloudflare/ping-worker: server-side forward to GA

- After the existing KV bumps, `handlePing` also sends an `app_launch` event
  to `https://www.google-analytics.com/mp/collect?measurement_id=G-MN8BLY6GE9&api_secret=<env.GA_API_SECRET>`
  with event params `app_version`, `platform`, `arch` (the same three fields
  the ping already carries — nothing new is collected).
- Each event uses a **random `client_id`** (`crypto.randomUUID()`), keeping
  the no-persistent-ID promise. Consequence, accepted: GA event counts
  (launches per day / version / platform) are accurate; GA *user* counts are
  meaningless. The Worker's token-gated `/stats` stays the source of truth.
- The forward runs inside `ctx.waitUntil()` (the `fetch` handler gains the
  `ctx` parameter): the 204 ping response never waits on Google, and a GA
  failure is swallowed after a `console.warn` — KV tallies are unaffected.
- If `env.GA_API_SECRET` is unset, forwarding is silently skipped, so the
  Worker keeps working before the secret exists.

## Manual step (owner)

Create a Measurement Protocol API secret in GA Admin (Data streams → Bowser
Website → Measurement Protocol API secrets → Create) and save it in 1Password
(vault **Dev**, item **"Bowser GA MP secret"**, field `credential`). It is then
set on the Worker via
`op read "op://Dev/Bowser GA MP secret/credential" | npx wrangler secret put GA_API_SECRET`
so the value never appears in a terminal or chat transcript.

## Testing

- **Site:** open the deployed page with devtools — confirm no
  `googletagmanager.com` / `google-analytics.com` requests before consent;
  click Allow and confirm they appear; reload and confirm GA loads without the
  banner; clear storage, decline, and confirm GA never loads and the banner
  stays gone.
- **Worker:** `curl` a test ping, confirm 204 and that the event appears in
  GA4 Realtime within a minute; confirm `/stats` still tallies. Also confirm a
  ping still returns 204 with `GA_API_SECRET` deliberately unset (pre-secret
  behavior).
