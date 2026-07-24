# Blanc — Utility Sheet: Internal Pages Leave the Tab List

**Date:** 2026-07-22
**Status:** Approved design — ready for implementation planning
**Surfaces:** `src/main/main.js` (sheet lifecycle, routing, session restore filter), `src/main/pages.js` (close IPC), `src/main/test-hook.js` (state accessor), `src/renderer/pages/pages.css` + the five utility page HTML/JS files (sheet presentation, ✕), `spec/` (feature contract + acceptance), and the ⌘L panel footer's behavior by inheritance.

---

## 1. Problem

Favorites, History, Downloads, Settings (and Shortcuts) open as regular tabs.
They are singletons already — `openInternalPage()` ([main.js:1329](../../../src/main/main.js))
reuses and refocuses an existing tab — but each one touched still parks a row
in the ⌘L tab list, a dot on the pill, an entry in Quick Switcher tab
results, and a URL in `session.json`. These pages are **chrome, not
browsing**: a tab's job is "keep this so I can come back," but utility pages
are never *returned* to — they're reopened, and every one of them is
permanently one click away (footer, slash command, menu, shortcut). Utility
rows sitting between real work tabs is category noise; native apps present
preferences as transient chrome (Safari's settings window), not workspace
items.

## 2. Decision

**A transient "utility sheet":** a large centered sheet floating over a
dimmed scrim — the palette's existing visual language scaled up. Rejected:
full-bleed takeover (indistinguishable from a tab, nothing signals
transience); side panel (cramped for Settings/History); hiding utility tabs
from the list (zombie state).

Utility set: `blanc://bookmarks/`, `history`, `downloads`, `settings`,
`shortcuts`. **Not** included (remain ordinary tab content): `newtab`,
`error`, `auth`.

## 3. The surface

- One main-owned, lazily-created `WebContentsView` — the sheet. It loads
  utility pages directly as `blanc://` URLs, so `pages.js`'s
  `event.sender.getURL()` re-verification and `tab-preload.js`'s
  protocol-gated `bowserPages` bridge work **unchanged**. Same hardening as
  tabs: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  preload `tab-preload.js`.
- Presentation reuses the island overlay's technique: the view spans the
  full content area, `setBackgroundColor('#00000000')`, and the *page* draws
  the scrim + centered card. One shared pattern lands in `pages.css`
  (scoped so `newtab`/`error`/`auth` are untouched); each utility page's
  existing top-level container becomes the card.
- Stacking: attached above the active tab's view. Per §5 the sheet and the
  island overlay never *intentionally* coexist, but the defensive ordering
  is overlay > sheet > tab (`setActiveTab`'s overlay re-stack guard extends
  to the sheet) so a race can never paint a tab or sheet over the overlay.
- Shown = attached; dismissed = detached, view kept for instant reopen.
  Every open calls `loadURL`, replacing today's reload-on-refocus freshness
  behavior.

## 4. Routing — one chokepoint

`openInternalPage(url)` splits on the utility set:

- Utility URL → show sheet (attach + `loadURL` + focus). Already open →
  swap page in place; already open **on that same page** → dismiss (toggle).
  The toggle is reachable only from direct invocations (menu items and
  accelerators like ⌘,) — the ⌘L footer buttons and slash commands cannot
  toggle, because summoning the island overlay already dismissed the sheet
  (§5) before the click; from those paths the sheet simply opens.
- `newtab`/`error`/`auth` → existing tab behavior, unchanged.

All entry points funnel through it today and inherit the change for free:
the ⌘L footer buttons, the `/favorites` `/history` `/downloads` `/settings`
commands, the menu items, and the ⌘, / ⌘⇧J / ⌘⌥B / ⌘/ shortcuts.

**A single shared classifier** — `isUtilityUrl(url)` (exact utility-host
`blanc://` match) — is the source of truth for "belongs in the sheet," used
by every interception point below. No call site re-derives the set.

Additional routing rules:

- **Typed `blanc://` utility URLs** in the address bar route to the sheet
  (checked where `handOffToOs()`/navigation targets are resolved), never
  navigating the tab.
- **Ordinary-tab `will-navigate`:** the existing tab policy permits
  `blanc:` → `blanc:` hops, so the new-tab page's ledger link to
  `blanc://bookmarks/` ([newtab.html:17](../../../src/renderer/pages/newtab.html))
  would create a utility *tab* and bypass the sheet. The tab handler gains a
  classifier check: utility targets are `preventDefault()`ed and routed to
  `openInternalPage()` instead. Non-utility internal hops (e.g. anything →
  `blanc://error`) behave as today.
- **Explicit tab creation:** `createTab(url)` guards on the classifier —
  a utility URL is rerouted to the sheet instead of building a tab view
  (defense in depth for any caller: external `open-url`/argv handoff,
  Quick Switcher, future call sites). Session restore never trips this
  guard because restore filters first (§6), keeping its index bookkeeping
  intact.
- **Sheet-internal navigation is default-deny.** The sheet's own
  `will-navigate`: utility `blanc://` targets stay in-sheet (pages may link
  each other); http(s) targets — a history entry, a favorite — are
  cancelled, opened via `createTab`, and the sheet dismisses; approved
  handoff protocols go to the OS via `handOffToOs()`; **everything else is
  cancelled**, and `setWindowOpenHandler` denies unconditionally (utility
  pages have no legitimate popup).
- **Web content** can still never reach `blanc://` (unchanged scheme
  privileges / window.open policy).

## 5. Dismissal & interplay

- **Esc** via `before-input-event` on the sheet's webContents (mirrors the
  overlay's handler at [main.js:416](../../../src/main/main.js)).
- **Scrim click** (page-side handler → close IPC).
- **✕** in each utility page's existing header — minimal ≠ hidden,
  `aria-label="Close"`. Wired over a new `pages:surface:close` IPC in
  `pages.js` that is **stricter than the generic guard**: the generic
  `handle()` wrapper trusts any `KNOWN_PAGES` blanc host
  ([pages.js:59](../../../src/main/pages.js)), which would let the newtab
  page dismiss the sheet; `surface:close` additionally requires
  `event.sender` to be the sheet view's exact `webContents` *and* the
  sender host to pass `isUtilityUrl`.
- **Toggle:** re-invoking a *direct* entry point (menu/accelerator) for the
  currently-shown page closes it (see §4 for why overlay-hosted entry
  points can't hit this case).
- **One floating layer at a time:** summoning the island overlay (⌘L, /,
  find) dismisses the sheet first; switching or creating tabs dismisses it.
- **Window blur does NOT dismiss** — the sheet is a workspace (Safari
  settings window), not a popover.
- **Theme:** normal token scope, including while the active tab is private —
  the sheet always shows normal-profile data, so it must not wear the
  private theme. (Sheet visibility does not alter the strip's own private
  theming.)

## 6. What falls out for free, and one shim

Because the sheet never enters the `tabs` map: utility pages disappear from
the ⌘L tab list, the pill's dot cluster, Quick Switcher *tab* results,
session persistence, tab sync snapshots, and reopen-closed-tab — with zero
code in any of those paths. One migration shim: **session restore filters
utility URLs** out of stale `session.json` files *before* the `createTab`
replay loop. The restore data is parallel structures (`urls` / `groupIds` /
`pinned` plus `activeIndex` — [main.js:2183](../../../src/main/main.js)), so
the filter must be **zipped**: entries are filtered as `{url, groupId,
pinned}` triples with original indices, and `activeIndex` is remapped
deterministically — the surviving entry at the original index if it
survived, else the next surviving neighbor (first survivor after the
original index, falling back to the last survivor before it, else 0). This
lands as a pure helper (in or beside `session-snapshot.js`, the existing
home for pure session logic) with unit tests covering the alignment and
remap cases.

## 7. Error handling, accessibility & lifecycle

- Esc, scrim, and ✕ are all main-verified paths; none depend on renderer
  state beyond the click itself.
- **Dialog semantics:** the card element carries `role="dialog"` +
  `aria-modal="true"`, labelled by the page's existing heading. After each
  sheet `loadURL` completes, focus moves to that heading
  (`tabindex="-1"` + `.focus()`) so keyboard and screen-reader users land
  on, and hear, the page they just opened — `webContents.focus()` alone
  focuses the document, not anything meaningful in it.
- **Focus return:** every dismissal path (Esc, scrim, ✕, toggle, tab
  switch, overlay summon) returns focus to the surface that logically
  follows — the active tab's view, or the island overlay when that's what
  dismissed it.
- **Geometry floor:** the card layout uses relative units and contains its
  own scrolling (the scrim never scrolls), and must stay usable at the
  window minimum of 640×480 ([main.js:1895](../../../src/main/main.js)) and
  under webContents zoom — content reflows within the card rather than
  clipping.
- The sheet honors `prefers-reduced-motion` for any show/hide transition it
  gains (pages.css).
- If the sheet's webContents crashes, dismiss + destroy the view; next open
  recreates it lazily. The main window's close/`closed` teardown destroys
  the sheet view alongside the overlay.
- The acceptance harness's `reset()` (test-hook) dismisses the sheet so no
  scenario inherits another's open surface.

## 8. Spec & test updates

- `spec/acceptance/internal-pages.feature` — scenarios like "the history
  page opens under the blanc scheme" stay true (same scheme, same pages);
  any step asserting the page occupies a *tab* is re-bound to the sheet.
  `island-and-commands.feature`'s "/downloads → the downloads page opens"
  likewise.
- `src/main/test-hook.js` gains a `utilitySurface()` accessor
  (`{ visible, url }`) so desktop steps can assert sheet state; its
  `openDownloads()` keeps calling `openInternalPage` and now exercises the
  sheet path.
- Parity spec: amend the internal-pages feature contract — utility pages
  present as a transient chrome surface, not tabs. This fits iOS *better*
  (native sheet presentation), so no new divergence (D#) is expected;
  update `parity-matrix.md` wording if it references tabs.
- **Explicit proofs the tests must carry** (unit or acceptance as noted):
  1. Opening a utility page leaves the active tab's URL and the tab order
     unchanged (acceptance, via `state()` before/after).
  2. Clicking the new-tab ledger's `favorites` link routes to the sheet —
     no new tab appears (acceptance; this is the §4 `will-navigate` fix).
  3. An outbound click from History/Favorites creates exactly one real tab
     and dismisses the sheet (acceptance).
  4. The zipped restore filter keeps `groupIds`/`pinned` aligned with
     surviving `urls` and remaps `activeIndex` per the §6 rule, including
     the removed-active-entry and all-entries-removed cases (unit).
  5. Every dismissal path (Esc, scrim, ✕, toggle, tab switch, overlay
     summon) restores focus per §7 (acceptance where drivable, else manual
     checklist).
- Manual verification: chrome + pages change → relaunch `npm start`;
  exercise all entry points, Esc/scrim/✕/toggle dismissal, outbound click
  from History, ⌘L-over-sheet, private-tab theming, light/dark, and the
  640×480 minimum window size.

## 9. Out of scope

- `newtab`, `error`, `auth` presentation (unchanged tabs/dialog).
- Any resting-pill change.
- iOS implementation (contract only).
- Removing the pages' ability to render full-bleed generally — the sheet
  card styling may keep them functional at any viewport, but no separate
  "tab mode" styling is maintained once this ships.
