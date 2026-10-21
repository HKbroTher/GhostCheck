/**
 * Background service worker. Every network request, the matching logic and
 * scoring run here, never in the LinkedIn page.
 */
import { checkJob } from '../core/check.js';
import { buildCompanyIndex } from '../core/companies.js';
import { RAW_BASE } from '../core/config.js';
import { fetchJson, fetchText, RateLimiter } from '../core/http.js';
import { parseRules } from '../core/rules.js';
import { unknownResult } from '../core/result.js';
import { resolveLanguage, t } from '../core/i18n.js';
import { SOURCES } from '../core/sources/index.js';
import { snapshotPath } from '../core/snapshot.js';
import { parseWayback, waybackQueryUrl } from '../core/wayback.js';
import { workday, WORKDAY_PAGE_SIZE } from '../core/sources/workday.js';
import { extractJobPostings } from '../core/jsonld.js';
import { discoverAts } from '../core/discover.js';
import { canonicalUrl, isLikelyJobSitemap, parseSitemap, sitemapsFromRobots } from '../core/sitemap.js';
import { isLinkedInHost } from '../core/apply-url.js';
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
  workday: 6 * HOUR,
  page: 1 * HOUR,
  sitemap: 6 * HOUR,
};
/** Workday boards up to this many jobs are listed completely (5 requests). */
const WORKDAY_FULL_LIST_MAX = 100;
const SITEMAP_MAX_FETCHES = 6;
const SITEMAP_MAX_URLS = 20000;
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

// ----------------------------------------------------------------- workday

const workdayPost = (ref, text, offset) =>
  fetchJson(workday.searchUrl(ref), { method: 'POST', body: workday.searchBody(text, offset), timeoutMs: 15000, retries: 1, limiter });

/** Whole-board info: total job count, and every posting when the board is small. */
async function workdayBoard(ref) {
  const key = `wdboard:${ref.workday.apiBase}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  return dedupe(key, async () => {
    const first = workday.parseSearch(await workdayPost(ref, '', 0), ref);
    let postings = null;
    if (first.total <= WORKDAY_FULL_LIST_MAX) {
      postings = [...first.postings];
      for (let offset = WORKDAY_PAGE_SIZE; offset < first.total; offset += WORKDAY_PAGE_SIZE) {
        postings.push(...workday.parseSearch(await workdayPost(ref, '', offset), ref).postings);
      }
    }
    const board = { total: first.total, postings };
    await cacheSet(key, board, TTL.workday);
    return board;
  });
}

/** Search a Workday site by title; complete=true when the whole board was listed. */
async function searchWorkday(ref, title) {
  const board = await workdayBoard(ref);
  if (board.postings) return { postings: board.postings, complete: true, total: board.total };
  const key = `wdsearch:${ref.workday.apiBase}:${title.toLowerCase()}`;
  const cached = await cacheGet(key);
  if (cached) return { postings: cached, complete: false, total: board.total };
  const { postings } = workday.parseSearch(await workdayPost(ref, title, 0), ref);
  await cacheSet(key, postings, TTL.workday);
  return { postings, complete: false, total: board.total };
}

/** One Workday posting; throws HttpError (isNotFound when removed). */
async function fetchWorkdayDetail(ref, externalPath) {
  const key = `wddetail:${ref.workday.apiBase}${externalPath}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  return dedupe(key, async () => {
    const json = await fetchJson(workday.detailUrl(ref, externalPath), { timeoutMs: 15000, retries: 1, limiter });
    const posting = workday.parseDetail(json, ref, externalPath);
    if (posting) await cacheSet(key, posting, TTL.workday);
    return posting;
  });
}

// ------------------------------------------------------- self-hosted pages

/** Has the user allowed GhostCheck to read this site? (optional_host_permissions) */
async function hasOriginPermission(origin) {
  try {
    return await chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

/** A careers page and the JSON-LD JobPostings in it. Only small results are cached. */
async function fetchPageJobs(url) {
  const key = `page:${url}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  return dedupe(key, async () => {
    const page = await fetchText(url, { timeoutMs: 12000, maxBytes: 3_000_000, limiter });
    const result = {
      status: page.status,
      ok: page.ok,
      url: page.url,
      postings: page.ok ? extractJobPostings(page.text) : [],
      // ATS the page links to or embeds (the real home of many jobs).
      discovered: page.ok ? discoverAts(page.text) : { refs: [], unsupported: [] },
    };
    await cacheSet(key, result, TTL.page);
    return result;
  });
}

/** Canonical URLs listed in a site's sitemaps (job sitemaps first), or null. */
async function fetchSitemapUrls(origin) {
  const key = `sitemap:${origin}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached.urls ? new Set(cached.urls) : null;
  return dedupe(key, async () => {
    let queue = [];
    try {
      const robots = await fetchText(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 500_000, limiter });
      if (robots.ok) queue = sitemapsFromRobots(robots.text);
    } catch {
      // fall back to the conventional location
    }
    if (!queue.length) queue = [`${origin}/sitemap.xml`];

    const urls = new Set();
    let fetches = 0;
    while (queue.length && fetches < SITEMAP_MAX_FETCHES && urls.size < SITEMAP_MAX_URLS) {
      queue.sort((a, b) => Number(isLikelyJobSitemap(b)) - Number(isLikelyJobSitemap(a)));
      const next = queue.shift();
      if (new URL(next, origin).origin !== origin) continue; // stay on the permitted site
      fetches++;
      let res;
      try {
        res = await fetchText(new URL(next, origin).href, { timeoutMs: 12000, maxBytes: 8_000_000, limiter });
      } catch {
        continue;
      }
      if (!res.ok) continue;
      const parsed = parseSitemap(res.text);
      queue.push(...parsed.sitemaps.filter(isLikelyJobSitemap));
      for (const u of parsed.urls) {
        const c = canonicalUrl(u.loc);
        if (c) urls.add(c);
        if (urls.size >= SITEMAP_MAX_URLS) break;
      }
    }
    const list = urls.size ? [...urls] : null;
    await cacheSet(key, { urls: list }, TTL.sitemap);
    return list ? new Set(list) : null;
  });
}

/** https origin of a public careers site we may ask permission for. */
function validCareersOrigin(origin) {
  try {
    const u = new URL(origin);
    return (
      u.protocol === 'https:' &&
      u.origin === origin &&
      !isLinkedInHost(u.hostname) &&
      u.hostname.includes('.') &&
      !/^(localhost|[\d.]+|\[.*\])$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}

// ------------------------------------------------------- local AI model

const OFFSCREEN_PATH = 'offscreen/offscreen.html';
/** First use downloads the model (~23 MB); later calls take well under a second. */
const EMBED_TIMEOUT_MS = { cold: 25000, warm: 10000 };
let offscreenCreating = null;
/** Models known to be loaded in the offscreen document. */
const warmModels = new Set();

/** User settings (options page). Stored outside the "gc:" cache namespace. */
async function getSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    return settings || {};
  } catch {
    return {};
  }
}

const languageOf = (settings) => resolveLanguage(settings.language, chrome.i18n.getUILanguage());

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (existing.length) return;
  offscreenCreating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WORKERS'],
      justification: 'Runs a small local text-embedding model to compare job descriptions.',
    })
    .finally(() => {
      offscreenCreating = null;
    });
  await offscreenCreating;
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('model timeout')), ms))]);

/**
 * Normalized sentence embeddings from the offscreen model. Throws when the
 * model is unavailable or still downloading; callers treat that as "no
 * opinion". `onPending` is told when the model was still loading.
 */
async function embed(texts, onPending, model = 'english') {
  await ensureOffscreen();
  const warm = warmModels.has(model);
  try {
    const res = await withTimeout(
      chrome.runtime.sendMessage({ target: 'ghostcheck-offscreen', type: 'embed', texts, model }),
      warm ? EMBED_TIMEOUT_MS.warm : model === 'multilingual' ? EMBED_TIMEOUT_MS.cold * 3 : EMBED_TIMEOUT_MS.cold,
    );
    if (!res || res.error || !Array.isArray(res.vectors)) throw new Error(res?.error || 'no response from model');
    warmModels.clear(); // the offscreen document holds one model at a time
    warmModels.add(model);
    return res.vectors;
  } catch (err) {
    if (!warm) onPending?.();
    throw err;
  }
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

/** Results are cached per LinkedIn job and language, invalidated if what we read changes. */
function resultKey(job, lang, model) {
  const fingerprint = [job.title, job.company, job.location, job.applyHref, job.description.length].join('|');
  let h = 0;
  for (let i = 0; i < fingerprint.length; i++) h = (Math.imul(31, h) + fingerprint.charCodeAt(i)) | 0;
  return `result:${lang}:${model}:${job.jobId || 'nojob'}:${(h >>> 0).toString(36)}`;
}

/** @param {string} [pageLang]  the language the card is shown in, so card and reasons match */
async function handleCheck(rawJob, force, pageLang) {
  const job = sanitizeJob(rawJob);
  const settings = await getSettings();
  const lang = pageLang === 'en' || pageLang === 'zh' ? pageLang : languageOf(settings);
  if (!job.title || !job.company) {
    return unknownResult(t(lang, 'error.unreadable'), lang);
  }
  const key = resultKey(job, lang, settings.semantic === false ? 'off' : settings.semanticModel || 'english');
  if (!force) {
    const cached = await cacheGet(key);
    if (cached) return cached;
  } else {
    // A manual recheck also refreshes the company's job list.
    recentFailures.clear();
  }

  const [rules, companies] = await Promise.all([getRules(), getCompanies()]);
  const useModel = settings.semantic !== false;
  const semanticModel = settings.semanticModel === 'multilingual' ? 'multilingual' : 'english';
  let modelPending = false;
  const deps = {
    lang,
    semanticModel,
    embed: useModel
      ? (texts) =>
          embed(
            texts,
            () => {
              modelPending = true;
            },
            semanticModel,
          )
      : null,
    rules,
    companies,
    fetchPostings: force ? fetchPostingsFresh : fetchPostings,
    fetchBoardName,
    fetchFirstSeen,
    fetchWayback,
    searchWorkday,
    fetchWorkdayDetail,
    hasOriginPermission,
    fetchPageJobs,
    fetchSitemapUrls,
  };
  const result = await checkJob(job, deps);
  if (result.errors) console.warn('[GhostCheck] lookups failed', job.title, result.errors);
  // Do not cache "can't verify" or failed lookups for long: they are often
  // transient. Same while the description model is still downloading, so
  // the next look gets the benefit of it.
  const shortLived = result.badge === 'unknown' || !!result.errors || modelPending;
  await cacheSet(key, result, shortLived ? (modelPending ? 10 : 15) * 60000 : TTL.result);
  return result;
}

async function fetchPostingsFresh(ref) {
  await cacheDelete(boardKey(ref));
  return fetchPostings(ref);
}

let fontData = null;
/** VT323 as base64 (messages are JSON, so no ArrayBuffer). ~18 KB, loaded once. */
async function loadFont() {
  if (!fontData) {
    const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL('vendor/fonts/vt323.woff2'))).arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    fontData = btoa(binary);
  }
  return fontData;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Diagnostics from the extension's own pages (options page, tests): run
  // the description model through the real service worker -> offscreen path.
  if (message?.type === 'ghostcheck:debug-embed' && sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    const texts = Array.isArray(message.texts) ? message.texts.map(String).slice(0, 16) : [];
    embed(texts, null, message.model === 'multilingual' ? 'multilingual' : 'english').then(
      (vectors) => sendResponse({ vectors }),
      (err) => sendResponse({ error: String(err?.message || err) }),
    );
    return true;
  }
  // The offscreen model host has been idle: free its memory.
  if (message?.type === 'ghostcheck:offscreen-idle' && sender.url === chrome.runtime.getURL(OFFSCREEN_PATH)) {
    chrome.offscreen.closeDocument().catch(() => {});
    warmModels.clear();
    return false;
  }
  // The card's "Allow checking <site>" button: permissions can only be
  // requested from an extension page, so open a small one.
  if (message?.type === 'ghostcheck:grant-origin' && isTrustedSender(sender)) {
    if (!validCareersOrigin(message.origin) || !sender.tab?.id) return false;
    const page = chrome.runtime.getURL(
      `permission/permission.html?origin=${encodeURIComponent(message.origin)}&tab=${sender.tab.id}${message.all === true ? '&all=1' : ''}`,
    );
    chrome.tabs.create({ url: page, index: sender.tab.index + 1 });
    return false;
  }
  // The card's pixel font. Not a web_accessible_resource (LinkedIn could
  // use that to detect the extension), so hand the bytes to the content script.
  if (message?.type === 'ghostcheck:font' && isTrustedSender(sender)) {
    loadFont().then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (message?.type !== 'ghostcheck:check' || !isTrustedSender(sender)) return false;
  handleCheck(message.job, message.force === true, message.lang)
    .then(sendResponse)
    .catch((err) => {
      console.warn('[GhostCheck] check failed', err);
      getSettings().then((settings) => {
        const lang = message.lang === 'en' || message.lang === 'zh' ? message.lang : languageOf(settings);
        sendResponse(unknownResult(t(lang, 'error.internal'), lang));
      });
    });
  return true; // keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener(() => pruneCache());
chrome.runtime.onStartup.addListener(() => pruneCache());
