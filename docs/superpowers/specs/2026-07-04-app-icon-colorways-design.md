# App icon colorways — Appearance setting

**Date:** 2026-07-04
**Status:** Approved

## What

An "App icon" picker in the Appearance area of `bowser://settings/` offering the Bowser dog
mark in five colorways. The chosen icon is applied to the **macOS Dock** (and app switcher)
at every launch and instantly when changed. Finder/Applications keeps the shipped bundle
icon — rewriting the bundle's `.icns` would break the code-signing seal, which is exactly
the Gatekeeper failure mode the release process was hardened against. Windows/Linux
taskbar icons are out of scope.

## Colorways

Five pre-rendered 1024×1024 PNGs, generated once from the dog-mark paths in
`src/renderer/pages/icon.svg` and committed. Colors follow the Bowser Design System
icon-colorways sheet / one-green tokens:

| id | Art | Source swatch |
|----|-----|---------------|
| `default` | cream mark on dark forest green | identical art to shipped `build/icon.png` — a true no-op |
| `midnight` | dim green outline on near-black | "16 px favicon" swatch |
| `cream` | dark forest mark on cream | "24 px tab" swatch |
| `forest` | sage mark on dark charcoal-green | "48 px toolbar" swatch |
| `sage` | white knockout on sage green | "knockout" swatch |

Default is `default`, so nobody's Dock changes until they opt in.

## Architecture

**Assets** — `icon-<id>.png` ×5, flat in `src/renderer/pages/` (the `bowser://` handler
only serves flat files from that directory, and the settings page needs them as previews;
main reads the same files by path for the Dock — one set of files, two consumers). A
throwaway generation script renders them; the PNGs are committed so no runtime or build
dependency lands.

**Settings model** (`src/main/settings.js`) — `appIcon: 'default'` added to `DEFAULTS`;
`setSettings` whitelists against the five ids, same pattern as `theme`/`THEMES`.

**Apply logic** (`src/main/main.js`) — `applyAppIcon(settings)` resolves
`src/renderer/pages/icon-<id>.png` and calls `app.dock.setIcon(...)`. Guarded
macOS-only (`process.platform === 'darwin' && app.dock`); no-op elsewhere. Called once
at startup and re-invoked via `onSettingsChanged`, so the Dock updates live.

**Settings UI** (`src/renderer/pages/settings.html` / `settings.js` / `pages.css`) — an
"App icon" setting row below the theme dropdown: a swatch grid of five clickable
rounded-square previews (~56px, reusing the same PNGs), active one ring-outlined, each
labeled beneath as in the design-system sheet. Clicking saves `{ appIcon }` through the
existing `pages:settings` IPC. Styles use the existing CSS custom properties in
`pages.css` (no hard-coded inline styles). A hint line notes Finder keeps the standard
icon.

## Error handling

- Invalid/unknown `appIcon` value in `settings.json` → fails whitelist validation and the
  stored default wins; `applyAppIcon` also falls back to `default` if the id is unknown.
- Missing PNG on disk → `nativeImage` yields an empty image; skip the `setIcon` call
  rather than blanking the Dock.

## Testing

No test suite exists in this repo. Verification is manual: relaunch `npm start`
(settings page changes need no chrome reload — internal pages reload with ⌘R), click
through the five swatches, confirm the Dock icon swaps instantly and the choice persists
across relaunch.
