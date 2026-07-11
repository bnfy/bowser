const assert = require('node:assert/strict');
const test = require('node:test');

// permissions.js lazy-requires store.js (which needs Electron) only on the
// PERSISTED path — so this file loading at all, and every assertion below
// passing, doubles as a canary: if the private (persistDecisions:false) path
// ever touched the on-disk store, the electron require would blow up here.
const { setupPermissionPolicy, setPermissionPrompter } = require('../../src/main/permissions');

function fakeSession() {
  const session = {};
  session.setPermissionRequestHandler = (fn) => { session.request = fn; };
  session.setPermissionCheckHandler = (fn) => { session.check = fn; };
  session.setDisplayMediaRequestHandler = (fn) => { session.display = fn; };
  return session;
}

const request = (session, permission, details) =>
  new Promise((resolve) => session.request(null, permission, resolve, details));

test('private-session permission grants live only in memory', async (t) => {
  let prompts = 0;
  setPermissionPrompter(async () => { prompts += 1; return true; });
  t.after(() => setPermissionPrompter(null));

  const privateSession = fakeSession();
  setupPermissionPolicy(privateSession, { persistDecisions: false });

  // First ask prompts; the grant is remembered for this session...
  assert.equal(await request(privateSession, 'media', {
    requestingUrl: 'https://example.com/page',
    mediaTypes: ['audio'],
  }), true);
  assert.equal(prompts, 1);
  assert.equal(await request(privateSession, 'media', {
    requestingUrl: 'https://example.com/page',
    mediaTypes: ['audio'],
  }), true);
  assert.equal(prompts, 1, 'the remembered grant answers without a second prompt');
  assert.equal(
    privateSession.check(null, 'media', 'https://example.com', { mediaType: 'audio' }),
    true
  );

  // ...but a fresh private session — the state after Blanc exits and
  // relaunches — starts with nothing. (Closing the last private tab does NOT
  // reset this: the private partition and its in-memory grants live for the
  // whole process lifetime.)
  const nextLaunch = fakeSession();
  setupPermissionPolicy(nextLaunch, { persistDecisions: false });
  assert.equal(
    nextLaunch.check(null, 'media', 'https://example.com', { mediaType: 'audio' }),
    false,
    'a private grant must not survive into a new private session'
  );
  assert.equal(await request(nextLaunch, 'media', {
    requestingUrl: 'https://example.com/page',
    mediaTypes: ['audio'],
  }), true);
  assert.equal(prompts, 2, 'the new session must re-prompt from scratch');
});

test('private media grants stay scoped per device type', async (t) => {
  setPermissionPrompter(async ({ mediaTypes }) => mediaTypes.includes('audio'));
  t.after(() => setPermissionPrompter(null));

  const privateSession = fakeSession();
  setupPermissionPolicy(privateSession, { persistDecisions: false });

  assert.equal(await request(privateSession, 'media', {
    requestingUrl: 'https://example.com/',
    mediaTypes: ['audio'],
  }), true);
  assert.equal(
    privateSession.check(null, 'media', 'https://example.com', { mediaType: 'video' }),
    false,
    'a private microphone grant must not authorize camera'
  );
});

test('private sessions still deny non-prompted permissions and opaque origins', async (t) => {
  setPermissionPrompter(async () => true);
  t.after(() => setPermissionPrompter(null));

  const privateSession = fakeSession();
  setupPermissionPolicy(privateSession, { persistDecisions: false });

  assert.equal(await request(privateSession, 'openExternal', {
    requestingUrl: 'https://example.com/',
  }), false);
  assert.equal(await request(privateSession, 'geolocation', {
    requestingUrl: 'file:///tmp/local.html',
  }), false);
});
