# Default browser setting

**Date:** 2026-07-04
**Status:** Approved

## What

A "Default browser" row on `bowser://settings/` that registers Bowser as the system
default browser, plus the packaging and runtime plumbing that makes that meaningful.
macOS-first; Windows/Linux get the basics (registration call where the OS honors it,
URLs from argv open in tabs); the row is hidden on Linux, where Electron's
default-protocol-client API doesn't exist.

## Parts

**1. Packaging eligibility.** `build.protocols` in `package.json` claiming `http` +
`https` (role Viewer) → electron-builder emits `CFBundleURLTypes` into Info.plist, which
is what makes macOS list Bowser as a browser candidate. Packaged builds only; a dev run
must never register the bare Electron binary.

**2. Setting = live OS state.** Not persisted in settings.json — LaunchServices owns it.
Two guarded IPC handlers in `src/main/pages.js` (exposed via `bowserPages` in
`tab-preload.js`):
- `pages:defaultBrowser:get` → `{ isDefault, canSet }` — `app.isDefaultProtocolClient('http')`;
  `canSet` false when `!app.isPackaged` or on Linux.
- `pages:defaultBrowser:set` → `app.setAsDefaultProtocolClient('http')` + `('https')`,
  returns refreshed `{ isDefault, canSet }`. macOS shows its own confirmation dialog we
  can't observe, so the page re-queries on response and on window focus (user returning
  from the system dialog).

**3. URL handoff.** `app.on('open-url')` registered before `ready`; `event.preventDefault()`.
While running: open the URL as a new active tab and focus the window. During cold launch
(no window yet): queue, then flush as tabs after the window and session restore complete.
Win/Linux basic path: the existing `second-instance` handler also opens any http(s) URLs
found in `commandLine`, and startup scans `process.argv` the same way. A shared
`urlsFromArgv(argv)` helper filters strictly for `^https?://`.

## Settings UI

Row below "App icon": label "Default browser", hint "Open web links from other apps in
Bowser". States:
- Not default (packaged): button "Make default…" — ellipsis because the OS confirms.
- Default: button replaced by quiet text "Bowser is your default browser".
- Dev run: disabled button, hint "Available in the installed app".
- Linux: row removed (as the app-icon row does off-Mac).

## Error handling

- `setAsDefaultProtocolClient` returning false (or the user declining the macOS dialog)
  simply leaves the row in its "Make default…" state after re-query — no error surface.
- Malformed/exotic argv entries are ignored by the strict `^https?://` filter.
- open-url URLs are opened via the same `createTab` path as every other tab; nothing new
  to sanitize beyond what tabs already handle.

## Testing

- Driver (dev app, isolated profile): `app.emit('open-url', …)` with a URL while running
  → new active tab with that URL, window focused. Settings page shows the row with
  `canSet: false` (disabled button + dev hint).
- Packaging: `npm run dist:dir`, assert built `Info.plist` contains `CFBundleURLTypes`
  claiming http and https.
- Manual, post-release on a real install: Bowser appears in System Settings → Desktop &
  Dock → Default web browser; clicking "Make default…" raises the macOS confirmation;
  links from other apps open as Bowser tabs. Cold-start handoff (link clicked while
  Bowser closed) restores the session plus the link's tab, active.
