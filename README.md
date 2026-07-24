# Blanc Browser

![Blanc's Island chrome floating over github.com — tab dots, the current domain, and the ad-block counter in a single pill](docs/island-chrome.png)

A minimal Electron browser with **Island chrome**: instead of a tab strip
and toolbar, a single floating pill sits top-center over the page — tab
dots, the current site, and an ad-block counter. Click it (or hit
`Cmd/Ctrl+L`) and it expands into a command bar: address input, slash
commands, and a quick switcher across open tabs, favorites, and history.
Ad/tracker blocking is wired in at the network layer, independent of
Chrome's extension store and Manifest V3's `declarativeNetRequest` limits.
Plus favorites, history, downloads, settings, private tabs, per-site
permission prompts, session restore, and signed + notarized auto-updating
builds.

## Install

Grab the latest build from
[Releases](https://github.com/bnfy/blanc/releases/latest): macOS (dmg/zip,
arm64, signed & notarized), Windows (NSIS installer), or Linux (AppImage).
Installed copies keep themselves current via auto-update.

## Run it from source

```
npm install
npm start
```

First launch takes a moment longer than usual — the ad blocker fetches and
compiles EasyList + EasyPrivacy, then caches the compiled engine in the
app's userData directory so subsequent launches are instant. Delete the
`adblock-engine.v*.bin` file there to force a refresh. Dev runs use their
own userData profile, so they never touch an installed copy's data.

To build an installable app: `npm run dist` (or `npm run dist:dir` for a
quick unpacked build in `dist/`). Targets: macOS dmg/zip, Windows NSIS,
Linux AppImage. `build/icon.png` (1024×1024) is the app icon source;
electron-builder derives the .icns/.ico from it automatically.

## The island

**Resting pill:** one dot per open tab (accent = active, pulsing =
loading, hollow = private), the active site's favicon and domain, and the
count of ads/trackers blocked on the page. Click a dot to switch tabs
without expanding. The strip behind the pill tints itself with the page's
own top-edge color, so the chrome reads as a continuation of the site
rather than a bar above it.

**Expanded command bar** (click the pill): address input,
back/forward/reload, favorite (heart), and a tab switcher. `Cmd/Ctrl+L`
summons the same panel as a centered palette over a scrim, from anywhere.
Esc, ✕, or clicking outside dismisses. The expanded states float *over*
the page — they never push content around.

**Slash commands** — type `/` in the input:

| | |
|---|---|
| `/favorites` `/history` `/downloads` `/settings` | open internal pages |
| `/new` `/private` `/close` | tab management |
| `/find` | find in page |
| `/clear` | clear browsing history |
| `/block-ads` | toggle ad & tracker blocking |
| `/allow-ads` | allow ads on the current site |
| `/theme` | cycle appearance (system → light → dark) |

**Quick switcher + search** — type anything else and the island blends
loose local matches (tabs, favorites, history, and groups) with live
autocomplete from the search engine selected in Settings. Arrow keys move
through the six-row result list; Enter keeps the existing confident-local
match behavior, otherwise it searches the exact text you typed. Provider
suggestions can be disabled in Settings.

**Private tabs** (`/private` or `Cmd/Ctrl+Shift+N`): nothing is saved to
history, they're excluded from session restore and reopen-closed-tab, and
popups they open stay private. Cookies, storage, cache, service workers, HTTP
auth, and permission decisions live in a separate in-memory session that is
discarded when Blanc quits. The whole chrome shifts to a dedicated
green-night theme while one is active, and the pill grows a `private ✕`
chip for a quick exit.

## Auto-updates

Packaged builds self-update via `electron-updater` against GitHub
Releases. Chromium can't be swapped out of a running app — it's compiled
into Electron — so, like Chrome itself, staying current means replacing
the whole app: bump the `electron` dependency (it tracks Chromium stable)
and `version`, then `npm run release`. That builds, signs, and notarizes
the macOS artifacts locally (see `scripts/release.sh`), then dispatches
[`release-windows-linux.yml`](.github/workflows/release-windows-linux.yml)
to build the NSIS installer and AppImage on their native runners and
upload them onto the same release. The Windows build signs via Azure
Trusted Signing if configured (repo secrets `AZURE_TENANT_ID`/
`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` + repo variables
`AZURE_TRUSTED_SIGNING_ENDPOINT`/`AZURE_CODE_SIGNING_ACCOUNT_NAME`/
`AZURE_CERTIFICATE_PROFILE_NAME`/`AZURE_PUBLISHER_NAME`), else falls back
to a traditional cert via `CSC_LINK`/`CSC_KEY_PASSWORD` secrets, else
builds unsigned — unsigned (or freshly-OV-signed) installers hit a
SmartScreen "unknown publisher" warning until reputation builds up, which
Azure Trusted Signing skips. Running installs pick releases up on their
next check (startup + every
4 h, or **Check for Updates…** in the menu) and prompt to restart. Dev
builds (`npm start`) skip all of this.

## How it's put together

```
src/main/main.js         Window, per-tab WebContentsViews, island overlay, IPC, menu
src/main/adblock.js      Network + cosmetic ad blocking (@ghostery/adblocker-electron)
src/main/pages.js        blanc:// scheme for internal pages + their guarded IPC API
src/main/permissions.js  Deny-by-default permission policy + per-site prompt decisions
src/main/downloads.js    Download tracking (will-download), open/show/cancel actions
src/main/bookmarks.js    Favorites store
src/main/history.js      Visit recording + search
src/main/settings.js     Search engine / adblock / theme / home page settings
src/main/search-suggestions.js  Bounded default-engine autocomplete providers
src/main/store.js        Tiny debounced JSON-file persistence used by all of the above
src/main/context-menu.js Right-click menu for web content
src/main/auth-dialog.js  HTTP basic/digest auth prompt
src/main/updater.js      electron-updater wiring
src/main/preload.js      contextBridge API for the chrome strip + island overlay
src/main/tab-preload.js  contextBridge API for blanc:// internal pages only
src/renderer/            The chrome: strip + resting pill (index.html), island overlay (overlay.html)
src/renderer/pages/      Internal pages: newtab, favorites, history, downloads, settings
```

**One `BrowserWindow`, many `WebContentsView`s.** The window's own
`webContents` renders the chrome strip — the slim band the resting pill
floats in. Each tab is a separate `WebContentsView` added as a child view
of `win.contentView`; only the active tab's view is attached, so switching
tabs is just remove-one/add-another rather than destroying anything. The
island's expanded states live in one more `WebContentsView` — transparent,
attached on top only while open — which is how the command bar, palette,
and find capsule float over the page instead of reserving space. Tab
state lives in the main process; both chrome documents just reflect
`tabs:updated` broadcasts.

**Security posture:** the chrome strip, the overlay, and every tab run
with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
Tabs carry `tab-preload.js`, but it exposes its `bowserPages` bridge only
when the document is one of our own `blanc://` pages (re-checked on every
navigation), and the main process re-verifies the sender URL on every
`pages:*` IPC call — so ordinary web content still gets zero access to
Node, Electron internals, or browser data. The richer `browserAPI` bridge
is only ever attached to Blanc's own chrome documents.

**Permissions:** deny-by-default. Camera, microphone, geolocation, and
notifications surface a per-site Allow/Block prompt in the chrome; the
decision is remembered per origin and manageable in Settings. Everything
else (screen capture, MIDI, etc.) is refused outright; fullscreen, pointer
lock, and sanitized clipboard writes are allowed.

**Ad blocking:** `adblock.js` attaches a `@ghostery/adblocker-electron`
engine to `session.defaultSession` once at startup, covering every tab.
Request-level blocking isn't bound by MV3's rule caps; cosmetic filtering
rides on the library's session preload. Blocked requests are counted per
tab and surface as the accent badge in the pill. Toggle the engine in
Settings (or `/block-ads`); exempt individual sites per-site (`/allow-ads`,
also editable in Settings).

**Internal pages** (`blanc://newtab`, `bookmarks`, `history`,
`downloads`, `settings`) are served over a privileged custom scheme by
`pages.js` — a real origin, so web content can't link into arbitrary local
files. The user-facing name for bookmarks is **Favorites** (heart icon);
the identifiers keep the classic name.

**No Chrome extensions — by design.** The two things most people install
extensions for are covered natively: ad blocking is built in at the
network layer (above), and password managers can't integrate with a
custom browser shell anyway — they verify the browser's code signature
against vendor allowlists. (Bowser is now in Apple's allowlist source
data via
[apple/password-manager-resources#1137](https://github.com/apple/password-manager-resources/pull/1137);
meanwhile, the macOS Passwords menu-bar app works well alongside it. The
PR predates this app's rename to Blanc and refers to it by its former
name — a follow-up PR to Apple's allowlist under the new name is a
later, separate task.)
Skipping an extension runtime also keeps the whole chrome sandboxed and
the app small.

**Persistence** is deliberately boring: one JSON file per store
(`settings.json`, `bookmarks.json`, `history.json`, `downloads.json`,
`session.json`, `site-permissions.json`) in userData, written through a
shared debounced `JsonStore`. History is capped at 5000 entries, the
download log at 200. Open tabs are restored on the next launch — private
tabs excepted.

**Theming:** one green identity in two lights — bone by day, charcoal by
night, pine (deep) or sage (bright) as the accent depending on which —
plus a dedicated green-night scope for private tabs. Settings → Appearance
(System/Light/Dark) drives Electron's `nativeTheme` so the chrome,
internal pages, and web content all follow one switch, no restart.

**Address input** is normalized in `main.js` — "has a scheme," "looks
like a domain," or "treat as a search query" (engine selectable in
Settings: DuckDuckGo, Google, Bing, Brave). Search-like input also gets
best-effort autocomplete from that engine; URLs, input typed in private
tabs, pasted values, and sensitive-looking text stay local. The separate
Search suggestions toggle is device-local and can disable provider requests
entirely.

## Keyboard shortcuts

| | |
|---|---|
| `Cmd/Ctrl+T` / `Cmd/Ctrl+W` | new / close tab |
| `Cmd/Ctrl+Shift+N` | new private tab |
| `Cmd/Ctrl+Shift+T` | reopen closed tab |
| `Cmd/Ctrl+L` | search, tabs & commands |
| `Cmd/Ctrl+F` | find in page |
| `Cmd/Ctrl+R` | reload |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | next / previous tab |
| `Cmd/Ctrl+1…9` | jump to tab (9 = last) |
| `Cmd/Ctrl+D` | add to favorites |
| `Cmd+Alt+B` / `Ctrl+Shift+O` | favorites |
| `Cmd/Ctrl+Y` | history |
| `Cmd/Ctrl+Shift+J` | downloads |
| `Cmd/Ctrl+,` | settings |
| `Cmd/Ctrl` `+` / `−` / `0` | zoom in / out / reset |

## What's still left

- **Multi-window** — Blanc is deliberately single-window for now.
- **Passkeys** — WebAuthn works with security keys. On supported Macs, Blanc
  can also create and use device-bound Touch ID passkeys stored in its own
  Secure Enclave keychain group. Existing iCloud Passwords and third-party
  credential-manager passkeys still await Apple's grant of the
  `com.apple.developer.web-browser.public-key-credential` entitlement
  (requested).
## Rebrand cleanup still pending

This app was renamed from "Bowser" to Blanc — the code, package identity,
and visual assets are done, but a few infra steps are deliberately not yet
live:

- The marketing site (`site/`) is live on the Cloudflare Pages project
  `blancbrowser` (direct upload: `npm run site:deploy`, which builds the
  Astro site and uploads `site/dist`), served at the canonical domain
  `blancbrowser.com`. `getbowser.com` 301-redirects there path-for-path
  (live since 2026-07-11), so search consolidates onto the canonical domain.
- This file's still-old-name architecture references were updated, but a
  fuller pass to make sure nothing else in the repo (scripts, docs, comments)
  assumes "Bowser" would be worth a final sweep before the first real
  "Blanc" release ships.

## Known rough edges

- `normalizeAddressInput()`'s domain-detection regex is intentionally
  simple; it'll misclassify some edge cases (e.g. paths with dots in query
  strings). Known, accepted.
- Per-site ad-block exceptions cover network-level blocking; cosmetic
  element-hiding isn't scoped per-site.
- The downloads page polls while visible instead of receiving push
  updates — simple, but a push channel would be cleaner.
