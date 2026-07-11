// Pure classification behind main.js's handOffToOs — extracted so the
// external-protocol policy is unit-testable without Electron (the pattern
// permission-decisions.js set). The caller owns the side effects (the
// shell.openExternal call, the confirmation dialog, the one-prompt-at-a-time
// guard); this module only decides what the URL is allowed to become.
//
// Deliberately a small allowlist: launching arbitrary registered URL schemes
// is a run-anything vector.
const HANDOFF_PROTOCOLS = new Set(['mailto:', 'tel:', 'facetime:', 'sms:']);

/**
 * @param {string} url - the raw navigation target
 * @param {{ trusted?: boolean }} [opts] - trusted means an explicit user
 *   instruction (typed address-bar input). Page-initiated navigations,
 *   window.open children, and context-menu targets are untrusted URL data.
 * @returns {{ action: 'none' } | { action: 'open' | 'confirm', protocol: string }}
 *   'none'    — not a handoff URL; proceed with normal navigation handling.
 *   'open'    — launch via the OS immediately.
 *   'confirm' — MUST ask the user before launching another application.
 */
function classifyExternalNavigation(url, { trusted = false } = {}) {
  let protocol;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return { action: 'none' };
  }
  if (!HANDOFF_PROTOCOLS.has(protocol)) return { action: 'none' };
  return { action: trusted ? 'open' : 'confirm', protocol };
}

module.exports = { HANDOFF_PROTOCOLS, classifyExternalNavigation };
