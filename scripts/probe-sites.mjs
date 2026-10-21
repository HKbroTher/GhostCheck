#!/usr/bin/env node
/**
 * Exploratory probe of careers-site search APIs (Phenom, amazon.jobs) as
 * they really answer, for building and checking the site-search sources.
 * Prints response shapes; never fails the build.
 */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const PHENOM_CANDIDATES = [
  'https://careers.fedex.com/',
  'https://jobs.thermofisher.com/',
  'https://jobs.citi.com/',
  'https://careers.mastercard.com/',
  'https://jobs.dell.com/',
  'https://careers.underarmour.com/',
];

async function get(url, init = {}) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), ...init, headers: { 'user-agent': UA, ...(init.headers || {}) } });
  const text = await res.text();
  return { status: res.status, url: res.url, text, headers: Object.fromEntries(res.headers) };
}

const snip = (s, n = 1200) => String(s).replace(/\s+/g, ' ').slice(0, n);

function keysDeep(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return typeof obj;
  if (Array.isArray(obj)) return [obj.length, keysDeep(obj[0], depth + 1)];
  return Object.fromEntries(Object.entries(obj).slice(0, 40).map(([k, v]) => [k, keysDeep(v, depth + 1)]));
}

async function probePhenom(start) {
  console.log(`\n=== ${start}`);
  let page;
  try {
    page = await get(start);
  } catch (err) {
    return console.log('GET failed', err.message);
  }
  console.log('status', page.status, 'final', page.url, 'bytes', page.text.length);
  const markers = ['phenompeople', 'phApp', 'ddoKey', 'refineSearch', 'widgets'].filter((m) => page.text.includes(m));
  console.log('markers', markers);
  for (const k of ['refNum', 'locale', 'country', 'siteType', 'pageId', 'deviceType', 'pageName', 'baseUrl', 'cdnUrl', 'siteLang', 'csrfToken']) {
    const m = page.text.match(new RegExp(`"${k}"\\s*:\\s*"([^"]{0,120})"`));
    if (m) console.log(`  ${k} = ${m[1]}`);
  }
  const i = page.text.indexOf('phApp');
  if (i >= 0) console.log('phApp snippet:', snip(page.text.slice(i, i + 1500)));
  if (!markers.includes('phApp')) return;

  const cfg = (k) => page.text.match(new RegExp(`"${k}"\\s*:\\s*"([^"]{0,120})"`))?.[1];
  const origin = new URL(page.url).origin;
  const body = {
    lang: cfg('locale') || 'en_us',
    deviceType: 'desktop',
    country: cfg('country') || 'us',
    pageName: 'search-results',
    ddoKey: 'refineSearch',
    sortBy: '',
    subsearch: '',
    from: 0,
    jobs: true,
    counts: true,
    all_fields: ['category', 'country', 'state', 'city'],
    size: 3,
    clearAll: false,
    jdsource: 'facets',
    isSliderEnable: false,
    pageId: cfg('pageId') || 'page20',
    siteType: cfg('siteType') || 'external',
    keywords: 'engineer',
    global: true,
    selected_fields: {},
    locationData: {},
  };
  if (cfg('refNum')) body.refNum = cfg('refNum');
  const csrf = cfg('csrfToken');
  for (const withCsrf of [false, true]) {
    if (withCsrf && !csrf) continue;
    try {
      const res = await get(`${origin}/widgets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(withCsrf ? { 'x-csrf-token': csrf } : {}) },
        body: JSON.stringify(body),
      });
      console.log(`POST /widgets (csrf ${withCsrf}) ->`, res.status, snip(res.text, 300));
      try {
        const json = JSON.parse(res.text);
        console.log('shape', JSON.stringify(keysDeep(json)).slice(0, 2500));
        const job = json?.refineSearch?.data?.jobs?.[0];
        if (job) console.log('first job', JSON.stringify(job).slice(0, 2500));
        console.log('hits', json?.refineSearch?.hits, 'totalHits', json?.refineSearch?.totalHits);
      } catch {
        // not JSON
      }
    } catch (err) {
      console.log('POST failed', err.message);
    }
  }
}

async function probeAmazon() {
  console.log('\n=== amazon.jobs');
  try {
    const res = await get('https://www.amazon.jobs/en/search.json?base_query=software%20development%20engineer&result_limit=3&offset=0');
    console.log('search.json', res.status, res.headers['content-type']);
    const json = JSON.parse(res.text);
    console.log('shape', JSON.stringify(keysDeep(json)).slice(0, 2500));
    const job = json.jobs?.[0];
    if (job) {
      const short = Object.fromEntries(Object.entries(job).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 120) : v]));
      console.log('first job', JSON.stringify(short).slice(0, 3000));
      const page = await get(`https://www.amazon.jobs${job.job_path}`);
      console.log('job page', page.status, page.url, 'JobPosting json-ld:', page.text.includes('"JobPosting"'));
      const byId = await get(`https://www.amazon.jobs/en/search.json?base_query=${job.id_icims}&result_limit=3`);
      const ids = JSON.parse(byId.text).jobs?.map((j) => j.id_icims);
      console.log('search by id', job.id_icims, '->', ids);
    }
    const gone = await get('https://www.amazon.jobs/en/jobs/1000001/removed-job');
    console.log('removed job page', gone.status, gone.url, 'bytes', gone.text.length);
    const sitemap = await get('https://www.amazon.jobs/robots.txt');
    console.log('robots', sitemap.status, snip(sitemap.text, 600));
  } catch (err) {
    console.log('amazon failed', err.message);
  }
}

for (const url of PHENOM_CANDIDATES) await probePhenom(url);
await probeAmazon();
