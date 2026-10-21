/**
 * data/companies.json: known mapping from LinkedIn companies to their ATS board.
 *
 * {
 *   "version": 1,
 *   "companies": [
 *     { "name": "Stripe", "aliases": ["Stripe, Inc."], "linkedin": ["stripe"],
 *       "ats": "greenhouse", "slug": "stripe", "region": null }
 *   ]
 * }
 */

const ATS_IDS = new Set(['greenhouse', 'lever', 'ashby', 'workday']);
const LEGAL_SUFFIXES =
  /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|ag|plc|sa|sas|bv|nv|pty|pte|oy|ab|as|srl|spa|kk)\b/g;

/** "Stripe, Inc." -> "stripe" */
export function normalizeCompanyName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1') // "s.a." -> "sa.", "l.l.c." -> "llc."
    .replace(/[(),.]/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * @typedef {object} CompanyEntry
 * @property {string} name
 * @property {string[]} aliases
 * @property {string[]} linkedin   LinkedIn company page ids (linkedin.com/company/{id})
 * @property {'greenhouse' | 'lever' | 'ashby' | 'workday'} ats
 * @property {string} slug
 * @property {string | null} region
 * @property {object} [workday]    { host, site } for Workday
 */

/**
 * Validate companies.json and build lookup maps. Invalid entries are skipped
 * (and reported) so one bad contribution cannot break the extension.
 * @param {unknown} json
 * @returns {{ entries: CompanyEntry[], errors: string[], byLinkedin: Map<string, CompanyEntry>, byName: Map<string, CompanyEntry> }}
 */
export function buildCompanyIndex(json) {
  const errors = [];
  const entries = [];
  const list = Array.isArray(json?.companies) ? json.companies : [];
  if (!Array.isArray(json?.companies)) errors.push('companies must be a list');

  list.forEach((c, i) => {
    const where = `companies[${i}]${c?.name ? ` (${c.name})` : ''}`;
    if (!c || typeof c.name !== 'string' || !c.name.trim()) return errors.push(`${where}: name is required`);
    if (!ATS_IDS.has(c.ats)) return errors.push(`${where}: ats must be one of ${[...ATS_IDS].join(', ')}`);
    if (typeof c.slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(c.slug)) {
      return errors.push(`${where}: slug is missing or has invalid characters`);
    }
    if (c.region != null && c.region !== 'eu') return errors.push(`${where}: region must be "eu" or omitted`);
    entries.push({
      name: c.name.trim(),
      aliases: Array.isArray(c.aliases) ? c.aliases.filter((a) => typeof a === 'string') : [],
      linkedin: Array.isArray(c.linkedin) ? c.linkedin.filter((a) => typeof a === 'string').map((a) => a.toLowerCase()) : [],
      ats: c.ats,
      slug: c.slug,
      region: c.region ?? null,
      ...(c.workday && typeof c.workday === 'object' ? { workday: c.workday } : {}),
    });
  });

  const byLinkedin = new Map();
  const byName = new Map();
  for (const e of entries) {
    for (const id of e.linkedin) {
      if (byLinkedin.has(id)) errors.push(`duplicate linkedin id: ${id}`);
      else byLinkedin.set(id, e);
    }
    for (const n of [e.name, ...e.aliases]) {
      const key = normalizeCompanyName(n);
      if (!key) continue;
      if (byName.has(key) && byName.get(key) !== e) errors.push(`duplicate company name: ${n}`);
      else byName.set(key, e);
    }
  }
  return { entries, errors, byLinkedin, byName };
}

/**
 * @param {ReturnType<typeof buildCompanyIndex>} index
 * @param {{ company?: string, linkedinCompanySlug?: string | null }} job
 * @returns {CompanyEntry | null}
 */
export function lookupCompany(index, job) {
  if (!index) return null;
  const li = job.linkedinCompanySlug?.toLowerCase();
  if (li && index.byLinkedin.has(li)) return index.byLinkedin.get(li);
  const key = normalizeCompanyName(job.company);
  return (key && index.byName.get(key)) || null;
}

/**
 * Candidate Greenhouse slugs guessed from a company name. A guess is only
 * used after the board's own name is confirmed to match (see check.js).
 * @param {string} name
 * @returns {string[]}
 */
export function guessSlugs(name) {
  const words = normalizeCompanyName(name).split(' ').filter(Boolean);
  if (!words.length) return [];
  const out = [words.join(''), words.join('-')];
  return [...new Set(out)].filter((s) => s.length >= 2);
}
