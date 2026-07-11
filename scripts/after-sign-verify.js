// electron-builder afterSign hook: verifies the certificate that ACTUALLY
// signed Blanc.app is embedded in the app's provisioning profile, that the
// profile shipped in the bundle is byte-identical to the repo's, and that the
// signature carries the WebAuthn keychain-access-groups entitlement. This is
// the ground-truth counterpart to scripts/preflight-mac-signing.mjs (which
// predicts the identity before building): whatever identity electron-builder
// ended up selecting, a mismatch throws here and aborts the build before any
// dmg/zip artifact exists — nothing AMFI would kill can reach a release.
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options });

const sha1Fingerprint = (der) => {
  const info = run('openssl', ['x509', '-inform', 'der', '-noout', '-fingerprint', '-sha1'], { input: der });
  return (info.match(/Fingerprint=([0-9A-F:]+)/i)?.[1] ?? '').replaceAll(':', '').toUpperCase();
};

module.exports = async function afterSignVerify(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const profileRel = pkg.build?.mac?.provisioningProfile;
  if (!profileRel) return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const fail = (message) => {
    throw new Error(`after-sign-verify: ${appPath}: ${message}`);
  };

  // The profile inside the bundle is what end-user Macs will validate — it
  // must be exactly the audited file from the repo.
  const embeddedPath = path.join(appPath, 'Contents', 'embedded.provisionprofile');
  let embedded;
  try {
    embedded = readFileSync(embeddedPath);
  } catch {
    fail('no Contents/embedded.provisionprofile in the signed app.');
  }
  if (!embedded.equals(readFileSync(path.join(root, profileRel)))) {
    fail(`the embedded provisioning profile differs from ${profileRel}.`);
  }

  const plist = run('security', ['cms', '-D', '-i', embeddedPath]);
  const certsKey = plist.indexOf('<key>DeveloperCertificates</key>');
  const certsXml = plist.slice(certsKey, plist.indexOf('</array>', certsKey));
  const profileFingerprints = [...certsXml.matchAll(/<data>([\s\S]*?)<\/data>/g)]
    .map((match) => sha1Fingerprint(Buffer.from(match[1].replace(/\s+/g, ''), 'base64')));

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'blanc-sign-verify-'));
  try {
    // codesign writes the chain as <prefix>0 (leaf), <prefix>1, ... — the
    // leaf is the certificate the app was signed with.
    run('codesign', ['--display', `--extract-certificates=${path.join(tmp, 'cert')}`, appPath]);
    const signer = sha1Fingerprint(readFileSync(path.join(tmp, 'cert0')));
    if (!profileFingerprints.includes(signer)) {
      fail([
        `signed by ${signer.slice(0, 8)}…, which the embedded profile does not authorize`,
        `(profile embeds: ${profileFingerprints.map((f) => `${f.slice(0, 8)}…`).join(', ')}).`,
        'AMFI would kill this build at spawn on every Mac. Regenerate the profile',
        'against the signing certificate.',
      ].join(' '));
    }

    const { WEBAUTHN_KEYCHAIN_ACCESS_GROUP } = require(path.join(root, 'src/main/webauthn.js'));
    const entitlements = run('codesign', ['--display', '--entitlements', '-', '--xml', appPath]);
    const grantsGroup = entitlements.includes('<key>keychain-access-groups</key>') &&
      entitlements.includes(`<string>${WEBAUTHN_KEYCHAIN_ACCESS_GROUP}</string>`);
    if (!grantsGroup) {
      fail(`the signature does not carry the ${WEBAUTHN_KEYCHAIN_ACCESS_GROUP} keychain-access-groups entitlement.`);
    }

    console.log(`after-sign-verify: ok — signed by ${signer.slice(0, 8)}…, profile embedded and authorizing, entitlement present.`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};
