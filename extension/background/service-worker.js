/**
 * Background service worker. Every network request, the matching logic and
 * scoring run here, never in the LinkedIn page.
 */
import { checkJob } from '../core/check.js';
import { buildCompanyIndex } from '../core/companies.js';
import { RAW_BASE } from '../core/config.js';
import { fetchJson, RateLimiter } from '../core/http.js';
import { parseRules } from '../core/rules.js';
import { unknownResult } from '../core/result.js';
import { SOURCES } from '../core/sources/index.js';
import { snapshotPath } from '../core/snapshot.js';
import { parseWayback, waybackQueryUrl } from '../core/wayback.js';
import { cacheDelete, cacheGet, cacheSet, pruneCache } from './cache.js';

const HOUR = 3600000;
const TTL = {
  board: 6 * HOUR,
  boardName: 7 * 24 * HOUR,
  result: 6 * HOUR,
  companies: 24 * HOUR,
  firstSeen: 12 * HOUR, // snapshots change once a day
  wayback: 7 * 24 * HOUR, // an earliest capture never changes
  waybackNone: 24 * HOUR,
};
/** Failed board fetches are remembered briefly in memory only, to avoid hammering. */
const FAILURE_BACKOFF_MS = 10 * 60000;

const limiter = new RateLimiter({ minIntervalMs: 500, maxConcurrent: 2 });
/** @type {Map<string, Promise<any>>} in-flight requests, deduplicated by key */
const inflight = new Map();
/** @type {Map<string, {until: number, error: any}>} */
const recentFailures = new Map();

function dedupe(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ------------------------------------------------------------------ config

let rulesPromise = null;
function getRules() {
  rulesPromise ??= fetch(chrome.runtime.getURL('rules.yaml'))
    .then((r) => r.text())
    .then(parseRules)
    .catch((err) => {
      rulesPromise = null;
      throw err;
    });
  return rulesPromise;
}

let companiesPromise = null;
/**
 * Company list: the latest version from GitHub (cached for a day), falling
 * back to the copy bundled with the extension. Data only, never code.
 */
function getCompanies() {
  companiesPromise ??= (async () => {
    let json = await cacheGet('companies');
    if (!json) {
      try {
        json = await fetchJson(`${RAW_BASE}/data/companies.json`, { timeoutMs: 8000, retries: 0, limiter });
        if (buildCompanyIndex(json).entries.length) await cacheSet('companies', json, TTL.companies);
        else json = null;
      } catch {
        json = null;
      }
    }
    if (!json) json = await fetch(chrome.runtime.getURL('data/companies.json')).then((r) => r.json());
    const index = buildCompanyIndex(json);
    if (index.errors.length) console.warn('[GhostCheck] companies.json issues:', index.errors);
    return index;
  })().catch((err) => {
    companiesPromise = null;
    console.warn('[GhostCheck] could not load companies.json', err);
    return null;
  });
  return companiesPromise;
}

// ---------------------------------------------------------------- network

const boardKey = ({ ats, slug, region }) => `board:${ats}:${region || 'us'}:${String(slug).toLowerCase()}`;

/** All open postings on a board, cached. Throws HttpError on failure. */
async function fetchPostings(ref) {
  const key = boardKey(ref);
  const cached = await cacheGet(key);
  if (cached) return cached;

  const failure = recentFailures.get(key);
  if (failure && failure.until > Date.now()) throw failure.error;

  return dedupe(key, async () => {
    const source = SOURCES[ref.ats];
    try {
      const json = await fetchJson(source.listUrl(ref), { timeoutMs: 15000, retries: 1, limiter });
      const postings = source.parse(json);
      await cacheSet(key, postings, TTL.board);
      return postings;
    } catch (err) {
      recentFailures.set(key, { until: Date.now() + FAILURE_BACKOFF_MS, error: err });
      throw err;
    }
  });
}

/** Greenhouse board display name, or null if the board does not exist. */
async function fetchBoardName(ref) {
  const key = `boardname:${ref.ats}:${String(ref.slug).toLowerCase()}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached.name;
  return dedupe(key, async () => {
    try {
      const json = await fetchJson(SOURCES.greenhouse.infoUrl(ref), { timeoutMs: 8000, retries: 0, limiter });
      const name = typeof json?.name === 'string' ? json.name : null;
      await cacheSet(key, { name }, TTL.boardName);
      return name;
    } catch (err) {
      if (err?.isNotFound) {
        await cacheSet(key, { name: null }, TTL.boardName);
        return null;
      }
      throw err; // transient failure: do not cache
    }
  });
}

/**
 * GhostCheck's first-seen file for a board, from the repository (data only).
 * Returns null when the board is not tracked (404).
 */
async function fetchFirstSeen(ref) {
  const path = snapshotPath(ref);
  const cached = await cacheGet(`firstseen:${path}`);
  if (cached !== undefined) return cached.snap;
  return dedupe(`firstseen:${path}`, async () => {
    try {
      const snap = await fetchJson(`${RAW_BASE}/${path}`, { timeoutMs: 10000, retries: 1, limiter });
      await cacheSet(`firstseen:${path}`, { snap }, TTL.firstSeen);
      return snap;
    } catch (err) {
      if (err?.isNotFound) {
        await cacheSet(`firstseen:${path}`, { snap: null }, TTL.firstSeen);
        return null;
      }
      throw err;
    }
  });
}

/** ISO date of the earliest Wayback Machine capture of `url`, or null. */
async function fetchWayback(url) {
  const key = `wayback:${url}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached.date;
  return dedupe(key, async () => {
    // The Wayback API is slow and sometimes empty; no retries, short timeout.
    const date = parseWayback(await fetchJson(waybackQueryUrl(url), { timeoutMs: 8000, retries: 0, limiter }));
    await cacheSet(key, { date }, date ? TTL.wayback : TTL.waybackNone);
    return date;
  });
}

// ---------------------------------------------------------------- messages

/**
 * Accept only well-formed messages from our own content script on LinkedIn.
 * @param {chrome.runtime.MessageSender} sender
 */
function isTrustedSender(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(sender.url || sender.tab?.url || '').hostname);
  } catch {
    return false;
  }
}

/** Keep only the fields we expect, as plain bounded strings. */
function sanitizeJob(job) {
  const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    jobId: str(job?.jobId, 40),
    pageUrl: str(job?.pageUrl, 2000),
    title: str(job?.title),
    company: str(job?.company),
    linkedinCompanySlug: str(job?.linkedinCompanySlug, 200) || null,
    location: str(job?.location),
    metaText: str(job?.metaText),
    salaryText: str(job?.salaryText),
    description: str(job?.description, 20000),
    applyType: ['easy', 'external'].includes(job?.applyType) ? job.applyType : 'unknown',
    applyHref: str(job?.applyHref, 4000) || null,
  };
}

/** Results are cached per LinkedIn job and invalidated if what we read changes. */
function resultKey(job) {
  const fingerprint = [job.title, job.company, job.location, job.applyHref, job.description.length].join('|');
  let h = 0;
  for (let i = 0; i < fingerprint.length; i++) h = (Math.imul(31, h) + fingerprint.charCodeAt(i)) | 0;
  return `result:${job.jobId || 'nojob'}:${(h >>> 0).toString(36)}`;
}

async function handleCheck(rawJob, force) {
  const job = sanitizeJob(rawJob);
  if (!job.title || !job.company) {
    return unknownResult("We couldn't read the job title or company from this page.");
  }
  const key = resultKey(job);
  if (!force) {
    const cached = await cacheGet(key);
    if (cached) return cached;
  } else {
    // A manual recheck also refreshes the company's job list.
    recentFailures.clear();
  }

  const [rules, companies] = await Promise.all([getRules(), getCompanies()]);
  const deps = {
    rules,
    companies,
    fetchPostings: force ? fetchPostingsFresh : fetchPostings,
    fetchBoardName,
    fetchFirstSeen,
    fetchWayback,
  };
  const result = await checkJob(job, deps);
  // Do not cache "can't verify" for long: it is often a transient failure.
  await cacheSet(key, result, result.badge === 'unknown' ? 15 * 60000 : TTL.result);
  return result;
}

async function fetchPostingsFresh(ref) {
  await cacheDelete(boardKey(ref));
  return fetchPostings(ref);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ghostcheck:check' || !isTrustedSender(sender)) return false;
  handleCheck(message.job, message.force === true)
    .then(sendResponse)
    .catch((err) => {
      console.warn('[GhostCheck] check failed', err);
      sendResponse(unknownResult('GhostCheck hit an internal error. This is not evidence against the job.'));
    });
  return true; // keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener(() => pruneCache());
chrome.runtime.onStartup.addListener(() => pruneCache());
