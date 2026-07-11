# Feature Spec (platform-neutral)

Each feature defines the **contract** every platform implements. Write to the
contract, not to another platform's code. `D#` references point to
[`divergence-register.md`](./divergence-register.md); `→ substrate` points to a
shared artifact in [`shared-substrate.md`](./shared-substrate.md).

Each entry ends with **Acceptance** — a platform-neutral scenario that must pass
identically everywhere.

---

## F1 — Island chrome (the pill + command bar)

The single custom command surface that replaces a traditional tab strip +
toolbar (Bowser Design System "Island Chrome").

- **Resting pill** shows, left→right: back/forward (desktop; mobile uses edge-swipe
  gestures per D7), the *active group's* tab dots (capped at 8, with a quiet `+N`
  that opens the panel), favicon, the active group's name, domain, shield count
  (F12), a private chip when private (F4), and a trailing action cluster
  (reload / favorite / downloads).
- **Expanded states** (one at a time): `panel` (command bar expanded in place),
  `palette` (same panel summoned by the ⌘L-equivalent, floated over a scrim),
  `find` (F8). Only the active state shows; Escape/back dismisses.
- The panel's list area shows: the **tab switcher** at rest, **slash commands**
  (F7) when input starts with `/`, the **Quick Switcher** (F6) otherwise.
- **Platform note:** desktop draws this as a 56px strip + an always-on-top overlay
  view. Mobile renders it natively (SwiftUI / Compose) driven by shared design
  tokens (→ substrate). The *layout, contents, and states* are the contract; the
  windowing is D11, the input affordances are D7.
- **Acceptance:** With 3 tabs in a group named `work` and 2 trackers blocked on the
  active page, the pill shows the platform back/forward affordance (buttons on
  desktop, edge-swipe gesture on mobile per D7), 3 dots, `work`, the domain, a
  shield count of 2, and the action cluster. Summoning the palette floats the
  command bar with the tab switcher listed.

## F2 — Tabs

- Create, close, switch, **reopen-closed**, **duplicate**, **pin/unpin**,
  **mute/unmute**. A plain new tab (F7 `/new`, panel row, new-tab shortcut) always
  opens **ungrouped** and to the newtab page (F16), regardless of the active tab's
  group.
- `window.open` / context-menu children **inherit the opener's group** (F3) and
  privacy (F4).
- Switching tabs never destroys inactive tabs' state on desktop; on mobile,
  inactive web views may be evicted and restored (D8) — but from the user's view a
  tab's identity, title, and scroll position persist.
- **Acceptance:** Open a tab, close it, reopen-closed → same URL returns. Duplicate
  a tab → a second tab with the same URL. Pin a tab → it is marked pinned and
  ordered ahead of unpinned tabs in its current group. An ungrouped pin uses the
  standalone pinned section; pinning never changes group membership.

## F3 — Tab groups

- Groups have **names, not colors** — lowercase mono labels. A group exists only
  while it holds ≥1 tab (auto-pruned when empty).
- Create/join via `/group <name>` (find-or-create) or an inline picker on the
  tab row; leave via `/ungroup`; close all via `/close-group`.
- The **pill renders only the active tab's group** as dots + name. A group's
  pinned tabs stay inside it and lead its rows/dots; only ungrouped pins use the
  standalone pinned section. Other groups live in the palette panel (per-group
  headers, foldable; collapsed group shows an "N tabs tucked away" row).
- The Quick Switcher (F6) matches group names, ranked above tabs; picking a group
  focuses it (unfolding if collapsed). The nth-cluster shortcut (D7) focuses the
  nth *group's* first tab when groups exist.
- New **private** tabs are never grouped.
- **Acceptance:** `/group work` on the active tab creates `work` and moves the tab
  in. Open a second group `play`; the pill shows only the active group. Collapse
  `work` → its tabs show as "N tabs tucked away" in the panel. Delete the last tab
  in `play` → `play` disappears.

## F4 — Private tabs

- Opened via `/private` or the new-private-tab shortcut, to the private newtab
  page. Marked `private` on the tab model.
- **Never** recorded to history (F10), **excluded** from session persistence (F18)
  and reopen-closed (F2). Children (`window.open`, context menu) inherit privacy.
- Private tabs share a dedicated **non-persistent web session** with one another,
  isolated from normal tabs. Cookies, storage, cache, service workers, HTTP auth,
  and permission decisions remain memory-only and disappear when Blanc quits.
- While the active tab is private, chrome uses the **private theme** (F15): dashed
  pill border, hollow dots, and a "private" chip that closes the tab (quick exit).
- Shield counts, downloads, favorites behave normally.
- On desktop, device-bound passkeys follow the session split: private tabs can't
  see the normal profile's passkeys, and passkeys *created* in a private tab are
  **ephemeral** — unusable after Blanc quits (D16).
- **Acceptance:** Open a private tab, visit a site → it does not appear in history
  or share normal-session site data; closing and reopen-closed does not bring it
  back; the pill shows the private chip and dashed styling.

## F5 — Address input & search

- One input normalizes typed text (`normalizeAddressInput` heuristic): has-a-scheme
  → navigate; looks-like-localhost/domain → navigate; else → search query against
  the selected engine.
- **Search engines:** `duckduckgo` (default), `google`, `bing`, `brave`. → substrate
  (engine table).
- **OS hand-off** (`handOffToOs`) is checked *before* normalization for bare
  `mailto:` / `tel:` / `facetime:` / `sms:` URIs and page-initiated navigations to
  them — handed to the OS instead of treated as a query (D4).
- The heuristic's known edge-case misclassifications (e.g. dotted query strings)
  are an **accepted limitation**, identical on every platform — do not "fix" one
  platform's parser to be smarter than the others.
- **Acceptance:** Typing `example.com` navigates; typing `how tall is everest`
  searches via the configured engine; typing `mailto:a@b.com` hands off to the OS
  mail handler.

## F6 — Command palette & Quick Switcher

- Summoned by the ⌘L-equivalent (D7). Typing anything that isn't a `/command`
  filters a **Quick Switcher**: loose substring / in-order match across open tabs,
  favorites, history, and **group names**. Group matches rank above tabs.
- Selecting a result navigates/focuses it; selecting a group focuses that group
  (F3).
- **Acceptance:** With a tab on `news.example` and a favorite `docs.example`,
  summoning the palette and typing `exa` lists both; typing a group name lists the
  group first and focusing it switches to that group.

## F7 — Slash commands

Typed into the command bar. The full set (names + hints are the contract, shared
copy → substrate):

| Command | Hint |
|---------|------|
| `/favorites` | Open favorites |
| `/history` | Open browsing history |
| `/downloads` | Open downloads |
| `/settings` | Open settings |
| `/clear` | Clear browsing history |
| `/new` | Open a new tab |
| `/private` | Open a private tab (history stays untouched) |
| `/close` | Close this tab |
| `/pin` | Pin or unpin this tab |
| `/mute` | Mute or unmute this tab |
| `/group <name>` | Move this tab into a group, creating it on first use |
| `/ungroup` | Take this tab out of its group |
| `/close-group` | Close every tab in this group |
| `/find` | Find in page |
| `/block-ads` | Toggle ad & tracker blocking |
| `/allow-ads` | Allow ads on this site |
| `/theme` | Cycle appearance (system → light → dark) |

- Prefix filtering: typing `/gr` narrows to `/group`; typing `/` alone lists all.
- **Acceptance:** Typing `/the` then Return cycles the theme; `/group work` moves
  the active tab into `work`.

## F8 — Find in page

- A find capsule floats over the page; the rest of the page stays interactive
  (desktop keeps the overlay bounds tight around the capsule). Match navigation
  (next/prev), count display, dismiss on Escape/back.
- **Acceptance:** Find a word present 3× → count shows 3 and next/prev cycles
  highlights without blocking clicks elsewhere.

## F9 — Favorites

- User-facing name **Favorites** (heart icon); every internal identifier stays
  `bookmarks` (do not rename internals). → substrate note: the internal id split is
  a hard rule, not a mismatch to fix.
- Toggle favorite on the active page; "Add all open tabs to Favorites"; favorites
  appear on the newtab ledger (F16) and the favorites page.
- **Acceptance:** Favoriting the active page marks the heart filled and the page
  appears on newtab and the favorites list.

## F10 — History

- Records a visit + updates title per navigation; capped at **5000** entries;
  clearable (`/clear`). **Guarded off for private tabs** (F4).
- **Acceptance:** Visiting a site adds one history entry with the final title;
  `/clear` empties the list; private visits never appear.

## F11 — Downloads

- Download list with progress, capped at **200** entries. The **list UI + progress
  + states** are the contract.
- Storage location and "open file"/"reveal" behaviour **diverge** (D3): desktop
  filesystem + reveal-in-folder; iOS Files/sandbox; Android Downloads dir.
- **Acceptance:** Starting a download shows a progress row that completes to a done
  state; the file is retrievable through the platform's normal mechanism.

## F12 — Ad/tracker blocking (the differentiator)

- **On by default.** Blocks ad/tracker **requests** and applies cosmetic hiding of
  leftover ad elements. Per-tab **shield count** of blocked requests (coalesced,
  ~10 updates/s). **Per-site allow** (`/allow-ads`, exceptions list) and a **global
  toggle** (`/block-ads`, Settings).
- **Filter data is shared** across platforms (EasyList + EasyPrivacy), compiled
  once → per-platform formats (→ substrate).
- **Engine diverges** (D1): desktop = `webRequest` interception (Ghostery); Android
  = `WebView.shouldInterceptRequest` (programmatic, comparable power); iOS =
  `WKContentRuleList` (declarative, ~150k-rule cap, curated subset). **Per-site
  exception mechanism** also diverges (D2): live predicate on desktop/Android vs.
  recompile/attach on iOS.
- **Contract that must hold everywhere:** blocking is on by default; the shield
  shows a per-tab blocked count; a site can be allow-listed and the toggle works;
  the *set of trackers blocked* is as close as each engine's format allows, from
  the same source lists.
- **Acceptance:** Loading a page with known trackers increments the shield count;
  `/allow-ads` on that site drops the count to 0 for it and persists; `/block-ads`
  toggles blocking globally.

## F13 — Permissions

- Explicit per-permission policy with in-chrome prompts (camera, mic, geolocation,
  notifications, etc.); same decision copy and default posture across platforms
  (mapped onto each OS's permission system).
- **Acceptance:** A site requesting geolocation raises the Blanc permission prompt
  with the shared copy; deny persists for that origin.

## F14 — Settings

Keys, defaults, and validation are the contract (→ substrate: settings schema).
From the desktop `DEFAULTS`:

| Key | Default | Values / rule |
|-----|---------|---------------|
| `searchEngine` | `duckduckgo` | one of duckduckgo/google/bing/brave |
| `adblockEnabled` | `true` | boolean |
| `homePage` | `""` | empty = `blanc://newtab`; else a URL |
| `theme` | `system` | system/light/dark |
| `appIcon` | `paper` | a free icon id, or a supporter id **iff** supporter active |
| `adblockExceptions` | `[]` | lowercased hostnames, no scheme/path/`www.` |
| `usagePing` | `true` | boolean (F21) |
| `supporter` | `null` | written only by the activation flow, never generic writes (F17) |

- `appIcon` is **sanitized on read** the same way it is validated on write: a
  stale/unlicensed supporter id reads back as the default. This predicate
  (`isAppIconAllowed`) is shared logic.
- **Acceptance:** Setting an invalid search engine is rejected; setting a supporter
  icon without an active license reads back as `paper`; adding `WWW.Example.com/x`
  to exceptions stores `example.com`.

## F15 — Theming

- Tokens in a root scope + a dark override + an explicit **private** scope. Driven
  by `theme` (F14) / `/theme`, propagating to chrome, internal pages, and web
  content **together, live, no restart**.
- Token *names and values* are shared (→ substrate: design tokens) — do not let the
  palettes fork between platforms.
- **Acceptance:** Switching to dark recolors chrome, an open `blanc://` page, and
  chrome all at once; entering a private tab applies the private scope.

## F16 — Internal `blanc://` pages

- Pages: **newtab** (the "ledger" start page), **favorites** (`blanc://bookmarks/`),
  **history**, **downloads**, **settings**, **shortcuts**, **error**, **auth**.
- The newtab ledger: date line, "Where to?", favorites, tab groups ("pick up where
  you left off" — clicking one focuses that group), footer with the weekly blocked
  count + palette hint. **No mascot** (retired in the rebrand — do not reintroduce).
- **Strong reuse opportunity:** ship these as **one shared web bundle** rendered in
  a web view on every platform, so they stay pixel-identical for free (→ substrate).
- **Acceptance:** newtab shows today's date, favorites, resumable groups, and the
  weekly blocked count; each page's nav links resolve within `blanc://`.

## F17 — Supporter & app icons

- 8 free colorways (`paper` default, `ink`, `graphite`, `default`/"Evergreen",
  `midnight`, `cream`, `forest`, `sage`) + 3 supporter-gated (`ember`, `plum`,
  `gold`), same fixed geometry.
- Supporter unlock is **trusted forever, offline-OK, cosmetic-only** — no
  revalidation, no DRM. Renderers only ever see a derived `supporterActive` boolean.
- **Diverges:** purchase rails (D5 — Apple IAP / Play Billing, not Polar, on mobile)
  and icon-switching mechanism (D6 — clean on iOS, limited on Android).
- **Acceptance:** A supporter can select `ember`; a non-supporter sees it locked and
  any hand-set supporter id falls back to `paper`.

## F18 — Session persistence & restore

- On relaunch, restore open tabs **and** groups (parallel `groupIds`). **Private
  tabs are excluded** from the file; groups referenced only by private tabs are not
  persisted.
- The desktop shape is `session.json` (`urls` + parallel `groupIds` + `groups`);
  mobile uses its platform store but preserves the same **logical** shape and
  restore behaviour (D8 for eviction/restore of live web views).
- **Acceptance:** With 2 groups and a private tab open, relaunch restores both
  groups and their tabs and does **not** restore the private tab.

## F19 — Context menu (link/page actions)

- Link/page actions: open in new tab, open in **background** tab, copy link,
  save/relevant page actions. Children inherit group + privacy (F2/F4). OS hand-off
  (D4) honored for `mailto:` etc. Gesture entry point diverges (D7 — long-press on
  mobile vs right-click on desktop).
- **Acceptance:** Long-press/right-click a link → "open in background tab" opens it
  without switching away, inheriting the opener's group.

## F20 — Basic-auth dialog

- HTTP basic-auth challenges present a modal prompt (`bowserAuth` bridge on
  desktop; native equivalent on mobile) with the same fields/behaviour.
- **Acceptance:** Navigating to a basic-auth-protected URL raises the credential
  prompt; correct credentials proceed, cancel aborts the navigation.

## F21 — Telemetry (usage ping)

- Single launch ping, **on by default, opt-out** (`usagePing`), **packaged
  builds only**, fire-and-forget (a failed/blocked ping never affects startup or
  surfaces to the user). Payload: `{installId, sessionId, version, platform,
  arch}`. `installId` is a random per-install token stored in its own
  `install.json` (not in settings, never synced) — it maps to a device install,
  never a person. `sessionId` is a random 32-bit integer per launch for GA4
  session tracking. Endpoint is the shared `blanc-ping` worker, which dedupes
  repeat launches into DAU/WAU/MAU via TTL'd `seen:*` flags and optionally
  mirrors to GA4.
- **Pseudonymity guarantees (2026-07-11 audit):** the worker never stores or
  forwards the raw `installId` — it's HMAC'd under the `INSTALL_HASH_SECRET`
  worker secret on arrival (secret unset ⇒ uniques skipped, fail closed), and
  GA4's `client_id` receives only the hash. Per-install `seen:*` flags expire
  at 90d (daily) / 400d (weekly, monthly); only aggregate counters live
  longer. Settings offers a **"Reset install ID"** button (mints a fresh id in
  `install.json`; the install counts as brand new from the next ping). The
  privacy policy (`site/privacy.html`) describes exactly this pipeline — keep
  the two in lockstep. Pre-migration `seen:*` markers (raw UUIDs, some with
  the old 800d TTL) are purged via the worker's bearer-gated
  `POST /admin/purge-legacy-ids` — run to `done:true` after deploy and BEFORE
  publishing the policy page (see the worker README); pre-migration GA events
  carried the raw token, disclosed in the policy's transition note.
- **Acceptance:** With the setting off, no ping is sent; with the default (on),
  exactly one ping is sent at launch in a packaged build; blocking the network
  changes nothing user-visible; deleting `install.json` — or the Settings
  "Reset install ID" button — resets the install identity.

## F22 — Distribution & updates

- Users receive updates without an in-app updater fighting the OS. Desktop uses
  `electron-updater`; mobile is **store-managed** (App Store / Play) — the in-app
  auto-updater is `N/A` on mobile (D9).
- **Acceptance:** A newer version is installable through the platform's normal
  channel; no mobile build ships a self-updater.

## F23 — Zoom / page scaling

- Pages can be scaled. Desktop uses discrete zoom steps (⌘+/-/0). Mobile uses
  native pinch-zoom / reflow (D10). The *ability to scale* is the contract; the
  control is platform-native.
- **Acceptance:** A page can be enlarged and reset through the platform-native
  control.

## F24 — Password AutoFill & passkeys (mobile-gained)

- On mobile, the system **credential provider** (iCloud Keychain / 1Password / etc.)
  and **platform passkeys/WebAuthn** work inside the web view — the desktop
  limitation (vendor code-signature allowlists) does not apply (D12). `N/A` on
  desktop for credential providers; desktop *does* offer **device-bound Secure
  Enclave passkeys** via Touch ID in signed builds (Blanc's own keychain access
  group, not iCloud-synced), with private-tab passkeys ephemeral per D16.
- **Acceptance:** On a login form in a Blanc tab, the OS AutoFill affordance offers
  saved credentials; a passkey sign-in invokes the platform authenticator.
