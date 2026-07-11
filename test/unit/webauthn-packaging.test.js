const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { WEBAUTHN_KEYCHAIN_ACCESS_GROUP } = require('../../src/main/webauthn');

const root = path.join(__dirname, '..', '..');
const pkg = require(path.join(root, 'package.json'));
const APPLE_TEAM_ID = WEBAUTHN_KEYCHAIN_ACCESS_GROUP.split('.')[0];

const readBuildFile = (relative) => fs.readFileSync(path.join(root, relative), 'latin1');

// A profile group of "TEAM.*" authorizes every group under that team prefix.
const groupAuthorizes = (profileGroup, group) =>
  profileGroup === group ||
  (profileGroup.endsWith('.*') && group.startsWith(profileGroup.slice(0, -1)));

// The Entitlements dict embedded in the CMS-wrapped profile is plaintext XML,
// so string scanning works without macOS's `security` tool (CI runs Linux).
function profileEntitlements() {
  const profile = readBuildFile(pkg.build.mac.provisioningProfile);
  const start = profile.indexOf('<key>Entitlements</key>');
  assert.notEqual(start, -1, 'provisioning profile embeds an Entitlements dict');
  return profile.slice(start, profile.indexOf('</dict>', start));
}

function plistKeychainAccessGroups(plist) {
  const keyIdx = plist.indexOf('<key>keychain-access-groups</key>');
  if (keyIdx === -1) return null;
  const array = plist.slice(keyIdx, plist.indexOf('</array>', keyIdx));
  return [...array.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
}

test('main entitlements grant the WebAuthn keychain access group and pair with the profile', () => {
  const plist = readBuildFile(pkg.build.mac.entitlements);
  assert.deepEqual(plistKeychainAccessGroups(plist), [WEBAUTHN_KEYCHAIN_ACCESS_GROUP]);
  assert.match(plist, new RegExp(
    `<key>com\\.apple\\.application-identifier</key>\\s*<string>${WEBAUTHN_KEYCHAIN_ACCESS_GROUP.replaceAll('.', '\\.')}</string>`,
  ));
  assert.match(plist, new RegExp(
    `<key>com\\.apple\\.developer\\.team-identifier</key>\\s*<string>${APPLE_TEAM_ID}</string>`,
  ));
});

test('inherit entitlements carry no restricted entitlements (they would kill the helpers)', () => {
  const plist = readBuildFile(pkg.build.mac.entitlementsInherit);
  assert.equal(plist.includes('keychain-access-groups'), false);
  assert.equal(plist.includes('application-identifier'), false);
  assert.equal(plist.includes('team-identifier'), false);
});

test('a provisioning profile is wired in and authorizes the WebAuthn group', () => {
  assert.equal(pkg.build.mac.provisioningProfile, 'build/embedded.provisionprofile');

  const entitlements = profileEntitlements();
  const groups = plistKeychainAccessGroups(entitlements);
  assert.ok(Array.isArray(groups) && groups.length, 'profile grants keychain-access-groups');
  assert.ok(
    groups.some((g) => groupAuthorizes(g, WEBAUTHN_KEYCHAIN_ACCESS_GROUP)),
    `profile groups [${groups}] must authorize ${WEBAUTHN_KEYCHAIN_ACCESS_GROUP}`,
  );

  const appId = entitlements.match(
    /<key>com\.apple\.application-identifier<\/key>\s*<string>([^<]+)<\/string>/,
  );
  assert.ok(appId, 'profile pins an application-identifier');
  assert.ok(
    groupAuthorizes(appId[1], WEBAUTHN_KEYCHAIN_ACCESS_GROUP),
    `profile application-identifier ${appId[1]} must cover ${WEBAUTHN_KEYCHAIN_ACCESS_GROUP}`,
  );
});
