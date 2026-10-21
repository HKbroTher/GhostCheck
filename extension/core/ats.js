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
 * @property {object} [workday]       { tenant, host, site } for Workday
 */

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

  // Workday: {tenant}.wd{N}.myworkdayjobs.com/[{locale}/]{site}/job/...
  const wd = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    const rest = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || '') ? parts.slice(1) : parts;
    const site = rest[0] && rest[0] !== 'job' ? rest[0] : null;
    return {
      ats: 'workday',
      slug: wd[1],
      jobId: null,
      region: null,
      workday: { tenant: wd[1], host, site },
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
