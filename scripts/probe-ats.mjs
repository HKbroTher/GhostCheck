#!/usr/bin/env node
/**
 * Live check of finding a careers site from a company name, through the same
 * code as the extension: Wikidata -> official website -> careers page -> ATS.
 * Informational: prints what each step finds; the workflow does not fail on it.
 */
import { fetchJson, fetchText } from '../core/http.js';
import { careersCandidates, pickCompanyWebsite, wikidataEntitiesUrl, wikidataSearchUrl } from '../core/wikidata.js';
import { discoverAts } from '../core/discover.js';
import { phenomSite } from '../core/sources/site-search.js';

const COMPANIES = ['FedEx', 'Stripe', 'Mastercard', 'Sakana AI', 'Notion', 'Cyient', 'Thermo Fisher Scientific'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const company of COMPANIES) {
  try {
    const search = await fetchJson(wikidataSearchUrl(company));
    await sleep(1200); // Wikidata rate limit
    const ids = (search?.search || []).map((h) => h.id);
    const site = ids.length ? pickCompanyWebsite(company, search, await fetchJson(wikidataEntitiesUrl(ids))) : null;
    await sleep(1200);
    if (!site) {
      console.log(`website  ${company}: none found (${ids.length} Wikidata hits)`);
      continue;
    }
    let found = 'no careers page';
    for (const url of careersCandidates(site.url)) {
      const page = await fetchText(url, { timeoutMs: 15000 }).catch(() => null);
      if (!page?.ok) continue;
      const ref = discoverAts(page.text).refs[0]?.ref;
      const phenom = phenomSite(page.text, page.url);
      found = `${url} -> ${page.url}: ${ref ? `${ref.ats}/${ref.slug}` : phenom ? 'Phenom job search' : 'no ATS found'}`;
      break;
    }
    console.log(`website  ${company}: ${site.url} (${site.id}); careers ${found}`);
  } catch (err) {
    console.log(`website  ${company}: ${err.message}`);
  }
}
