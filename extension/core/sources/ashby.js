/**
 * Ashby public job posting API
 * https://developers.ashbyhq.com/docs/public-job-posting-api
 */
import { htmlToText } from '../text.js';
import { MAX_POSTING_TEXT, toIsoDate } from './common.js';

export const ashby = {
  id: 'ashby',

  listUrl: ({ slug }) =>
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,

  boardUrl: ({ slug }) => `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`,

  /** @returns {import('./index.js').Posting[]} */
  parse(json) {
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return jobs
      .filter((j) => j && j.id && j.title && j.isListed !== false)
      .map((j) => {
        const secondary = Array.isArray(j.secondaryLocations) ? j.secondaryLocations.map((l) => l?.location) : [];
        const locations = [j.location, ...secondary, j.isRemote ? 'Remote' : null].filter(Boolean);
        const comp = j.compensation || {};
        return {
          id: String(j.id).toLowerCase(),
          title: String(j.title).trim(),
          location: [...new Set(locations)].join('; '),
          url: typeof j.jobUrl === 'string' ? j.jobUrl : null,
          createdAt: toIsoDate(j.publishedAt),
          updatedAt: null,
          department: j.team || j.department || null,
          salary: comp.scrapeableCompensationSalarySummary || comp.compensationTierSummary || null,
          text: (j.descriptionPlain || htmlToText(j.descriptionHtml)).slice(0, MAX_POSTING_TEXT),
        };
      });
  },
};
