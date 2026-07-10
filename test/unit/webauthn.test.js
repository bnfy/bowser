const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WEBAUTHN_KEYCHAIN_ACCESS_GROUP,
  accountLabel,
  chooseWebAuthnAccount,
  setupWebAuthn,
} = require('../../src/main/webauthn');

const accounts = [
  { credentialId: 'first', name: 'alice@example.com' },
  { credentialId: 'second', displayName: 'Work account' },
];

test('uses Blanc’s stable signing identity for the Secure Enclave access group', () => {
  assert.equal(WEBAUTHN_KEYCHAIN_ACCESS_GROUP, 'XYGUCY4498.me.bnfy.bowser');
});

test('labels discoverable credentials for the native account chooser', () => {
  assert.equal(accountLabel(accounts[0], 0), 'alice@example.com');
  assert.equal(accountLabel(accounts[1], 1), 'Work account');
  assert.equal(accountLabel({}, 2), 'Passkey 3');
});

test('returns the selected discoverable credential and parents its dialog', async () => {
  const parent = { id: 'window' };
  let seenParent;
  let seenOptions;
  const dialog = {
    showMessageBox: async (actualParent, options) => {
      seenParent = actualParent;
      seenOptions = options;
      return { response: 1 };
    },
  };

  const selected = await chooseWebAuthnAccount({
    dialog,
    getParentWindow: () => parent,
    details: { relyingPartyId: 'example.com', accounts },
  });

  assert.equal(selected, 'second');
  assert.equal(seenParent, parent);
  assert.equal(seenOptions.message, 'Choose a passkey for example.com');
  assert.deepEqual(seenOptions.buttons, ['alice@example.com', 'Work account', 'Cancel']);
});

test('cancelling the picker leaves the credential request unresolved by a credential', async () => {
  const dialog = { showMessageBox: async () => ({ response: 2 }) };
  const selected = await chooseWebAuthnAccount({
    dialog,
    getParentWindow: () => null,
    details: { relyingPartyId: 'example.com', accounts },
  });

  assert.equal(selected, undefined);
});

test('enables Touch ID WebAuthn only on macOS and returns the selected credential', async () => {
  const configured = [];
  const listeners = new Map();
  const app = { configureWebAuthn: (options) => configured.push(options) };
  const session = { on: (event, listener) => listeners.set(event, listener) };
  const dialog = { showMessageBox: async () => ({ response: 0 }) };

  assert.equal(setupWebAuthn({ app, session, dialog, platform: 'linux' }), false);
  assert.equal(configured.length, 0);
  assert.equal(listeners.size, 0);

  assert.equal(setupWebAuthn({ app, session, dialog, platform: 'darwin' }), true);
  assert.deepEqual(configured, [{
    touchID: { keychainAccessGroup: WEBAUTHN_KEYCHAIN_ACCESS_GROUP },
  }]);

  const callbackArgs = [];
  listeners.get('select-webauthn-account')({}, { relyingPartyId: 'example.com', accounts }, (...args) => {
    callbackArgs.push(args);
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(callbackArgs, [['first']]);
});

test('installs the WebAuthn account chooser on normal and private sessions', () => {
  const events = [[], []];
  const sessions = events.map((seen) => ({
    on: (event) => seen.push(event),
  }));

  assert.equal(setupWebAuthn({
    app: { configureWebAuthn: () => {} },
    session: sessions,
    dialog: {},
    platform: 'darwin',
  }), true);
  assert.deepEqual(events, [
    ['select-webauthn-account'],
    ['select-webauthn-account'],
  ]);
});

test('cancels safely when Touch ID setup or account selection fails', async () => {
  const failedApp = { configureWebAuthn: () => { throw new Error('missing entitlement'); } };
  const failedSession = { on: () => assert.fail('listener must not be installed') };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(setupWebAuthn({
      app: failedApp,
      session: failedSession,
      dialog: {},
      platform: 'darwin',
    }), false);

    let listener;
    const session = { on: (_event, value) => { listener = value; } };
    assert.equal(setupWebAuthn({
      app: { configureWebAuthn: () => {} },
      session,
      dialog: { showMessageBox: async () => { throw new Error('dialog failed'); } },
      platform: 'darwin',
    }), true);

    const callbackArgs = [];
    listener({}, { relyingPartyId: 'example.com', accounts }, (...args) => callbackArgs.push(args));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(callbackArgs, [[]]);
  } finally {
    console.warn = originalWarn;
  }
});
