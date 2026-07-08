# iOS M2: Multi-Tab Support

Milestone 2 of the iOS port roadmap. Adds multi-tab create/close/switch and
tab dots in the address pill. Builds on the M0-M1 walking skeleton (single-tab
browser with `BrowserModel`, `WebView`, `ContentView`).

Maps to **F2** (tabs — deferring reopen/duplicate/pin/mute) and **F1** (tab
dots in the pill). Desktop reference: `src/main/main.js` (`tabs` Map,
`tabOrder`, `createTab`, `closeTab`, `setActiveTab`).

## Architecture: model-owned web views

Each tab creates and holds its own `WKWebView` at init time. The
`UIViewRepresentable` receives that view and displays it — it never creates
one. This matches the desktop pattern where each tab owns its
`WebContentsView` and switching tabs means removing one child view and adding
another.

The alternative (a ZStack holding all tab views simultaneously, toggling
visibility) was rejected: it keeps every tab's view in the SwiftUI tree,
wastes memory, and fights WKWebView's own rendering lifecycle.

## Data model

### TabModel

`@Observable class`. Owns one tab's state and its `WKWebView`.

| Property | Type | Notes |
|----------|------|-------|
| `id` | `UUID` | Stable identity |
| `addressText` | `String` | Bound to the address field when active |
| `currentURL` | `URL` | Last committed URL |
| `canGoBack` | `Bool` | From `WKNavigationDelegate` |
| `canGoForward` | `Bool` | From `WKNavigationDelegate` |
| `isLoading` | `Bool` | From `WKNavigationDelegate` |
| `pageTitle` | `String` | From `WKNavigationDelegate` |
| `webView` | `WKWebView` (`@ObservationIgnored`) | Created at init, owned for lifetime |

Methods: `submitAddress()`, `goBack()`, `goForward()`, `reload()`, `stop()`.

The `AddressNormalizer` is **not** per-tab — it moves to `TabsManager` (one
instance, shared). `TabModel.submitAddress()` calls through to the manager's
normalizer.

### TabsManager

`@Observable class`. Single source of truth for the tab collection.

| Property | Type | Notes |
|----------|------|-------|
| `tabs` | `[TabModel]` | Display-ordered array |
| `activeTabId` | `UUID?` | Currently visible tab |

Computed: `activeTab: TabModel?` (lookup by `activeTabId`).

Methods:

- `createTab(url: URL) -> UUID` — appends a new `TabModel`, activates it,
  returns the id. Default URL: `https://example.com` (real newtab page is M4).
- `closeTab(_ id: UUID)` — removes the tab. If it was active, activates the
  tab to its right (or left if it was rightmost). If it was the last tab,
  creates a fresh one (there is always at least one tab).
- `setActive(_ id: UUID)` — sets `activeTabId`. The `ContentView` observes
  this and swaps the displayed `WebView`.

Owns the shared `AddressNormalizer` instance.

## WebView changes

The existing `WebView` (`UIViewRepresentable`) changes from creating a
`WKWebView` to receiving one:

- `init(tab: TabModel)` — takes the tab model (which owns the web view).
- `makeUIView` returns `tab.webView` directly — no allocation.
- `makeCoordinator` wires the `WKNavigationDelegate` to write state back to
  the owning `TabModel`.
- When the active tab changes, SwiftUI sees a new `TabModel` identity, tears
  down the old representable, and builds a new one around the new tab's
  `WKWebView`.

The existing `BrowserModel` is retired — its per-tab responsibilities move to
`TabModel` and its orchestration to `TabsManager`.

## ContentView: pill tab dots

The address pill gains a row of tab dots between the back/forward buttons and
the address field:

```
[ < ] [ > ] [ . . . ● . . ] [ Search or enter address ] [ ↻ ] [ + ]
```

- Each dot represents a tab. The active tab's dot is filled; others are
  dimmed.
- Capped at **8 dots**. If more tabs exist, the last position shows `+N`
  text (e.g. `+3`).
- **Tapping** a dot switches to that tab (`TabsManager.setActive`).
- **Long-pressing** a dot closes that tab (`TabsManager.closeTab`). A brief
  haptic confirms the action.
- A `+` button at the trailing end of the pill creates a new tab
  (`TabsManager.createTab`).

`ContentView` holds `@State private var manager = TabsManager()` and passes
`manager.activeTab` to the `WebView`. The address `TextField` binds to the
active tab's `addressText`. Nav buttons call the active tab's `goBack()` /
`goForward()`.

## Close-tab behavior

Matches desktop (`closeTab` in `main.js`):

1. Closing the active tab activates the tab to its right.
2. If the closed tab was rightmost, activates the tab to its left.
3. Closing the last remaining tab creates a fresh tab (always >= 1).
4. No reopen-closed-tab (deferred per roadmap).

## What is NOT in M2

Deferred to later milestones per the roadmap:

- Reopen closed tab, duplicate tab, pin, mute (rest of F2)
- Tab groups (F3)
- Private tabs (F4)
- Session persistence of multiple tabs (F18)
- The full island chrome / command palette (F1/F6)

## Tests

Unit tests in `BlancTests/`:

- `TabsManagerTests` — create/close/switch mechanics, close-last-creates-new,
  close-active-picks-right-neighbor, close-rightmost-picks-left.
- `TabModelTests` — address submission delegates to normalizer, nav method
  calls reach the web view.

No UI tests (consistent with M0-M1 and the desktop project).
