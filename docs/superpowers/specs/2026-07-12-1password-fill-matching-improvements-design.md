# 1Password fill — subdomain + multi-step matching improvements

**Date:** 2026-07-12
**Status:** Approved for planning
**Branch:** `feature/1password-fill` (builds on the feasibility spike)

## What

Two focused improvements to Blanc's 1Password fill so it works on more of the
user's real logins:

1. **Subdomain matching** — an item saved for `google.com` should fill on
   `accounts.google.com` (and any `*.google.com`), not only an exact-host page.
2. **Multi-step logins** — on a username-first screen (Google/Microsoft style)
   that has no password field yet, `⌥⌘P` should fill the username; the existing
   password logic already handles the second screen, so two presses complete the
   flow.

**Scope note:** this improves the **personal dev build**. It is *not* the
shippable engine and does not depend on the §4.1(e) legal reply
([`1password-legal-inquiry.md`](../../1password-legal-inquiry.md)) — that gate
governs public distribution, not local use. The code retains its `SPIKE`
framing and dev env-gating.

## Part 1 — Subdomain matching (`src/main/onepassword.js`)

Today matching is exact-host (`www.`-stripped). Change it to **registrable-domain
(eTLD+1) equality**, computed with `tldts-experimental`'s `getDomain`:

- The page's host and each stored item-URL host are each reduced to their
  registrable domain, then compared for equality.
  - `accounts.google.com` and item `google.com` → both `google.com` → **match**.
  - `www.github.com` ↔ `github.com` → `github.com` → **match** (subsumes the old
    `www.` strip).
  - `github.com.evil.com` vs `github.com` → `evil.com` ≠ `github.com` → **no
    match** (the substring/homograph trap stays closed — the public-suffix list
    handles it).
  - `foo.co.uk` → `foo.co.uk` (multi-part public suffix handled correctly, not
    reduced to `co.uk`).
- **Fallback:** `getDomain` returns `null` for hosts with no public suffix
  (`localhost`, raw IPs, single-label intranet names). When the target host's
  key is null, fall back to today's exact normalized-host equality so local/dev
  logins keep working. Concretely the match key is `getDomain(host) || host`.

**Behavior consequence (intended):** an item saved for a bare registrable
domain now fills across all of its subdomains, and a deep-subdomain item matches
the parent domain — symmetric on the registrable domain. This mirrors
1Password's default "anywhere on website" behavior and is the breadth the user
selected. More items may now match a page; the **existing multi-match chooser**
(`dialog.showMessageBox`) already covers that with no change.

**Implementation shape:**

```js
const { getDomain } = require('tldts-experimental');

// `host` is already normalized by normalizeHost (lowercased, www-stripped).
function registrableKey(host) {
  return getDomain(host) || host; // eTLD+1, or the exact host for localhost/IP/no-PSL
}

function matchesHost(itemUrls, host) {
  const targetHost = normalizeHost(host);
  if (!targetHost || !Array.isArray(itemUrls)) return false;
  const targetKey = registrableKey(targetHost);
  return itemUrls.some((u) => {
    const h = normalizeHost(u);
    return h != null && registrableKey(h) === targetKey;
  });
}
```

`normalizeHost` is unchanged (scheme-prepend for scheme-less stored values,
`URL().hostname`, `www.`-strip, lowercase, `null` on garbage).

**Dependency:** promote `tldts-experimental` to a **direct** dependency, pinned
to the version already resolved in the tree via `@ghostery/adblocker`
(currently `7.4.6`) so the same physical copy is reused (no second install) and
the `require` is owned rather than incidental.

## Part 2 — Multi-step username fill (`buildFillScript` in `onepassword.js` + one orchestrator branch in `main.js`)

Today the injected script returns `noPasswordField` and no-ops when there is no
visible password field. Change the injected function to find the password and
username fields **independently**, so a username-first screen fills the
username.

**Injected-function contract (revised):**
- First act unchanged: the synchronous identity guard
  (`location.href === EXPECTED_URL && document.hasFocus() && performance.timeOrigin === EXPECTED_TIME_ORIGIN`);
  on mismatch return `{ originMismatch: true, filledUser: false, filledPass: false }`.
- Find `pw` = first **visible** main-frame `input[type=password]` (visibility =
  `offsetParent !== null`, non-zero client rect, not `type=hidden` — unchanged).
- If `pw` and `PASS !== null`: set it via the native setter + bubbling
  `input`/`change` events → `filledPass = true`.
- Find the username field:
  - **When `pw` exists** (single-page or password step): the current anchored
    heuristic — the focused visible text/email input, else the visible
    text/email input **preceding** `pw` (in `pw.form` if any, else nearest
    preceding in document order).
  - **When `pw` does NOT exist** (username step): the standalone heuristic
    below.
- If a username field is found and `USER !== null`: set it → `filledUser = true`.
- If **neither** a password nor a username field was found: return
  `{ noFillableField: true, filledUser: false, filledPass: false }`.
- Otherwise return `{ filledUser, filledPass }`.

**Standalone username detection** (main-frame, visible elements only, first
match wins — ordered to avoid grabbing a search/newsletter box):
1. the **focused** element, if a visible text/email input;
2. an input with `autocomplete` of `username` or `email`;
3. `input[type=email]`;
4. a text/email/tel input whose `name`, `id`, or `autocomplete` matches
   `/user|email|login|account/i`;
5. else, if **exactly one** visible text/email input exists on the page, use it;
6. else no confident field → contributes nothing (never guess among multiple
   unlabeled inputs).

**Orchestrator outcome map** (`fillActiveTabFrom1Password` in `main.js`, reading
the returned status — replaces the current `noPasswordField` branch):
- `status.originMismatch` → `origin-or-focus-mismatch`
- `status.noFillableField` → `no-fillable-field`
- `filledPass && filledUser` → `filled` `user+pass`
- `filledUser && !filledPass` → `filled` `user-only (multi-step step 1)`
- `filledPass && !filledUser` → `filled` `pass-only (username field not found)`
- otherwise → `nothing-filled`

Everything else is unchanged: `revealCredential` still decrypts only the chosen
item; the fill still never submits; every window/tab/webContents/epoch/URL
re-validation guard is untouched; credentials remain main-process-only and are
never logged.

## Footprint

- **`src/main/onepassword.js`** — rewrite `matchesHost` (registrable-domain key);
  add the `tldts-experimental` require + `registrableKey` helper; extend
  `buildFillScript`'s injected function (independent field-finding + standalone
  username heuristic + revised status object).
- **`src/main/main.js`** — replace the single `noPasswordField` branch in
  `fillActiveTabFrom1Password` with the revised outcome map above (adds
  `no-fillable-field` and `filled user-only`).
- **`test/unit/onepassword-match.test.js`** — update matching cases (subdomain
  now matches; add co.uk, localhost/IP fallback) and `buildFillScript` cases
  (username-only page fills username; standalone heuristic picks email/autocomplete
  field, not a lone search box; multi-input-without-signal no-ops).
- **`package.json` / `package-lock.json`** — add pinned `tldts-experimental`.

## Non-goals (unchanged — real-engine backlog)

Shadow-DOM piercing, cross-origin iframes, auto-advance across the multi-step
navigation (deliberately stateless — the user chose per-press), TOTP, and reading
1Password's per-item `AnywhereOnWebsite`/`ExactDomain`/`Never` rules (we apply a
uniform registrable-domain match instead).

## Testing

**Unit — `test/unit/onepassword-match.test.js`** (`node --test`, pure — no
Electron/SDK):
- `matchesHost` (registrable-domain): exact still matches; `www.` both ways;
  **subdomain now matches** (`accounts.google.com` ↔ item `google.com`);
  deep-subdomain item matches parent (item `accounts.google.com` ↔ page
  `google.com`); substring trap still **fails** (`github.com.evil.com` vs
  `github.com`); **public-suffix not collapsed** — `foo.co.uk` and `bar.co.uk`
  are different registrable domains and must **not** match each other (guards
  against the naive "strip to last two labels" bug); **localhost fallback**
  (item `localhost` matches host `localhost`, exact-only) and raw-IP fallback;
  item with no URLs; malformed stored URL skipped.
- `buildFillScript` (string assertions, as today): still embeds `expectedURL`,
  `timeOrigin`, and JSON-escaped credentials; still contains the identity guard,
  visibility check, native setter; **the standalone username path is present**
  (contains the `autocomplete`/`type=email` selectors and the
  `/user|email|login|account/i` pattern); `null` username still yields a
  `null`-guarded no-fill.

**Manual** (fresh `npm start` with `BLANC_1P_ACCOUNT`):
- `accounts.google.com` with an item saved for `google.com` → username fills
  (`filled user-only`); advance to the password screen → `⌥⌘P` → password fills.
- A single-page login on a subdomain of a saved item → `filled user+pass`.
- A page with a search box but no login form → `no-fillable-field` (does not fill
  the search box).
- Regression: exact-host single-page login still `filled user+pass`; a bare-IP or
  `localhost` dev login still matches via the fallback.

## Risks / edge cases

- **Over-broad matching on shared registrable domains** — mitigated by the PSL:
  `user.github.io` → `user.github.io` (github.io is a public suffix, not
  collapsed to `github.io`), so tenants on shared hosts don't cross-match. Any
  residual over-match surfaces as an extra chooser entry, never a silent wrong
  fill.
- **`tldts-experimental` is currently transitive** — promoting it to a direct
  pinned dependency removes the risk that an adblocker bump drops/renames it.
- **Standalone username heuristic false-positive** — bounded by requiring a
  positive signal (email type / autocomplete / name-id pattern) or a single
  lone input; a page with multiple unlabeled text inputs and no signal no-ops
  rather than guessing.
