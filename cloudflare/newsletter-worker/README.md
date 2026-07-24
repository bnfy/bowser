# blanc-newsletter

Signup store behind the newsletter form in blancbrowser.com's footer
(`site/src/components/NewsletterForm.astro`). Receives `POST /subscribe` with
`{email}` and keeps `sub:<email>` → `{ts}` in Workers KV — the address and
when it arrived, nothing else. No IPs at rest (the per-IP rate-limit keys
expire within two minutes), no names, no tracking, and signing up is
idempotent: re-subscribing keeps the original record and returns the same
response, so nothing leaks about whether an address was already on the list.

This Worker only keeps the list — it sends nothing. Actually mailing the
newsletter means exporting the list (below) into whatever does the sending.
Two consequences to stay honest about:

- **No double opt-in (yet).** Sending a confirmation email needs an email
  provider; when one is chosen, confirmation belongs there (or as a
  `pending:` state here). Until then anyone can enter any address, which is
  why every sent mail must carry an unsubscribe path.
- **Unsubscribe is manual in v1.** Requests arrive at
  `support@blancbrowser.com` (linked from every mail and the privacy
  policy); remove the address with the `DELETE` endpoint below. A proper
  self-serve link comes with the sending provider.

Anti-abuse, in order: CORS restricted to `blancbrowser.com` (+ Astro's
localhost dev origin), a visually-hidden `website` honeypot field, a per-IP
limit of 6 subscribes per minute, and loose email-shape validation capped at
254 chars.

**Honeypot quarantine:** a filled honeypot gets the same 200 as a real
signup but the address goes to a `hp:` key with a 30-day TTL instead of the
list. That's because the one way a *person* trips the honeypot is their
browser or password manager autofilling the hidden field — they'd see
"subscribed" while silently never being stored, with no way for anyone to
notice. The quarantine makes the miss visible: the export (below) returns
those addresses under `quarantined`, and a plausible-looking one is rescued
by re-POSTing it to `/subscribe` without the `website` field:

```
curl -X POST -H "Content-Type: application/json" \
  -d '{"email":"a@example.com"}' https://<worker-url>/subscribe
```

Bot-submitted garbage just ages out on its own; an address already on the
list is never quarantined.

## Deploy

Requires `wrangler` (installed on demand via `npx`, no need to add it as a
repo dependency) and the 1Password CLI — all credentialed commands run
through `op`, per the house rule (see `scripts/release.sh` for the same
pattern with notarization). Two 1Password items are involved, both in vault
**Dev**:

- **"Cloudflare API Token blancbrowser"** (`credential` field) — the
  Cloudflare API token wrangler authenticates with, mapped to
  `CLOUDFLARE_API_TOKEN` by `cloudflare/.env.1password` (shared by the
  workers; adjust that one file if the item lives elsewhere). No
  `wrangler login` needed or wanted.
- **"Blanc Newsletter Admin"** (`password` field) — the worker's
  `ADMIN_TOKEN`, created below; needed again whenever you export the list
  or remove an address.

```
cd cloudflare/newsletter-worker

# One-time: mint the admin token straight into 1Password (never touches
# clipboard or shell history).
op item create --category=password --vault=Dev --title="Blanc Newsletter Admin" \
  --generate-password='letters,digits,64'

# Copy the printed id into wrangler.toml and commit it:
op run --env-file=../.env.1password -- npx wrangler kv namespace create SUBSCRIBERS

op read "op://Dev/Blanc Newsletter Admin/password" | \
  op run --env-file=../.env.1password -- npx wrangler secret put ADMIN_TOKEN

op run --env-file=../.env.1password -- npx wrangler deploy
```

If the token can't be resolved (locked vault, wrong item name) `op` fails
loudly — there is no unauthenticated fallback to stumble into.

`wrangler deploy` prints the live URL, something like
`https://blanc-newsletter.<your-subdomain>.workers.dev`. The footer form
posts to the `NEWSLETTER_ENDPOINT` constant in
`site/src/components/Footer.astro` — update it if the URL differs, then
redeploy the site.

To attach it to `api.blancbrowser.com` instead of the `workers.dev`
subdomain, add a route in the Cloudflare dashboard (Workers & Pages →
blanc-newsletter → Settings → Triggers → Custom Domains) once
`blancbrowser.com`'s DNS is on Cloudflare. Note the form's endpoint constant
lives in `NewsletterForm.astro`, not here — changing the URL means a site
redeploy too.

## Exporting the list

```
curl -H "Authorization: Bearer $(op read 'op://Dev/Blanc Newsletter Admin/password')" \
  https://<worker-url>/subscribers
```

Returns JSON like:

```json
{
  "count": 2,
  "subscribers": [
    { "email": "a@example.com", "ts": "2026-07-23T10:00:00.000Z" },
    { "email": "b@example.com", "ts": "2026-07-24T09:30:00.000Z" }
  ],
  "quarantined": [
    { "email": "maybe-real@example.com", "ts": "2026-07-24T11:00:00.000Z" }
  ]
}
```

`quarantined` is the honeypot quarantine described above — glance at it
before a send; anything plausible gets rescued, the rest expires.

## Removing an address (unsubscribe / data deletion)

```
curl -X DELETE -H "Authorization: Bearer $(op read 'op://Dev/Blanc Newsletter Admin/password')" \
  "https://<worker-url>/subscriber?email=a@example.com"
```

204 either way — removing an address that isn't on the list is a no-op, and
the removal also clears any quarantined copy of the address. Do this
promptly for any unsubscribe or deletion request; the privacy policy
promises it.
