# iOS M4: `blanc://` Internal Pages

Milestone 4 of the iOS port roadmap. Renders the shared `blanc://` web
bundle inside `WKWebView` via a custom scheme handler plus a thin
JS↔native data bridge. New tabs open to the **newtab ledger** instead of a
hardcoded website. Builds on the M0–M3 walking skeleton (TabsManager,
TabModel, ContentView with display-only pill + palette).

Maps to **F16** (internal `blanc://` pages) and realizes the **S4 shared
web bundle** substrate on iOS. Desktop reference: `src/main/pages.js` (the
`protocol.handle('blanc', …)` scheme handler serving flat files from
`src/renderer/pages/`) and `src/main/tab-preload.js` (the `bowserPages`
bridge, guarded to `blanc://` only).

## The load-bearing idea

The internal pages are **not reimplemented natively.** The exact same
`src/renderer/pages/*` HTML/CSS/JS that ships on desktop is rendered in a
web view on iOS. Per S4, that source stays **unchanged** — the only
per-platform work is (1) a scheme handler that serves those files and (2) a
native data bridge that answers the `window.bowserPages` calls the pages
already make. This is what keeps the pages pixel-identical across platforms
for free.

## The shared bundle

The pages live at `src/renderer/pages/`, outside the `ios/` tree. They are
added to the Xcode project as a **folder reference** (a blue folder, not a
group), so the directory's contents are copied into the app bundle at build
time and edits to `pages.css`/`newtab.html`/etc. are reflected in both
platforms with no duplication. The folder is flat — HTML, `pages.css`,
`newtab.js` and the other per-page scripts, `icon.svg`, and the app-icon
PNGs all sit in one directory, matching the desktop's flat-serving
constraint.

Fonts (Inter, JetBrains Mono) are loaded live from Google Fonts via
`<link>` in each page's `<head>`, exactly as on desktop. This is a live
network dependency; offline, the pages fall back to the system font via the
CSS `font-family` chain. Bundling fonts locally would fork the shared
bundle and is deliberately **out of scope** — see Known limitations.

## Scheme handler (`BlancSchemeHandler`)

A `WKURLSchemeHandler` registered for the `blanc` scheme on the web view
configuration. It resolves a `blanc://<host>/<path>` request to a file in
the bundled pages folder, mirroring the desktop's `pages.js` security model:

1. **Known-page allowlist.** The `host` must be one of `newtab`,
   `bookmarks`, `history`, `downloads`, `settings`, `error`, `shortcuts`.
   An unknown host **fails the request cleanly** (the `WKURLSchemeTask`
   fails) — it never falls through to a file lookup. `auth` is deliberately
   excluded — the basic-auth dialog is native on iOS (M12), not a web page.
2. **Root serves the page.** A root path (`/` or empty) serves
   `<host>.html`.
3. **Basename into the flat dir.** Any deeper path is reduced to its final
   path component (the `path.basename` equivalent), validated against a
   strict `^[\w.-]+$` charset allowlist, then resolved against the one flat
   pages directory — exactly as desktop does. Traversal is defeated the
   same way it is on desktop: basename strips any `../` prefix, so the
   lookup is always confined to the flat directory and a stripped path
   resolves to a filename that either isn't a bundled asset (→ 404) or is a
   directory (→ read-as-file fails). No subdirectories.
4. **MIME by extension.** `.html`→`text/html`, `.css`→`text/css`,
   `.js`→`text/javascript`, `.svg`→`image/svg+xml`, `.png`→`image/png`.
   A missing file yields a 404-style failure.

The handler is stateless (it only reads bundled files), so a single
instance is safe to install on every tab's configuration.

## Pages bridge (`PagesBridge`)

The pages already call `window.bowserPages.<group>.<method>()` and await
promises. The bridge recreates that global on iOS, backed by
`WKScriptMessageHandler` instead of Electron IPC. **The injected global
keeps the name `bowserPages`** — it is an internal identifier the shared
bundle depends on and was deliberately not renamed in the rebrand.

Two cooperating pieces:

- **JS shim** — a `WKUserScript` injected at document-start that defines
  `window.bowserPages` with the same method shape the pages expect. Each
  method posts `{id, group, method, args}` to
  `webkit.messageHandlers.blancPages` and returns a `Promise` keyed by a
  unique request id.
- **Native handler** — a `WKScriptMessageHandler` named `blancPages` that
  receives each message, dispatches by `group`/`method`, and resolves the
  page's promise by calling back into that message's web view
  (`message.webView`) with the result keyed by request id.

The bridge is doubly guarded, matching desktop's model exactly:

- **The shim self-gates.** Running at document-start in the page's own
  context, it defines `window.bowserPages` only when
  `location.protocol === 'blanc:'` — the same check `tab-preload.js` makes
  — so ordinary web pages never even see the global.
- **The native handler re-verifies.** It independently checks the sending
  frame's URL begins with `blanc://` before acting on any message, so the
  guarantee does not rest on the client-side check alone.

An **unknown group/method rejects** the page's promise with an error rather
than hanging it, so a page that calls a method a later milestone hasn't
implemented yet fails fast.

## M4 bridge surface

The "full bridge, empty data" decision has to account for the shared
bundle's **own link graph**, not just newtab in isolation. The unchanged
newtab page has a visible `favorites` link to `blanc://bookmarks/`, and the
favorites page cross-links Settings, History, and Downloads — so a user
can reach those pages at M4 by tapping through. The reachable set is
therefore **newtab, bookmarks, history, downloads, settings**. The bridge
implements **every method those pages call**, so no reachable page becomes
an inert shell with uncaught promise rejections. Read methods return
empty/defaults; write methods are no-ops that resolve cleanly. Later
milestones replace the stub bodies with real data — they never add new
bridge plumbing.

| Group / method | M4 behavior |
|----------------|-------------|
| `appVersion()` | the app's real version string |
| `clearBrowsingData()` | no-op, resolves |
| `bookmarks.list()` | `[]` |
| `bookmarks.remove(id)` / `clearFavicon(url)` | no-op, resolves |
| `history.list({query, limit})` | `[]` |
| `history.remove(url, visitedAt)` / `clear()` | no-op, resolves |
| `downloads.list()` | `[]` |
| `downloads.cancel/open/show(id)` / `clearFinished()` | no-op, resolves |
| `settings.get()` | the generated `BlancSettings` defaults |
| `settings.set(patch)` | no-op, resolves |
| `settings.syncGet()` | `{ enabled: false }` |
| `settings.syncEnable(...)` | `{ ok: false, created: false, message, status: { enabled: false } }` |
| `settings.syncDisable(...)` | `{ status: { enabled: false } }` |
| `settings.syncNow()` | `{ enabled: false }` |
| `settings.activateSupporter(key)` | `{ ok: false, message }` |
| `permissions.list()` | `{}` (a record, **not** `[]`) |
| `permissions.remove(key)` | no-op, resolves |
| `defaultBrowser.get()` | `{ isDefault: false, canSet: false }` |
| `defaultBrowser.set()` | `{ isDefault: false, canSet: false }` |
| `start.data()` | `{ groups: [], blockedThisWeek: 0 }` |
| `start.focusGroup(id)` | no-op, resolves |
| unknown group/method | **rejects** with an error |

These shapes are exactly what `settings.js` reads back: it toggles the
sync panel on `status.enabled`, branches supporter/sync-enable on
`res.ok`/`res.created` and shows `res.message`, gates the default-browser
button on `{ isDefault, canSet }` (with both `false` it shows "Available in
the installed app"), and iterates `permissions.list()` via
`Object.entries()` — so a record, not an array. The `message` strings are a
neutral "not available in this build yet" placeholder; exact copy is a plan
detail.

Where a stub has a known milestone, that is where it becomes real:
favorites/history at **M7**, settings-lite at **M6**, downloads at
**M11**, permissions/basic-auth at **M12**, supporter at **M13**, tab
groups at **M8**, and the blocked count at **M5**.

Because favorites and groups come back empty, the newtab page renders its
full layout with the empty-state affordances it already has: the favorites
row shows its "♥ a page to pin it here" hint, the groups section stays
hidden (`!groups.length`), and the footer reads "0 ads blocked this week."
Tapping through to bookmarks/history/downloads/settings shows each page
rendering cleanly in an **empty/default** state — non-functional until its
milestone, but never an erroring shell.

Two pages are intentionally **outside** the reachable set: `shortcuts`
(nothing in the bundle links to it) and `error`/`auth` (they make no bridge
calls at all). The scheme handler still serves `shortcuts` and `error` if
navigated to directly, but `shortcuts.list()` is left to reject as an
unknown method — harmless, because nothing reaches it at M4.

## New-tab behavior

A plain new tab now opens to **`blanc://newtab/`** instead of the M0–M3
placeholder URL. The `TabsManager.createTab()` default URL changes
accordingly, and the initial tab created at launch is a newtab.

When the active tab is on the newtab page, the pill's domain display reads
a friendly **"New Tab"** rather than the raw `blanc://newtab` string —
`ContentView`'s existing domain-display logic gains a
`blanc://`-recognizing branch. (This mirrors desktop, where the newtab
page presents with no address showing.)

## Architecture

### New files

- **`ios/Blanc/Blanc/BlancSchemeHandler.swift`** — the
  `WKURLSchemeHandler`. Pure request→file resolution: allowlist, basename
  validation, MIME typing, bundle read. The path-resolution logic is
  extracted so it is unit-testable without a web view.
- **`ios/Blanc/Blanc/PagesBridge.swift`** — the JS shim string
  (`WKUserScript` source) and the `WKScriptMessageHandler`. Owns the
  method dispatch table and the empty-data stubs. Holds a weak reference to
  the `TabsManager` for the (currently no-op) `start.focusGroup` and future
  milestones.
- **`ios/Blanc/Blanc/WebViewConfiguration.swift`** — a small factory that
  builds a `WKWebViewConfiguration` with the scheme handler set for
  `blanc` and the bridge's user script + message handler installed. This
  is where the two new pieces are wired onto every tab's web view.

### Modified files

- **`TabModel.swift`** — its `WKWebView` is created from the shared
  configuration factory instead of a bare `WKWebView()`.
- **`TabsManager.swift`** — `createTab()`'s default URL becomes
  `blanc://newtab/`; the launch tab is a newtab.
- **`ContentView.swift`** — the pill's domain display recognizes
  `blanc://newtab` and shows "New Tab".
- **Xcode project** — the `src/renderer/pages/` folder reference is added
  to the app target's Copy Bundle Resources.

### Data flow

```
New tab → TabsManager.createTab() → blanc://newtab/
  → WKWebView (configured with scheme handler + bridge)
  → BlancSchemeHandler serves newtab.html + pages.css + newtab.js + icon.svg
  → newtab.js runs, calls window.bowserPages.appVersion() / bookmarks.list()
    / start.data()
      → JS shim posts {id, group, method} to blancPages
      → native handler verifies blanc:// sender, dispatches, computes result
      → handler calls back into message.webView, resolving the page's promise
  → page renders: date, "Where to?", empty favorites hint, hidden groups,
    "0 ads blocked this week", version in footer
```

## Known limitations (accepted at M4)

- **Fonts over the network.** The shared bundle links Google Fonts;
  offline the pages fall back to the system font. Local bundling is
  deferred to avoid forking the bundle.
- **Desktop keyboard copy in the shared bundle.** `newtab.js` derives its
  "go anywhere" hint from `navigator.platform` and shows "⌘L" on Mac /
  "Ctrl+L" elsewhere — so on iOS it reads "Ctrl+L to go anywhere," which is
  meaningless on touch (the pill is tapped, per **D7**). This is a D7
  input-model leak in the shared bundle, fixed when the bundle gains
  platform-awareness (a future substrate refinement), not by forking it at
  M4.
- **Reachable non-newtab pages get empty/default stubs only.** The bridge
  answers their methods with empty reads and no-op writes so they render
  cleanly, but real functionality lands in their own milestones (above).

## What is NOT in M4

- Favorites/history/downloads/settings **functionality** — those pages are
  reachable and render in an empty/default state, but their controls are
  inert (reads empty, writes no-op) until M6/M7/M11/M12.
- The weekly blocked count as a real number — M5 (ad blocking).
- Tab groups on the ledger — M8.
- Private-tab newtab variant (`?private=1`) — M9.
- Local font bundling and shared-bundle mobile-awareness — future substrate
  work.
- Any change to the `src/renderer/pages/*` source — it stays unchanged (S4).

## Tests

Unit tests in `BlancTests/` for the **scheme handler's path resolution**
(the security-critical, web-view-free logic):

- Known host + root path → serves `<host>.html`.
- Unknown host → fails cleanly (no file lookup).
- Flat asset (`pages.css`) → resolves within the flat dir.
- Path with directory components → resolves to its **basename** in the flat
  dir (`sub/pages.css` → serves `pages.css`), matching desktop's
  `path.basename`.
- Traversal attempt (`../../etc/passwd`) → basename `passwd`, not a bundled
  asset → 404 (the flat-dir confinement, not a separator check, defeats it).
- Basename failing the `^[\w.-]+$` charset check → rejected.
- Each mapped extension → correct MIME type.
- Missing file → failure response.

No unit tests for the bridge round-trip (it needs a live `WKWebView`);
it is verified on the simulator: a new tab renders the newtab ledger with
today's date, the empty-favorites hint, the "0 ads blocked this week"
footer, and the real version string — proving the scheme handler serves
the bundle and the bridge answers `appVersion()`/`bookmarks.list()`/
`start.data()`. As a second check, tapping through favorites →
bookmarks → settings/history/downloads shows each reachable page rendering
without uncaught console errors (empty/default states), confirming the
stub surface. Consistent with M0–M3 and the desktop project (no UI tests).
