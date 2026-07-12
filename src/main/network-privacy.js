// Pure, Electron-free decision logic for the network-privacy settings
// (WebRTC IP-handling policy + encrypted DNS). Kept dependency-free so it
// unit-tests in isolation, exactly like permission-decisions.js. main.js and
// settings.js import from here; nothing here imports electron.

// WebRTC: map the user-facing setting to a Chromium IP-handling policy.
// 'standard' hides non-default-route/multi-homed addresses (Blanc's hardened
// default). 'strict' additionally disables direct UDP that would bypass an
// application-level proxy — this is NOT relay-only enforcement (Electron only
// offers disable_non_proxied_udp), so no caller may describe it as such.
const WEBRTC_IP_HANDLING_POLICY = {
  standard: 'default_public_interface_only',
  strict: 'disable_non_proxied_udp',
};

function webrtcPolicyFor(value) {
  return WEBRTC_IP_HANDLING_POLICY[value] || WEBRTC_IP_HANDLING_POLICY.standard;
}

// DoH provider templates. Cloudflare/Mullvad are unfiltered; dns.quad9.net is
// Quad9's malware-blocking + DNSSEC-validating endpoint (that filtering is its
// signature service — the Settings label says so). Ad/tracker filtering stays
// the job of Blanc's own blocker.
const SECURE_DNS_TEMPLATES = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
  mullvad: 'https://dns.mullvad.net/dns-query',
};

// Validate a custom DoH template against the raw string. We deliberately do NOT
// round-trip through new URL() for the whole value, because that percent-encodes
// the RFC8484 {?dns} braces. Grammar: https scheme, no credentials (userinfo),
// no fragment, <= 2048 chars, and either no template variable or a single
// terminal {?dns}.
function isValidDohTemplate(str) {
  if (typeof str !== 'string') return false;
  if (str.length === 0 || str.length > 2048) return false;
  if (!str.startsWith('https://')) return false;
  if (str.includes('#')) return false; // no fragment

  const authority = str.slice('https://'.length).split(/[/?]/)[0];
  if (authority.length === 0 || authority.includes('@')) return false; // no userinfo

  const tokens = str.match(/\{[^}]*\}/g) || [];
  if (tokens.length > 1) return false;
  if (tokens.length === 1 && (tokens[0] !== '{?dns}' || !str.endsWith('{?dns}'))) return false;

  // Remove the one permitted terminal {?dns}, then reject any remaining raw brace.
  // The token regex only matches balanced {...}, so a stray '{' or '}' (e.g.
  // '.../dns-query{' or '.../oops}') yields zero tokens and would otherwise slip
  // through new URL(), which silently percent-encodes lone braces.
  const base = str.replace('{?dns}', '');
  if (base.includes('{') || base.includes('}')) return false;

  try {
    const u = new URL(base);
    if (u.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return true;
}

// Build the options object for app.configureHostResolver() (process-wide, Electron
// 43). We deliberately do NOT set enableBuiltInResolver — it defaults on for macOS,
// off for Windows/Linux, and forcing it would push Off/system-resolver users off
// their configured DNS. Named providers use secureDnsMode 'secure' (hard-fail, no
// plaintext fallback); auto is 'automatic' (opportunistic, may fall back to plaintext
// by design); off disables DoH.
//
// 'custom' is ALWAYS strict-secure and never degrades to automatic: the settings
// layer (setSettings reject + getSettings coerce) guarantees a valid template
// accompanies 'custom', so a valid strict choice is never silently downgraded.
function hostResolverOptionsFor(secureDns, secureDnsTemplate) {
  switch (secureDns) {
    case 'off':
      return { secureDnsMode: 'off' };
    case 'cloudflare':
    case 'quad9':
    case 'mullvad':
      return { secureDnsMode: 'secure', secureDnsServers: [SECURE_DNS_TEMPLATES[secureDns]] };
    case 'custom':
      return { secureDnsMode: 'secure', secureDnsServers: [secureDnsTemplate] };
    case 'auto':
    default:
      return { secureDnsMode: 'automatic' };
  }
}

// Cross-field write rule for the DNS settings. Given the currently-persisted
// { secureDns, secureDnsTemplate } and an already-sanitized incoming partial,
// return the pair to persist. Strict-custom invariant (F25): a change that would
// leave secureDns='custom' without a valid template is REJECTED wholesale — both
// fields revert to their previous values — rather than silently degrading to
// plaintext-capable Automatic. Only reconciles when the incoming partial actually
// touches a DNS field.
function reconcileSecureDnsWrite(prev, incoming) {
  const touchesDns = 'secureDns' in incoming || 'secureDnsTemplate' in incoming;
  if (!touchesDns) return { secureDns: prev.secureDns, secureDnsTemplate: prev.secureDnsTemplate };
  const next = {
    secureDns: 'secureDns' in incoming ? incoming.secureDns : prev.secureDns,
    secureDnsTemplate: 'secureDnsTemplate' in incoming ? incoming.secureDnsTemplate : prev.secureDnsTemplate,
  };
  if (next.secureDns === 'custom' && !isValidDohTemplate(next.secureDnsTemplate)) {
    return { secureDns: prev.secureDns, secureDnsTemplate: prev.secureDnsTemplate };
  }
  return next;
}

// Read-side coercion for a corrupted persisted state (e.g. a hand-edited
// settings.json): 'custom' without a valid template reads back as `fallback`
// (the default), never as plaintext-capable custom. The write rule above keeps a
// live user action from ever producing this state.
function coerceSecureDnsRead(secureDns, secureDnsTemplate, fallback) {
  if (secureDns === 'custom' && !isValidDohTemplate(secureDnsTemplate)) return fallback;
  return secureDns;
}

module.exports = {
  WEBRTC_IP_HANDLING_POLICY,
  webrtcPolicyFor,
  SECURE_DNS_TEMPLATES,
  isValidDohTemplate,
  hostResolverOptionsFor,
  reconcileSecureDnsWrite,
  coerceSecureDnsRead,
};
