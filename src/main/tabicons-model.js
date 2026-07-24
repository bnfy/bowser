// Pure model for the optional E2EE tab-icon sidecar. Keeping icon bytes out
// of the `session` store preserves that store's deployed schema: older Blanc
// clients rebuild every device entry from known fields and would otherwise
// strip a newly-added favicon field, causing repair-write ping-pong.

const PRUNE_MS = 30 * 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 24 * 60 * 60 * 1000;
const BUDGET_BYTES = 256 * 1024;
const MAX_ICONS = 500;
const MAX_URL = 2048;
const MAX_ICON_DATA = 4096;
const ICON_SIZE = 16;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_SOURCE_DIMENSION = 1024;
const MAX_SOURCE_PIXELS = 512 * 512;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_PREFIX = 'data:image/png;base64,';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function validIconData(data) {
  if (
    typeof data !== 'string' ||
    data.length > MAX_ICON_DATA ||
    !data.toLowerCase().startsWith(PNG_DATA_PREFIX)
  ) return null;
  const encoded = data.slice(PNG_DATA_PREFIX.length);
  // Buffer.from(base64) is deliberately forgiving. Require a canonical
  // encoding here so junk following valid base64 cannot hitch a ride into
  // privileged chrome under an image MIME type.
  if (!encoded || encoded.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.toString('base64') !== encoded ||
    bytes.length < 24 ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR' ||
    bytes.readUInt32BE(16) !== ICON_SIZE ||
    bytes.readUInt32BE(20) !== ICON_SIZE
  ) return null;
  return data;
}

/** Validate the cheap, fixed-size PNG header before handing untrusted source
 * bytes to Chromium's image decoder. Icons are cosmetic, so accepting PNG
 * only is preferable to expanding the native decoder attack surface for ICO,
 * SVG, animated formats, or dimension bombs. */
function validSourcePngBytes(raw) {
  if (!Buffer.isBuffer(raw) && !(raw instanceof Uint8Array)) return null;
  const bytes = Buffer.isBuffer(raw)
    ? raw
    : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (
    bytes.length < 24 ||
    bytes.length > MAX_SOURCE_BYTES ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_SOURCE_DIMENSION ||
    height > MAX_SOURCE_DIMENSION ||
    width * height > MAX_SOURCE_PIXELS
  ) return null;
  return bytes;
}

function sourcePngFromDataUrl(source) {
  if (typeof source !== 'string') return null;
  const comma = source.indexOf(',');
  if (comma < 0 || source.slice(0, comma).toLowerCase() !== 'data:image/png;base64') return null;
  const encoded = source.slice(comma + 1);
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    encoded.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4 ||
    !/^[a-z0-9+/]+={0,2}$/i.test(encoded)
  ) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) return null;
  return validSourcePngBytes(bytes);
}

function isPrivateIpv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(host) {
  const value = host.toLowerCase();
  // Unique-local, link-local, loopback/unspecified, and IPv4-mapped literals
  // are never valid icon origins.
  if (value === '::' || value === '::1' || value.startsWith('::ffff:')) return true;
  const first = Number.parseInt(value.split(':', 1)[0], 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7
    (first & 0xffc0) === 0xfe80 || // fe80::/10
    (first & 0xffc0) === 0xfec0 || // deprecated site-local fec0::/10
    (first & 0xff00) === 0xff00    // multicast ff00::/8
  );
}

/** Network favicon capture is cosmetic and must not become a new LAN probe.
 * URL canonicalization collapses unusual IPv4 spellings before these checks.
 * DNS rebinding is outside this lightweight guard, so the fetch also remains
 * cookie/referrer-free and redirect-disabled as defense in depth. */
function isPublicHttpSource(source) {
  if (typeof source !== 'string' || source.length > MAX_URL) return false;
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  let host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host.includes(':')) return !isPrivateIpv6(host);
  if (/^\d+(?:\.\d+){3}$/.test(host)) return !isPrivateIpv4(host);
  return true;
}

function sanitizeIcon(raw) {
  if (!raw || typeof raw.url !== 'string') return null;
  if (!/^https?:\/\//.test(raw.url) || raw.url.length > MAX_URL) return null;
  const data = validIconData(raw.data);
  return data ? { url: raw.url, data } : null;
}

function sanitizeIcons(rawIcons) {
  const seen = new Set();
  const icons = [];
  for (const raw of Array.isArray(rawIcons) ? rawIcons : []) {
    const icon = sanitizeIcon(raw);
    if (!icon || seen.has(icon.url)) continue;
    seen.add(icon.url);
    icons.push(icon);
    if (icons.length >= MAX_ICONS) break;
  }
  return icons;
}

function sanitizeEntry(raw) {
  if (!raw || !Number.isFinite(raw.updatedAt)) return null;
  if (raw.retracted) return { retracted: true, updatedAt: raw.updatedAt };
  return {
    updatedAt: raw.updatedAt,
    icons: sanitizeIcons(raw.icons),
  };
}

const fingerprint = ({ icons }) => canonical({ icons: sanitizeIcons(icons) });

function winner(local, remote, isOwn) {
  if (remote.updatedAt !== local.updatedAt) return remote.updatedAt > local.updatedAt ? remote : local;
  if (isOwn) return local;
  if (!!remote.retracted !== !!local.retracted) return remote.retracted ? remote : local;
  return canonical(remote) < canonical(local) ? remote : local;
}

function mergeDevices(local, remote, { now, ownId }) {
  const out = {};
  for (const [id, raw] of Object.entries(local ?? {})) {
    const entry = sanitizeEntry(raw);
    if (entry) out[id] = entry;
  }
  for (const [id, raw] of Object.entries(remote ?? {})) {
    const entry = sanitizeEntry(raw);
    if (!entry) continue;
    const current = out[id];
    out[id] = current ? winner(current, entry, id === ownId) : entry;
  }
  for (const [id, entry] of Object.entries(out)) {
    if (now - entry.updatedAt > PRUNE_MS) delete out[id];
  }
  return out;
}

function rebindDevices(stored, accountId) {
  if (stored.accountId === accountId) return stored;
  return { accountId, devices: {} };
}

function buildOwnEntry({ prev, snapshot, now }) {
  const next = { updatedAt: now, icons: sanitizeIcons(snapshot?.icons) };
  if (
    prev && !prev.retracted &&
    fingerprint(prev) === fingerprint(next) &&
    now - prev.updatedAt < HEARTBEAT_MS
  ) {
    return { ...next, updatedAt: prev.updatedAt };
  }
  return next;
}

function retractedEntry(prev, now) {
  if (!prev) return null;
  if (prev.retracted) return prev;
  return { retracted: true, updatedAt: now };
}

function ownEntryFor({ syncTabs, prev, snapshot, now }) {
  return syncTabs && snapshot
    ? buildOwnEntry({ prev, snapshot, now })
    : retractedEntry(prev, now);
}

const heartbeatDue = (entry, now) =>
  !!entry && !entry.retracted && now - entry.updatedAt >= HEARTBEAT_MS;

const devicesEqual = (a, b) => canonical(a ?? {}) === canonical(b ?? {});

/** Icons are cosmetic and live in their own store, so the budget can discard
 * icon records without ever removing a tab from the primary session store.
 * The full local map remains intact; only the upload copy is trimmed. */
function applyBudget(devices, ownId, { maxBytes = BUDGET_BYTES } = {}) {
  const out = structuredClone(devices ?? {});
  const over = () => Buffer.byteLength(canonical(out), 'utf8') > maxBytes;
  if (!over()) return out;

  const trim = (entry) => {
    while (entry?.icons?.length && over()) {
      entry.icons.splice(-Math.max(1, Math.ceil(entry.icons.length / 4)));
    }
  };
  trim(out[ownId]);

  const others = Object.entries(out)
    .filter(([id, entry]) => id !== ownId && !entry?.retracted)
    .sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
  for (const [id, entry] of others) {
    if (!over()) break;
    trim(entry);
    if (!entry.icons.length) delete out[id];
  }
  for (const [id, entry] of Object.entries(out)) {
    if (!over()) break;
    if (id !== ownId && entry?.retracted) delete out[id];
  }
  return out;
}

function exportDevices({ devices, deviceId, syncTabs, snapshot, now, maxBytes }) {
  const next = { ...(devices ?? {}) };
  const own = ownEntryFor({
    syncTabs,
    prev: next[deviceId] ?? null,
    snapshot,
    now,
  });
  if (own) next[deviceId] = own;
  else delete next[deviceId];
  const store = mergeDevices(next, {}, { now, ownId: deviceId });
  const upload = applyBudget(store, deviceId, maxBytes ? { maxBytes } : {});
  return { store, upload };
}

function displayDevices(devices, ownId, { now }) {
  return Object.fromEntries(
    Object.entries(devices ?? {})
      .filter(([id, entry]) =>
        id !== ownId && entry && !entry.retracted &&
        Array.isArray(entry.icons) && entry.icons.length > 0 &&
        now - entry.updatedAt <= PRUNE_MS)
      .map(([id, entry]) => [id, sanitizeIcons(entry.icons)])
  );
}

/** Add safe data URLs to the renderer projection only. The synchronized
 * session object itself remains unchanged and never carries favicon fields. */
function attachIcons(remoteDevices, iconDevices) {
  return (remoteDevices ?? []).map((device) => {
    const icons = Array.isArray(iconDevices?.[device.deviceId])
      ? iconDevices[device.deviceId]
      : [];
    const byUrl = new Map(icons.map((icon) => [icon.url, validIconData(icon.data)]));
    return {
      ...device,
      tabs: (Array.isArray(device.tabs) ? device.tabs : []).map((tab) => ({
        ...tab,
        favicon: validIconData(byUrl.get(tab.url)),
      })),
    };
  });
}

module.exports = {
  PRUNE_MS,
  HEARTBEAT_MS,
  BUDGET_BYTES,
  MAX_ICONS,
  MAX_URL,
  MAX_ICON_DATA,
  ICON_SIZE,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_DIMENSION,
  MAX_SOURCE_PIXELS,
  PNG_DATA_PREFIX,
  isPublicHttpSource,
  canonical,
  validIconData,
  validSourcePngBytes,
  sourcePngFromDataUrl,
  sanitizeIcon,
  sanitizeEntry,
  fingerprint,
  mergeDevices,
  rebindDevices,
  buildOwnEntry,
  retractedEntry,
  ownEntryFor,
  heartbeatDue,
  devicesEqual,
  applyBudget,
  exportDevices,
  displayDevices,
  attachIcons,
};
