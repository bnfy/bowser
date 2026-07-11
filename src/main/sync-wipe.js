// Pure decision behind sync.js's disable({ wipeRemote: true }) — extracted so
// the erase-server-copy policy is unit-testable without Electron. The rule it
// pins (2026-07-11 audit): the accountId is the ONLY handle on the server
// copy, so local credentials may be cleared iff the remote DELETE succeeded.
// Clearing after a failed DELETE would strand unreachable ciphertext while
// telling the user it's gone.
/**
 * @param {{ error: true } | { status: number }} outcome - the DELETE attempt:
 *   { error: true } for a network failure, { status } for an HTTP response.
 * @returns {{ clearCredentials: boolean, ok: boolean, message: string | null }}
 */
function wipeDecision(outcome) {
  if (outcome.error) {
    return {
      clearCredentials: false,
      ok: false,
      message: 'Couldn’t reach sync to erase the server copy — check your connection and try again.',
    };
  }
  const s = outcome.status;
  if (s >= 200 && s < 300) return { clearCredentials: true, ok: true, message: null };
  if (s === 429) {
    return { clearCredentials: false, ok: false, message: 'Too many sync attempts — try again in a minute.' };
  }
  return {
    clearCredentials: false,
    ok: false,
    message: `Sync couldn’t erase the server copy (HTTP ${s}) — try again later.`,
  };
}

module.exports = { wipeDecision };
