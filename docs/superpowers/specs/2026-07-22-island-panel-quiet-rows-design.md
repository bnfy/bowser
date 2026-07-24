# Blanc — Quiet Rows for the Expanded Island (⌘L Panel)

**Date:** 2026-07-22
**Status:** Approved design — ready for implementation planning
**Surfaces:** the overlay panel renderer (`src/renderer/overlay.js`, `src/renderer/styles.css`), plus two spec artifacts the device-label change touches (`spec/acceptance/sync.feature`, `docs/superpowers/specs/2026-07-21-tab-sync-design.md` §2)

---

## 1. Problem

The expanded island (⌘L panel) reads as cluttered. The diagnosis, confirmed
against a live screenshot: **row density**. Every tab row carries favicon +
title + a mono domain subtitle + a shield count chip (`405`, `5`, `1`…), and
pinned rows add an at-rest pin glyph — two text columns and a number chip
repeated down the entire list. The user scans the list by **favicon + title
only**; everything else is decoration at rest.

Secondary, smaller offenders: the three-clause hint line (`esc to dismiss ·
/group moves this tab · ⌘1–9 jumps between sections`) and the remote device
header's redundant `blanc on ` prefix.

## 2. Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Biggest offender | Row density |
| What the user scans by | Favicon + title only |
| Demotion depth | Hover reveal (not removal, not dimming) |
| Scope | Rows are the main event + light trim of hint line and device header |
| Mechanism | **Approach A — extend the panel's existing reserved-space/opacity reveal convention** (already used by `.row-close`, `.row-pin`, `.row-grp`). No new visual mechanism, no layout shift. Rejected: overlay reveal with gradient mask (new concept, hover jank risk); active-row-only metadata (loses same-title disambiguation). |
| Device header prefix | **Drop** `blanc on ` — header becomes `MacBook-Neo.local · 2 ——— 8h ago`; update the tab-sync spec §2 and `sync.feature` alongside |

This matches the project's standing principle (island-at-scale design §2,
"minimal ≠ hidden"): minimal means *few unfamiliar concepts*, and Approach A
adds zero new ones — it applies the row's one existing reveal pattern to more
elements.

## 3. Design

### 3.1 Row treatment (the main event)

At rest, a tab row is **favicon + title** plus rare accent-styled *state*
badges. Metadata and actions reveal together on the row's existing hover/focus
path.

- **Domain subtitle (`.row-sub`):** `opacity: 0` at rest. Revealed by
  `.island-row:hover`, `.island-row:focus-within`, and always visible on the
  `.active` row (the "you are here" row keeps its context). ~120ms opacity
  transition, added to the existing `prefers-reduced-motion` override block
  (`styles.css` ~line 969) so it's disabled there. Layout space stays
  reserved (`flex: 0 1 auto` unchanged) — no shift on hover, same convention
  as `.row-close`.
- **Shield count chip:** removed from tab rows entirely — `tabRow()`
  (`overlay.js`) stops rendering it. Not hover-revealed; gone from the list.
  The per-tab count still lives on the resting pill and the weekly count on
  the start-page ledger. The tab model (`blockedCount`) and IPC are untouched.
- **Pin glyph:** the `.row-pin.on { opacity: 1 }` at-rest rule is removed —
  pin state joins the hover/focus reveal (the button itself already reserves
  space and reveals on hover). Accepted consequence: a *grouped* pinned tab
  has no at-rest marker; it still sorts first in its group, and ungrouped
  pins remain identified by the `pinned` section header.
- **Stays at rest:** the `private` tag and the mute badge — rare state
  warnings, not metadata.
- **Remote tab rows** (tab sync) get the same treatment: host subtitle
  (`.row-sub`), the non-interactive pin marker (`.row-remote-pin`), and the
  group tag (`.row-tag`) all reveal on hover/focus instead of at rest.
- **Unchanged:** Quick Switcher result rows and slash-command rows. They are
  transient, capped at 6, and their subtitle/kind-tag/hint text is
  load-bearing while matching typed input against title + host.

### 3.2 Light trim

- **Hint line** (`islandHint`, `overlay.js`): drop the `esc to dismiss`
  clause from all three variants —
  - private: `private · nothing here is saved to history`
  - groups exist: `/group moves this tab · ⌘1–9 jumps between sections`
  - default: `⌘L summons · / for commands`

  The hint strings live only in `overlay.js`; they are not part of the
  `copy/slash-commands.json` substrate (confirm with `npm run substrate:check`
  during implementation).
- **Remote device header** (`remoteHeaderRow()`, `overlay.js`): label becomes
  the bare device name (`MacBook-Neo.local`), dropping the constant
  `blanc on ` prefix. Required companion edits:
  - `spec/acceptance/sync.feature:15` — the unfold step references
    `"blanc on MacBook Air"`; update to the bare name.
  - `docs/superpowers/specs/2026-07-21-tab-sync-design.md` §2 — the ⌘L-panel
    bullet specifies the `blanc on MacBook Air · 5 tabs · 2h ago` header;
    amend to match, citing this design.
- **Untouched:** the top row (address input + 5 actions), section headers'
  structure, the footer (launchers + four page icons).

### 3.3 Follow-on refinements (same session, user-requested)

- **Title fade instead of ellipsis.** Overflowing `.row-title`s wash out via a
  right-edge gradient mask (`mask: linear-gradient(to right, #000
  calc(100% - 28px), transparent)`, `text-overflow` back to default clip)
  leading into the hover-revealed domain. Because the title element is
  flex-grown to fill the row, the fade zone only intersects glyphs when the
  text genuinely overflows — short titles render pixel-identical. Exemption:
  Quick-Switcher group results (`.row-title.mono`) size to their text
  (`flex: 0 0 auto`), so they get `mask: none` or every group name's tail
  would fade.
- **`www.` stripped from all domains in the panel**, in all three helpers:
  `tabDomain()` (tab rows), `hostOfUrl()` (remote rows), `stripUrl()`
  (Quick-Switcher favorite/history subs). Display-only — `matchableText()`
  still matches against the raw host, so typing "www" still finds things.
  The resting pill's domain (renderer.js) is deliberately untouched.

### 3.4 What doesn't change

No behavior moves: every click target keeps its position and meaning; hover
and focus reveal exactly what they reveal today plus the domain. No main
process, preload, or IPC changes. No token value changes (`tokens/tokens.json`
untouched — only new CSS rules, no `:root` custom-property edits). The pill,
palette summoning, find capsule, and footer are all out of scope.

## 4. Error handling / accessibility

- Keyboard parity: `:focus-within` mirrors `:hover` so tabbing into a row's
  buttons reveals the same context a mouse user sees.
- Reduced motion: the new opacity transition is disabled under the existing
  `prefers-reduced-motion` block.
- The domain remains in the DOM at rest (opacity-hidden, not `display: none`),
  so row geometry and text-truncation behavior are identical to today.

## 5. Testing & verification

- **Manual (required):** chrome documents load once — kill and relaunch
  `npm start`, then verify at-rest / hovered / focused rows in light, dark,
  and private themes; confirm the active row shows its domain; confirm remote
  device section header and rows.
- `npm run test:unit` — should be unaffected (no main-process changes).
- `npm run test:acceptance:dry` — confirms the edited `sync.feature` step
  still resolves.
- Verify the F12 ad-blocking acceptance steps assert pill/model state, not
  panel-row DOM, before removing the row chip (expected: they do).
- `npm run substrate:check` — confirms no substrate drift from the hint-line
  copy change.
