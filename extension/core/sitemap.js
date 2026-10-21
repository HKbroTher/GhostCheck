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
    // Tracking and ATS-embed parameters (gh_jid duplicates the id in the path).
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|gh_src$|gh_jid$|ashby_jid$|lever-|source$|src$|ref$|trk)/i.test(k)) u.searchParams.delete(k);
    }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.host.toLowerCase()}${decodeURI(path)}${u.search}`;
  } catch {
    return null;
  }
}
