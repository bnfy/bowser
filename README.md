# Browser Starter

A minimal Electron browser: custom-drawn chrome (tabs, toolbar, address
bar) with ad/tracker blocking wired in at the network layer, independent of
Chrome's extension store and Manifest V3's `declarativeNetRequest` limits.
Now with bookmarks, history, downloads, settings, an explicit permission
policy, and packaging config.

## Run it

```
npm install
npm start
```

First launch takes a moment longer than usual — the ad blocker fetches and
compiles EasyList + EasyPrivacy, then caches the compiled engine in the
app's userData directory so subsequent launches are instant. Delete the
`adblock-engine.v*.bin` file there to force a refresh.

To build an installable app: `npm run dist` (or `npm run dist:dir` for a
quick unpacked build in `dist/`). Targets: macOS dmg/zip, Windows NSIS,
Linux AppImage. No custom icon is set yet, so builds use the stock
Electron icon.

## Auto-updates

Packaged builds self-update via `electron-updater` against GitHub
Releases (`build.publish` in package.json). Chromium can't be swapped out
of a running app — it's compiled into Electron — so, like Chrome itself,
staying current means replacing the whole app: bump the `electron`
dependency (Electron tracks Chromium stable closely), bump `version`, then

```
GH_TOKEN=<github token> npm run release
```

builds, signs, and publishes a release; running installs pick it up on
their next check (startup + every 4 h, or **Check for Updates…** in the
menu) and prompt to restart. Dev builds (`npm start`) skip all of this.
macOS auto-update requires the app to be code-signed (it is, via your
Developer ID); notarization is additionally needed for first installs on
other Macs.

## How it's put together

```
src/main/main.js         Window + per-tab WebContentsView lifecycle, IPC, menu/shortcuts
src/main/adblock.js      Network + cosmetic ad blocking (@ghostery/adblocker-electron)
src/main/extensions.js   Chrome extension support (electron-chrome-extensions + web store)
src/main/pages.js        bowser:// scheme for internal pages + their guarded IPC API
src/main/permissions.js  Explicit deny-by-default permission policy for web content
src/main/downloads.js    Download tracking (will-download), open/show/cancel actions
src/main/bookmarks.js    Bookmark store
src/main/history.js      Visit recording + search
src/main/settings.js     Search engine / adblock toggle / new-tab page settings
src/main/store.js        Tiny debounced JSON-file persistence used by all of the above
src/main/preload.js      contextBridge API for the chrome UI (main window only)
src/main/tab-preload.js  contextBridge API for bowser:// internal pages only
src/renderer/            The custom chrome (tab strip, toolbar, address bar)
src/renderer/pages/      Internal pages: newtab, bookmarks, history, downloads, settings
```

**One `BrowserWindow`, many `WebContentsView`s.** The window's own
`webContents` renders `src/renderer/index.html` — that's the custom chrome
you see. Each tab is a separate `WebContentsView` added as a child view of
`win.contentView`; only the active tab's view is attached, so switching tabs
is just remove-one/add-another rather than destroying anything. The
renderer measures its own height via `ResizeObserver` and reports it over
IPC (`chrome:layout`) so the main process knows exactly where to position
the active view — no hardcoded pixel value shared between the two processes.
Tab order lives in the main process (`tabOrder`); the strip supports
drag-to-reorder, which round-trips through `tabs:reorder` so main stays
authoritative.

**Security posture:** every `WebContentsView` runs with
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
Tabs carry `tab-preload.js`, but it exposes its `bowserPages` bridge only
when the document is one of our own `bowser://` pages (re-checked on every
navigation), and the main process re-verifies the sender URL on every
`pages:*` IPC call — so ordinary web content still gets zero access to
Node, Electron internals, or browser data. The richer `browserAPI` bridge
in `preload.js` is only ever attached to the main window's own chrome UI.

**Permissions:** `permissions.js` sets an explicit deny-by-default policy —
camera, microphone, geolocation, notifications, screen capture, etc. are
all refused; only fullscreen, pointer lock, and sanitized clipboard writes
are allowed. Loosening this per-site would need a prompt UI (not built yet).

**Ad blocking:** `adblock.js` attaches a `@ghostery/adblocker-electron`
engine to `session.defaultSession` once at startup, covering every tab.
Request-level blocking isn't bound by MV3's rule caps; cosmetic filtering
(hiding leftover ad *elements*) rides on the library's session preload,
which reports DOM state and gets `insertCSS`/`executeJavaScript` responses.
Blocked requests are counted per tab (`request-blocked` → webContents id)
and surface as the brass badge at the right end of the address bar. The
whole engine can be toggled off in Settings.

**Internal pages** (`bowser://newtab`, `bookmarks`, `history`, `downloads`,
`settings`) are served over a privileged custom scheme by `pages.js` from
`src/renderer/pages/` — a real origin, so web content can't link into
arbitrary local files. They talk to their stores through the guarded
`bowserPages` bridge described above. Toolbar buttons, menu items, and the
new-tab page all link to them.

**Chrome extensions** run through
[`electron-chrome-extensions`](https://github.com/samuelmaddock/electron-browser-shell)
(note: GPL-3.0 — fine for private use, needs a paid license to ship
proprietary builds) plus `electron-chrome-web-store`, so "Add to Chrome"
works on chromewebstore.google.com and installed extensions auto-update.
Toolbar icons/popups render via the `<browser-action-list>` element in the
chrome UI (which is why the chrome window runs unsandboxed — it never
loads web content). Dashlane and 1Password are preinstalled on first run.
`extensions.js` also sanitizes installed extensions: Electron has no
`chrome.webRequest` for extensions (a manifest requesting it crash-loops
the worker at the C++ level), so the permission is stripped and a no-op
shim is injected into the extension's service worker.

Extension status: **Dashlane works** (sign in inside the extension —
desktop-app/biometric unlock is impossible for any custom browser, since
native messaging verifies browser code signatures against an allowlist).
**1Password does not work yet**: its background worker is an ES-module
service worker, which Electron can't attach preload scripts to, so the
extension-API layer never reaches it — tracked upstream in
[electron#49984](https://github.com/electron/electron/issues/49984) and
[electron-browser-shell#172](https://github.com/samuelmaddock/electron-browser-shell/issues/172).

**Persistence** is deliberately boring: one JSON file per store
(`settings.json`, `bookmarks.json`, `history.json`, `downloads.json`) in
userData, written through a shared debounced `JsonStore` and flushed on
quit. History is capped at 5000 entries, the download log at 200.

**Theming:** one warm graphite/brass identity in two lights. Light is the
default palette; dark is a `prefers-color-scheme` override, and Settings →
Appearance (System/Light/Dark) drives Electron's `nativeTheme` so the
chrome, internal pages, and web content all follow one switch — no restart.

**Address bar:** typed input is normalized in `main.js` —
`normalizeAddressInput()` decides between "has a scheme," "looks like a
domain," and "treat as a search query" (engine selectable in Settings:
DuckDuckGo, Google, Bing, Brave).

## Keyboard shortcuts

| | |
|---|---|
| `Cmd/Ctrl+T` / `Cmd/Ctrl+W` | new / close tab |
| `Cmd/Ctrl+L` | focus address bar |
| `Cmd/Ctrl+R` | reload |
| `Cmd/Ctrl+D` | bookmark this page |
| `Cmd+Alt+B` / `Ctrl+Shift+O` | bookmarks |
| `Cmd/Ctrl+Y` | history |
| `Cmd/Ctrl+Shift+J` | downloads |
| `Cmd/Ctrl+,` | settings |

## What's still left

- **1Password extension** — blocked on Electron supporting preloads for
  ES-module extension service workers (see links above). Re-test after
  Electron upgrades; the install/sanitize plumbing is already in place.
- **Per-site permission prompts** — the policy is a global allow/deny
  table; granting a specific site camera access needs a prompt UI.
- **Address bar suggestions** from history/bookmarks while typing.
- **Find in page**, error pages for failed loads, and a context menu.
- **App icon** for packaged builds.
- **Session restore** — tabs don't survive a restart.

## Known rough edges

- Menu accelerators are wired through a minimal
  `Menu.setApplicationMenu()` — needed on macOS for copy/paste to work in
  the address bar at all, since a frameless window has no default Edit
  menu otherwise.
- `normalizeAddressInput()`'s domain-detection regex is intentionally
  simple; it'll misclassify some edge cases (e.g. paths with dots in query
  strings). Fine for a starter, worth hardening later.
- The downloads page polls (750 ms) while visible instead of receiving
  push updates — simple, but a push channel would be cleaner.
