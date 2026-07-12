// SPIKE (1Password fill feasibility) — throwaway; MUST be removed before any
// release (plan Task 6 — env-gating alone is not release-safety). This module
// owns the 1Password SDK client and ALL credential handling. `@1password/sdk`
// is require()d lazily so a normal packaged startup never loads it.

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

module.exports = { matchesHost, buildFillScript, getClient, findLogins, revealCredential, probePackageLoad };
