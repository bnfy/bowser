# blanc-sync — E2EE profile sync store

Stores only AES-GCM ciphertext for Blanc's profile sync (see `src/main/sync.js`
in the main repo). Keyed by an opaque `accountId` the client derives from a
passphrase this Worker never sees. It cannot read, index, or merge any user
data — no IPs, no ids, no browsing data, consistent with `../ping-worker`.

## Deploy

1. `cd cloudflare/sync-worker`
2. `wrangler kv namespace create SYNC` → paste the id into `wrangler.toml`.
3. `wrangler deploy`
4. Confirm the URL matches `SYNC_ENDPOINT` in `src/main/sync.js`.

## Local dev

`wrangler dev` serves on http://127.0.0.1:8787; temporarily point
`SYNC_ENDPOINT` in `src/main/sync.js` there to test the app end-to-end.

## API

- `GET /v1/blob/:accountId/:store` → `{ version, blob }` | 404 | 429
- `PUT /v1/blob/:accountId/:store` `{ ifVersion, blob }` → `{ version }` | 409 | 400 | 413
- `DELETE /v1/blob/:accountId` → 204 (account wipe)

`accountId` is 64 hex chars; `store` is one of `bookmarks`, `settings`. No
secrets or tokens: possession of the (unguessable) `accountId` is the
capability. A per-client-IP limit (120/min, all methods) is the anti-guessing
throttle — each passphrase guess derives a fresh `accountId`, so the
per-`accountId` GET limit (30/min) is only anti-hammering of a single account.
