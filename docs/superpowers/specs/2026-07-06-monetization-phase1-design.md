# Monetization Phase 1 — Support links, Blanc Supporter license, grants + B2B

**Date:** 2026-07-06
**Status:** Approved

## Context

Blanc is pre-audience (single-digit downloads per release, mostly the auto-updater's
`latest-*.yml` fetches; public repo `bnfy/blanc`, 1 star). Monetization at this stage is
about laying trust-aligned rails, not revenue. The brand constraint is absolute: Blanc
blocks ads at the network layer and ships an intentionally empty start page — nothing
here may introduce ads, sponsorships, phone-home behavior, or nagging.

Decisions already made with the user:

- **Provider:** Polar.sh — merchant of record, handles global tax, built-in license key
  generation + activation API, checkout links need no backend.
- **Price:** $19 one-time ("Blanc Supporter").
- **Enforcement philosophy:** activate once online, trust the local flag forever. No
  revalidation, no lockout, works offline. Perks are cosmetics; DRM would betray the brand.
- **GitHub Sponsors:** skipped — no listing exists for `bnfy`, approval takes days, and
  Polar covers donations and licenses with one account.

## Workstream A — Support links + real numbers

1. **`.github/FUNDING.yml`** with `polar: bnfy` (GitHub supports Polar natively) — adds
   the repo Sponsor button with no approval process. Exact Polar handle comes from the
   account setup checklist below.
2. **Marketing site** (`site/index.html`): a short "Support Blanc" link/section pointing
   at the Polar checkout URL. Ships in the same deploy as Workstream C's B2B section.
3. **`scripts/stats.sh`**: a small `gh api` script printing per-release download counts,
   separating installer artifacts (`.dmg`, `.zip`, `.exe`, `.AppImage`) from update-check
   metadata (`*.yml`, `*.blockmap`), so real adoption is measurable before any future
   monetization decision. Read-only; uses the `gh` CLI's cached auth like `release.sh`.

## Workstream B — Blanc Supporter license

### Perks (v1)

- **Three supporter-only Dock colorways**: `ember`, `plum`, `gold` (names follow the
  existing lowercase muted register: default, midnight, cream, forest, sage).
- Rendered at the **exact fixed geometry** of the existing five: 1024×1024 canvas,
  824×824 rounded square inset 100px, mark scaled to a 522px-tall bounding box
  dead-centered — composed from `brand/4x/B@4x.png`. Files land flush in
  `src/renderer/pages/` as `icon-ember.png`, `icon-plum.png`, `icon-gold.png`
  (the `blanc://` page server only serves flat files from that directory).
- A quiet "supporter" badge line in Settings when active.
- The existing five colorways stay free. Known limitation, accepted: the Dock icon swap
  is macOS-only (`applyAppIcon` guards on `darwin`), so v1 perks are effectively
  macOS perks. Windows/Linux perks are future work, not blockers.

### Data model (`src/main/settings.js`)

- New constant `SUPPORTER_ICONS = ['ember', 'plum', 'gold']`, exported alongside
  `APP_ICONS`. `APP_ICONS` keeps only the free five.
- New default `supporter: null`. When activated:
  `{ key, activationId, activatedAt }` (ISO timestamp).
- `setSettings()` must **not** accept `supporter` from the generic partial — the only
  writer is the activation flow in main. The generic path silently ignores it,
  consistent with the existing whitelist style.
- `appIcon` validation becomes: accept ids in `APP_ICONS`, or in `SUPPORTER_ICONS`
  when `supporter` is set.
- `applyAppIcon()` in `main.js`: resolve the icon from the union of both lists; if the
  stored id is a supporter icon but supporter is not active (settings file copied or
  hand-edited), fall back to `default`.

### Activation flow

- Settings page gains a **Supporter** section: license key input + "Activate" button,
  plus locked tiles for the three supporter colorways in the existing icon grid
  (visually dimmed with a small "Supporter" tag; clicking one scrolls/points to the
  Supporter section rather than silently failing).
- New IPC on the existing guarded namespace: `pages:settings:supporter-activate`
  (renderer → main, payload: the key string). Main calls Polar's public
  customer-portal activation endpoint
  (`POST https://api.polar.sh/v1/customer-portal/license-keys/activate` with
  `{ key, organization_id, label }`), where `organization_id` is a public constant in
  the code and `label` is a short host descriptor (e.g. `os.hostname()` truncated).
  The key never touches web content; the fetch happens in the main process, so **no
  CSP changes** in any HTML file.
- On success: store `supporter` in settings, broadcast the updated settings, return
  `{ ok: true }`. On failure: return `{ ok: false, message }` mapped to three cases —
  invalid key, activation limit reached (set to 5 devices on the Polar side), and
  network unreachable ("Couldn't reach Polar — check your connection and try again").
- Settings payloads sent to the renderer expose only `supporterActive: boolean` (and
  optionally `activatedAt`) — never the key or activation id, even though internal
  pages are privileged. Least-privilege, consistent with the existing bridge design.
- No deactivation UI in v1. No revalidation ever — once active, active.

### Polar account setup (manual, user-side — gates checkout URLs in A)

1. Create the Polar organization (note the handle for `FUNDING.yml` and the
   `organization_id` for the activation call).
2. Create product "Blanc Supporter", $19 one-time, with the License Keys benefit,
   activation limit 5.
3. Grab the hosted checkout URL for the site and FUNDING links.
4. During development, use Polar's sandbox environment
   (`sandbox-api.polar.sh`) with a test product; the endpoint base is a switchable
   constant so dev builds can point at sandbox.

## Workstream C — Grant drafts + B2B line

1. **`docs/grants/nlnet-commons-fund.md`**: a ready-to-submit draft for NLnet's
   Commons Fund open call, answering their actual application questions (abstract,
   amount requested, comparison with existing efforts, technical challenges,
   ecosystem impact). Framing: an independent, minimal browser shell with
   network-level content blocking as user agency, outside the extension-store /
   Manifest V3 regime.
2. **`docs/grants/futo-pitch.md`**: a shorter email-style pitch to FUTO (rolling
   submissions), same framing, more product-forward.
3. **Nothing is submitted by the assistant** — drafts only; the user reviews and submits.
4. **B2B section on the site**: one short block near the footer — Blanc's shell
   (network-level content filtering, internal pages on a privileged scheme, explicit
   permission policy) is available for white-label and kiosk work — with
   `mailto:anthony@bnfy.me`. Copy must match the site's restrained voice.

## Site-change constraints

- `release.sh` seds the JSON-LD `softwareVersion` in `site/index.html`; new markup
  must not disturb that line or the JSON-LD block.
- The app remains free; JSON-LD `offers` (price 0) is unchanged — Supporter is a
  separate product, not an app price.
- One deploy covers A2 + C4: `npx wrangler pages deploy site --project-name=blancbrowser`.

## Error handling summary

- Activation: three user-visible error states (invalid key / limit reached / offline),
  inline in the Supporter section, never modal.
- Icon fallback: unknown or unauthorized `appIcon` values resolve to `default`
  (existing behavior, extended to the supporter check).
- `stats.sh`: exits nonzero with a plain message if `gh` is missing or unauthenticated.

## Testing

No test suite exists in this repo (per CLAUDE.md) — verification is manual:

1. `npm start`, open Settings: supporter tiles render locked; free colorways still work.
2. Activate with a Polar sandbox key: badge appears, supporter tiles unlock, Dock icon
   swaps, `settings.json` contains the supporter record.
3. Restart offline: supporter state persists, icon applies, no network call attempted.
4. Invalid key and airplane-mode activation show the right inline errors.
5. Hand-edit `settings.json` to a supporter icon with `supporter: null`: falls back
   to `default`.
6. `scripts/stats.sh` prints sane per-release numbers.
7. Site: support + B2B sections render; `release.sh`'s sed still matches (dry-run grep).

## Out of scope (deliberate)

- Windows/Linux supporter perks, themes-as-perks, supporter badge outside Settings.
- License deactivation/transfer UI, revalidation, anti-piracy of any kind.
- Sync, Pro subscription, search partnerships (future phases).
- GitHub Sponsors application.
- Actually submitting grant applications or setting up the Polar account (user-side).
