# Blanc Browser — press fact sheet

Last updated: July 23, 2026

## The short version

**Blanc puts the browser in one small Island.** Search, tabs, named groups,
page controls, and slash commands appear when needed and leave the page alone
when they are not.

Blanc is an independent Chromium-based desktop browser from Bananify. It ships
with built-in ad and tracker blocking, private tabs, Favorites, history,
downloads, a command palette, named tab groups, optional vertical tabs, and
end-to-end-encrypted Profile Sync. It does not ship an AI assistant or an
extension runtime.

## Product facts

| Item | Fact |
|---|---|
| Product | Blanc Browser |
| Planned press candidate | 1.0.0-rc.1 — not yet built or distributed |
| Press-build platform | macOS on Apple Silicon |
| Price | Free |
| Optional purchase | Blanc Supporter, US$19 one time, plus applicable taxes; unlocks three cosmetic app-icon colorways |
| Browser engine | Chromium through Electron |
| Default search | DuckDuckGo; Google, Bing, and Brave Search are also available |
| Blocking | EasyList + EasyPrivacy through a browser-level request blocker and cosmetic filtering |
| Sync | Optional, passphrase-derived end-to-end encryption for Favorites and eligible settings (search engine, blocking state and exceptions, home page, and theme); open-tab sharing is a separate per-device opt-in |
| Publisher | Bananify |
| Release owner | Anthony Loria |
| Website | [blancbrowser.com](https://blancbrowser.com) |
| Press/support/security contact | [support@blancbrowser.com](mailto:support@blancbrowser.com) |

## What is distinct

- The **Island** replaces the permanent horizontal tab strip and conventional
  toolbar with one compact, contextual control surface.
- Tabs can remain inside the Island or appear in an optional **vertical rail**.
  The Island remains the only address, search, and command surface in either
  layout.
- Ad and tracker blocking is integrated at the browser session's network layer;
  it is not dependent on the Chrome Web Store or a user-installed extension.
- Blanc deliberately favors a small, coherent product over an AI agent,
  extension marketplace, or configurable dashboard.

## Privacy in precise terms

- On a fresh profile, **Search suggestions** and **Help improve Blanc** are
  both presented on by default. Neither may send before the user saves the
  choices; either can be turned off before continuing or later in Settings.
- Search suggestions can send eligible typed prefixes to the selected search
  provider. They are skipped for private tabs, pasted or dropped text,
  URL-like/local input, and sensitive-looking values, and can be disabled.
- The optional usage ping contains a random install ID, a random per-launch
  session ID, version, platform, and architecture. It contains no URLs,
  searches, history, or page content and can be disabled in Settings.
- Private tabs use a separate, non-persistent in-memory browser session and stay
  out of Blanc history, session restore, and reopen-closed.
- Profile Sync encrypts data on the device before upload. Open-tab sharing is
  off by default on every device, and private tabs are never included.
- When open-tab sharing is enabled, bounded source-rasterized PNG favicons may
  be uploaded in a separately encrypted sidecar; receiving devices do not
  fetch remote icon URLs merely to draw them.

## Availability note

The planned first press release candidate is deliberately limited to macOS on
Apple Silicon. Intel macOS, Windows, and Linux remain outside the 1.0
press-build matrix until their exact packages pass applicable signing and
notarization requirements plus native clean-install, launch, and same-profile
migration checks. See [known limitations](./known-limitations.md).
