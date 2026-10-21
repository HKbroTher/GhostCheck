/**
 * Resolve the real destination of a LinkedIn "Apply" link.
 *
 * LinkedIn wraps external apply links in several redirect formats, e.g.
 *   https://www.linkedin.com/redir/redirect?url=<encoded>
 *   https://www.linkedin.com/jobs/view/externalApply/123?url=<encoded>
 *   https://www.linkedin.com/safety/go?url=<encoded>
 * Logged-out job pages also embed the link as an HTML comment inside
 * <code id="applyUrl">, e.g. <!--"https://...externalApply...?url=..."-->.
 *
 * This module is pure (no DOM, no chrome.* APIs) so it can be unit tested
 * in Node and shared with the extension service worker.
 */

const LINKEDIN_BASE = 'https://www.linkedin.com';
const MAX_UNWRAP_DEPTH = 4;

/** Query parameters LinkedIn uses to carry the real target URL. */
const REDIRECT_PARAMS = ['url', 'redirect', 'redirectUrl', 'dest'];

/** Path prefixes on linkedin.com that are known redirect wrappers. */
const REDIRECT_PATHS = [/^\/redir\/redirect/i, /^\/jobs\/view\/externalApply\//i, /^\/safety\/go/i];

/**
 * Strip wrappers that appear when the URL is scraped from markup:
 * surrounding whitespace, HTML comment markers, quotes and &amp; entities.
 * @param {string} raw
 * @returns {string}
 */
export function cleanRawUrl(raw) {
  let s = String(raw).trim();
  s = s.replace(/^<!--/, '').replace(/-->$/, '').trim();
  s = s.replace(/^["']+/, '').replace(/["']+$/, '').trim();
  s = s.replace(/&amp;/g, '&');
  return s;
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLinkedInHost(hostname) {
  const h = hostname.toLowerCase();
  return h === 'linkedin.com' || h.endsWith('.linkedin.com') || h === 'lnkd.in';
}

/**
 * Remove marketing parameters that never affect ATS identification.
 * @param {URL} url
 */
function stripTrackingParams(url) {
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
}

/**
 * Resolve a raw apply href to the external destination URL.
 *
 * @param {string | null | undefined} raw  href or embedded markup from the page
 * @returns {string | null}  absolute http(s) URL outside LinkedIn, or null when
 *   there is no external destination (Easy Apply, internal link, garbage input)
 */
export function resolveApplyUrl(raw) {
  if (!raw) return null;
  let current = cleanRawUrl(raw);

  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    let url;
    try {
      url = new URL(current, LINKEDIN_BASE);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    if (!isLinkedInHost(url.hostname)) {
      stripTrackingParams(url);
      return url.toString();
    }

    const isRedirect = REDIRECT_PATHS.some((re) => re.test(url.pathname));
    const target = REDIRECT_PARAMS.map((p) => url.searchParams.get(p)).find(Boolean);
    if (!isRedirect || !target) return null;

    // URLSearchParams already decoded one level; nested wrappers are handled
    // by the next loop iteration.
    current = cleanRawUrl(target);
  }
  return null;
}
