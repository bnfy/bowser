# Monetization Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship trust-aligned monetization rails: repo/site support links + a download-stats script, the $19 "Blanc Supporter" license (Polar.sh key activation unlocking three supporter-only Dock colorways), and grant drafts + a B2B line on the marketing site.

**Architecture:** Supporter state is a nullable record in the existing `settings.json` JsonStore, written only by a new main-process activation module that calls Polar's customer-portal license API once (activate-and-trust-forever, no revalidation). The renderer sees only a derived `supporterActive` boolean via the existing guarded `pages:*` IPC. Colorway gating extends the existing `appIcon` whitelist pattern. Everything else is assets, copy, and shell scripts.

**Tech Stack:** Electron main-process `net.fetch`, existing `JsonStore`, ImageMagick (`magick`, already installed at `/opt/homebrew/bin/magick`) for icon generation, `gh` CLI for stats, plain HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-07-06-monetization-phase1-design.md` — read it first.

## Global Constraints

- **No new npm dependencies.** Everything uses Electron built-ins, shell, or ImageMagick.
- **No CSP changes** in any HTML file — the Polar fetch happens in the main process.
- **Flat pages dir:** any asset used by `pages/*.html` must sit directly in `src/renderer/pages/` (the `blanc://` handler resolves via `path.basename()`; no subdirectories).
- **Do not touch** the JSON-LD block in `site/index.html` (its `"softwareVersion"` line is sed-target of `scripts/release.sh`) or rename any `bowserPages`/`bookmarks` internal identifiers.
- **No test suite exists** (per CLAUDE.md — no `npm test`, no linter). Each task verifies via `node --check` plus manual `npm start` checks. Chrome/pages HTML+CSS changes require an app **relaunch**, not Cmd+R.
- **Copy voice:** marketing site is lowercase/mono/restrained; Settings copy is sentence case, quiet, no exclamation marks.
- **Polar constants ship as placeholders** (`POLAR_ORGANIZATION_ID = ''`, checkout URL `href="#"` + TODO comment) until the user's Polar account exists; empty-config code paths must degrade with a clear message, never throw.
- Supporter colorway ids and labels: `ember`/Ember (bg `#824C3B`, mark `#F6EDE4`), `plum`/Plum (bg `#4A3B52`, mark `#E6DFEE`), `gold`/Gold (bg `#201B10`, mark `#C2A566`).
- Commit style: short imperative sentence-case subject (match `git log`), ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Support rails — FUNDING.yml + download-stats script

**Files:**
- Create: `.github/FUNDING.yml`
- Create: `scripts/stats.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: standalone artifacts; no later task depends on them.

- [ ] **Step 1: Create `.github/FUNDING.yml`**

```yaml
# GitHub natively supports Polar as a funding platform — this adds the
# repo "Sponsor" button with no approval process. The handle must match
# the Polar organization slug (see docs/polar-setup.md).
polar: bnfy
```

- [ ] **Step 2: Create `scripts/stats.sh`**

```bash
#!/usr/bin/env bash
# Per-release download counts from GitHub Releases, splitting real
# installer downloads (.dmg / -mac.zip / .exe / .AppImage) from
# update-check metadata (.yml / .blockmap), which the auto-updater
# fetches on every launch and would otherwise inflate the numbers.
# Read-only; uses the gh CLI's cached auth like release.sh.
set -euo pipefail

command -v gh >/dev/null 2>&1 || { echo "error: gh CLI is required" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: gh is not authenticated (run: gh auth login)" >&2; exit 1; }

{
  printf 'tag\tinstalls\tupdate-checks\n'
  gh api 'repos/bnfy/blanc/releases' --paginate --jq '
    .[] | [
      .tag_name,
      ([.assets[] | select(.name | test("\\.(dmg|exe|AppImage)$|\\.zip$")) | .download_count] | add // 0),
      ([.assets[] | select(.name | test("\\.(yml|blockmap)$")) | .download_count] | add // 0)
    ] | @tsv'
} | column -t -s $'\t'
```

- [ ] **Step 3: Make it executable and run it**

Run: `chmod +x scripts/stats.sh && ./scripts/stats.sh`
Expected: a table with one row per release (v0.9.7 … v0.1.0); current numbers are single-digit installs — that's correct, not a bug.

- [ ] **Step 4: Commit**

```bash
git add .github/FUNDING.yml scripts/stats.sh
git commit -m "Add Polar funding link and release download stats script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Supporter colorway assets (ember, plum, gold)

**Files:**
- Create: `scripts/gen-supporter-icons.sh`
- Create: `src/renderer/pages/icon-ember.png`, `src/renderer/pages/icon-plum.png`, `src/renderer/pages/icon-gold.png`

**Interfaces:**
- Consumes: `src/renderer/pages/icon-default.png` (the geometry template: 1024×1024, transparent canvas, 824×824 rounded square inset 100px, mark 522px tall centered; bg `#2F4639`, mark `#F4F4F1`).
- Produces: the three PNGs Task 3 whitelists and Task 6 displays. Filenames must be exactly `icon-<id>.png` — `applyAppIcon()` and the settings grid derive paths from the id.

- [ ] **Step 1: Create `scripts/gen-supporter-icons.sh`**

The trick: `icon-default.png` is dark bg + near-white mark, so a flattened
grayscale of it *is* a blend mask (0 = background, 1 = mark, antialiasing
preserved). Recoloring = composite mark-color over bg-color through that
mask, then re-apply the original alpha (the rounded-square shape). This
reproduces the fixed geometry pixel-perfectly without re-deriving it.

```bash
#!/usr/bin/env bash
# Regenerate the supporter-only Dock colorways from icon-default.png,
# which serves as the geometry template (see CLAUDE.md "App icon").
# Colors live here and nowhere else; rerun after any mark change.
set -euo pipefail
cd "$(dirname "$0")/../src/renderer/pages"

TEMPLATE=icon-default.png
TEMPLATE_BG='#2F4639'

gen() { # id bg mark
  magick \( -size 1024x1024 xc:"$2" \) \
    \( -size 1024x1024 xc:"$3" \) \
    \( "$TEMPLATE" -background "$TEMPLATE_BG" -alpha remove -colorspace gray -auto-level \) \
    -composite \
    \( "$TEMPLATE" -alpha extract \) -compose CopyOpacity -composite \
    "icon-$1.png"
  echo "wrote icon-$1.png"
}

gen ember '#824C3B' '#F6EDE4'
gen plum  '#4A3B52' '#E6DFEE'
gen gold  '#201B10' '#C2A566'
```

- [ ] **Step 2: Run it**

Run: `chmod +x scripts/gen-supporter-icons.sh && ./scripts/gen-supporter-icons.sh`
Expected: three `wrote icon-*.png` lines.

- [ ] **Step 3: Verify geometry and colors**

Run:
```bash
cd src/renderer/pages
for f in ember plum gold; do
  magick identify "icon-$f.png"                                   # expect 1024x1024
  magick "icon-$f.png" -format "corner=%[pixel:p{10,10}] bg=%[pixel:p{200,512}] mark=%[pixel:p{512,270}]\n" info:
done
```
Expected per file: `corner=srgba(0,0,0,0)` (transparent outside the tile), `bg=` the tile color (e.g. ember ≈ `srgba(130,76,59,1)`), `mark=` the mark color (e.g. ember ≈ `srgba(246,237,228,1)`). Open one in Preview/Read tool and eyeball it against `icon-forest.png` — same shape, same mark, new colors.

- [ ] **Step 4: Commit**

```bash
git add scripts/gen-supporter-icons.sh src/renderer/pages/icon-{ember,plum,gold}.png
git commit -m "Add supporter icon colorways (ember, plum, gold) and generator

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Main-process supporter model — settings.js + applyAppIcon

**Files:**
- Modify: `src/main/settings.js` (whole file is 76 lines; changes below)
- Modify: `src/main/main.js:191-202` (`applyAppIcon`)

**Interfaces:**
- Consumes: `JsonStore` (existing).
- Produces (Tasks 4–6 rely on these exact names):
  - `SUPPORTER_ICONS: string[]` — `['ember', 'plum', 'gold']`, exported.
  - `isSupporterActive(): boolean` — true iff `settings.supporter` is set, exported.
  - `setSupporter(record): void` — `record = { key: string, activationId: string|null, activatedAt: string }`; writes the store and notifies `onSettingsChanged` listeners, exported.
  - `getSettings()` now includes `supporter: null | {key, activationId, activatedAt}`.

- [ ] **Step 1: Edit `src/main/settings.js`**

After the `APP_ICONS` constant (line 13), add:

```js
// Supporter-only colorways — same geometry, unlocked by a Polar license
// key (see main/supporter.js). Gated at validation time, not render time.
const SUPPORTER_ICONS = ['ember', 'plum', 'gold'];
```

In `DEFAULTS`, after `usagePing: false,` add:

```js
  // Blanc Supporter license — null, or { key, activationId, activatedAt }.
  // Written only by setSupporter() (the Polar activation flow), never by
  // the generic setSettings() path. Once set, trusted forever — offline OK.
  supporter: null,
```

Replace the `appIcon` line in `setSettings()` (`if (APP_ICONS.includes(partial.appIcon)) clean.appIcon = partial.appIcon;`) with:

```js
  if (
    APP_ICONS.includes(partial.appIcon) ||
    (SUPPORTER_ICONS.includes(partial.appIcon) && isSupporterActive())
  ) {
    clean.appIcon = partial.appIcon;
  }
```

After `onSettingsChanged`, add:

```js
function isSupporterActive() {
  return !!ensureStore().data.supporter;
}

/** The activation flow's private write path — the generic setSettings()
 * whitelist deliberately has no `supporter` entry. */
function setSupporter(record) {
  ensureStore().update((data) => {
    data.supporter = record;
  });
  for (const fn of listeners) fn(getSettings());
}
```

Extend the exports line to:

```js
module.exports = {
  SEARCH_ENGINES,
  APP_ICONS,
  SUPPORTER_ICONS,
  getSettings,
  setSettings,
  onSettingsChanged,
  searchUrlFor,
  isSupporterActive,
  setSupporter,
};
```

- [ ] **Step 2: Edit `applyAppIcon()` in `src/main/main.js`**

Replace the `const file = ...` line (currently `const file = settings.APP_ICONS.includes(id) ? id : 'default';`) with:

```js
  // A supporter icon in settings without an active license (hand-edited or
  // copied settings.json) falls back to default rather than honoring it.
  const allowed =
    settings.APP_ICONS.includes(id) ||
    (settings.SUPPORTER_ICONS.includes(id) && settings.isSupporterActive());
  const file = allowed ? id : 'default';
```

- [ ] **Step 3: Syntax-check and smoke-run**

Run: `node --check src/main/settings.js && node --check src/main/main.js && npm start`
Expected: both checks silent; app launches; Settings page icon picker still works with the five free colorways (supporter ones aren't in the UI yet).

- [ ] **Step 4: Verify the gate**

Quit the app. Edit `~/Library/Application Support/Blanc-Dev/settings.json` (dev runs get their own `-Dev` userData — `main.js:30`) and set `"appIcon": "ember", "supporter": null`. Relaunch `npm start`.
Expected: Dock shows the **default** icon (fallback worked). Then set `"supporter": {"key":"test","activationId":null,"activatedAt":"2026-07-06T00:00:00Z"}`, relaunch: Dock shows the **ember** icon. Reset `appIcon` to `default` and `supporter` to `null` afterwards.

- [ ] **Step 5: Commit**

```bash
git add src/main/settings.js src/main/main.js
git commit -m "Gate supporter icon colorways behind supporter record in settings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Polar activation module

**Files:**
- Create: `src/main/supporter.js`

**Interfaces:**
- Consumes: `settings.setSupporter(record)` from Task 3.
- Produces: `activateSupporter(key: string): Promise<{ok: true} | {ok: false, message: string}>`, exported — Task 5 wires it to IPC. Never throws.

- [ ] **Step 1: Verify the Polar API contract**

Fetch https://docs.polar.sh/api-reference/customer-portal/license-keys/activate (WebFetch or context7). Confirm: method POST, path `/v1/customer-portal/license-keys/activate`, JSON body fields `key`, `organization_id`, `label`, success response containing an activation `id`, and the error statuses for invalid key (404) and activation-limit/not-permitted (403). **If the real contract differs, adjust the code below to match the docs, not vice versa.**

- [ ] **Step 2: Create `src/main/supporter.js`**

```js
const { app, net } = require('electron');
const os = require('os');
const settings = require('./settings');

// Blanc Supporter activation against Polar's customer-portal API.
// Philosophy: activate once online, trust the local record forever — no
// revalidation, no lockout, works offline. Perks are cosmetics; anything
// heavier would betray the brand (see the phase-1 monetization spec).

// The Polar organization id (public, not a secret). Empty until the Polar
// account exists — see docs/polar-setup.md. With it empty, activation
// degrades to a clear message instead of a request.
const POLAR_ORGANIZATION_ID = '';

// Packaged builds hit production; dev runs hit Polar's sandbox so test
// keys never touch real data (mirrors the app.isPackaged telemetry guard).
const API_BASE = app.isPackaged ? 'https://api.polar.sh' : 'https://sandbox-api.polar.sh';

async function activateSupporter(key) {
  const trimmed = String(key ?? '').trim();
  if (!trimmed) return { ok: false, message: 'Enter a license key.' };
  if (!POLAR_ORGANIZATION_ID) {
    return { ok: false, message: 'Supporter activation isn’t configured in this build.' };
  }

  let res;
  try {
    res = await net.fetch(`${API_BASE}/v1/customer-portal/license-keys/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: trimmed,
        organization_id: POLAR_ORGANIZATION_ID,
        label: os.hostname().slice(0, 64),
      }),
    });
  } catch {
    return { ok: false, message: 'Couldn’t reach Polar — check your connection and try again.' };
  }

  if (res.ok) {
    let activation = null;
    try {
      activation = await res.json();
    } catch {
      // Body shape is informational; the 2xx status is what matters.
    }
    settings.setSupporter({
      key: trimmed,
      activationId: activation?.id ?? null,
      activatedAt: new Date().toISOString(),
    });
    return { ok: true };
  }
  if (res.status === 404) {
    return { ok: false, message: 'That key doesn’t look right — check it against your Polar receipt.' };
  }
  if (res.status === 403) {
    return { ok: false, message: 'This key has reached its activation limit.' };
  }
  return { ok: false, message: `Activation failed (HTTP ${res.status}) — try again later.` };
}

module.exports = { activateSupporter };
```

- [ ] **Step 3: Syntax-check**

Run: `node --check src/main/supporter.js`
Expected: silent.

- [ ] **Step 4: Commit**

```bash
git add src/main/supporter.js
git commit -m "Add Polar license activation module for Blanc Supporter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: IPC + preload bridge — sanitize settings, expose activation

**Files:**
- Modify: `src/main/pages.js` (settings handlers, ~lines 71-77)
- Modify: `src/main/tab-preload.js` (settings section, lines 32-35)

**Interfaces:**
- Consumes: `supporter.activateSupporter(key)` (Task 4); `settings.getSettings()` including `supporter` (Task 3).
- Produces (Task 6 relies on these):
  - `pages:settings:get` / `pages:settings:set` responses whose `settings` object has **no `supporter` record** but has `supporterActive: boolean` and `supporterActivatedAt: string|null`.
  - IPC `pages:settings:supporter-activate` → `{ok: true} | {ok: false, message: string}`.
  - Bridge: `window.bowserPages.settings.activateSupporter(key)`.

- [ ] **Step 1: Edit `src/main/pages.js`**

Add to the requires at the top: `const supporter = require('./supporter');`

Replace the two settings handlers (`pages:settings:get` and `pages:settings:set`) with:

```js
  // The renderer never sees the license key or activation id — only the
  // derived booleans. Internal pages are privileged, but least-privilege
  // anyway (same reasoning as the preload's protocol re-check).
  const clientSettings = () => {
    const { supporter: record, ...rest } = settings.getSettings();
    return {
      ...rest,
      supporterActive: !!record,
      supporterActivatedAt: record?.activatedAt ?? null,
    };
  };

  handle('pages:settings:get', () => ({
    settings: clientSettings(),
    searchEngines: Object.fromEntries(
      Object.entries(settings.SEARCH_ENGINES).map(([key, { label }]) => [key, label])
    ),
  }));
  handle('pages:settings:set', (partial) => {
    settings.setSettings(partial ?? {});
    return clientSettings();
  });
  handle('pages:settings:supporter-activate', (key) => supporter.activateSupporter(key));
```

Note: `pages:settings:set` previously returned the raw settings object; the settings renderer ignores the return value today (checked — all `set` calls are fire-and-await), so returning `clientSettings()` is safe.

- [ ] **Step 2: Edit `src/main/tab-preload.js`**

Replace the `settings` block with:

```js
    settings: {
      get: () => ipcRenderer.invoke('pages:settings:get'),
      set: (partial) => ipcRenderer.invoke('pages:settings:set', partial),
      activateSupporter: (key) => ipcRenderer.invoke('pages:settings:supporter-activate', key),
    },
```

- [ ] **Step 3: Syntax-check and smoke-run**

Run: `node --check src/main/pages.js && node --check src/main/tab-preload.js && npm start`
Expected: Settings page loads and all existing controls work. In the app, open the settings page and verify via its behavior (theme/search-engine changes persist). The `supporter` record must not appear in the get payload — verify in Step 4.

- [ ] **Step 4: Verify sanitization**

With the app running, from the settings page the only observable is behavior; instead verify at the source: temporarily add `console.log(JSON.stringify(clientSettings()))` after the definition in `pages.js`? No — simpler and non-invasive: run `npm start`, open Settings, then check the main-process terminal output stays clean, and confirm by reading the code path once more that `clientSettings()` destructures `supporter` out. (The gate that actually matters — key never in the renderer — is structural, not runtime.)
Expected: code review confirms no path returns `supporter` to a renderer.

- [ ] **Step 5: Commit**

```bash
git add src/main/pages.js src/main/tab-preload.js
git commit -m "Expose supporter activation over guarded pages IPC, hide key from renderer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Settings page UI — supporter section + locked colorway tiles

**Files:**
- Modify: `src/renderer/pages/settings.html` (icon grid hint ~line 36; new section before the closing `</div>` of `.page`, after the Clear-browsing-data block ~line 111)
- Modify: `src/renderer/pages/settings.js` (app-icon block, lines 58-96; new supporter block)
- Modify: `src/renderer/pages/pages.css` (after `.icon-swatch.active img`, ~line 250)

**Interfaces:**
- Consumes: `settings.supporterActive` / `settings.supporterActivatedAt` from the get payload; `window.bowserPages.settings.activateSupporter(key)` (Task 5); `icon-{ember,plum,gold}.png` (Task 2).
- Produces: nothing consumed later.

- [ ] **Step 1: Add the supporter section to `settings.html`**

After the Clear-browsing-data `toolbar-row` block (before the final `</div>`), insert:

```html
    <h1 class="section-title" id="supporterTitle">Supporter</h1>
    <p class="section-hint">
      Supporting Blanc unlocks three extra icon colorways — ember, plum, and gold.
      One purchase, activated once; Blanc never phones home afterwards.
    </p>
    <div class="toolbar-row" id="supporterActivateRow">
      <input id="supporterKey" type="text" placeholder="License key" autocomplete="off" spellcheck="false" />
      <button id="supporterActivate">Activate</button>
    </div>
    <p class="section-hint" id="supporterStatus" role="status"></p>
```

- [ ] **Step 2: Rework the app-icon + supporter logic in `settings.js`**

Replace the whole `--- App icon colorways ---` block (lines 58-96) with:

```js
  // --- App icon colorways (Dock icon is macOS-only) ---
  const appIconSetting = document.getElementById('appIconSetting');
  let supporterActive = settings.supporterActive ?? false;
  const appIconGrid = document.getElementById('appIconGrid');

  const FREE_ICONS = [
    ['default', 'Default'],
    ['midnight', 'Midnight'],
    ['cream', 'Cream'],
    ['forest', 'Forest'],
    ['sage', 'Sage'],
  ];
  const SUPPORTER_ICONS = [
    ['ember', 'Ember'],
    ['plum', 'Plum'],
    ['gold', 'Gold'],
  ];

  const selectAppIcon = (id) => {
    for (const btn of appIconGrid.children) {
      btn.classList.toggle('active', btn.dataset.icon === id);
      btn.setAttribute('aria-checked', String(btn.dataset.icon === id));
    }
  };

  function renderAppIconGrid(selectedId) {
    appIconGrid.replaceChildren();
    const entries = [
      ...FREE_ICONS.map(([id, label]) => [id, label, false]),
      ...SUPPORTER_ICONS.map(([id, label]) => [id, label, !supporterActive]),
    ];
    for (const [id, label, locked] of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = locked ? 'icon-swatch locked' : 'icon-swatch';
      btn.dataset.icon = id;
      btn.setAttribute('role', 'radio');
      const img = document.createElement('img');
      img.src = `icon-${id}.png`;
      img.alt = '';
      const name = document.createElement('span');
      name.textContent = label;
      btn.append(img, name);
      if (locked) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'supporter';
        btn.append(tag);
        // A locked tile points at the Supporter section instead of
        // silently failing (main would reject the id anyway).
        btn.addEventListener('click', () => {
          document.getElementById('supporterTitle').scrollIntoView({ behavior: 'smooth' });
          document.getElementById('supporterKey').focus({ preventScroll: true });
        });
      } else {
        btn.addEventListener('click', async () => {
          await window.bowserPages.settings.set({ appIcon: id });
          selectAppIcon(id);
        });
      }
      appIconGrid.append(btn);
    }
    selectAppIcon(selectedId);
  }

  if (!navigator.platform.startsWith('Mac')) {
    appIconSetting.remove();
  } else {
    renderAppIconGrid(settings.appIcon ?? 'default');
  }

  // --- Supporter activation ---
  const supporterActivateRow = document.getElementById('supporterActivateRow');
  const supporterKey = document.getElementById('supporterKey');
  const supporterActivateBtn = document.getElementById('supporterActivate');
  const supporterStatus = document.getElementById('supporterStatus');

  function renderSupporterState() {
    if (!supporterActive) return;
    supporterActivateRow.hidden = true;
    const when = settings.supporterActivatedAt
      ? new Date(settings.supporterActivatedAt).toLocaleDateString()
      : null;
    supporterStatus.textContent = when
      ? `You’re a supporter — thank you. Activated ${when}.`
      : 'You’re a supporter — thank you.';
  }
  renderSupporterState();

  async function activateSupporter() {
    supporterActivateBtn.disabled = true;
    supporterStatus.textContent = 'Activating…';
    const result = await window.bowserPages.settings.activateSupporter(supporterKey.value);
    supporterActivateBtn.disabled = false;
    if (result.ok) {
      supporterActive = true;
      settings.supporterActivatedAt = new Date().toISOString();
      renderSupporterState();
      if (navigator.platform.startsWith('Mac')) {
        const current = appIconGrid.querySelector('.active')?.dataset.icon ?? 'default';
        renderAppIconGrid(current);
      }
    } else {
      supporterStatus.textContent = result.message;
    }
  }
  supporterActivateBtn.addEventListener('click', activateSupporter);
  supporterKey.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') activateSupporter();
  });
```

Note: this block references `supporterTitle`/`supporterKey` before their DOM order? No — the whole script runs after the document (script tag at body end), so all elements exist. The supporter section stays on non-Mac platforms deliberately (supporting isn't Mac-only; the perk currently is, which the hint's wording doesn't overpromise).

- [ ] **Step 3: Add locked-tile styles to `pages.css`**

After `.icon-swatch.active img { outline: 2px solid var(--accent); }` insert:

```css
/* Supporter-only colorways render locked until a license is activated —
   dimmed tile plus a quiet tag; clicking scrolls to the Supporter section. */
.icon-swatch.locked img { opacity: 0.4; filter: none; }
.icon-swatch.locked span { color: var(--text-dim); }
.icon-swatch .tag {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
}
```

- [ ] **Step 4: Relaunch and verify locked state**

Run: `npm start` (chrome/pages changes need a relaunch, not Cmd+R).
Expected in Settings: eight tiles — five normal, three dimmed with a lowercase `supporter` tag; clicking a locked tile scrolls to the Supporter section and focuses the key input; the section shows the input + Activate.

- [ ] **Step 5: Verify activation error paths**

With `POLAR_ORGANIZATION_ID` still empty: enter any key → "Supporter activation isn't configured in this build." Enter nothing → "Enter a license key."
Expected: inline messages in `supporterStatus`, button re-enabled after each.

- [ ] **Step 6: Verify the unlocked state via the store**

Quit; hand-set `"supporter": {"key":"test","activationId":null,"activatedAt":"2026-07-06T00:00:00Z"}` in `~/Library/Application Support/Blanc-Dev/settings.json`; relaunch.
Expected: no locked tiles or tags, supporter tiles selectable (Dock icon actually swaps), activate row hidden, status reads "You're a supporter — thank you. Activated 7/6/2026." Reset the store file afterwards (`"supporter": null`, `"appIcon": "default"`).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/pages/settings.html src/renderer/pages/settings.js src/renderer/pages/pages.css
git commit -m "Add Supporter section and locked colorway tiles to Settings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Marketing site — supporter + custom-builds section

**Files:**
- Modify: `site/index.html` (insert a section between `</header>` (after `.platforms`) and `<footer>`, ~line 128)
- Modify: `site/styles.css` (append after the `footer` rules, ~line 229)

**Interfaces:**
- Consumes: nothing from other tasks. **Do not touch the JSON-LD script block** (release.sh seds `"softwareVersion"` there).
- Produces: markup whose checkout `href` the user fills in post-Polar-setup (see docs/polar-setup.md).

- [ ] **Step 1: Insert the section in `site/index.html`**

Between `</header>` and `<footer>`:

```html
<section class="more">
  <!-- TODO(polar): replace href="#" with the hosted checkout URL once the
       Polar product exists — see docs/polar-setup.md. -->
  <p class="more-line">believe in it? <a href="#">become a supporter</a> — $19 once, three extra icon colorways, our thanks.</p>
  <p class="more-line">custom builds — blanc&rsquo;s shell (network-level content filtering, privileged internal pages, an explicit permission policy) is available for white-label and kiosk work. <a href="mailto:anthony@bnfy.me">get in touch</a>.</p>
</section>
```

- [ ] **Step 2: Append styles in `site/styles.css`**

```css
/* Supporter + custom-builds lines — footer-adjacent, footer-quiet. */
.more { border-top: 1px solid var(--border); padding: 28px 40px; text-align: center; }
.more-line { margin: 6px auto; max-width: 640px; font-family: var(--font-mono); font-size: 12.5px; color: var(--text-dim); }
.more-line a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--border); padding-bottom: 1px; transition: color 0.15s, border-color 0.15s; }
.more-line a:hover { color: var(--accent); border-color: var(--accent); }
```

- [ ] **Step 3: Verify locally and check the sed target survived**

Run: `open site/index.html` (or a quick `python3 -m http.server -d site 8899` and view) and `grep -n '"softwareVersion"' site/index.html`
Expected: new section renders between the hero and footer in the site's quiet voice; the grep still finds exactly one `"softwareVersion": "0.9.7"` line, unchanged.

- [ ] **Step 4: Commit (do not deploy yet)**

Deploy is gated on the Polar checkout URL (User-side steps below). Note: `site/index.html` has an unrelated pre-existing uncommitted change — stage hunks carefully or ask the user if it should ride along.

```bash
git add site/styles.css
git add -p site/index.html   # stage only the .more section hunk
git commit -m "Add supporter and custom-builds lines to marketing site

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Grant drafts — NLnet + FUTO

**Files:**
- Create: `docs/grants/nlnet-commons-fund.md`
- Create: `docs/grants/futo-pitch.md`

**Interfaces:** standalone prose; nothing consumes them. **Nothing is submitted** — drafts for the user to review, edit, and submit.

- [ ] **Step 1: Create `docs/grants/nlnet-commons-fund.md`**

```markdown
# NLnet Commons Fund application — Blanc (draft)

> Draft for https://nlnet.nl/commonsfund/ — answers map to the actual form
> fields. Review, adjust the budget to taste, and submit before the next
> deadline (calls close on the 1st of every even month). Nothing here has
> been submitted.

## Project name

Blanc — a minimal, user-agency-first desktop browser shell

## Website / repository

https://blancbrowser.com · https://github.com/bnfy/blanc

## Abstract (max ~1200 chars)

Blanc is an independent, open-source desktop browser for macOS, Windows,
and Linux that treats user agency as the baseline, not an extension.
Ad and tracker blocking (EasyList/EasyPrivacy) is wired in at the network
layer of the browser itself — independent of any extension store and of
Manifest V3's declarativeNetRequest limits, which are steadily narrowing
what user-installed blockers may do. The interface is a single floating
"island" replacing the tab strip and toolbar, private tabs never touch
disk history, permissions are explicit, and telemetry is a single opt-in,
anonymous launch ping. This grant funds the work that makes an independent
shell a *practical* daily browser rather than a demo: WebAuthn
platform-authenticator (passkey) support, which today is gated behind
OS-vendor allowlists that exclude independent browsers; feature parity for
the Windows/Linux builds; hardened, reproducible filter-list update
infrastructure; and an accessibility pass on the custom-drawn chrome.

## Have you been involved with projects or organisations relevant to this project before?

Blanc is built and maintained by an independent developer (BNFY). The
project has already cleared one gate that matters for legitimacy:
inclusion in Apple's password-manager-resources browser dataset
(apple/password-manager-resources PR #1137, merged July 2026).

## Requested amount

EUR 15,000

## Explain what the requested budget will be used for

Six months of part-time development, in four deliverables:
1. Passkey/WebAuthn platform-authenticator support — pursue Apple's
   com.apple.developer.web-browser.public-key-credential entitlement,
   implement the credential flows, document the process publicly so other
   independent shells can follow it (~EUR 5,000).
2. Windows/Linux feature parity with the macOS build, including
   distribution hardening (signing, update channel) (~EUR 4,000).
3. Filter-list infrastructure: reproducible engine builds, update
   pipeline, and cosmetic-filtering hardening (~EUR 3,000).
4. Accessibility audit and fixes for the custom-drawn chrome (screen
   reader labels, keyboard-only operation, contrast) (~EUR 3,000).

## Compare your own project with existing or historical efforts

Firefox forks (LibreWolf, Waterfox) inherit Gecko's UI and Mozilla's
churn; Chromium forks with business models attached (Brave) bundle
crypto/ads; ungoogled-chromium is a de-Googling patchset, not a product a
non-technical person can adopt. Blanc differs in that it is a *shell*:
a deliberately small, auditable codebase (~single-digit-thousands of
lines around the Chromium engine via Electron) where blocking, privacy
behavior, and UI are all first-party code — small enough for one person
to understand end-to-end, which is precisely the property that makes
user-agency guarantees credible.

## What are significant technical challenges you expect to solve during the project?

Vendor allowlists for platform authenticators (the entitlement process is
opaque and undocumented for independent browsers); keeping network-level
blocking robust as sites adapt to cosmetic filtering; making an
Electron-based shell accessible when the chrome is fully custom-drawn;
reproducible cross-platform release infrastructure for a one-person team.

## Describe the ecosystem of the project, and how you will engage with relevant actors and promote the outcomes

Users: people who want a quiet, blocking-by-default browser without a
corporate agenda. Ecosystem: EasyList/EasyPrivacy maintainers (upstream
filter lists), Ghostery's adblocker library (engine), the Electron
project, and Apple's password-manager-resources dataset. All outcomes
land in the public repo; the entitlement documentation in particular
fills a gap every independent browser project currently hits blind.
```

- [ ] **Step 2: Create `docs/grants/futo-pitch.md`**

```markdown
# FUTO pitch — Blanc (draft)

> Short email-style pitch for https://futo.org (rolling submissions,
> grants@futo.org). Review and send personally — nothing has been sent.

Subject: Grant inquiry — Blanc, an independent ad-blocking-first desktop browser

Hi,

I build Blanc (https://blancbrowser.com, https://github.com/bnfy/blanc),
an open-source desktop browser for macOS/Windows/Linux with one premise:
the browser itself should be on the user's side. Ad and tracker blocking
runs at the network layer of the app — no extension store, no Manifest V3
ceiling — private tabs never touch disk, permissions are explicit, and
telemetry is a single opt-in anonymous launch ping. The whole shell is
deliberately small enough for one person to audit.

It's shipping today (three platforms, signed and notarized, auto-updates)
and was recently accepted into Apple's password-manager-resources dataset.
The gap between "shipping" and "viable for normal people" is a short,
concrete list: passkey/WebAuthn platform-authenticator support (currently
gated behind OS-vendor allowlists that exclude independent browsers — I
want to both implement it and document the path publicly), Windows/Linux
parity, and an accessibility pass on the custom chrome.

I'm seeking on the order of $10–20k to fund six months of focused
part-time work on exactly that list. Happy to share roadmap, architecture
notes, or anything else useful.

Thanks for considering it,
Anthony Loria
anthony@bnfy.me
```

- [ ] **Step 3: Commit**

```bash
git add docs/grants/
git commit -m "Draft NLnet and FUTO grant applications

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Polar setup doc, CLAUDE.md note, final verification sweep

**Files:**
- Create: `docs/polar-setup.md`
- Modify: `CLAUDE.md` (add a Supporter paragraph after the **Telemetry** section)

**Interfaces:** consumes everything; produces the user-facing runbook.

- [ ] **Step 1: Create `docs/polar-setup.md`**

```markdown
# Polar setup — Blanc Supporter (manual, one-time)

The code ships with placeholders; these steps light it up.

1. Create a Polar organization at https://polar.sh — use handle `bnfy`
   (it's what `.github/FUNDING.yml` points at; if you pick another,
   update that file).
2. Create product **Blanc Supporter**: one-time purchase, **$19**, with
   the **License Keys** benefit enabled, activation limit **5**.
   Do the same in the sandbox dashboard (https://sandbox.polar.sh) with a
   test product for dev testing.
3. Copy the organization id (Settings → General in the Polar dashboard)
   into `POLAR_ORGANIZATION_ID` in `src/main/supporter.js`. Note the
   sandbox org has its own id — for dev testing, temporarily use the
   sandbox org id (dev builds already point at sandbox-api.polar.sh).
4. Copy the hosted checkout URL into the `href="#"` of the
   "become a supporter" link in `site/index.html` (marked TODO(polar)).
5. Test end-to-end in dev: buy the sandbox product with Polar's test
   card, activate the key in Settings, confirm colorways unlock.
6. Deploy the site: `npx wrangler pages deploy site --project-name=blancbrowser`.
7. Ship a release so packaged builds carry the production org id.
```

- [ ] **Step 2: Add a paragraph to `CLAUDE.md`**

After the **Telemetry** paragraph, insert:

```markdown
**Blanc Supporter** (`src/main/supporter.js`): a $19 one-time Polar.sh license that unlocks three supporter-only Dock colorways (`ember`, `plum`, `gold` — generated by `scripts/gen-supporter-icons.sh` from `icon-default.png`, same fixed geometry). Activation happens once in the main process against Polar's customer-portal API (dev builds hit the sandbox; `POLAR_ORGANIZATION_ID` empty = graceful "not configured" message) and writes `settings.supporter` via `setSupporter()` — the only writer; the generic `setSettings()` whitelist deliberately ignores it. Once set, the record is trusted forever: no revalidation, no phone-home, works offline — perks are cosmetics, DRM would betray the brand. Renderers only ever see a derived `supporterActive` boolean, never the key. Supporter colorway ids are rejected from `appIcon` (and fall back to `default` in `applyAppIcon`) unless the record exists.
```

- [ ] **Step 3: Full manual verification sweep (spec's testing checklist)**

Run `npm start` and walk the spec's seven checks:
1. Settings: supporter tiles locked, free colorways still selectable.
2. Skip (needs a sandbox key — covered in docs/polar-setup.md step 5).
3. Hand-set `supporter` in dev settings.json → relaunch offline (Wi-Fi off): colorways unlocked and applied, no network errors in the terminal.
4. Empty key and not-configured errors show inline (airplane-mode Polar errors also covered once the org id exists).
5. Supporter icon + `supporter: null` in settings.json → falls back to default.
6. `./scripts/stats.sh` prints the table.
7. Site renders both new lines; `grep '"softwareVersion"' site/index.html` unchanged.
Reset dev settings.json when done.

- [ ] **Step 4: Commit**

```bash
git add docs/polar-setup.md CLAUDE.md
git commit -m "Document Polar setup and the Supporter subsystem

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## User-side manual steps (after all tasks)

1. Walk `docs/polar-setup.md` (Polar account → org id → checkout URL → sandbox test → site deploy → release).
2. Review and submit `docs/grants/nlnet-commons-fund.md` (next even-month deadline) and `docs/grants/futo-pitch.md`.
3. Confirm the GitHub Sponsor button appears once FUNDING.yml is on the default branch and the Polar handle exists.
