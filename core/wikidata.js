/**
 * A company's official website from Wikidata (free, no key), to find its
 * careers site when the LinkedIn job gives no usable link.
 *
 *   wbsearchentities  company name -> candidate items
 *   wbgetentities     candidates -> official website (P856), type (P31), labels
 *
 * The website is only used when its domain carries the company's name, so a
 * namesake (Notion the software vs. Notion the ancient city) cannot slip in.
 */
import { hostMatchesCompany, normalizeCompanyName } from './companies.js';

const API = 'https://www.wikidata.org/w/api.php';

/** Item types that are companies (business, enterprise, public company, ...). */
const COMPANY_TYPES = new Set([
  'Q4830453', 'Q6881511', 'Q891723', 'Q783794', 'Q43229', 'Q1589009', 'Q167037', 'Q18388277', 'Q210167',
  'Q1058914', 'Q12738586', 'Q219577', 'Q2085381', 'Q5038204', 'Q1663017', 'Q1331793',
]);
const PERSON = 'Q5';

export function wikidataSearchUrl(name, language = 'en') {
  return `${API}?${new URLSearchParams({ action: 'wbsearchentities', search: name, language, uselang: language, type: 'item', limit: '5', format: 'json', origin: '*' })}`;
}

export function wikidataEntitiesUrl(ids) {
  return `${API}?${new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels|aliases', format: 'json', origin: '*' })}`;
}

const claimValues = (entity, prop) =>
  (entity?.claims?.[prop] || []).map((c) => c?.mainsnak?.datavalue?.value).filter((v) => v !== undefined && v !== null);

const namesOf = (entity) => [
  ...Object.values(entity?.labels || {}).map((l) => l?.value),
  ...Object.values(entity?.aliases || {}).flat().map((a) => a?.value),
].filter(Boolean);

/**
 * @param {string} company   the name LinkedIn shows
 * @param {any} search       wbsearchentities response
 * @param {any} entities     wbgetentities response
 * @returns {{ id: string, url: string } | null}
 */
export function pickCompanyWebsite(company, search, entities) {
  // Names with Chinese, Japanese or Korean characters lose them when normalised.
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(company);
  const want = cjk ? '' : normalizeCompanyName(company);
  const ids = (search?.search || []).map((h) => h.id);
  for (const id of ids) {
    const e = entities?.entities?.[id];
    if (!e) continue;
    const types = claimValues(e, 'P31').map((v) => v.id);
    if (types.includes(PERSON)) continue;
    const named = namesOf(e).some((n) => (cjk ? n.trim() === company.trim() : normalizeCompanyName(n) === want));
    if (!named) continue;
    for (const url of claimValues(e, 'P856')) {
      let host;
      try {
        host = new URL(url).hostname;
      } catch {
        continue;
      }
      // Latin names: the domain must carry the name. Other scripts: only
      // items typed as a company.
      if (want ? hostMatchesCompany(host, company) : types.some((t) => COMPANY_TYPES.has(t))) return { id, url };
    }
  }
  return null;
}

/**
 * Where a company's careers site usually is, given its website.
 * @param {string} website  e.g. "https://www.fedex.com/en-us/home.html"
 * @returns {string[]}
 */
export function careersCandidates(website) {
  let host;
  try {
    host = new URL(website).hostname.toLowerCase();
  } catch {
    return [];
  }
  const root = host.replace(/^www\d*\./, '');
  return [`https://careers.${root}/`, `https://jobs.${root}/`, `https://www.${root}/careers`, `https://www.${root}/jobs`];
}
