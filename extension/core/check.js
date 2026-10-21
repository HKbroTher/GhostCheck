/**
 * Turn a LinkedIn job into a verdict. Network access is injected through
 * `deps` so the same logic runs in the service worker and in tests.
 */
import { resolveApplyUrl, isLinkedInHost } from './apply-url.js';
import { detectAts } from './ats.js';
import { lookupCompany, guessSlugs, normalizeCompanyName } from './companies.js';
import { matchPosting } from './matcher.js';
import { sameTitleLanguage } from './normalize.js';
import { detectJobBoard, jobBoardName } from './job-boards.js';
import { compareLanguages, detectLanguage, postingLanguage } from './language.js';
import { isGenericCareersUrl } from './careers-page.js';
import { amazonSearchPage, amazonSite, phenomSearchPage } from './sources/site-search.js';
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

const ATS_NAMES = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday', workable: 'Workable' };
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

/**
 * Work out which board to check and how much we trust that it belongs to
 * this company.
 * @returns {Promise<{ ref: object | null, source: 'apply_link' | 'companies' | 'guess' | null, note: string | null }>}
 */
async function resolveBoard(job, applyUrl, deps) {
  const fromLink = detectAts(applyUrl);
  const entry = lookupCompany(deps.companies, job);

  if (fromLink?.slug) return { ref: fromLink, source: 'apply_link', note: null };

  if (entry && (!fromLink || fromLink.ats === entry.ats)) {
    return {
      ref: {
        ats: entry.ats,
        slug: entry.slug,
        region: entry.region,
        jobId: fromLink?.jobId ?? null,
        ...(entry.workday ? { workday: entry.workday } : {}),
      },
      source: 'companies',
      note: null,
    };
  }
  if (fromLink) return { ref: null, source: null, note: t(deps.lang, 'ats.notInList', { ats: ATS_NAMES[fromLink.ats] }) };

  // Last resort: guess a Greenhouse board from the company name, and accept it
  // only if the board's own name is the same company.
  if (deps.fetchBoardName && job.company) {
    const want = normalizeCompanyName(job.company);
    for (const slug of guessSlugs(job.company)) {
      let name = null;
      try {
        name = await deps.fetchBoardName({ ats: 'greenhouse', slug, region: null });
      } catch (err) {
        // Most guesses do not exist; only real failures are worth logging.
        if (!err?.isNotFound) deps.report?.(`guess Greenhouse board "${slug}"`, err);
        continue; // failures are not evidence of anything
      }
      if (name && normalizeCompanyName(name) === want) {
        return { ref: { ats: 'greenhouse', slug, region: null, jobId: null }, source: 'guess', note: null };
      }
    }
  }
  return { ref: null, source: null, note: null };
}

/**
 * Collect first-posted evidence for a matched posting. Every source is
 * optional and failures are ignored: missing evidence is never negative.
 * @returns {Promise<import('./age.js').AgeEvidence[]>}
 */
async function gatherAgeEvidence(job, ref, posting, deps) {
  const evidence = [];
  if (posting.createdAt) evidence.push({ date: posting.createdAt, exact: posting.createdAtExact !== false, source: 'ats' });

  const tasks = [];
  if (deps.fetchFirstSeen && ref && SOURCES[ref.ats]) {
    tasks.push(
      deps.fetchFirstSeen(ref).then((snap) => {
        const seen = lookupFirstSeen(snap, posting.id);
        if (seen) evidence.push({ date: `${seen.date}T00:00:00.000Z`, exact: seen.exact, source: 'snapshot' });
      }),
    );
  }
  if (deps.fetchWayback) {
    for (const url of [posting.url, linkedinJobUrl(job.jobId)].filter(Boolean)) {
      tasks.push(
        deps.fetchWayback(url).then((date) => {
          if (date) evidence.push({ date, exact: false, source: 'wayback' });
        }),
      );
    }
  }
  for (const r of await Promise.allSettled(tasks)) {
    if (r.status === 'rejected') deps.report?.('job age lookup', r.reason);
  }
  return evidence;
}

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
    canBeMissing: board.source !== 'guess' && language.same,
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
    canBeMissing: result.complete && board.source !== 'guess' && language.same,
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

/** Same company, allowing legal suffixes, regional entities and "Acme" vs "Acme Robotics". */
export function sameCompany(a, b) {
  const x = stripRegion(normalizeCompanyName(a));
  const y = stripRegion(normalizeCompanyName(b));
  if (!x || !y) return true; // unknown organisation: do not reject
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
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

/**
 * A company's own careers page: schema.org JobPosting (JSON-LD), the site's
 * job search, the ATS it links to, then its sitemap. Pages can confirm a job
 * or show the link is dead; they can never show a job is missing, because
 * there is no complete list to compare.
 */
async function lookupSelfHosted(job, applyUrl, deps, rules, now) {
  let url;
  try {
    url = new URL(applyUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || isLinkedInHost(url.hostname) || !deps.fetchPageJobs || !deps.hasOriginPermission) return null;
  const host = url.hostname;
  const base = { siteName: host, officialUrl: url.origin };

  const allowed = await deps.hasOriginPermission(url.origin).catch((err) => {
    deps.report?.(`permission check for ${url.origin}`, err);
    return false;
  });
  if (!allowed) {
    return unknown(t(deps.lang, 'unknown.needPermission', { host }), {
      ...base,
      action: {
        type: 'grant-origin',
        origin: url.origin,
        label: t(deps.lang, 'ui.allowSite', { host }),
        allLabel: t(deps.lang, 'ui.allowAll'),
      },
    });
  }

  let page;
  try {
    page = await deps.fetchPageJobs(applyUrl);
  } catch (err) {
    deps.report?.(`careers page ${applyUrl}`, err);
    return unknown(t(deps.lang, 'unknown.pageUnreachable', { host }), base);
  }
  if (page.status === 404 || page.status === 410) {
    return { ...base, status: 'closed', detected: { matchStatus: `apply page returned ${page.status}` } };
  }
  if (!page.ok) return unknown(t(deps.lang, 'unknown.pageError', { host, status: page.status }), base);

  const postings = page.postings.map((p, i) => ({
    id: p.url || `${applyUrl}#${i}`,
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

  let structured = null;
  if (postings.length) {
    const match = matchPosting(job, postings, {}, rules.matching);
    const outcome = outcomeFromMatch(match, {
      ...base,
      boardUrl: page.url,
      canBeMissing: false,
      missingReason: t(deps.lang, 'unknown.pageOtherJob', { host }),
      notes: [t(deps.lang, 'note.pageRead', { host })],
      lang: deps.lang,
    });
    if (outcome.status === 'found') {
      const p = outcome.posting;
      // The company's own domain is trusted whatever legal entity its pages name.
      if (p.orgName && !sameCompany(p.orgName, job.company) && !hostMatchesCompany(host, job.company)) {
        return unknown(t(deps.lang, 'unknown.otherOrg', { host, org: p.orgName, company: job.company }), base);
      }
      if (p.validThrough && Date.parse(p.validThrough) < now.getTime()) {
        outcome.notes.push(t(deps.lang, 'note.pageClosed', { date: p.validThrough.slice(0, 10) }));
      }
      return outcome;
    }
    structured = outcome; // inconclusive; the ATS behind the page may know more
  }

  // The site's own job search, when it has one we can ask.
  let searchPage = null;
  const site = amazonSite(page.url) || amazonSite(applyUrl) || page.siteSearch;
  if (site && deps.searchSite) {
    const searched = await searchCareersSite(job, site, host, deps, rules);
    if (searched.outcome) return searched.outcome;
    searchPage = searched.searchPage;
  }

  // The page links to or embeds an ATS we can query: ask it directly.
  const discovered = page.discovered?.refs?.[0]?.ref;
  if (discovered) {
    const board = { ref: discovered, source: 'careers_page' };
    let outcome = null;
    if (discovered.ats === 'workday') outcome = await lookupWorkday(job, board, deps, rules);
    else if (SOURCES[discovered.ats]) outcome = await lookupListAts(job, board, deps, rules);
    if (outcome) {
      outcome.notes = [t(deps.lang, 'note.usesAts', { host, ats: ATS_NAMES[discovered.ats] }), ...(outcome.notes || [])];
      return { ...outcome, ref: discovered, viaPage: host };
    }
  }

  // No structured data: is the page at least listed in the site's sitemap?
  if (deps.fetchSitemapUrls) {
    const listed = await deps.fetchSitemapUrls(url.origin).catch((err) => {
      deps.report?.(`sitemap of ${url.origin}`, err);
      return null;
    });
    const candidates = [applyUrl, page.url].map(canonicalUrl).filter(Boolean);
    if (listed && candidates.some((c) => listed.has(c))) {
      return {
        ...base,
        status: 'found',
        posting: { id: page.url, title: job.title, location: '', url: page.url, createdAt: null, salary: null, text: '' },
        officialUrl: page.url,
        notes: [t(deps.lang, 'note.inSitemap', { host })],
        detected: { matchStatus: 'listed in sitemap' },
      };
    }
  }
  // A general careers or search page: the job isn't on it, and that means nothing.
  const generic = isGenericCareersUrl(applyUrl) || isGenericCareersUrl(page.url) || page.postings.length > 1;
  if (searchPage || generic) {
    return unknown(t(deps.lang, searchPage ? 'unknown.searchMissed' : 'unknown.genericPage', { host, title: job.title }), {
      ...base,
      officialUrl: searchPage || page.url,
      linkLabel: t(deps.lang, 'ui.searchSite', { host }),
      detected: { matchStatus: searchPage ? 'not in site search results' : 'general careers page' },
    });
  }
  if (structured) return structured;
  const others = page.discovered?.unsupported || [];
  if (others.length) {
    return unknown(t(deps.lang, 'unknown.unsupportedAts', { host, systems: others.join(' / ') }), {
      ...base,
      detected: { unsupportedAts: others.join(', ') },
    });
  }
  return unknown(t(deps.lang, 'unknown.noJobData', { host }), base);
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
  const lang = deps.lang || 'en';
  const vars = {
    company: job.company || t(lang, 'fallback.company'),
    salary: salary.detail,
    team: team.detail,
    phrase: template.detail,
  };

  // A job board or agency is not the company's careers site: never read it
  // as one. The company may still be found through data/companies.json.
  const jobBoard = applyUrl ? detectJobBoard(applyUrl, job.company) : null;
  if (jobBoard) detected.jobBoard = jobBoardName(jobBoard, lang);

  // 1. Find the official source and ask it about this job.
  const board = await resolveBoard(job, applyUrl, deps);
  /** @type {Outcome | null} */
  let outcome = null;
  if (board.ref) {
    detected.ats = ATS_NAMES[board.ref.ats];
    detected.board = board.ref.ats === 'workday' ? board.ref.workday?.publicBase : board.ref.slug;
    detected.boardSource = t(lang, { apply_link: 'source.applyLink', companies: 'source.companies', guess: 'source.guess' }[board.source]);
    if (board.ref.ats === 'workday') outcome = await lookupWorkday(job, board, deps, rules);
    else if (SOURCES[board.ref.ats]) outcome = await lookupListAts(job, board, deps, rules);
    else outcome = unknown(t(lang, 'ats.unsupported', { ats: ATS_NAMES[board.ref.ats] }));
  } else if (jobBoard) {
    outcome = unknown(t(lang, 'unknown.jobBoard', { site: detected.jobBoard, company: vars.company }));
  } else if (applyUrl) {
    outcome = await lookupSelfHosted(job, applyUrl, deps, rules, now);
    if (outcome?.viaPage) {
      detected.ats = ATS_NAMES[outcome.ref.ats];
      detected.board = outcome.ref.ats === 'workday' ? outcome.ref.workday?.publicBase : outcome.ref.slug;
      detected.boardSource = t(lang, 'source.page', { host: outcome.viaPage });
    } else if (outcome) {
      detected.ats = t(lang, 'ats.careersPage', { host: outcome.siteName });
    }
  }
  if (!outcome) {
    outcome = unknown(
      board.note ||
        t(lang, job.applyType === 'easy' ? 'unknown.easyApply' : 'unknown.noSite'),
    );
  }
  Object.assign(detected, outcome.detected || {});
  vars.ats = outcome.siteName || t(lang, 'fallback.site');
  const notes = [...(outcome.notes || [])];
  if (jobBoard && board.ref) notes.unshift(t(lang, 'note.jobBoard', { site: detected.jobBoard, company: vars.company }));

  // 2. Turn the outcome into signals.
  if (outcome.status === 'found') {
    const posting = outcome.posting;
    signals.found_on_official_site = true;
    signals.not_found_on_official_site = false;
    signals.apply_link_closed = false;
    vars.matchedTitle = posting.title;
    // Found, but published in another language: worth telling the user.
    const jobLang = detectLanguage(`${job.title}\n${String(job.description || '').slice(0, 4000)}`);
    const postLang = postingLanguage(posting);
    if (jobLang && postLang && jobLang !== postLang) notes.unshift(t(lang, 'note.languageDiff', { language: t(lang, `lang.${postLang}`) }));
    if (!salary.value) {
      // The official posting may state pay even when LinkedIn does not.
      const official = posting.salary ? { value: true, detail: posting.salary } : detectSalary(posting.text);
      if (official.value) {
        signals.salary_listed = true;
        vars.salary = official.detail;
      }
    }
    const age = combineAge(await gatherAgeEvidence(job, outcome.ref ?? board.ref, posting, deps), now);
    if (age) {
      const a = ageSignals(age, rules.age);
      signals.posted_recently = a.posted_recently;
      signals.posted_long_ago = a.posted_long_ago;
      vars.days = age.days;
      vars.ageSource = t(lang, `age.${age.oldest.source}`);
      detected.firstSeen = `${age.oldest.date.slice(0, 10)} (${vars.ageSource})`;
      // Only judged when the careers site gives its own date to compare.
      signals.reposted_to_look_new = age.atsDays === null ? null : a.refreshed;
      vars.atsDays = age.atsDays;
    }
  } else if (outcome.status === 'closed') {
    signals.found_on_official_site = false;
    signals.apply_link_closed = true;
  } else if (outcome.status === 'not_found') {
    signals.found_on_official_site = false;
    signals.not_found_on_official_site = true;
  }

  if (signals.salary_listed === false) notes.push(t(lang, 'note.noPay'));

  const verdict = evaluate(rules, signals, { vars, notes, unknownReason: outcome.reason ?? null, lang });
  return makeResult(verdict.badge, lang, {
    score: verdict.score,
    reasons: verdict.reasons,
    officialUrl: outcome.officialUrl ?? null,
    officialLabel: outcome.linkLabel || t(lang, signals.found_on_official_site ? 'ui.viewJob' : 'ui.viewBoard'),
    action: outcome.action ?? null,
    detected,
    signals,
    ...(errors.length ? { errors } : {}),
  });
}
