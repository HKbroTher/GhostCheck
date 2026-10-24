import { decodeEntities, htmlToText } from './text.js';

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

// ------------------------------------------------------------ page reading
// Regex-based on purpose: service workers have no DOMParser.

const MAX_TEXTS = 400;
/** Separators in page titles: "Senior Engineer - Payments | Acme Careers", "Engineer at Acme". */
const SITE_SPLIT = /\s+[|·•—]\s+/;
const TITLE_SPLIT = /\s+[|·•–—-]\s+|\s+at\s+/i;

/**
 * Short texts a person would read as titles on the page: the document title,
 * og:title, headings and link texts (job lists and search results).
 * @param {string} html
 * @returns {string[]}
 */
export function pageTexts(html) {
  const source = String(html || '');
  const out = [];
  const add = (t, split) => {
    const text = decodeEntities(htmlToText(t, 400)).replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > 160) return;
    out.push(text);
    if (!split) return;
    for (const part of [...text.split(SITE_SPLIT), ...text.split(TITLE_SPLIT)]) {
      if (part.trim().length >= 3 && part !== text) out.push(part.trim());
    }
  };
  const meta = source.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (meta) add(meta[1], true);
  for (const m of source.matchAll(/<(title|h1|h2|h3|h4|a)\b[^>]*>([\s\S]{1,600}?)<\/\1>/gi)) {
    add(m[2], /^(title|h1)$/i.test(m[1]));
    if (out.length > MAX_TEXTS) break;
  }
  return [...new Set(out)].slice(0, MAX_TEXTS);
}

/** The site's own name: og:site_name, else the document title. */
export function siteName(html) {
  const source = String(html || '');
  const og = source.match(/<meta\b[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const title = source.match(/<title\b[^>]*>([\s\S]{1,300}?)<\/title>/i)?.[1];
  return decodeEntities(htmlToText(og || title || '', 300)).trim();
}

/** LinkedIn company ids the page links to (linkedin.com/company/{id}). */
export function linkedinCompanies(html) {
  const ids = [...String(html || '').matchAll(/linkedin\.com\/company\/([A-Za-z0-9_%.-]+)/gi)].map((m) => m[1].toLowerCase());
  return [...new Set(ids)].slice(0, 10);
}

const CAREERS_TEXT = /\b(careers?|jobs?|join (?:us|our team)|work (?:with|for) us|open (?:positions|roles)|vacancies|hiring)\b|招聘|加入我们|採用|求人|채용/i;
const CAREERS_HREF = /\/(careers?|jobs?|join-?us|work-?with-?us|recruit(ing|ment)?|saiyo|recruit)(\/|$|\?|\.html?)/i;

/**
 * Links to the careers site, as found in a home page's navigation or footer.
 * @param {string} html
 * @param {string} pageUrl
 * @returns {string[]}  absolute URLs, most likely first
 */
export function careersLinks(html, pageUrl) {
  const out = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    let url;
    try {
      url = new URL(decodeEntities(m[1]), pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:') continue;
    const text = htmlToText(m[2], 200);
    const score = (CAREERS_TEXT.test(text) ? 2 : 0) + (CAREERS_HREF.test(url.pathname) || /^(careers|jobs)\./i.test(url.hostname) ? 1 : 0);
    if (score) out.push({ url: url.href, score });
  }
  out.sort((a, b) => b.score - a.score);
  return [...new Set(out.map((o) => o.url))].slice(0, 5);
}

const SEARCH_FIELDS = /^(q|query|keyword|keywords|search|searchtext|search_text|k|kw|term|text)$/i;

/**
 * The site's job search form (GET), as a URL template: the job title goes
 * where {q} is.
 * @param {string} html
 * @param {string} pageUrl
 * @returns {string | null}  e.g. "https://careers.acme.com/search?keywords={q}"
 */
export function searchFormUrl(html, pageUrl) {
  for (const m of String(html || '').matchAll(/<form\b([^>]*)>([\s\S]{0,4000}?)<\/form>/gi)) {
    const attrs = m[1];
    if (/method=["']?post/i.test(attrs)) continue;
    const field = [...m[2].matchAll(/<input\b[^>]*name=["']([^"']+)["'][^>]*>/gi)].map((i) => i[1]).find((n) => SEARCH_FIELDS.test(n));
    if (!field) continue;
    const action = attrs.match(/action=["']([^"']*)["']/i)?.[1] ?? '';
    try {
      const url = new URL(decodeEntities(action) || pageUrl, pageUrl);
      if (url.protocol !== 'https:') continue;
      url.search = '';
      url.hash = '';
      return `${url.href}?${encodeURIComponent(field)}={q}`;
    } catch {
      continue;
    }
  }
  return null;
}

/** Common search URLs to try when a careers page has no search form. */
export function commonSearchUrls(careersUrl) {
  let u;
  try {
    u = new URL(careersUrl);
  } catch {
    return [];
  }
  const base = u.pathname.replace(/\/+$/, '');
  return [`${u.origin}${base}/search?q={q}`, `${u.origin}${base}?keywords={q}`];
}
