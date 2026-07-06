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
