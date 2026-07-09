# Google OAuth compatibility coverage

Blanc has two complementary OAuth checks. Neither enters credentials or
completes a real account login.

## Deterministic Electron contract

```bash
npm run test:oauth:desktop
```

`desktop.test.js` launches the real Electron app against two local HTTP origins
and exercises both OAuth shapes Blanc must support:

- an explicit popup window;
- a featureless, tab-style `window.open` child.

Each provider fixture redirects across origins and posts its result back to the
relying page. The test asserts that:

- `window.opener` survives at the provider and callback;
- both child styles start from trusted Electron mouse input;
- the callback reaches the relying page through `postMessage`;
- the UA omits Blanc/Electron tokens;
- `navigator.userAgentData` advertises Google Chrome with consistent
  high-entropy metadata;
- low-entropy `Sec-CH-UA` request headers advertise Google Chrome;
- Electron's unusable FedCM surface is hidden;
- `window.chrome.app`, `csi`, and `loadTimes` exist in both child styles.

This test is deterministic and runs in CI under `xvfb`.

## Live third-party canary

```bash
npm run test:oauth:live
```

The live canary launches a throwaway Blanc profile with normal ad blocking,
opens ChatGPT and Instacart, follows each visible Google-login entry point, and
passes when a rendered `accounts.google.com` sign-in/account/password page is
reached. It fails on the known `gis_transform` 400, insecure-browser rejection,
blocked-access page, missing controls, or timeout.

It deliberately stops before credential entry. It is opt-in rather than CI:
third-party labels and page structure can change independently of Blanc, and a
site redesign should produce an actionable canary failure without blocking
every pull request.

Set `BLANC_OAUTH_KEEP_PROFILE=1` to preserve the otherwise-deleted temporary
profile for debugging a failed canary.

To run only one canary while debugging:

```bash
npm run test:oauth:live -- chatgpt
npm run test:oauth:live -- instacart
```
