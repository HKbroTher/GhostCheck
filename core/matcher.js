/**
 * Find the LinkedIn job among a company's official postings.
 *
 * Statuses:
 *   found       same posting id as the apply link, or a confident title match
 *               with compatible level and location
 *   id_missing  the apply link names a posting id that is no longer listed
 *               and nothing else matches
 *   similar     a close title exists but level/location/title differ enough
 *               that we cannot say it is the same job (never negative evidence)
 *   not_found   nothing resembling this title is listed
 */
import { normalizeTitle, levelsCompatible, locationsCompatible } from './normalize.js';
import { titleSimilarity } from './fuzzy.js';

/** Tokens that put a title on the people-manager track. */
const MANAGER_TOKENS = ['manager', 'director', 'head', 'vp', 'president', 'chief'];

export const DEFAULT_THRESHOLDS = { title_match: 0.8, title_similar: 0.6 };

function sameTrack(a, b) {
  return MANAGER_TOKENS.every((t) => a.tokens.includes(t) === b.tokens.includes(t));
}

function levelOk(a, b) {
  // Internships never match full-time roles, even when the other title has no level.
  if ((a.level === 'intern') !== (b.level === 'intern')) return false;
  return levelsCompatible(a.level, b.level);
}

/**
 * @param {{ title: string, location?: string }} job      the LinkedIn job
 * @param {import('./sources/index.js').Posting[]} postings
 * @param {{ jobId?: string | null }} [ref]               ATS posting id from the apply link
 * @param {{ title_match?: number, title_similar?: number }} [thresholds]
 * @returns {{ status: 'found' | 'id_missing' | 'similar' | 'not_found',
 *             posting: import('./sources/index.js').Posting | null,
 *             score: number, via: string | null, mismatch: string | null }}
 */
export function matchPosting(job, postings, ref = {}, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

  if (ref?.jobId) {
    const byId = postings.find((p) => p.id === String(ref.jobId).toLowerCase());
    if (byId) return { status: 'found', posting: byId, score: 1, via: 'id', mismatch: null };
  }

  const target = normalizeTitle(job.title);
  let best = null; // best acceptable match
  let near = null; // best title-similar candidate, regardless of filters

  for (const posting of postings) {
    const cand = normalizeTitle(posting.title);
    const score = Math.max(titleSimilarity(target.core, cand.core), titleSimilarity(target.tokens, cand.tokens));
    if (score < t.title_similar) continue;

    let mismatch = null;
    if (!sameTrack(target, cand)) mismatch = 'role';
    else if (!levelOk(target, cand)) mismatch = 'level';
    else if (!locationsCompatible(job.location || '', posting.location || '')) mismatch = 'location';
    else if (score < t.title_match) mismatch = 'title';

    if (!mismatch && (!best || score > best.score)) best = { posting, score };
    if (!near || score > near.score) near = { posting, score, mismatch };
  }

  if (best) return { status: 'found', posting: best.posting, score: round(best.score), via: 'title', mismatch: null };
  // Managerial vs individual-contributor titles are different jobs, not "similar".
  if (near && near.mismatch !== 'role') {
    return { status: 'similar', posting: near.posting, score: round(near.score), via: 'title', mismatch: near.mismatch };
  }
  if (ref?.jobId) return { status: 'id_missing', posting: null, score: 0, via: 'id', mismatch: null };
  return { status: 'not_found', posting: null, score: near ? round(near.score) : 0, via: null, mismatch: null };
}

const round = (n) => Math.round(n * 100) / 100;
