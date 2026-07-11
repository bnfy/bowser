const {
  normalizedMediaTypes,
  storedDecision,
  rememberDecision,
} = require('./permission-decisions');

/**
 * Permission policy for web content. Electron's default is ALLOW
 * everything — the wrong default for a browser. Three tiers:
 *  - AUTO_ALLOWED: low-risk, user-visible; granted silently.
 *  - PROMPTED: asked once per origin via the chrome prompt bar, decision
 *    persisted in site-permissions.json (managed from Settings).
 *  - everything else: denied.
 */
const AUTO_ALLOWED = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
const PROMPTED = new Set(['media', 'geolocation', 'notifications']);

// store.js requires electron at load, so it's pulled in lazily: the module
// itself then loads under plain `node --test`, and the private-permissions
// unit test doubles as a canary — any code path that touches persistence
// with persistDecisions:false would blow up on the electron require.
let store = null;
const ensureStore = () => {
  if (!store) {
    const { JsonStore } = require('./store');
    store = new JsonStore('site-permissions', { decisions: {} });
  }
  return store;
};

/** @type {((req: {origin: string, permission: string, mediaTypes: string[]}) => Promise<boolean | null>) | null} */
let prompter = null;
function setPermissionPrompter(fn) { prompter = fn; }

function normalizedOrigin(rawUrl) {
  try {
    const origin = new URL(rawUrl).origin;
    // Only real sites get prompts. This also — deliberately — denies every
    // PROMPTED permission for file:// tabs with no prompt shown: origin is
    // the literal string 'null' for file:// (and any other opaque origin),
    // there's nowhere to persist a decision keyed by a filesystem path, and
    // real browsers restrict these same permissions for file:// too. Not a
    // bug to "fix" by prompting local files — silent-deny is the intended,
    // safe default here.
    return origin.startsWith('http') ? origin : null;
  } catch {
    return null;
  }
}

function listDecisions() {
  return { ...ensureStore().data.decisions };
}

function removeDecision(key) {
  ensureStore().update((d) => { delete d.decisions[key]; });
}

function setupPermissionPolicy(session, { persistDecisions = true } = {}) {
  // Incognito/private sessions use this in-memory map. Normal browsing keeps
  // using site-permissions.json and remains manageable from Settings.
  const ephemeralDecisions = {};
  const readDecisions = () => persistDecisions ? ensureStore().data.decisions : ephemeralDecisions;
  const saveDecision = (origin, permission, mediaTypes, allow) => {
    if (persistDecisions) {
      ensureStore().update((d) => rememberDecision(d.decisions, origin, permission, mediaTypes, allow));
    } else {
      rememberDecision(ephemeralDecisions, origin, permission, mediaTypes, allow);
    }
  };

  session.setPermissionRequestHandler(async (_wc, permission, callback, details) => {
    if (AUTO_ALLOWED.has(permission)) return callback(true);
    if (!PROMPTED.has(permission)) return callback(false);

    const origin = normalizedOrigin(details.requestingUrl);
    if (!origin) return callback(false);

    const mediaTypes = normalizedMediaTypes(details.mediaTypes);
    const scopes = permission === 'media' && mediaTypes.length ? mediaTypes : [null];
    const saved = scopes.map((mediaType) =>
      storedDecision(readDecisions(), origin, permission, mediaType));
    if (saved.some((decision) => decision === 'deny')) return callback(false);
    if (saved.every((decision) => decision === 'allow')) return callback(true);
    if (!prompter) return callback(false);

    // null = the prompt couldn't be shown (no window). Deny for now but
    // DON'T persist it, or a transient no-window moment would silently
    // block the site forever. Only a real Allow/Block answer is remembered.
    const allow = await prompter({ origin, permission, mediaTypes });
    if (allow === null) return callback(false);
    saveDecision(origin, permission, mediaTypes, allow);
    callback(allow);
  });

  // Synchronous checks (navigator.permissions.query, Notification.permission)
  // must agree with the request handler or sites see inconsistent state.
  session.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (AUTO_ALLOWED.has(permission)) return true;
    if (!PROMPTED.has(permission)) return false;
    const origin = normalizedOrigin(requestingOrigin);
    if (!origin) return false;
    const mediaType = permission === 'media' && ['audio', 'video'].includes(details?.mediaType)
      ? details.mediaType
      : null;
    return storedDecision(readDecisions(), origin, permission, mediaType) === 'allow';
  });

  // Screen capture: still deny by never providing a stream (no picker UI yet).
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

module.exports = { setupPermissionPolicy, setPermissionPrompter, listDecisions, removeDecision };
