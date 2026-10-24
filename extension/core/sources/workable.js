/**
 * Workable public jobs widget API (the feed behind Workable's embeddable
 * job list): https://apply.workable.com/api/v1/widget/accounts/{account}
 */
import { htmlToText } from '../text.js';
import { MAX_POSTING_TEXT, toIsoDate } from './common.js';

function locationOf(j) {
  const places = Array.isArray(j.locations) && j.locations.length ? j.locations : [j];
  const out = places
    .filter((l) => l && !l.hidden)
    .map((l) => [...new Set([l.city, l.region || l.state, l.country].filter(Boolean))].join(', '))
    .filter(Boolean);
  if (j.telecommuting) out.push('Remote');
  return [...new Set(out)].join('; ');
}

export const workable = {
  id: 'workable',

  listUrl: ({ slug }) => `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`,

  boardUrl: ({ slug }) => `https://apply.workable.com/${encodeURIComponent(slug)}/`,

  /** @returns {import('./index.js').Posting[]} */
  parse(json) {
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return jobs
      .filter((j) => j && j.shortcode && j.title)
      .map((j) => ({
        id: String(j.shortcode).toUpperCase(),
        title: String(j.title).trim(),
        location: locationOf(j),
        url: typeof j.url === 'string' ? j.url : typeof j.shortlink === 'string' ? j.shortlink : null,
        createdAt: toIsoDate(j.published_on || j.created_at),
        updatedAt: null,
        department: j.department || null,
        salary: null,
        text: htmlToText(j.description, MAX_POSTING_TEXT),
      }));
  },
};
