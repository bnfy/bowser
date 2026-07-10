const { JsonStore } = require('./store');

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

let store = null;
const ensureStore = () => (store ??= new JsonStore('site-permissions', { decisions: {} }));

/** @type {((req: {origin: string, permission: string, mediaTypes: string[]}) => Promise<boolean | null>) | null} */
let prompter = null;
function setPermissionPrompter(fn) { prompter = fn; }

function keyFor(origin, permission, mediaTypes) {
  if (permission === 'media' && mediaTypes?.length) {
    return `${origin}|${permission}|${[...mediaTypes].sort().join(',')}`;
  }
  return `${origin}|${permission}`;
}

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

function decisionFor(origin, permission, mediaTypes) {
  const decisions = ensureStore().data.decisions;
  return decisions[keyFor(origin, permission, mediaTypes)]
    ?? decisions[keyFor(origin, permission)] ?? null;
}

function rememberDecision(origin, permission, allow, mediaTypes) {
  ensureStore().update((d) => { d.decisions[keyFor(origin, permission, mediaTypes)] = allow ? 'allow' : 'deny'; });
}

function listDecisions() {
  return { ...ensureStore().data.decisions };
}

function removeDecision(key) {
  ensureStore().update((d) => { delete d.decisions[key]; });
}

function setupPermissionPolicy(session) {
  session.setPermissionRequestHandler(async (_wc, permission, callback, details) => {
    if (AUTO_ALLOWED.has(permission)) return callback(true);
    if (!PROMPTED.has(permission)) return callback(false);

    const origin = normalizedOrigin(details.requestingUrl);
    if (!origin) return callback(false);

    const mediaTypes = details.mediaTypes ?? [];
    const saved = decisionFor(origin, permission, mediaTypes);
    if (saved) return callback(saved === 'allow');
    if (!prompter) return callback(false);

    const allow = await prompter({ origin, permission, mediaTypes });
    if (allow === null) return callback(false);
    rememberDecision(origin, permission, allow, mediaTypes);
    callback(allow);
  });

  // Synchronous checks (navigator.permissions.query, Notification.permission)
  // must agree with the request handler or sites see inconsistent state.
  session.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (AUTO_ALLOWED.has(permission)) return true;
    if (!PROMPTED.has(permission)) return false;
    const origin = normalizedOrigin(requestingOrigin);
    if (!origin) return false;
    const mediaTypes = details?.mediaType ? [details.mediaType] : [];
    return decisionFor(origin, permission, mediaTypes) === 'allow';
  });

  // Screen capture: still deny by never providing a stream (no picker UI yet).
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

module.exports = { setupPermissionPolicy, setPermissionPrompter, listDecisions, removeDecision };
