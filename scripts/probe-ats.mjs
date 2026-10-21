#!/usr/bin/env node
/**
 * Exploratory probe of more careers systems, to build their sources from
 * real responses. Prints shapes; never fails the build.
 */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const snip = (s, n = 800) => String(s).replace(/\s+/g, ' ').slice(0, n);

async function get(url, init = {}) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), ...init, headers: { 'user-agent': UA, accept: 'application/json, text/html;q=0.9', ...(init.headers || {}) } });
  return { status: res.status, url: res.url, text: await res.text(), type: res.headers.get('content-type') };
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
  for (const company of ['BoschGroup', 'Ubisoft2', 'IKEA', 'ServiceNow', 'Visa', 'LVMH', 'Equinox', 'WesternDigital', 'Sodexo', 'Avature']) {
    const r = await get(`https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=2`);
    const json = JSON.parse(r.text);
    console.log(company, r.status, 'totalFound', json.totalFound);
    const p = json.content?.[0];
    if (!p) continue;
    console.log('first', JSON.stringify(p).slice(0, 1500));
    const d = await get(`https://api.smartrecruiters.com/v1/companies/${company}/postings/${p.id}`);
    const dj = JSON.parse(d.text);
    console.log('detail', d.status, 'keys', Object.keys(dj).join(', '));
    console.log('detail urls', dj.postingUrl, dj.applyUrl, 'company', JSON.stringify(dj.company), 'released', dj.releasedDate);
    console.log('jobAd sections', Object.keys(dj.jobAd?.sections || {}).join(', '));
    const gone = await get(`https://api.smartrecruiters.com/v1/companies/${company}/postings/999999999999`);
    console.log('removed posting ->', gone.status, snip(gone.text, 150));
    const q = await get(`https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=3&q=${encodeURIComponent(p.name)}`);
    console.log('q search', q.status, JSON.parse(q.text).content?.map((x) => x.name).join(' | '));
    const page = await get(dj.postingUrl || `https://jobs.smartrecruiters.com/${company}/${p.id}`);
    console.log('job page', page.status, page.url);
    break;
  }
});

await step('Workable widget name', async () => {
  const r = await get('https://apply.workable.com/api/v1/widget/accounts/sakana-ai');
  const j = JSON.parse(r.text);
  console.log('keys', Object.keys(j).join(', '), 'name', j.name);
});

await step('SuccessFactors job page markup', async () => {
  const page = await get('https://careers.underarmour.com/search/?q=engineer');
  const job = page.text.match(/href="(\/job\/[^"]+)"/)?.[1];
  const jp = await get(`https://careers.underarmour.com${job}`);
  const props = [...jp.text.matchAll(/itemprop="([a-zA-Z]+)"[^>]{0,200}/g)].map((m) => snip(m[0], 160));
  console.log('itemprops', props.slice(0, 25).join('\n  '));
  console.log('itemtype', jp.text.match(/itemtype="[^"]+"/g)?.slice(0, 5));
});
