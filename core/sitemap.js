/**
 * robots.txt / sitemap.xml parsing, regex-based (no DOMParser in workers).
 */
import { decodeEntities } from './text.js';

/** Sitemap URLs declared in robots.txt. */
export function sitemapsFromRobots(robots) {
  return [...String(robots || '').matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1]);
}

/**
 * @param {string} xml
 * @returns {{ urls: Array<{ loc: string, lastmod: string | null }>, sitemaps: string[] }}
 */
export function parseSitemap(xml) {
  const s = String(xml || '');
  const isIndex = /<sitemapindex[\s>]/i.test(s);
  const entries = [...s.matchAll(/<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => {
    const loc = m[2].match(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/i)?.[1];
    const lastmod = m[2].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)?.[1] ?? null;
    return { loc: loc ? decodeEntities(loc.trim()) : null, lastmod };
  });
  const valid = entries.filter((e) => e.loc);
  return isIndex ? { urls: [], sitemaps: valid.map((e) => e.loc) } : { urls: valid, sitemaps: [] };
}

/** Child sitemaps that likely list jobs, so we fetch those first. */
export function isLikelyJobSitemap(url) {
  return /job|career|position|opening|vacanc|requisition|posting/i.test(url);
}

/** Comparable form of a URL: host lowercased, no hash, no trailing slash, tracking/embed params dropped. */
export function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      // Tracking parameters never identify the page.
      if (/^(utm_|gh_src$|lever-|source$|src$|ref$|trk)/i.test(k)) u.searchParams.delete(k);
      // ATS job ids are dropped only when the path repeats them
      // (/positions/77?gh_jid=77). On generic pages (/job?gh_jid=77) the id
      // is the only thing that tells jobs apart, so it must stay.
      else if (/^(gh_jid|ashby_jid)$/i.test(k) && u.pathname.includes(u.searchParams.get(k))) u.searchParams.delete(k);
    }
    let path = u.pathname.replace(/\/+$/, '') || '/';
    try {
      path = decodeURI(path);
    } catch {
      // malformed escape ("100%-remote"): compare the path as written
    }
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return null;
  }
}
