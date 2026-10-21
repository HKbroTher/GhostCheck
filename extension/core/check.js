/**
 * Turn a LinkedIn job into a verdict. Network access is injected through
 * `deps` so the same logic runs in the service worker and in tests.
 */
import { resolveApplyUrl, isLinkedInHost } from './apply-url.js';
import { detectAts } from './ats.js';
import { lookupCompany, guessSlugs, normalizeCompanyName } from './companies.js';
import { matchPosting } from './matcher.js';
import { detectSalary, detectSpecificTeam, detectGenericTemplate } from './jd.js';
import { evaluate } from './rules.js';
import { makeResult } from './result.js';
import { SOURCES } from './sources/index.js';
import { lookupFirstSeen } from './snapshot.js';
import { linkedinJobUrl } from './wayback.js';
import { combineAge, ageSignals, AGE_SOURCE_LABELS } from './age.js';
import { workday } from './sources/workday.js';
import { canonicalUrl } from './sitemap.js';
import { refineMatch } from './semantic.js';

const ATS_NAMES = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday' };
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
 * @property {(url: string) => Promise<{ status: number, ok: boolean, url: string, postings: object[] }>} [fetchPageJobs]
 *   a careers page and the schema.org JobPostings found in it
 * @property {(origin: string) => Promise<Set<string> | null>} [fetchSitemapUrls]
 *   canonical URLs listed in the site's sitemaps, or null when there are none
 * @property {(texts: string[]) => Promise<number[][] | null>} [embed]
 *   local sentence embeddings (normalized vectors); null while the model loads
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
  if (fromLink) return { ref: null, source: null, note: `${ATS_NAMES[fromLink.ats]} board for this company is not in GhostCheck's list yet.` };

  // Last resort: guess a Greenhouse board from the company name, and accept it
  // only if the board's own name is the same company.
  if (deps.fetchBoardName && job.company) {
    const want = normalizeCompanyName(job.company);
    for (const slug of guessSlugs(job.company)) {
      let name = null;
      try {
        name = await deps.fetchBoardName({ ats: 'greenhouse', slug, region: null });
      } catch {
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
  await Promise.allSettled(tasks);
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

function similarReason(match) {
  const why = { level: 'a different seniority level', location: 'a different location', title: 'a somewhat different title' }[match.mismatch];
  return `A similar job is listed ("${match.posting.title}"), but with ${why || 'differences'}, so we can't be sure it's the same one.`;
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
function outcomeFromMatch(match, { siteName, boardUrl, canBeMissing, missingReason, notes }) {
  const base = { siteName, officialUrl: boardUrl, notes, detected: matchDetected(match) };
  switch (match.status) {
    case 'found':
      return { ...base, status: 'found', posting: match.posting, officialUrl: match.posting.url || boardUrl };
    case 'id_missing':
      return { ...base, status: 'closed' };
    case 'similar':
      return { ...base, ...unknown(similarReason(match)) };
    case 'unmatchable':
      return { ...base, ...unknown("We couldn't compare this job title with the careers site.") };
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
    return unknown(
      err?.isNotFound
        ? `The ${siteName} board "${ref.slug}" was not found; the company may have moved.`
        : `We couldn't reach ${siteName} right now. This is not evidence against the job.`,
      { siteName, officialUrl: boardUrl },
    );
  }
  if (!postings.length) {
    return unknown(`${job.company || 'The company'}'s ${siteName} board lists no open jobs, so we can't compare.`, {
      siteName,
      officialUrl: boardUrl,
    });
  }
  let match = matchPosting(job, postings, ref, rules.matching);
  let semantic = null;
  if (deps.embed && rules.semantic?.enabled) {
    ({ match, semantic } = await refineMatch(job, match, postings, deps.embed, rules.semantic));
  }
  const outcome = outcomeFromMatch(match, {
    siteName,
    boardUrl,
    // A board found by name might belong to another company with the same
    // name: never count "not found" against the job in that case.
    canBeMissing: board.source !== 'guess',
    missingReason: `We couldn't find this job on a ${siteName} board named "${ref.slug}", but we're not sure that board belongs to this company.`,
    notes: [`Checked ${postings.length} open job${postings.length === 1 ? '' : 's'} on ${siteName}.`],
  });
  if (semantic) {
    const runnerUp = semantic.runnerUp !== null ? `, next best ${semantic.runnerUp}` : '';
    outcome.detected.descriptionMatch = `${semantic.similarity}${runnerUp}: ${semantic.decision}`;
  }
  if (outcome.status === 'found' && match.via === 'description') {
    outcome.notes.unshift(`Matched by job description: the careers site calls it "${match.posting.title}".`);
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
  if (!ref.workday?.apiBase) return unknown("We couldn't tell which Workday careers site this link belongs to.");
  if (!deps.searchWorkday) return unknown('Workday careers sites are not supported here.');
  const base = { siteName: 'Workday', officialUrl: workday.boardUrl(ref) };

  if (ref.jobId && deps.fetchWorkdayDetail) {
    try {
      const posting = await deps.fetchWorkdayDetail(ref, ref.jobId);
      if (posting) return { ...base, status: 'found', posting, officialUrl: posting.url, detected: { matchStatus: 'found (apply link)' } };
    } catch (err) {
      if (err?.isNotFound) return { ...base, status: 'closed', detected: { matchStatus: 'apply link removed' } };
      // Other failures: fall back to searching.
    }
  }

  let result;
  try {
    result = await deps.searchWorkday(ref, job.title);
  } catch {
    return unknown("We couldn't reach the company's Workday site right now. This is not evidence against the job.", base);
  }
  // The apply-link id is deliberately not passed: a search result missing it
  // does not mean the posting was removed.
  const match = matchPosting(job, result.postings, {}, rules.matching);
  const outcome = outcomeFromMatch(match, {
    ...base,
    boardUrl: base.officialUrl,
    canBeMissing: result.complete && board.source !== 'guess',
    missingReason: "Workday's search didn't return this job. Large Workday sites can't be checked completely, so this is not counted against it.",
    notes: [result.complete ? `Checked all ${result.total} open jobs on Workday.` : `Searched ${result.total} open jobs on Workday.`],
  });

  // Search results carry only a rough date and no description: fetch details.
  if (outcome.status === 'found' && deps.fetchWorkdayDetail) {
    try {
      const detail = await deps.fetchWorkdayDetail(ref, outcome.posting.id);
      if (detail) outcome.posting = { ...outcome.posting, ...detail, url: outcome.posting.url };
    } catch {
      // keep the search result
    }
  }
  return outcome;
}

/** Same company, allowing legal suffixes and "Acme" vs "Acme Robotics". */
function sameCompany(a, b) {
  const x = normalizeCompanyName(a);
  const y = normalizeCompanyName(b);
  if (!x || !y) return true; // unknown organisation: do not reject
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

/**
 * A company's own careers page: schema.org JobPosting (JSON-LD), then the
 * site's sitemap. Pages can confirm a job or show the link is dead; they can
 * never show a job is missing, because there is no complete list to compare.
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

  if (!(await deps.hasOriginPermission(url.origin).catch(() => false))) {
    return unknown(`This job is on ${host}. Allow GhostCheck to read that site to check it.`, {
      ...base,
      action: { type: 'grant-origin', origin: url.origin, label: `Allow checking ${host}` },
    });
  }

  let page;
  try {
    page = await deps.fetchPageJobs(applyUrl);
  } catch {
    return unknown(`We couldn't reach ${host} right now. This is not evidence against the job.`, base);
  }
  if (page.status === 404 || page.status === 410) {
    return { ...base, status: 'closed', detected: { matchStatus: `apply page returned ${page.status}` } };
  }
  if (!page.ok) return unknown(`${host} answered with an error (${page.status}), so we couldn't check the job.`, base);

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

  if (postings.length) {
    const match = matchPosting(job, postings, {}, rules.matching);
    const outcome = outcomeFromMatch(match, {
      ...base,
      boardUrl: page.url,
      canBeMissing: false,
      missingReason: `The page on ${host} describes a different job.`,
      notes: [`Read the job details published on ${host}.`],
    });
    if (outcome.status === 'found') {
      const p = outcome.posting;
      if (p.orgName && !sameCompany(p.orgName, job.company)) {
        return unknown(`The apply page on ${host} is published by ${p.orgName}, not ${job.company}.`, base);
      }
      if (p.validThrough && Date.parse(p.validThrough) < now.getTime()) {
        outcome.notes.push(`The page says applications closed on ${p.validThrough.slice(0, 10)}.`);
      }
    }
    return outcome;
  }

  // No structured data: is the page at least listed in the site's sitemap?
  if (deps.fetchSitemapUrls) {
    const listed = await deps.fetchSitemapUrls(url.origin).catch(() => null);
    const candidates = [applyUrl, page.url].map(canonicalUrl).filter(Boolean);
    if (listed && candidates.some((c) => listed.has(c))) {
      return {
        ...base,
        status: 'found',
        posting: { id: page.url, title: job.title, location: '', url: page.url, createdAt: null, salary: null, text: '' },
        officialUrl: page.url,
        notes: [`The apply page is listed in ${host}'s sitemap.`],
        detected: { matchStatus: 'listed in sitemap' },
      };
    }
  }
  return unknown(`We couldn't confirm the job on ${host}: the page has no structured job data we can read.`, base);
}

/**
 * @param {object} job  sanitized job from the content script
 * @param {CheckDeps} deps
 * @returns {Promise<import('./result.js').CheckResult>}
 */
export async function checkJob(job, deps) {
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
  const vars = {
    company: job.company || 'the company',
    salary: salary.detail,
    team: team.detail,
    phrase: template.detail,
  };

  // 1. Find the official source and ask it about this job.
  const board = await resolveBoard(job, applyUrl, deps);
  /** @type {Outcome | null} */
  let outcome = null;
  if (board.ref) {
    detected.ats = ATS_NAMES[board.ref.ats];
    detected.board = board.ref.ats === 'workday' ? board.ref.workday?.publicBase : board.ref.slug;
    detected.boardSource = { apply_link: 'apply link', companies: 'GhostCheck company list', guess: 'matched by company name' }[board.source];
    if (board.ref.ats === 'workday') outcome = await lookupWorkday(job, board, deps, rules);
    else if (SOURCES[board.ref.ats]) outcome = await lookupListAts(job, board, deps, rules);
    else outcome = unknown(`${ATS_NAMES[board.ref.ats]} careers sites are not supported yet.`);
  } else if (applyUrl) {
    outcome = await lookupSelfHosted(job, applyUrl, deps, rules, now);
    if (outcome) detected.ats = `Careers page (${outcome.siteName})`;
  }
  if (!outcome) {
    outcome = unknown(
      board.note ||
        (job.applyType === 'easy'
          ? "This is an Easy Apply job and we don't know which careers site this company uses."
          : "We couldn't identify the company's careers site from the apply link."),
    );
  }
  Object.assign(detected, outcome.detected || {});
  vars.ats = outcome.siteName || 'their careers site';
  const notes = [...(outcome.notes || [])];

  // 2. Turn the outcome into signals.
  if (outcome.status === 'found') {
    const posting = outcome.posting;
    signals.found_on_official_site = true;
    signals.not_found_on_official_site = false;
    signals.apply_link_closed = false;
    vars.matchedTitle = posting.title;
    if (!salary.value) {
      // The official posting may state pay even when LinkedIn does not.
      const official = posting.salary ? { value: true, detail: posting.salary } : detectSalary(posting.text);
      if (official.value) {
        signals.salary_listed = true;
        vars.salary = official.detail;
      }
    }
    const age = combineAge(await gatherAgeEvidence(job, board.ref, posting, deps), now);
    if (age) {
      const a = ageSignals(age, rules.age);
      signals.posted_recently = a.posted_recently;
      signals.posted_long_ago = a.posted_long_ago;
      vars.days = age.days;
      vars.ageSource = AGE_SOURCE_LABELS[age.oldest.source];
      detected.firstSeen = `${age.oldest.date.slice(0, 10)} (${AGE_SOURCE_LABELS[age.oldest.source]})`;
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

  if (signals.salary_listed === false) notes.push('No pay range is stated (common, and not counted against the job).');

  const verdict = evaluate(rules, signals, { vars, notes, unknownReason: outcome.reason ?? null });
  return makeResult(verdict.badge, {
    score: verdict.score,
    reasons: verdict.reasons,
    officialUrl: outcome.officialUrl ?? null,
    officialLabel: signals.found_on_official_site ? 'View this job on the company careers site ↗' : 'See the company’s open jobs ↗',
    action: outcome.action ?? null,
    detected,
    signals,
  });
}
