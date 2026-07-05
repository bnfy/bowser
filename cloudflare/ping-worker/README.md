# bowser-ping

Collector for Bowser's opt-in, anonymous launch ping (Settings → "Help
improve Bowser"). Receives `POST /ping` with `{version, platform, arch}`
and tallies counts in Workers KV. `GET /stats` (bearer-token gated) returns
the current totals.

## Deploy

Requires a Cloudflare account and `wrangler` (installed on demand via `npx`,
no need to add it as a repo dependency).

```
cd cloudflare/ping-worker
npx wrangler login                              # opens a browser to authorize
npx wrangler kv namespace create PINGS          # copy the returned id into wrangler.toml
npx wrangler secret put STATS_TOKEN             # pick any long random string, save it somewhere safe
npx wrangler secret put GA_API_SECRET           # optional: GA4 Measurement Protocol API secret; when set, pings are mirrored to GA as app_launch events
npx wrangler deploy
```

`wrangler deploy` prints the live URL, something like
`https://bowser-ping.<your-subdomain>.workers.dev`. Update
`PING_ENDPOINT` in `src/main/telemetry.js` (in the repo root) to
`<that-url>/ping`.

To attach it to `api.getbowser.com` instead of the `workers.dev`
subdomain, add a route in the Cloudflare dashboard (Workers & Pages →
bowser-ping → Settings → Triggers → Custom Domains) once
`getbowser.com`'s DNS is on Cloudflare.

## Checking the numbers

```
curl -H "Authorization: Bearer <STATS_TOKEN>" https://<worker-url>/stats
```

Returns JSON like:

```json
{
  "total": 42,
  "day:2026-07-05": 3,
  "version:0.9.1": 40,
  "version:0.9.0": 2,
  "platform:darwin": 42
}
```
