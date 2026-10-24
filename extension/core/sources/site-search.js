/**
 * Careers sites that offer a public search but no full job list. A search
 * can confirm a job (or its exact id); it can never show a job is missing.
 *
 * - amazon.jobs: GET /en/search.json (base_query also finds a job id)
 * - Phenom (the "phApp" sites: careers.mastercard.com, jobs.thermofisher.com,
 *   ...): POST {widgetApiEndpoint} with ddoKey "refineSearch"
 */
import { htmlToText } from '../text.js';
import { MAX_POSTING_TEXT, toIsoDate } from './common.js';

// ------------------------------------------------------------- amazon.jobs

const AMAZON_HOST = /^(www\.)?amazon\.jobs$/i;

/**
 * @param {string} url  apply link or careers page
 * @returns {{ kind: 'amazon', origin: string, jobId: string | null } | null}
 */
export function amazonSite(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!AMAZON_HOST.test(u.hostname)) return null;
  const id = u.pathname.match(/\/jobs\/(\d{5,})(?:\/|$)/)?.[1] ?? null;
  return { kind: 'amazon', origin: 'https://www.amazon.jobs', jobId: id };
}

export function amazonSearchUrl(query, limit = 50) {
  const q = new URLSearchParams({ base_query: query, result_limit: String(limit), offset: '0', sort: 'relevant' });
  return `https://www.amazon.jobs/en/search.json?${q}`;
}

/** Search page a person can open. */
export function amazonSearchPage(query) {
  return `https://www.amazon.jobs/en/search?${new URLSearchParams({ base_query: query })}`;
}

/** @returns {import('./index.js').Posting[]} */
export function parseAmazon(json) {
  return (Array.isArray(json?.jobs) ? json.jobs : [])
    .filter((j) => j && j.title && (j.id_icims || j.id))
    .map((j) => ({
      id: String(j.id_icims || j.id),
      title: String(j.title),
      location: String(j.normalized_location || j.location || ''),
      url: j.job_path ? `https://www.amazon.jobs${j.job_path}` : null,
      // "October 19, 2026": a calendar day, read as UTC
      createdAt: j.posted_date ? toIsoDate(`${j.posted_date} UTC`) : null,
      createdAtExact: true,
      updatedAt: null,
      department: j.job_category || null,
      salary: null,
      text: htmlToText([j.description, j.basic_qualifications, j.preferred_qualifications].filter(Boolean).join('\n'), MAX_POSTING_TEXT),
    }));
}

// ------------------------------------------------------------------ Phenom

const cfgValue = (html, key) => html.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]{1,200})"`))?.[1] ?? null;

/**
 * Phenom configuration from a careers page ("phApp = {...}").
 * @param {string} html
 * @param {string} pageUrl
 * @returns {{ kind: 'phenom', jobId: string | null, endpoint: string, baseUrl: string, locale: string,
 *   country: string, refNum: string | null, siteType: string } | null}
 */
export function phenomSite(html, pageUrl) {
  const source = String(html || '');
  if (!/phApp\s*=/.test(source)) return null;
  const endpoint = cfgValue(source, 'widgetApiEndpoint');
  let origin;
  try {
    origin = new URL(pageUrl).origin;
    // Only the careers site itself: its API is covered by the user's permission.
    if (!endpoint || new URL(endpoint).origin !== origin) return null;
  } catch {
    return null;
  }
  // Job pages: {baseUrl}job/{jobId}/{slug}
  const jobId = new URL(pageUrl).pathname.match(/\/job\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] ?? null;
  return {
    kind: 'phenom',
    jobId,
    endpoint,
    baseUrl: cfgValue(source, 'baseUrl') || `${origin}/`,
    locale: cfgValue(source, 'locale') || 'en_us',
    country: cfgValue(source, 'country') || 'us',
    refNum: cfgValue(source, 'refNum'),
    siteType: cfgValue(source, 'siteType') || 'external',
  };
}

/** Request body of Phenom's job search widget. */
export function phenomSearchBody(site, keywords, size = 50) {
  return {
    lang: site.locale,
    deviceType: 'desktop',
    country: site.country,
    pageName: 'search-results',
    ddoKey: 'refineSearch',
    sortBy: '',
    subsearch: '',
    from: 0,
    jobs: true,
    counts: false,
    all_fields: [],
    size,
    clearAll: false,
    jdsource: 'facets',
    isSliderEnable: false,
    pageId: 'page20',
    siteType: site.siteType,
    keywords,
    global: true,
    selected_fields: {},
    locationData: {},
    ...(site.refNum ? { refNum: site.refNum } : {}),
  };
}

export function phenomSearchPage(site, query) {
  return `${site.baseUrl}search-results?${new URLSearchParams({ keywords: query })}`;
}

/** @returns {import('./index.js').Posting[]} */
export function parsePhenom(json, site) {
  const jobs = json?.refineSearch?.data?.jobs;
  return (Array.isArray(jobs) ? jobs : [])
    .filter((j) => j && j.title && (j.jobId || j.reqId || j.jobSeqNo))
    .map((j) => {
      const id = String(j.jobId || j.reqId || j.jobSeqNo);
      const location = Array.isArray(j.multi_location) && j.multi_location.length
        ? j.multi_location.join('; ')
        : String(j.cityStateCountry || j.location || [j.city, j.state, j.country].filter(Boolean).join(', '));
      return {
        id,
        title: String(j.title),
        location,
        url: `${site.baseUrl}job/${encodeURIComponent(id)}`,
        createdAt: toIsoDate(j.postedDate || j.dateCreated),
        createdAtExact: true,
        updatedAt: null,
        department: Array.isArray(j.multi_category) ? j.multi_category.join(', ') : j.category || null,
        salary: null,
        text: String(j.descriptionTeaser || '').slice(0, MAX_POSTING_TEXT),
        applyUrl: typeof j.applyUrl === 'string' ? j.applyUrl : null,
        reqId: j.reqId ? String(j.reqId) : null,
      };
    });
}
