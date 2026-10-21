#!/usr/bin/env node
/**
 * Check every board in data/companies.json against the live public APIs.
 *
 *   node scripts/validate-companies.mjs            all companies
 *   node scripts/validate-companies.mjs stripe     only names/slugs containing "stripe"
 *
 * Exits 1 when a board does not exist (wrong slug) or a Greenhouse board's
 * name does not match the company. Network errors are reported as warnings
 * only, so a flaky API does not block contributions.
 */
import { readFileSync } from 'node:fs';
import { buildCompanyIndex, normalizeCompanyName } from '../core/companies.js';
import { fetchJson, RateLimiter } from '../core/http.js';
import { SOURCES } from '../core/sources/index.js';
import { matchPosting } from '../core/matcher.js';
import { workday } from '../core/sources/workday.js';
import { fetchText } from '../core/http.js';
import { extractJobPostings } from '../core/jsonld.js';
import { discoverAts } from '../core/discover.js';
import { canonicalUrl, isLikelyJobSitemap, parseSitemap, sitemapsFromRobots } from '../core/sitemap.js';

const filter = (process.argv[2] || '').toLowerCase();
const index = buildCompanyIndex(JSON.parse(readFileSync(new URL('../data/companies.json', import.meta.url), 'utf8')));
const limiter = new RateLimiter({ minIntervalMs: 300, maxConcurrent: 2 });

if (index.errors.length) {
  console.error('companies.json has errors:');
  for (const e of index.errors) console.error(`  - ${e}`);
  process.exit(1);
}

const failures = [];
const selfMatch = { tried: 0, found: 0, misses: [] };

/**
 * Feed each live posting back to the matcher as if it were the LinkedIn job
 * (its title and first location). Misses point at normalization gaps.
 */
function selfMatchCheck(company, postings) {
  for (const p of postings.slice(0, 60)) {
    const location = p.location.split(';')[0];
    const m = matchPosting({ title: p.title, location }, postings);
    selfMatch.tried++;
    // Identical titles in several locations are fine to swap.
    if (m.status === 'found' && normalizeCompanyName(m.posting.title) === normalizeCompanyName(p.title)) selfMatch.found++;
    else if (selfMatch.misses.length < 25) selfMatch.misses.push(`${company}: "${p.title}" @ ${location} -> ${m.status}${m.mismatch ? ` (${m.mismatch})` : ''}`);
  }
}
const warnings = [];
const shownRawKeys = new Set();
const selfHostedSamples = [];

/**
 * Real self-hosted careers pages (boards whose job URLs live on the
 * company's own domain): does JSON-LD parse, and is the page in the sitemap?
 */
async function probeSelfHosted(url) {
  const origin = new URL(url).origin;
  let line = `page     ${url}`;
  try {
    const page = await fetchText(url, { timeoutMs: 20000, limiter });
    const jobs = page.ok ? extractJobPostings(page.text) : [];
    line += ` -> HTTP ${page.status}, ${jobs.length} JobPosting${jobs[0] ? ` ("${jobs[0].title}", posted ${jobs[0].datePosted?.slice(0, 10) ?? '?'}, org ${jobs[0].orgName || '?'})` : ''}`;
    const found = page.ok ? discoverAts(page.text) : { refs: [], unsupported: [] };
    const boards = found.refs.map((r) => `${r.ref.ats}/${r.ref.slug}${r.ref.jobId ? `#${r.ref.jobId}` : ''} x${r.count}`);
    line += `; linked ATS: ${boards.join(', ') || 'none'}${found.unsupported.length ? `; unsupported: ${found.unsupported.join(', ')}` : ''}`;
    line += `; ${page.text.length} bytes`;
    // Follow the first supported board, as the extension would.
    const top = found.refs[0]?.ref;
    if (top && SOURCES[top.ats]) {
      try {
        const raw = await fetchJson(SOURCES[top.ats].listUrl(top), { timeoutMs: 30000, retries: 1, limiter });
        const first = Array.isArray(raw) ? raw[0] : raw?.jobs?.[0];
        if (first && !shownRawKeys.has(top.ats)) {
          shownRawKeys.add(top.ats);
          console.log(`      raw ${top.ats} fields: ${Object.keys(first).sort().join(', ')}`);
        }
        const posts = SOURCES[top.ats].parse(raw);
        const listed = top.jobId ? posts.some((p) => p.id.toLowerCase() === String(top.jobId).toLowerCase()) : null;
        const sample = posts[0] ? ` e.g. "${posts[0].title}" @ ${posts[0].location || '?'} (${posts[0].createdAt?.slice(0, 10) ?? 'no date'})` : '';
        line += `; ${top.ats} board: ${posts.length} jobs${listed === null ? '' : `, linked posting ${listed ? 'listed' : 'NOT listed'}`}${sample}`;
      } catch (err) {
        line += `; ${top.ats} board: ${err.message}`;
      }
    }
    const robots = await fetchText(`${origin}/robots.txt`, { timeoutMs: 15000, limiter }).catch(() => null);
    const maps = robots?.ok ? sitemapsFromRobots(robots.text) : [];
    const queue = maps.length ? maps : [`${origin}/sitemap.xml`];
    const urls = new Set();
    for (let i = 0; i < 4 && queue.length; i++) {
      queue.sort((a, b) => Number(isLikelyJobSitemap(b)) - Number(isLikelyJobSitemap(a)));
      const res = await fetchText(queue.shift(), { timeoutMs: 20000, maxBytes: 8_000_000, limiter }).catch(() => null);
      if (!res?.ok) continue;
      const parsed = parseSitemap(res.text);
      queue.push(...parsed.sitemaps.filter(isLikelyJobSitemap));
      for (const u of parsed.urls) urls.add(canonicalUrl(u.loc));
    }
    line += `; sitemap: ${urls.size} urls, page ${urls.has(canonicalUrl(page.url)) || urls.has(canonicalUrl(url)) ? 'listed' : 'not listed'}`;
  } catch (err) {
    line += ` -> ${err?.message || err}`;
  }
  console.log(line);
}

/** Workday: search the board, fetch one posting, and probe a removed posting. */
async function validateWorkday(c, label) {
  const ref = { ats: 'workday', slug: c.slug, workday: c.workday };
  const post = (text) =>
    fetchJson(workday.searchUrl(ref), { method: 'POST', body: workday.searchBody(text), timeoutMs: 30000, retries: 2, limiter });
  try {
    const raw = await post('');
    const { total, postings } = workday.parseSearch(raw, ref);
    if (!shownRawKeys.has('workday') && raw?.jobPostings?.[0]) {
      shownRawKeys.add('workday');
      console.log(`      raw workday search fields: ${Object.keys(raw.jobPostings[0]).sort().join(', ')}`);
    }
    let detailNote = '';
    if (postings[0]) {
      const detailRaw = await fetchJson(workday.detailUrl(ref, postings[0].id), { timeoutMs: 30000, retries: 2, limiter });
      const detail = workday.parseDetail(detailRaw, ref, postings[0].id);
      if (!shownRawKeys.has('workday-detail') && detailRaw?.jobPostingInfo) {
        shownRawKeys.add('workday-detail');
        console.log(`      raw workday detail fields: ${Object.keys(detailRaw.jobPostingInfo).sort().join(', ')}`);
      }
      detailNote = detail ? ` detail ok (published ${detail.createdAt?.slice(0, 10) ?? '?'}, ${detail.text.length} chars)` : ' DETAIL UNPARSED';
      if (!detail) warnings.push(`${c.name}: Workday detail could not be parsed`);
      // A posting path that cannot exist: how does Workday answer?
      const bogus = '/job/Nowhere/GhostCheck-Probe_R000000000';
      try {
        await fetchJson(workday.detailUrl(ref, bogus), { timeoutMs: 30000, retries: 0, limiter });
        detailNote += '; removed posting -> 200 (!)';
        warnings.push(`${c.name}: Workday answered 200 for a removed posting`);
      } catch (err) {
        detailNote += `; removed posting -> ${err.status ?? err.kind}`;
      }
    }
    const sample = postings[0] ? ` e.g. "${postings[0].title}" @ ${postings[0].location || '?'} (${postings[0].createdAt?.slice(0, 10) ?? '?'})` : '';
    console.log(`OK    ${label}  ${total} jobs.${detailNote}${sample}`);
    if (!total) warnings.push(`${c.name}: Workday board has 0 jobs`);
  } catch (err) {
    if (err?.isNotFound || err?.status === 422 || err?.status === 400) {
      console.log(`FAIL  ${label}  Workday site not found (${err.status})`);
      failures.push(`${c.name}: Workday site ${c.workday.host}/${c.workday.site} not found`);
    } else {
      console.log(`WARN  ${label}  ${err?.message || err}`);
      warnings.push(`${c.name}: ${err?.message || err}`);
    }
  }
}

for (const c of index.entries) {
  if (filter && !c.name.toLowerCase().includes(filter) && !c.slug.toLowerCase().includes(filter)) continue;
  const label = `${c.name.padEnd(24)} ${c.ats.padEnd(10)} ${c.slug}`;
  if (c.ats === 'workday') {
    await validateWorkday(c, label);
    continue;
  }
  const source = SOURCES[c.ats];
  if (!source) {
    console.log(`SKIP  ${label}  (no source for ${c.ats} yet)`);
    continue;
  }
  try {
    const json = await fetchJson(source.listUrl(c), { timeoutMs: 30000, retries: 2, limiter });
    const postings = source.parse(json);

    // Print the raw field names once per ATS so parser assumptions can be checked.
    if (!shownRawKeys.has(c.ats)) {
      const raw = Array.isArray(json) ? json[0] : json?.jobs?.[0];
      if (raw) {
        shownRawKeys.add(c.ats);
        console.log(`      raw ${c.ats} fields: ${Object.keys(raw).sort().join(', ')}`);
      }
    }

    let nameNote = '';
    if (c.ats === 'greenhouse') {
      const info = await fetchJson(source.infoUrl(c), { timeoutMs: 15000, retries: 2, limiter });
      const same = normalizeCompanyName(info?.name) === normalizeCompanyName(c.name) ||
        c.aliases.some((a) => normalizeCompanyName(a) === normalizeCompanyName(info?.name));
      nameNote = ` board name "${info?.name}"`;
      if (!same) failures.push(`${c.name}: Greenhouse board "${c.slug}" is named "${info?.name}"`);
    }
    selfMatchCheck(c.name, postings);
    const ownDomain = postings.find((p) => p.url && !/greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com/.test(new URL(p.url).host));
    if (ownDomain && selfHostedSamples.length < 4) selfHostedSamples.push(ownDomain.url);
    const dated = postings.filter((p) => p.createdAt).length;
    const sample = postings[0] ? ` e.g. "${postings[0].title}" @ ${postings[0].location || '?'}` : '';
    console.log(`OK    ${label}  ${postings.length} jobs, ${dated} with publish date.${nameNote}${sample}`);
    if (!postings.length) warnings.push(`${c.name}: board has 0 open jobs`);
  } catch (err) {
    if (err?.isNotFound) {
      console.log(`FAIL  ${label}  board not found (${err.status})`);
      failures.push(`${c.name}: ${c.ats} board "${c.slug}" not found`);
    } else {
      console.log(`WARN  ${label}  ${err?.message || err}`);
      warnings.push(`${c.name}: ${err?.message || err}`);
    }
  }
}

// Pages users reported, plus own-domain pages seen on the boards above.
const reported = readFileSync(new URL('../tests/careers-pages.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
if (selfHostedSamples.length || reported.length) {
  console.log('\nSelf-hosted careers pages:');
  for (const url of [...reported, ...selfHostedSamples]) await probeSelfHosted(url);
}

if (selfMatch.tried) {
  const rate = ((100 * selfMatch.found) / selfMatch.tried).toFixed(1);
  console.log(`\nSelf-match recall: ${selfMatch.found}/${selfMatch.tried} (${rate}%)`);
  for (const m of selfMatch.misses) console.log(`  miss: ${m}`);
}

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
}
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll boards in companies.json are valid.');
