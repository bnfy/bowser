# blanc-ping

Collector for Blanc's anonymous launch ping (Settings → "Help improve
Blanc", on by default, opt-out). Receives `POST /ping` with
`{installId, sessionId, version, platform, arch}` and tallies counts in Workers KV.
`GET /stats` (bearer-token gated) returns launch totals **and** active-user
metrics.

`installId` is a random per-install token the client mints once and reuses
(see `src/main/telemetry.js`). It maps to a device install, never a person —
no name, account, IP, or browsing data is stored beside it. The Worker uses
it only to dedupe repeat launches into distinct active users:

- **Launches** — every ping bumps `total`, `day:<date>`, `version:<v>`,
  `platform:<p>`. Ten launches by one person count as ten.
- **Active users** — the first ping from an install in a given
  day/week/month sets a `seen:<scope>:<bucket>:<installId>` flag and bumps
  that period's `active:<scope>:<bucket>` unique counter. Those counters
  never expire (they're the growth history); the `seen:*` flags carry TTLs
  (~3 months daily, ~13 months weekly, ~26 months monthly) so KV stays
  bounded while still allowing month-over-month retention.

Scaling note: `/stats` retention lists all `seen:month:*` keys for the
current and previous month and intersects them, capped at 50k ids per month
(the response flags `truncated: true` past that). At Blanc's scale this is
fine; a much larger install base would want HyperLogLog sketches or a
downstream store instead.

## Deploy

Requires a Cloudflare account and `wrangler` (installed on demand via `npx`,
no need to add it as a repo dependency).

```
cd cloudflare/ping-worker
npx wrangler login                              # opens a browser to authorize
npx wrangler kv namespace create PINGS          # copy the returned id into wrangler.toml
npx wrangler secret put STATS_TOKEN             # pick any long random string, save it somewhere safe
npx wrangler secret put INSTALL_HASH_SECRET     # long random string; HMAC key for install ids — without it, unique-install counting is skipped (fail closed)
npx wrangler secret put GA_API_SECRET           # optional: GA4 Measurement Protocol API secret; when set, pings are mirrored to GA as app_launch events
npx wrangler deploy
```

`wrangler deploy` prints the live URL, something like
`https://blanc-ping.<your-subdomain>.workers.dev`. Update
`PING_ENDPOINT` in `src/main/telemetry.js` (in the repo root) to
`<that-url>/ping`.

To attach it to `api.blancbrowser.com` instead of the `workers.dev`
subdomain, add a route in the Cloudflare dashboard (Workers & Pages →
blanc-ping → Settings → Triggers → Custom Domains) once
`blancbrowser.com`'s DNS is on Cloudflare.

## One-time migration: purge legacy raw install ids (2026-07-11)

Pings sent before the HMAC change wrote `seen:*` markers keyed by the **raw**
install UUID (some monthly ones with the old 800-day TTL). After deploying the
HMAC worker and setting `INSTALL_HASH_SECRET`, purge them — this is what makes
the privacy policy's "the raw install ID is never stored" hold for the whole
store, and it must run **before** the updated policy page is published:

```
curl -X POST -H "Authorization: Bearer <STATS_TOKEN>" https://<worker-url>/admin/purge-legacy-ids
```

Re-run until it returns `{"done": true}` (each call deletes up to 800 keys —
under the ~1,000-operation ceiling a single Worker invocation gets; the
endpoint is idempotent). **Quota note:** on Workers' free tier, KV allows only
1,000 *deletes per day* account-wide, so purging a store with more than ~1,000
legacy markers will hit the daily cap partway — keep re-running across daily
quota resets (UTC midnight) until `done:true`; on a paid plan it completes in
one sitting. Only legacy-UUID-format keys are deleted — HMAC keys and the
aggregate counters are untouched. Expect a one-time discontinuity: installs re-count as new in the
current day/week/month buckets, and the month-over-month retention figure is
meaningless across the migration boundary.

**Google Analytics history:** events mirrored before the migration carried the
raw random token as GA's `client_id` (it identified the install, never a
person). GA can't be purged from here, and note the right mechanism: GA4's
"Data deletion request" (Admin) only scrubs event/user-property *parameter*
text — it does not remove data keyed to a client id. Removing pre-migration
client ids means GA4's user-deletion path: per-user via User Explorer's
"Delete user" (impractical beyond a handful) or programmatically via the
Analytics Admin API's [`properties.submitUserDeletion`](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties/submitUserDeletion),
passing each token as the `clientId` (the legacy standalone User Deletion API
is retired). Otherwise, let the property's configured event-data retention age
those events out. The privacy policy discloses this transition either way.

## Checking the numbers

```
curl -H "Authorization: Bearer <STATS_TOKEN>" https://<worker-url>/stats
```

Returns JSON like:

```json
{
  "launches": {
    "total": 420,
    "byDay": { "2026-07-05": 30, "2026-07-06": 28 },
    "byVersion": { "0.12.0": 400, "0.11.0": 20 },
    "byPlatform": { "darwin": 300, "win32": 90, "linux": 30 }
  },
  "activeUsers": {
    "daily":   { "2026-07-07": 41, "2026-07-08": 44 },
    "weekly":  { "2026-W27": 180, "2026-W28": 190 },
    "monthly": { "2026-06": 610, "2026-07": 655 }
  },
  "retention": {
    "cohortMonth": "2026-06",
    "returnedInMonth": "2026-07",
    "cohortSize": 610,
    "returned": 402,
    "rate": 0.659,
    "truncated": false
  }
}
```

`launches.*` count every launch; `activeUsers.*` count distinct installs per
period (the last 30 days / 12 weeks / 12 months). `retention` is what share
of last month's active installs came back this month.
