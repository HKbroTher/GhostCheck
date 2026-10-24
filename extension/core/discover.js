/**
 * Find the applicant tracking system behind a company's own careers page.
 *
 * Many careers pages have no structured job data but link to, or embed, the
 * ATS that really holds the job ("Apply" button to jobs.ashbyhq.com/...,
 * a Greenhouse embed script, a Workday link). Every URL in the page source is
 * run through detectAts(); the most frequent board wins.
 */
import { detectAts } from './ats.js';
import { decodeEntities } from './text.js';

/** ATS GhostCheck cannot query yet, by host. Shown to the user and logged. */
const UNSUPPORTED = [
  [/(^|\.)herp\.careers$/, 'HERP'],
  [/(^|\.)hrmos\.co$/, 'HRMOS'],
  [/(^|\.)talentio\.com$/, 'Talentio'],
  [/(^|\.)wantedly\.com$/, 'Wantedly'],
  [/(^|\.)recruitee\.com$/, 'Recruitee'],
  [/(^|\.)jobs\.personio\.(de|com)$/, 'Personio'],
  [/(^|\.)bamboohr\.com$/, 'BambooHR'],
  [/(^|\.)teamtailor\.com$/, 'Teamtailor'],
  [/(^|\.)icims\.com$/, 'iCIMS'],
  [/(^|\.)taleo\.net$/, 'Taleo'],
  [/(^|\.)successfactors\.(com|eu)$|^jobs\.sap\.com$/, 'SAP SuccessFactors'],
  [/(^|\.)jobvite\.com$/, 'Jobvite'],
  [/(^|\.)breezy\.hr$/, 'Breezy HR'],
  [/(^|\.)applytojob\.com$/, 'JazzHR'],
  [/(^|\.)pinpointhq\.com$/, 'Pinpoint'],
  [/(^|\.)rippling\.com$/, 'Rippling'],
  [/^jobs\.gem\.com$/, 'Gem'],
  [/(^|\.)dover\.com$/, 'Dover'],
  [/(^|\.)eightfold\.ai$/, 'Eightfold'],
  [/(^|\.)oraclecloud\.com$/, 'Oracle Recruiting'],
];

const URL_RE = /https?:\/\/[^\s"'<>()\\]+/gi;
const MAX_URLS = 3000;

/**
 * @param {string} html   page source
 * @returns {{ refs: Array<{ ref: import('./ats.js').AtsRef, count: number }>, unsupported: string[] }}
 *   refs: boards found, most frequent first; unsupported: names of other ATS seen
 */
export function discoverAts(html) {
  // Unescape the common encodings of URLs inside scripts and attributes.
  const source = decodeEntities(String(html || '')).replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/');
  const boards = new Map();
  const unsupported = new Set();
  let n = 0;
  for (const [raw] of source.matchAll(URL_RE)) {
    if (++n > MAX_URLS) break;
    const url = raw.replace(/[.,;]+$/, '');
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    const ref = detectAts(url);
    if (ref?.slug && (ref.ats !== 'workday' || ref.workday?.apiBase)) {
      // Oracle sites are found by path; only on Oracle's own cloud may we call them without asking.
      if (ref.ats === 'oracle' && !/\.oraclecloud\.com$/.test(host)) continue;
      const key = `${ref.ats}:${ref.region || ''}:${String(ref.slug).toLowerCase()}`;
      const entry = boards.get(key) || { ref: { ...ref, jobId: null }, count: 0, jobIds: new Set() };
      entry.count++;
      if (ref.jobId) entry.jobIds.add(ref.jobId);
      boards.set(key, entry);
      continue;
    }
    for (const [re, name] of UNSUPPORTED) if (re.test(host)) unsupported.add(name);
  }
  const refs = [...boards.values()]
    .sort((a, b) => b.count - a.count)
    // A page that links to exactly one posting is the posting itself.
    .map(({ ref, count, jobIds }) => ({ ref: jobIds.size === 1 ? { ...ref, jobId: [...jobIds][0] } : ref, count }));
  return { refs, unsupported: [...unsupported] };
}
