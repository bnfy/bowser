# 1Password Fill — Feasibility Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove — with throwaway, env-gated spike code — whether Blanc can fill a web login form's username + password from the user's 1Password vault behind Touch ID, with **no browser extension**, by injecting from the inside of the tab's `WebContentsView`.

**Architecture:** One new self-contained main-process module (`src/main/onepassword.js`) owns the 1Password JS SDK client and *all* credential handling; it exposes two pure, unit-tested helpers (`matchesHost`, `buildFillScript`), three SDK-backed async functions (`getClient`, `findLogins`, `revealCredential`), and a `probePackageLoad()` require-probe. `src/main/main.js` gains clearly-commented spike hooks — a fill orchestrator, a per-tab `⌥⌘P` chord listener, and a startup packaging check (a headless `BLANC_1P_PACKAGE_PROBE` probe that exits with a code, plus the `BLANC_1P_SPIKE` GUI hook) — plus a small per-tab navigation-epoch counter folded into the existing navigation handlers. `main.js` never requires the SDK directly. No IPC namespace, store, setting, preload, or renderer change. The SDK is `require`d lazily so a normal packaged startup never loads it, and every entry point is env-gated.

**Tech Stack:** Electron main process (`WebContentsView.executeJavaScript`, `dialog.showMessageBox`, `before-input-event`), `@1password/sdk@0.4.0` (`createClient` + `DesktopAuth`, native `SharedLibCore` bridge), Node's built-in `node --test` for the pure helpers.

## Global Constraints

*Every task's requirements implicitly include this section. Values are copied verbatim from the spec.*

- **This is a spike, not a feature.** Its only output is a yes/no + learnings. Every spike hook in `main.js` carries a `// SPIKE (1Password fill feasibility)` comment. **Env-gating is not release-safety** (the source + SDK dependency still ship, and a user could set `BLANC_1P_SPIKE=1`): **Task 6 removes the spike entirely, and this branch must not merge to `main` with the spike code present.**
- **Dependency, pinned exactly:** `npm i -E @1password/sdk@0.4.0` (pulls transitive `@1password/sdk-core`). Never a caret/tilde range. Re-verify the SDK surface (`createClient`, `DesktopAuth`, `SharedLibCore`, `vaults.list`, `items.list`, `items.get`, `ItemOverview.websites`) on any bump.
- **Lazy require only.** `require('@1password/sdk')` appears **only inside** `onepassword.js`'s function bodies — `getClient` and `probePackageLoad` (never at module top level), so a normal packaged startup never loads it. **`main.js` never requires the SDK directly** — it goes through `onepassword.probePackageLoad()` — so the module boundary is airtight.
- **Enable gate (chord + orchestrator):** `!app.isPackaged || process.env.BLANC_1P_SPIKE === '1'` — dev by default, plus explicit packaged opt-in for the signed-build fallback; never active in a normal shipping build.
- **Packaging-hook gates:** the GUI hook `initSpikePackaging` is `process.env.BLANC_1P_SPIKE === '1'` **only** (not `!app.isPackaged`); the headless probe `runPackageProbeIfRequested` is `process.env.BLANC_1P_PACKAGE_PROBE === '1'` **only** — it logs one line, sets an exit code, and `app.exit()`s.
- **`BLANC_1P_ACCOUNT`** env var (account name/UUID) is **required** by `getClient()` and is **never committed**.
- **Chord contract (physical key, exact modifiers):** `input.type === 'keyDown'` **and** `!input.isAutoRepeat` **and** `input.code === 'KeyP'` (physical — on macOS ⌥ mutates `input.key`) **and** `input.meta && input.alt && !input.control && !input.shift`. A **module-level single-flight boolean** ignores re-triggers until the current fill resolves (released in `.finally()`).
- **Credentials never leave main-process memory + the verified page.** Never exposed to the chrome/overlay renderer, preloads, logs, or any store. **Every outcome logs one result line — never a credential value.**
- **Decrypt exactly one secret.** Matching runs on `items.list()` overviews (website URLs present, credential fields absent). `items.get()` — the only call that returns a password — runs only on the single chosen item.
- **`http(s)`-only allowlist.** Only `http:`/`https:` origins proceed; everything else (`blanc://`, `file://`, `data:`, `view-source:`, blank tab, …) is a no-op. Private tabs **are** allowed.
- **Main frame only.** Cross-origin iframes are not filled.
- **Injection uses `executeJavaScript(source)` single-arg, NO `userGesture`** (setting `value` + events needs no activation; `userGesture:true` would grant the page transient activation).
- **Origin/identity is re-validated, never assumed.** Main-side `wc.getURL() === expectedURL` (Chromium ground truth) before injecting; the injected function's **first act** is the synchronous `location.href === expectedURL && document.hasFocus() && performance.timeOrigin === capturedTimeOrigin` check. Main-world spoofing by a hostile replacement document is an **accepted spike limitation**.
- **Never `npm run release`** for the packaging check — it publishes an immutable GitHub release, which conflicts with spike removal. Use the explicit non-publishing `electron-builder … --publish never` command in Task 5.
- **`onepassword.js` does not touch chrome HTML/CSS/renderers**, so no `⌘R`-vs-relaunch caveat applies to the module or main.js logic — but manual fill tests still require a fresh `npm start` because the chord listener is wired at `createTab` time.

---

## File Structure

- **Create `src/main/onepassword.js`** — the entire SDK + credential surface. Pure helpers `matchesHost`/`buildFillScript` (no SDK, no Electron beyond `require('electron').app` for the version) + SDK-backed `getClient`/`findLogins`/`revealCredential`/`probePackageLoad`. Lazy-requires `@1password/sdk` (only inside `getClient`/`probePackageLoad`).
- **Create `test/unit/onepassword-match.test.js`** — pure `node --test` coverage of `matchesHost` and `buildFillScript`, plus a lazy-require guard. No Electron/SDK/biometrics.
- **Modify `src/main/main.js`** — spike hooks + a nav-epoch counter:
  - Module-level (just above `createTab`, ~line 863): `ONE_PASSWORD_SPIKE_ENABLED`, `onePasswordFillInFlight`, `fillActiveTabFrom1Password()`, `runPackageProbeIfRequested()`, `initSpikePackaging()`.
  - Inside `createTab`: `navEpoch: 0` on the tab object (~line 904), `tab.navEpoch++` in `did-navigate` (line 946) and (main-frame only) `did-navigate-in-page` (line 974), a new `did-start-navigation` handler, and the `before-input-event` chord listener attached to the tab's own `wc` (after line 909).
  - In the `app.whenReady` body: `if (await runPackageProbeIfRequested()) return;` as the first statement, and a fire-and-forget `initSpikePackaging()` after the ad-blocker/test-hook if/else (~line 2107).
- **Modify `package.json` / `package-lock.json`** — the exactly-pinned `@1password/sdk@0.4.0` dependency.

---

### Task 1: `onepassword.js` pure helpers (`matchesHost` + `buildFillScript`) + unit tests

The two functions that need no SDK, no Electron, no biometrics — so they're built first, fully TDD. `matchesHost` is the vault-matching predicate; `buildFillScript` produces the string injected into the page (it embeds the credential, which is why it lives in the credential-owning module and why its escaping is unit-tested).

**Files:**
- Create: `src/main/onepassword.js`
- Test: `test/unit/onepassword-match.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks. Node built-ins only (`URL`).
- Produces:
  - `matchesHost(itemUrls, host) → boolean` — `itemUrls` is an array of stored website strings (possibly scheme-less or malformed); `host` is the target hostname (e.g. `github.com`). Tolerant hostname extraction (prepend `https://` when scheme-less; skip a still-malformed URL, never throw), `www.`-stripped on both sides, **exact host equality** (never substring).
  - `buildFillScript({ expectedURL, expectedTimeOrigin, username, password }) → string` — an IIFE source string for `executeJavaScript`. `username`/`password` may be `null`. All four values embedded via `JSON.stringify`. The IIFE resolves to a **status object only**: `{ originMismatch, filledUser, filledPass }` (with an extra `noPasswordField: true` when no visible password field is found).

- [ ] **Step 1: Write the failing tests**

Create `test/unit/onepassword-match.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesHost, buildFillScript } = require('../../src/main/onepassword');

test('matchesHost: exact host matches', () => {
  assert.equal(matchesHost(['https://github.com/login'], 'github.com'), true);
});

test('matchesHost: www vs bare host both directions', () => {
  assert.equal(matchesHost(['https://www.github.com'], 'github.com'), true);
  assert.equal(matchesHost(['https://github.com'], 'www.github.com'), true);
});

test('matchesHost: scheme-less stored value matches', () => {
  assert.equal(matchesHost(['github.com'], 'github.com'), true);
});

test('matchesHost: subdomain must NOT match', () => {
  assert.equal(matchesHost(['https://login.github.com'], 'github.com'), false);
});

test('matchesHost: substring trap must NOT match', () => {
  assert.equal(matchesHost(['https://github.com.evil.com'], 'github.com'), false);
});

test('matchesHost: item with multiple urls, one matches', () => {
  assert.equal(matchesHost(['https://example.org', 'github.com'], 'github.com'), true);
});

test('matchesHost: item with no urls does not match', () => {
  assert.equal(matchesHost([], 'github.com'), false);
});

test('matchesHost: malformed stored url is skipped, not thrown', () => {
  assert.doesNotThrow(() => matchesHost(['http://', ':::', 'github.com'], 'github.com'));
  assert.equal(matchesHost(['http://', ':::', 'github.com'], 'github.com'), true);
});

test('buildFillScript: embeds expectedURL and timeOrigin via JSON.stringify', () => {
  const s = buildFillScript({ expectedURL: 'https://github.com/login', expectedTimeOrigin: 1234.5, username: 'u', password: 'p' });
  assert.ok(s.includes(JSON.stringify('https://github.com/login')));
  assert.ok(s.includes('1234.5'));
});

test('buildFillScript: dangerous credential chars are safely escaped', () => {
  const nasty = 'a"b\\c\nd\'e';
  const s = buildFillScript({ expectedURL: 'https://x.test/', expectedTimeOrigin: 0, username: null, password: nasty });
  assert.ok(s.includes(JSON.stringify(nasty)));       // embedded encoded
  assert.ok(!s.includes('"' + nasty + '"'));          // never the raw sequence in double quotes
});

test('buildFillScript: contains identity guard, visibility check, native setter', () => {
  const s = buildFillScript({ expectedURL: 'https://x.test/', expectedTimeOrigin: 0, username: 'u', password: 'p' });
  assert.ok(s.includes('location.href'));
  assert.ok(s.includes('document.hasFocus()'));
  assert.ok(s.includes('performance.timeOrigin'));
  assert.ok(s.includes('offsetParent'));
  assert.ok(s.includes('HTMLInputElement.prototype'));
});

test('buildFillScript: null username still embeds a null literal (fills password only)', () => {
  const s = buildFillScript({ expectedURL: 'https://x.test/', expectedTimeOrigin: 0, username: null, password: 'p' });
  assert.ok(s.includes('null !== null'));  // the USER !== null guard resolves to false at runtime
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: FAIL — `Cannot find module '../../src/main/onepassword'`.

- [ ] **Step 3: Write the minimal implementation of the pure helpers**

Create `src/main/onepassword.js` (SDK functions come in Task 2 — this task adds only the pure helpers + module skeleton):

```js
'use strict';

// SPIKE (1Password fill feasibility) — throwaway; remove or keep env-gated
// before any release. This module owns the 1Password SDK client and ALL
// credential handling. `@1password/sdk` is require()d lazily (Task 2) so a
// normal packaged startup never loads it.

/** Extract a comparable hostname from a possibly scheme-less / malformed
 * stored 1Password website value. `www.`-stripped. Returns null on garbage
 * (caller skips it — never throws). */
function normalizeHost(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let host;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null; // still malformed after prepending a scheme
  }
  if (!host) return null;
  return host.replace(/^www\./i, '').toLowerCase();
}

/** True iff any of a Login item's stored website URLs resolves to `host`
 * (both sides `www.`-stripped, EXACT equality — deliberately not substring,
 * so `github.com.evil.com` cannot match `github.com`). */
function matchesHost(itemUrls, host) {
  const target = normalizeHost(host);
  if (!target || !Array.isArray(itemUrls)) return false;
  return itemUrls.some((u) => normalizeHost(u) === target);
}

/** Build the IIFE source injected via executeJavaScript(source). All four
 * inputs are embedded with JSON.stringify (credential strings included), and
 * the IIFE resolves to a STATUS OBJECT ONLY — never the credential values.
 * Its first act is the synchronous identity guard (see the spec's TOCTOU
 * discussion): a new document changes performance.timeOrigin; an SPA
 * pushState route change keeps timeOrigin but changes location.href. */
function buildFillScript({ expectedURL, expectedTimeOrigin, username, password }) {
  const U = JSON.stringify(expectedURL);
  const TO = JSON.stringify(expectedTimeOrigin);
  const USER = JSON.stringify(username ?? null);
  const PASS = JSON.stringify(password ?? null);
  return `(function () {
    if (location.href !== ${U} || !document.hasFocus() || performance.timeOrigin !== ${TO}) {
      return { originMismatch: true, filledUser: false, filledPass: false };
    }
    var isVisible = function (el) {
      if (!el || el.type === 'hidden' || el.offsetParent === null) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    var setNative = function (el, value) {
      var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    var pw = null;
    var pwlist = document.querySelectorAll('input[type=password]');
    for (var i = 0; i < pwlist.length; i++) { if (isVisible(pwlist[i])) { pw = pwlist[i]; break; } }
    if (!pw) return { originMismatch: false, filledUser: false, filledPass: false, noPasswordField: true };
    var filledPass = false, filledUser = false;
    if (${PASS} !== null) { setNative(pw, ${PASS}); filledPass = true; }
    var isText = function (el) { return el && el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'email'); };
    var user = null;
    var active = document.activeElement;
    if (isText(active) && isVisible(active)) {
      user = active;
    } else {
      var scope = pw.form || document;
      var texts = scope.querySelectorAll('input[type=text], input[type=email]');
      for (var j = 0; j < texts.length; j++) {
        if (!isVisible(texts[j])) continue;
        if (pw.compareDocumentPosition(texts[j]) & Node.DOCUMENT_POSITION_PRECEDING) user = texts[j];
      }
    }
    if (user && ${USER} !== null) { setNative(user, ${USER}); filledUser = true; }
    return { originMismatch: false, filledUser: filledUser, filledPass: filledPass };
  })();`;
}

module.exports = { matchesHost, buildFillScript };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: PASS — all `matchesHost` + `buildFillScript` cases green.

- [ ] **Step 5: Run the full unit suite to confirm no regression**

Run: `npm run test:unit`
Expected: PASS — the new file runs alongside the existing suite; nothing else changes.

- [ ] **Step 6: Commit**

```bash
git add src/main/onepassword.js test/unit/onepassword-match.test.js
git commit -m "spike(1p): pure host-match + fill-script builder with unit tests"
```

---

### Task 2: SDK-backed `getClient` / `findLogins` / `revealCredential` + lazy-require guard

Adds the credential-reading half of `onepassword.js` and pins the SDK. These three functions can't be unit-tested without a live, unlocked 1Password app + biometrics (that's what Task 5 proves), so the automated deliverable here is (a) the dependency resolves and (b) the **lazy-require guarantee** holds — merely `require('./onepassword')` must not pull `@1password/sdk` into the module cache.

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm i -E`)
- Modify: `src/main/onepassword.js` (append SDK functions + exports)
- Test: `test/unit/onepassword-match.test.js` (add the lazy-require guard test)

**Interfaces:**
- Consumes: `matchesHost` (Task 1), `@1password/sdk@0.4.0` (`createClient`, `DesktopAuth`).
- Produces:
  - `getClient() → Promise<Client>` — lazily constructs + caches one client via `DesktopAuth(process.env.BLANC_1P_ACCOUNT)`; throws if `BLANC_1P_ACCOUNT` is unset; discards the cache only on an unrecoverable failure.
  - `findLogins(expectedHost) → Promise<Array<{ vaultId, itemId, title }>>` — matches on overviews; **decrypts no secret**. Tolerates an inaccessible vault (skips it).
  - `revealCredential(vaultId, itemId) → Promise<{ username: string|null, password: string|null }>` — the **only** call that decrypts a secret; reads the built-in `password` (`id === 'password'`) and `username` (`id === 'username'`) fields, **no fieldType fallback**.
  - `probePackageLoad() → void` — `require('@1password/sdk')` (criterion 3(a)); throws if the package/WASM can't load. Keeps the SDK require out of `main.js`.

- [ ] **Step 1: Pin the SDK**

Run: `npm i -E @1password/sdk@0.4.0`
Expected: `package.json` `dependencies` gains `"@1password/sdk": "0.4.0"` (no `^`/`~`); `package-lock.json` records it + transitive `@1password/sdk-core`.

Verify the pin:

Run: `node -e "console.log(require('./package.json').dependencies['@1password/sdk'])"`
Expected output: `0.4.0`

- [ ] **Step 2: Write the failing lazy-require guard test**

Append to `test/unit/onepassword-match.test.js`:

```js
test('requiring onepassword.js does NOT eagerly load the 1Password SDK', () => {
  // The module must stay import-light: `@1password/sdk` is loaded only inside
  // the SDK functions, so a normal packaged startup never pays for it.
  const resolved = require.resolve('../../src/main/onepassword');
  delete require.cache[resolved];
  require('../../src/main/onepassword');
  const sdkLoaded = Object.keys(require.cache).some((p) => p.includes('@1password' + require('path').sep + 'sdk'));
  assert.equal(sdkLoaded, false);
});
```

- [ ] **Step 3: Run the guard test to verify it fails or passes for the right reason**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: PASS already (Task 1's module has no top-level SDK require). This test **locks in** that property before Step 4 adds the SDK functions — if Step 4 accidentally hoists the `require` to module scope, this test flips to FAIL.

- [ ] **Step 4: Append the SDK functions**

Add to `src/main/onepassword.js`, immediately above the final `module.exports` line, and extend the exports. **The `require('@1password/sdk')` stays inside `getClient` — never at module top level:**

```js
const { app } = require('electron');

let cachedClient = null;

/** Lazily construct + cache the SDK client via the native desktop-app bridge
 * (DesktopAuth → SharedLibCore → dlopen of 1Password's libop_sdk_ipc_client).
 * BLANC_1P_ACCOUNT is required and never committed. The cache is discarded
 * only on an unrecoverable failure — the SDK re-authorizes an ordinary
 * ~10-min session expiry itself. */
async function getClient() {
  if (cachedClient) return cachedClient;
  const account = process.env.BLANC_1P_ACCOUNT;
  if (!account) throw new Error('BLANC_1P_ACCOUNT is not set');
  const { createClient, DesktopAuth } = require('@1password/sdk'); // lazy — never at module scope
  cachedClient = await createClient({
    auth: new DesktopAuth(account),
    integrationName: 'Blanc',
    integrationVersion: app.getVersion(),
  });
  return cachedClient;
}

/** Match Login items against `expectedHost` on OVERVIEWS only — no secret is
 * decrypted here. Skips a vault that can't be listed (logged by caller). */
async function findLogins(expectedHost) {
  const client = await getClient();
  const matches = [];
  const vaults = await client.vaults.list();
  for (const vault of vaults) {
    let overviews;
    try {
      overviews = await client.items.list(vault.id);
    } catch {
      continue; // inaccessible vault — skip, don't abort the whole search
    }
    for (const ov of overviews) {
      if (ov.category !== 'Login') continue;
      const urls = Array.isArray(ov.websites) ? ov.websites.map((w) => w.url) : [];
      if (matchesHost(urls, expectedHost)) {
        matches.push({ vaultId: vault.id, itemId: ov.id, title: ov.title });
      }
    }
  }
  return matches;
}

/** Decrypt exactly the one chosen item and read its BUILT-IN username +
 * password fields (by id — no "first Concealed field" fallback, which could
 * return a custom PIN/recovery secret). A missing built-in field returns null
 * (a defined outcome), never a guess. */
async function revealCredential(vaultId, itemId) {
  const client = await getClient();
  const item = await client.items.get(vaultId, itemId);
  const fields = Array.isArray(item.fields) ? item.fields : [];
  const read = (id) => {
    const f = fields.find((x) => x.id === id);
    return f && typeof f.value === 'string' ? f.value : null;
  };
  return { username: read('username'), password: read('password') };
}

/** Criterion 3(a) probe: force-load the SDK package — module resolution +
 * @1password/sdk-core's eager core_bg.wasm compile — WITHOUT authenticating.
 * Throws if the package can't load. Lives here (not in main.js) so the
 * `require('@1password/sdk')` stays confined to this module, alongside
 * getClient — preserving the lazy-require boundary. Never authenticates, so it
 * does not dlopen the native 1Password bridge (that's getClient/criterion 3b). */
function probePackageLoad() {
  require('@1password/sdk'); // lazy — the only other place this is required
}
```

Change the final export line to:

```js
module.exports = { matchesHost, buildFillScript, getClient, findLogins, revealCredential, probePackageLoad };
```

- [ ] **Step 5: Confirm the lazy-require guard still passes and the module loads**

Run: `node --test test/unit/onepassword-match.test.js`
Expected: PASS — the lazy-require guard stays green (SDK not in cache after a bare require), and Task 1's tests are unaffected.

- [ ] **Step 6: Syntax-check the module resolves against the installed SDK**

Run: `node --check src/main/onepassword.js`
Expected: no output (exit 0) — the file parses.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/main/onepassword.js test/unit/onepassword-match.test.js
git commit -m "spike(1p): pin @1password/sdk@0.4.0 + getClient/findLogins/revealCredential"
```

---

### Task 3: Fill orchestrator + nav-epoch counter + `⌥⌘P` chord (end-to-end deliverable)

The first manually-runnable deliverable: press `⌥⌘P` on a login page → Touch ID → both fields fill. This is one test cycle (orchestrator, chord, and epoch counter are useless apart), so it's one task with grouped steps. All three edits live in `src/main/main.js` and are commented spike-only.

**Files:**
- Modify: `src/main/main.js`

**Interfaces:**
- Consumes: `onepassword.findLogins`, `onepassword.revealCredential`, `onepassword.buildFillScript` (Tasks 1–2); existing `win`, `activeTabId`, `tabs`, `hasLiveWindow`, `dialog`, `app`.
- Produces: module-level `ONE_PASSWORD_SPIKE_ENABLED` (bool), `onePasswordFillInFlight` (bool), `fillActiveTabFrom1Password() → Promise<void>`; a `navEpoch` field on every tab; a chord listener on each tab's `wc`.

- [ ] **Step 1: Add the `navEpoch` field to the tab object**

In `createTab`'s `tab` object literal (`src/main/main.js`, after `historyEligible: true,` — the last field, ~line 904), add:

```js
    // SPIKE (1Password fill feasibility) — bumped on any main-frame navigation
    // start/commit so the async fill can detect a page swap mid-flow.
    navEpoch: 0,
```

- [ ] **Step 2: Bump the epoch in the existing navigation handlers**

In `did-navigate` (~line 946), add `tab.navEpoch++;` as the first statement of the handler body:

```js
  wc.on('did-navigate', (_e, url, httpResponseCode) => {
    tab.navEpoch++; // SPIKE (1Password fill feasibility)
    const shouldReclaimChromeFocus = url === tab.url && tabsWantingAddressBarFocus.has(id) && activeTabId === id;
```

In `did-navigate-in-page` (~line 974), bump the epoch **only for the main frame** — this event fires for *any* frame (a cross-origin ad iframe changing its hash/history during the async Touch ID window would otherwise false-abort a valid fill), and the handler already receives `isMainFrame`:

```js
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) tab.navEpoch++; // SPIKE (1Password fill feasibility) — main frame only
    syncNavState();
```

Then add a **new** handler immediately after the `did-navigate-in-page` handler's closing `});` (~line 983) — catches a navigation that *begins* mid-flow, not only one that completes:

```js
  // SPIKE (1Password fill feasibility) — a main-frame navigation that STARTS
  // after the orchestrator's main-side URL check would still let
  // executeJavaScript run in the replacement document; bump the epoch so the
  // pre-injection re-check aborts. Removed with the rest of the spike.
  wc.on('did-start-navigation', (_e, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) tab.navEpoch++;
  });
```

- [ ] **Step 3: Add module-level spike state + the orchestrator**

Immediately **above** `function createTab(...)` (~line 865, after the `TAB_WEB_PREFERENCES` block closes at line 863), add:

```js
// ─── SPIKE (1Password fill feasibility) — remove before release ───────────
// Fill the active tab's login form from 1Password behind Touch ID, with no
// browser extension. Env-gated; credentials live only in main memory + the
// verified page, and every outcome logs a result line, never a value.
const ONE_PASSWORD_SPIKE_ENABLED = !app.isPackaged || process.env.BLANC_1P_SPIKE === '1';
let onePasswordFillInFlight = false;

async function fillActiveTabFrom1Password() {
  const log = (result, extra) => console.log(`[1p-spike] ${result}${extra ? ' ' + extra : ''}`);
  const onepassword = require('./onepassword'); // ./onepassword only — the SDK stays lazy inside it
  let capturedTabId, tab, wc, expectedURL, expectedHost, capturedEpoch, capturedTimeOrigin, chosen;

  // ── PHASE 1 (pre-reveal): NO credential is in memory yet, so err.message is
  //    safe to log for diagnosis. ──
  try {
    if (!hasLiveWindow() || !activeTabId) return log('no-active-tab');
    capturedTabId = activeTabId;
    tab = tabs.get(capturedTabId);
    if (!tab) return log('no-active-tab');
    wc = tab.view.webContents;
    expectedURL = wc.getURL();
    if (!/^https?:\/\//i.test(expectedURL)) return log('non-http-noop');
    expectedHost = new URL(expectedURL).hostname;
    capturedEpoch = tab.navEpoch;
    capturedTimeOrigin = await wc.executeJavaScript('performance.timeOrigin');

    const matches = await onepassword.findLogins(expectedHost);
    if (matches.length === 0) return log('no-match', expectedHost);
    chosen = matches[0];
    if (matches.length > 1) {
      // The vault search was async — if the window died meanwhile, don't ask
      // the user to choose a login for a window that no longer exists (the
      // post-reveal re-validation would abort anyway). Also keeps `win` safe
      // to pass as the dialog parent (documented overloads only).
      if (!hasLiveWindow()) return log('abort-window-changed');
      const buttons = matches.map((m) => m.title || '(untitled)');
      const cancelId = buttons.length;
      buttons.push('Cancel');
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        title: 'Fill from 1Password',
        message: `Choose a login for ${expectedHost}`,
        buttons,
        cancelId,
        noLink: true,
      });
      if (response < 0 || response >= matches.length) return log('chooser-cancel');
      chosen = matches[response];
    }
  } catch (err) {
    return log('setup-error', err?.message); // pre-reveal only — credential-free
  }

  // ── PHASE 2 (reveal + fill): a credential is in memory from revealCredential
  //    onward. This whole block is a BINDING-LESS try — every failure (a
  //    page-controlled executeJavaScript rejection, OR any other throw once the
  //    credential exists) logs a FIXED classification, so no error string can
  //    ever echo the credential. ──
  try {
    const { username, password } = await onepassword.revealCredential(chosen.vaultId, chosen.itemId);
    if (password == null && username == null) return log('empty-item');

    // Re-validate after the async auth/chooser: same live+focused window, same
    // active tab, live+focused webContents, unchanged epoch, exact same URL.
    if (!hasLiveWindow() || !win.isFocused()) return log('abort-window-changed');
    if (activeTabId !== capturedTabId || !tabs.has(capturedTabId)) return log('abort-tab-changed');
    if (wc.isDestroyed() || !wc.isFocused()) return log('abort-wc-changed');
    if (tab.navEpoch !== capturedEpoch) return log('abort-navigated');
    if (wc.getURL() !== expectedURL) return log('abort-url-changed');

    // Injection runs in the page's MAIN WORLD (a hostile page could override the
    // value setter to throw an Error echoing the value) — the binding-less catch
    // below is what makes that message unloggable.
    const source = onepassword.buildFillScript({ expectedURL, expectedTimeOrigin: capturedTimeOrigin, username, password });
    const status = await wc.executeJavaScript(source); // single-arg, no userGesture
    if (status?.originMismatch) return log('origin-or-focus-mismatch');
    if (status?.noPasswordField) return log('no-password-field');
    if (status?.filledPass && status?.filledUser) return log('filled', 'user+pass');
    if (status?.filledPass) return log('filled', 'pass-only (username field not found)');
    return log('nothing-filled');
  } catch {
    return log('fill-error'); // no binding, no message — a credential is in memory
  }
}

async function initSpikePackaging() { /* filled in Task 4 */ }
// ─── end SPIKE ────────────────────────────────────────────────────────────
```

*(The `initSpikePackaging` stub is a placeholder line so the module parses; Task 4 replaces its body. Leave the stub exactly as shown.)*

- [ ] **Step 4: Wire the chord listener into `createTab`**

In `createTab`, immediately after `const wc = view.webContents;` (~line 909), add:

```js
  // SPIKE (1Password fill feasibility) — ⌥⌘P on the tab's OWN webContents
  // (the overlay before-input-event listener never sees page-focused keys).
  if (ONE_PASSWORD_SPIKE_ENABLED) {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat) return;
      if (input.code !== 'KeyP') return; // physical key — ⌥ mutates input.key on macOS
      if (!(input.meta && input.alt && !input.control && !input.shift)) return; // one modifier off ⌘P Print
      // Consume the chord BEFORE the single-flight check — a recognized second
      // press must not fall through to the page, it just doesn't start a fill.
      event.preventDefault();
      if (onePasswordFillInFlight) return; // single-flight
      onePasswordFillInFlight = true;
      fillActiveTabFrom1Password()
        .catch((err) => console.warn('[1p-spike] fill error:', err?.message))
        .finally(() => { onePasswordFillInFlight = false; });
    });
  }
```

- [ ] **Step 5: Syntax-check main.js**

Run: `node --check src/main/main.js`
Expected: no output (exit 0).

- [ ] **Step 6: Confirm the unit suite still passes (no accidental cross-file break)**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 7: Manual smoke — the core success criterion**

Complete the one-time setup prerequisites first (1Password 8 at `/Applications`, unlocked; Settings → Developer → *Integrate with the 1Password SDKs* → *Integrate with other apps*; Settings → Security → Touch ID; a Login item for `github.com`). Then, from a fresh launch (the chord listener wires at `createTab` time — relaunch, don't `⌘R`):

```bash
op run --env-file=.env.1password --no-masking -- env BLANC_1P_ACCOUNT="<your-account>" npm start
```

*(`BLANC_1P_ACCOUNT` is required and uncommitted; substitute your account name/UUID. `op run` is only needed if you keep the account id in 1Password — otherwise `BLANC_1P_ACCOUNT=<id> npm start`.)*

Verify against the spec's manual matrix, reading the `[1p-spike]` log lines in the terminal:
- `https://github.com/login` (matching login) → `⌥⌘P` → Touch ID (first use per ~10-min SDK session) → **both fields populate and retain their values**; log `filled user+pass`. A second `⌥⌘P` within the session fills with no prompt.
- Two matching logins → native chooser → pick fills; **Cancel** → `chooser-cancel`, no fill.
- No match → `no-match`, no-op. `blanc://settings/`, `file://…` (page content focused) → `non-http-noop`.
- A **blank new tab** → safe no-op with **no log line at all**: Blanc parks focus in the address overlay, whose webContents carries no chord listener, so `⌥⌘P` never reaches a tab `wc`. (Clicking into the blank page's content first would surface `non-http-noop`.) Deliberately not "fixed" — the overlay needs no listener for a spike.
- **Double-press fast** → only one flow runs (keyDown + `!isAutoRepeat` + single-flight); the second press is consumed — no page keystroke, no log.
- **Reload / cross-doc nav mid-flow** (trigger during the Touch ID prompt, then reload) → `abort-navigated` or `origin-or-focus-mismatch`; nothing written. **SPA `pushState` route change mid-flow** → `abort-url-changed`.
- **Switch or close the tab/window mid-flow** → `abort-tab-changed` / `abort-window-changed`; nothing written.
- **Touch ID blur then refocus** → still fills (transient blur alone doesn't abort).

> **Execution record (2026-07-12):** core matrix **passed** — fill+retain (`filled user+pass` on a real login item, values held, no form submission), silent session reuse, single-flight under double-press, `no-match github.com`, blank-tab safe no-op (silent, per above). **Untested** (missing fixtures / un-hittable timing windows): multi-match chooser + Cancel, reload/SPA/tab-switch/window-close mid-auth, Touch ID blur-refocus. Those mid-flow guards stand on code review only — carry them into the spec's Findings (Task 5 Step 6) as untested.

- [ ] **Step 8: Commit**

```bash
git add src/main/main.js
git commit -m "spike(1p): fill orchestrator + nav-epoch + ⌥⌘P chord"
```

---

### Task 4: packaging startup hooks (criteria 3a + 3b)

The packaging criteria need signals a *notarized* build can log: 3(a) that the SDK module even loads in a packaged app, and 3(b) that `createClient(DesktopAuth)` + `vaults.list()` survive the hardened runtime + Gatekeeper. Two entry points: a **headless** `runPackageProbeIfRequested()` that loads the SDK, logs one line, and exits with a **code** (so 3(a) is a clean automated check, not a `grep` of a long-running GUI), and the **GUI** `initSpikePackaging()` that logs both lines during the 3(b) notarized run. This replaces the Task 3 stub and wires both calls.

**Files:**
- Modify: `src/main/main.js`

**Interfaces:**
- Consumes: `onepassword.probePackageLoad` + `onepassword.getClient` (Task 2). `initSpikePackaging` gated on `BLANC_1P_SPIKE === '1'`; the headless probe gated on `BLANC_1P_PACKAGE_PROBE === '1'`.
- Produces:
  - `runPackageProbeIfRequested() → Promise<boolean>` — **headless** criterion 3(a): if `BLANC_1P_PACKAGE_PROBE === '1'`, load the SDK, log one line, `app.exit(0|1)`; else return `false`. Called first in `app.whenReady`.
  - `initSpikePackaging() → Promise<void>` — the **GUI** path (fire-and-forget): logs `package probe: PASS|FAIL` (3a) then `core smoke: PASS|FAIL|INCONCLUSIVE` (3b). Called later in `app.whenReady`.

- [ ] **Step 1: Replace the stub body + add the headless probe**

The GUI startup log alone can't be a clean automated check — Blanc is a long-running process, so piping it into `grep` orphans the app and can't distinguish PASS from FAIL by exit status. So there are **two** entry points: a headless, self-terminating probe with a real **exit code** for criterion 3(a), and the GUI hook that logs both lines during the notarized 3(b) run. Both load the SDK through `onepassword.probePackageLoad()` — **no `require('@1password/sdk')` in `main.js`**, so the lazy-require boundary (Global Constraints) still holds.

Replace the `async function initSpikePackaging() { /* filled in Task 4 */ }` line (added in Task 3) with:

```js
// SPIKE (1Password fill feasibility) — headless criterion 3(a). Gated on its
// OWN env var so it can run without a GUI/account: load the SDK package inside
// packaged Electron (asar resolution + @1password/sdk-core's eager core_bg.wasm
// compile), log ONE line, set a real exit code, and terminate. app.exit() is
// used (not app.quit()) so native handles the SDK may open can't stall exit.
async function runPackageProbeIfRequested() {
  if (process.env.BLANC_1P_PACKAGE_PROBE !== '1') return false;
  try {
    require('./onepassword').probePackageLoad();
    console.log('[1p-spike] package probe: PASS (require resolved + WASM compiled)');
    app.exit(0);
  } catch (err) {
    console.warn(`[1p-spike] package probe: FAIL — ${err?.message || err}`);
    app.exit(1);
  }
  return true; // unreachable after app.exit; kept for call-site clarity
}

// SPIKE (1Password fill feasibility) — GUI startup checks. Gated
// BLANC_1P_SPIKE === '1'. Two independent lines:
//   3(a) package probe — does the SDK module LOAD in this build?
//   3(b) core smoke    — does DesktopAuth dlopen + authenticate under a
//                        notarized/hardened build?
async function initSpikePackaging() {
  if (process.env.BLANC_1P_SPIKE !== '1') return;

  // 3(a): load the package (asar loader active, eager core_bg.wasm compile).
  try {
    require('./onepassword').probePackageLoad();
    console.log('[1p-spike] package probe: PASS (require resolved + WASM compiled)');
  } catch (err) {
    console.warn(`[1p-spike] package probe: FAIL — ${err?.message || err}`);
  }

  // 3(b): the native bridge round-trip. Decisive by default — everything is a
  // FAIL unless it matches the biometric-cancel signature (/cancell?ed/i), a
  // best-effort INCONCLUSIVE (bridge state then unknowable). "denied"/"not
  // allowed"/policy/auth errors are real FAILs (the round-trip did not work). A
  // genuine cancel misread as FAIL isn't worth chasing for throwaway code — just
  // re-run the smoke without cancelling.
  try {
    const client = await require('./onepassword').getClient();
    await client.vaults.list();
    console.log('[1p-spike] core smoke: PASS (DesktopAuth + vaults.list)');
  } catch (err) {
    const msg = err?.message || String(err);
    if (/cancell?ed/i.test(msg)) {
      console.log(`[1p-spike] core smoke: INCONCLUSIVE (biometric cancelled) — ${msg}`);
    } else {
      const bridge = /dlopen|libop_sdk_ipc_client|image not found|code ?sign|library/i.test(msg);
      console.warn(`[1p-spike] core smoke: FAIL${bridge ? ' (native bridge did not load)' : ''} — ${msg}`);
    }
  }
}
```

*(Every `msg` here is a library/auth error string — `vaults.list()` returns no secrets, and neither probe authenticates during the require — so no credential can appear in these lines.)*

- [ ] **Step 2: Wire both calls into startup**

The headless probe must run **before** any window/ad-engine setup and short-circuit startup. Add it as the **first statement** inside the `app.whenReady().then(async () => { … })` callback (find it near the ad-blocker/test-hook block, `src/main/main.js`):

```js
  if (await runPackageProbeIfRequested()) return; // SPIKE — headless 3(a); app.exit() already fired
```

Then, immediately after the ad-blocker / test-hook `if (isAcceptanceTest) { … } else { … }` block closes (~line 2107), add the GUI hook:

```js
  initSpikePackaging(); // SPIKE (1Password fill feasibility) — fire-and-forget, gated on BLANC_1P_SPIKE
```

- [ ] **Step 3: Syntax-check + unit suite**

Run: `node --check src/main/main.js && npm run test:unit`
Expected: `node --check` silent (exit 0); unit suite PASS.

- [ ] **Step 4: Manual smoke in dev (sanity before the packaged run in Task 5)**

Run: `BLANC_1P_SPIKE=1 BLANC_1P_ACCOUNT="<your-account>" npm start`
Expected: on startup, two lines — `[1p-spike] package probe: PASS (require resolved + WASM compiled)`, then a Touch ID prompt → `[1p-spike] core smoke: PASS (DesktopAuth + vaults.list)` (or `INCONCLUSIVE` if you cancel). A `core smoke: FAIL (native bridge did not load)` here means the dev `Electron` binary can't `dlopen` the 1Password bridge — note it; Task 5's signed build is the authoritative check. (In dev, `require()` runs off the unpacked source tree, so the *package probe* is only meaningful once packaged — see Task 5 Step 1.)

Then sanity-check the headless probe exits cleanly with a code (it needs no account):

```bash
BLANC_1P_PACKAGE_PROBE=1 npm start
rc=$?   # NOT `status` — that's a read-only special variable in zsh (macOS default shell)
echo "exit=$rc"
test "$rc" -eq 0   # same reason as Task 5 Step 1 — don't let echo mask a FAIL
```
Expected: one `[1p-spike] package probe: PASS …` line, the app quits on its own, and `exit=0`. *(In dev this loads from `node_modules`, so it should always PASS; the meaningful run is the packaged one in Task 5 Step 1.)*

- [ ] **Step 5: Commit**

```bash
git add src/main/main.js
git commit -m "spike(1p): initSpikePackaging startup hook for criteria 3(a)+3(b)"
```

---

### Task 5: Packaging verification (criteria 3a + 3b) — the genuine unknown

Manual verification only — no code. Proves the SDK survives a real build: (a) `require('@1password/sdk')` resolves in a packaged app, and (b) the native `DesktopAuth` bridge `dlopen`s and authenticates under the hardened runtime **+ notarization + Gatekeeper**. These cannot be automated (they need real hardware, a signing environment, and biometrics). **Never use `npm run release`** — it publishes an immutable release, conflicting with spike removal.

**Files:** none (verification of built artifacts).

- [ ] **Step 1: Criterion 3(a) — the SDK module actually loads in a packaged app**

Build an unpacked packaged app and run the **headless probe** (`BLANC_1P_PACKAGE_PROBE=1`) — it needs no account, loads the SDK, logs one line, and self-terminates with an exit code, so the criterion reduces to a captured `rc=$?` + `test`. Do **not** pipe the GUI startup into `grep`: Blanc is long-running, so `grep -m1` would orphan the app, could EPIPE its next write, and (matching PASS *and* FAIL) its exit status wouldn't mean "passed." Also don't try host-Node `require.resolve` against `app.asar`: plain `node` has no ASAR loader hook (false `MODULE_NOT_FOUND`) and `require.resolve` never executes the module, so it can't prove the eager `core_bg.wasm` compile the criterion is about.

```bash
npm run dist:dir
BLANC_1P_PACKAGE_PROBE=1 "dist/mac-arm64/Blanc.app/Contents/MacOS/Blanc" --user-data-dir="$(mktemp -d)"
rc=$?   # NOT `status` — that's a read-only special variable in zsh (macOS default shell)
echo "exit=$rc"
test "$rc" -eq 0   # propagates the probe's real result as this block's exit status
```
Expected: one line `[1p-spike] package probe: PASS (require resolved + WASM compiled)`, the app quits on its own, and `exit=0` (the `test` succeeds). A `package probe: FAIL` + `exit=1` (the `test` fails) means the module (or its eager `core_bg.wasm`) isn't loadable from inside the asar — add an `asarUnpack` glob for `@1password/sdk` to `package.json` `build.asarUnpack`, rebuild, and re-run. *(The trailing `test` matters: `…; echo "exit=$?"` alone would leave the block's exit status as `echo`'s 0, so an automated executor would read every run as a pass. Per the spec, the native `SharedLibCore` path doesn't itself use the bundled WASM, so the unpack may be unnecessary — this probe decides it. `dist/mac-arm64` is the Apple-Silicon output dir; adjust for an Intel/`--x64` build.)*

- [ ] **Step 2: Criterion 3(b) — build a truly notarized artifact (explicit non-publishing)**

Run the non-publishing command from the spec, restricted to **arm64** — the dev machine is Apple Silicon and the spike's native-bridge check can only be exercised here, so building the x64 slice too would just double the notarization round-trips for an artifact you can't test:

```bash
op run --env-file=.env.1password --no-masking -- npx electron-builder --mac zip --arm64 --publish never
```
Expected: a single signed + notarized `Blanc-<version>-arm64-mac.zip` in `dist/` plus `dist/mac-arm64/Blanc.app` (the repo's `afterSign`/notarize wiring runs). **Do not** use `dist:dir` here (electron-builder treats it as an unsigned/unnotarized unpacked dev artifact), and **never `npm run release`** (it publishes an immutable tag).

- [ ] **Step 3: Verify signature, Gatekeeper, and notarization stapling**

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Blanc.app"
spctl -a -vv "dist/mac-arm64/Blanc.app"
xcrun stapler validate "dist/mac-arm64/Blanc.app"
```
Expected: `valid on disk` / `satisfies its Designated Requirement`; `accepted` + `source=Notarized Developer ID`; `The validate action worked!`.

- [ ] **Step 4: Launch the notarized build with the spike enabled + a throwaway profile**

Extract the notarized `.zip`, ensure 1Password is running/unlocked, then run the binary directly (so stdout is readable for the smoke line):

```bash
BLANC_1P_SPIKE=1 BLANC_1P_ACCOUNT="<your-account>" \
  "/path/to/extracted/Blanc.app/Contents/MacOS/Blanc" --user-data-dir="$(mktemp -d)"
```
*(The throwaway `--user-data-dir` keeps the real profile and single-instance lock untouched.)*

Expected: Touch ID prompt naming `Blanc` → `[1p-spike] core smoke: PASS (DesktopAuth + vaults.list)`. This proves the `dlopen` of `libop_sdk_ipc_client.dylib` works under the hardened runtime + `disable-library-validation`. A `FAIL (native bridge did not load)` is the decisive negative — record it verbatim; `INCONCLUSIVE` means the biometric was cancelled, re-run.

**Notarization evidence comes from Step 3, not this launch.** A locally-extracted zip carries **no** `com.apple.quarantine` attribute, and launching the inner Mach-O directly **skips** the LaunchServices first-launch Gatekeeper assessment — so this run does not by itself exercise the download/first-open path. To additionally confirm Gatekeeper admits the notarized bundle on a real first launch, use a **second, pristine extraction that has never been launched** (re-quarantining the copy you already ran directly isn't a true first-open — LaunchServices may have registered it), stamp quarantine *before* any launch, verify the attribute, then `open`:

```bash
ZIP="$(ls -t dist/Blanc-*-arm64-mac.zip | head -1)"              # the arm64 artifact from Step 2 (NOT Blanc-<v>-mac.zip, which is x64)
FRESH="$(mktemp -d)/Blanc.app"
ditto -xk "$ZIP" "$(dirname "$FRESH")"                           # fresh extraction, never launched
xattr -w com.apple.quarantine "0081;0;Safari;" "$FRESH"
xattr -p com.apple.quarantine "$FRESH"                           # verify the attribute is present
open "$FRESH" --args --user-data-dir="$(mktemp -d)"             # LaunchServices first-open, throwaway profile; expect NO Gatekeeper block, then quit
```
*(`open` detaches stdout, so this only proves Gatekeeper admits the bundle — keep using the direct run above to read the smoke line. `--args --user-data-dir=…` keeps this off the real Blanc profile and single-instance lock; it still emits one packaged launch ping under a throwaway `installId` — a harmless orphan, since GUI launches via `open` don't inherit the shell env and this bundle never runs again.)*

- [ ] **Step 5: (Optional) full auth+fill on the signed build**

With the same notarized launch, open `https://github.com/login`, press `⌥⌘P`, confirm Touch ID → both fields fill (the `BLANC_1P_SPIKE=1` flag also enables the chord in a packaged build). This is the end-to-end proof under real signing, not just the headless smoke.

- [ ] **Step 6: Record the spike outcome**

Append a short **Findings** section to the spec file (`docs/superpowers/specs/2026-07-12-1password-autofill-spike-design.md`) — PASS/FAIL per criterion (1, 2, 3a, 3b), the decisive log lines, and whether `asarUnpack` was needed. Commit:

```bash
git add docs/superpowers/specs/2026-07-12-1password-autofill-spike-design.md
git commit -m "spike(1p): record feasibility findings"
```

*(Per the spec: on success, a separate spec designs the real engine; on failure, this documents the dead end. Either way the spike code does not ship — proceed to Task 6.)*

---

### Task 6: Tear down the spike (release-safety gate)

Once findings are recorded, the spike code and its SDK dependency come **out of the branch**. Env-gating alone is not release-safety: the source and `@1password/sdk` (plus its native `dlopen` of a third-party dylib) would still be *packaged* into every shipped build, and any user could enable experimental credential-handling code by setting `BLANC_1P_SPIKE=1`. This task reverts everything the spike added; the only durable artifact is the Findings section in the spec (Task 5 Step 6). **This branch must not merge to `main` with the spike code present** — either this task runs first, or the branch stays unmerged until it does.

**Files:**
- Delete: `src/main/onepassword.js`, `test/unit/onepassword-match.test.js`
- Modify: `src/main/main.js` (remove all three hooks + the nav-epoch edits), `package.json`, `package-lock.json`

**Interfaces:** none produced (net-zero to shipping code).

- [ ] **Step 1: Remove the module and its test**

```bash
git rm src/main/onepassword.js test/unit/onepassword-match.test.js
```

- [ ] **Step 2: Remove the `main.js` hooks**

Delete, in `src/main/main.js`: the `// ─── SPIKE …` block above `createTab` (module-level `ONE_PASSWORD_SPIKE_ENABLED`/`onePasswordFillInFlight`, `fillActiveTabFrom1Password`, `runPackageProbeIfRequested`, `initSpikePackaging`); the `before-input-event` chord listener inside `createTab`; both `app.whenReady` calls (`if (await runPackageProbeIfRequested()) return;` and `initSpikePackaging();`); the new `did-start-navigation` handler; the `navEpoch: 0` tab field; and the `tab.navEpoch++` lines in `did-navigate` / `did-navigate-in-page`. Grep to confirm nothing remains:

Run: `grep -n 'navEpoch\|SPIKE\|1p-spike\|onePassword\|runPackageProbe\|initSpikePackaging\|ONE_PASSWORD_SPIKE\|BLANC_1P' src/main/main.js`
Expected: no output.

- [ ] **Step 3: Remove the dependency**

Run: `npm uninstall @1password/sdk`
Then confirm it (and its transitive core) are gone from the manifests:

Run: `grep -n '1password' package.json package-lock.json`
Expected: no output.

- [ ] **Step 4: Verify the app is back to a clean baseline**

Run: `node --check src/main/main.js && npm run test:unit`
Expected: `node --check` silent (exit 0); unit suite PASS (the `onepassword-match` file is gone, everything else green).

Run: `git grep -n '1p-spike\|@1password' -- ':!docs'`
Expected: no output outside `docs/` (the Findings in the spec are the only retained trace).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "spike(1p): tear down feasibility spike (findings retained in spec)"
```

---

## Self-Review

**Spec coverage:**
- *Behavior* trigger/capture/match/reveal/re-validate/inject → Task 3 orchestrator + Task 1 `buildFillScript`. ✅
- `http(s)`-only allowlist, private tabs allowed → Task 3 Step 3 (`/^https?:\/\//i`); private tabs aren't excluded. ✅
- Zero/one/multiple-match handling + native chooser (webauthn pattern) → Task 3 Step 3. ✅
- Three re-validation layers (window/tab/wc/epoch/exact-URL, then in-page `location.href`+`timeOrigin`+`hasFocus`) → Task 3 Steps 2–3 + Task 1 `buildFillScript`. ✅
- *Architecture*: `onepassword.js` (getClient/findLogins/revealCredential/probePackageLoad + matchesHost/buildFillScript) → Tasks 1–2; the `main.js` spike hooks (orchestrator, chord, headless probe + GUI packaging hook) → Tasks 3–4; nav-epoch on `did-navigate`/`did-navigate-in-page` (main-frame)/`did-start-navigation` → Task 3 Step 2; pinned `@1password/sdk@0.4.0` (+ transitive core) → Task 2 Step 1; lazy require (SDK never in `main.js`) → Task 2 Step 4 + guard test Step 2. ✅
- Chord contract (physical `KeyP`, exact modifiers, keyDown, `!isAutoRepeat`, single-flight, on tab `wc` not overlay) → Task 3 Step 4. ✅
- Injection via single-arg `executeJavaScript`, no `userGesture`; native setter + bubbling events; visible-field detection; status-object-only return → Task 1 `buildFillScript` + Task 3 Step 3. ✅
- `revealCredential` reads built-in `password`/`username` by id, no fieldType fallback, null = defined outcome → Task 2 Step 4. ✅
- Security posture (credentials main-only, one decrypt, exact-URL authority, main-world spoofing accepted, native bridge under hardened runtime) → Global Constraints + Tasks 2–3. ✅
- Success criteria 1/2/3a/3b + setup prerequisites → Task 3 Step 7, Task 4, Task 5. ✅
- Testing (unit matchesHost matrix + manual matrix + packaging) → Task 1 Step 1, Task 3 Step 7, Task 5. ✅
- Non-goals (no Dashlane, no isolated world, no save/TOTP/iframe, no `/1password` substrate, no settings UI) → none introduced. ✅
- Spike removal / release-safety → Task 6 tears out the module, hooks, nav-epoch, and dependency; Global Constraints declare the do-not-merge-with-spike gate. ✅

**Code-review fixes applied (Codex, round 1):**
- *3(a) can't be host-Node `require.resolve` through asar* → the SDK is loaded by a real `require()` inside packaged Electron (via `probePackageLoad`); Task 5 Step 1 runs it and reads the `package probe` line. ✅
- *Page-world error message could leak the password to logs* → the injection's failure path logs a fixed classification, never the page-controlled message. ✅
- *`did-navigate-in-page` fires for subframes* → Task 3 Step 2 guards the in-page epoch bump with `if (isMainFrame)`. ✅
- *Smoke cancel-classification too broad* → Task 4 narrows INCONCLUSIVE to `/cancell?ed/i` (best-effort; a genuine cancel misread as FAIL is simply re-run — no regex-tightening step to strand); everything else defaults to FAIL. ✅
- *Quarantine claim inaccurate* → Task 5 Step 4 attributes notarization evidence to Step 3's `spctl`/`stapler` and adds an explicit `xattr`+`open` first-launch check. ✅

**Code-review fixes applied (Codex, round 2):**
- *Packaged probe had no reliable termination/status* (`grep -m1` orphans the GUI, can EPIPE, matches PASS+FAIL alike) → Task 4 adds a **headless** `runPackageProbeIfRequested()` gated on `BLANC_1P_PACKAGE_PROBE`: loads the SDK, logs one line, `app.exit(0|1)`. Task 5 Step 1 keys off `echo $?`. ✅
- *Lazy-require constraint contradicted the direct `require('@1password/sdk')` in `main.js`* → added `onepassword.probePackageLoad()` (Task 2); both packaging hooks call it, so `main.js` never requires the SDK. Global Constraints + Architecture updated. ✅
- *Outer-catch comment was false (credential already revealed before the re-validation/`buildFillScript` ops)* → Task 3 splits the orchestrator into a pre-reveal phase (`setup-error`, message logged) and a **binding-less** post-reveal phase (`fill-error`, no message) — the guarantee is now structural, and the comment is accurate. ✅
- *Quarantine check reused an already-launched bundle* → Task 5 Step 4 now uses a **second pristine extraction**, stamps + verifies `com.apple.quarantine` before any launch, then `open`s it. ✅

**Code-review fixes applied (Codex, round 3):**
- *`; echo "exit=$?"` masked a probe failure as success* → Task 5 Step 1 now captures the code (`rc=$?` — not `status`, which zsh reserves read-only; found by executing the block) and ends on `test "$rc" -eq 0`, so the block's exit status is the probe's. ✅
- *Quarantine `open` used the real profile* → Task 5 Step 4 passes a throwaway profile through LaunchServices: `open "$FRESH" --args --user-data-dir="$(mktemp -d)"`. ✅
- *Wrong-arch zip name* (`Blanc-<v>-mac.zip` is x64; arm64 is `Blanc-<v>-arm64-mac.zip`, per `scripts/release.sh`) → Task 5 Step 2 builds `--arm64` only and Step 4 globs `dist/Blanc-*-arm64-mac.zip`. ✅
- *Dangling "tighten the cancel regex in Task 5" with no such step* → reworded to best-effort INCONCLUSIVE; a misclassified cancel is simply re-run (no stranded step). ✅

**Code-review fixes applied (Codex, round 4 — on the Task 3 implementation):**
- *Second recognized chord press leaked to the page* → `event.preventDefault()` moved before the single-flight check: a recognized chord is always consumed; in-flight just means no new fill. ✅
- *Chooser could call `dialog.showMessageBox(undefined, options)` (undocumented overload) after window closure* → pre-gate with `if (!hasLiveWindow()) return log('abort-window-changed');` and pass `win` plainly — matching the documented-overloads-only discipline of `webauthn.js`. ✅

**Placeholder scan:** the only intentional stub is `initSpikePackaging()` in Task 3 Step 3, explicitly replaced with full code in Task 4 Step 1 (called out in both places). No `TODO`/"handle edge cases"/uncoded steps remain.

**Type consistency:** `findLogins → {vaultId, itemId, title}` is consumed as `chosen.vaultId`/`chosen.itemId` and passed to `revealCredential(vaultId, itemId)` → `{username, password}`, consumed by name in the orchestrator and fed to `buildFillScript({expectedURL, expectedTimeOrigin, username, password})`, whose IIFE returns `{originMismatch, filledUser, filledPass, noPasswordField?}` — the exact keys the orchestrator branches on. `navEpoch` is set once and read as `tab.navEpoch`/`capturedEpoch` consistently. `ONE_PASSWORD_SPIKE_ENABLED` / `onePasswordFillInFlight` names match across definition and use.
