const assert = require('node:assert/strict');
const test = require('node:test');

const { isTrustedSender } = require('../../src/main/ipc-trust');

const CHROME_URL = 'file:///app/src/renderer/index.html';
const OVERLAY_URL = 'file:///app/src/renderer/overlay.html';

// Minimal stand-ins for Electron's WebContents/WebFrameMain: identity is what
// the predicate keys on, so plain objects are faithful.
function fakeWebContents(url) {
  const wc = { mainFrame: { url } };
  wc.getURL = () => url;
  return wc;
}

function eventFrom(wc, { frame } = {}) {
  return { sender: wc, senderFrame: frame ?? wc.mainFrame };
}

function targets(chromeWc, overlayWc) {
  return [
    { webContents: chromeWc, url: CHROME_URL },
    { webContents: overlayWc, url: OVERLAY_URL },
  ];
}

test('the chrome window and overlay main frames are trusted', () => {
  const chrome = fakeWebContents(CHROME_URL);
  const overlay = fakeWebContents(OVERLAY_URL);
  assert.equal(isTrustedSender(eventFrom(chrome), targets(chrome, overlay)), true);
  assert.equal(isTrustedSender(eventFrom(overlay), targets(chrome, overlay)), true);
});

test('a tab webContents is rejected even when it spoofs the chrome URL', () => {
  const chrome = fakeWebContents(CHROME_URL);
  const overlay = fakeWebContents(OVERLAY_URL);
  // Identity check: same URL, different webContents — an ordinary tab that
  // somehow navigated to the chrome document must still be untrusted.
  const tab = fakeWebContents(CHROME_URL);
  assert.equal(isTrustedSender(eventFrom(tab), targets(chrome, overlay)), false);
});

test('an iframe inside a trusted document is rejected', () => {
  const chrome = fakeWebContents(CHROME_URL);
  const overlay = fakeWebContents(OVERLAY_URL);
  const iframe = { url: CHROME_URL }; // right URL, but not the main frame
  assert.equal(
    isTrustedSender(eventFrom(chrome, { frame: iframe }), targets(chrome, overlay)),
    false
  );
});

test('a navigated-away chrome surface loses its authority', () => {
  const overlay = fakeWebContents(OVERLAY_URL);
  // Same webContents object, but its document is no longer the packaged one.
  const hijacked = fakeWebContents('https://evil.example/');
  assert.equal(isTrustedSender(eventFrom(hijacked), targets(hijacked, overlay)), false);
});

test('frame URL and webContents URL must both match (mid-navigation window)', () => {
  const overlay = fakeWebContents(OVERLAY_URL);
  const chrome = fakeWebContents(CHROME_URL);
  chrome.getURL = () => 'https://evil.example/'; // frame still reports old URL
  assert.equal(isTrustedSender(eventFrom(chrome), targets(chrome, overlay)), false);
});

test('a missing sender frame or missing surfaces fail closed', () => {
  const chrome = fakeWebContents(CHROME_URL);
  assert.equal(
    isTrustedSender({ sender: chrome, senderFrame: null }, targets(chrome, fakeWebContents(OVERLAY_URL))),
    false
  );
  // Window closed / overlay destroyed → its target slot is null.
  assert.equal(isTrustedSender(eventFrom(chrome), [null, null]), false);
});
