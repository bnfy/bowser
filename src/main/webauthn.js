// Electron 41.5+ can back WebAuthn platform-authenticator requests with the
// Mac's Secure Enclave. Uses the app's own default keychain access group
// (TeamID.BundleID) — every signed app can access this implicitly, no
// keychain-access-groups entitlement or provisioning profile required.
const APPLE_TEAM_ID = 'XYGUCY4498';
const BUNDLE_ID = 'me.bnfy.bowser';
const WEBAUTHN_KEYCHAIN_ACCESS_GROUP = `${APPLE_TEAM_ID}.${BUNDLE_ID}`;

function accountLabel(account, index) {
  const label = account?.displayName || account?.name;
  return typeof label === 'string' && label.trim() ? label.trim() : `Passkey ${index + 1}`;
}

async function chooseWebAuthnAccount({ dialog, getParentWindow, details }) {
  const accounts = Array.isArray(details?.accounts) ? details.accounts : [];
  if (!accounts.length) return undefined;

  const relyingPartyId = typeof details?.relyingPartyId === 'string' && details.relyingPartyId
    ? details.relyingPartyId
    : 'this website';
  const buttons = accounts.map(accountLabel);
  const cancelId = buttons.length;
  buttons.push('Cancel');

  const options = {
    type: 'question',
    title: 'Choose a passkey',
    message: `Choose a passkey for ${relyingPartyId}`,
    detail: 'This website has more than one passkey available in Blanc on this Mac.',
    buttons,
    cancelId,
    noLink: true,
  };
  const parent = getParentWindow?.() || null;
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);

  return response >= 0 && response < accounts.length
    ? accounts[response].credentialId
    : undefined;
}

/**
 * Enables Electron's native macOS Touch ID platform authenticator and supplies
 * the required account chooser for discoverable credentials.
 *
 * This deliberately does not request Apple's browser passkey entitlement: that
 * separate managed capability is required for iCloud/credential-provider
 * passkeys, while this feature stores device-bound passkeys in Blanc's own
 * Secure Enclave access group.
 */
function setupWebAuthn({ app, session, dialog, getParentWindow, platform = process.platform }) {
  if (platform !== 'darwin' || typeof app?.configureWebAuthn !== 'function') return false;

  try {
    app.configureWebAuthn({
      touchID: { keychainAccessGroup: WEBAUTHN_KEYCHAIN_ACCESS_GROUP },
    });
  } catch (error) {
    // An unsigned dev build has no keychain-access-groups entitlement. Keep
    // normal browser startup working there; signed releases surface the API.
    console.warn('Unable to enable Touch ID WebAuthn:', error.message);
    return false;
  }

  session.on('select-webauthn-account', (_event, details, callback) => {
    let resolved = false;
    const finish = (credentialId) => {
      if (resolved) return;
      resolved = true;
      if (typeof credentialId === 'string' && credentialId) callback(credentialId);
      else callback(); // No argument cancels the request with NotAllowedError.
    };

    chooseWebAuthnAccount({ dialog, getParentWindow, details })
      .then(finish)
      .catch((error) => {
        console.warn('Unable to choose a WebAuthn account:', error.message);
        finish();
      });
  });

  return true;
}

module.exports = {
  WEBAUTHN_KEYCHAIN_ACCESS_GROUP,
  accountLabel,
  chooseWebAuthnAccount,
  setupWebAuthn,
};
