# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bowser — a minimal Electron browser shell: custom-drawn chrome (tabs, toolbar, address bar) with ad/tracker blocking wired in at the network layer, independent of Chrome's extension store and Manifest V3's `declarativeNetRequest` limits. Plus bookmarks, history, downloads, settings, an explicit permission policy, and packaging config.

## Commands

```
npm install
npm start                       # run in dev (electron .)
npm run dist                    # installable build: macOS dmg/zip, Windows NSIS, Linux AppImage
npm run dist:dir                # quick unpacked build in dist/, no installer
npm run release                 # scripts/release.sh: clean, build, sign, publish to GitHub Releases
```

There is no test suite and no linter configured in this repo — don't assume `npm test` or `npm run lint` exist.

`npm run release` bumps nothing itself — bump `version` in `package.json` (and consider the `electron` devDependency, since Chromium can't be swapped out of a running app) *before* running it. It shells out to `scripts/release.sh`, which authenticates via the `gh` CLI's own cached session (no `GH_TOKEN` needed locally), builds unpublished, then uses `gh release create`/`gh release upload` directly instead of electron-builder's own GitHub publisher — that publisher races its per-artifact upload tasks against each other on first publish for a tag and can leave a release missing `latest-mac.yml` or a blockmap; shelling out to `gh` sequentially avoids that. The script is safe to re-run: if the release for the current version already exists, it fills in/overwrites assets (`--clobber`) instead of failing. It also wipes `dist/` before building so stale artifacts from earlier versions or renamed builds never linger.

**Notarization:** the build step is wrapped in `op run --env-file=.env.1password --no-masking -- ...`, pulling `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD` from the 1Password item **"Apple Notarization"** (vault Dev, `username`/`password` fields) plus a literal `APPLE_TEAM_ID` — electron-builder's `@electron/notarize` integration auto-detects those three env vars with no extra config (hardened runtime + the JIT/unsigned-memory/disable-library-validation entitlements it needs are already electron-builder's defaults). If `op` isn't installed, the script falls back to an unnotarized build with a warning instead of failing outright; if `op` *is* installed but the item can't be resolved (locked vault, wrong item name), it fails loudly rather than silently shipping unnotarized — a signed-but-unnotarized build gets quarantined and blocked by Gatekeeper the moment it's downloaded (e.g. by `electron-updater` during an auto-update), which is exactly what broke a stale pre-rebrand install after the v0.3.0 release.

First launch is slower than usual: the ad blocker fetches and compiles EasyList + EasyPrivacy, then caches the compiled engine in the app's userData directory (`adblock-engine.v<N>.bin`) so later launches are instant. Delete that file to force a refresh.

Auto-update (`electron-updater` against GitHub Releases) only runs in packaged builds — `npm start` skips it entirely. Releasing means bumping the `electron` devDependency (it tracks Chromium stable) and `version` in `package.json`, since Chromium itself can't be swapped out of a running app.

## Architecture

**One `BrowserWindow`, many `WebContentsView`s.** The window's own `webContents` renders `src/renderer/index.html`/`styles.css` — the custom chrome (tab strip, toolbar, address bar). Each tab is a separate `WebContentsView` added as a child of `win.contentView`; only the active tab's view is attached, so switching tabs is remove-one/add-another rather than destroying anything. `src/main/main.js` owns all of this: the `tabs` Map + `tabOrder` array are the single source of truth, and the renderer (`src/renderer/renderer.js`) only ever reflects `tabs:updated` broadcasts — drag-to-reorder manages DOM order locally during the gesture, then round-trips the final order through `tabs:reorder` so main stays authoritative.

**The outer chrome window only loads its HTML/CSS once, at window creation** (`win.loadFile(...)` in `createMainWindow()`). Editing `src/renderer/index.html` or `styles.css` requires relaunching the app to see the change — `Cmd/Ctrl+R` reloads the *active tab's* `WebContentsView` (which re-fetches `bowser://.../pages.css` fresh on every navigation), not the outer window's own webContents. Don't rely on a plain reload to verify a chrome-level CSS/HTML change; restart `npm start`.

**`bowser://` internal pages** (`newtab`, `bookmarks`, `history`, `downloads`, `settings`) are served by `src/main/pages.js` over a privileged custom scheme instead of `file://`, so they get a real origin and ordinary web content can never link into local files. The handler resolves every request through `path.basename()` before joining it to `PAGES_DIR` (`src/renderer/pages/`) — **it can only serve flat files directly in that one directory, no subdirectories and no `../` traversal.** Any asset (`pages.css`, `icon.svg`, a font file) that `pages/*.html` needs must live flush inside `src/renderer/pages/`.

**Security posture:** every tab's `WebContentsView` runs `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Two separate preload scripts, deliberately asymmetric:
- `src/main/preload.js` — the rich `browserAPI` bridge (tab lifecycle, window controls). Attached only to the main chrome window, which itself runs unsandboxed specifically so this preload can `require()` the extension browser-action module.
- `src/main/tab-preload.js` — the minimal `bowserPages` bridge, exposed only when `window.location.protocol === 'bowser:'` (re-checked on every navigation, so a tab that leaves an internal page loses it). The main process still independently re-verifies `event.sender.getURL()` on every `pages:*` IPC call in `pages.js` — the client-side check is not trusted alone.

**IPC channel namespaces:** `tabs:*` (main window → tab lifecycle, via `browserAPI`), `pages:*` (internal pages' guarded data API, via `bowserPages`), `window:*` (minimize/maximize/close), `chrome:*` (renderer → main layout height + focus-address-bar), `downloads:*`, `extensions:*`.

**Address bar focus** is intentionally intricate (`tabsWantingAddressBarFocus`, `reclaimAddressBarFocus()` in `main.js`) because a blank new tab needs the address bar focused rather than its empty page content, and `WebContentsView` focus can settle asynchronously after Electron's own focus/navigation callbacks — hence the reassert-on-next-tick pattern rather than a single focus call.

**Theming:** CSS custom properties in `:root` (+ a `prefers-color-scheme: dark` override), with the same token names duplicated across `styles.css` (main chrome) and `src/renderer/pages/pages.css` (internal pages) — they're separate files by necessity given the flat-serving constraint above, kept in sync by hand, not shared/imported. `nativeTheme.themeSource` is driven by Settings → Appearance, so system/light/dark propagates to chrome, internal pages, and web content together, no restart.

**CSP is declared per-file**, not centralized: `index.html` and each of the five `pages/*.html` files carry their own `<meta http-equiv="Content-Security-Policy">` tag. Adding any new external resource (a font host, a script source) means updating the CSP in every HTML file that needs it, not one shared config. Fonts currently load from Google Fonts (`fonts.googleapis.com`/`fonts.gstatic.com`) via `<link>` — a live network dependency, not bundled locally.

**Ad blocking** (`src/main/adblock.js`): a single `@ghostery/adblocker-electron` engine attached to `session.defaultSession` at startup covers every tab — request-level blocking plus cosmetic filtering (the library's own session preload reports DOM state, engine responds with `insertCSS`/`executeJavaScript`). Toggling in Settings calls `enableBlockingInSession`/`disableBlockingInSession` at runtime; blocked-request counts are per-tab and coalesced (~10 broadcasts/s) before hitting the renderer.

**Extensions** (`src/main/extensions.js`): `electron-chrome-extensions` (GPL-3.0 — fine for private use, needs a paid license before shipping proprietary builds) + `electron-chrome-web-store` gives "Add to Chrome" support and auto-updating installs. **No extensions are preinstalled.** 1Password and Dashlane used to be, but their MV3 service workers depend on `chrome.webRequest` bindings Electron's extension runtime doesn't fully provide; even with the sanitize/shim below, `electron-chrome-extensions` faults inside Chromium when the worker ultimately fails to start (V8 traced-reference use-after-free, `SIGSEGV` at `0x130`) and takes the whole app down — and they never worked here anyway (biometric unlock needs native messaging behind a browser code-signature allowlist a custom shell can't join). They're now a `BLOCKED_EXTENSIONS` blocklist instead: any copy already on disk from an older version is deleted on startup before it can load, and the store is prevented from (re)installing them. The sanitize/shim machinery still runs for any extension the user adds manually: Electron has no `chrome.webRequest` bindings for extensions at all (a manifest requesting it crash-loops the worker at the C++ level), so `sanitizeManifests()` strips the permission from installed manifests, injects a no-op shim into each extension's own service worker (classic vs. ES-module workers are patched differently, since module workers need the shim as a statically-imported first line so it runs before the extension's own polyfill snapshots `chrome.webRequest`), and rewrites unguarded `chrome.webRequest.onX.addListener(...)` call sites to optional chaining across every script in the package. Related: an unclean exit can still leave extension/service-worker profile state that crashes the next launch, so `main.js` clears those dirs on detected unclean exit (a `.running` sentinel; see the recovery block).

**Persistence** is one `JsonStore` per feature (`src/main/store.js`): a JSON file in `userData`, loaded synchronously once, saved on a 250ms debounce, no schema or migrations. `settings.json`, `bookmarks.json`, `history.json` (capped at 5000 entries), `downloads.json` (capped at 200).

**Address input normalization** (`normalizeAddressInput()` in `main.js`) is a deliberately simple regex heuristic — has-a-scheme, looks-like-localhost, looks-like-a-domain, else treat as a search query against the engine selected in Settings (DuckDuckGo/Google/Bing/Brave). It will misclassify some edge cases (e.g. paths with dots in query strings); that's a known, accepted limitation, not a bug to silently "fix" with a heavier URL parser unless asked.

**App icon:** `build/icon.png` (1024×1024) is the single source electron-builder derives `.icns`/`.ico` from automatically at package time — no per-platform icon files to maintain by hand.
