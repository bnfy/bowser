const { app, net } = require('electron');

// The collector Worker in cloudflare/ping-worker — accepts a JSON POST,
// returns 204.
const PING_ENDPOINT = 'https://bowser-ping.bnfy-441.workers.dev/ping';

// Opt-in only (Settings → usagePing, off by default). Fire-and-forget: a
// failed or blocked ping must never affect startup or show the user
// anything. Anonymous — no persistent id, just enough to bucket by
// version/platform.
function sendLaunchPing() {
  if (!app.isPackaged) return; // dev runs shouldn't inflate counts

  const payload = JSON.stringify({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  });

  net.fetch(PING_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  }).catch((err) => {
    console.warn('[telemetry] launch ping failed:', err.message);
  });
}

module.exports = { sendLaunchPing };
