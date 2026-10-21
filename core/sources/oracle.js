/**
 * Oracle Recruiting Cloud ("Candidate Experience") public REST API, used by
 * careers sites such as jpmc.fa.oraclecloud.com and enterpriseplatform.dell.com.
 *
 *   GET {origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions
 *       ?onlyData=true&expand=requisitionList.secondaryLocations
 *       &finder=findReqs;siteNumber={site},limit={n},keyword="{text}"
 *   GET {origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails
 *       ?expand=all&onlyData=true&finder=ById;Id="{id}",siteNumber={site}
 *
 * A removed posting comes back as an empty item list. Search results are a
 * full list only when the site has few jobs (see check.js).
 */
import { htmlToText } from '../text.js';
import { MAX_POSTING_TEXT, toIsoDate } from './common.js';

/** Sites small enough to list completely with one request. */
export const ORACLE_FULL_LIST_MAX = 200;

const API = '/hcmRestApi/resources/latest';

/** Characters with a meaning in Oracle's finder syntax. */
const keyword = (text) => String(text || '').replace(/[",;=]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/**
 * @param {{ origin: string, site: string }} o
 * @param {string} [text]  search text; empty lists the newest jobs
 * @param {number} [limit]
 */
export function oracleSearchUrl(o, text = '', limit = 50) {
  const kw = keyword(text);
  const finder = `findReqs;siteNumber=${o.site},limit=${limit}${kw ? `,keyword="${kw}"` : ''},sortBy=POSTING_DATES_DESC`;
  return `${o.origin}${API}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`;
}

export function oracleDetailUrl(o, id) {
  const finder = `ById;Id="${String(id).replace(/\D/g, '')}",siteNumber=${o.site}`;
  return `${o.origin}${API}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${encodeURIComponent(finder)}`;
}

export const oraclePostingUrl = (o, id) => `${o.origin}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(o.site)}/job/${encodeURIComponent(id)}`;
export const oracleBoardUrl = (o) => `${o.origin}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(o.site)}`;

const locationsOf = (r) =>
  [r.PrimaryLocation, ...(Array.isArray(r.secondaryLocations) ? r.secondaryLocations.map((l) => l?.Name) : [])].filter(Boolean).join('; ');

/** @returns {{ postings: import('./index.js').Posting[], total: number }} */
export function parseOracleSearch(json, o) {
  const item = json?.items?.[0];
  const list = Array.isArray(item?.requisitionList) ? item.requisitionList : [];
  return {
    total: Number(item?.TotalJobsCount) || list.length,
    postings: list
      .filter((r) => r && r.Id && r.Title)
      .map((r) => ({
        id: String(r.Id),
        title: String(r.Title).trim(),
        location: locationsOf(r),
        url: oraclePostingUrl(o, r.Id),
        createdAt: toIsoDate(r.PostedDate),
        createdAtExact: true,
        updatedAt: null,
        department: r.JobFamily || null,
        salary: null,
        text: htmlToText(r.ShortDescriptionStr || '', MAX_POSTING_TEXT),
      })),
  };
}

/** One posting, or null when the site no longer lists it. */
export function parseOracleDetail(json, o) {
  const d = json?.items?.[0];
  if (!d || !d.Id || !d.Title) return null;
  const otherLocations = Array.isArray(d.otherWorkLocations) ? d.otherWorkLocations.map((l) => l?.TownOrCity || l?.LocationName) : [];
  return {
    id: String(d.Id),
    title: String(d.Title).trim(),
    location: [d.PrimaryLocation, ...(Array.isArray(d.secondaryLocations) ? d.secondaryLocations.map((l) => l?.Name) : []), ...otherLocations]
      .filter(Boolean)
      .join('; '),
    url: oraclePostingUrl(o, d.Id),
    createdAt: toIsoDate(d.ExternalPostedStartDate),
    createdAtExact: true,
    updatedAt: null,
    department: d.JobFamily || d.Department || null,
    salary: null,
    text: htmlToText([d.ExternalDescriptionStr, d.ExternalResponsibilitiesStr, d.ExternalQualificationsStr].filter(Boolean).join('\n'), MAX_POSTING_TEXT),
  };
}
