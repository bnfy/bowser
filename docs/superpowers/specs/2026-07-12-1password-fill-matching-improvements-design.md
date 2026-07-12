# 1Password fill — subdomain + multi-step matching improvements

**Date:** 2026-07-12
**Status:** Approved for planning (rev. 3 — after two security-review rounds)
**Branch:** `feature/1password-fill` (builds on the feasibility spike)

## What

Two improvements to Blanc's 1Password fill so it works on more real logins:

1. **Subdomain matching** — an item saved for `google.com` fills on
   `accounts.google.com` (any `*.google.com`), not only an exact-host page.
2. **Multi-step logins** — on a username-first screen with no password field yet,
   `⌥⌘P` fills the username; the second press on the password screen fills the
   password. Stateless — no credential is held across the navigation.

**Scope note:** improves the **personal dev build**, not the shippable engine;
does not depend on the §4.1(e) legal reply
([`1password-legal-inquiry.md`](../../1password-legal-inquiry.md)), which gates
public distribution, not local use. Retains `SPIKE` framing and dev env-gating.
This revision pulls **isolated-world injection** forward from the real-engine
backlog because the two-phase design below only delivers its security value there.

## Part 1 — Subdomain matching (`src/main/onepassword.js`)

Match on **registrable domain (eTLD+1)** via `tldts-experimental`'s `getDomain`
**with `allowPrivateDomains: true`**:

- Each host (page + each stored item URL) reduces to its registrable domain;
  compare for equality.
  - `accounts.google.com` ↔ item `google.com` → both `google.com` → **match**.
  - `www.github.com` ↔ `github.com` → **match** (subsumes the `www.` strip).
  - `github.com.evil.com` vs `github.com` → `evil.com` ≠ `github.com` → **no match**.
- **`allowPrivateDomains: true` is required.** With the default, `getDomain`
  collapses PSL *private* suffixes — `user.github.io` → `github.io` — so
  `alice.github.io` and `bob.github.io` both become `github.io` and
  **cross-match** (`github.io`, `vercel.app`, `pages.dev`, `herokuapp.com`,
  `appspot.com`, …). With the flag, `user.github.io` → `user.github.io`. Verified
  against the pinned `tldts-experimental@7.4.6`; the flag doesn't change ICANN
  cases (`google.com`, `co.uk`, the `evil.com` trap).
- **Fallback:** `getDomain` returns `null` for hosts with no suffix (`localhost`,
  raw IPs, single-label intranet names) — fall back to exact normalized-host
  equality. Match key: `getDomain(host, { allowPrivateDomains: true }) || host`.

**Behavior (intended):** an item for a bare registrable domain fills across all
its subdomains, symmetric — 1Password's default "anywhere on website" breadth.
The multi-match chooser covers several matches; it does **not** mitigate a single
wrong match, so the PSL flag is load-bearing.

```js
const { getDomain } = require('tldts-experimental');

// `host` is already normalized by normalizeHost (lowercased, www-stripped).
function registrableKey(host) {
  return getDomain(host, { allowPrivateDomains: true }) || host;
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

`normalizeHost` unchanged. **Dependency:** promote `tldts-experimental` to a
**direct** dependency, pinned to the tree's resolved `7.4.6` (same physical copy).

## Part 2 — Multi-step fill: two-phase, isolated-world, least-privilege

The fill runs in **two isolated-world injections** so (a) the password is only
sent to the renderer when a password field exists, and (b) the credential and the
selection/setter logic live in a JS realm the page cannot hook or scrape.

**Isolated world.** Both injections use
`wc.executeJavaScriptInIsolatedWorld(FILL_WORLD_ID, [{ code }])` with a dedicated
constant world id (distinct from the main world `0`), not `executeJavaScript`.
The page's main-world JS cannot observe or tamper the isolated realm's
intrinsics (`Object.getOwnPropertyDescriptor`, the `HTMLInputElement` value
setter) or read the embedded credential.

**Accurate guarantee (not overclaimed).** Isolation protects the credential and
the decision/setter logic **up to the intended DOM write**. Once Blanc writes the
value into the field, the page can read that field — inherent to *every* autofill;
isolation does **not** make a populated field secret from its own page. What it
does secure: an unused credential (e.g. a password on a username-only step) is
never written and stays in the isolated realm, and the page cannot hijack the
selection/setter to redirect or capture the write.

**Flow:**

1. **Inspect (credential-free, isolated world).** Run the identity guard, collect
   candidate inputs, run the shared `selectFields`, return booleans only:
   `{ originMismatch } | { originMismatch: false, hasPassword, hasUsername }`.
2. **Decide (main process).** `sendPass = hasPassword ? password : null`,
   `sendUser = hasUsername ? username : null`. On a username-only step the
   password is never sent to the renderer at all.
3. **Re-validate.** Re-check the identity set (live+focused window, same active
   tab, live+focused webContents, unchanged `navEpoch`, exact
   `wc.getURL() === expectedURL`) before the second injection.
4. **Fill (isolated world).** Inject with only the non-null credentials. It
   re-runs the identity guard, then **synchronously** re-runs `selectFields` and
   sets the fields in the same execution — page JS gets no window between select
   and set to mutate the DOM or hook the setter. If the expected field is absent
   (DOM changed since inspect), the credential is simply not written; it never
   leaves the isolated realm. Returns `{ originMismatch, filledUser, filledPass }`.
   Errors keep the **binding-less catch → fixed `fill-error`** (never a message).

### Shared field logic — pure `selectFields`, embedded by `.toString()`

The decision lives in **one pure function**, unit-tested and identical in both
injections. `isVisible`, `isSearchLike`, `isNewsletterLike`, `loginEvidence`,
`collectCandidates` (thin DOM adapter), and `selectFields` are defined once at
module scope; both injected scripts embed their source via
`Function.prototype.toString()`, so tested code == shipped code. `selectFields`
is exported for tests.

- **`collectCandidates()`** (DOM adapter, in page) — ordered array of `input`
  descriptors in document order:
  `{ i, type, autocomplete, name, id, placeholder, ariaLabel, formKey, isVisible, isFocused, inSearchScope }`.
  `type`/`autocomplete` lowercased; `isVisible` = `offsetParent !== null` +
  non-zero client rect + not `type="hidden"`; `isFocused` = `=== document.activeElement`;
  `inSearchScope` = inside a `[role="search"]`. **`formKey`** = a stable index
  assigned per distinct `input.form` **element identity** via a
  `Map<HTMLFormElement, number>` (`null` when `input.form` is null) — *not*
  `form.id`, since forms may lack ids or share them.
- **`selectFields(cands)`** (pure) → `{ passwordIndex, usernameIndex }` (either
  may be `null`). Helpers over a lowercased `name+id+autocomplete+placeholder+ariaLabel`
  blob:
  - `isSearchLike` — `type==='search'`, `inSearchScope`, blob **contains**
    `search`/`query` (substring, so camelCase `siteSearch`/`queryInput` are
    caught), or `name`/`id` exactly `q`/`s`.
  - `isNewsletterLike` — blob contains `newsletter`/`subscribe`/`marketing`/`promo`.
  - `loginEvidence` → `strong` if `autocomplete==='username'` or blob matches
    `/user(name)?|login|account|identifier|loginfmt/`; `medium` if `type==='email'`,
    `autocomplete==='email'`, or blob contains `email`; else `null`.
  - `candidate` = visible `text`/`email`/`tel`, **not** search-like, **not**
    newsletter-like.
  - **`passwordIndex`** = first visible `type==='password'`.
  - **`usernameIndex`**:
    - *Password present* (single-page / password step): the focused candidate,
      else the nearest candidate preceding the password in document order,
      preferring the same `formKey`. (Proximity to a password field is the
      evidence here.)
    - *No password* (username step): from candidates with `loginEvidence != null`
      (call them *positives*) — **no lone-field fallback, no bare guessing**:
      `pool` = the `strong` positives if any, else all positives; if `pool` has
      exactly one → it; if `pool` has more than one → the focused one **if it is
      in `pool`**, else `null` (ambiguous → no-op). Focus is only a tie-break
      among positives.

### Orchestrator outcome map (`fillActiveTabFrom1Password` in `main.js`)

- inspect `originMismatch` → `origin-or-focus-mismatch`
- inspect `!hasPassword && !hasUsername` → `no-fillable-field`
- re-validation fails → the existing `abort-*` line
- fill `originMismatch` → `origin-or-focus-mismatch`
- `filledPass && filledUser` → `filled` `user+pass`
- `filledUser && !filledPass` → `filled` `user-only (multi-step step 1)`
- `filledPass && !filledUser` → `filled` `pass-only (username field not found)`
- otherwise → `nothing-filled`

Unchanged: `revealCredential` decrypts only the chosen item; fill never submits;
the password is embedded/sent only when a password field exists; credentials are
never logged.

## Footprint

- **`src/main/onepassword.js`** — `matchesHost` (registrable-domain key +
  private-domains flag); `tldts-experimental` require + `registrableKey`; shared
  DOM helpers + pure `selectFields` (+ export); `buildInspectScript` (new,
  credential-free); `buildFillScript` (rewritten: `collectCandidates` +
  `selectFields`, synchronous select+set, fill only provided creds).
- **`src/main/main.js`** — `fillActiveTabFrom1Password`: isolated-world inspect →
  decide → re-validate → isolated-world fill; the outcome map above; a
  `FILL_WORLD_ID` constant.
- **`test/unit/onepassword-match.test.js`** — matching + `selectFields`
  behavioral cases (below).
- **`package.json` / `package-lock.json`** — pinned `tldts-experimental@7.4.6`.

## Non-goals (unchanged — real-engine backlog)

Shadow-DOM piercing, cross-origin iframes, auto-advance across the multi-step
navigation (stateless — per-press), TOTP, and 1Password's per-item
`AnywhereOnWebsite`/`ExactDomain`/`Never` rules.

## Testing

**Unit — `test/unit/onepassword-match.test.js`** (`node --test`, pure):

- **`matchesHost`:** exact; `www.` both ways; **subdomain matches**
  (`accounts.google.com` ↔ `google.com`); deep-subdomain ↔ parent; substring trap
  still **fails**; **cross-tenant private domains must NOT match**
  (`alice.github.io` vs `bob.github.io`; two `*.vercel.app`); `foo.co.uk` vs
  `bar.co.uk` no match; **localhost + raw-IP fallback**; no URLs; malformed URL
  skipped.
- **`selectFields`** (pure, descriptor fixtures — the behavioral core):
  - single-page login (username + password) → both indices.
  - password step, no username → password only.
  - username step, `autocomplete="username"` → that field.
  - Google/Microsoft style (`type=email` + `autocomplete=username` / `name=loginfmt`)
    → that field.
  - **focused *generic* text field, no login evidence** → username `null` (focus
    is not evidence).
  - **camelCase search** (`id="siteSearch"`, `name="queryInput"`) focused → `null`.
  - **sole newsletter email** (`id="newsletter-email"`) → `null`.
  - **login email + newsletter email** → login email (newsletter excluded).
  - **two positive emails, neither strong, none focused** → `null` (ambiguous).
  - **two anonymous forms** (login form + newsletter form, both no `id`) →
    password's username resolves within the **same** `formKey`, not the newsletter
    field.
  - hidden/honeypot inputs (`isVisible:false`) → ignored.
- **`buildInspectScript` / `buildFillScript`** (string assertions, secondary):
  inspect source carries **no** credential literal; fill source JSON-embeds only
  provided creds, contains the identity guard + native setter; both embed the same
  `selectFields`/`collectCandidates` source; both target
  `executeJavaScriptInIsolatedWorld` (the orchestrator call, asserted in a main.js
  reference or by the call shape).

**Manual** (fresh `npm start` with `BLANC_1P_ACCOUNT`):
- `accounts.google.com`, item for `google.com` → `filled user-only`; next screen
  → password fills.
- Single-page login on a subdomain of a saved item → `filled user+pass`.
- Search-only page → `no-fillable-field`.
- **React/framework page** (e.g. a React or Vue login) → the native-setter +
  bubbling `input`/`change` events are observed, the value **sticks** through the
  framework's controlled-input tracking, and submit uses the filled value.
- **DOM replacement between phases** — after triggering, script-remove the
  password form before the fill pass; confirm the password is **not** written and
  no `[1p-spike]` line leaks a value (isolated-realm containment).
- Regression: exact-host single-page login → `filled user+pass`; `localhost`/IP
  dev login still matches.

## Risks / edge cases

- **Cross-tenant over-match** — **mitigated for PSL-listed private suffixes** by
  `allowPrivateDomains: true` (verified: `user.github.io` → `user.github.io`). It
  cannot guarantee every shared-hosting domain is PSL-registered; an unlisted
  shared host could still collapse. A single wrong match fills silently (no
  chooser), so this is load-bearing — covered by the cross-tenant unit tests.
- **`tldts-experimental` currently transitive** — promoting to a direct pinned
  dependency removes the adblocker-bump risk.
- **Isolated-world return plumbing** — `executeJavaScriptInIsolatedWorld`'s
  resolved value can differ from `executeJavaScript` (last-`WebSource` completion
  value; behavior worth confirming). The flow depends on the status object
  round-tripping; the plan must verify this in its first isolated-world step and,
  if it doesn't return cleanly, fall back to a readback (e.g. a sentinel the fill
  writes and inspect-of-the-next-call reads). Verify before building on it.
- **Inspect→fill DOM race** — closed for credential exposure by isolated-world +
  synchronous select-then-set: if the field vanishes, the credential is not
  written and never leaves the isolated realm. Residual (inherent to all
  autofill): once written, a populated field is readable by its own page.
- **DOM adapter not unit-tested** — `collectCandidates` needs a browser; covered
  by the manual matrix. The security-critical *decision* (`selectFields`) is fully
  unit-tested. jsdom is not used (its no-layout `offsetParent`/`getBoundingClientRect`
  make visibility fixtures unreliable).
- **Username heuristic residual** — search + newsletter exclusion, login-positive
  evidence required, focus only a tie-break, no lone-field guess; worst case is a
  no-op, never a wrong-field fill.
