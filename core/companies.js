/**
 * data/companies.json: known mapping from LinkedIn companies to their ATS board.
 *
 * {
 *   "version": 1,
 *   "companies": [
 *     { "name": "Stripe", "aliases": ["Stripe, Inc."], "linkedin": ["stripe"],
 *       "ats": "greenhouse", "slug": "stripe", "region": null },
 *     { "name": "NVIDIA", "ats": "workday", "slug": "nvidia",
 *       "workday": { "host": "nvidia.wd5.myworkdayjobs.com", "site": "NVIDIAExternalCareerSite" } }
 *   ]
 * }
 */

import { isWorkdayHost, workdayRef } from './sources/workday.js';
import { detectAts } from './ats.js';

const ATS_IDS = new Set(['greenhouse', 'lever', 'ashby', 'workday', 'workable', 'smartrecruiters', 'oracle']);
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
 * @property {'greenhouse' | 'lever' | 'ashby' | 'workday' | 'workable' | 'smartrecruiters' | 'oracle'} ats
 * @property {string} slug
 * @property {string | null} region
 * @property {ReturnType<typeof workdayRef>} [workday]  for Workday: built from { host, site }
 * @property {{ origin: string, site: string }} [oracle]  for Oracle Recruiting: from oracle.url
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
    if (c.ats === 'workday') {
      const w = c.workday;
      if (!w || typeof w.host !== 'string' || !isWorkdayHost(w.host) || typeof w.site !== 'string' || !/^[A-Za-z0-9_-]+$/.test(w.site)) {
        return errors.push(`${where}: workday entries need workday.host (*.myworkdayjobs.com) and workday.site`);
      }
    }
    let oracle = null;
    if (c.ats === 'oracle') {
      oracle = typeof c.oracle?.url === 'string' ? detectAts(c.oracle.url)?.oracle : null;
      if (!oracle) return errors.push(`${where}: oracle entries need oracle.url (https://.../hcmUI/CandidateExperience/en/sites/<site>)`);
    }
    entries.push({
      name: c.name.trim(),
      aliases: Array.isArray(c.aliases) ? c.aliases.filter((a) => typeof a === 'string') : [],
      linkedin: Array.isArray(c.linkedin) ? c.linkedin.filter((a) => typeof a === 'string').map((a) => a.toLowerCase()) : [],
      ats: c.ats,
      slug: c.slug,
      region: c.region ?? null,
      ...(c.ats === 'workday' ? { workday: workdayRef({ tenant: c.slug, host: c.workday.host, site: c.workday.site }) } : {}),
      ...(oracle ? { oracle } : {}),
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

/**
 * Does the site's domain carry the company's name? careers.fedex.com is
 * FedEx's own site even when its pages name "Federal Express Corporation".
 */
export function hostMatchesCompany(host, company) {
  const name = normalizeCompanyName(company);
  const names = [name.replace(/ /g, ''), name.split(' ')[0]].filter((n) => n.length >= 3);
  const labels = String(host || '').toLowerCase().split('.').slice(0, -1); // drop the top-level domain
  return labels.some((label) =>
    names.some((n) => label === n || (label.length >= 4 && n.length >= 4 && (n.startsWith(label) || label.startsWith(n)))),
  );
}

/**
 * Domains a company with this name might use: "Acme Robotics" ->
 * acmerobotics.com, acme-robotics.com, acmerobotics.ai, ... Only a guess:
 * the site must still show it belongs to the company.
 */
export function guessDomains(name) {
  const words = normalizeCompanyName(name).split(' ').filter(Boolean);
  if (!words.length) return [];
  const joined = words.join('');
  if (joined.length < 3) return [];
  const out = [`${joined}.com`, `${joined}.ai`, `${joined}.io`, `${joined}.co`];
  if (words.length > 1) out.splice(1, 0, `${words.join('-')}.com`);
  return out;
}
