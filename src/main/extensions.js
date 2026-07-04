const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const {
  installChromeWebStore,
  uninstallExtension,
} = require('electron-chrome-web-store');

// Electron's extension runtime doesn't ship the chrome.webRequest binding
// modules; an extension whose manifest requests them can crash-loop its
// service worker on a C++-level NOTREACHED (1Password does). Stripping the
// permission from the installed manifest prevents the bindings system from
// ever trying to load the missing module — the extension just sees the API
// as absent, same as it would in Safari.
const UNSUPPORTED_PERMISSIONS = new Set(['webRequest', 'webRequestAuthProvider']);
const extensionsDir = () => path.join(app.getPath('userData'), 'Extensions');

// With the permission stripped, chrome.webRequest is simply absent — but
// some extensions call it unguarded (1Password's worker dies on
// `chrome.webRequest.onAuthRequired.addListener`). We install a no-op shim
// into the extension's own service worker so listeners just never fire, as
// if no requests matched. (A session service-worker preload can't do this —
// it runs isolated from the extension's globals.)
//
// For `"type": "module"` workers the shim must be a module imported on the
// FIRST line: static imports are hoisted, so plain prepended code would run
// only after the extension's own import chunks — 1Password's polyfill
// snapshots chrome.webRequest during those imports.
const SHIM_MARKER = '/* bowser: chrome.webRequest shim */';
const SHIM_FILENAME = '__bowser-webrequest-shim.js';
const WEBREQUEST_SHIM = `(() => {
  if (typeof chrome === 'undefined' || chrome.webRequest) return;
  const makeEvent = () => ({
    addListener() {},
    removeListener() {},
    hasListener() { return false; },
    hasListeners() { return false; },
  });
  chrome.webRequest = {
    onBeforeRequest: makeEvent(),
    onBeforeSendHeaders: makeEvent(),
    onSendHeaders: makeEvent(),
    onHeadersReceived: makeEvent(),
    onAuthRequired: makeEvent(),
    onResponseStarted: makeEvent(),
    onBeforeRedirect: makeEvent(),
    onCompleted: makeEvent(),
    onErrorOccurred: makeEvent(),
    onActionIgnored: makeEvent(),
    handlerBehaviorChanged(callback) { if (callback) callback(); },
    MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES: 20,
  };

  // Extension polyfills (1Password's included) build their API wrappers
  // from the manifest's permission list. Re-advertise the permissions we
  // stripped so the wrappers get created; only the C++ bindings must not
  // see them.
  const getManifest = chrome.runtime.getManifest.bind(chrome.runtime);
  chrome.runtime.getManifest = () => {
    const manifest = getManifest();
    manifest.permissions = [
      ...new Set([...(manifest.permissions ?? []), 'webRequest', 'webRequestAuthProvider']),
    ];
    return manifest;
  };
})();
`;

const WEBREQUEST_CALLSITE = /\b(browser|chrome)\.webRequest\.(on\w+)\.(addListener|removeListener|hasListener)\(/g;

/** Rewrites `browser.webRequest.onX.addListener(` style call sites to
 * optional chaining in every script of an extension package. */
function guardWebRequestCallSites(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      guardWebRequestCallSites(full);
    } else if (entry.name.endsWith('.js')) {
      const source = fs.readFileSync(full, 'utf8');
      const patched = source.replace(WEBREQUEST_CALLSITE, '$1.webRequest?.$2?.$3?.(');
      if (patched !== source) fs.writeFileSync(full, patched);
    }
  }
}

/** Returns the ids of extensions whose manifests were modified. */
function sanitizeManifests() {
  const changed = new Set();
  let entries = [];
  try {
    entries = fs.readdirSync(extensionsDir());
  } catch {
    return changed; // no extensions installed yet
  }
  for (const id of entries) {
    let versions = [];
    try {
      versions = fs.readdirSync(path.join(extensionsDir(), id));
    } catch {
      continue;
    }
    for (const version of versions) {
      const versionDir = path.join(extensionsDir(), id, version);
      try {
        const manifestPath = path.join(versionDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        const perms = manifest.permissions ?? [];
        const filtered = perms.filter((p) => !UNSUPPORTED_PERMISSIONS.has(p));
        if (filtered.length !== perms.length) {
          manifest.permissions = filtered;
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
          changed.add(id);
        }

        const workerRel = manifest.background?.service_worker;
        if (workerRel) {
          const workerPath = path.join(versionDir, workerRel);
          const source = fs.readFileSync(workerPath, 'utf8');
          if (!source.startsWith(SHIM_MARKER)) {
            // Some bundles reach webRequest through their own polyfill
            // object, which the chrome.webRequest shim can't cover —
            // rewrite those call sites to optional chaining so they no-op
            // instead of throwing. Applies to every script in the package.
            guardWebRequestCallSites(versionDir);

            const patched = fs.readFileSync(workerPath, 'utf8');
            if (manifest.background.type === 'module') {
              fs.writeFileSync(path.join(path.dirname(workerPath), SHIM_FILENAME), WEBREQUEST_SHIM);
              fs.writeFileSync(workerPath, `${SHIM_MARKER} import "./${SHIM_FILENAME}";\n${patched}`);
            } else {
              fs.writeFileSync(workerPath, `${SHIM_MARKER}\n${WEBREQUEST_SHIM}${patched}`);
            }
            changed.add(id);
          }
        }
      } catch {
        // not a readable extension dir — skip
      }
    }
  }
  return changed;
}

// Extensions known to be unstable in this Electron environment: MV3
// password managers whose service workers depend on chrome.webRequest and
// other bindings Electron's extension runtime doesn't fully provide. Our
// sanitize/shim keeps them from crash-looping their own worker, but
// electron-chrome-extensions still faults inside Chromium when the worker
// ultimately fails to start (V8 traced-reference use-after-free, SIGSEGV
// at 0x130) — which took the whole app down repeatedly. They never worked
// here anyway (biometric desktop-app unlock needs native messaging behind
// a browser code-signature allowlist a custom shell can't join). So rather
// than preinstall them, we block them: any copy already on disk from a
// previous version is removed on startup before it can load, and the web
// store is prevented from (re)installing them. Other extensions the user
// adds manually are unaffected.
const BLOCKED_EXTENSIONS = new Map([
  ['aeblfdkhhhdcdjpifhhbdiojplfjncoa', '1Password'],
  ['fdjamakpfbbddfjaooikfcpapjohcfmg', 'Dashlane'],
]);

/** Delete blocked extensions from disk so they never load. Runs before
 * installChromeWebStore(), which would otherwise load them from the
 * profile and crash the browser process. */
function removeBlockedExtensionsFromDisk() {
  for (const [id, name] of BLOCKED_EXTENSIONS) {
    const dir = path.join(extensionsDir(), id);
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`[extensions] removed blocked extension ${name} from disk`);
      } catch (err) {
        console.warn(`[extensions] could not remove blocked ${name}:`, err.message);
      }
    }
  }
}

/** @type {ElectronChromeExtensions | null} */
let extensions = null;

/**
 * Creates the chrome.* API host. Synchronous so it can run before the
 * window/tabs exist; extension installs happen later in initWebStore().
 *
 * The delegate maps extension-initiated actions (chrome.tabs.create etc.)
 * onto the app's own tab model.
 */
function createExtensionHost(session, delegate) {
  extensions = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session,
    createTab: async (details) => delegate.createTab(details),
    selectTab: (wc) => delegate.selectTab(wc),
    removeTab: (wc) => delegate.removeTab(wc),
    createWindow: async (details) => {
      // Extension-created windows (sign-in flows, etc.) get a plain
      // locked-down window rather than a managed tab.
      const popup = new BrowserWindow({
        width: details.width ?? 480,
        height: details.height ?? 640,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      const url = Array.isArray(details.url) ? details.url[0] : details.url;
      if (url) popup.loadURL(url);
      return popup;
    },
  });

  // Serves extension icons to the <browser-action-list> element.
  ElectronChromeExtensions.handleCRXProtocol(session);

  return extensions;
}

/**
 * Enables "Add to Chrome" on chromewebstore.google.com, loads previously
 * installed extensions from disk, and auto-updates them. No extensions are
 * preinstalled — the ones we used to bundle crash the browser process (see
 * BLOCKED_EXTENSIONS); they're removed here instead. Network-bound — call
 * without awaiting so store setup doesn't block the window.
 */
async function initWebStore(session) {
  // Purge known-unstable extensions before anything loads them, then clean
  // up manifests of whatever remains from previous runs/updates.
  removeBlockedExtensionsFromDisk();
  sanitizeManifests();

  await installChromeWebStore({ session });

  // Defensive: if a blocked extension somehow loaded anyway (e.g. an
  // in-session store install), unload it so it can't crash the process.
  for (const id of BLOCKED_EXTENSIONS.keys()) {
    if (session.extensions.getExtension(id)) {
      try {
        await uninstallExtension(id, { session });
        console.log(`[extensions] uninstalled blocked ${BLOCKED_EXTENSIONS.get(id)}`);
      } catch (err) {
        console.warn(`[extensions] could not uninstall blocked ${id}:`, err.message);
      }
    }
  }

  // Fresh installs (and in-session auto-updates) arrive unsanitized; patch
  // them and reload so the fix applies without a restart.
  for (const id of sanitizeManifests()) {
    const ext = session.extensions.getExtension(id);
    if (!ext) continue;
    try {
      session.extensions.removeExtension(id);
      await session.extensions.loadExtension(ext.path);
      console.log(`[extensions] reloaded ${ext.name} with sanitized manifest`);
    } catch (err) {
      console.warn(`[extensions] could not reload ${id}:`, err.message);
    }
  }
}

function listExtensions(session) {
  return session.extensions.getAllExtensions().map((e) => ({
    id: e.id,
    name: e.name,
    version: e.version,
  }));
}

async function removeExtension(session, id) {
  await uninstallExtension(id, { session });
}

module.exports = { createExtensionHost, initWebStore, listExtensions, removeExtension };
