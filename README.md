# Bowser

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

Grab the latest signed and notarized build from
[Releases](https://github.com/bnfy/bowser/releases/latest) (macOS dmg/zip,
arm64). Installed copies keep themselves current via auto-update.

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
| `/adblock` | toggle ad & tracker blocking |
| `/off-leash` | allow ads on the current site |
| `/theme` | cycle appearance (system → light → dark) |

**Quick switcher** — type anything else and it matches loosely (substring
or in-order characters, so `hnews` finds "Hacker News") across open tabs,
favorites, and history; Enter jumps to the top result, and no match falls
through to a normal navigate/search.

**Private tabs** (`/private` or `Cmd/Ctrl+Shift+N`): nothing is saved to
history, they're excluded from session restore and reopen-closed-tab, and
popups they open stay private. The whole chrome shifts to a dedicated
green-night theme while one is active, and the pill grows a `private ✕`
chip — click it to close the tab and end the trail.

## Auto-updates

Packaged builds self-update via `electron-updater` against GitHub
Releases. Chromium can't be swapped out of a running app — it's compiled
into Electron — so, like Chrome itself, staying current means replacing
the whole app: bump the `electron` dependency (it tracks Chromium stable)
and `version`, then `npm run release` builds, signs, notarizes, and
publishes (see `scripts/release.sh`). Running installs pick releases up on
their next check (startup + every 4 h, or **Check for Updates…** in the
menu) and prompt to restart. Dev builds (`npm start`) skip all of this.

## How it's put together

```
src/main/main.js         Window, per-tab WebContentsViews, island overlay, IPC, menu
src/main/adblock.js      Network + cosmetic ad blocking (@ghostery/adblocker-electron)
src/main/pages.js        bowser:// scheme for internal pages + their guarded IPC API
src/main/permissions.js  Deny-by-default permission policy + per-site prompt decisions
src/main/downloads.js    Download tracking (will-download), open/show/cancel actions
src/main/bookmarks.js    Favorites store
src/main/history.js      Visit recording + search
src/main/settings.js     Search engine / adblock / theme / home page settings
src/main/store.js        Tiny debounced JSON-file persistence used by all of the above
src/main/context-menu.js Right-click menu for web content
src/main/auth-dialog.js  HTTP basic/digest auth prompt
src/main/updater.js      electron-updater wiring
src/main/preload.js      contextBridge API for the chrome strip + island overlay
src/main/tab-preload.js  contextBridge API for bowser:// internal pages only
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
when the document is one of our own `bowser://` pages (re-checked on every
navigation), and the main process re-verifies the sender URL on every
`pages:*` IPC call — so ordinary web content still gets zero access to
Node, Electron internals, or browser data. The richer `browserAPI` bridge
is only ever attached to Bowser's own chrome documents.

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
Settings (or `/adblock`); exempt individual sites per-site (`/off-leash`,
also editable in Settings).

**Internal pages** (`bowser://newtab`, `bookmarks`, `history`,
`downloads`, `settings`) are served over a privileged custom scheme by
`pages.js` — a real origin, so web content can't link into arbitrary local
files. The user-facing name for bookmarks is **Favorites** (heart icon);
the identifiers keep the classic name.

**No Chrome extensions.** Bowser used to embed
[`electron-chrome-extensions`](https://github.com/samuelmaddock/electron-browser-shell)
+ `electron-chrome-web-store` for "Add to Chrome" support. It was removed:
the extension runtime was the app's main source of hard crashes (MV3
service workers tripping missing `chrome.webRequest` bindings, faulting
inside Chromium), and the one thing it was kept for — password managers —
can't work in *any* custom browser shell: both Apple's iCloud Passwords
helper and 1Password's native messaging verify the browser's code
signature against an OS/vendor allowlist. (Bowser has since been added to
Apple's allowlist source data —
[apple/password-manager-resources#1137](https://github.com/apple/password-manager-resources/pull/1137)
— which takes effect if Apple ships it in a macOS update.) Ad blocking,
the other big extension use case, is built in at the network layer
instead. Removing the runtime also let the chrome run fully sandboxed and
dropped a GPL-3.0 licensing constraint. For passwords, use the macOS
Passwords app's menu-bar quick access alongside Bowser.

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
Settings: DuckDuckGo, Google, Bing, Brave).

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

- **Multi-window** — Bowser is deliberately single-window for now.
- **Passkeys** — WebAuthn works for security keys; platform passkeys via
  Apple Passwords await Apple's grant of the
  `com.apple.developer.web-browser.public-key-credential` entitlement
  (requested).
- **Inline address autocomplete** — the quick switcher covers search
  across tabs/favorites/history, but the input doesn't complete as you
  type.

## Known rough edges

- `normalizeAddressInput()`'s domain-detection regex is intentionally
  simple; it'll misclassify some edge cases (e.g. paths with dots in query
  strings). Known, accepted.
- Per-site ad-block exceptions cover network-level blocking; cosmetic
  element-hiding isn't scoped per-site.
- The downloads page polls while visible instead of receiving push
  updates — simple, but a push channel would be cleaner.
