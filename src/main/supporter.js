const { app, net } = require('electron');
const os = require('os');
const settings = require('./settings');

// Blanc Supporter activation against Polar's customer-portal API.
// Philosophy: activate once online, trust the local record forever — no
// revalidation, no lockout, works offline. Perks are cosmetics; anything
// heavier would betray the brand (see the phase-1 monetization spec).

// The Polar organization id (public, not a secret) — the production org
// "bnfy" (see docs/polar-setup.md). Note: dev runs hit the sandbox API
// below, where this production id doesn't exist — testing activation in
// dev requires temporarily swapping in a sandbox org id + test key.
const POLAR_ORGANIZATION_ID = '6f675077-6cb1-4965-8db8-15838e5fdb38';

// Packaged builds hit production; dev runs hit Polar's sandbox so test
// keys never touch real data (mirrors the app.isPackaged telemetry guard).
const API_BASE = app.isPackaged ? 'https://api.polar.sh' : 'https://sandbox-api.polar.sh';

// Polar keys are short tokens (well under 100 chars); this is a client-side
// backstop against a stray paste (e.g. clipboard mishap) rather than a
// license key, not a real format check — Polar's own API is authoritative.
const MAX_KEY_LENGTH = 200;

async function activateSupporter(key) {
  const trimmed = String(key ?? '').trim();
  if (!trimmed) return { ok: false, message: 'Enter a license key.' };
  if (trimmed.length > MAX_KEY_LENGTH) {
    return { ok: false, message: 'That doesn’t look like a license key.' };
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
    const activatedAt = new Date().toISOString();
    settings.setSupporter({ key: trimmed, activationId: activation?.id ?? null, activatedAt });
    return { ok: true, activatedAt };
  }
  if (res.status === 404) {
    return { ok: false, message: 'That key doesn’t look right — check it against your Polar receipt.' };
  }
  if (res.status === 403) {
    return { ok: false, message: 'This key can’t be activated — it may have reached its device limit.' };
  }
  return { ok: false, message: `Activation failed (HTTP ${res.status}) — try again later.` };
}

module.exports = { activateSupporter };
