# Blanc — Profile Sync (end-to-end encrypted, hosted)

**Date:** 2026-07-07
**Status:** Draft — brainstorm converged, not yet approved
**Surfaces:** a new `src/main/sync.js` (peer of `telemetry.js`/`supporter.js`), an `export()`/`merge()` pair on each syncable `JsonStore` (`src/main/store.js` + the feature stores), a Cloudflare Worker under `cloudflare/sync-worker/`, and a Settings → Sync section (`src/renderer/pages/settings.*`, guarded `pages:settings:sync-*` IPC)

---

## 1. Problem

Blanc's data lives in per-feature JSON files in one machine's `userData` (`src/main/store.js`). Move to a second machine — or reinstall — and Favorites, history, and settings start empty. Every mainstream browser solves this with account sync, and it's the most-cited gap between "shipping" and "daily driver."

But sync is also the feature most able to **betray Blanc's core promise.** The pitch — to users and to FUTO/NLnet — is *"collects nothing about you; the only network call it makes on its own is one opt-in ping; small enough for one person to audit."* The naive implementation ("upload your history to our server") makes Blanc exactly the thing it criticizes. So the requirement is sharper than "sync": **sync browsing data, including history, such that Blanc's backend can never read it.**

## 2. Decisions locked (with the user, 2026-07-07)

- **Architecture: end-to-end encrypted hosted sync.** A Blanc-run Cloudflare Worker stores only client-encrypted ciphertext. It reuses the existing house pattern (`telemetry.js` → `ping-worker` → Workers KV).
- **Business model: free forever.** Encryption and the hosted store are both free. Hosted E2EE storage costs ~nothing at current scale, and "free, private, cross-device" is the strongest possible grant/brand narrative. (If a paid tier ever appears, it is *hosted convenience*, revisited only with real audience + infra cost — not gated here.)
- **Identity: passphrase-only, no accounts.** No email, no PII, nothing to breach. See §7.

## 3. Principles (the through-line)

1. **The server is blind.** The Worker only ever sees an opaque account id and AES-GCM ciphertext. It cannot merge, index, or read anything. Every merge happens on plaintext, client-side, in the main process.
2. **Merge, don't clobber.** Prefer union over last-writer-wins. Losing a favorite or a history entry to a sync is unacceptable for a trust-first browser. Deletions — the one thing union can't express — are carried as tombstones.
3. **Opt-in and local-first, like everything else.** Default is today's behavior: local-only, no network. Sync is off until the user turns it on, mirroring the `usagePing` posture.
4. **No new trust surface in the renderer.** Like `supporter.js`/`telemetry.js`, all crypto and all `fetch` happen in the main process. The passphrase and keys never touch web content. No CSP change in any HTML file.
5. **Small enough to audit.** No new crypto dependency — Node's built-in `crypto` (scrypt + AES-256-GCM + HKDF) is enough. No new sync framework.

## 4. What syncs — and what deliberately doesn't

| Store | Sync? | Merge strategy |
|---|---|---|
| `bookmarks.json` (Favorites) | **v1 — flagship** | Set keyed by `url`; per-item `updatedAt` + **delete tombstones** (removed items resurrect otherwise). |
| `settings.json` | **v1, selectively** | Per-key last-writer-wins via a `_meta` timestamp map. **Excludes `supporter`** (syncing it is a license-sharing vector) and `appIcon` (supporter colorways need the license present on *that* device). |
| `history.json` | **v2** | Union by `(url, visitedAt)`, re-sort desc, re-cap 5000. Clear-all carried as a `clearedBefore` watermark. |
| Open tabs (per-device snapshots) | **Shipped 2026-07** | Device-keyed map in the `session` store; per-device LWW; publish gated by a per-device opt-in. See `2026-07-21-tab-sync-design.md`. |
| Live "tabs from my other device" | **superseded** | Shipped as the non-real-time other-device tab list — `2026-07-21-tab-sync-design.md`. |
| `downloads.json` | **out** | Entries point at files absent on the other machine. At most a read-only "download log" later. |
| `site-permissions.json` | **later** | Sensitive, low value. |
| `adblock-stats.json` | **never** | Local rolling counter; nothing to merge. |
| Cookies / passwords / session tokens | **never** | Chromium session secrets. Out of scope as a feature *and* a stated guarantee. Blanc has no password store; it will not attempt cookie sync. |
| Private-tab data | **never** | Already never recorded to disk (`history.addVisit` is guarded) — a free guarantee. |

## 5. Data model — the `JsonStore` seam

`JsonStore` (`src/main/store.js`) is intentionally schema-less: no per-record version, no tombstones, no trusted clock. That's the one gap between "trivial and lossy" and "correct." Add two capabilities without disturbing the existing load-once/debounced-write core:

- **`store.export()`** → a plain snapshot `{ data, meta }` for encryption. `meta` holds whatever the merge needs (per-record `updatedAt`, tombstone list, watermark).
- **`store.merge(remote)`** → apply a decrypted remote snapshot into local data using the store's strategy, then schedule a save. Merge logic lives in each feature module (`bookmarks.js`, `history.js`, `settings.js`), *not* in the generic `JsonStore` — it stays a dumb file, the strategy stays with the data.

Concretely, the two v1 stores grow minimal metadata:

- **Favorites:** each item already has `id`, `addedAt`; add `updatedAt`. `removeBookmark` records a tombstone `{ id, url, deletedAt }` (pruned after, say, 90 days) instead of only dropping the row.
- **Settings:** a sibling `_syncMeta: { <key>: <updatedAt> }` map so per-key LWW has a clock. Non-synced keys (`supporter`, `appIcon`, `adblockExceptions`?) are filtered out of the export.

History needs no per-record change — union of two capped, sorted lists is deterministic from the existing `(url, visitedAt)`.

## 6. Crypto (main process, Node built-in `crypto`)

Two secrets the user provides once: a **sync handle** (any short string — acts as a per-user salt/namespace so two people who pick the same passphrase don't collide, and so brute-force targets a single account) and a **passphrase**.

```
rootKey   = scrypt(passphrase, handle, 32)          // slow KDF, per-user salt = handle
accountId = HKDF(rootKey, "blanc-sync-id/v1")       // public lookup key — safe to send
encKey    = HKDF(rootKey, "blanc-sync-enc/v1")       // never leaves the device
```

- `accountId` is a one-way function of the secrets; the Worker stores blobs under it and can't reverse it to the passphrase (strong KDF).
- Each store is encrypted **separately** (`AES-256-GCM`, random 96-bit IV per write) so a large history blob never forces re-upload of favorites, and stores sync independently. Blob = `{ v, iv, ct, tag }`.
- The Worker sees `accountId` + opaque blobs. No plaintext, no keys, no handle in the clear (only its hash, folded into `accountId`).
- **Recovery:** losing the passphrase = losing the remote data. Acceptable and stated plainly in the UI — it's re-derivable browsing data, not irreplaceable secrets, and "we literally cannot recover it" is the point.

## 7. The Worker (`cloudflare/sync-worker/`)

Same shape as `ping-worker`: a single `fetch` handler, Workers KV storage, `wrangler.toml`, README. Blobs are small (history at 5000 entries is well under KV's 25 MiB value limit); KV's eventual consistency is fine for pull-merge-push. R2 is the drop-in upgrade if blobs ever grow.

Endpoints, all keyed by `accountId` in the path/body, all seeing only ciphertext:

- `GET  /v1/blob/:accountId/:store` → `{ version, blob }` or 404. `version` is an opaque etag for optimistic concurrency.
- `PUT  /v1/blob/:accountId/:store` with `{ ifVersion, blob }` → 200 `{ version }`, or **409** if `ifVersion` is stale (someone else wrote). 409 drives a client pull-merge-retry.
- No list, no enumerate, no auth token beyond possession of `accountId` — knowledge of the account id *is* the capability, and it's unguessable without the passphrase.
- **Rate limiting.** A **per-client-IP** limit across all methods is the anti-guessing throttle: each passphrase guess derives a *fresh* `accountId`, so a per-`accountId` limit alone never throttles enumeration (and would leave PUT/DELETE unthrottled). A per-`accountId` `GET` limit is kept as anti-hammering of one known account. Both are coarse KV counters (a Durable Object is the hard-limit upgrade); scrypt + a strong passphrase remain the real secrecy barrier.

## 8. Sync flow (main process)

Blob sync is **pull → decrypt → merge → encrypt → push**, per store, never server-side:

1. **Triggers:** on enable, on launch (if configured), on a debounced timer after local writes (reuse the `instances[]`/`onSettingsChanged` hooks), and on a manual "Sync now" button.
2. For each syncable store: `GET` current remote (with its `version`) → decrypt → `store.merge(remote)` → `store.export()` → encrypt → `PUT` with `ifVersion: version`.
3. On **409**, re-pull and retry the merge (merge is idempotent/commutative by design, so retry is safe).
4. All failures are silent and non-fatal — like the ping, a broken sync must never affect startup or block the UI. Surface state ("Last synced 2m ago" / "Offline") in Settings only.

## 9. Identity, setup & recovery UX

- Settings → **Sync** section: handle field + passphrase field + "Turn on sync." A short, honest note: *"Blanc encrypts your data on this device. We store only unreadable ciphertext and can't recover it if you forget your passphrase."*
- **Minimum-strength nudge** on the passphrase field (decided §14) — reject obviously-weak passphrases at setup (a length floor + a cheap client-side estimator), since with no server-side account there is no reset. Paired with the §7 rate limit, this covers both weak-passphrase and online-guessing angles.
- Enabling on a second device with the same handle+passphrase pulls and merges automatically — no separate "link device" step (the derivation *is* the link).
- No device list, no account dashboard, no deactivation server-call in v1. "Turn off sync" is local: stop syncing, optionally wipe the local passphrase. A "Delete my synced data" button issues a `DELETE` for the account's blobs.

## 10. Security posture (consistent with the codebase)

- All crypto + `fetch` in main (`sync.js`), never renderer. Passphrase/keys never cross the bridge; the renderer sends the handle+passphrase over the guarded `pages:settings:*` namespace exactly once at setup and thereafter sees only derived status (`{ enabled, lastSyncedAt, error }`) — same least-privilege as `supporterActive`.
- No CSP change (main-side fetch, like supporter/telemetry).
- `supporter` is filtered out of the settings export in `sync.js` *and* would be re-rejected by `setSettings()` on merge — belt and suspenders against license sharing.
- **Threat model: confidentiality only — availability and rollback are explicit non-goals (2026-07-11 audit decision).** Possession of `accountId` authorizes read, overwrite, and account-wide `DELETE` of the ciphertext; there is no second factor, and the server operator (or anyone who learns the id) can delete or roll blobs back to an earlier version undetected — the client has no version-chain or counter to notice a rollback. What E2EE guarantees is that no party without the passphrase ever reads the data. This is proportionate to the payload (re-derivable favorites/settings, not irreplaceable secrets): the honest failure mode is "your synced copy is gone or stale, re-sync from a live device," never "your data leaked." User-facing copy must therefore claim only confidentiality ("we can't read it"), never durability or tamper-evidence. The hardening path, if the payload ever grows teeth (history, credentials): a second derived secret as an auth token the Worker verifies on PUT/DELETE, plus a monotonic counter bound into the AEAD's associated data for rollback detection.

## 11. Error handling summary

- Network unreachable / Worker down: silent, retried on next trigger; Settings shows "Offline."
- 409 version conflict: automatic pull-merge-retry (bounded attempts, then defer).
- Decrypt failure (wrong passphrase on a device, or corrupt blob): surface "Passphrase doesn't match this sync account" in Settings; never crash, never clobber local data.
- Malformed/oversized blob from server: rejected client-side before merge; local data untouched.

## 12. Testing (manual — no suite in this repo)

1. Two dev profiles, same handle+passphrase: favorite on A appears on B after sync; delete on A removes it on B (tombstone, doesn't resurrect).
2. Concurrent edit both sides → both survive (union), no 409-induced loss.
3. Wrong passphrase on B → clear error, B's local data intact.
4. Airplane mode → no crash, "Offline," recovers on reconnect.
5. Confirm the Worker's stored value is opaque ciphertext (inspect KV — no readable URL/title).
6. Confirm `supporter` never appears in any synced blob; a supporter on A does not unlock colorways on unlicensed B.
7. History merge: union + 5000 cap holds; clear-all on A propagates via watermark.

## 13. Out of scope (deliberate)

- Downloads sync, cookie/password/session sync. (Open tabs from another
  device shipped 2026-07 as non-real-time snapshots — `2026-07-21-tab-sync-design.md`.)
- Accounts, email, device management dashboards, server-side merge or search.
- Any paid gating (free forever, per §2).
- Conflict UI — merges are automatic and non-destructive; there is nothing to resolve by hand.

## 14. Decisions (resolved 2026-07-07)

- **Brute-force hardening — both defenses.** Ship a client-side minimum-strength nudge at setup (§9) *and* a server-side rate limit (§7). Note (post-review): the limit that actually throttles guessing is **per-client-IP**, not per-`accountId` — each guess derives a fresh `accountId`, so a per-account limit only stops hammering of one known account. scrypt + a strong passphrase remain the real barrier.
- **`appIcon` is device-local.** It is filtered out of the settings blob entirely (§4); each device keeps its own Dock colorway. Sidesteps the supporter-gating interplay and avoids surprises. (Safe either way — `isAppIconAllowed()` already sanitizes on read — but not syncing it is the simplest v1.)
- **BYO sync folder — roadmap only, not built.** The zero-backend "point stores at iCloud/Syncthing" option stays a documented future alternative for the self-hosting/offline-only crowd (and a grant-story bullet), but v1 is hosted E2EE only. Building folder-sync well fights the load-once/debounced-write model (whole-file clobbering) and would split effort — deferred deliberately, not dropped.
- **Post-review correctness fixes (2026-07-07).** A multi-angle code review surfaced merge/interaction bugs, since fixed and unit-verified: favicon refreshes are device-local (never stamped into the LWW `updatedAt`, so an incidental refresh can't resurrect a deleted favorite); item clocks fall back to `addedAt` so legacy favorites aren't deleted by stale tombstones; merged favorites keep oldest-first order and are validated like local writes; the settings merge advances its clock even on values it can't apply (no forward-compat loop) and no longer self-triggers a sync (a separate `onMerged` channel refreshes the UI instead); disabling mid-sync can't corrupt state or stamp a disabled account; sync errors map to distinct messages instead of a blanket "check your connection"; the Worker requires a store segment for GET/PUT and rate-limits per-IP; and a mistyped passphrase (which forks a new account rather than erroring — inherent to passphrase-derived account ids) now surfaces a "started a new sync account" notice. **Known residual limitations:** a *misremembered* (vs mistyped) passphrase is undetectable and still forks; `adblockExceptions` is whole-array LWW (concurrent edits on two devices can drop one side — accepted, not union-merged); and open internal pages refresh favorites on their next load, not live.
