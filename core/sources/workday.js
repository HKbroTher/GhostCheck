/**
 * Workday public "CXS" job search API, used by every *.myworkdayjobs.com
 * careers site.
 *
 *   POST {apiBase}/jobs              { appliedFacets, limit, offset, searchText }
 *   GET  {apiBase}{externalPath}     one posting
 *
 * Workday has no "list everything" call: results come 20 at a time, so a
 * board is only checked completely when it is small (see check.js).
 */
import { htmlToText } from '../text.js';
import { MAX_POSTING_TEXT } from './common.js';

export const WORKDAY_PAGE_SIZE = 20;
const DAY_MS = 86400000;

/**
 * Build the URLs for a Workday site.
 * @param {{ tenant: string, host: string, site: string | null }} w
 */
export function workdayRef({ tenant, host, site }) {
  const h = String(host).toLowerCase();
  const enc = encodeURIComponent;
  const isSite = /^wd\d+\.myworkdaysite\.com$/.test(h); // shared host: /recruiting/{tenant}/{site}
  return {
    tenant,
    host: h,
    site: site || null,
    apiBase: site ? `https://${h}/wday/cxs/${enc(tenant)}/${enc(site)}` : null,
    publicBase: site ? (isSite ? `https://${h}/recruiting/${enc(tenant)}/${enc(site)}` : `https://${h}/${enc(site)}`) : null,
  };
}

/** Is this a Workday host we know how to call? */
export function isWorkdayHost(host) {
  return /^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host) || /^wd\d+\.myworkdaysite\.com$/i.test(host);
}

/**
 * "Posted Today" / "Posted Yesterday" / "Posted 5 Days Ago" / "Posted 30+ Days Ago"
 * @returns {{ date: string, exact: boolean } | null}
 */
export function parsePostedOn(text, now = new Date()) {
  const s = String(text || '').toLowerCase();
  let days = null;
  let exact = true;
  if (/\btoday\b/.test(s)) days = 0;
  else if (/\byesterday\b/.test(s)) days = 1;
  else {
    const m = s.match(/(\d+)\s*(\+)?\s*days?\s+ago/);
    if (m) {
      days = Number(m[1]);
      exact = !m[2]; // "30+ days ago" is only a lower bound
    }
  }
  if (days === null) return null;
  return { date: new Date(now.getTime() - days * DAY_MS).toISOString(), exact };
}

/** "2 Locations" says nothing about where. */
const cleanLocations = (s) => (/^\d+\s+locations?$/i.test(String(s || '').trim()) ? '' : String(s || ''));

export const workday = {
  id: 'workday',

  searchUrl: (ref) => `${ref.workday.apiBase}/jobs`,

  searchBody: (searchText, offset = 0) => ({ appliedFacets: {}, limit: WORKDAY_PAGE_SIZE, offset, searchText }),

  detailUrl: (ref, externalPath) => `${ref.workday.apiBase}${externalPath}`,

  boardUrl: (ref) => ref.workday.publicBase,

  /**
   * @returns {{ total: number, postings: import('./index.js').Posting[] }}
   */
  parseSearch(json, ref, now = new Date()) {
    const list = Array.isArray(json?.jobPostings) ? json.jobPostings : [];
    const postings = list
      .filter((j) => j && typeof j.externalPath === 'string' && j.title)
      .map((j) => {
        const posted = parsePostedOn(j.postedOn, now);
        return {
          id: j.externalPath,
          title: String(j.title).trim(),
          location: cleanLocations(j.locationsText),
          url: `${ref.workday.publicBase}${j.externalPath}`,
          createdAt: posted?.date ?? null,
          createdAtExact: posted?.exact ?? true,
          updatedAt: null,
          department: null,
          salary: null,
          text: '',
        };
      });
    return { total: Number.isFinite(json?.total) ? json.total : postings.length, postings };
  },

  /** @returns {import('./index.js').Posting | null} */
  parseDetail(json, ref, externalPath, now = new Date()) {
    const info = json?.jobPostingInfo;
    if (!info || !info.title) return null;
    const startDate = /^\d{4}-\d{2}-\d{2}/.test(info.startDate || '') ? `${info.startDate.slice(0, 10)}T00:00:00.000Z` : null;
    const posted = startDate ? { date: startDate, exact: true } : parsePostedOn(info.postedOn, now);
    const locations = [info.location, ...(Array.isArray(info.additionalLocations) ? info.additionalLocations : [])];
    return {
      id: externalPath,
      title: String(info.title).trim(),
      location: [...new Set(locations.filter(Boolean))].join('; '),
      url: typeof info.externalUrl === 'string' ? info.externalUrl : `${ref.workday.publicBase}${externalPath}`,
      createdAt: posted?.date ?? null,
      createdAtExact: posted?.exact ?? true,
      updatedAt: null,
      department: null,
      salary: null,
      text: htmlToText(info.jobDescription, MAX_POSTING_TEXT),
    };
  },
};
