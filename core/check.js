/**
 * Turn a LinkedIn job into a verdict. Network access is injected through
 * `deps` so the same logic runs in the service worker and in tests.
 */
import { resolveApplyUrl, isLinkedInHost } from './apply-url.js';
import { detectAts } from './ats.js';
import { lookupCompany, guessDomains, guessSlugs, hostMatchesCompany, normalizeCompanyName } from './companies.js';
import { matchPosting } from './matcher.js';
import { sameTitleLanguage } from './normalize.js';
import { detectJobBoard, jobBoardName } from './job-boards.js';
import { compareLanguages, detectLanguage, postingLanguage } from './language.js';
import { commonSearchUrls, isGenericCareersUrl } from './careers-page.js';
import { parseLinkedInPosted } from './linkedin-date.js';
import { careersCandidates } from './wikidata.js';
import { amazonSearchPage, amazonSite, phenomSearchPage } from './sources/site-search.js';
import { oracleBoardUrl } from './sources/oracle.js';
import { smartRecruitersBoardUrl } from './sources/smartrecruiters.js';
import { detectSalary, detectSpecificTeam, detectGenericTemplate } from './jd.js';
import { evaluate } from './rules.js';
import { makeResult } from './result.js';
import { SOURCES } from './sources/index.js';
import { lookupFirstSeen } from './snapshot.js';
import { linkedinJobUrl } from './wayback.js';
import { combineAge, ageSignals } from './age.js';
import { t } from './i18n.js';
import { workday } from './sources/workday.js';
import { canonicalUrl } from './sitemap.js';
import { refineMatch } from './semantic.js';

const ATS_NAMES = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  workable: 'Workable',
  oracle: 'Oracle Recruiting',
  smartrecruiters: 'SmartRecruiters',
};
/** Workday boards up to this size are paged through completely. */
const WORKDAY_FULL_LIST_MAX = 100;

/**
 * @typedef {object} CheckDeps
 * @property {import('./rules.js').Rules} rules
 * @property {ReturnType<import('./companies.js').buildCompanyIndex> | null} companies
 * @property {(ref: {ats: string, slug: string, region: string | null}) => Promise<import('./sources/index.js').Posting[]>} fetchPostings
 *   throws HttpError on failure
 * @property {(ref: {ats: string, slug: string, region: string | null}) => Promise<string | null>} [fetchBoardName]
 *   Greenhouse board display name, used to verify guessed slugs; null if the board does not exist
 * @property {(ref: {ats: string, slug: string, region: string | null}) => Promise<object | null>} [fetchFirstSeen]
 *   GhostCheck's first-seen file for the board; null if the board is not tracked
 * @property {(url: string) => Promise<string | null>} [fetchWayback]
 *   ISO date of the earliest Wayback Machine capture of a URL, or null
 * @property {(ref: object, searchText: string) => Promise<{ postings: import('./sources/index.js').Posting[], complete: boolean, total: number }>} [searchWorkday]
 *   Workday search; complete=true when the whole (small) board was listed
 * @property {(ref: object, externalPath: string) => Promise<import('./sources/index.js').Posting | null>} [fetchWorkdayDetail]
 *   one Workday posting; throws HttpError (isNotFound for removed postings)
 * @property {(origin: string) => Promise<boolean>} [hasOriginPermission]
 *   whether the user allowed GhostCheck to read this careers site
 * @property {(url: string) => Promise<{ status: number, ok: boolean, url: string, postings: object[],
 *   discovered?: ReturnType<import('./discover.js').discoverAts> }>} [fetchPageJobs]
 *   a careers page, the schema.org JobPostings in it and the ATS it links to
 * @property {(company: string) => Promise<{ id: string, url: string } | null>} [findCompanyWebsite]
 *   the company's official website (Wikidata), or null when unknown
 * @property {(site: object, query: string) => Promise<import('./sources/index.js').Posting[]>} [searchSite]
 *   a careers site's own job search (see sources/site-search.js)
 * @property {(origin: string) => Promise<Set<string> | null>} [fetchSitemapUrls]
 *   canonical URLs listed in the site's sitemaps, or null when there are none
 * @property {'english' | 'multilingual'} [semanticModel]   which local model `embed` runs
 * @property {(texts: string[]) => Promise<number[][] | null>} [embed]
 *   local sentence embeddings (normalized vectors); null while the model loads
 * @property {'en' | 'zh'} [lang]   language of reasons and notes (default English)
 * @property {() => Date} [now]
 */

/** Boards worth guessing from a company name: their API tells the board's company name. */
const GUESSES = [
  { ats: 'greenhouse', slugs: guessSlugs },
  { ats: 'workable', slugs: guessSlugs },
  // SmartRecruiters ids are usually the name in PascalCase ("BoschGroup").
  {
    ats: 'smartrecruiters',
    slugs: (name) => {
      const pascal = normalizeCompanyName(name).split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
      return pascal.length >= 2 ? [pascal, `${pascal}Group`] : [];
    },
  },
];

/** Name comparison for guesses: exact, but "Bosch Group" = "Bosch". */
const sameNameKey = (name) => normalizeCompanyName(name).replace(/\b(group|holdings?|global)\b/g, '').replace(/\s+/g, ' ').trim();

/**
 * @typedef {object} Outcome   what the official careers site says about the job
 * @property {'found' | 'closed' | 'not_found' | 'unknown'} status
 * @property {import('./sources/index.js').Posting | null} [posting]
 * @property {string | null} [officialUrl]
 * @property {string} [siteName]   e.g. "Greenhouse", or the careers site's host
 * @property {string | null} [reason]  why the status is unknown
 * @property {string[]} [notes]
 * @property {object} [action]     something the user can do (grant a permission)
 * @property {Record<string, unknown>} [detected]
 */

const unknown = (reason, extra = {}) => ({ status: 'unknown', reason, ...extra });

/**
 * Boards found along the way (a guessed slug, the company website from
 * Wikidata, a link on a careers page): they can confirm a job, but a missing
 * job is never counted, because the board might belong to another company
 * with the same name or hold only some of the company's jobs.
 */
const WEAK_SOURCES = new Set(['guess', 'website', 'careers_page']);

/**
 * Is the board in the job's language? A missing title can only count when it
 * is; otherwise the job may simply be listed under a translated title.
 * @returns {{ same: boolean, reason: string }}  reason: why "not found" can't count
 */
function languageCheck(job, postings, siteName, lang) {
  const { different, boardLang } = compareLanguages(job, postings);
  const same = different === null ? sameTitleLanguage(job.title, postings) : !different;
  const reason = boardLang && different
    ? t(lang, 'unknown.languageDiff', { ats: siteName, language: t(lang, `lang.${boardLang}`) })
    : t(lang, 'unknown.language', { ats: siteName });
  return { same, reason };
}

/**
 * A failure worth logging: GhostCheck shows ⚪ for it, and the page console
 * gets the technical details so users can report what went wrong.
 * @returns {{ step: string, kind: string, status: number | null, message: string }}
 */
export function describeError(step, err) {
  return {
    step,
    kind: err?.kind || err?.name || 'Error',
    status: err?.status ?? null,
    message: String(err?.message || err).slice(0, 300),
  };
}

function similarReason(match, lang) {
  const why = t(lang, ['level', 'location', 'title'].includes(match.mismatch) ? `why.${match.mismatch}` : 'why.other');
  return t(lang, 'unknown.similar', { title: match.posting.title, why });
}

function matchDetected(match) {
  const d = { matchStatus: match.status };
  if (match.posting) d.matchedTitle = `${match.posting.title}${match.posting.location ? ` (${match.posting.location})` : ''}`;
  if (match.status !== 'found' && match.status !== 'id_missing') d.closestScore = match.score;
  return d;
}

/**
 * Turn a match result into an outcome.
 * @param {boolean} canBeMissing  "not found" may count against the job
 */
function outcomeFromMatch(match, { siteName, boardUrl, canBeMissing, missingReason, notes, lang }) {
  const base = { siteName, officialUrl: boardUrl, notes, detected: matchDetected(match) };
  switch (match.status) {
    case 'found':
      return { ...base, status: 'found', posting: match.posting, officialUrl: match.posting.url || boardUrl };
    case 'id_missing':
      return { ...base, status: 'closed' };
    case 'similar':
      return { ...base, ...unknown(similarReason(match, lang)) };
    case 'unmatchable':
      return { ...base, ...unknown(t(lang, 'unknown.unmatchable')) };
    default:
      return canBeMissing ? { ...base, status: 'not_found' } : { ...base, ...unknown(missingReason) };
  }
}

/** Greenhouse, Lever, Ashby: the full list of open jobs is available. */
async function lookupListAts(job, board, deps, rules) {
  const { ref } = board;
  const siteName = ATS_NAMES[ref.ats];
  const source = SOURCES[ref.ats];
  const boardUrl = source.boardUrl(ref);
  let postings;
  try {
    postings = await deps.fetchPostings(ref);
  } catch (err) {
    if (!err?.isNotFound) deps.report?.(`${siteName} board "${ref.slug}"`, err);
    return unknown(
      err?.isNotFound
        ? t(deps.lang, 'unknown.boardMissing', { ats: siteName, slug: ref.slug })
        : t(deps.lang, 'unknown.unreachable', { ats: siteName }),
      { siteName, officialUrl: boardUrl },
    );
  }
  if (!postings.length) {
    return unknown(t(deps.lang, 'unknown.emptyBoard', { company: job.company || t(deps.lang, 'fallback.Company'), ats: siteName }), {
      siteName,
      officialUrl: boardUrl,
    });
  }
  let match = matchPosting(job, postings, ref, rules.matching);
  let semantic = null;
  if (deps.embed && rules.semantic?.enabled) {
    const model = deps.semanticModel === 'multilingual' ? 'multilingual' : 'english';
    const opts = { ...rules.semantic, ...rules.semantic.models?.[model], multilingual: model === 'multilingual' };
    ({ match, semantic } = await refineMatch(job, match, postings, deps.embed, opts));
  }
  // A board found by name might belong to another company with the same
  // name, and a title in another language may simply be a translation:
  // never count "not found" against the job in those cases.
  const language = languageCheck(job, postings, siteName, deps.lang);
  const outcome = outcomeFromMatch(match, {
    siteName,
    boardUrl,
    canBeMissing: !WEAK_SOURCES.has(board.source) && language.same,
    missingReason: !language.same ? language.reason : t(deps.lang, 'unknown.guessMissing', { ats: siteName, slug: ref.slug }),
    notes: [
      postings.length === 1
        ? t(deps.lang, 'note.checkedOne', { ats: siteName })
        : t(deps.lang, 'note.checked', { count: postings.length, ats: siteName }),
    ],
    lang: deps.lang,
  });
  // Across languages a "similar" title means little: the language is the point.
  if (!language.same && outcome.status === 'unknown') outcome.reason = language.reason;
  if (semantic) {
    const decision = t(deps.lang, `semantic.${semantic.decision}`);
    outcome.detected.descriptionMatch =
      semantic.runnerUp !== null
        ? t(deps.lang, 'semantic.detail', { similarity: semantic.similarity, runnerUp: semantic.runnerUp, decision })
        : t(deps.lang, 'semantic.detailSingle', { similarity: semantic.similarity, decision });
  }
  if (outcome.status === 'found' && match.via === 'description') {
    outcome.notes.unshift(t(deps.lang, 'note.byDescription', { title: match.posting.title }));
  }
  return outcome;
}

/**
 * Workday: look the posting up directly when the apply link names it,
 * otherwise search by title. Search results are not a full list, so "not
 * found" only counts for small boards that were listed completely.
 */
async function lookupWorkday(job, board, deps, rules) {
  const { ref } = board;
  if (!ref.workday?.apiBase) return unknown(t(deps.lang, 'unknown.workdaySite'));
  if (!deps.searchWorkday) return unknown(t(deps.lang, 'unknown.workdayUnsupported'));
  const base = { siteName: 'Workday', officialUrl: workday.boardUrl(ref) };

  if (ref.jobId && deps.fetchWorkdayDetail) {
    try {
      const posting = await deps.fetchWorkdayDetail(ref, ref.jobId);
      if (posting) return { ...base, status: 'found', posting, officialUrl: posting.url, detected: { matchStatus: 'found (apply link)' } };
    } catch (err) {
      if (err?.isNotFound) return { ...base, status: 'closed', detected: { matchStatus: 'apply link removed' } };
      // Other failures: fall back to searching.
      deps.report?.('Workday posting', err);
    }
  }

  let result;
  try {
    result = await deps.searchWorkday(ref, job.title);
  } catch (err) {
    deps.report?.('Workday search', err);
    return unknown(t(deps.lang, 'unknown.workdayUnreachable'), base);
  }
  // The apply-link id is deliberately not passed: a search result missing it
  // does not mean the posting was removed.
  const match = matchPosting(job, result.postings, {}, rules.matching);
  const language = languageCheck(job, result.postings, 'Workday', deps.lang);
  const outcome = outcomeFromMatch(match, {
    ...base,
    boardUrl: base.officialUrl,
    canBeMissing: result.complete && !WEAK_SOURCES.has(board.source) && language.same,
    missingReason: !language.same ? language.reason : t(deps.lang, 'unknown.workdayIncomplete'),
    notes: [t(deps.lang, result.complete ? 'note.workdayAll' : 'note.workdaySearched', { count: result.total })],
    lang: deps.lang,
  });

  if (!language.same && outcome.status === 'unknown') outcome.reason = language.reason;

  // Search results carry only a rough date and no description: fetch details.
  if (outcome.status === 'found' && deps.fetchWorkdayDetail) {
    try {
      const detail = await deps.fetchWorkdayDetail(ref, outcome.posting.id);
      if (detail) outcome.posting = { ...outcome.posting, ...detail, url: outcome.posting.url };
    } catch (err) {
      deps.report?.('Workday posting details', err); // keep the search result
    }
  }
  return outcome;
}

/** Regional entity words: "Federal Express Corporation AMEA", "Acme Asia Pacific". */
const REGION_WORDS =
  /\b(amea|emea|apac|apj|latam|americas|asia pacific|asia|europe|international|global|north america|japan|china|india|uk|usa|us)\b/g;
const stripRegion = (name) => name.replace(REGION_WORDS, ' ').replace(/\s+/g, ' ').trim();

/** Careers systems GhostCheck searches (no usable full-list call for large boards). */
const SEARCH_ATS = {
  oracle: { boardUrl: (ref) => oracleBoardUrl(ref.oracle) },
  smartrecruiters: { boardUrl: (ref) => smartRecruitersBoardUrl(ref.slug) },
};

/**
 * Oracle Recruiting and SmartRecruiters: the posting from the apply link by
 * id, otherwise a title search. Like Workday, only small boards are listed
 * completely, so only those can say "not found".
 */
async function lookupSearchAts(job, board, deps, rules) {
  const { ref } = board;
  const siteName = ATS_NAMES[ref.ats];
  if (!deps.searchAts) return unknown(t(deps.lang, 'ats.unsupported', { ats: siteName }));
  const base = { siteName, officialUrl: SEARCH_ATS[ref.ats].boardUrl(ref) };

  // Oracle's own cloud is in the manifest; a company domain needs the user's permission.
  if (ref.ats === 'oracle' && !/\.oraclecloud\.com$/i.test(new URL(ref.oracle.origin).hostname) && deps.hasOriginPermission) {
    const { origin } = ref.oracle;
    const host = new URL(origin).hostname;
    if (!(await deps.hasOriginPermission(origin).catch(() => false))) {
      return unknown(t(deps.lang, 'unknown.needPermission', { host }), {
        ...base,
        action: { type: 'grant-origin', origin, label: t(deps.lang, 'ui.allowSite', { host }), allLabel: t(deps.lang, 'ui.allowAll') },
      });
    }
  }

  let result;
  try {
    result = await deps.searchAts(ref, job.title);
  } catch (err) {
    deps.report?.(`${siteName} board ${ref.slug}`, err);
    return unknown(t(deps.lang, 'unknown.unreachable', { ats: siteName }), base);
  }
  // An empty answer may also mean a wrong company id: never evidence.
  if (!result.total) {
    return unknown(t(deps.lang, 'unknown.emptyBoard', { company: job.company || t(deps.lang, 'fallback.Company'), ats: siteName }), base);
  }

  if (ref.jobId && deps.fetchAtsPosting) {
    try {
      const posting = await deps.fetchAtsPosting(ref, ref.jobId);
      if (posting) return { ...base, status: 'found', posting, officialUrl: posting.url, detected: { matchStatus: 'found (apply link)' } };
      // The board answers (checked above) but no longer has this posting.
      return { ...base, status: 'closed', detected: { matchStatus: 'apply link removed' } };
    } catch (err) {
      deps.report?.(`${siteName} posting`, err);
    }
  }

  const match = matchPosting(job, result.postings, {}, rules.matching);
  const language = languageCheck(job, result.postings, siteName, deps.lang);
  const outcome = outcomeFromMatch(match, {
    ...base,
    boardUrl: base.officialUrl,
    canBeMissing: result.complete && !WEAK_SOURCES.has(board.source) && language.same,
    missingReason: !language.same ? language.reason : t(deps.lang, 'unknown.searchIncomplete', { ats: siteName }),
    notes: [t(deps.lang, result.complete ? 'note.checked' : 'note.searched', { count: result.total, ats: siteName })],
    lang: deps.lang,
  });
  if (!language.same && outcome.status === 'unknown') outcome.reason = language.reason;
  // Search results carry a short teaser only: fetch the full posting.
  if (outcome.status === 'found' && deps.fetchAtsPosting) {
    try {
      const detail = await deps.fetchAtsPosting(ref, outcome.posting.id);
      if (detail) outcome.posting = { ...outcome.posting, ...detail };
    } catch (err) {
      deps.report?.(`${siteName} posting details`, err);
    }
  }
  return outcome;
}

/** Same company, allowing legal suffixes, regional entities and "Acme" vs "Acme Robotics". */
export function sameCompany(a, b) {
  const x = stripRegion(normalizeCompanyName(a));
  const y = stripRegion(normalizeCompanyName(b));
  if (!x || !y) return true; // unknown organisation: do not reject
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}


/**
 * Ask a careers site's own job search (amazon.jobs, Phenom sites). Only a
 * found job counts: search results are never a complete list.
 * @returns {Promise<{ outcome: Outcome | null, searchPage: string }>}
 */
async function searchCareersSite(job, site, host, deps, rules) {
  const searchPage = site.kind === 'amazon' ? amazonSearchPage(job.title) : phenomSearchPage(site, job.title);
  const found = (posting) => ({
    outcome: {
      siteName: host,
      status: 'found',
      posting,
      officialUrl: posting.url || searchPage,
      notes: [t(deps.lang, 'note.siteSearch', { host })],
      detected: { matchStatus: 'found (site search)', matchedTitle: posting.title },
    },
    searchPage,
  });
  try {
    // The job id from the apply link is the surest match.
    if (site.jobId) {
      const byId = (await deps.searchSite(site, site.jobId)).find((p) => p.id === site.jobId);
      if (byId) return found(byId);
    }
    const match = matchPosting(job, await deps.searchSite(site, job.title), {}, rules.matching);
    if (match.status === 'found') return found(match.posting);
  } catch (err) {
    deps.report?.(`job search on ${host}`, err);
  }
  return { outcome: null, searchPage };
}


// ------------------------------------------------------------- all checks
//
// Every source that can know about the job is asked, and the answers are
// combined: one source that lists the job is enough to call it real. A
// missing job only counts when no source lists it and a source we trust to
// be complete (the apply link's ATS, or one from data/companies.json) says
// it is not there.

/**
 * @typedef {object} Check
 * @property {'jobBoard' | 'board' | 'page' | 'search' | 'sitemap'} kind
 * @property {string} label       shown in the card's checklist
 * @property {Outcome} outcome
 * @property {string} [source]    for boards: apply_link, companies, careers_page, website, guess
 * @property {string} [via]       for boards found on a page: that page's host
 */

const grantAction = (origin, lang) => {
  const host = new URL(origin).hostname;
  return { type: 'grant-origin', origin, label: t(lang, 'ui.allowSite', { host }), allLabel: t(lang, 'ui.allowAll') };
};

const boardLabel = (ref) =>
  ref.ats === 'workday' ? ref.workday?.publicBase || ref.slug : ref.ats === 'oracle' ? `${new URL(ref.oracle.origin).hostname}/${ref.oracle.site}` : ref.slug;
const boardKeyOf = (ref) => `${ref.ats}:${boardLabel(ref)}`.toLowerCase();

/** Ask one ATS board. */
async function checkBoard(job, board, deps, rules) {
  const { ref } = board;
  let outcome;
  if (ref.ats === 'workday') outcome = await lookupWorkday(job, board, deps, rules);
  else if (SEARCH_ATS[ref.ats]) outcome = await lookupSearchAts(job, board, deps, rules);
  else if (SOURCES[ref.ats]) outcome = await lookupListAts(job, board, deps, rules);
  else outcome = unknown(t(deps.lang, 'ats.unsupported', { ats: ATS_NAMES[ref.ats] }));
  if (board.via) {
    const how = board.website
      ? t(deps.lang, 'note.viaWebsite', { host: board.via, website: new URL(board.website).hostname })
      : t(deps.lang, 'note.usesAts', { host: board.via, ats: ATS_NAMES[ref.ats] });
    outcome.notes = [how, ...(outcome.notes || [])];
  }
  return {
    kind: 'board',
    label: t(deps.lang, 'check.board', { ats: ATS_NAMES[ref.ats], board: boardLabel(ref) }),
    outcome: { ...outcome, ref },
    source: board.source,
    via: board.via,
  };
}

/** The job's title among the texts a person reads on a page (title, headings, links). */
function titleOnPage(job, page, rules) {
  const candidates = (page.texts || []).map((title, i) => ({ id: `${page.url}#t${i}`, title, location: '', url: page.url, createdAt: null, text: '' }));
  if (!candidates.length) return null;
  const m = matchPosting({ title: job.title, location: '' }, candidates, {}, rules.matching);
  return m.status === 'found' ? m.posting : null;
}

/** Is this page the company's own? Its domain, its name, or its LinkedIn link says so. */
function pageIsCompanys(page, host, job) {
  if (hostMatchesCompany(host, job.company)) return true;
  if (job.linkedinCompanySlug && (page.linkedin || []).includes(job.linkedinCompanySlug.toLowerCase())) return true;
  const name = String(page.siteName || '').split(/\s+[|·•—–-]\s+/)[0];
  return !!name && normalizeCompanyName(name) !== '' && normalizeCompanyName(name) === normalizeCompanyName(job.company);
}

const toPostings = (page, fallbackUrl) =>
  (page.postings || []).map((p, i) => ({
    id: p.url || `${fallbackUrl}#${i}`,
    title: p.title,
    location: p.location,
    url: p.url && /^https:/.test(p.url) ? p.url : page.url,
    createdAt: p.datePosted,
    createdAtExact: true,
    updatedAt: null,
    department: null,
    salary: p.salary,
    text: p.text,
    orgName: p.orgName,
    validThrough: p.validThrough,
  }));

/**
 * Search a careers site through its own search form, or a common search URL.
 * A guessed URL may not be a search at all, so only a hit is reported there.
 */
async function searchByForm(job, page, host, deps, rules) {
  const guessed = !page.searchForm;
  const templates = guessed ? commonSearchUrls(page.url) : [page.searchForm];
  for (const template of templates) {
    const url = template.replace('{q}', encodeURIComponent(job.title));
    let results;
    try {
      results = await deps.fetchPageJobs(url);
    } catch {
      continue;
    }
    if (!results.ok) continue;
    const structured = matchPosting(job, toPostings(results, url), {}, rules.matching);
    const posting = structured.status === 'found' ? structured.posting : titleOnPage(job, results, rules);
    if (!posting && guessed) continue;
    return posting
      ? { siteName: host, status: 'found', posting, officialUrl: posting.url || url, notes: [t(deps.lang, 'note.siteSearch', { host })], detected: { matchStatus: 'found (site search)' } }
      : unknown(t(deps.lang, 'unknown.searchMissed', { host }), { siteName: host, officialUrl: url, linkLabel: t(deps.lang, 'ui.searchSite', { host }) });
  }
  return null;
}

/**
 * Read one page of a careers site: the apply page, or a careers page found
 * from the company name. Several checks come out of one page.
 * @param {'apply' | 'careers'} role
 * @returns {Promise<{ checks: Check[], refs: object[], page: object | null, blocked: string | null }>}
 */
async function checkPage(job, pageUrl, deps, rules, now, role) {
  const none = { checks: [], refs: [], page: null, blocked: null };
  let url;
  try {
    url = new URL(pageUrl);
  } catch {
    return none;
  }
  if (url.protocol !== 'https:' || isLinkedInHost(url.hostname) || !deps.fetchPageJobs || !deps.hasOriginPermission) return none;
  const host = url.hostname;
  const lang = deps.lang;
  const base = { siteName: host, officialUrl: url.origin };
  const pageLabel = t(lang, role === 'apply' ? 'check.applyPage' : 'check.careersPage', { host });
  const pageCheck = (outcome) => ({ kind: 'page', label: pageLabel, outcome });

  const allowed = await deps.hasOriginPermission(url.origin).catch((err) => {
    deps.report?.(`permission check for ${url.origin}`, err);
    return false;
  });
  if (!allowed) {
    if (role !== 'apply') return { ...none, blocked: url.origin };
    return { ...none, blocked: url.origin, checks: [pageCheck(unknown(t(lang, 'unknown.needPermission', { host }), { ...base, action: grantAction(url.origin, lang) }))] };
  }

  let page;
  try {
    page = await deps.fetchPageJobs(pageUrl);
  } catch (err) {
    if (role !== 'apply') return none; // most guessed careers hosts simply do not exist
    deps.report?.(`careers page ${pageUrl}`, err);
    return { ...none, checks: [pageCheck(unknown(t(lang, 'unknown.pageUnreachable', { host }), base))] };
  }
  if (role !== 'apply' && !page.ok) return none;
  if (page.status === 404 || page.status === 410) {
    return { ...none, checks: [pageCheck({ ...base, status: 'closed', detected: { matchStatus: `apply page returned ${page.status}` } })] };
  }
  if (!page.ok) return { ...none, checks: [pageCheck(unknown(t(lang, 'unknown.pageError', { host, status: page.status }), base))] };

  const pageHost = new URL(page.url).hostname;
  const ours = role === 'careers' || pageIsCompanys(page, pageHost, job);
  const generic = isGenericCareersUrl(pageUrl) || isGenericCareersUrl(page.url) || (page.postings || []).length > 1;
  const checks = [];

  // 1. The page itself: structured job data, else the title as a person reads it.
  const postings = toPostings(page, pageUrl);
  let content = null;
  if (postings.length) {
    const match = matchPosting(job, postings, {}, rules.matching);
    const outcome = outcomeFromMatch(match, {
      ...base,
      boardUrl: page.url,
      canBeMissing: false,
      missingReason: t(lang, generic ? 'unknown.genericPage' : 'unknown.pageOtherJob', { host, title: job.title }),
      notes: [t(lang, 'note.pageRead', { host })],
      lang,
    });
    if (outcome.status === 'found') {
      const p = outcome.posting;
      // The company's own domain is trusted whatever legal entity its pages name.
      if (p.orgName && !sameCompany(p.orgName, job.company) && !hostMatchesCompany(pageHost, job.company)) {
        content = unknown(t(lang, 'unknown.otherOrg', { host, org: p.orgName, company: job.company }), base);
      } else {
        if (p.validThrough && Date.parse(p.validThrough) < now.getTime()) outcome.notes.push(t(lang, 'note.pageClosed', { date: p.validThrough.slice(0, 10) }));
        content = outcome;
      }
    } else {
      content = outcome;
    }
  }
  if (content?.status !== 'found' && ours) {
    const posting = titleOnPage(job, page, rules);
    if (posting) {
      content = { ...base, status: 'found', posting, officialUrl: page.url, notes: [t(lang, 'note.titleOnPage', { host })], detected: { matchStatus: 'title on the page' } };
    }
  }
  const others = page.discovered?.unsupported || [];
  if (!content && role === 'apply') {
    content = generic
      ? unknown(t(lang, 'unknown.genericPage', { host, title: job.title }), { ...base, officialUrl: page.url, linkLabel: t(lang, 'ui.searchSite', { host }), detected: { matchStatus: 'general careers page' } })
      : others.length
        ? unknown(t(lang, 'unknown.unsupportedAts', { host, systems: others.join(' / ') }), { ...base, detected: { unsupportedAts: others.join(', ') } })
        : unknown(t(lang, 'unknown.noJobData', { host }), base);
  }
  if (content) checks.push(pageCheck(content));

  // 2. The site's own job search: a known search API, else its search form.
  if (deps.searchSite || deps.fetchPageJobs) {
    const site = amazonSite(page.url) || amazonSite(pageUrl) || page.siteSearch;
    let searched = null;
    if (site && deps.searchSite) {
      const r = await searchCareersSite(job, site, pageHost, deps, rules);
      searched =
        r.outcome ||
        unknown(t(lang, 'unknown.searchMissed', { host: pageHost }), { siteName: pageHost, officialUrl: r.searchPage, linkLabel: t(lang, 'ui.searchSite', { host: pageHost }) });
    } else if (ours && (generic || role === 'careers' || content?.status !== 'found')) {
      searched = await searchByForm(job, page, pageHost, deps, rules);
    }
    if (searched) checks.push({ kind: 'search', label: t(lang, 'check.search', { host: pageHost }), outcome: searched });
  }

  // 3. The site's sitemap lists the apply page.
  if (role === 'apply' && !generic && deps.fetchSitemapUrls) {
    const listed = await deps.fetchSitemapUrls(url.origin).catch((err) => {
      deps.report?.(`sitemap of ${url.origin}`, err);
      return null;
    });
    if (listed) {
      const inMap = [pageUrl, page.url].map(canonicalUrl).filter(Boolean).some((c) => listed.has(c));
      checks.push({
        kind: 'sitemap',
        label: t(lang, 'check.sitemap', { host }),
        outcome: inMap
          ? {
              ...base,
              status: 'found',
              posting: { id: page.url, title: job.title, location: '', url: page.url, createdAt: null, salary: null, text: '' },
              officialUrl: page.url,
              notes: [t(lang, 'note.inSitemap', { host })],
              detected: { matchStatus: 'listed in sitemap' },
            }
          : unknown(t(lang, 'unknown.notInSitemap', { host }), base),
      });
    }
  }

  // ATS boards the page links to or embeds: asked as well, but only to confirm.
  const refs = (page.discovered?.refs || []).slice(0, 2).map((r) => r.ref);
  return { checks, refs, page, host: pageHost, blocked: null };
}

/**
 * The company's own website, from Wikidata or, failing that, a domain guessed
 * from the name and confirmed by the site itself (it links to the company's
 * LinkedIn page, or names the company).
 * @returns {Promise<{ url: string, via: 'wikidata' | 'domain' } | null>}
 */
async function findWebsite(job, deps) {
  if (deps.findCompanyWebsite) {
    try {
      const site = await deps.findCompanyWebsite(job.company);
      if (site) return { url: site.url, via: 'wikidata' };
    } catch (err) {
      deps.report?.(`company website for "${job.company}" (Wikidata)`, err);
    }
  }
  if (!deps.fetchPageJobs || !deps.hasOriginPermission) return null;
  for (const domain of guessDomains(job.company)) {
    const origin = `https://${domain}`;
    if (!(await deps.hasOriginPermission(origin).catch(() => false))) continue;
    let page;
    try {
      page = await deps.fetchPageJobs(`${origin}/`);
    } catch {
      continue;
    }
    if (page.ok && pageIsCompanys({ ...page, siteName: page.siteName }, '', job)) return { url: page.url, via: 'domain' };
  }
  return null;
}

/** Careers pages of the company website: links on its home page, then the usual places. */
async function checkWebsite(job, deps, rules, now) {
  const empty = { checks: [], refs: [], website: null, blocked: null };
  if (!job.company) return empty;
  const site = await findWebsite(job, deps);
  if (!site) return empty;
  const candidates = [];
  if (deps.fetchPageJobs && (await deps.hasOriginPermission?.(new URL(site.url).origin).catch(() => false))) {
    const home = await deps.fetchPageJobs(site.url).catch(() => null);
    if (home?.ok) candidates.push(...(home.careersLinks || []));
  }
  candidates.push(...careersCandidates(site.url));
  let blocked = null;
  for (const candidate of [...new Set(candidates)].slice(0, 8)) {
    const r = await checkPage(job, candidate, deps, rules, now, 'careers');
    if (r.blocked) blocked ??= r.blocked;
    if (!r.page) continue;
    return { checks: r.checks, refs: r.refs, host: r.host, website: site.url, blocked: null, careersUrl: r.page.url };
  }
  return { ...empty, website: site.url, blocked };
}

/** Boards named after the company (Greenhouse, Workable, SmartRecruiters), confirmed by their own company name. */
async function guessBoards(job, deps) {
  if (!deps.fetchBoardName || !job.company) return [];
  const want = sameNameKey(job.company);
  const found = [];
  for (const { ats, slugs } of GUESSES) {
    for (const slug of slugs(job.company)) {
      const ref = { ats, slug, region: null, jobId: null };
      try {
        const name = await deps.fetchBoardName(ref);
        if (name && sameNameKey(name) === want) found.push(ref);
      } catch (err) {
        if (!err?.isNotFound) deps.report?.(`guess ${ATS_NAMES[ats]} board "${slug}"`, err);
      }
    }
  }
  return found;
}

/** Order in which "can't verify" reasons are worth showing first. */
const UNKNOWN_RANK = { jobBoard: 0, strongBoard: 1, search: 2, page: 3, board: 4, sitemap: 5 };
const rankOf = (c) => (c.kind === 'board' ? (WEAK_SOURCES.has(c.source) || c.source === 'careers_page' ? UNKNOWN_RANK.board : UNKNOWN_RANK.strongBoard) : UNKNOWN_RANK[c.kind] ?? 9);

/**
 * One job against every official source: all of them are asked, and any one
 * that lists the job makes it real.
 * @returns {Promise<{ checks: Check[], website: string | null, blocked: string | null }>}
 */
async function runChecks(job, applyUrl, jobBoard, deps, rules, now) {
  const lang = deps.lang;
  const checks = [];
  const asked = new Set();
  const askBoards = async (boards) => {
    const fresh = boards.filter((b) => b.ref && !asked.has(boardKeyOf(b.ref)));
    for (const b of fresh) asked.add(boardKeyOf(b.ref));
    checks.push(...(await Promise.all(fresh.map((b) => checkBoard(job, b, deps, rules)))));
  };

  if (jobBoard) {
    checks.push({ kind: 'jobBoard', label: t(lang, 'check.jobBoard', { site: jobBoardName(jobBoard, lang) }), outcome: unknown(t(lang, 'unknown.jobBoard', { site: jobBoardName(jobBoard, lang), company: job.company || t(lang, 'fallback.company') })) });
  }

  // Boards known for sure: the apply link's, and the one in data/companies.json.
  const fromLink = detectAts(applyUrl);
  const entry = lookupCompany(deps.companies, job);
  const known = [];
  if (fromLink?.slug) known.push({ ref: fromLink, source: 'apply_link' });
  if (entry) {
    known.push({
      ref: {
        ats: entry.ats,
        slug: entry.slug,
        region: entry.region,
        jobId: fromLink && fromLink.ats === entry.ats ? fromLink.jobId : null,
        ...(entry.workday ? { workday: entry.workday } : {}),
        ...(entry.oracle ? { oracle: entry.oracle } : {}),
      },
      source: 'companies',
    });
  }
  if (fromLink && !fromLink.slug && !entry) {
    checks.push({ kind: 'board', label: ATS_NAMES[fromLink.ats], source: 'apply_link', outcome: unknown(t(lang, 'ats.notInList', { ats: ATS_NAMES[fromLink.ats] })) });
  }

  // Everything that does not depend on another answer runs at once.
  const pageTask = applyUrl && !jobBoard && !fromLink?.slug ? checkPage(job, applyUrl, deps, rules, now, 'apply') : Promise.resolve(null);
  const websiteTask = checkWebsite(job, deps, rules, now);
  const guessTask = known.length ? Promise.resolve([]) : guessBoards(job, deps);
  const [, page, website, guessed] = await Promise.all([askBoards(known), pageTask, websiteTask, guessTask]);

  if (page) checks.push(...page.checks);
  checks.push(...website.checks);
  // Boards found along the way can confirm the job, never count it missing.
  await askBoards([
    ...(page?.refs || []).map((ref) => ({ ref, source: 'careers_page', via: page.host })),
    ...website.refs.map((ref) => ({ ref, source: 'website', via: website.host, website: website.website })),
    ...guessed.map((ref) => ({ ref, source: 'guess' })),
  ]);
  return { checks, website: website.website, careersUrl: website.careersUrl || null, blocked: page?.blocked || website.blocked || null };
}

/** Combine the checks: found anywhere beats everything; "missing" needs a trusted complete source. */
function combineChecks(checks) {
  const first = (status) => checks.find((c) => c.outcome.status === status);
  const primary =
    first('found') ||
    first('closed') ||
    first('not_found') ||
    [...checks].filter((c) => c.outcome.status === 'unknown').sort((a, b) => rankOf(a) - rankOf(b))[0] ||
    null;
  return { primary, action: checks.find((c) => c.outcome.action)?.outcome.action ?? null };
}

const CHECK_STATUS = { found: 'found', closed: 'closed', not_found: 'missing', unknown: 'unknown' };

/** The card's checklist: every source, what it said. */
function checklist(checks) {
  return checks.map((c) => ({
    label: c.label,
    status: c.outcome.action ? 'skipped' : CHECK_STATUS[c.outcome.status] || 'unknown',
    detail: c.outcome.status === 'unknown' ? c.outcome.reason || '' : c.outcome.notes?.[0] || '',
  }));
}

/**
 * When each source says the job was posted. Compared to catch a job shown as
 * new in one place and long open in another.
 * @returns {Promise<Array<{ label: string, date: string, exact: boolean, kind: 'ats' | 'snapshot' | 'wayback' | 'linkedin' }>>}
 */
async function gatherDates(job, checks, primary, deps, now, lang) {
  const dates = [];
  for (const c of checks) {
    const p = c.outcome.status === 'found' ? c.outcome.posting : null;
    if (p?.createdAt) dates.push({ label: c.label, date: p.createdAt, exact: p.createdAtExact !== false, kind: 'ats' });
  }
  const onLinkedIn = parseLinkedInPosted(job.metaText);
  if (onLinkedIn) {
    dates.push({ label: t(lang, onLinkedIn.reposted ? 'date.linkedinReposted' : 'date.linkedin'), date: new Date(now.getTime() - onLinkedIn.days * 86400000).toISOString(), exact: false, kind: 'linkedin' });
  }
  const posting = primary?.outcome.status === 'found' ? primary.outcome.posting : null;
  const ref = primary?.outcome.ref;
  const tasks = [];
  if (posting && deps.fetchFirstSeen && ref && SOURCES[ref.ats]) {
    tasks.push(
      deps.fetchFirstSeen(ref).then((snap) => {
        const seen = lookupFirstSeen(snap, posting.id);
        if (seen) dates.push({ label: t(lang, 'age.snapshot'), date: `${seen.date}T00:00:00.000Z`, exact: seen.exact, kind: 'snapshot' });
      }),
    );
  }
  if (deps.fetchWayback) {
    const urls = [...new Set([...(posting?.url ? [posting.url] : []), linkedinJobUrl(job.jobId)].filter(Boolean))];
    for (const url of urls) {
      tasks.push(
        deps.fetchWayback(url).then((date) => {
          if (date) dates.push({ label: t(lang, 'age.wayback'), date, exact: false, kind: 'wayback' });
        }),
      );
    }
  }
  for (const r of await Promise.allSettled(tasks)) {
    if (r.status === 'rejected') deps.report?.('job age lookup', r.reason);
  }
  return dates.filter((d) => !Number.isNaN(Date.parse(d.date)));
}

/**
 * @param {object} job  sanitized job from the content script
 * @param {CheckDeps} deps
 * @returns {Promise<import('./result.js').CheckResult>}
 */
export async function checkJob(job, deps) {
  const errors = [];
  deps = { ...deps, report: (step, err) => errors.push(describeError(step, err)) };
  const { rules } = deps;
  const now = deps.now ? deps.now() : new Date();
  const applyUrl = resolveApplyUrl(job.applyHref);
  const lang = deps.lang || 'en';
  deps.lang = lang;

  const detected = {
    company: job.company,
    title: job.title,
    location: job.location || null,
    applyType: job.applyType,
    applyUrl,
    salaryText: job.salaryText || null,
    descriptionChars: (job.description || '').length,
    linkedinCompanySlug: job.linkedinCompanySlug || null,
  };

  // Description signals do not depend on the network.
  const salary = detectSalary(job.description, job.salaryText);
  const team = detectSpecificTeam(job.description);
  const template = detectGenericTemplate(job.description);

  /** @type {Record<string, boolean | null>} */
  const signals = {
    found_on_official_site: null,
    not_found_on_official_site: null,
    apply_link_closed: null,
    posted_recently: null,
    posted_long_ago: null,
    salary_listed: salary.value,
    specific_team: team.value,
    generic_template: template.value,
    reposted_to_look_new: null,
  };
  const vars = {
    company: job.company || t(lang, 'fallback.company'),
    salary: salary.detail,
    team: team.detail,
    phrase: template.detail,
  };

  // A job board or agency is not the company's careers site: never read it as one.
  const jobBoard = applyUrl ? detectJobBoard(applyUrl, job.company) : null;
  if (jobBoard) detected.jobBoard = jobBoardName(jobBoard, lang);

  // 1. Ask every official source, then combine.
  const run = await runChecks(job, applyUrl, jobBoard, deps, rules, now);
  const { checks } = run;
  const combined = combineChecks(checks);
  const { primary } = combined;
  let { action } = combined;
  const outcome = primary?.outcome || unknown(t(lang, job.applyType === 'easy' ? 'unknown.easyApply' : 'unknown.noSite'));
  if (run.website) detected.website = run.website;
  Object.assign(detected, outcome.detected || {});
  if (outcome.ref) {
    detected.ats = ATS_NAMES[outcome.ref.ats];
    detected.board = boardLabel(outcome.ref);
    detected.boardSource = t(
      lang,
      { apply_link: 'source.applyLink', companies: 'source.companies', guess: 'source.guess', careers_page: 'source.page', website: 'source.website' }[primary.source] || 'source.page',
      { host: primary.via || (run.website ? new URL(run.website).hostname : outcome.siteName) },
    );
  } else if (primary && primary.kind !== 'jobBoard' && outcome.siteName) {
    detected.ats = t(lang, 'ats.careersPage', { host: outcome.siteName });
  }
  vars.ats = outcome.siteName || t(lang, 'fallback.site');
  const notes = [...(outcome.notes || [])];
  if (jobBoard && outcome.status !== 'unknown') notes.unshift(t(lang, 'note.jobBoard', { site: detected.jobBoard, company: vars.company }));
  // The careers site is known but not allowed yet: offer to allow it.
  if (!checks.some((c) => c.outcome.status === 'found') && run.blocked && !action) {
    notes.push(t(lang, 'note.websiteNeedsPermission', { host: new URL(run.blocked).hostname }));
    action = grantAction(run.blocked, lang);
  }

  // 2. Turn the combined answer into signals.
  if (outcome.status === 'found') {
    const posting = outcome.posting;
    signals.found_on_official_site = true;
    signals.not_found_on_official_site = false;
    signals.apply_link_closed = false;
    vars.matchedTitle = posting.title;
    if (checks.some((c) => c.outcome.status === 'closed')) notes.unshift(t(lang, 'note.linkClosedButFound'));
    // Found, but published in another language: worth telling the user.
    const jobLang = detectLanguage(`${job.title}\n${String(job.description || '').slice(0, 4000)}`);
    const postLang = postingLanguage(posting);
    if (jobLang && postLang && jobLang !== postLang) notes.unshift(t(lang, 'note.languageDiff', { language: t(lang, `lang.${postLang}`) }));
    if (!salary.value) {
      // An official posting may state pay even when LinkedIn does not.
      for (const c of checks) {
        const p = c.outcome.status === 'found' ? c.outcome.posting : null;
        const official = p?.salary ? { value: true, detail: p.salary } : detectSalary(p?.text);
        if (official.value) {
          signals.salary_listed = true;
          vars.salary = official.detail;
          break;
        }
      }
    }
  } else if (outcome.status === 'closed') {
    signals.found_on_official_site = false;
    signals.apply_link_closed = true;
  } else if (outcome.status === 'not_found') {
    signals.found_on_official_site = false;
    signals.not_found_on_official_site = true;
  }

  // 3. Dates from every source: the job's age, and how far the sources disagree.
  const dates = await gatherDates(job, checks, primary, deps, now, lang);
  const daysOf = (d) => Math.max(0, Math.floor((now.getTime() - Date.parse(d.date)) / 86400000));
  if (outcome.status === 'found') {
    const age = combineAge(dates.filter((d) => d.kind !== 'linkedin').map((d) => ({ date: d.date, exact: d.exact, source: d.kind, label: d.label })), now);
    if (age) {
      const a = ageSignals(age, rules.age);
      signals.posted_recently = a.posted_recently;
      signals.posted_long_ago = a.posted_long_ago;
      vars.days = age.days;
      vars.ageSource = age.oldest.label;
      detected.firstSeen = `${age.oldest.date.slice(0, 10)} (${vars.ageSource})`;
    }
  }
  if (dates.length >= 2) {
    const fresh = dates.filter((d) => d.kind === 'ats' || d.kind === 'linkedin');
    const newest = fresh.length ? fresh.reduce((a, b) => (daysOf(b) < daysOf(a) ? b : a)) : null;
    const oldest = dates.reduce((a, b) => (daysOf(b) > daysOf(a) ? b : a));
    if (newest && newest !== oldest) {
      const gap = daysOf(oldest) - daysOf(newest);
      signals.reposted_to_look_new = daysOf(newest) <= rules.age.recent_days && daysOf(oldest) > rules.age.old_days && gap >= rules.age.date_gap_days;
      Object.assign(vars, { newestSource: newest.label, newestDays: daysOf(newest), oldestSource: oldest.label, oldestDays: daysOf(oldest) });
    }
  }

  if (signals.salary_listed === false) notes.push(t(lang, 'note.noPay'));

  const verdict = evaluate(rules, signals, { vars, notes, unknownReason: outcome.status === 'unknown' ? outcome.reason ?? null : null, lang });
  const foundUrl = outcome.status === 'found' ? outcome.officialUrl ?? outcome.posting?.url : null;
  return makeResult(verdict.badge, lang, {
    score: verdict.score,
    reasons: verdict.reasons,
    officialUrl: foundUrl ?? outcome.officialUrl ?? null,
    officialLabel: outcome.linkLabel || t(lang, signals.found_on_official_site ? 'ui.viewJob' : 'ui.viewBoard'),
    action: outcome.status === 'found' ? null : action,
    detected,
    signals,
    checks: checklist(checks),
    dates: dates
      .map((d) => ({ source: d.label, date: d.date.slice(0, 10), days: daysOf(d) }))
      .sort((a, b) => a.days - b.days)
      .filter((d, i, all) => all.findIndex((x) => x.source === d.source) === i),
    ...(errors.length ? { errors } : {}),
  });
}
