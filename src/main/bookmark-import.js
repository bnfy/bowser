// Pure parser for the Netscape bookmark HTML format that every major browser
// exports. Deliberately a simple regex scan (same pragmatic spirit as
// normalizeAddressInput), not a DOM parse: attribute values containing an
// unescaped '>' are not supported, which real exports never emit.
const { validFavicon } = require('./bookmark-validate');

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&'); // last, so &amp;lt; decodes to &lt; not <
}

/** Read one attribute from a tag's attribute string, case-insensitively.
 * Handles double-quoted, single-quoted, and bare values. */
function attr(attrs, name) {
  const m =
    attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')) ||
    attrs.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i')) ||
    attrs.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, 'i'));
  return m ? m[1] : null;
}

const TOKEN = /<\/dl\s*>|<dl\b[^>]*>|<h3\b[^>]*>([\s\S]*?)<\/h3\s*>|<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;

function parseNetscapeBookmarks(html, { now = Date.now() } = {}) {
  const out = [];
  const stack = [];              // folder path; top = current folder or null
  let pending;                   // folder name awaiting its <DL>, or undefined
  const current = () => (stack.length ? stack[stack.length - 1] : null);

  for (const m of String(html).matchAll(TOKEN)) {
    const tok = m[0].slice(0, 4).toLowerCase();
    if (tok.startsWith('</dl')) {
      stack.pop();
    } else if (tok.startsWith('<dl')) {
      stack.push(pending !== undefined ? pending : null);
      pending = undefined;
    } else if (tok.startsWith('<h3')) {
      pending = decodeEntities(m[1] || '').trim() || null;
    } else {
      const attrs = m[2] || '';
      const rawHref = attr(attrs, 'href');
      if (!rawHref) continue;
      const url = decodeEntities(rawHref);
      if (!/^https?:\/\//i.test(url)) continue; // http(s) only
      const rawIcon = attr(attrs, 'icon');
      const secs = Number(attr(attrs, 'add_date'));
      let addedAt = now;
      if (Number.isFinite(secs) && secs > 0) {
        const ms = secs * 1000;
        if (ms <= now) addedAt = ms; // reject future timestamps
      }
      const title = decodeEntities(m[3] || '').trim();
      out.push({
        url,
        title: title || url,
        favicon: validFavicon(rawIcon),
        addedAt,
        folder: current(),
      });
    }
  }
  return out;
}

module.exports = { parseNetscapeBookmarks };
