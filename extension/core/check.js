/**
 * Turn a LinkedIn job into a verdict. Network access is injected through
 * `deps` so the same logic runs in the service worker and in tests.
 */
import { resolveApplyUrl } from './apply-url.js';
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

const ATS_NAMES = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday' };

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
      ref: { ats: entry.ats, slug: entry.slug, region: entry.region, jobId: fromLink?.jobId ?? null, workday: entry.workday },
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
  if (posting.createdAt) evidence.push({ date: posting.createdAt, exact: true, source: 'ats' });

  const tasks = [];
  if (deps.fetchFirstSeen) {
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
  const notes = [];
  let unknownReason = null;
  let officialUrl = null;

  const board = await resolveBoard(job, applyUrl, deps);
  if (board.ref) {
    detected.ats = ATS_NAMES[board.ref.ats];
    detected.board = board.ref.slug;
    detected.boardSource = { apply_link: 'apply link', companies: 'GhostCheck company list', guess: 'matched by company name' }[board.source];
  }
  vars.ats = board.ref ? ATS_NAMES[board.ref.ats] : 'their careers site';

  const source = board.ref && SOURCES[board.ref.ats];
  if (!board.ref) {
    unknownReason =
      board.note ||
      (job.applyType === 'easy'
        ? "This is an Easy Apply job and we don't know which careers site this company uses."
        : "We couldn't identify the company's careers site from the apply link.");
  } else if (!source) {
    unknownReason = `${ATS_NAMES[board.ref.ats]} careers sites are not supported yet.`;
  } else {
    officialUrl = source.boardUrl(board.ref);
    let postings = null;
    try {
      postings = await deps.fetchPostings(board.ref);
    } catch (err) {
      unknownReason = err?.isNotFound
        ? `The ${ATS_NAMES[board.ref.ats]} board "${board.ref.slug}" was not found; the company may have moved.`
        : `We couldn't reach ${ATS_NAMES[board.ref.ats]} right now. This is not evidence against the job.`;
    }

    if (postings && postings.length === 0) {
      unknownReason = `${job.company || 'The company'}'s ${ATS_NAMES[board.ref.ats]} board lists no open jobs, so we can't compare.`;
    } else if (postings) {
      detected.boardSize = postings.length;
      const match = matchPosting(job, postings, board.ref, rules.matching);
      detected.matchStatus = match.status;
      if (match.posting) detected.matchedTitle = `${match.posting.title}${match.posting.location ? ` (${match.posting.location})` : ''}`;
      if (match.status !== 'found' && match.status !== 'id_missing') detected.closestScore = match.score;

      if (match.status === 'found') {
        signals.found_on_official_site = true;
        signals.not_found_on_official_site = false;
        signals.apply_link_closed = false;
        officialUrl = match.posting.url || officialUrl;
        vars.matchedTitle = match.posting.title;
        if (!salary.value) {
          // The official posting may state pay even when LinkedIn does not.
          const official = match.posting.salary ? { value: true, detail: match.posting.salary } : detectSalary(match.posting.text);
          if (official.value) {
            signals.salary_listed = true;
            vars.salary = official.detail;
          }
        }
        const age = combineAge(await gatherAgeEvidence(job, board.ref, match.posting, deps), now);
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
      } else if (match.status === 'id_missing') {
        signals.found_on_official_site = false;
        signals.apply_link_closed = true;
      } else if (match.status === 'similar') {
        const why = { level: 'a different seniority level', location: 'a different location', title: 'a somewhat different title' }[match.mismatch];
        unknownReason = `A similar job is listed ("${match.posting.title}"), but with ${why || 'differences'}, so we can't be sure it's the same one.`;
      } else if (match.status === 'unmatchable') {
        unknownReason = "We couldn't compare this job title with the careers site.";
      } else if (board.source === 'guess') {
        // A board found by name might belong to a different company with the
        // same name: never count "not found" against the job in that case.
        unknownReason = `We couldn't find this job on a ${ATS_NAMES[board.ref.ats]} board named "${board.ref.slug}", but we're not sure that board belongs to this company.`;
      } else {
        signals.found_on_official_site = false;
        signals.not_found_on_official_site = true;
      }
      notes.push(`Checked ${postings.length} open job${postings.length === 1 ? '' : 's'} on ${ATS_NAMES[board.ref.ats]}.`);
    }
  }

  if (signals.salary_listed === false) notes.push('No pay range is stated (common, and not counted against the job).');

  const verdict = evaluate(rules, signals, { vars, notes, unknownReason });
  return makeResult(verdict.badge, {
    score: verdict.score,
    reasons: verdict.reasons,
    officialUrl,
    officialLabel: signals.found_on_official_site ? 'View this job on the company careers site ↗' : 'See the company’s open jobs ↗',
    detected,
    signals,
  });
}
