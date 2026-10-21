/**
 * Identify the applicant tracking system (ATS) and company identifier from an
 * apply URL.
 *
 * @typedef {'greenhouse' | 'lever' | 'ashby' | 'workday'} AtsId
 *
 * @typedef {object} AtsRef
 * @property {AtsId} ats
 * @property {string | null} slug     board identifier; null if only the job id is known
 * @property {string | null} jobId    posting id, when the URL points at one posting
 * @property {string | null} region   'eu' for EU-hosted boards, else null
 * @property {ReturnType<typeof workdayRef>} [workday]  Workday site and API URLs
 */

import { workdayRef } from './sources/workday.js';

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {string} s */
const safeSlug = (s) => (s && SLUG_RE.test(s) ? s.toLowerCase() : null);

/**
 * @param {string | null | undefined} rawUrl
 * @returns {AtsRef | null}
 */
export function detectAts(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  // Greenhouse: boards.greenhouse.io/{slug}/jobs/{id}, job-boards(.eu).greenhouse.io/{slug}/jobs/{id},
  // boards.greenhouse.io/embed/job_app?for={slug}&token={id}
  const gh = host.match(/^(?:job-)?boards(\.eu)?\.greenhouse\.io$/);
  if (gh) {
    const region = gh[1] ? 'eu' : null;
    if (parts[0] === 'embed') {
      const slug = safeSlug(url.searchParams.get('for'));
      const token = url.searchParams.get('token');
      return slug ? { ats: 'greenhouse', slug, jobId: /^\d+$/.test(token || '') ? token : null, region } : null;
    }
    const slug = safeSlug(parts[0]);
    if (!slug) return null;
    const jobId = parts[1] === 'jobs' && /^\d+$/.test(parts[2] || '') ? parts[2] : null;
    return { ats: 'greenhouse', slug, jobId, region };
  }

  // Lever: jobs.lever.co/{slug}/{uuid}[/apply], jobs.eu.lever.co/...
  const lv = host.match(/^jobs(\.eu)?\.lever\.co$/);
  if (lv) {
    const slug = safeSlug(parts[0]);
    if (!slug) return null;
    const jobId = UUID_RE.test(parts[1] || '') ? parts[1].toLowerCase() : null;
    return { ats: 'lever', slug, jobId, region: lv[1] ? 'eu' : null };
  }

  // Ashby: jobs.ashbyhq.com/{slug}/{uuid}[/application]
  if (host === 'jobs.ashbyhq.com') {
    const slug = parts[0] || null;
    if (!slug) return null;
    const jobId = UUID_RE.test(parts[1] || '') ? parts[1].toLowerCase() : null;
    // Ashby board names keep their case and may contain spaces ("Acme Inc").
    return { ats: 'ashby', slug, jobId, region: null };
  }

  // Workday: {tenant}.wd{N}.myworkdayjobs.com/[{locale}/]{site}/job/{...}
  //          wd{N}.myworkdaysite.com/[{locale}/]recruiting/{tenant}/{site}/job/{...}
  const wdJobs = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/);
  const wdSite = /^wd\d+\.myworkdaysite\.com$/.test(host);
  if (wdJobs || wdSite) {
    let rest = /^[a-z]{2}-[a-z]{2}$/i.test(parts[0] || '') ? parts.slice(1) : parts;
    let tenant = wdJobs ? wdJobs[1] : null;
    if (wdSite) {
      if (rest[0] !== 'recruiting' || !rest[1]) return null;
      tenant = rest[1].toLowerCase();
      rest = rest.slice(2);
    }
    const site = rest[0] && rest[0] !== 'job' && /^[A-Za-z0-9_-]+$/.test(rest[0]) ? rest[0] : null;
    // The posting path as the API names it: /job/{location}/{title}_{reqId}
    const jobIdx = rest.indexOf('job');
    let jobPath = null;
    if (site && jobIdx === 1 && rest.length >= 4) {
      const segs = rest.slice(jobIdx, jobIdx + 3);
      jobPath = `/${segs.map(encodeURIComponent).join('/')}`;
    }
    return {
      ats: 'workday',
      slug: tenant,
      jobId: jobPath,
      region: null,
      workday: workdayRef({ tenant, host, site }),
    };
  }

  // Company careers pages that embed an ATS: the job id is in a query param,
  // the board slug is not (resolved later through data/companies.json).
  const ghJid = url.searchParams.get('gh_jid');
  if (ghJid && /^\d+$/.test(ghJid)) return { ats: 'greenhouse', slug: null, jobId: ghJid, region: null };
  const ashbyJid = url.searchParams.get('ashby_jid');
  if (ashbyJid && UUID_RE.test(ashbyJid)) {
    return { ats: 'ashby', slug: null, jobId: ashbyJid.toLowerCase(), region: null };
  }
  return null;
}
