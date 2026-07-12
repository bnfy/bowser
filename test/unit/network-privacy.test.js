const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WEBRTC_IP_HANDLING_POLICY,
  webrtcPolicyFor,
  SECURE_DNS_TEMPLATES,
  isValidDohTemplate,
  hostResolverOptionsFor,
  reconcileSecureDnsWrite,
  coerceSecureDnsRead,
} = require('../../src/main/network-privacy');

test('webrtcPolicyFor maps settings to Electron policy strings', () => {
  assert.equal(webrtcPolicyFor('standard'), 'default_public_interface_only');
  assert.equal(webrtcPolicyFor('strict'), 'disable_non_proxied_udp');
  // unknown/garbage falls back to the hardened standard default, never 'default'
  assert.equal(webrtcPolicyFor('nonsense'), 'default_public_interface_only');
  assert.equal(webrtcPolicyFor(undefined), 'default_public_interface_only');
  // every mapping is a real Electron policy value
  const valid = new Set(['default', 'default_public_interface_only', 'default_public_and_private_interfaces', 'disable_non_proxied_udp']);
  for (const v of Object.values(WEBRTC_IP_HANDLING_POLICY)) assert.ok(valid.has(v));
});

test('isValidDohTemplate accepts well-formed templates', () => {
  assert.ok(isValidDohTemplate('https://cloudflare-dns.com/dns-query'));
  assert.ok(isValidDohTemplate('https://dns.quad9.net/dns-query'));
  assert.ok(isValidDohTemplate('https://dns.nextdns.io/abc123'));
  assert.ok(isValidDohTemplate('https://example.com/dns-query{?dns}')); // single terminal token
});

test('isValidDohTemplate rejects malformed templates', () => {
  assert.equal(isValidDohTemplate(''), false);
  assert.equal(isValidDohTemplate('http://insecure.example/dns-query'), false); // not https
  assert.equal(isValidDohTemplate('ftp://x'), false);
  assert.equal(isValidDohTemplate('not a url'), false);
  assert.equal(isValidDohTemplate('https://user:pass@host/dns-query'), false); // credentials
  assert.equal(isValidDohTemplate('https://host/dns-query#frag'), false); // fragment
  assert.equal(isValidDohTemplate('https://host/{?dns}/tail'), false); // token not terminal
  assert.equal(isValidDohTemplate('https://host/{?dns}{?dns}'), false); // repeated token
  assert.equal(isValidDohTemplate('https://host/{foo}'), false); // wrong token
  assert.equal(isValidDohTemplate('https://host/dns-query{'), false); // unmatched opening brace
  assert.equal(isValidDohTemplate('https://host/oops}'), false); // unmatched closing brace
  assert.equal(isValidDohTemplate('https://host/a{b/c'), false); // stray brace mid-path
  assert.equal(isValidDohTemplate('https://host/{?dns}}'), false); // valid token + stray brace
  assert.equal(isValidDohTemplate('https://' + 'a'.repeat(2100)), false); // oversize
  assert.equal(isValidDohTemplate(42), false);
  assert.equal(isValidDohTemplate(null), false);
});

test('hostResolverOptionsFor never sets enableBuiltInResolver (Off must keep the system resolver)', () => {
  for (const v of ['auto', 'off', 'cloudflare', 'quad9', 'mullvad', 'custom']) {
    assert.ok(!('enableBuiltInResolver' in hostResolverOptionsFor(v, 'https://dns.example/dns-query')));
  }
});

test('hostResolverOptionsFor: auto and unknown are opportunistic automatic with no servers', () => {
  assert.deepEqual(hostResolverOptionsFor('auto', ''), { secureDnsMode: 'automatic' });
  assert.deepEqual(hostResolverOptionsFor('mystery', ''), { secureDnsMode: 'automatic' });
});

test('hostResolverOptionsFor: off disables DoH', () => {
  assert.deepEqual(hostResolverOptionsFor('off', ''), { secureDnsMode: 'off' });
});

test('hostResolverOptionsFor: named providers hard-fail on their own template', () => {
  assert.deepEqual(hostResolverOptionsFor('cloudflare', ''), {
    secureDnsMode: 'secure', secureDnsServers: ['https://cloudflare-dns.com/dns-query'],
  });
  assert.deepEqual(hostResolverOptionsFor('quad9', ''), {
    secureDnsMode: 'secure', secureDnsServers: ['https://dns.quad9.net/dns-query'],
  });
  assert.deepEqual(hostResolverOptionsFor('mullvad', ''), {
    secureDnsMode: 'secure', secureDnsServers: ['https://dns.mullvad.net/dns-query'],
  });
});

test('hostResolverOptionsFor: custom stays strict (secure) — never degrades to automatic', () => {
  // The settings layer guarantees a valid template accompanies 'custom' (setSettings
  // rejects invalid custom transitions; getSettings coerces corrupted state). So the
  // custom branch is always strict-secure — it must NEVER return automatic.
  assert.deepEqual(hostResolverOptionsFor('custom', 'https://dns.nextdns.io/abc123'), {
    secureDnsMode: 'secure', secureDnsServers: ['https://dns.nextdns.io/abc123'],
  });
  assert.equal(hostResolverOptionsFor('custom', 'https://dns.nextdns.io/abc123').secureDnsMode, 'secure');
});

const VALID = 'https://dns.nextdns.io/abc123';

test('reconcileSecureDnsWrite: valid atomic custom write is accepted', () => {
  assert.deepEqual(
    reconcileSecureDnsWrite({ secureDns: 'auto', secureDnsTemplate: '' }, { secureDns: 'custom', secureDnsTemplate: VALID }),
    { secureDns: 'custom', secureDnsTemplate: VALID },
  );
});

test('reconcileSecureDnsWrite: selecting custom without a valid template is rejected (keeps previous)', () => {
  // sanitize drops an invalid template, so the partial reaching here is often just {secureDns:'custom'}.
  assert.deepEqual(
    reconcileSecureDnsWrite({ secureDns: 'auto', secureDnsTemplate: '' }, { secureDns: 'custom' }),
    { secureDns: 'auto', secureDnsTemplate: '' },
  );
  assert.deepEqual(
    reconcileSecureDnsWrite({ secureDns: 'off', secureDnsTemplate: '' }, { secureDns: 'custom', secureDnsTemplate: '' }),
    { secureDns: 'off', secureDnsTemplate: '' },
  );
});

test('reconcileSecureDnsWrite: clearing the template while custom is active is rejected (preserves last valid)', () => {
  assert.deepEqual(
    reconcileSecureDnsWrite({ secureDns: 'custom', secureDnsTemplate: VALID }, { secureDnsTemplate: '' }),
    { secureDns: 'custom', secureDnsTemplate: VALID },
  );
});

test('reconcileSecureDnsWrite: resubmitting custom with a dropped invalid template keeps the old valid one', () => {
  // sanitize drops an invalid replacement template, so reconcile sees {secureDns:'custom'}
  // with no template key while custom is already active — it must retain the prior valid
  // template (the renderer detects this "template unchanged" case and shows the error).
  assert.deepEqual(
    reconcileSecureDnsWrite({ secureDns: 'custom', secureDnsTemplate: VALID }, { secureDns: 'custom' }),
    { secureDns: 'custom', secureDnsTemplate: VALID },
  );
});

test('reconcileSecureDnsWrite: replacing with another valid template is accepted', () => {
  const V2 = 'https://dns.quad9.net/dns-query';
  assert.deepEqual(
    reconcileSecureDnsWrite({ secureDns: 'custom', secureDnsTemplate: VALID }, { secureDnsTemplate: V2 }),
    { secureDns: 'custom', secureDnsTemplate: V2 },
  );
});

test('reconcileSecureDnsWrite: switching away from custom keeps the (now-unused) template', () => {
  assert.deepEqual(
    reconcileSecureDnsWrite({ secureDns: 'custom', secureDnsTemplate: VALID }, { secureDns: 'off' }),
    { secureDns: 'off', secureDnsTemplate: VALID },
  );
});

test('reconcileSecureDnsWrite: a non-DNS partial leaves DNS untouched', () => {
  assert.deepEqual(
    reconcileSecureDnsWrite({ secureDns: 'cloudflare', secureDnsTemplate: '' }, { theme: 'dark' }),
    { secureDns: 'cloudflare', secureDnsTemplate: '' },
  );
});

test('coerceSecureDnsRead: corrupted custom reads back as the fallback; valid custom and others pass through', () => {
  assert.equal(coerceSecureDnsRead('custom', 'garbage', 'auto'), 'auto');
  assert.equal(coerceSecureDnsRead('custom', '', 'auto'), 'auto');
  assert.equal(coerceSecureDnsRead('custom', VALID, 'auto'), 'custom');
  assert.equal(coerceSecureDnsRead('off', '', 'auto'), 'off');
  assert.equal(coerceSecureDnsRead('quad9', '', 'auto'), 'quad9');
});
