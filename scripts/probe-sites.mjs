#!/usr/bin/env node
/**
 * Live check of the careers-site searches GhostCheck uses (amazon.jobs and
 * Phenom sites), through the same parsers as the extension. Informational:
 * prints what each site answers; the workflow does not fail on it.
 */
import { fetchJson, fetchText } from '../core/http.js';
import { amazonSearchUrl, amazonSite, parseAmazon, parsePhenom, phenomSearchBody, phenomSite } from '../core/sources/site-search.js';

const PHENOM_SITES = ['https://careers.mastercard.com/us/en/', 'https://jobs.thermofisher.com/global/en/'];

async function phenom(url) {
  const page = await fetchText(url, { timeoutMs: 20000 });
  const site = phenomSite(page.text, page.url);
  if (!site) return console.log(`phenom   ${url}: no Phenom config (HTTP ${page.status})`);
  const first = parsePhenom(await fetchJson(site.endpoint, { method: 'POST', body: phenomSearchBody(site, 'engineer', 5) }), site);
  if (!first.length) return console.log(`phenom   ${url}: search returned no jobs`);
  const p = first[0];
  // Search again for that title and job id: the extension's two queries.
  const byTitle = parsePhenom(await fetchJson(site.endpoint, { method: 'POST', body: phenomSearchBody(site, p.title) }), site);
  const byId = parsePhenom(await fetchJson(site.endpoint, { method: 'POST', body: phenomSearchBody(site, p.id) }), site);
  const job = await fetchText(p.url, { timeoutMs: 20000 });
  console.log(
    `phenom   ${url}: "${p.title}" (${p.id}) @ ${p.location}, posted ${p.createdAt?.slice(0, 10)}; ` +
      `title search ${byTitle.some((x) => x.id === p.id) ? 'finds it' : 'MISSES it'}, id search ${byId.some((x) => x.id === p.id) ? 'finds it' : 'misses it'}; ` +
      `job page ${p.url} -> HTTP ${job.status}`,
  );
}

async function amazon() {
  const [p] = parseAmazon(await fetchJson(amazonSearchUrl('software development engineer', 5)));
  if (!p) return console.log('amazon   search returned no jobs');
  const site = amazonSite(p.url);
  const byId = parseAmazon(await fetchJson(amazonSearchUrl(site.jobId, 5)));
  console.log(`amazon   "${p.title}" (${p.id}) @ ${p.location}, posted ${p.createdAt?.slice(0, 10)}; id search ${byId.some((x) => x.id === p.id) ? 'finds it' : 'MISSES it'}`);
}

for (const url of PHENOM_SITES) await phenom(url).catch((err) => console.log(`phenom   ${url}: ${err.message}`));
await amazon().catch((err) => console.log(`amazon   ${err.message}`));
