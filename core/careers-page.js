/**
 * Is an apply link a careers site's general entry or search page rather than
 * the page of one job? LinkedIn often links "Apply" to /careers or a search
 * page; the job is then not on that page, which says nothing about the job.
 */

/** Last path segments of landing and search pages. */
const LANDING = new Set([
  'careers', 'career', 'jobs', 'job', 'search', 'search-results', 'searchresults', 'job-search', 'jobsearch',
  'search-jobs', 'jobs-search', 'opportunities', 'openings', 'open-positions', 'positions', 'vacancies',
  'join-us', 'joinus', 'work-with-us', 'join', 'en', 'us', 'global', 'home', 'index', 'index.html', 'results',
]);
const SEARCH_PARAMS = /^(q|query|keyword|keywords|search|searchtext|k|kw|term)$/i;
const JOB_PARAMS = /^(gh_jid|ashby_jid|jobid|job_id|jid|reqid|req_id|id|requisitionid|pid)$/i;

/**
 * @param {string} rawUrl
 * @returns {boolean}
 */
export function isGenericCareersUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  const keys = [...u.searchParams.keys()];
  if (keys.some((k) => JOB_PARAMS.test(k) && u.searchParams.get(k))) return false;
  const segments = u.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  // Any segment that looks like a job id or a job slug means one job.
  if (segments.some((s) => /\d{4,}/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s) || /^r-?\d+/.test(s))) return false;
  if (keys.some((k) => SEARCH_PARAMS.test(k))) return true;
  const last = segments[segments.length - 1];
  return !last || LANDING.has(last) || /^[a-z]{2}[-_][a-z]{2}$/.test(last);
}
