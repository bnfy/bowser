// Pure trust predicate behind main.js's chromeHandle/chromeOn IPC wrappers —
// extracted so the sender-authorization policy is unit-testable without
// Electron. A privileged chrome channel may only be driven by a top-level
// frame that IS one of the trusted chrome documents, verified three ways:
// the sending webContents must be the chrome window or overlay itself (never
// a tab), the message must come from its main frame (never an iframe), and
// both the frame and the webContents must still be on the exact packaged
// document URL (a navigated-away chrome surface loses its authority even
// though the webContents object is the same).
/**
 * @param {{ sender: { mainFrame: unknown, getURL(): string }, senderFrame: { url: string } | null }} event
 * @param {Array<{ webContents: { getURL(): string, mainFrame: unknown }, url: string } | null>} trustedTargets
 * @returns {boolean}
 */
function isTrustedSender(event, trustedTargets) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  for (const target of trustedTargets) {
    if (!target || !target.webContents) continue;
    if (event.sender !== target.webContents) continue;
    return frame.url === target.url && event.sender.getURL() === target.url;
  }
  return false;
}

module.exports = { isTrustedSender };
