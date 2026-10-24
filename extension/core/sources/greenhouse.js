/**
 * Greenhouse Job Board API
 * https://developers.greenhouse.io/job-board.html
 */
import { htmlToText } from '../text.js';
import { MAX_POSTING_TEXT, toIsoDate } from './common.js';

const apiBase = (region) => (region === 'eu' ? 'https://boards-api.eu.greenhouse.io' : 'https://boards-api.greenhouse.io');

export const greenhouse = {
  id: 'greenhouse',

  /** @param {{ content?: boolean }} [opts]  content=false skips descriptions (much smaller) */
  listUrl: ({ slug, region }, { content = true } = {}) =>
    `${apiBase(region)}/v1/boards/${encodeURIComponent(slug)}/jobs${content ? '?content=true' : ''}`,

  /** Board metadata ({ name, content }); used to verify a guessed slug. */
  infoUrl: ({ slug, region }) => `${apiBase(region)}/v1/boards/${encodeURIComponent(slug)}`,

  boardUrl: ({ slug, region }) =>
    `https://job-boards${region === 'eu' ? '.eu' : ''}.greenhouse.io/${encodeURIComponent(slug)}`,

  /** @returns {import('./index.js').Posting[]} */
  parse(json) {
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return jobs
      .filter((j) => j && j.id !== undefined && j.title)
      .map((j) => {
        const offices = Array.isArray(j.offices) ? j.offices.map((o) => o?.location || o?.name).filter(Boolean) : [];
        const location = [j.location?.name, ...offices].filter(Boolean);
        return {
          id: String(j.id),
          title: String(j.title).trim(),
          location: [...new Set(location)].join('; '),
          url: typeof j.absolute_url === 'string' ? j.absolute_url : null,
          // first_published is the real publish date; updated_at changes on any edit.
          createdAt: toIsoDate(j.first_published),
          updatedAt: toIsoDate(j.updated_at),
          department: j.departments?.[0]?.name ?? null,
          salary: null,
          text: htmlToText(j.content, MAX_POSTING_TEXT),
        };
      });
  },
};
