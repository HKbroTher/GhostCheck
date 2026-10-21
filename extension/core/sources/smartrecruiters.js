/**
 * SmartRecruiters public Posting API:
 *
 *   GET https://api.smartrecruiters.com/v1/companies/{company}/postings?limit=100&offset=0[&q=text]
 *   GET https://api.smartrecruiters.com/v1/companies/{company}/postings/{id}   (404 once removed)
 *
 * An unknown company answers like an empty one (totalFound 0), so an empty
 * board never counts as evidence. Large boards are searched by title.
 */
import { htmlToText } from '../text.js';
import { MAX_POSTING_TEXT, toIsoDate } from './common.js';

const API = 'https://api.smartrecruiters.com/v1/companies';
export const SMARTRECRUITERS_PAGE = 100;

export const smartRecruitersListUrl = (company, { offset = 0, q = '' } = {}) =>
  `${API}/${encodeURIComponent(company)}/postings?${new URLSearchParams({ limit: String(SMARTRECRUITERS_PAGE), offset: String(offset), ...(q ? { q } : {}) })}`;
export const smartRecruitersDetailUrl = (company, id) => `${API}/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`;
export const smartRecruitersBoardUrl = (company) => `https://careers.smartrecruiters.com/${encodeURIComponent(company)}`;
export const smartRecruitersPostingUrl = (company, id) => `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${encodeURIComponent(id)}`;

function locationOf(l) {
  if (!l) return '';
  const place = l.fullLocation || [l.city, l.region, l.country?.toUpperCase()].filter(Boolean).join(', ');
  return [place, l.remote ? 'Remote' : ''].filter(Boolean).join('; ');
}

function toPosting(p, company) {
  const sections = p.jobAd?.sections || {};
  return {
    id: String(p.id),
    title: String(p.name).trim(),
    location: locationOf(p.location),
    url: typeof p.postingUrl === 'string' ? p.postingUrl : smartRecruitersPostingUrl(company, p.id),
    createdAt: toIsoDate(p.releasedDate),
    createdAtExact: true,
    updatedAt: null,
    department: p.department?.label || p.function?.label || null,
    salary: null,
    text: htmlToText(
      [sections.jobDescription?.text, sections.qualifications?.text, sections.additionalInformation?.text].filter(Boolean).join('\n'),
      MAX_POSTING_TEXT,
    ),
    orgName: p.company?.name || null,
  };
}

/** @returns {{ postings: import('./index.js').Posting[], total: number, companyName: string | null }} */
export function parseSmartRecruitersList(json, company) {
  const list = Array.isArray(json?.content) ? json.content : [];
  const postings = list.filter((p) => p && p.id && p.name).map((p) => toPosting(p, company));
  return { postings, total: Number(json?.totalFound) || 0, companyName: postings[0]?.orgName ?? null };
}

export function parseSmartRecruitersDetail(json, company) {
  return json && json.id && json.name ? toPosting(json, company) : null;
}
