/**
 * Lever Postings API
 * https://github.com/lever/postings-api
 */
import { htmlToText } from '../text.js';
import { MAX_POSTING_TEXT, toIsoDate } from './common.js';

function formatSalary(r) {
  if (!r || (r.min === undefined && r.max === undefined)) return null;
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '');
  const range = [fmt(r.min), fmt(r.max)].filter(Boolean).join(' – ');
  return [r.currency, range, r.interval].filter(Boolean).join(' ').trim() || null;
}

export const lever = {
  id: 'lever',

  listUrl: ({ slug, region }) =>
    `https://api${region === 'eu' ? '.eu' : ''}.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,

  boardUrl: ({ slug, region }) => `https://jobs${region === 'eu' ? '.eu' : ''}.lever.co/${encodeURIComponent(slug)}`,

  /** @returns {import('./index.js').Posting[]} */
  parse(json) {
    const postings = Array.isArray(json) ? json : [];
    return postings
      .filter((p) => p && p.id && p.text)
      .map((p) => {
        const c = p.categories || {};
        const locations = [c.location, ...(Array.isArray(c.allLocations) ? c.allLocations : [])].filter(Boolean);
        const lists = Array.isArray(p.lists)
          ? p.lists.map((l) => `${l?.text || ''}\n${htmlToText(l?.content, MAX_POSTING_TEXT)}`).join('\n')
          : '';
        const text = [p.descriptionPlain || htmlToText(p.description), lists, p.additionalPlain || ''].join('\n');
        return {
          id: String(p.id).toLowerCase(),
          title: String(p.text).trim(),
          location: [...new Set(locations)].join('; '),
          url: typeof p.hostedUrl === 'string' ? p.hostedUrl : null,
          createdAt: toIsoDate(p.createdAt),
          updatedAt: null,
          department: c.team || c.department || null,
          salary: formatSalary(p.salaryRange),
          text: text.trim().slice(0, MAX_POSTING_TEXT),
        };
      });
  },
};
