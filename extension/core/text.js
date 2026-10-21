/**
 * HTML-to-text helpers that work without a DOM (service worker, Node).
 */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•' };

/** Decode HTML entities (named subset + numeric). */
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

/**
 * Convert an HTML fragment (possibly entity-encoded, as Greenhouse returns it)
 * to plain text.
 * @param {string} html
 * @param {number} [maxChars]
 */
export function htmlToText(html, maxChars = 20000) {
  let s = String(html || '');
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s); // entity-encoded markup
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return s.slice(0, maxChars);
}
