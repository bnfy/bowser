# Blanc 1.0 — five-minute reviewer guide

This guide applies to Blanc 1.0.0-rc.1 for Apple Silicon. Distribute it only
after that exact candidate has been signed, notarized, stapled, hashed, and
published. For the product's explicit boundaries, read
[known limitations](./known-limitations.md).

## Before opening Blanc

1. Download `Blanc-1.0.0-rc.1-arm64.dmg` and `SHA256SUMS` from the unlisted
   reviewer page.
2. Verify the DMG hash against the checksum file.
3. Drag Blanc to Applications and launch it normally. The build should open
   without a Gatekeeper bypass.

## Minute 1 — first launch

The local Blanc chrome should appear even while its blocker prepares. On a
fresh profile, review the compact privacy card before continuing:

- live search suggestions may send eligible typed prefixes to the search
  provider you select;
- the launch-usage ping contains only the documented install/session/version/
  platform/architecture fields.

Neither path should send before the choices are committed. If filter
initialization fails, Blanc presents **Retry** and **Continue without blocking**
instead of hanging or silently weakening protection.

Both controls start enabled; either can be turned off before continuing.

## Minute 2 — the Island

Open two or three ordinary sites. The top of the window has no horizontal tab
strip or conventional toolbar. The resting Island shows the active context;
click it or press **Command-L** to expand search, tabs, local matches, and
commands over the page.

Try:

- typing part of an open tab's title to switch locally;
- typing `/` to see commands;
- `/group review` to name the current tab's group;
- `/private` to open a private tab;
- `/find` to open the compact find capsule.

## Minute 3 — optional vertical tabs

Choose **View → Tab Layout → Vertical Tabs**, or use Settings → General → Tab
layout. The Island remains centered over the page pane and remains the only
address/search/command surface. The left rail should preserve existing tabs,
pins, named groups, private state, loading/audio state, and ordering without
reloading the active page.

Exercise the rail:

- switch and close a tab;
- middle-click a row to close it;
- fold and unfold a named group;
- drag a tab within the same pinned/group bucket;
- use Arrow keys, Home/End, and Enter/Space on focused rows;
- use the rail's Island-layout control to return.

## Minute 4 — blocking and private state

Visit an ad-supported page. If Blanc blocks requests, the shield count shows
how many. Use `/allow-ads` if you want to confirm the per-site exception path.
The count is a request count, not a guarantee that every ad or tracking method
was removed.

In a private tab, look for the dashed/hollow treatment and explicit `private`
chip. Private tabs use a separate in-memory session and do not enter Blanc
history, session restore, or reopen-closed. Closing the chip is the quick exit.

## Minute 5 — the utility sheet and restraint

Open Favorites, History, Downloads, Settings, or Shortcuts. These utilities
appear as a temporary sheet over the current page rather than consuming tabs.
Dismiss with Escape or the scrim.

That interaction is the product thesis in miniature: browser tools should be
present when requested and absent when the page is the task.

## Useful shortcuts

| Action | Shortcut |
|---|---|
| Search, switch, or command | Command-L |
| New tab | Command-T |
| New private tab | Command-Shift-N |
| Close tab | Command-W |
| Reopen closed tab | Command-Shift-T |
| Find in page | Command-F |
| Settings | Command-, |

## Feedback

Please include the RC version, macOS version, Mac model, exact steps, expected
result, and observed result. Send product, press, and private security feedback
to [support@blancbrowser.com](mailto:support@blancbrowser.com); put
**Security** in the subject for vulnerabilities.
