# Desktop acceptance harness

Binds the shared, platform-neutral scenarios in [`spec/acceptance/`](../../spec/acceptance/)
to the **desktop (Electron)** implementation, so they execute against the real
app. This is the "desktop step definitions" track referred to in
`spec/acceptance/README.md` — the same `.feature` files will get iOS and Android
bindings later; only the step definitions here are desktop-specific.

## How it works

- **Driver:** [Playwright's Electron support](https://playwright.dev/docs/api/class-electron)
  (`_electron.launch`) starts the packaged app once per run.
- **Bridge:** a tiny, env-guarded main-process surface (`src/main/test-hook.js`,
  installed only when `BLANC_TEST=1`) exposes real state readers and actions on
  `globalThis.__blanc`. Steps call into it via `electronApp.evaluate()`, which
  runs in the Electron **main process** — so the scenarios drive the actual
  `tabs`/`groups` state and the real settings/history/bookmarks stores, not a
  reimplementation.
- **Offline & isolated:** `BLANC_TEST` also skips the network ad-engine build so
  the app launches with no internet, and each run uses a throwaway
  `--user-data-dir` so no prior session/history/settings leaks in. Tab URLs load
  from a local fixtures server (`support/fixtures-server.js`).
- **Async settling:** a `WebContentsView`'s URL isn't final until its navigation
  commits, so assertions that depend on it poll via `world.waitForState()`.

Layout:
```
test/desktop/
  cucumber.mjs            profiles (runnable / dry / default)
  support/
    world.js             the `this` in steps: call()/state()/waitForState()/fixtureUrl()
    hooks.js             launch app + fixtures (BeforeAll), reset (Before), teardown
    fixtures-server.js   local pages so tab URLs load offline
    context.js           state shared across hooks/world/steps
  steps/
    runnable.steps.js    the implemented step definitions
```

## Running

```bash
npm install                          # installs cucumber + playwright (+ electron)

npm run test:acceptance:dry          # dry-run: verify every runnable step resolves
                                     # (no Electron/display needed)

npm run test:acceptance:desktop      # execute the runnable scenarios against the app
xvfb-run -a npm run test:acceptance:desktop   # ...on a headless Linux/CI box
```

The desktop script is plain `cucumber-js` so it works on a dev machine with a
display (macOS); prefix `xvfb-run -a` on headless Linux.

Google OAuth browser-compatibility coverage is intentionally separate from the
cross-platform product scenarios here. See [`test/oauth/`](../oauth/README.md)
for the deterministic Electron contract and opt-in live-site canary.

## What's implemented vs. backlog

The **`runnable`** profile is the subset wired to real assertions today — the
scenarios drivable purely through main-process state or pure app logic:

| Implemented (23 rows) | |
|---|---|
| F2-1..F2-4 | tab reopen / duplicate / pin-order / new-tab-ungrouped |
| F3-1, F3-4 | group create+move / prune-on-empty |
| F5-1, F5-2, F5-3 | address normalization / search routing (4 engines) / OS hand-off |
| F7-2 | slash-command effects (/new, /downloads, /find) |
| F9-1, F9-2 | favorite active page / add-all-tabs |
| F10-2 | clear history |
| F12-3 | ad-block global toggle |
| F14-1..F14-3 | settings validation (engine / supporter-icon fallback / exception normalization) |
| F17-1 | supporter unlock → app icon applied |

Run `npm run test:acceptance:dry` — **23 scenarios, 79 steps, 0 undefined**
(Scenario Outlines expand per example: F5-2 → 4 rows, F7-2 → 3).

The **`default`** profile (`not @mobile`) selects the whole desktop-applicable
set — **51 scenarios** (Scenario Outlines expand per example). The other **28 are
backlog**: they report as `undefined` until their step definitions are written.
They fall into three groups, by what they additionally need:

1. **Overlay / WebContentsView DOM automation** — the command palette, Quick
   Switcher, find-in-page, internal-page and theming assertions read the overlay
   or tab web contents, which aren't the main `BrowserWindow` page. Needs a
   Playwright page handle for those views (or added `__blanc` readers).
2. **Real navigation / external fixtures** — address-bar search routing, history
   recording on visit, downloads, permissions, basic-auth. Extend the fixtures
   server (search stubs, a basic-auth route, a downloadable file) and drive real
   navigations.
3. **OS-level behaviour** — OS URI hand-off, telemetry ping capture, the desktop
   updater. Need process/network mocking.

### Deliberate proxies

Two places assert a level below the literal step text, because it's the reliable,
offline-verifiable signal. Both tighten once the DOM-automation backlog lands.

- **Favorites** — *"X appears on the favorites page"* checks the **store the page
  renders from** (`bookmarks.listBookmarks()`), not the rendered DOM.
- **Address routing (F5)** — *"the active tab navigates to …"* checks the app's
  **routing decision** (`normalizeAddressInput` / the hand-off predicate), not an
  actual external navigation, which can't complete offline. The heuristic is the
  substantive, deterministic part.

## Verification status

- ✅ **Dry-run green** (`-p dry`, exit 0): the harness code loads (Playwright +
  Cucumber import cleanly) and every step in the runnable set resolves to exactly
  one definition — the suite is fully wired.
- ⏸️ **Live execution** requires the Electron binary. In some sandboxes the
  binary download is blocked (GitHub release assets 403 through a proxy), so the
  live run can't be exercised there; it runs on any machine/CI where
  `npm install` fetches Electron. `xvfb` is only needed for headless Linux.
