# Native menu bar — Tabs & Favorites expansion

**Date:** 2026-07-05
**Status:** Approved

## What

Bring the macOS native menu bar's **Tabs** and **Favorites** submenus (`buildMenu()` in
`src/main/main.js`) up to Safari/Chrome-style parity: surface existing capabilities
(tab groups, favorites) that today are only reachable via slash commands or the Island
panel, add the small set of tab actions those browsers have that Blanc doesn't yet
(Duplicate/Pin/Mute Tab), and make both menus show live, clickable lists instead of
static action items only.

Driven by general parity with Safari/Chrome conventions, not a specific pain point.

## Tabs menu — final shape

```
Next Tab                     ^⇥
Previous Tab                 ^⇧⇥
──────────
Duplicate Tab
Pin Tab / Unpin Tab          ← label flips on the active tab's pinned state
Mute Tab / Unmute Tab        ← label flips on the active tab's muted state
──────────
New Group…                   ← opens the command bar prefilled "/group "
Ungroup Tab
Close Group
──────────
Tab or Group 1–9             (existing, unchanged)
──────────
[dynamic: one item per open tab, "Title — domain (group name)", ✓ on the active tab,
 click jumps to it; order matches the pill: pinned shelf, then group clusters, then
 ungrouped]
```

Duplicate/Pin/Mute get no default accelerator — neither Safari nor Chrome bind one;
they're menu- and row-button-only actions. `New Group…`, `Ungroup Tab`, and
`Close Group` mirror the existing `/group`, `/ungroup`, `/close-group` slash commands
(`overlay.js`) exactly; `New Group…` needs a name, so it opens the command bar with
`/group ` pre-typed rather than a native text-input dialog.

## Favorites menu — final shape

```
Add to Favorites / Remove from Favorites    ⌘D    ← label flips on bookmark state
Add All Open Tabs to Favorites
──────────
[dynamic: most-recent 20 favorites, click opens each in a new tab]
Show All Favorites…                          ← shown only when there are more than 20
──────────
Show Favorites            ⌥⌘B
Show History              ⌘Y
```

`Add to Favorites` already toggles (`toggleBookmarkForActiveTab`); this just makes the
label reflect the resulting state instead of always reading "Add to Favorites".
`Add All Open Tabs to Favorites` adds every open tab's URL as an individual favorite
(favorites stay flat — no folders — per the existing `bookmarks.json` model), skipping
private tabs (favorites are never populated from private browsing, matching the
existing history/session exclusion) and URLs already favorited (idempotent, reusing
`bookmarks.isBookmarked`).

## New tab-state: Pin & Mute

Neither exists anywhere in the codebase today (confirmed: no `pinned`/`muted` fields on
the tab model, no pin/duplicate/mute in `context-menu.js`) — this is genuinely new
tab-model surface, not just menu wiring.

- **Orthogonal to everything else.** A tab can be pinned *and* grouped *and* private at
  once. Pin does not remove a tab from its group.
- **Persistence:** `pinned` persists in `session.json` (same treatment as `groupId`).
  `muted` does **not** persist — it resets on relaunch, matching Chrome/Safari (mute
  rides on a live audio session, not a saved preference).
- **Duplicate Tab:** clones the source tab's URL/history into a new tab, inserted
  immediately after the source, inheriting its `groupId` and `pinned` state. No new
  state of its own — implemented as a thin wrapper around the existing `createTab`.
- **Mute:** calls `webContents.setAudioMuted()`. No auto-detection of "tab is currently
  playing audio" (Chrome's speaker-icon-appears-automatically behavior) — purely a
  manual toggle, scoped out deliberately to keep this change bounded.
- **Slash commands:** `/pin` and `/mute` on the active tab, matching the established
  `/group`-style pattern in `overlay.js`'s `COMMANDS` array.

## Visual treatment

- **Pill (`styles.css` `#pillDots`):** pinned tabs render in their own bordered "shelf"
  capsule at the very start of the dot list, before any group cluster — visually the
  same language as the existing folded-group capsule (`.pill-cluster.folded`), but
  always unfolded and always first. No other pill-level marker for pin or mute; the
  pill's dots stay meaning-minimal (active/loading/private only), consistent with how
  it already defers title/domain/shield/group-name detail to the panel row.
- **Panel row (`overlay.js` `tabRow()` / `styles.css` `.island-row`):** pin and mute
  render as icon buttons with the same visual weight as the existing `.row-grp`/
  `.row-close` buttons — accent-filled when active, click toggles. Mute additionally
  gets a small badge on the favicon's corner so muted state is visible without hovering
  (mirrors Chrome's speaker-on-favicon convention). A "pinned" section header (same dim-rule
  style as `.island-ghead` group headers) sits above pinned rows in the switcher list,
  distinct from group headers since a tab can be pinned and grouped simultaneously.
  Both buttons follow the existing `.row-close` convention exactly: always present in
  the row's flex layout (space reserved, no hover reflow), `opacity: 0` and
  hover/focus-revealed when the tab is in its default state, but persistently visible
  and accent-filled — like the `.shield` badge and `.row-private` tag already are —
  when the tab is actually pinned or muted, so pinned/muted state reads at a glance
  without hovering.
- **Panel width:** `#islandPanel` grows from a fixed `560px` to a fixed `620px`. Sized
  from the row math, not a round guess: `.island-row` reserves 10px gaps between every
  child, and adding the pin + mute buttons (18px each) plus their two new gaps costs a
  "busy" row (favicon, title, domain, shield, pin, mute, group chip, close) about 56px
  it didn't spend before — shrinking that row's available title space from roughly
  284px to 228px inside the old 560px panel. +60px on the panel restores the original
  228px→284px-ish title budget so existing rows don't feel more cramped than they do
  today; only rows that also show a pinned/muted tab's icon in its filled, hover-independent
  state spend part of that budget, which is expected. Still a fixed constant, not a
  live resize — `max-width: calc(100vw - 24px)` continues to guard narrow windows.

## Menu-rebuild strategy (technical)

`buildMenu()` currently runs once, at window creation. Making the tab list, favorites
list, and the two dynamic labels live means rebuilding the menu template on real state
changes — tab created/closed/activated/reordered, bookmark toggled, pin/mute toggled,
group created/renamed/deleted — but **not** on every `broadcastTabs()` tick (~10/s
while any tab is loading, per existing chrome-broadcast behavior), which would cause
visible menu flicker and wasted work. Menu rebuilds get coalesced to the discrete
mutation points, not hung off the broadcast path.

## Testing

No test suite exists in this repo (per `CLAUDE.md`) — verification is manual, in a
packaged or `npm start` run, plus the Playwright driver where applicable:

- Tabs menu: duplicate/pin/mute an active tab and confirm label flips + pill/row visuals;
  create/rename/close groups via the new menu items and confirm parity with the existing
  `/group` flow; open several tabs across groups and confirm the dynamic list order
  matches the pill and jumping via click works.
- Favorites menu: toggle a favorite and confirm the label flips; use "Add All Open Tabs";
  confirm the dynamic list caps at 20 with "Show All Favorites…" appearing only past
  that threshold; click a listed favorite and confirm it opens in a new tab.
- Menu-rebuild throttling: load a page and confirm the menu doesn't visibly flicker/reopen
  while it's loading (~10 broadcasts/s).
- Restart the app and confirm pinned state survived, muted state did not.
- Panel width: with a pinned+muted+grouped+shielded tab in the list, confirm its title
  isn't more truncated than an equivalent row was before this change; confirm the panel
  still fits on a narrow window via `max-width: calc(100vw - 24px)`.
- Chrome documents (`index.html`/`overlay.html`) load once at window creation — verify
  visual changes with a fresh `npm start`, not `Cmd/Ctrl+R`.
