# 1Password Fill — Subdomain + Multi-Step Matching Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Blanc's dev-build 1Password fill work on subdomains (an item saved for `google.com` fills on `accounts.google.com`) and on multi-step logins (username-first screens), without ever filling a search/newsletter field or leaking a credential into a page that doesn't need it.

**Architecture:** Two independent changes to `src/main/onepassword.js` plus a rewritten orchestrator in `src/main/main.js`. (1) Host matching moves from exact-host to **registrable-domain (eTLD+1)** equality via `tldts-experimental` with `allowPrivateDomains: true`. (2) The fill becomes a **two-phase, isolated-world** flow: a credential-free *inspect* pass reports which fields exist, the main process decrypts and decides which credential to send, re-validates identity, then a *fill* pass in a dedicated isolated world (`FILL_WORLD_ID = 1001`) synchronously re-selects and writes. The security-critical field choice lives in one pure `selectFields()` that is unit-tested and embedded into both injected scripts via `Function.prototype.toString()`.

**Tech Stack:** Electron main process (`webContents.executeJavaScriptInIsolatedWorld`), `tldts-experimental@7.4.6` (public-suffix list), Node's built-in `node --test`.

**Spec:** [`docs/superpowers/specs/2026-07-12-1password-fill-matching-improvements-design.md`](../specs/2026-07-12-1password-fill-matching-improvements-design.md) (rev. 4)

## Global Constraints

*Every task's requirements implicitly include this section. Values copied verbatim from the spec.*

- **Scope: personal dev build.** Not the shippable engine. Distribution is shelved (see [`docs/1password-legal-inquiry.md`](../../1password-legal-inquiry.md)); local use against one's own vault was never in question. The code keeps its `SPIKE` framing and dev env-gating (`ONE_PASSWORD_SPIKE_ENABLED`).
- **`allowPrivateDomains: true` is mandatory, not optional.** With the default, `getDomain('user.github.io')` → `github.io`, so `alice.github.io` and `bob.github.io` cross-match and a single wrong match **fills silently** (no chooser). This flag is load-bearing.
- **Match key is `getDomain(host, { allowPrivateDomains: true }) || host`** — the `|| host` fallback keeps `localhost`, raw IPs, and single-label intranet hosts working (`getDomain` returns `null` for them).
- **`FILL_WORLD_ID = 1001`.** `0` (main world) and `999` (Electron's context-isolation/preload world) are **forbidden**. Electron recommends custom isolated worlds at id ≥ 1000.
- **Both injections use `wc.executeJavaScriptInIsolatedWorld(FILL_WORLD_ID, [{ code }])`** — never `executeJavaScript` for the fill path.
- **Isolation guarantee, stated accurately:** isolation protects the credential and the decision/setter logic **up to the intended DOM write**. Once written, the page can read that field — inherent to every autofill. It does **not** make a populated field secret from its own page.
- **The password is sent to the renderer only after inspection observes a password field, and written only if the isolated fill pass still finds one.**
- **Nothing is decrypted when there is no fillable field** — `revealCredential` runs only after inspect confirms one.
- **Everything from the reveal onward runs inside the binding-less catch → fixed `fill-error`.** No page- or SDK-controlled message may be logged once a credential is in memory. Pre-reveal errors keep the detailed `setup-error` line.
- **Selection and setting happen synchronously** inside the fill pass — no `await`/timer between choosing a field and writing it.
- **One definition, two consumers:** `isVisible`, `isSearchLike`, `isNewsletterLike`, `loginEvidence`, `collectCandidates`, `selectFields` are defined once at module scope and embedded into both injected scripts via `.toString()`, so tested code == shipped code.
- **Never guess a username field.** Login-positive evidence required; focus is only an in-scope tie-break; no lone-field fallback; search and newsletter fields are excluded.
- **Unit tests stay pure** (`node --test`, no Electron/SDK/DOM). jsdom is deliberately not used — its no-layout `offsetParent`/`getBoundingClientRect` make visibility fixtures unreliable.
- **Workspace + baseline.** Execute in the dedicated worktree `.claude/worktrees/1password-matching` (branch `feature/1password-fill`) — the primary checkout is shared with another session that switches branches. `origin/main` was merged in before execution, so the **baseline is 217 passing tests, 0 failures** (not the pre-merge 144). Every "full unit suite" step below means `npm run test:unit` staying at 217+ passing with 0 failures, growing as this plan's tests are added.

---

## File Structure

- **Modify `src/main/onepassword.js`** (currently 152 lines) — the whole change surface for matching + injected-script construction:
  - `registrableKey(host)` + rewritten `matchesHost` (Task 2)
  - shared DOM helpers + pure `selectFields` (Task 3)
  - `buildInspectScript` (new) + rewritten `buildFillScript` (Task 4)
  - exports grow to include `selectFields`, `buildInspectScript`
- **Modify `src/main/main.js`** — `FILL_WORLD_ID` constant and the rewritten `fillActiveTabFrom1Password` phase-2 block (currently lines 1127–1156) (Task 5)
- **Modify `test/unit/onepassword-match.test.js`** (currently 13 tests) — updated matching cases + new `selectFields` behavioral fixtures (Tasks 2, 3)
- **Modify `package.json` / `package-lock.json`** — direct pinned `tldts-experimental@7.4.6` (Task 1)

---

### Task 1: Pin `tldts-experimental` as a direct dependency + verify the isolated-world contract

Two pieces of groundwork whose failure would invalidate later tasks, so they're proven first: the PSL library must be a *direct* dependency (it's currently only transitive via `@ghostery/adblocker`, so our `require` would break on an adblocker bump), and `executeJavaScriptInIsolatedWorld`'s return value must actually round-trip a status object — the entire Task 4/5 design depends on it.

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a direct `tldts-experimental@7.4.6` dependency; a verified answer to whether `executeJavaScriptInIsolatedWorld` resolves with the script's completion value.

- [ ] **Step 1: Add the direct pinned dependency**

Run: `npm i -E tldts-experimental@7.4.6`
Expected: `package.json` `dependencies` gains `"tldts-experimental": "7.4.6"` (no `^`/`~`). Because the adblocker already resolved this exact version, npm dedupes to the existing copy rather than adding a second.

- [ ] **Step 2: Verify the pin and that the ICANN/private behavior matches the spec**

Run:
```bash
node -e "
const { getDomain } = require('tldts-experimental');
console.log('pinned:', require('./package.json').dependencies['tldts-experimental']);
const opts = { allowPrivateDomains: true };
console.log('accounts.google.com ->', getDomain('accounts.google.com', opts));
console.log('user.github.io     ->', getDomain('user.github.io', opts));
console.log('other.github.io    ->', getDomain('other.github.io', opts));
console.log('github.com.evil.com->', getDomain('github.com.evil.com', opts));
console.log('foo.co.uk          ->', getDomain('foo.co.uk', opts));
console.log('localhost          ->', getDomain('localhost', opts));
"
```
Expected output:
```
pinned: 7.4.6
accounts.google.com -> google.com
user.github.io     -> user.github.io
other.github.io    -> other.github.io
github.com.evil.com-> evil.com
foo.co.uk          -> foo.co.uk
localhost          -> null
```
The two `github.io` lines differing is the whole point of `allowPrivateDomains`. If they both print `github.io`, the flag is not being applied — stop and fix before continuing.

- [ ] **Step 3: Probe the isolated-world return contract (throwaway)**

**Placement matters:** `initSpikePackaging()` is called at `main.js:2670`, *before*
`createMainWindow()` at `main.js:2750` — so there is no window yet at that point,
and a probe there would find `BrowserWindow.getAllWindows()[0]` undefined and prove
nothing. Put the probe **after** window creation and hang it off `did-finish-load`,
and make a missing window a loud **failure**, never a silent skip.

Add this temporary block to `src/main/main.js` immediately **after** the
`createMainWindow();` line inside `app.whenReady()`:

```js
  // TEMPORARY PROBE (Task 1 Step 3) — delete in Step 5.
  if (process.env.BLANC_1P_PROBE === '1') {
    const probeWin = BrowserWindow.getAllWindows()[0];
    if (!probeWin) {
      console.error('[1p-probe] FAIL — no window after createMainWindow()');
    } else {
      probeWin.webContents.once('did-finish-load', async () => {
        try {
          const r = await probeWin.webContents.executeJavaScriptInIsolatedWorld(1001, [
            { code: '(function () { return { ok: true, n: 42 }; })();' },
          ]);
          console.log('[1p-probe] isolated-world returned:', JSON.stringify(r));
        } catch (e) {
          console.error('[1p-probe] FAIL — threw:', e?.message);
        }
      });
    }
  }
```

- [ ] **Step 4: Run the probe**

Run: `BLANC_1P_PROBE=1 npm start`
Expected, once the window finishes loading: `[1p-probe] isolated-world returned: {"ok":true,"n":42}`

Three failure modes, all of which must stop the plan rather than be worked around:
- **No line at all** → the probe never ran; re-check the placement (it must be after `createMainWindow()`).
- **`[1p-probe] FAIL — …`** → no window, or the call threw.
- **`{"ok":true,"n":42}` not returned** (e.g. `undefined`) → the status object does **not** round-trip.

In the last case do **not** invent a sentinel/readback workaround — record the result in the spec's *Isolated-world return plumbing* risk bullet and stop; Tasks 4–5 need revision first. (Quit the app when done.)

- [ ] **Step 5: Remove the probe**

Delete the temporary probe block added in Step 3.

Run: `grep -n "1p-probe" src/main/main.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps(1password): pin tldts-experimental@7.4.6 as a direct dependency"
```

---

### Task 2: Registrable-domain (eTLD+1) host matching

Replaces exact-host matching so subdomains match, while the public-suffix list keeps the `github.com.evil.com` trap closed and `allowPrivateDomains` keeps per-tenant hosts (`*.github.io`) distinct.

**Files:**
- Modify: `src/main/onepassword.js` (add `registrableKey`, rewrite `matchesHost` at lines 22–29)
- Test: `test/unit/onepassword-match.test.js`

**Interfaces:**
- Consumes: `tldts-experimental@7.4.6` (Task 1); the existing `normalizeHost(value) → string|null`.
- Produces: `registrableKey(host) → string` (module-local); `matchesHost(itemUrls, host) → boolean` with registrable-domain semantics (same signature as today).

- [ ] **Step 1: Replace the matching tests with registrable-domain semantics**

In `test/unit/onepassword-match.test.js`, **delete** these two existing tests (their semantics deliberately invert or are now covered):

```js
test('matchesHost: subdomain must NOT match', () => {
  assert.equal(matchesHost(['https://login.github.com'], 'github.com'), false);
});
```

and

```js
test('matchesHost: www vs bare host both directions', () => {
  assert.equal(matchesHost(['https://www.github.com'], 'github.com'), true);
  assert.equal(matchesHost(['https://github.com'], 'www.github.com'), true);
});
```

Then add these tests in their place:

```js
test('matchesHost: www vs bare host both directions', () => {
  assert.equal(matchesHost(['https://www.github.com'], 'github.com'), true);
  assert.equal(matchesHost(['https://github.com'], 'www.github.com'), true);
});

test('matchesHost: subdomain NOW matches its registrable domain', () => {
  assert.equal(matchesHost(['https://google.com'], 'accounts.google.com'), true);
});

test('matchesHost: deep-subdomain item matches the parent domain', () => {
  assert.equal(matchesHost(['https://accounts.google.com'], 'google.com'), true);
});

test('matchesHost: cross-tenant private domains must NOT match (github.io)', () => {
  assert.equal(matchesHost(['https://alice.github.io'], 'bob.github.io'), false);
});

test('matchesHost: cross-tenant private domains must NOT match (vercel.app)', () => {
  assert.equal(matchesHost(['https://one.vercel.app'], 'two.vercel.app'), false);
});

test('matchesHost: same private-domain tenant still matches', () => {
  assert.equal(matchesHost(['https://alice.github.io'], 'alice.github.io'), true);
});

test('matchesHost: public suffix is not collapsed (co.uk)', () => {
  assert.equal(matchesHost(['https://foo.co.uk'], 'bar.co.uk'), false);
  assert.equal(matchesHost(['https://shop.foo.co.uk'], 'foo.co.uk'), true);
});

test('matchesHost: localhost falls back to exact host', () => {
  assert.equal(matchesHost(['http://localhost'], 'localhost'), true);
  assert.equal(matchesHost(['http://localhost'], 'other-host'), false);
});

test('matchesHost: raw IP falls back to exact host', () => {
  assert.equal(matchesHost(['http://127.0.0.1'], '127.0.0.1'), true);
  assert.equal(matchesHost(['http://127.0.0.1'], '192.168.1.5'), false);
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: FAIL — `matchesHost: subdomain NOW matches its registrable domain` fails (`false !== true`), because matching is still exact-host.

- [ ] **Step 3: Implement registrable-domain matching**

In `src/main/onepassword.js`, add this require at the very top of the file (line 1, above the `// SPIKE` comment):

```js
const { getDomain } = require('tldts-experimental');
```

Then replace the whole `matchesHost` function (lines 22–29, the JSDoc block and the function) with:

```js
/** Reduce a normalized host to its registrable domain (eTLD+1) for matching.
 * `allowPrivateDomains: true` is REQUIRED: without it `user.github.io` collapses
 * to `github.io`, so two tenants would cross-match and a single wrong match
 * fills silently. Falls back to the exact host when there is no public suffix
 * at all (localhost, raw IPs, single-label intranet names). */
function registrableKey(host) {
  return getDomain(host, { allowPrivateDomains: true }) || host;
}

/** True iff any of a Login item's stored website URLs shares a registrable
 * domain with `host` — so an item saved for `google.com` matches
 * `accounts.google.com`, while `github.com.evil.com` (registrable domain
 * `evil.com`) still cannot match `github.com`. */
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: PASS — all matching cases green, including both cross-tenant guards.

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/main/onepassword.js test/unit/onepassword-match.test.js
git commit -m "feat(1password): match on registrable domain (eTLD+1) so subdomains work"
```

---

### Task 3: Pure `selectFields` field-selection decision + behavioral tests

The security-critical decision — which input gets the username, and whether a password field exists — extracted as a pure function over plain descriptors so it can be unit-tested without a DOM. Task 4 embeds this exact function into both injected scripts.

**Files:**
- Modify: `src/main/onepassword.js` (add helpers + `selectFields`, extend exports)
- Test: `test/unit/onepassword-match.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `selectFields(cands) → { passwordIndex: number|null, usernameIndex: number|null }`, exported. `cands` is an array of descriptors in document order, each:
  `{ i: number, type: string, autocomplete: string, name: string, id: string, placeholder: string, ariaLabel: string, formKey: number|null, isVisible: boolean, isFocused: boolean, inSearchScope: boolean }`.
  Returned indices are the descriptor's `i`.

- [ ] **Step 1: Write the failing behavioral tests**

Add to `test/unit/onepassword-match.test.js`. First extend the destructured require at the top of the file to include `selectFields`:

```js
const { matchesHost, buildFillScript, selectFields } = require('../../src/main/onepassword');
```

Then append these tests:

```js
// --- selectFields fixtures -------------------------------------------------
// Minimal descriptor factory: visible, unfocused, no form, no signals.
function cand(i, over = {}) {
  return {
    i,
    type: 'text',
    autocomplete: '',
    name: '',
    id: '',
    placeholder: '',
    ariaLabel: '',
    formKey: null,
    isVisible: true,
    isFocused: false,
    inSearchScope: false,
    ...over,
  };
}

test('selectFields: standard single-page login picks both fields', () => {
  const r = selectFields([
    cand(0, { type: 'text', name: 'username', formKey: 1 }),
    cand(1, { type: 'password', formKey: 1 }),
  ]);
  assert.deepEqual(r, { passwordIndex: 1, usernameIndex: 0 });
});

test('selectFields: password step with no username field', () => {
  const r = selectFields([cand(0, { type: 'password', formKey: 1 })]);
  assert.deepEqual(r, { passwordIndex: 0, usernameIndex: null });
});

test('selectFields: signup form (new-password only) gets NO password', () => {
  // Writing the SAVED password into a new-password field would leak the
  // existing credential into a form meant for a new one.
  const r = selectFields([
    cand(0, { type: 'email', name: 'email', formKey: 1 }),
    cand(1, { type: 'password', autocomplete: 'new-password', formKey: 1 }),
  ]);
  assert.equal(r.passwordIndex, null);
});

test('selectFields: change-password form fills current-password, not new', () => {
  const r = selectFields([
    cand(0, { type: 'password', autocomplete: 'current-password', formKey: 1 }),
    cand(1, { type: 'password', autocomplete: 'new-password', formKey: 1 }),
    cand(2, { type: 'password', autocomplete: 'new-password', formKey: 1 }),
  ]);
  assert.equal(r.passwordIndex, 0);
});

test('selectFields: current-password preferred even when it comes later', () => {
  const r = selectFields([
    cand(0, { type: 'password', formKey: 1 }),
    cand(1, { type: 'password', autocomplete: 'current-password', formKey: 1 }),
  ]);
  assert.equal(r.passwordIndex, 1);
});

test('selectFields: username step via autocomplete=username', () => {
  const r = selectFields([cand(0, { type: 'email', autocomplete: 'username' })]);
  assert.deepEqual(r, { passwordIndex: null, usernameIndex: 0 });
});

test('selectFields: Microsoft-style username step (name=loginfmt)', () => {
  const r = selectFields([cand(0, { type: 'email', name: 'loginfmt' })]);
  assert.deepEqual(r, { passwordIndex: null, usernameIndex: 0 });
});

test('selectFields: focused GENERIC field is not evidence — no fill', () => {
  const r = selectFields([cand(0, { type: 'text', isFocused: true })]);
  assert.deepEqual(r, { passwordIndex: null, usernameIndex: null });
});

test('selectFields: camelCase search ids are excluded even when focused', () => {
  const r = selectFields([
    cand(0, { type: 'text', id: 'siteSearch', isFocused: true }),
    cand(1, { type: 'text', name: 'queryInput' }),
  ]);
  assert.deepEqual(r, { passwordIndex: null, usernameIndex: null });
});

test('selectFields: sole newsletter email is excluded', () => {
  const r = selectFields([cand(0, { type: 'email', id: 'newsletter-email' })]);
  assert.deepEqual(r, { passwordIndex: null, usernameIndex: null });
});

test('selectFields: login email wins over a newsletter email', () => {
  const r = selectFields([
    cand(0, { type: 'email', id: 'newsletter-email' }),
    cand(1, { type: 'email', name: 'email' }),
  ]);
  assert.deepEqual(r, { passwordIndex: null, usernameIndex: 1 });
});

test('selectFields: two ambiguous emails, none strong or focused -> no fill', () => {
  const r = selectFields([
    cand(0, { type: 'email', name: 'email' }),
    cand(1, { type: 'email', name: 'contactEmail' }),
  ]);
  assert.deepEqual(r, { passwordIndex: null, usernameIndex: null });
});

test('selectFields: focus breaks ties among positive candidates', () => {
  const r = selectFields([
    cand(0, { type: 'email', name: 'email' }),
    cand(1, { type: 'email', name: 'contactEmail', isFocused: true }),
  ]);
  assert.deepEqual(r, { passwordIndex: null, usernameIndex: 1 });
});

test('selectFields: focused field in ANOTHER form does not take the username', () => {
  const r = selectFields([
    cand(0, { type: 'email', name: 'email', formKey: 2, isFocused: true }), // newsletter form
    cand(1, { type: 'text', name: 'username', formKey: 1 }),                 // login form
    cand(2, { type: 'password', formKey: 1 }),
  ]);
  assert.deepEqual(r, { passwordIndex: 2, usernameIndex: 1 });
});

test('selectFields: two anonymous forms stay separate (formKey identity)', () => {
  const r = selectFields([
    cand(0, { type: 'email', name: 'email', formKey: 0 }),  // anonymous newsletter form
    cand(1, { type: 'text', name: 'user', formKey: 1 }),    // anonymous login form
    cand(2, { type: 'password', formKey: 1 }),
  ]);
  assert.deepEqual(r, { passwordIndex: 2, usernameIndex: 1 });
});

test('selectFields: hidden/honeypot inputs are ignored', () => {
  const r = selectFields([
    cand(0, { type: 'text', name: 'username', isVisible: false }),
    cand(1, { type: 'password', isVisible: false }),
    cand(2, { type: 'text', name: 'username', formKey: 1 }),
    cand(3, { type: 'password', formKey: 1 }),
  ]);
  assert.deepEqual(r, { passwordIndex: 3, usernameIndex: 2 });
});

test('selectFields: no inputs at all', () => {
  assert.deepEqual(selectFields([]), { passwordIndex: null, usernameIndex: null });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: FAIL — `selectFields is not a function`.

- [ ] **Step 3: Implement the helpers and `selectFields`**

In `src/main/onepassword.js`, insert this block immediately **above** the `buildFillScript` JSDoc comment (currently line 31). These functions must be self-contained — no closures over module state — because Task 4 embeds their source via `.toString()`.

```js
/* ---------------------------------------------------------------------------
 * Field selection. These helpers are embedded into BOTH injected scripts via
 * Function.prototype.toString(), so they must stay self-contained (no module
 * closures) — and so the code under test is literally the code that runs in
 * the page. `selectFields` is pure and unit-tested.
 * ------------------------------------------------------------------------- */

/** Lowercased blob of every identifying attribute, for signal matching. */
function candBlob(c) {
  return [c.name, c.id, c.autocomplete, c.placeholder, c.ariaLabel]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Search boxes must never receive a username. Substring (not word-boundary)
 * matching so camelCase ids like `siteSearch`/`queryInput` are caught. */
function isSearchLike(c) {
  if (c.type === 'search' || c.inSearchScope) return true;
  const blob = candBlob(c);
  if (blob.includes('search') || blob.includes('query')) return true;
  const n = (c.name || '').toLowerCase();
  const id = (c.id || '').toLowerCase();
  return n === 'q' || n === 's' || id === 'q' || id === 's';
}

/** Newsletter/marketing signup fields are not login fields. */
function isNewsletterLike(c) {
  const blob = candBlob(c);
  return blob.includes('newsletter') || blob.includes('subscribe')
    || blob.includes('marketing') || blob.includes('promo');
}

/** 'strong' | 'medium' | null — how confident we are this is a LOGIN field. */
function loginEvidence(c) {
  const blob = candBlob(c);
  if (c.autocomplete === 'username') return 'strong';
  if (/user(name)?|login|account|identifier|loginfmt/.test(blob)) return 'strong';
  if (c.type === 'email' || c.autocomplete === 'email' || blob.includes('email')) return 'medium';
  return null;
}

/** A fillable username candidate: visible text-ish input, not a search or
 * newsletter field. */
function isUsernameCandidate(c) {
  if (!c.isVisible) return false;
  if (c.type !== 'text' && c.type !== 'email' && c.type !== 'tel') return false;
  return !isSearchLike(c) && !isNewsletterLike(c);
}

/** A password field we may write the SAVED password into. Excludes
 * `autocomplete="new-password"`: that marks a signup or change-password field,
 * and writing the existing credential there would leak it into a form meant for
 * a new value. (HTML autofill spec distinguishes current- vs new-password.) */
function isFillablePassword(c) {
  return c.type === 'password' && c.isVisible && c.autocomplete !== 'new-password';
}

/** Choose which fields to fill. Pure: takes descriptors, returns indices.
 * Never guesses — an ambiguous page yields nulls rather than a wrong fill. */
function selectFields(cands) {
  const list = Array.isArray(cands) ? cands : [];
  // Prefer an explicit current-password; otherwise the first fillable one.
  // new-password fields are excluded entirely by isFillablePassword.
  const pwPool = list.filter(isFillablePassword);
  const pw = pwPool.find((c) => c.autocomplete === 'current-password') || pwPool[0] || null;
  const passwordIndex = pw ? pw.i : null;
  let usernameIndex = null;

  if (pw) {
    // Anchored: proximity to the password field is the evidence, but stay
    // inside the password's form so a focused field elsewhere on the page
    // can't receive the username.
    const scope = list.filter((c) => isUsernameCandidate(c) && c.formKey === pw.formKey);
    const focused = scope.find((c) => c.isFocused);
    if (focused) {
      usernameIndex = focused.i;
    } else {
      const preceding = scope.filter((c) => c.i < pw.i);
      usernameIndex = preceding.length ? preceding[preceding.length - 1].i : null;
    }
  } else {
    // Username step: require login-positive evidence. No lone-field fallback.
    const positives = list.filter((c) => isUsernameCandidate(c) && loginEvidence(c) !== null);
    const strong = positives.filter((c) => loginEvidence(c) === 'strong');
    const pool = strong.length ? strong : positives;
    if (pool.length === 1) {
      usernameIndex = pool[0].i;
    } else if (pool.length > 1) {
      const focused = pool.find((c) => c.isFocused);
      usernameIndex = focused ? focused.i : null; // ambiguous -> no guess
    }
  }

  return { passwordIndex, usernameIndex };
}
```

Then extend the exports line at the bottom of the file:

```js
module.exports = { matchesHost, selectFields, buildFillScript, getClient, findLogins, revealCredential, probePackageLoad };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: PASS — all 14 `selectFields` cases green.

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/main/onepassword.js test/unit/onepassword-match.test.js
git commit -m "feat(1password): pure selectFields decision with behavioral fixtures"
```

---

### Task 4: `buildInspectScript` + rewritten `buildFillScript` (isolated-world sources)

Builds the two injected sources. The inspect source carries **no credential** and reports only booleans; the fill source embeds only the credentials it was given and does select-then-set synchronously. Both embed the Task 3 helpers verbatim.

**Files:**
- Modify: `src/main/onepassword.js` (add `collectCandidates` + `buildInspectScript`, rewrite `buildFillScript`, extend exports)
- Test: `test/unit/onepassword-match.test.js`

**Interfaces:**
- Consumes: `selectFields` and its helpers (Task 3).
- Produces:
  - `buildInspectScript({ expectedURL, expectedTimeOrigin }) → string` — IIFE resolving to `{ originMismatch: true }` or `{ originMismatch: false, hasPassword: boolean, hasUsername: boolean }`.
  - `buildFillScript({ expectedURL, expectedTimeOrigin, username, password }) → string` — IIFE resolving to `{ originMismatch: true, filledUser: false, filledPass: false }` or `{ originMismatch: false, filledUser: boolean, filledPass: boolean }`. `username`/`password` may be `null`; a `null` value is never written.

- [ ] **Step 1: Write the failing tests**

In `test/unit/onepassword-match.test.js`, extend the top-level require to add `buildInspectScript`:

```js
const { matchesHost, buildFillScript, buildInspectScript, selectFields } = require('../../src/main/onepassword');
```

**Delete** the existing test named `buildFillScript: null username still embeds a null literal (fills password only)` (its `'null !== null'` assertion no longer describes the generated source). Then append:

```js
test('buildInspectScript: carries NO credential literal', () => {
  const s = buildInspectScript({ expectedURL: 'https://x.test/', expectedTimeOrigin: 5 });
  assert.ok(s.includes(JSON.stringify('https://x.test/')));
  assert.ok(s.includes('hasPassword'));
  assert.ok(!s.includes('password:'));       // no credential key
  assert.ok(!s.includes('setNative'));       // inspect never writes
});

test('buildInspectScript: embeds the shared selection logic', () => {
  const s = buildInspectScript({ expectedURL: 'https://x.test/', expectedTimeOrigin: 0 });
  assert.ok(s.includes('function selectFields'));
  assert.ok(s.includes('function collectCandidates'));
  assert.ok(s.includes('function isSearchLike'));
});

test('buildFillScript: embeds only the credentials provided', () => {
  const s = buildFillScript({
    expectedURL: 'https://x.test/', expectedTimeOrigin: 0, username: 'alice', password: null,
  });
  assert.ok(s.includes(JSON.stringify('alice')));
  assert.ok(s.includes('var PASS = null;'));
});

test('buildFillScript: dangerous credential chars are safely escaped', () => {
  const nasty = 'a"b\\c\nd\'e';
  const s = buildFillScript({
    expectedURL: 'https://x.test/', expectedTimeOrigin: 0, username: null, password: nasty,
  });
  assert.ok(s.includes(JSON.stringify(nasty)));
  assert.ok(!s.includes('"' + nasty + '"'));
});

test('buildFillScript: keeps the identity guard and native setter', () => {
  const s = buildFillScript({
    expectedURL: 'https://x.test/', expectedTimeOrigin: 7, username: 'u', password: 'p',
  });
  assert.ok(s.includes('location.href'));
  assert.ok(s.includes('document.hasFocus()'));
  assert.ok(s.includes('performance.timeOrigin'));
  assert.ok(s.includes('HTMLInputElement.prototype'));
  assert.ok(s.includes('function selectFields'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: FAIL — `buildInspectScript is not a function`.

- [ ] **Step 3: Add `collectCandidates` and the shared-source builder**

In `src/main/onepassword.js`, add `collectCandidates` immediately after `selectFields` (it runs in the page, so it also stays self-contained):

```js
/** DOM adapter (runs in the page): every <input> in document order, described
 * as plain data for `selectFields`. `formKey` is a stable index per distinct
 * form ELEMENT — never `form.id`, since forms may lack ids or share them, and
 * two anonymous forms must not merge. */
function collectCandidates() {
  var inputs = document.querySelectorAll('input');
  var formKeys = new Map();
  var out = [];
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    var key = null;
    if (el.form) {
      if (!formKeys.has(el.form)) formKeys.set(el.form, formKeys.size);
      key = formKeys.get(el.form);
    }
    var visible = true;
    if (el.type === 'hidden' || el.offsetParent === null) {
      visible = false;
    } else {
      var r = el.getBoundingClientRect();
      visible = r.width > 0 && r.height > 0;
    }
    out.push({
      i: i,
      type: (el.type || '').toLowerCase(),
      autocomplete: (el.getAttribute('autocomplete') || '').toLowerCase(),
      name: el.name || '',
      id: el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      formKey: key,
      isVisible: visible,
      isFocused: el === document.activeElement,
      inSearchScope: !!el.closest('[role="search"]'),
    });
  }
  return { els: inputs, cands: out };
}
```

Then add the shared-source helper directly below it:

```js
/** The helper sources both injected scripts share, so the page runs exactly
 * the functions the unit tests import. */
function sharedSelectionSource() {
  return [candBlob, isSearchLike, isNewsletterLike, loginEvidence, isUsernameCandidate, isFillablePassword, selectFields, collectCandidates]
    .map((fn) => fn.toString())
    .join('\n');
}
```

- [ ] **Step 4: Add `buildInspectScript` and rewrite `buildFillScript`**

Replace the entire existing `buildFillScript` function **and its JSDoc block** (currently lines 31–79) with:

```js
/** Credential-FREE inspection source. Reports only whether fillable fields
 * exist, so the main process can decide which credential (if any) to send. */
function buildInspectScript({ expectedURL, expectedTimeOrigin }) {
  const U = JSON.stringify(expectedURL);
  const TO = JSON.stringify(expectedTimeOrigin);
  return `(function () {
    if (location.href !== ${U} || !document.hasFocus() || performance.timeOrigin !== ${TO}) {
      return { originMismatch: true };
    }
    ${sharedSelectionSource()}
    var collected = collectCandidates();
    var picked = selectFields(collected.cands);
    return {
      originMismatch: false,
      hasPassword: picked.passwordIndex !== null,
      hasUsername: picked.usernameIndex !== null,
    };
  })();`;
}

/** Credential-bearing fill source, injected into a DEDICATED ISOLATED WORLD.
 * Only the credentials passed in are embedded — a null value is never written.
 * Selection and setting happen synchronously in one execution, so page JS gets
 * no window to mutate the DOM or hook the setter between them. Resolves to a
 * STATUS OBJECT ONLY, never the credential values. */
function buildFillScript({ expectedURL, expectedTimeOrigin, username, password }) {
  const U = JSON.stringify(expectedURL);
  const TO = JSON.stringify(expectedTimeOrigin);
  const USER = JSON.stringify(username ?? null);
  const PASS = JSON.stringify(password ?? null);
  return `(function () {
    if (location.href !== ${U} || !document.hasFocus() || performance.timeOrigin !== ${TO}) {
      return { originMismatch: true, filledUser: false, filledPass: false };
    }
    var USER = ${USER};
    var PASS = ${PASS};
    ${sharedSelectionSource()}
    var setNative = function (el, value) {
      var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    var collected = collectCandidates();
    var picked = selectFields(collected.cands);
    var filledPass = false, filledUser = false;
    if (picked.passwordIndex !== null && PASS !== null) {
      setNative(collected.els[picked.passwordIndex], PASS);
      filledPass = true;
    }
    if (picked.usernameIndex !== null && USER !== null) {
      setNative(collected.els[picked.usernameIndex], USER);
      filledUser = true;
    }
    return { originMismatch: false, filledUser: filledUser, filledPass: filledPass };
  })();`;
}
```

Then extend the exports line at the bottom of the file:

```js
module.exports = { matchesHost, selectFields, buildInspectScript, buildFillScript, getClient, findLogins, revealCredential, probePackageLoad };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: PASS.

- [ ] **Step 6: Verify the generated sources actually parse**

A template-built script that doesn't parse would only fail at runtime, so check
both. `vm.Script` **compiles without executing** (and without building a callable
from a string, unlike `new Function`), which is exactly the check we want here:

Run:
```bash
node -e "
const vm = require('node:vm');
const op = require('./src/main/onepassword');
const args = { expectedURL: 'https://x.test/', expectedTimeOrigin: 1 };
new vm.Script(op.buildInspectScript(args));
new vm.Script(op.buildFillScript({ ...args, username: 'u', password: 'p' }));
console.log('both sources parse OK');
"
```
Expected: `both sources parse OK`

*(Note: the credential values reach the injected source through `JSON.stringify`
only — that is the escaping boundary, and Task 4 Step 1's "dangerous credential
chars are safely escaped" test is what guards it. Never build these sources by
concatenating a raw value.)*

- [ ] **Step 7: Run the full unit suite and syntax-check**

Run: `node --check src/main/onepassword.js && npm run test:unit`
Expected: `node --check` silent; suite PASS, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add src/main/onepassword.js test/unit/onepassword-match.test.js
git commit -m "feat(1password): credential-free inspect source + isolated-world fill source"
```

---

### Task 5: Two-phase isolated-world orchestrator

Rewires `fillActiveTabFrom1Password` to the inspect → reveal → re-validate → decide → fill flow, moving both injections into the dedicated isolated world. This is the first end-to-end runnable deliverable.

**Files:**
- Modify: `src/main/main.js` (add `FILL_WORLD_ID`; replace phase 2, currently lines 1127–1156)
- Test: `test/unit/onepassword-match.test.js` (constant guard)

**Interfaces:**
- Consumes: `onepassword.buildInspectScript`, `onepassword.buildFillScript`, `onepassword.revealCredential` (Tasks 3–4).
- Produces: the outcome log lines `no-fillable-field`, `filled user-only (multi-step step 1)` alongside the existing ones; module-level `FILL_WORLD_ID = 1001`.

- [ ] **Step 1: Write the failing constant guard test**

Append to `test/unit/onepassword-match.test.js`:

```js
test('fill path injects into a dedicated isolated world at BOTH call sites', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../../src/main/main.js'), 'utf8');

  // The constant itself must name a legal custom world.
  const m = src.match(/FILL_WORLD_ID\s*=\s*(\d+)/);
  assert.ok(m, 'FILL_WORLD_ID constant not found in main.js');
  const id = Number(m[1]);
  assert.ok(id >= 1000, 'custom isolated worlds must use id >= 1000');
  assert.notEqual(id, 0);    // page main world
  assert.notEqual(id, 999);  // Electron context-isolation / preload world

  // ...and it must actually be USED for both injections. Asserting only the
  // constant would stay green if the calls regressed to executeJavaScript().
  const isolated = src.match(/executeJavaScriptInIsolatedWorld\(\s*FILL_WORLD_ID\s*,/g) || [];
  assert.equal(isolated.length, 2, 'expected 2 isolated-world injections (inspect + fill)');

  // The credential-bearing injection must never fall back to the main world.
  // (A credential-free wc.executeJavaScript('performance.timeOrigin') is fine.)
  assert.ok(
    !/executeJavaScript\(\s*source\s*\)/.test(src),
    'fill must not use main-world executeJavaScript(source)'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: FAIL — `FILL_WORLD_ID constant not found in main.js`.

- [ ] **Step 3: Add the world-id constant**

In `src/main/main.js`, add this directly below the `let onePasswordFillInFlight = false;` line (inside the `// ─── SPIKE …` block above `createTab`):

```js
// Dedicated isolated world for the credential-bearing fill. 0 is the page's
// main world and 999 is Electron's context-isolation/preload world — both are
// forbidden; Electron recommends custom worlds at id >= 1000.
const FILL_WORLD_ID = 1001;
```

- [ ] **Step 4: Replace phase 2 with the two-phase flow**

In `src/main/main.js`, replace the whole phase-2 block — from the comment line `// ── PHASE 2 (reveal + fill): a credential is in memory from revealCredential` through the closing `}` of the `catch` (currently lines 1127–1156) — with:

```js
  // ── PHASE 2 (inspect → reveal → fill). The inspect pass carries NO
  //    credential, so nothing is decrypted for a page with no login form. From
  //    the reveal onward this is a BINDING-LESS try: every failure logs a FIXED
  //    classification, so no page- or SDK-controlled message can echo the
  //    credential. Both injections run in a dedicated ISOLATED WORLD, so the
  //    page cannot hook the setter or read the embedded credential. ──
  try {
    const inspect = await wc.executeJavaScriptInIsolatedWorld(FILL_WORLD_ID, [
      { code: onepassword.buildInspectScript({ expectedURL, expectedTimeOrigin: capturedTimeOrigin }) },
    ]);
    // Validate the shape BEFORE reading fields: an undefined/garbage result is a
    // plumbing failure and must fail closed, not masquerade as the benign
    // `no-fillable-field` outcome.
    if (!inspect || typeof inspect !== 'object') return log('fill-error');
    if (inspect.originMismatch) return log('origin-or-focus-mismatch');
    if (!inspect.hasPassword && !inspect.hasUsername) return log('no-fillable-field');

    // Only now — with a fillable field confirmed — decrypt the chosen item.
    const { username, password } = await onepassword.revealCredential(chosen.vaultId, chosen.itemId);
    if (password == null && username == null) return log('empty-item');

    // Re-validate after the async inspect + reveal: same live+focused window,
    // same active tab, live+focused webContents, unchanged epoch, same URL.
    if (!hasLiveWindow() || !win.isFocused()) return log('abort-window-changed');
    if (activeTabId !== capturedTabId || !tabs.has(capturedTabId)) return log('abort-tab-changed');
    if (wc.isDestroyed() || !wc.isFocused()) return log('abort-wc-changed');
    if (tab.navEpoch !== capturedEpoch) return log('abort-navigated');
    if (wc.getURL() !== expectedURL) return log('abort-url-changed');

    // Send ONLY the credential this step needs: on a username-only screen the
    // password is never handed to the renderer at all.
    const source = onepassword.buildFillScript({
      expectedURL,
      expectedTimeOrigin: capturedTimeOrigin,
      username: inspect.hasUsername ? username : null,
      password: inspect.hasPassword ? password : null,
    });
    const status = await wc.executeJavaScriptInIsolatedWorld(FILL_WORLD_ID, [{ code: source }]);
    if (!status || typeof status !== 'object') return log('fill-error'); // fail closed
    if (status.originMismatch) return log('origin-or-focus-mismatch');
    if (status.filledPass && status.filledUser) return log('filled', 'user+pass');
    if (status.filledUser) return log('filled', 'user-only (multi-step step 1)');
    if (status.filledPass) return log('filled', 'pass-only (username field not found)');
    return log('nothing-filled');
  } catch {
    return log('fill-error'); // no binding, no message — a credential is in memory
  }
}
```

- [ ] **Step 5: Run the tests and syntax-check**

Run: `node --check src/main/main.js && npm run test:unit`
Expected: `node --check` silent; suite PASS, 0 failures (including the `FILL_WORLD_ID` guard).

- [ ] **Step 6: Confirm no stale references remain**

Run: `grep -n "noPasswordField\|no-password-field" src/main/main.js src/main/onepassword.js`
Expected: no output — that outcome was replaced by `no-fillable-field`.

- [ ] **Step 7: Manual smoke — the core deliverable**

Relaunch (the chord listener wires at `createTab` time — restart, don't ⌘R):

```bash
BLANC_1P_ACCOUNT="<your-account>" npm start
```

Verify, reading the `[1p-spike]` lines:
- **Subdomain:** a site whose saved item is the bare domain but whose login lives on a subdomain (e.g. item `google.com`, page `accounts.google.com`) → the username fills → `filled user-only (multi-step step 1)`. Advance to the password screen → `⌥⌘P` → `filled pass-only (username field not found)`.
- **Single-page login on a subdomain** of a saved item → `filled user+pass`.
- **A page with only a search box** → `no-fillable-field`, and the search box is **not** filled.
- **React/framework login** (any modern SPA login form) → the value **sticks** after filling (the native setter + `input`/`change` events defeat the framework's controlled-input tracking) and submitting uses the filled value.
- **Signup / password-reset page** (a form whose password input is
  `autocomplete="new-password"`) → the saved password is **not** written. Expect
  `filled user-only (multi-step step 1)` if the email field is filled, or
  `no-fillable-field`. Confirm the password box is still empty.
- **DOM replacement between phases** — on a login page, open DevTools on that tab
  and schedule the form's removal, then trigger the chord inside that window:

  ```js
  setTimeout(() => document.querySelector('input[type=password]')?.closest('form')?.remove(), 250);
  ```

  Press `⌥⌘P` immediately. Expected: **no value is written anywhere**, the outcome
  is `nothing-filled` (or an `abort-*` line if the mutation also disturbed
  focus/URL), and **no `[1p-spike]` line contains a credential**. If the removal
  lands after the fill completes, shorten the delay and retry. This is the
  observable check that the isolated realm holds the credential when the expected
  field disappears.
- **Regression:** an exact-host single-page login still → `filled user+pass`.

- [ ] **Step 8: Commit**

```bash
git add src/main/main.js test/unit/onepassword-match.test.js
git commit -m "feat(1password): two-phase isolated-world fill (inspect -> reveal -> fill)"
```

---

### Task 6: Update the dev-usage doc

The user-facing behavior changed — new log lines, subdomain matching, and the two-press multi-step flow — so the guide that documents day-to-day use has to match.

**Files:**
- Modify: `docs/1password-dev-usage.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Update the matching + multi-step description**

In `docs/1password-dev-usage.md`, replace the "Notes & limits" bullet that begins `- Matching is **exact-host only**` with:

```markdown
- Matching is by **registrable domain (eTLD+1)** — an item saved for `google.com`
  fills on any `*.google.com`. Per-tenant hosts stay separate
  (`alice.github.io` never matches `bob.github.io`), and `localhost`/raw IPs fall
  back to exact-host matching.
- **Multi-step logins** work with two presses: `⌥⌘P` on the username screen fills
  the username, then `⌥⌘P` again on the password screen fills the password. No
  credential is held across the navigation.
- Username selection requires **login-positive evidence** — search boxes and
  newsletter fields are never filled, and an ambiguous page no-ops rather than
  guessing.
- Still unsupported: shadow-DOM inputs, cross-origin iframes, TOTP, and saving
  new/updated items.
```

- [ ] **Step 2: Update the troubleshooting table**

In the same file, replace the `no-password-field` table row with:

```markdown
| `no-fillable-field` | No password field *and* no confident username field — a multi-step page whose field lacks login signals, an iframe/shadow-DOM form, or a page with only a search box. |
| `filled user-only (multi-step step 1)` | Username screen filled; press ⌥⌘P again on the password screen. |
```

- [ ] **Step 3: Verify no stale references**

Run: `grep -n "exact-host only\|no-password-field" docs/1password-dev-usage.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/1password-dev-usage.md
git commit -m "docs(1password): dev-usage guide reflects subdomain + multi-step matching"
```

---

## Self-Review

**Spec coverage:**
- Part 1 registrable-domain matching + `allowPrivateDomains: true` + `|| host` fallback → Task 2 Step 3. ✅
- Direct pinned `tldts-experimental@7.4.6` → Task 1. ✅
- Two-phase flow (inspect → reveal → re-validate → decide → fill), nothing decrypted with no fillable field → Task 5 Step 4. ✅
- Isolated world, `FILL_WORLD_ID = 1001`, 0/999 forbidden, constant asserted → Task 5 Steps 1/3, guard test. ✅
- Synchronous select-then-set; only provided credentials embedded → Task 4 Step 4. ✅
- Binding-less catch → fixed `fill-error` from the reveal onward; `setup-error` unchanged pre-reveal → Task 5 Step 4. ✅
- Shared helpers embedded via `.toString()` so tested code == shipped code → Task 4 Step 3 (`sharedSelectionSource`), asserted in Task 4 Step 1. ✅
- `selectFields` rules — search/newsletter exclusion (substring, camelCase-safe), login-positive evidence, focus as in-scope tie-break only, no lone-field fallback, form-scoped anchoring → Task 3 Step 3 + fixtures. ✅
- **`new-password` exclusion / `current-password` preference** (beyond the spec — closes a signup/reset leak where the *saved* password would be written into a field meant for a new one) → Task 3 Step 3 `isFillablePassword` + three fixtures + the signup manual check. ✅
- Plumbing failures fail closed as `fill-error` (shape-validated results, not misread as `no-fillable-field`/`nothing-filled`) → Task 5 Step 4. ✅
- Isolated world actually *used* at both call sites, not merely declared → Task 5 Step 1 regression test. ✅
- DOM-replacement-between-phases verification → Task 5 Step 7. ✅
- `collectCandidates` `formKey` via `Map<form, index>` (never `form.id`) → Task 4 Step 3, covered by the two-anonymous-forms fixture. ✅
- Orchestrator outcome map incl. `no-fillable-field` and `filled user-only` → Task 5 Step 4. ✅
- Isolated-world return-plumbing risk verified before it's built on → Task 1 Steps 3–5 (probe, then removed). ✅
- Unit matrix (matching + `selectFields` fixtures + source assertions + world-id guard) → Tasks 2–5. ✅
- Manual matrix (subdomain, multi-step, search-only, React native-setter, regression) → Task 5 Step 7. ✅
- Non-goals (shadow DOM, iframes, auto-advance, TOTP, per-item 1P URL rules) → nothing introduced; restated in Task 6. ✅

**Previously uncovered, now closed:** the spec's *DOM replacement between phases* check was initially omitted on the grounds that the protection is structural. That was wrong — structural protection is not verification — so Task 5 Step 7 now scripts the mutation via DevTools and asserts the observable outcome (nothing written, no credential in any log line).

**Placeholder scan:** no `TBD`/`TODO`/"handle edge cases"/uncoded steps. The one temporary artifact — the Task 1 isolated-world probe — is explicitly added in Step 3 and deleted in Step 5, with a `grep` confirming removal.

**Type consistency:** `selectFields(cands) → { passwordIndex, usernameIndex }` (Task 3) is consumed by both injected scripts (Task 4) and drives `hasPassword`/`hasUsername` in the inspect result, which the orchestrator branches on (Task 5). `collectCandidates() → { els, cands }` — `cands[].i` indexes `els`, which is how the fill pass resolves an index back to an element. Descriptor keys (`type`, `autocomplete`, `name`, `id`, `placeholder`, `ariaLabel`, `formKey`, `isVisible`, `isFocused`, `inSearchScope`) are identical in the test factory (Task 3 Step 1) and the DOM adapter (Task 4 Step 3). `buildFillScript`'s status keys (`originMismatch`, `filledUser`, `filledPass`) match the orchestrator's branches exactly.
