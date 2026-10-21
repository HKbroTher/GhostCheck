#!/usr/bin/env node
/**
 * Exploratory probe of more careers systems and of Wikidata, to build their
 * sources from real responses. Prints shapes; never fails the build.
 */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const snip = (s, n = 800) => String(s).replace(/\s+/g, ' ').slice(0, n);

async function get(url, init = {}) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), ...init, headers: { 'user-agent': UA, accept: 'application/json, text/html;q=0.9', ...(init.headers || {}) } });
  return { status: res.status, url: res.url, text: await res.text(), type: res.headers.get('content-type') };
}

function keysDeep(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return typeof obj;
  if (Array.isArray(obj)) return [obj.length, keysDeep(obj[0], depth + 1)];
  return Object.fromEntries(Object.entries(obj).slice(0, 45).map(([k, v]) => [k, keysDeep(v, depth + 1)]));
}

async function step(name, fn) {
  console.log(`\n=== ${name}`);
  try {
    await fn();
  } catch (err) {
    console.log('failed', err.message);
  }
}

await step('SmartRecruiters', async () => {
  for (const company of ['Visa', 'BoschGroup', 'ServiceNow', 'Ubisoft2']) {
    const r = await get(`https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=2`);
    console.log(company, r.status, snip(r.text, 200));
    if (r.status !== 200) continue;
    const json = JSON.parse(r.text);
    console.log('shape', JSON.stringify(keysDeep(json)).slice(0, 2000));
    const p = json.content?.[0];
    if (p) {
      console.log('first', JSON.stringify(p).slice(0, 1500));
      const d = await get(`https://api.smartrecruiters.com/v1/companies/${company}/postings/${p.id}`);
      const dj = JSON.parse(d.text);
      console.log('detail', d.status, 'keys', Object.keys(dj).join(', '), 'postingUrl', dj.postingUrl, 'applyUrl', dj.applyUrl);
      const gone = await get(`https://api.smartrecruiters.com/v1/companies/${company}/postings/999999999999`);
      console.log('removed posting ->', gone.status);
      const page = await get(dj.postingUrl || `https://jobs.smartrecruiters.com/${company}/${p.id}`);
      console.log('job page', page.status, page.url);
    }
    const missing = await get('https://api.smartrecruiters.com/v1/companies/thiscompanydoesnotexist12345/postings?limit=1');
    console.log('unknown company ->', missing.status, snip(missing.text, 200));
    break;
  }
});

await step('Oracle Recruiting Cloud', async () => {
  for (const start of ['https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers', 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001']) {
    const page = await get(start);
    const site = page.text.match(/siteNumber\W{1,6}([A-Za-z0-9_]+)/)?.[1] || start.split('/sites/')[1];
    console.log(start, page.status, page.url, 'siteNumber', site, 'apiBase', page.text.match(/hcmRestApi[^"'\s]{0,80}/)?.[0]);
    const origin = new URL(page.url).origin;
    const url = `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},limit=3,keyword=%22engineer%22,sortBy=POSTING_DATES_DESC`;
    const r = await get(url);
    console.log('search', r.status, r.type, snip(r.text, 300));
    if (r.status !== 200) continue;
    const json = JSON.parse(r.text);
    console.log('shape', JSON.stringify(keysDeep(json)).slice(0, 2500));
    const item = json.items?.[0];
    console.log('TotalJobsCount', item?.TotalJobsCount);
    const req = item?.requisitionList?.[0];
    if (req) {
      console.log('first', JSON.stringify(req).slice(0, 1500));
      const det = await get(`${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${req.Id}%22,siteNumber=${site}`);
      const dj = JSON.parse(det.text);
      const d = dj.items?.[0];
      console.log('detail', det.status, d ? Object.keys(d).join(', ') : snip(det.text, 300));
      if (d) console.log('detail sample', JSON.stringify({ Title: d.Title, ExternalPostedStartDate: d.ExternalPostedStartDate, PrimaryLocation: d.PrimaryLocation, desc: String(d.ExternalDescriptionStr || '').slice(0, 200) }));
      const gone = await get(`${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22999999999%22,siteNumber=${site}`);
      console.log('removed ->', gone.status, snip(gone.text, 200));
      console.log('job page', `${origin}/hcmUI/CandidateExperience/en/sites/${site}/job/${req.Id}`);
    }
  }
});

await step('SuccessFactors (RMK sites)', async () => {
  for (const origin of ['https://jobs.sap.com', 'https://careers.underarmour.com']) {
    const robots = await get(`${origin}/robots.txt`);
    console.log(origin, 'robots', robots.status, snip(robots.text, 300));
    const sm = await get(`${origin}/sitemap.xml`);
    const locs = sm.text.match(/<loc>[^<]+<\/loc>/g) || [];
    console.log('sitemap', sm.status, locs.length, 'locs', locs.slice(0, 3).join(' '));
    const page = await get(`${origin}/search/?q=engineer`);
    console.log('search page', page.status, 'job links', (page.text.match(/href="\/job\/[^"]+"/g) || []).slice(0, 3).join(' '), 'JobPosting', page.text.includes('JobPosting'));
    const job = page.text.match(/href="(\/job\/[^"]+)"/)?.[1];
    if (job) {
      const jp = await get(origin + job);
      console.log('job page', jp.status, jp.url, 'JobPosting json-ld', jp.text.includes('"JobPosting"'), 'datePosted', jp.text.match(/datePosted[^,]{0,40}/)?.[0], 'itemprop', jp.text.match(/itemprop="datePosted"[^>]{0,80}/)?.[0]);
    }
  }
});

await step('Wikidata', async () => {
  for (const name of ['FedEx', 'Stripe', 'Mastercard', 'Sakana AI', 'Notion', 'Cyient']) {
    const s = await get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&uselang=en&type=item&limit=5&format=json`);
    const hits = JSON.parse(s.text).search || [];
    console.log(name, '->', hits.map((h) => `${h.id} "${h.label}" (${h.description || ''})`).join(' | '));
    const ids = hits.map((h) => h.id).join('|');
    if (!ids) continue;
    const e = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=claims&format=json`);
    const ents = JSON.parse(e.text).entities;
    for (const [id, ent] of Object.entries(ents)) {
      const site = ent.claims?.P856?.map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
      const types = ent.claims?.P31?.map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
      console.log(`   ${id} P856=${JSON.stringify(site)} P31=${JSON.stringify(types)}`);
    }
  }
});
