#!/usr/bin/env node
// Fails a macOS build early when build/embedded.provisionprofile can't
// authorize the identity electron-builder will sign with. The restricted
// keychain-access-groups entitlement (Touch ID passkeys) is only honored when
// the embedded profile lists the exact signing certificate; a mismatch
// otherwise surfaces only after a full build — as AMFI SIGKILLing the
// packaged app at spawn. The contract enforced here: every certificate
// electron-builder *could* select (the pinned build.mac.identity, a CSC_LINK
// p12, or — unpinned — every usable Developer ID Application identity) must
// be embedded in the profile, and the profile must be an unexpired,
// all-devices macOS Developer ID profile. scripts/after-sign-verify.js then
// re-checks the certificate that actually signed the app. Runs as npm
// `predist`/`predist:dir` and from scripts/release.sh; no-ops off macOS and
// when no profile is configured.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

if (process.platform !== 'darwin') process.exit(0);

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const profileRel = pkg.build?.mac?.provisioningProfile;
if (!profileRel) process.exit(0);

function fail(message) {
  console.error(`preflight-mac-signing: ${message}`);
  process.exit(1);
}

const profilePath = path.join(root, profileRel);
if (!existsSync(profilePath)) fail(`configured provisioning profile is missing: ${profileRel}`);

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options });

let plist;
try {
  plist = run('security', ['cms', '-D', '-i', profilePath]);
} catch (error) {
  fail(`could not decode ${profileRel}: ${error.message}`);
}

// ---- profile shape: all-devices, macOS platform, not expired ---------------

if (!/<key>ProvisionsAllDevices<\/key>\s*<true\s*\/>/.test(plist) ||
    plist.includes('<key>ProvisionedDevices</key>')) {
  fail([
    `${profileRel} is not an all-devices Developer ID profile.`,
    'A device-listed (development-type) profile would make the release launch',
    'only on registered Macs — every other install, including auto-updating',
    'ones, would be killed at spawn. Regenerate it on the portal as a',
    'Developer ID *distribution* profile.',
  ].join('\n'));
}

const platformKey = plist.indexOf('<key>Platform</key>');
if (platformKey === -1 ||
    !plist.slice(platformKey, plist.indexOf('</array>', platformKey)).includes('<string>OSX</string>')) {
  fail(`${profileRel} is not a macOS profile (Platform must include OSX).`);
}

const expiry = plist.match(/<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/);
if (!expiry) fail(`${profileRel} has no ExpirationDate.`);
const expiresAt = new Date(expiry[1]);
if (!(expiresAt.getTime() > Date.now())) {
  fail(`${profileRel} expired ${expiry[1]} — regenerate it on the developer portal.`);
}
if (expiresAt.getTime() - Date.now() < 90 * 24 * 60 * 60 * 1000) {
  console.warn(`preflight-mac-signing: warning — ${profileRel} expires soon (${expiry[1]}).`);
}

// ---- certificates the profile authorizes -----------------------------------

const certsKey = plist.indexOf('<key>DeveloperCertificates</key>');
if (certsKey === -1) fail(`${profileRel} embeds no DeveloperCertificates`);
const certsXml = plist.slice(certsKey, plist.indexOf('</array>', certsKey));
const profileCerts = [...certsXml.matchAll(/<data>([\s\S]*?)<\/data>/g)].map((match) => {
  const der = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  const info = run('openssl', ['x509', '-inform', 'der', '-noout', '-fingerprint', '-sha1', '-subject'], { input: der });
  return {
    fingerprint: (info.match(/Fingerprint=([0-9A-F:]+)/i)?.[1] ?? '').replaceAll(':', '').toUpperCase(),
    subject: info.match(/CN\s*=\s*([^,\n]+)/)?.[1] ?? '(unknown subject)',
  };
});
if (!profileCerts.length) fail(`${profileRel} embeds no DeveloperCertificates`);

// ---- every certificate electron-builder could pick -------------------------

// electron-builder resolves the identity from build.mac.identity (or
// CSC_NAME) by substring match against `security find-identity` lines, so the
// candidate set below mirrors its selection semantics; without a qualifier it
// auto-picks among the Developer ID Application identities. Requiring *every*
// candidate to be embedded in the profile makes the selection order moot.
const qualifier = typeof pkg.build.mac.identity === 'string'
  ? pkg.build.mac.identity
  : (process.env.CSC_NAME ?? null);

function cscLinkCertificates(link, password) {
  if (/^https?:\/\//.test(link)) {
    fail('CSC_LINK is a URL — the preflight can only validate a local file or base64 p12. Download it and point CSC_LINK at the file.');
  }
  const p12 = existsSync(link)
    ? readFileSync(link)
    : Buffer.from(link.replace(/^data:[^,]*;base64,/, ''), 'base64');
  const env = { ...process.env, PREFLIGHT_CSC_PW: password ?? '' };
  // -clcerts isolates the client (signing) certificate: a p12 that also
  // bundles its CA chain must not have the chain treated as possible signers.
  const args = ['pkcs12', '-clcerts', '-nokeys', '-passin', 'env:PREFLIGHT_CSC_PW'];
  let pem;
  try {
    pem = run('openssl', args, { input: p12, env });
  } catch {
    try {
      pem = run('openssl', [...args, '-legacy'], { input: p12, env });
    } catch (error) {
      fail(`could not read the CSC_LINK p12 (wrong CSC_KEY_PASSWORD?): ${error.message}`);
    }
  }
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  if (!blocks.length) fail('the CSC_LINK p12 contains no client certificate.');
  return blocks.map((block) => {
    const info = run('openssl', ['x509', '-noout', '-fingerprint', '-sha1', '-subject'], { input: block });
    return {
      fingerprint: (info.match(/Fingerprint=([0-9A-F:]+)/i)?.[1] ?? '').replaceAll(':', '').toUpperCase(),
      label: info.match(/CN\s*=\s*([^,\n]+)/)?.[1] ?? 'CSC_LINK certificate',
    };
  });
}

let candidates;
if (process.env.CSC_LINK) {
  // electron-builder imports the p12 into a temporary keychain and resolves
  // the identity there with the same qualifier — mirror that: the p12's
  // client cert must match the pin, or builder and preflight would disagree
  // about what is selectable.
  const p12Certs = cscLinkCertificates(process.env.CSC_LINK, process.env.CSC_KEY_PASSWORD);
  candidates = qualifier
    ? p12Certs.filter((cert) => `${cert.fingerprint} "${cert.label}"`.includes(qualifier))
    : p12Certs;
  if (!candidates.length) {
    fail(`the CSC_LINK client certificate (${p12Certs.map((c) => `${c.fingerprint.slice(0, 8)}… (${c.label})`).join(', ')}) does not match build.mac.identity/CSC_NAME "${qualifier}".`);
  }
} else {
  const identityList = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  const identities = [...identityList.matchAll(/^\s*\d+\) ([0-9A-F]{40}) "(.+)"$/gm)]
    .map(([, fingerprint, label]) => ({ fingerprint, label }));
  candidates = qualifier
    ? identities.filter((identity) => `${identity.fingerprint} "${identity.label}"`.includes(qualifier))
    : identities.filter((identity) => identity.label.startsWith('Developer ID Application:'));
}
candidates = [...new Map(candidates.map((c) => [c.fingerprint, c])).values()];

const describe = (list) =>
  list.map((c) => `${c.fingerprint.slice(0, 8)}… (${c.label ?? c.subject})`).join(', ') || '(none)';

if (!candidates.length) {
  fail(qualifier
    ? `no usable signing identity matches build.mac.identity/CSC_NAME "${qualifier}".`
    : 'no usable "Developer ID Application" signing identity is available.');
}

const unauthorized = candidates.filter(
  (candidate) => !profileCerts.some((cert) => cert.fingerprint === candidate.fingerprint));
if (unauthorized.length) {
  fail([
    `${profileRel} does not authorize every certificate electron-builder could sign with,`,
    'so the packaged app\'s restricted keychain-access-groups entitlement could be',
    'unauthorized and AMFI would kill it at spawn.',
    '',
    `  could sign with:   ${describe(unauthorized)}`,
    `  profile embeds:    ${describe(profileCerts.map((c) => ({ fingerprint: c.fingerprint, label: c.subject })))}`,
    '',
    'Regenerate the profile against the installed certificate, pin build.mac.identity',
    'to an authorized certificate\'s SHA-1 fingerprint, or import the profile\'s',
    'cert + private key into the keychain.',
  ].join('\n'));
}

console.log(`preflight-mac-signing: ok — ${profileRel} authorizes every selectable identity: ${describe(candidates)}.`);
