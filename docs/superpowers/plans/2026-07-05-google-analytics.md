# Google Analytics (site + ping forwarding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consent-gated GA4 on getbowser.com, plus server-side forwarding of app launch pings from the `bowser-ping` Cloudflare Worker into the same GA4 property.

**Architecture:** The site gets a small consent banner; gtag.js (`G-MN8BLY6GE9`) is injected only after the visitor clicks Allow, with the choice persisted in `localStorage`. The app binary is untouched: the existing Worker forwards each launch ping to GA4's Measurement Protocol inside `ctx.waitUntil()`, with a random `client_id` per event.

**Tech Stack:** Vanilla JS/CSS in `site/index.html` (no libraries), Cloudflare Workers, GA4 Measurement Protocol, wrangler CLI, 1Password CLI for the secret.

## Global Constraints

- GA measurement ID: `G-MN8BLY6GE9` (web stream "Bowser Website").
- No Google request of any kind before the visitor clicks Allow.
- `localStorage` key: `ga-consent`, values `"granted"` / `"denied"`.
- Worker forwarding uses a **random** `client_id` per event (`crypto.randomUUID()`) — never a persistent id.
- If `env.GA_API_SECRET` is unset, the Worker must behave exactly as today.
- The GA API secret must never appear in chat, terminal output, or git — it flows 1Password → `wrangler secret put` via a pipe.
- This repo has no test suite (per CLAUDE.md); each task ends with explicit manual verification commands instead of unit tests.
- Banner copy: `Anonymous analytics help us gauge interest — allow?` Buttons: `Allow`, `No thanks`.

---

### Task 1: Consent banner + gated GA loader on the site

**Files:**
- Modify: `site/index.html` (three insertions: CSS in the `<style>` block ~line 35+, HTML after the `</footer>` at line 821, JS at the end of the inline `<script>` starting line 823)

**Interfaces:**
- Consumes: existing CSS tokens `--surface-raised`, `--border`, `--radius`, `--font-mono`, `--accent`, `--bg`, `--text-dim`.
- Produces: nothing consumed by later tasks (site is self-contained).

- [ ] **Step 1: Add banner CSS**

Insert inside the existing `<style>` block, after the `.mono` rule (`site/index.html:40`):

```css
  /* Consent banner */
  .consent {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    z-index: 100; display: flex; align-items: center; gap: 14px;
    max-width: calc(100vw - 32px); flex-wrap: wrap; justify-content: center;
    padding: 12px 16px; background: var(--surface-raised);
    border: 1px solid var(--border); border-radius: var(--radius);
    font-family: var(--font-mono); font-size: 12.5px; color: var(--text-dim);
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.4);
  }
  .consent[hidden] { display: none; }
  .consent button {
    font-family: var(--font-mono); font-size: 12px; padding: 6px 12px;
    border-radius: var(--radius); border: 1px solid var(--accent);
    background: var(--accent); color: var(--bg); cursor: pointer;
  }
  .consent button.ghost { background: transparent; color: var(--text-dim); border-color: var(--border); }
```

- [ ] **Step 2: Add banner HTML**

Insert between `</footer>` (line 821) and the `<script>` tag (line 823):

```html
<div id="consent" class="consent" hidden>
  <span>Anonymous analytics help us gauge interest — allow?</span>
  <button id="consentAllow">Allow</button>
  <button id="consentDeny" class="ghost">No thanks</button>
</div>
```

- [ ] **Step 3: Add the gated loader JS**

Append at the very end of the existing inline `<script>` block (before its closing `</script>`):

```js
  // ---------- Consent-gated analytics ----------
  // Nothing Google-related loads until the visitor clicks Allow; the choice
  // sticks in localStorage. Wrapped so a failure means no banner and no GA,
  // never a broken page.
  try {
    const GA_ID = 'G-MN8BLY6GE9';
    const loadGA = () => {
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { dataLayer.push(arguments); };
      gtag('js', new Date());
      gtag('config', GA_ID);
    };
    const consent = localStorage.getItem('ga-consent');
    if (consent === 'granted') {
      loadGA();
    } else if (consent !== 'denied') {
      const banner = document.getElementById('consent');
      banner.hidden = false;
      document.getElementById('consentAllow').addEventListener('click', () => {
        localStorage.setItem('ga-consent', 'granted');
        banner.hidden = true;
        loadGA();
      });
      document.getElementById('consentDeny').addEventListener('click', () => {
        localStorage.setItem('ga-consent', 'denied');
        banner.hidden = true;
      });
    }
  } catch (e) { /* no banner, no GA */ }
```

- [ ] **Step 4: Verify locally**

Run: `python3 -m http.server 8080 --directory site` (background), open `http://localhost:8080/` in a browser with devtools → Network filtered to `google`:
- Fresh profile/cleared storage: banner visible, **zero** google requests.
- Click **No thanks**: banner hides, `localStorage.getItem('ga-consent') === 'denied'`, reload → no banner, no google requests.
- Clear storage, reload, click **Allow**: `googletagmanager.com/gtag/js` request fires, reload → no banner, gtag loads again.
Stop the server afterwards.

- [ ] **Step 5: Commit**

```bash
git add site/index.html
git commit -m "Add consent-gated Google Analytics to getbowser.com"
```

---

### Task 2: Worker forwards pings to GA Measurement Protocol

**Files:**
- Modify: `cloudflare/ping-worker/src/index.js`
- Modify: `cloudflare/ping-worker/README.md` (document GA_API_SECRET)

**Interfaces:**
- Consumes: existing `handlePing(request, env)` / `handleStats(request, env)` and the `bump`/`todayKey` helpers (unchanged).
- Produces: `forwardToGA(env, {version, platform, arch})` returning a Promise; `fetch(request, env, ctx)` now takes `ctx`; reads optional `env.GA_API_SECRET`.

- [ ] **Step 1: Add the forwarder and wire it in**

In `cloudflare/ping-worker/src/index.js`, add below `ALLOWED_PLATFORMS`:

```js
const GA_MEASUREMENT_ID = 'G-MN8BLY6GE9';
const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

// Mirrors each ping into GA4 so app launches sit next to website traffic.
// client_id is random per event — no persistent id, so GA's *user* counts
// are meaningless by design; only event counts (launches) are real.
function forwardToGA(env, { version, platform, arch }) {
  if (!env.GA_API_SECRET) return Promise.resolve();
  const url = `${GA_ENDPOINT}?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${env.GA_API_SECRET}`;
  return fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      client_id: crypto.randomUUID(),
      events: [{ name: 'app_launch', params: { app_version: version, platform, arch } }],
    }),
  }).catch((err) => console.warn('GA forward failed:', err.message));
}
```

Change `handlePing` to accept `ctx`, extract `arch`, and forward. The full new `handlePing`:

```js
async function handlePing(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const version = typeof body.version === 'string' ? body.version.slice(0, 32) : 'unknown';
  const platform = ALLOWED_PLATFORMS.has(body.platform) ? body.platform : 'unknown';
  const arch = typeof body.arch === 'string' ? body.arch.slice(0, 16) : 'unknown';

  await Promise.all([
    bump(env.PINGS, 'total'),
    bump(env.PINGS, todayKey()),
    bump(env.PINGS, `version:${version}`),
    bump(env.PINGS, `platform:${platform}`),
  ]);

  ctx.waitUntil(forwardToGA(env, { version, platform, arch }));

  return new Response(null, { status: 204 });
}
```

And the export gains `ctx`:

```js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/ping') return handlePing(request, env, ctx);
    if (request.method === 'GET' && url.pathname === '/stats') return handleStats(request, env);
    return new Response('not found', { status: 404 });
  },
};
```

- [ ] **Step 2: Document the secret in the Worker README**

In `cloudflare/ping-worker/README.md`, add to the Deploy section after the `STATS_TOKEN` line:

```
npx wrangler secret put GA_API_SECRET             # optional: GA4 Measurement Protocol API secret; when set, pings are mirrored to GA as app_launch events
```

- [ ] **Step 3: Commit**

```bash
git add cloudflare/ping-worker/src/index.js cloudflare/ping-worker/README.md
git commit -m "Mirror launch pings into GA4 via Measurement Protocol"
```

---

### Task 3: Set GA_API_SECRET and deploy the Worker

**Files:** none (deployment only)

**Interfaces:**
- Consumes: 1Password item `op://Dev/Bowser GA MP secret/credential` (created by the owner), Task 2's Worker code.
- Produces: live Worker with GA forwarding at `https://bowser-ping.bnfy-441.workers.dev`.

- [ ] **Step 1: Set the secret from 1Password (never echo it)**

```bash
cd cloudflare/ping-worker
op read "op://Dev/Bowser GA MP secret/credential" | npx wrangler secret put GA_API_SECRET
```

Expected: `✨ Success! Uploaded secret GA_API_SECRET`. If `op read` fails, stop and ask the owner to check the item name/field — do not paste the secret manually.

- [ ] **Step 2: Deploy**

```bash
npx wrangler deploy
```

Expected: `Deployed bowser-ping triggers` with the same `workers.dev` URL as before.

- [ ] **Step 3: Verify ping path end-to-end**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://bowser-ping.bnfy-441.workers.dev/ping \
  -H 'Content-Type: application/json' \
  -d '{"version":"0.9.1","platform":"darwin","arch":"arm64"}'
```

Expected: `204`. Then confirm `/stats` still tallies (needs the STATS_TOKEN from 1Password):

```bash
op run --no-masking -- sh -c 'curl -s -H "Authorization: Bearer $(op read "op://Dev/Bowser Ping STATS_TOKEN/credential")" https://bowser-ping.bnfy-441.workers.dev/stats'
```

Expected: JSON with `total` incremented by the test ping. Finally ask the owner to check GA4 **Realtime** for an `app_launch` event (takes up to a minute) — the agent cannot log into GA.

---

### Task 4: Deploy the site and push

**Files:** none (deployment only)

**Interfaces:**
- Consumes: Task 1's `site/index.html`.
- Produces: live consent-gated GA on the production site.

- [ ] **Step 1: Deploy to Cloudflare Pages**

```bash
npx wrangler pages deploy site --project-name getbowser
```

Expected: a deployment URL ending in `.pages.dev` (production aliases getbowser.com).

- [ ] **Step 2: Verify production**

Confirm the deployed HTML contains the banner and no unconditional gtag `<script src>` tag:

```bash
curl -s https://getbowser.com | grep -c "googletagmanager" ; curl -s https://getbowser.com | grep -c 'id="consent"'
```

Expected: first grep `1` (the string appears only inside the inline loader JS, not as a `src=` tag — eyeball it), second grep `1`. Then repeat Task 1 Step 4's browser checks against `https://getbowser.com`.

- [ ] **Step 3: Push all commits**

```bash
git push
```

Expected: `main -> main`. (Push to main was the owner's chosen convention for this work; if the permission classifier blocks it, stop and ask.)
