// Best-effort autocomplete for the Island address input. Provider requests
// stay in the main process: the overlay is sandboxed and its CSP deliberately
// has no external connect-src. All providers return the OpenSearch suggestion
// shape [echoedQuery, string[]].

const MAX_QUERY_LENGTH = 200;
const MAX_SUGGESTION_LENGTH = 200;
const MAX_SUGGESTIONS = 8;
const MAX_RESPONSE_BYTES = 64 * 1024;

const PROVIDERS = {
  duckduckgo(query) {
    const url = new URL('https://duckduckgo.com/ac/');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'list');
    return url.toString();
  },
  google(query) {
    const url = new URL('https://www.google.com/complete/search');
    url.searchParams.set('output', 'chrome');
    // Google otherwise sometimes returns legacy-encoded bytes for non-ASCII
    // prefixes even though the payload shape is JSON.
    url.searchParams.set('ie', 'utf-8');
    url.searchParams.set('oe', 'utf-8');
    url.searchParams.set('q', query);
    return url.toString();
  },
  bing(query, locale) {
    const url = new URL('https://api.bing.com/osjson.aspx');
    url.searchParams.set('query', query);
    if (locale) url.searchParams.set('language', locale);
    return url.toString();
  },
  brave(query) {
    const url = new URL('https://search.brave.com/api/suggest');
    url.searchParams.set('q', query);
    return url.toString();
  },
};

function normalizeQuery(input) {
  if (typeof input !== 'string') return null;
  const query = input.trim();
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) return null;
  return query;
}

/** Suggestions send a typed prefix to the selected provider. Keep obviously
 * navigational and narrowly sensitive-looking values local; Enter still works
 * normally for every rejected value. The renderer applies its matching address
 * guard too, but this main-process check is the trusted boundary. */
function isSuggestionEligible(input) {
  const query = normalizeQuery(input);
  if (!query || query.startsWith('/') || /[\r\n]/.test(query)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(query)) return false;
  // A leading backslash is a Windows root-relative path, UNC share, or device
  // path (for example \Windows, \\server\share, \\?\C:\, or \\.\pipe).
  // None should leave the device as a provider query.
  if (/^\\/.test(query)) return false;
  if (/^(?:\.{1,2}[\\/]|~[\\/]|[a-z]:[\\/])/i.test(query)) return false;
  if (/\.(?:x?html?)(?:[?#].*)?$/i.test(query)) return false;
  if (/^localhost(?::\d+)?(?:[/?#]|$)/i.test(query)) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/.test(query)) return false;
  if (/^\[[0-9a-z:.%_-]+\](?::\d+)?(?:[/?#]|$)/i.test(query)) return false;
  if (/^[0-9a-f]*:[0-9a-f:]+(?:[/?#]|$)/i.test(query)) return false;
  // Conservative Unicode/punycode-aware host shape. It intentionally rejects
  // some dotted search phrases: keeping a possible intranet/IDN target local
  // matters more than offering autocomplete for that narrow ambiguity.
  if (/^(?!\.)[^\s./?#:]+(?:\.[^\s./?#:]+)+(?::\d+)?(?:[/?#][^\s]*)?$/u.test(query)) return false;
  if (/(?:\d[\s-]?){13,19}/.test(query)) return false;
  // Suppress recognized credential prefixes before enough secret characters
  // have been typed to satisfy a full-token validator. Debouncing is not a
  // privacy boundary: a user can pause after any character.
  if (/\b(?:password|passwd|token|secret|api[_ -]?key)\s*[:=]/i.test(query)) return false;
  if (/\bsk-/i.test(query)) return false;
  if (/\bgh[pousr]_/i.test(query)) return false;
  if (/\bAKIA/.test(query)) return false;
  return true;
}

function requestUrlFor(engine, query, locale = '') {
  const build = PROVIDERS[engine];
  if (!build) return null;
  const normalized = normalizeQuery(query);
  if (!normalized) return null;
  return build(normalized, typeof locale === 'string' ? locale : '');
}

function parseOpenSearchSuggestions(payload, limit = MAX_SUGGESTIONS) {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return [];
  const suggestions = [];
  const seen = new Set();
  for (const value of payload[1]) {
    if (typeof value !== 'string') continue;
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text || text.length > MAX_SUGGESTION_LENGTH) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(text);
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

function responseIsOversize(response) {
  const raw = response?.headers?.get?.('content-length');
  if (!raw) return false;
  const bytes = Number(raw);
  return Number.isFinite(bytes) && bytes > MAX_RESPONSE_BYTES;
}

async function readBoundedResponseText(response) {
  const reader = response?.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return Buffer.byteLength(text, 'utf8') <= MAX_RESPONSE_BYTES ? text : null;
  }

  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
}

function createSearchSuggestionService({
  timeoutMs = 2500,
  cacheTtlMs = 30_000,
  maxCacheEntries = 64,
  now = Date.now,
} = {}) {
  const cache = new Map();

  function cached(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now()) {
      cache.delete(key);
      return null;
    }
    // Refresh insertion order so frequently reused entries survive pruning.
    cache.delete(key);
    cache.set(key, hit);
    return [...hit.suggestions];
  }

  function remember(key, suggestions) {
    cache.set(key, { suggestions: [...suggestions], expiresAt: now() + cacheTtlMs });
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
  }

  return {
    async get({ engine, query, locale = '', fetchImpl, signal } = {}) {
      if (!isSuggestionEligible(query) || typeof fetchImpl !== 'function') return [];
      const url = requestUrlFor(engine, query, locale);
      if (!url) return [];

      const cacheKey = `${engine}\n${locale}\n${query.trim().toLowerCase()}`;
      const hit = cached(cacheKey);
      if (hit) return hit;

      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
      const requestSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;

      try {
        const headers = { Accept: 'application/json, application/x-suggestions+json;q=0.9, */*;q=0.1' };
        if (locale) headers['Accept-Language'] = locale;
        const response = await fetchImpl(url, {
          method: 'GET',
          headers,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal: requestSignal,
        });
        if (!response?.ok || responseIsOversize(response)) return [];
        const text = await readBoundedResponseText(response);
        if (text == null) return [];
        const suggestions = parseOpenSearchSuggestions(JSON.parse(text));
        remember(cacheKey, suggestions);
        return suggestions;
      } catch {
        // Autocomplete must never block or surface an error in the address bar.
        return [];
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

module.exports = {
  PROVIDERS,
  MAX_QUERY_LENGTH,
  MAX_SUGGESTIONS,
  isSuggestionEligible,
  requestUrlFor,
  parseOpenSearchSuggestions,
  createSearchSuggestionService,
};
