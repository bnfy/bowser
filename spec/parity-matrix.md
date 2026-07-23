# Parity Matrix

The dashboard. One row per feature (`F#`), one column per platform, plus the
**parity contract** (what must be identical regardless of implementation) and any
**divergence** (`D#`) that applies.

Status values: `SHIPPED` · `PARTIAL` · `PLANNED` · `DIVERGENT (D#)` · `N/A`.
See [`README.md`](./README.md#status-legend) for meanings.

> Desktop is the reference implementation and is `SHIPPED` across the board.
> iOS/Android are greenfield — all `PLANNED` — so the live content of this table
> today is the **Parity contract** and **Divergence** columns.

| ID | Feature | Desktop | iOS | Android | Parity contract (must be identical) | Divergence |
|----|---------|---------|-----|---------|-------------------------------------|------------|
| F1 | Island chrome (pill + command bar) | SHIPPED | PARTIAL | PLANNED | Resting pill shows back/forward (desktop; mobile uses edge-swipe per D7), active group's dots (cap 8 + `+N`; pointer platforms reveal a dot's favicon on hover/focus), favicon, domain, shield count, private chip, action cluster. Expanded states: panel / palette / find. | D7, D11, D15 |
| F2 | Tabs (create/close/switch/reopen/duplicate/pin/mute) | SHIPPED | PARTIAL | PLANNED | Same lifecycle + same reopen-closed and pin/mute semantics. Pins remain in their current group and lead it; ungrouped pins use a standalone shelf. Plain new tab is always ungrouped. | D8 |
| F3 | Tab groups | SHIPPED | PLANNED | PLANNED | Names not colors (lowercase mono). Group exists only while non-empty. Pill renders only the active group, including its pins. Same create/move/ungroup/close-group actions. | — |
| F4 | Private tabs | SHIPPED | PLANNED | PLANNED | Never in history/session/reopen; inherited by child tabs; isolated non-persistent web session; private theme + quick-exit chip. | — |
| F5 | Address input & search | SHIPPED | PARTIAL | PLANNED | Same normalization heuristic + engine choice (DuckDuckGo/Google/Bing/Brave). OS hand-off for `mailto:`/`tel:`/etc. | D4 |
| F6 | Command palette & Quick Switcher | SHIPPED | PARTIAL | PLANNED | ⌘L-equivalent summons it; loose/in-order match across tabs, favorites, history, group names; groups ranked above tabs. | D7 |
| F7 | Slash commands | SHIPPED | PARTIAL | PLANNED | The full command set (see F7 in features.md) with identical names + hints. | D7 |
| F8 | Find in page | SHIPPED | PLANNED | PLANNED | Capsule over content, match nav, page stays interactive. | — |
| F9 | Favorites | SHIPPED | PLANNED | PLANNED | Heart toggle, "Add all open tabs", favorites page + newtab favorites. Internal id stays `bookmarks`. | — |
| F10 | History | SHIPPED | PLANNED | PLANNED | Per-visit record + title update, capped 5000, clearable, excluded for private tabs. | — |
| F11 | Downloads | SHIPPED | PLANNED | PLANNED | Downloads list UI + progress, capped 200. | D3 |
| F12 | Ad/tracker blocking | SHIPPED | PARTIAL | PLANNED | Ads/trackers blocked by default; per-tab shield count; per-site allow; global toggle. Filter data shared. | D1, D2, D13, D14 |
| F13 | Permissions | SHIPPED | PLANNED | PLANNED | Explicit per-permission prompts with the same policy/copy. | — |
| F14 | Settings | SHIPPED | PARTIAL | PLANNED | Same keys, defaults, validation (search engine, adblock, home page, theme, app icon, exceptions, usage ping, supporter). | D5, D6 |
| F15 | Theming | SHIPPED | SHIPPED | PLANNED | system/light/dark + private scope; propagates to chrome, internal pages, web content live, no restart. | — |
| F16 | Internal `blanc://` pages | SHIPPED | PARTIAL | PLANNED | newtab ledger, favorites, history, downloads, settings, shortcuts, error, auth — same content/copy; utility pages present as a transient chrome surface (desktop: sheet), never tabs. | — |
| F17 | Supporter & app icons | SHIPPED | PLANNED | PLANNED | 8 free + 3 supporter colorways; supporter unlock is trusted-forever, offline-OK, cosmetic-only. | D5, D6 |
| F18 | Session persistence & restore | SHIPPED | PARTIAL | PLANNED | Restore tabs + groups; private tabs excluded; same `session.json` shape (adapted per platform store). | D8 |
| F19 | Context menu (link/page actions) | SHIPPED | PLANNED | PLANNED | Same actions (open in new/background tab, copy link, etc.); OS hand-off honored. | D4, D7 |
| F20 | Basic-auth dialog | SHIPPED | PLANNED | PLANNED | Same modal auth prompt behaviour. | — |
| F21 | Telemetry (usage ping) | SHIPPED | PLANNED | PLANNED | Opt-in, off by default, packaged-only, anonymous `{version,platform,arch}`, fire-and-forget. | — |
| F22 | Distribution & updates | SHIPPED | N/A | N/A | User gets updates; no in-app updater fighting the OS store. | D9 |
| F23 | Zoom / page scaling | SHIPPED | DIVERGENT (D10) | DIVERGENT (D10) | Page can be scaled; desktop discrete zoom vs mobile pinch/native reflow. | D10 |
| F24 | Password AutoFill / passkeys | N/A | PLANNED | PLANNED | On mobile, native credential provider + platform passkeys work in-webview. | D12 |
| F27 | Tab Sync (other-device tab list) | SHIPPED | PLANNED | PLANNED | Per-device opt-in, off by default, publish-only gating; read-only browsing in panel/switcher/start page; http(s)-only bounded snapshots; retraction + 30-day prune + 24 h heartbeat; rides the E2EE sync store. | — |

## Notes on the "mobile-only wins"

Two rows invert the usual desktop-leads pattern:

- **F24 (AutoFill/passkeys)** is `N/A` on desktop (blocked by vendor code-signature
  allowlists — see `CLAUDE.md`) but achievable on mobile via the system credential
  provider inside `WKWebView`/Android `WebView`. This is a feature mobile *gains*.
- **F12 blocking** is the differentiator that is *strongest on Android* (programmatic
  interception, like desktop) and *weakest on iOS* (declarative, capped). Keep the
  Android backend powerful; do not flatten it to the iOS ceiling for symmetry — see
  D1.
