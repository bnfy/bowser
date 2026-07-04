# Daily-Driver Essentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "dealbreaker" gaps that keep Bowser from being usable as a primary browser: page context menus, per-site permission prompts, HTTP basic-auth, inline PDFs, unload/crash handling, and background-tab link opening.

**Architecture:** All features build on the existing one-window/many-`WebContentsView` model in `src/main/main.js`. New main-process concerns get their own module (`context-menu.js`, `auth-dialog.js`); permission prompting extends `permissions.js` with a persisted per-site decision store and delegates UI to the chrome renderer over a new `permissions:*` IPC namespace. Chrome-level UI (permission bar) follows the find-bar pattern: a hidden row in `index.html`, styled in `styles.css`, wired in `renderer.js`, with layout height re-reported so the main process resizes tab views.

**Tech Stack:** Electron 43 (Chromium 150), plain JS/HTML/CSS, no frameworks. Persistence via the existing `JsonStore` (`src/main/store.js`).

## Global Constraints

- **No test framework exists in this repo** (per CLAUDE.md — do not assume `npm test`). Each task's verify step drives the real app: launch with `npx electron . --remote-debugging-port=9222`, then use the CDP helper at the path given in each verify step, or observe manually. Kill the app between tasks (`pkill -f "electron/dist"`).
- Chrome-window HTML/CSS loads **once at window creation** — relaunch the app to see `index.html`/`styles.css` changes; `Cmd+R` only reloads the active tab.
- Every tab `WebContentsView` keeps `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `bowser://` pages are served **flat** from `src/renderer/pages/` (no subdirectories); any new page must be registered in `KNOWN_PAGES` in `src/main/pages.js` and carry its own `<meta http-equiv="Content-Security-Policy">` tag.
- IPC channel namespaces: `tabs:*`, `pages:*`, `window:*`, `chrome:*`, `downloads:*`, `extensions:*` — new permission-prompt channels use `permissions:*`.
- Every `pages:*` IPC handler must verify `event.sender.getURL()` starts with `bowser://` (the `handle` wrapper in `pages.js` does this — use it).
- Main-process singletons: `tabs` Map + `tabOrder` array are the single source of truth; renderer only reflects `tabs:updated` broadcasts.
- `setActiveTab(id)` is a **no-op when `id` is already active** and when no live window exists — do not remove those guards (they break extension-host recursion and quit-teardown crashes).
- Commit after each task with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Inline PDF viewing

**Files:**
- Modify: `src/main/main.js` (the `new WebContentsView` webPreferences in `createTab`, ~line 130)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing relied on by later tasks.

- [ ] **Step 1: Enable Chromium's PDF plugin for tab views**

In `createTab`, add `plugins: true` to the webPreferences:

```js
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium's built-in PDF viewer is a plugin; without this flag
      // PDFs download instead of rendering inline.
      plugins: true,
      // Exposes a data API to our own bowser:// pages ONLY — see the
      // guards in tab-preload.js and pages.js. Web content gets nothing.
      preload: path.join(__dirname, 'tab-preload.js'),
    },
  });
```

- [ ] **Step 2: Verify a PDF renders inline**

Run: `npx electron . --remote-debugging-port=9222` (background), then from the scratchpad dir:

```bash
node cdp.js eval index.html "window.browserAPI.getAllTabs().then(p=>window.browserAPI.navigate(p.activeTabId,'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'))"
```

Expected: after ~3s, `node cdp.js targets` lists the tab still on the `.pdf` URL (not a completed download), and the window shows the rendered PDF, not a download. A `did-fail-load` bounce to `bowser://error` means the flag didn't apply.

- [ ] **Step 3: Commit**

```bash
git add src/main/main.js
git commit -m "Render PDFs inline via Chromium's PDF plugin"
```

---

### Task 2: Page context menu

**Files:**
- Create: `src/main/context-menu.js`
- Modify: `src/main/main.js` (require at top; attach in `createTab` after the `wc` listeners)

**Interfaces:**
- Consumes: `settings.searchUrlFor(query)` from `src/main/settings.js`.
- Produces: `attachContextMenu(wc, actions)` where `actions = { openBackgroundTab(url: string): void, openTab(url: string): void }`. Task 3 does not depend on this, but the `createTab`-without-activate pattern established here is reused there.

- [ ] **Step 1: Create `src/main/context-menu.js`**

```js
const { Menu, clipboard } = require('electron');
const settings = require('./settings');

/**
 * Right-click menu for tab web content. Electron ships NO default context
 * menu — without this, right-click does nothing at all.
 *
 * `actions` supplies tab-model callbacks so this module doesn't import
 * main.js (which requires this file — avoid the cycle):
 *   openBackgroundTab(url) — new tab, not activated
 *   openTab(url)           — new tab, activated
 */
function attachContextMenu(wc, actions) {
  wc.on('context-menu', (_event, params) => {
    const items = [];
    const push = (item) => items.push(item);
    const sep = () => {
      if (items.length && items[items.length - 1].type !== 'separator') push({ type: 'separator' });
    };

    if (params.linkURL) {
      push({ label: 'Open Link in New Tab', click: () => actions.openBackgroundTab(params.linkURL) });
      push({ label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) });
      sep();
    }

    if (params.mediaType === 'image' && params.srcURL) {
      push({ label: 'Open Image in New Tab', click: () => actions.openBackgroundTab(params.srcURL) });
      push({ label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) });
      push({ label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) });
      push({ label: 'Save Image As…', click: () => wc.downloadURL(params.srcURL) });
      sep();
    }

    if (params.isEditable) {
      for (const suggestion of (params.dictionarySuggestions ?? []).slice(0, 5)) {
        push({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) });
      }
      if (params.misspelledWord) {
        push({
          label: 'Add to Dictionary',
          click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        });
      }
      sep();
      // Explicit calls (not menu roles) so edits always target this tab's
      // webContents, never whatever happens to hold focus.
      push({ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => wc.undo() });
      push({ label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => wc.redo() });
      sep();
      push({ label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: !!params.selectionText, click: () => wc.cut() });
      push({ label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: !!params.selectionText, click: () => wc.copy() });
      push({ label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => wc.paste() });
      push({ label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => wc.selectAll() });
      sep();
    } else if (params.selectionText.trim()) {
      push({ label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => wc.copy() });
      const query = params.selectionText.trim().slice(0, 100);
      const shown = query.length > 30 ? `${query.slice(0, 30)}…` : query;
      push({ label: `Search for “${shown}”`, click: () => actions.openTab(settings.searchUrlFor(query)) });
      sep();
    }

    // Plain page background: navigation controls.
    if (!params.linkURL && !params.isEditable && !params.selectionText.trim() && params.mediaType === 'none') {
      push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
      push({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() });
      push({ label: 'Reload', click: () => wc.reload() });
      sep();
    }

    push({ label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) });

    Menu.buildFromTemplate(items).popup();
  });
}

module.exports = { attachContextMenu };
```

- [ ] **Step 2: Attach it in `createTab`**

In `src/main/main.js`, add to the requires block:

```js
const { attachContextMenu } = require('./context-menu');
```

In `createTab`, after the `wc.setWindowOpenHandler(...)` call and before `wc.loadURL(url)`:

```js
  attachContextMenu(wc, {
    openBackgroundTab: (targetUrl) => createTab(targetUrl),
    openTab: (targetUrl) => setActiveTab(createTab(targetUrl)),
  });
```

- [ ] **Step 3: Verify**

Launch the app, navigate a tab to `https://example.com`, then check each surface manually:
- Right-click the page background → Back/Forward/Reload + Inspect Element; Inspect opens DevTools docked to that element.
- Right-click the "More information..." link → Open Link in New Tab (opens WITHOUT switching), Copy Link Address.
- Select text, right-click → Copy + `Search for "…"` (opens the settings-selected engine in a new active tab).
- Focus any text field (use `https://duckduckgo.com`), type `teh`, right-click the misspelling → suggestions + Add to Dictionary + Cut/Copy/Paste.

- [ ] **Step 4: Commit**

```bash
git add src/main/context-menu.js src/main/main.js
git commit -m "Add page context menu (links, images, editing, spellcheck, inspect)"
```

---

### Task 3: Cmd/Ctrl+click opens background tabs

**Files:**
- Modify: `src/main/main.js` (`wc.setWindowOpenHandler` inside `createTab`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing relied on by later tasks.

- [ ] **Step 1: Respect the disposition**

Replace the existing handler:

```js
  // Open target="_blank" / window.open() as a new managed tab instead of a
  // separate, unmanaged Electron window. Cmd/Ctrl+click arrives as
  // 'background-tab' — open it without stealing focus (browser convention).
  wc.setWindowOpenHandler(({ url: targetUrl, disposition }) => {
    const newId = createTab(targetUrl);
    if (disposition !== 'background-tab') setActiveTab(newId);
    return { action: 'deny' };
  });
```

- [ ] **Step 2: Verify**

Launch, open `https://example.com`, Cmd+click the "More information..." link. Expected: a new tab appears in the strip but the current tab stays active. A plain click on a `target="_blank"` link (e.g. links on `https://news.ycombinator.com`) still switches to the new tab.

- [ ] **Step 3: Commit**

```bash
git add src/main/main.js
git commit -m "Open Cmd/Ctrl+clicked links as background tabs"
```

---

### Task 4: Leave/Stay dialog for beforeunload

**Files:**
- Modify: `src/main/main.js` (new listener in `createTab`, next to the `did-fail-load` handler)

**Interfaces:**
- Consumes: `hasLiveWindow()` (already in main.js).
- Produces: nothing relied on by later tasks.

- [ ] **Step 1: Handle `will-prevent-unload`**

Without this, a page whose `beforeunload` blocks unload makes its tab silently refuse to close or navigate — the user gets no feedback at all. Add in `createTab`:

```js
  // A page's beforeunload can block close/navigation; surface Chrome's
  // Leave/Stay choice instead of silently refusing.
  wc.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(hasLiveWindow() ? win : undefined, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 0,
      cancelId: 1,
      message: 'Leave this page?',
      detail: 'Changes you made may not be saved.',
    });
    if (choice === 0) event.preventDefault(); // preventing the prevention lets the unload proceed
  });
```

Add `dialog` to the electron require at the top of `main.js`:

```js
const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, nativeTheme, dialog } = require('electron');
```

- [ ] **Step 2: Verify**

Launch, navigate the active tab via CDP helper to a page that sets `beforeunload` (e.g. start a reply on any GitHub issue while logged out isn't reliable — instead run in the tab's DevTools console: `window.onbeforeunload = (e) => { e.preventDefault(); }`), then press Cmd+W. Expected: "Leave this page?" dialog; **Stay** keeps the tab, **Leave** closes it.

- [ ] **Step 3: Commit**

```bash
git add src/main/main.js
git commit -m "Show Leave/Stay dialog when a page blocks unload"
```

---

### Task 5: Crashed-tab recovery

**Files:**
- Modify: `src/main/main.js` (new listener in `createTab`)
- Modify: `src/renderer/pages/error.js` (crash-friendly copy)

**Interfaces:**
- Consumes: the existing `bowser://error` page (`error.html`/`error.js`) and its `?url=&code=&desc=` query contract.
- Produces: nothing relied on by later tasks.

- [ ] **Step 1: Route dead renderers to the error page**

In `createTab`, next to the `did-fail-load` handler:

```js
  // A tab whose renderer dies (OOM, GPU fault, kill -9) otherwise sits
  // blank forever; loadURL spawns a fresh renderer, so route it to the
  // error page with the original URL for one-click retry.
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    const q = new URLSearchParams({ url: tab.url, code: details.reason, desc: 'The page crashed' });
    wc.loadURL(`bowser://error/?${q}`).catch(() => {});
  });
```

- [ ] **Step 2: Make the error page's detail line read naturally for crashes**

In `src/renderer/pages/error.js`, the detail currently renders `${desc} (${code})` — fine for `ERR_NAME_NOT_RESOLVED (-105)` but clumsy for `The page crashed (oom)`. Replace the detail assignment:

```js
  const NON_NUMERIC = /[^-\d]/;
  document.getElementById('errorDetail').textContent = NON_NUMERIC.test(code)
    ? `${desc || 'The page crashed'} (reason: ${code})`
    : desc ? `${desc} (${code})` : `Error ${code}`;
```

- [ ] **Step 3: Verify**

Launch, open `https://example.com`, find the tab renderer's pid (`ps -Ao pid,command | grep "Electron Helper (Renderer)"` — the ones **without** `--no-sandbox`; pick the newest), `kill -9 <pid>`. Expected: the tab shows "This page didn't load" with "The page crashed (reason: killed)" and **Try again** reloads example.com.

- [ ] **Step 4: Commit**

```bash
git add src/main/main.js src/renderer/pages/error.js
git commit -m "Recover crashed tabs onto the error page with retry"
```

---

### Task 6: HTTP basic-auth dialog

**Files:**
- Create: `src/main/auth-dialog.js`
- Create: `src/main/auth-preload.js`
- Create: `src/renderer/pages/auth.html`
- Create: `src/renderer/pages/auth.js`
- Modify: `src/main/pages.js` (`KNOWN_PAGES`)
- Modify: `src/main/main.js` (handle `app.on('login')`)

**Interfaces:**
- Consumes: `registerPagesScheme`/`setupPages` serving flat files from `src/renderer/pages/` (already in place); `hasLiveWindow()` and `win` from main.js.
- Produces: `promptForCredentials(parent: BrowserWindow|null, authInfo: {host: string, realm?: string}): Promise<{username: string, password: string} | null>`.

- [ ] **Step 1: Create `src/main/auth-dialog.js`**

```js
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Serialized so overlapping 401s (page + subresources) don't stack dialogs.
let chain = Promise.resolve();
let counter = 0;

/**
 * Modal credentials prompt for HTTP basic/digest auth.
 * Resolves {username, password}, or null if dismissed.
 */
function promptForCredentials(parent, authInfo) {
  const run = () =>
    new Promise((resolve) => {
      const id = ++counter;
      const dialogWin = new BrowserWindow({
        parent: parent ?? undefined,
        modal: !!parent,
        width: 400,
        height: 250,
        resizable: false,
        minimizable: false,
        maximizable: false,
        webPreferences: {
          preload: path.join(__dirname, 'auth-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      dialogWin.setMenuBarVisibility(false);

      let settled = false;
      const done = (creds) => {
        if (settled) return;
        settled = true;
        ipcMain.removeAllListeners(`auth:submit:${id}`);
        if (!dialogWin.isDestroyed()) dialogWin.close();
        resolve(creds);
      };

      ipcMain.once(`auth:submit:${id}`, (event, creds) => {
        if (!event.sender.getURL().startsWith('bowser://auth')) return;
        if (creds && typeof creds.username === 'string' && typeof creds.password === 'string') {
          done({ username: creds.username, password: creds.password });
        } else {
          done(null);
        }
      });
      dialogWin.on('closed', () => done(null));

      const q = new URLSearchParams({ id: String(id), host: authInfo.host ?? '', realm: authInfo.realm ?? '' });
      dialogWin.loadURL(`bowser://auth/?${q}`);
    });

  chain = chain.then(run, run);
  return chain;
}

module.exports = { promptForCredentials };
```

- [ ] **Step 2: Create `src/main/auth-preload.js`**

```js
// Preload for the basic-auth dialog window only. Exposed solely on the
// bowser://auth page; the main-process listener re-checks the sender URL.
const { contextBridge, ipcRenderer } = require('electron');

if (window.location.protocol === 'bowser:' && window.location.host === 'auth') {
  contextBridge.exposeInMainWorld('bowserAuth', {
    submit: (id, username, password) => ipcRenderer.send(`auth:submit:${id}`, { username, password }),
    cancel: (id) => ipcRenderer.send(`auth:submit:${id}`, null),
  });
}
```

- [ ] **Step 3: Create `src/renderer/pages/auth.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;" />
  <title>Sign in</title>
  <link rel="icon" href="icon.svg" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" />
  <link rel="stylesheet" href="pages.css" />
</head>
<body class="auth-body">
  <h1 class="section-title">Sign in</h1>
  <p id="authHost" class="section-hint"></p>
  <form id="authForm">
    <input id="authUser" type="text" placeholder="Username" autocomplete="username" autofocus />
    <input id="authPass" type="password" placeholder="Password" autocomplete="current-password" />
    <div class="toolbar-row">
      <button type="submit">Sign in</button>
      <button type="button" id="authCancel">Cancel</button>
    </div>
  </form>
  <script src="auth.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `src/renderer/pages/auth.js`**

```js
(() => {
  const params = new URL(location.href).searchParams;
  const id = params.get('id');
  const host = params.get('host') || 'this site';
  const realm = params.get('realm');

  document.getElementById('authHost').textContent = realm
    ? `${host} says: “${realm}”`
    : `${host} requires a username and password.`;

  document.getElementById('authForm').addEventListener('submit', (e) => {
    e.preventDefault();
    window.bowserAuth.submit(
      id,
      document.getElementById('authUser').value,
      document.getElementById('authPass').value
    );
  });
  document.getElementById('authCancel').addEventListener('click', () => window.bowserAuth.cancel(id));
})();
```

Also add minimal styles to `src/renderer/pages/pages.css` (same tokens as the rest of the pages):

```css
.auth-body { padding: 20px 24px; }
.auth-body form { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.auth-body input {
  height: 30px;
  padding: 0 10px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--text);
}
```

- [ ] **Step 5: Register the page and the login handler**

`src/main/pages.js`:

```js
const KNOWN_PAGES = new Set(['newtab', 'bookmarks', 'history', 'downloads', 'settings', 'error', 'auth']);
```

`src/main/main.js` — require at top:

```js
const { promptForCredentials } = require('./auth-dialog');
```

Inside `app.whenReady().then(async () => { ... })`, after `registerIpcHandlers()`:

```js
  // HTTP basic/digest auth: without this handler, 401-protected sites
  // (routers, staging servers) simply fail.
  app.on('login', (event, _wc, _details, authInfo, callback) => {
    event.preventDefault();
    promptForCredentials(hasLiveWindow() ? win : null, authInfo).then((creds) => {
      if (creds) callback(creds.username, creds.password);
      else callback(); // no args = cancel the request
    });
  });
```

- [ ] **Step 6: Verify**

Launch, navigate the active tab to `https://httpbin.org/basic-auth/user/passwd`. Expected: modal "Sign in" dialog naming the host. Cancel → page shows the 401 failure. Reload, enter `user`/`passwd` → JSON `{"authenticated": true, ...}` renders.

- [ ] **Step 7: Commit**

```bash
git add src/main/auth-dialog.js src/main/auth-preload.js src/renderer/pages/auth.html src/renderer/pages/auth.js src/renderer/pages/pages.css src/main/pages.js src/main/main.js
git commit -m "Prompt for HTTP basic-auth credentials"
```

---

### Task 7: Per-site permission decisions (main process)

**Files:**
- Modify: `src/main/permissions.js` (full rewrite below)

**Interfaces:**
- Consumes: `JsonStore` from `./store`.
- Produces (Task 8 and 9 rely on these exact names):
  - `setupPermissionPolicy(session)` — unchanged signature, now prompt-aware.
  - `setPermissionPrompter(fn)` where `fn({origin, permission, mediaTypes}) => Promise<boolean>`.
  - `listDecisions(): Record<string, 'allow'|'deny'>` — keys are `` `${origin}|${permission}` ``.
  - `removeDecision(key: string): void`.

- [ ] **Step 1: Rewrite `src/main/permissions.js`**

```js
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

/** @type {((req: {origin: string, permission: string, mediaTypes: string[]}) => Promise<boolean>) | null} */
let prompter = null;
function setPermissionPrompter(fn) { prompter = fn; }

const keyFor = (origin, permission) => `${origin}|${permission}`;

function normalizedOrigin(rawUrl) {
  try {
    const origin = new URL(rawUrl).origin;
    return origin.startsWith('http') ? origin : null; // only real sites get prompts
  } catch {
    return null;
  }
}

function decisionFor(origin, permission) {
  return ensureStore().data.decisions[keyFor(origin, permission)] ?? null;
}

function rememberDecision(origin, permission, allow) {
  ensureStore().update((d) => { d.decisions[keyFor(origin, permission)] = allow ? 'allow' : 'deny'; });
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

    const saved = decisionFor(origin, permission);
    if (saved) return callback(saved === 'allow');
    if (!prompter) return callback(false);

    const allow = await prompter({ origin, permission, mediaTypes: details.mediaTypes ?? [] });
    rememberDecision(origin, permission, allow);
    callback(allow);
  });

  // Synchronous checks (navigator.permissions.query, Notification.permission)
  // must agree with the request handler or sites see inconsistent state.
  session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (AUTO_ALLOWED.has(permission)) return true;
    if (!PROMPTED.has(permission)) return false;
    const origin = normalizedOrigin(requestingOrigin);
    return !!origin && decisionFor(origin, permission) === 'allow';
  });

  // Screen capture: still deny by never providing a stream (no picker UI yet).
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

module.exports = { setupPermissionPolicy, setPermissionPrompter, listDecisions, removeDecision };
```

- [ ] **Step 2: Verify unchanged default behavior (no prompter registered yet)**

Launch, open `https://permission.site`, click **Camera**. Expected: denied (button turns red), no crash — same as before this task, because no prompter is set until Task 8. Also confirm `~/Library/Application Support/Bowser/site-permissions.json` is created on first decision only (not yet).

- [ ] **Step 3: Commit**

```bash
git add src/main/permissions.js
git commit -m "Add persisted per-site permission decisions behind a prompter hook"
```

---

### Task 8: Permission prompt bar (chrome UI + wiring)

**Files:**
- Modify: `src/main/main.js` (prompter registration + `permissions:respond` IPC)
- Modify: `src/main/preload.js` (expose prompt subscription + response)
- Modify: `src/renderer/index.html` (prompt bar markup)
- Modify: `src/renderer/styles.css` (prompt bar styles)
- Modify: `src/renderer/renderer.js` (queueing + display logic)

**Interfaces:**
- Consumes: `setPermissionPrompter` from Task 7 (exact signature above).
- Produces: IPC channels `permissions:prompt` (main → renderer, payload `{id: number, origin: string, permission: string, mediaTypes: string[]}`) and `permissions:respond` (renderer → main, payload `{id: number, allow: boolean}`); `browserAPI.onPermissionPrompt(cb)`, `browserAPI.respondPermission(id, allow)`.

- [ ] **Step 1: Register the prompter in `main.js`**

Require at top (extend the existing permissions require):

```js
const { setupPermissionPolicy, setPermissionPrompter } = require('./permissions');
```

Inside `app.whenReady()`, right after `setupPermissionPolicy(ses);`:

```js
  const pendingPermissionPrompts = new Map();
  let permissionPromptCounter = 0;
  setPermissionPrompter(({ origin, permission, mediaTypes }) =>
    new Promise((resolve) => {
      if (!hasLiveWindow()) return resolve(false);
      const id = ++permissionPromptCounter;
      pendingPermissionPrompts.set(id, resolve);
      win.webContents.send('permissions:prompt', { id, origin, permission, mediaTypes });
    })
  );
  ipcMain.on('permissions:respond', (_e, { id, allow }) => {
    pendingPermissionPrompts.get(id)?.(!!allow);
    pendingPermissionPrompts.delete(id);
  });
```

- [ ] **Step 2: Expose it in `src/main/preload.js`**

Add to the `browserAPI` object, next to the other subscriptions:

```js
  respondPermission: (id, allow) => ipcRenderer.send('permissions:respond', { id, allow }),
  onPermissionPrompt: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('permissions:prompt', listener);
    return () => ipcRenderer.removeListener('permissions:prompt', listener);
  },
```

- [ ] **Step 3: Add the bar to `src/renderer/index.html`**

After the `#findBar` div, before `</div>` closing `#chrome`:

```html
    <div id="permissionBar" class="no-drag" hidden>
      <span id="permissionText"></span>
      <button id="permAllowBtn">Allow</button>
      <button id="permBlockBtn">Block</button>
    </div>
```

- [ ] **Step 4: Style it in `src/renderer/styles.css`** (after the find bar section)

```css
/* ---------- Permission prompt bar (shown on demand) ---------- */

#permissionBar {
  height: var(--toolbar-h);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
}
#permissionBar[hidden] { display: none; }

#permissionText { color: var(--text); font-size: 12.5px; flex: 1 1 auto; }

#permissionBar button {
  height: 26px;
  padding: 0 14px;
  border-radius: var(--radius);
  font-size: 12px;
}
#permAllowBtn { background: var(--accent); color: var(--bg); }
#permBlockBtn { border: 1px solid var(--border); color: var(--text-dim); }
#permBlockBtn:hover { color: var(--text); background: var(--surface-raised); }
```

- [ ] **Step 5: Wire it in `src/renderer/renderer.js`**

Grab elements at the top with the others:

```js
  const permissionBar = document.getElementById('permissionBar');
  const permissionText = document.getElementById('permissionText');
  const permAllowBtn = document.getElementById('permAllowBtn');
  const permBlockBtn = document.getElementById('permBlockBtn');
```

Add the queue + display logic (near the find-bar section):

```js
  // --- Permission prompts (one visible at a time, FIFO) ---
  const permissionQueue = [];
  let activePermissionPrompt = null;

  function describePermission({ permission, mediaTypes }) {
    if (permission === 'media') {
      const wantsAudio = mediaTypes.includes('audio');
      const wantsVideo = mediaTypes.includes('video');
      if (wantsAudio && wantsVideo) return 'use your camera and microphone';
      if (wantsVideo) return 'use your camera';
      return 'use your microphone';
    }
    if (permission === 'geolocation') return 'know your location';
    if (permission === 'notifications') return 'show notifications';
    return `use “${permission}”`;
  }

  function showNextPermissionPrompt() {
    activePermissionPrompt = permissionQueue.shift() ?? null;
    permissionBar.hidden = !activePermissionPrompt;
    if (activePermissionPrompt) {
      const host = new URL(activePermissionPrompt.origin).host;
      permissionText.textContent = `${host} wants to ${describePermission(activePermissionPrompt)}`;
    }
    requestAnimationFrame(reportLayout);
  }

  function answerPermissionPrompt(allow) {
    if (!activePermissionPrompt) return;
    window.browserAPI.respondPermission(activePermissionPrompt.id, allow);
    showNextPermissionPrompt();
  }

  permAllowBtn.addEventListener('click', () => answerPermissionPrompt(true));
  permBlockBtn.addEventListener('click', () => answerPermissionPrompt(false));

  window.browserAPI.onPermissionPrompt((payload) => {
    permissionQueue.push(payload);
    if (!activePermissionPrompt) showNextPermissionPrompt();
  });
```

- [ ] **Step 6: Verify end-to-end**

Launch (fresh — chrome HTML changed), open `https://permission.site`, click **Camera & Microphone**. Expected: bar appears under the toolbar reading "permission.site wants to use your camera and microphone"; **Allow** → macOS may show its own system prompt, then the button turns green; the decision lands in `site-permissions.json` as `"https://permission.site|media": "allow"`. Reload the page, click again → no bar (remembered). Click **Notifications**, choose **Block** → button turns red, `"…|notifications": "deny"` persisted. Two rapid requests queue (bar shows them one after another).

- [ ] **Step 7: Commit**

```bash
git add src/main/main.js src/main/preload.js src/renderer/index.html src/renderer/styles.css src/renderer/renderer.js
git commit -m "Prompt for site permissions from the chrome with remembered decisions"
```

---

### Task 9: Manage site permissions in Settings

**Files:**
- Modify: `src/main/pages.js` (two `pages:permissions:*` handlers)
- Modify: `src/main/tab-preload.js` (expose them)
- Modify: `src/renderer/pages/settings.html` (new section)
- Modify: `src/renderer/pages/settings.js` (render + remove)

**Interfaces:**
- Consumes: `listDecisions()` / `removeDecision(key)` from Task 7 (exact signatures above).
- Produces: `bowserPages.permissions.list(): Promise<Record<string,'allow'|'deny'>>`, `bowserPages.permissions.remove(key: string): Promise<void>`.

- [ ] **Step 1: Handlers in `src/main/pages.js`**

Add to the requires: `const { listDecisions, removeDecision } = require('./permissions');`
Add next to the other handlers:

```js
  handle('pages:permissions:list', () => listDecisions());
  handle('pages:permissions:remove', (key) => removeDecision(String(key)));
```

- [ ] **Step 2: Expose in `src/main/tab-preload.js`** (inside the existing `bowserPages` object)

```js
    permissions: {
      list: () => ipcRenderer.invoke('pages:permissions:list'),
      remove: (key) => ipcRenderer.invoke('pages:permissions:remove', key),
    },
```

- [ ] **Step 3: Section in `src/renderer/pages/settings.html`** (before the "Clear browsing data" section)

```html
    <h1 class="section-title">Site permissions</h1>
    <p class="section-hint">
      Sites you've allowed or blocked from using your camera, microphone, location, or notifications.
    </p>
    <div id="permissionList" class="row-list"></div>
```

- [ ] **Step 4: Render in `src/renderer/pages/settings.js`** (append inside the async IIFE, following the `refreshExtensions` pattern already in the file)

```js
  // --- Site permissions ---
  const permissionList = document.getElementById('permissionList');
  const PERMISSION_LABELS = { media: 'Camera/microphone', geolocation: 'Location', notifications: 'Notifications' };

  async function refreshPermissions() {
    const decisions = await window.bowserPages.permissions.list();
    permissionList.replaceChildren();

    const entries = Object.entries(decisions);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No saved decisions. Sites ask the first time they need something.';
      permissionList.append(empty);
      return;
    }

    for (const [key, decision] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      const [origin, permission] = key.split('|');
      const row = document.createElement('div');
      row.className = 'row';

      const main = document.createElement('div');
      main.className = 'main';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = new URL(origin).host;
      main.append(title);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${PERMISSION_LABELS[permission] ?? permission} — ${decision === 'allow' ? 'Allowed' : 'Blocked'}`;

      const actions = document.createElement('div');
      actions.className = 'actions';
      const remove = document.createElement('button');
      remove.className = 'danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        await window.bowserPages.permissions.remove(key);
        refreshPermissions();
      });
      actions.append(remove);

      row.append(main, meta, actions);
      permissionList.append(row);
    }
  }

  refreshPermissions();
```

- [ ] **Step 5: Verify**

With decisions saved from Task 8's verify, open `bowser://settings/` (Cmd+,). Expected: "Site permissions" lists `permission.site — Camera/microphone — Allowed` and `— Notifications — Blocked`, each with Remove. Remove the media row, revisit permission.site, click Camera & Microphone → the prompt bar asks again.

- [ ] **Step 6: Commit**

```bash
git add src/main/pages.js src/main/tab-preload.js src/renderer/pages/settings.html src/renderer/pages/settings.js
git commit -m "Manage saved site-permission decisions from Settings"
```

---

## Deferred to their own plans

- **Omnibox suggestions** (history/bookmark/search-suggest dropdown) — the one real feature build; needs its own UI/ranking/keyboard-navigation spec.
- **Multiple windows + private mode** — architectural: per-window tab maps, a non-persisted session partition, and re-attaching adblock/downloads/permissions per session.
- **Security indicator + certificate-error page** — https/http state in the address bar and a cert-error explanation (with no bypass, or a deliberate one) on `bowser://error`.
- Tab context menu, pinned tabs, audio indicators, bookmarks bar, download pause/resume, find-match highlighting — quality-of-life tier, none blocking.
