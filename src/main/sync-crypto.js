const crypto = require('crypto');

// All key material derives from a user handle + passphrase; the server only
// ever sees ciphertext. Node built-ins only — no dependency (CLAUDE.md:
// "small enough for one person to audit"). See the design spec §6.

// scrypt is deliberately slow. Derivation happens once at setup, so a high
// cost is free; maxmem must be raised for N=2^15 or Node throws.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function deriveKeys(handle, passphrase) {
  // handle is a per-user salt: it namespaces the account and makes offline
  // guessing target one account rather than the whole keyspace.
  const salt = Buffer.from(`blanc-sync:v1:${String(handle).trim().toLowerCase()}`);
  const root = crypto.scryptSync(String(passphrase), salt, 64, SCRYPT);
  const accountId = crypto.hkdfSync('sha256', root, salt, 'blanc-sync-id/v1', 32);
  const encKey = crypto.hkdfSync('sha256', root, salt, 'blanc-sync-enc/v1', 32);
  return { accountId: Buffer.from(accountId).toString('hex'), key: Buffer.from(encKey) };
}

function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(key, blob) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  // .final() throws if the tag doesn't verify — wrong passphrase or tamper.
  return Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { deriveKeys, encrypt, decrypt };
