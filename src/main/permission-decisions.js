const normalizedMediaTypes = (mediaTypes) => [
  ...new Set((mediaTypes ?? []).filter((type) => type === 'audio' || type === 'video')),
].sort();

const keyFor = (origin, permission, mediaType = null) =>
  permission === 'media' && mediaType
    ? `${origin}|${permission}|${mediaType}`
    : `${origin}|${permission}`;

function storedDecision(decisions, origin, permission, mediaType = null) {
  const exact = decisions[keyFor(origin, permission, mediaType)] ?? null;
  if (exact || permission !== 'media' || !mediaType) return exact;

  // Old Blanc versions stored one broad `origin|media` decision. A legacy
  // deny remains safe to honor for both devices; a legacy allow is ambiguous
  // (it may have been granted for microphone only), so ask again rather than
  // silently expanding it to camera access.
  return decisions[keyFor(origin, permission)] === 'deny' ? 'deny' : null;
}

function rememberDecision(decisions, origin, permission, mediaTypes, allow) {
  const scopes = permission === 'media' ? normalizedMediaTypes(mediaTypes) : [];
  const keys = scopes.length
    ? scopes.map((mediaType) => keyFor(origin, permission, mediaType))
    : [keyFor(origin, permission)];
  for (const key of keys) decisions[key] = allow ? 'allow' : 'deny';
}

module.exports = { normalizedMediaTypes, keyFor, storedDecision, rememberDecision };
