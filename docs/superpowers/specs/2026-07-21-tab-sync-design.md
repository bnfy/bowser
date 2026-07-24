# Tab Sync — open tabs from your other devices

**Date:** 2026-07-21 (revised 2026-07-23)
**Status:** Approved
**Builds on:** [2026-07-07-profile-sync-design.md](2026-07-07-profile-sync-design.md) — this is the "session" store that spec deferred (§4, v2+) and the worker reserved (`// history/session added in a later phase`).

## 1. What this is

Profile Sync grows a third store: each device publishes a snapshot of its open tabs (with groups and pinned state), and every other synced device can browse that snapshot read-only and open individual tabs locally. An optional fourth `icons` store supplies inert favicon pixels without changing the already-deployed session schema. This is the Firefox/Safari "tabs from other devices" model — **not** a merged live session. Nothing ever force-opens or closes a tab on another machine; the snapshot is a menu, not a mirror.

Chosen over two alternatives during brainstorming:
- **Workspace hand-off** (explicit push/pull of the whole session) — rejected as less ambient; the passive list covers the hand-off case (open the tabs you want) without a new verb.
- **Continuously mirrored session** — rejected: union-merging live tab state needs close-tombstones, high-frequency sync, and produces surprise tab churn in a one-window browser.

## 2. Experience

- **⌘L panel:** below the local groups' section, one collapsed header per remote device — `MacBook Air · 5 tabs · 2h ago` (the header's `blanc on ` prefix was dropped by the 2026-07-22 quiet-rows design — it was constant, hence noise) — using the same fold/unfold pattern as group headers. The snapshot carries the device's raw tab order; the remote renderer applies the same presentation `clusterList()` ([main.js:715](../../src/main/main.js)) derives locally — each group in group order with its pinned members leading, then loose tabs — preserving snapshot order within each cluster. Pinned rows get a pin marker, grouped rows the group name as a quiet mono label — the annotation vocabulary local rows already use. Clicking a row opens that URL as a plain new local tab (ungrouped, normal `createTab` path; no group reconstruction in v1). Devices with zero tabs, retracted entries, and the local device itself never render.
- **Quick Switcher:** remote tabs join the match pool (existing loose substring/in-order matching), ranked below local tabs and favorites. Rows carry the device name; group/pin metadata is ignored here and on the start page.
- **Start page:** an "on your other devices" block after the tab-groups section, fed via the `startPage` hooks (`pages:start:data` grows `remoteDevices`). Clicking navigates the current tab, same as favorites there. Renders only when remote snapshots exist — the ledger page stays quiet otherwise.
- **Settings → Sync:** a "Share this device's open tabs with your other devices" checkbox, **off by default for everyone** (fresh setups included). The resting pill is unchanged.

## 3. Consent model

Open tabs are browsing data — a step more sensitive than favorites/settings, and existing sync users only ever consented to those. Therefore:

- The toggle (`syncTabs`) is **per-device** and **off by default**; an app update never silently starts uploading tab URLs. Turning it on is always an explicit act on that device.
- It lives in **`sync.json`, not `settings.json`** — device-local by construction, structurally incapable of crossing settings sync (same posture as `usagePing`'s per-install consent).
- The toggle gates **publishing only.** When off, this device's exports omit (or retract) its entry, but the store still pulls and merges — so enabling tabs on one machine is immediately visible from the others without a second toggle. Reading is not a consent question: the data is the account's own, E2EE end to end.

## 4. Data model

Two new modules, split for testability: **`src/main/tabsync-model.js`** is pure logic — merge, fingerprint, size budget, pruning, the repair comparison — importable under `node --test` with no Electron reach (even `store.js` requires `electron` at line 1, so the `JsonStore` owner can't be the pure module). **`src/main/tabsync.js`** owns persistence and orchestration: `JsonStore('tab-sync', { accountId: '', devices: {} })` — the last-merged device map, including our own published entry, bound to the account it came from:

```
devices: {
  <deviceId>: {
    name,        // os.hostname(), read fresh at each publish so renames propagate
    platform,    // process.platform, for row labeling
    updatedAt,   // ms epoch — the LWW clock for this entry
    retracted?,  // true = "forget this device's tabs" (see §5)
    tabs: [{ url, title, groupId, pinned }],
    groups: [{ id, name }],
  }
}
```

Favicons deliberately do **not** extend this deployed shape. Older clients
rebuild every tab from known fields and re-upload the whole map, so an
additive field here would be stripped and repaired forever in a mixed-version
account. Updated clients instead use an optional, separately encrypted
`icons` sidecar:

```
devices: {
  <deviceId>: {
    updatedAt,
    retracted?,
    icons: [{ url, data }], // data:image/png only
  }
}
```

The publishing device resolves the favicon in the browsing session that
already has the page open, but sends no cookies or referrer. HTTP responses
must be successful, declare an image content type, arrive within three
seconds, and stay under 256 KB. Redirects are disabled, and localhost,
`.local`, loopback, link-local, RFC1918/unique-local, and other reserved
literal targets are rejected before fetch so capture cannot become a new LAN
probe. The source is then decoded and rasterized to a 16×16 PNG; only a
bounded `data:image/png;base64,...` value with a valid PNG signature/IHDR and
16×16 dimensions can enter the sidecar or renderer projection. Receiving
chrome never contacts a remote tab's site merely to draw the list. The
sidecar has its own 256 KB plaintext budget and discards cosmetic icon records
before its limit; it can never evict a tab or device from the primary session
snapshot. Workers deployed before the sidecar return 404 for `icons`; clients
treat that optional-store rejection as a quiet no-op and retain the normal
fallback glyph. Capture work is globally bounded, queued sources are replaced
per tab so URL/favicon churn keeps only the newest state, and changing the sync
account or tab-sharing consent drains queued work and aborts active requests.

- **`deviceId`** is a random UUID minted lazily, stored in `sync.json`. It is deliberately **not** the telemetry `installId` — nothing may attach to that identifier (CLAUDE.md), and browsing data least of all.
- **Account binding:** the store records the `accountId` its `devices` map was merged against. Whenever the current sync `accountId` differs (credentials changed — disable/re-enable with a new handle or passphrase), all cached remote entries are **discarded** before the first export, merge, **or read** (`getRemoteDevices`/`heartbeatDue` rebind too — a mismatched file pair must never render another account's cache; PR #41 review). The local `deviceId` survives the rebind; our own entry is rebuilt from live tabs anyway.
- **In-flight isolation:** every sync pass snapshots a credential/consent **generation** plus one immutable tab-sync context at start; the generation is re-checked after every await and the pass aborts ("stranded") the moment credentials, account, or the share toggle change — so a response from the old account is never merged, exported, or re-uploaded under the new one (PR #41 review, P1). Checkpoints alone can't recall a PUT already on the wire, so **`disable()` additionally drains**: it suspends new passes, strands the active one, and awaits its full settlement — network included — before issuing the wipe DELETE or clearing credentials. This applies to plain disable too, not just wipes — a deliberate tradeoff: turning sync off may wait on a stalled request, in exchange for the stronger guarantee that once `disable()` returns, no write ever lands under the old identity. Pinned by a deferred-fetch regression test (`test/unit/sync-wipe-race.test.js`) that runs the real `sync.js` under node with `electron` stubbed.
- **Snapshot contents** derive from the same entry-building logic `persistSession` uses, extracted into a small **pure module `src/main/session-snapshot.js`** (no `electron` import — `main.js` isn't loadable under `node --test`; `sync-wipe.js` is the precedent). It exposes two shapes: `persistableEntries(tabs)` — exactly today's `persistSession` semantics (private tabs and private-only groups excluded, `blanc://error` unwrapped), used unchanged for `session.json` — and `syncSnapshot(entries, groups)`, which additionally applies the portability filter for the synced copy.
- **Portability filter (sync snapshot only):** `http:`/`https:` URLs only — `file://` paths don't exist on other machines and `blanc://` internal pages aren't worth a row; URLs longer than 2048 chars are skipped; titles truncated to 200 chars; at most 500 tabs per device. `session.json` keeps persisting everything it does today; only the synced snapshot is filtered. Icon-source URLs never enter this shape.
- Snapshots mirror `session.json`'s persistable data but flow through their own store; `session.json` itself is untouched.

## 5. Merge semantics

Union by `deviceId`, last-writer-wins per entry on `updatedAt`. Each device only ever rewrites its own entry, so merges are commutative and idempotent — the existing pull-merge-push loop and 409 re-pull-merge retry in `sync.js` work unchanged.

- **Equal-clock ties are deterministic** (PR #41 review): our own entry is authoritative on this device (the stored full entry must never lose to its budget-trimmed upload copy, which shares its clock — §7); for other devices a same-clock retraction wins, then the lexicographically smaller canonical form — symmetric, so peers converge regardless of merge order.

- **Retraction:** toggling `syncTabs` off publishes our entry as `{ retracted: true, updatedAt: now }`, which LWW-beats every stale copy of our tabs held by other devices. Retracted entries render nowhere.
- **Pruning:** entries (retracted or not) whose `updatedAt` is older than **30 days** are dropped at merge/export time — a dead device's tabs quietly age out with no server-side TTL needed. A live device can't age out: the heartbeat (§6) republishes its entry at least daily even when its tabs never change.
- **Own-entry refresh:** `exportForSync()` rebuilds our entry from live tab state (when `syncTabs` is on) before every push — but `updatedAt` advances **only** when the fingerprint changed or the 24 h heartbeat is due. A rebuilt-but-identical entry keeps its prior clock, so the repair comparison (§6) can recognize a true no-op instead of seeing a fresh timestamp diff on every refresh.

## 6. Sync integration

- `sync.js`'s `STORES` gains `{ name: 'session', export: tabsync.exportForSync, merge: tabsync.mergeFromSync }` plus the optional `icons` descriptor. Order still doesn't matter.
- **Scheduling — isolated timers, fingerprint-gated.** `sync.js` has one trailing timer today, and `schedule()` clears it on every call — so high-churn tab events routed through it would keep postponing a pending 4s favorites/settings sync indefinitely. Primary `session` publishes and cosmetic `icons` publishes therefore get their **own trailing timers** (15s debounce) that never touch the existing one or each other; a page rotating favicons cannot postpone the required session snapshot or consent retraction. And because `persistSession` runs inside `broadcastTabs()` — which also fires for blocked-count ticks and loading-flag flips (~10/s during loads) — the tab trigger is gated by a **snapshot fingerprint**: a hash of the canonical serialization of the **complete publishable snapshot** — device name and platform, ordered tabs with `url`/`title`/`groupId`/`pinned`, and the groups list with ids, names, and order — excluding only transient fields (`updatedAt`). Moving a tab between groups, reordering tabs or groups, or a hostname rename all change it and schedule; blocked-count ticks and loading-flag flips don't. The sidecar separately fingerprints rasterized icon records.
- **Freshness — pull on focus/panel-open.** Local-change triggers alone never make another device's tabs appear on an *idle* machine (it would only pull at launch or after its own edits). So the receiving side gets a **session + icon-sidecar refresh** — pull + merge — triggered when the window regains focus (`browser-window-focus`) and when the ⌘L panel opens (`showOverlay('panel'|'palette')`), throttled to at most once per 60 s, only while sync is enabled. The PUT decision after the pull is **not** "did our fingerprint change" — that would never repair a remote blob that lost our unchanged entry in a race (e.g. another device's budget drop). Instead: compare each canonical bounded export against its decrypted remote map and **PUT whenever they differ**; skip only a true no-op. The fingerprints gate *scheduling*; export-vs-remote comparisons gate writes. This keeps refreshes off the bookmarks/settings blobs and well inside the worker's 30 GETs/min per-account limit.
- **Heartbeat:** while sharing is enabled, republish our entries (an `updatedAt` bump in each store that is due) once per **24 h** even when nothing changed — otherwise a continuously running device with stable tabs would silently age past the 30-day prune on every other device. The hourly session check schedules both stores, and each model independently decides whether its clock is due.
- Sync-on-launch (already present) publishes a fresh snapshot after session restore.
- **Quit:** a best-effort fire-and-forget `syncNow()` in `before-quit`. A change made in the final seconds before quitting may not upload until that device next launches — an accepted, documented limitation; no blocking of quit on network.

## 7. Worker (`cloudflare/sync-worker/`)

- `'session'` and `'icons'` join the `STORES` whitelist. `handleDelete` already iterates `STORES`, so account-wide wipe covers both blobs automatically.
- `MAX_BLOB_BYTES` stays 512 KB per encrypted store. The session client enforces an **account-level plaintext budget of 320 KB** at export (≈ 440 KB once encrypted + base64'd, safely under the worker cap): first trim our own tab list from the end until under budget, then — only if still over, a pathological many-device account — drop the stalest *other* devices' entries from the pushed map. The icon sidecar independently caps plaintext at 256 KB and trims cosmetic records without touching session data. A dropped device resurrects on its own next push or focus-refresh repair (§6 — its local copy still holds its entry, so export-vs-remote differs); only third-device visibility is briefly affected. Rate limits unchanged; the sidecar's extra GET+PUT per tab-sync cycle plus the throttled focus refresh remain inside them.

## 8. Privacy & threat model

- Tab URLs and titles ride E2EE exactly like favorites: AES-256-GCM client-side, the worker sees only ciphertext under an opaque `accountId`.
- Favicon source URLs never cross devices. A receiving device is given only a revalidated, embedded PNG produced on the source device, so opening the remote-tab surfaces cannot trigger a request—credentialed or otherwise—to a URL chosen by another device's page.
- This payload is a step toward the original spec's "payload grows teeth" note (§ threat model): open tabs ≈ a slice of live browsing history. The stance holds — **confidentiality-only claims; availability and rollback remain explicit non-goals** — and the original spec's hardening path (auth token on PUT/DELETE, AAD-bound counter) remains the trigger if the payload deepens further (full history, credentials — the latter still "never").
- Private tabs never enter the snapshot (inherited from the `persistSession` filter; pinned by a unit test).
- `syncTabs` and `deviceId` are device-local and never synced. The telemetry `installId` is untouched.

## 9. Testing

Unit tests (`test/unit/`, node --test) — most of the surface lives in the pure modules (`session-snapshot.js`, `tabsync-model.js`) precisely so it's testable without Electron:
- Merge: per-device LWW; retraction beats stale copies and cannot be resurrected by an older entry; 30-day pruning; tab cap and title truncation enforced on export.
- Account binding: a changed `accountId` discards all cached remote entries (and only then); `deviceId` survives the rebind.
- Snapshot builder (`session-snapshot.js`): private-tab exclusion, private-only group exclusion, error-URL unwrapping in `persistableEntries`; HTTP(S)-only filter, URL-length skip, and caps in `syncSnapshot`; `persistableEntries` output unchanged from today's `persistSession` behavior. Its exact tab keys are regression-pinned so icon work cannot drift the mixed-version wire schema.
- Session fingerprint: identical snapshots hash equal; blocked-count/loading-flag-only changes don't alter it; url/title changes, group membership/order moves, tab reorders, and device renames all do; `updatedAt` alone never does. The icon sidecar has its own content fingerprint and clock.
- Icon sidecar: accepts only bounded PNG data URLs with PNG structure, sanitizes/deduplicates remote records, preserves LWW/retraction/pruning semantics, trims icons without touching session tabs, and joins data only into the trusted renderer projection. Capture tests pin cookie-free/referrer-free fetching, rejection of non-PNG responses, cancellation on consent changes, and newest-source survival through queue pressure. An older Worker rejecting the optional store does not fail profile sync or overwrite required-store status.
- Repair comparison: a remote map missing our unchanged entry → differs → PUT; identical maps → no write.
- Heartbeat: an own entry older than 24 h is due for republish even with an unchanged fingerprint.
- Size budget: own-tabs trimming first, stale-other-device dropping second, output always under the plaintext budget.
- Consent gating: `syncTabs` off → export omits/retracts own entry while merge still applies remote entries.

Acceptance: a Gherkin scenario added to `spec/acceptance/` (dry-run-resolvable; desktop step bindings as feasible under `BLANC_TEST`).

## 10. Bookkeeping

- Update the profile-sync spec's §4 table: `session.json` row v2+ → shipped as the other-device tab list (this doc); "Live tabs from my other device" row → superseded by this doc's non-real-time model.
- Add feature entry **F27** to `spec/features.md` (F26 is the current highest) — this is user-facing contract future mobile ports must honor — plus the parity-matrix row.
- No substrate impact: `syncTabs` is not a `settings.json` key (no `settings-schema` change); no token or slash-command copy changes. Settings-page checkbox copy is plain HTML in `pages/settings.html`.

## 11. Out of scope (v1)

- Opening a whole remote group at once ("open all here").
- Real-time presence / server push (the 15s publish debounce + pull on launch/focus/panel-open is the freshness).
- Remote-closing tabs on another device; any write path targeting another device's entry.
- History and downloads sync (unchanged from the original spec's phasing).
