/**
 * schema.org JobPosting from JSON-LD blocks in a careers page, or from
 * microdata (itemprop="...") when there is no JSON-LD, as SAP
 * SuccessFactors career sites publish it.
 * Regex-based on purpose: service workers have no DOMParser.
 */
import { decodeEntities, htmlToText } from './text.js';

const SCRIPT_RE = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
const MAX_BLOCKS = 20;

const isType = (node, type) => {
  const t = node?.['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
};

function* walk(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n, depth + 1);
    return;
  }
  yield node;
  if (node['@graph']) yield* walk(node['@graph'], depth + 1);
  if (node.mainEntity) yield* walk(node.mainEntity, depth + 1);
}

const text = (v) => (typeof v === 'string' ? decodeEntities(v).trim() : '');

function locationText(posting) {
  const places = Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation];
  const out = [];
  for (const place of places) {
    const a = place?.address;
    if (typeof a === 'string') out.push(text(a));
    else if (a && typeof a === 'object') {
      const country = typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry;
      out.push([a.addressLocality, a.addressRegion, country].map(text).filter(Boolean).join(', '));
    }
  }
  const types = [].concat(posting.jobLocationType || []);
  if (types.some((t) => /telecommute/i.test(String(t)))) out.push('Remote');
  return [...new Set(out.filter(Boolean))].join('; ');
}

const isoOrNull = (v) => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * @param {string} html
 * @returns {Array<{ title: string, datePosted: string | null, validThrough: string | null,
 *   orgName: string, location: string, url: string | null, text: string, salary: string | null }>}
 */
export function extractJobPostings(html) {
  const out = [];
  let m;
  let blocks = 0;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(String(html || ''))) && blocks++ < MAX_BLOCKS) {
    let data;
    try {
      data = JSON.parse(m[1].replace(/^\s*<!--|-->\s*$/g, '').replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, ''));
    } catch {
      continue; // malformed JSON-LD is common; skip the block
    }
    for (const node of walk(data)) {
      if (!isType(node, 'JobPosting') || !text(node.title)) continue;
      const org = node.hiringOrganization;
      const pay = node.baseSalary?.value;
      const salary =
        pay && (pay.minValue || pay.value)
          ? [node.baseSalary.currency, pay.minValue ?? pay.value, pay.maxValue ? `– ${pay.maxValue}` : '', pay.unitText]
              .filter(Boolean)
              .join(' ')
          : null;
      out.push({
        title: text(node.title),
        datePosted: isoOrNull(node.datePosted),
        validThrough: isoOrNull(node.validThrough),
        orgName: typeof org === 'string' ? text(org) : text(org?.name),
        location: locationText(node),
        url: typeof node.url === 'string' ? node.url : null,
        text: htmlToText(node.description, 4000),
        salary,
      });
    }
  }
  return out.length ? out : extractMicrodata(String(html || ''));
}

/** The first itemprop value: its content attribute, else its text. */
function itemprop(html, name) {
  const re = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bitemprop=["']${name}["'][^>]*>`, 'i');
  const m = html.match(re);
  if (!m) return '';
  const content = m[0].match(/\bcontent=["']([^"']*)["']/i);
  if (content) return text(content[1]);
  const after = html.slice(m.index + m[0].length, m.index + m[0].length + 2000);
  return text(htmlToText(after.split(new RegExp(`</${m[1]}>`, 'i'))[0], 300));
}

/** One JobPosting described with microdata (a job page lists one job). */
function extractMicrodata(html) {
  if (!/itemtype=["']https?:\/\/schema\.org\/JobPosting["']/i.test(html)) return [];
  const title = itemprop(html, 'title');
  if (!title) return [];
  return [
    {
      title,
      datePosted: isoOrNull(itemprop(html, 'datePosted')),
      validThrough: isoOrNull(itemprop(html, 'validThrough')),
      orgName: itemprop(html, 'hiringOrganization'),
      location: ['addressLocality', 'addressRegion', 'addressCountry'].map((k) => itemprop(html, k)).filter(Boolean).join(', '),
      url: null,
      text: '',
      salary: null,
    },
  ];
}
