import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkJob } from '../core/check.js';
import { parseRules } from '../core/rules.js';
import { buildCompanyIndex } from '../core/companies.js';
import { HttpError } from '../core/http.js';
import { SOURCES } from '../core/sources/index.js';

const rules = parseRules(readFileSync(new URL('../rules.yaml', import.meta.url), 'utf8'));
const ghPostings = SOURCES.greenhouse.parse(
  JSON.parse(readFileSync(new URL('./fixtures/greenhouse.json', import.meta.url), 'utf8')),
);
const companies = buildCompanyIndex({
  version: 1,
  companies: [{ name: 'Acme', linkedin: ['acme-inc'], ats: 'greenhouse', slug: 'acme' }],
});
const NOW = () => new Date('2026-10-21T00:00:00Z');
const LONG_JD = 'You will join our Payments Platform team and build the ledger. '.repeat(10);

const job = (over = {}) => ({
  jobId: '1',
  title: 'Senior Software Engineer - Payments',
  company: 'Acme',
  linkedinCompanySlug: 'acme-inc',
  location: 'San Francisco, CA',
  salaryText: '',
  description: LONG_JD,
  applyType: 'external',
  applyHref: `https://www.linkedin.com/redir/redirect?url=${encodeURIComponent('https://boards.greenhouse.io/acme/jobs/5551234')}`,
  ...over,
});

function deps(over = {}) {
  const calls = [];
  return {
    calls,
    rules,
    companies,
    now: NOW,
    fetchPostings: async (ref) => {
      calls.push(ref);
      return ghPostings;
    },
    ...over,
  };
}

test('found via apply link id -> green with official link and reasons', async () => {
  const d = deps();
  const r = await checkJob(job(), d);
  assert.equal(r.badge, 'green');
  assert.equal(r.officialUrl, 'https://boards.greenhouse.io/acme/jobs/5551234');
  assert.deepEqual(d.calls[0], { ats: 'greenhouse', slug: 'acme', jobId: '5551234', region: null });
  const ids = r.reasons.map((x) => x.id);
  assert.ok(ids.includes('found_on_official_site'));
  assert.ok(ids.includes('posted_recently')); // first_published 20 days before NOW
  assert.ok(ids.includes('salary_listed')); // pay range is in the official posting text
  assert.ok(r.reasons.length >= 3 && r.reasons.length <= 5);
});

test('easy apply resolved through companies.json by LinkedIn id', async () => {
  const d = deps();
  const r = await checkJob(job({ applyType: 'easy', applyHref: null }), d);
  assert.equal(d.calls[0].slug, 'acme');
  assert.equal(r.detected.boardSource, 'GhostCheck company list');
  assert.equal(r.badge, 'green');
});

test('not on the board -> red (board from a trusted source)', async () => {
  const r = await checkJob(job({ title: 'Data Scientist', description: '', applyHref: null, applyType: 'easy' }), deps());
  assert.equal(r.badge, 'red');
  assert.equal(r.reasons[0].id, 'not_found_on_official_site');
  assert.equal(r.officialUrl, 'https://job-boards.greenhouse.io/acme');
});

test('apply link id no longer listed -> apply_link_closed', async () => {
  const href = 'https://boards.greenhouse.io/acme/jobs/1';
  const r = await checkJob(job({ title: 'Data Scientist', description: '', applyHref: href }), deps());
  assert.equal(r.badge, 'red');
  assert.equal(r.reasons[0].id, 'apply_link_closed');
});

test('network failure -> unknown, never negative', async () => {
  const d = deps({
    fetchPostings: async () => {
      throw new HttpError('timeout', 'timed out');
    },
  });
  const r = await checkJob(job({ title: 'Data Scientist' }), d);
  assert.equal(r.badge, 'unknown');
  assert.match(r.reasons[0].text, /not evidence against the job/);
  assert.ok(!r.reasons.some((x) => x.polarity === 'negative'));
});

test('board 404 -> unknown', async () => {
  const d = deps({
    fetchPostings: async () => {
      throw new HttpError('http', 'nope', 404);
    },
  });
  const r = await checkJob(job(), d);
  assert.equal(r.badge, 'unknown');
  assert.match(r.reasons[0].text, /was not found/);
});

test('empty board -> unknown', async () => {
  const r = await checkJob(job(), deps({ fetchPostings: async () => [] }));
  assert.equal(r.badge, 'unknown');
});

test('unknown company with easy apply -> unknown', async () => {
  const r = await checkJob(job({ company: 'Nobody Corp', linkedinCompanySlug: 'nobody', applyHref: null, applyType: 'easy' }), deps());
  assert.equal(r.badge, 'unknown');
  assert.match(r.reasons[0].text, /Easy Apply/);
});

test('guessed board: found counts, not-found does not', async () => {
  const base = {
    companies: buildCompanyIndex({ version: 1, companies: [] }),
    fetchBoardName: async ({ slug }) => (slug === 'acme' ? 'Acme, Inc.' : null),
  };
  const found = await checkJob(job({ applyHref: null, applyType: 'easy' }), deps(base));
  assert.equal(found.badge, 'green');
  assert.equal(found.detected.boardSource, 'matched by company name');

  const missing = await checkJob(job({ title: 'Data Scientist', applyHref: null, applyType: 'easy' }), deps(base));
  assert.equal(missing.badge, 'unknown');
});

test('guessed board with a different company name is rejected', async () => {
  const d = deps({
    companies: buildCompanyIndex({ version: 1, companies: [] }),
    fetchBoardName: async () => 'Acme Robotics',
  });
  const r = await checkJob(job({ applyHref: null, applyType: 'easy' }), d);
  assert.equal(r.badge, 'unknown');
  assert.equal(d.calls.length, 0);
});

test('similar job in another location -> unknown with explanation', async () => {
  const r = await checkJob(job({ applyHref: null, applyType: 'easy', location: 'London, United Kingdom' }), deps());
  assert.equal(r.badge, 'unknown');
  assert.match(r.reasons[0].text, /different location/);
});

test('workday link -> unknown until supported', async () => {
  const href = 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/NY/Engineer_R1';
  const r = await checkJob(job({ company: 'Other', linkedinCompanySlug: null, applyHref: href }), deps());
  assert.equal(r.badge, 'unknown');
  assert.match(r.reasons[0].text, /Workday/);
});

test('unmatchable title -> unknown', async () => {
  const r = await checkJob(job({ title: '---', applyHref: null, applyType: 'easy' }), deps());
  assert.equal(r.badge, 'unknown');
});

// ------------------------------------------------------------- stage 3: age

test('snapshot baseline older than 90 days -> long-listed and re-posted', async () => {
  const d = deps({
    fetchFirstSeen: async () => ({
      version: 1, ats: 'greenhouse', slug: 'acme', since: '2026-05-01',
      jobs: { 5551234: { t: 'Senior Software Engineer, Payments', f: '2026-05-01' } },
    }),
  });
  const r = await checkJob(job(), d);
  const ids = r.reasons.map((x) => x.id);
  assert.ok(ids.includes('posted_long_ago'));
  assert.ok(!ids.includes('posted_recently'));
  assert.match(r.reasons.find((x) => x.id === 'posted_long_ago').text, /at least 173 days, according to GhostCheck's daily snapshots/);
  assert.ok(ids.includes('reposted_to_look_new'));
  // found +3, pay +1, team +1, long-listed -2, re-posted -1 = 2
  assert.equal(r.score, 2);
  assert.equal(r.badge, 'yellow');
});

test('wayback capture of the LinkedIn page counts as evidence', async () => {
  const asked = [];
  const d = deps({
    fetchWayback: async (url) => {
      asked.push(url);
      return url.includes('linkedin.com') ? '2026-01-01T00:00:00.000Z' : null;
    },
  });
  const r = await checkJob(job(), d);
  assert.deepEqual(asked.sort(), ['https://boards.greenhouse.io/acme/jobs/5551234', 'https://www.linkedin.com/jobs/view/1/']);
  assert.ok(r.reasons.some((x) => x.id === 'posted_long_ago' && /Wayback Machine/.test(x.text)));
});

test('age lookups failing never hurts the verdict', async () => {
  const fail = async () => {
    throw new HttpError('network', 'down');
  };
  const r = await checkJob(job(), deps({ fetchFirstSeen: fail, fetchWayback: fail }));
  assert.equal(r.badge, 'green');
  assert.ok(r.reasons.some((x) => x.id === 'posted_recently')); // falls back to the ATS date
});

// ------------------------------------------------- stage 4: workday + pages

import { workdayRef } from '../core/sources/workday.js';

const WD_HREF = 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Senior-Software-Engineer_R1';
const wdPosting = (over = {}) => ({
  id: '/job/New-York-NY/Senior-Software-Engineer_R1',
  title: 'Senior Software Engineer, Payments',
  location: 'San Francisco, CA',
  url: 'https://acme.wd5.myworkdayjobs.com/External/job/New-York-NY/Senior-Software-Engineer_R1',
  createdAt: '2026-10-11T00:00:00.000Z',
  createdAtExact: true,
  salary: null,
  text: '',
  ...over,
});

test('workday: apply link posting found directly', async () => {
  const d = deps({ fetchWorkdayDetail: async () => wdPosting(), searchWorkday: async () => assert.fail('no search needed') });
  const r = await checkJob(job({ company: 'Other', linkedinCompanySlug: null, applyHref: WD_HREF }), d);
  assert.equal(r.badge, 'green');
  assert.equal(r.detected.ats, 'Workday');
  assert.ok(r.reasons.some((x) => x.id === 'posted_recently'));
});

test('workday: apply link posting removed (404) -> closed', async () => {
  const d = deps({
    fetchWorkdayDetail: async () => {
      throw new HttpError('http', 'gone', 404);
    },
    searchWorkday: async () => assert.fail('no search needed'),
  });
  const r = await checkJob(job({ company: 'Other', linkedinCompanySlug: null, applyHref: WD_HREF, description: '' }), d);
  assert.equal(r.badge, 'red');
  assert.equal(r.reasons[0].id, 'apply_link_closed');
});

const wdCompanies = buildCompanyIndex({
  companies: [{ name: 'Acme', ats: 'workday', slug: 'acme', workday: { host: 'acme.wd5.myworkdayjobs.com', site: 'External' } }],
});
const easy = { applyHref: null, applyType: 'easy' };

test('workday: large board, search misses -> unknown (not counted)', async () => {
  const d = deps({ companies: wdCompanies, searchWorkday: async () => ({ postings: [], complete: false, total: 2400 }) });
  const r = await checkJob(job({ ...easy, title: 'Data Scientist' }), d);
  assert.equal(r.badge, 'unknown');
  assert.match(r.reasons[0].text, /can't be checked completely/);
});

test('workday: small board listed completely, missing -> red', async () => {
  const d = deps({ companies: wdCompanies, searchWorkday: async () => ({ postings: [wdPosting()], complete: true, total: 1 }) });
  const r = await checkJob(job({ ...easy, title: 'Data Scientist', description: '' }), d);
  assert.equal(r.badge, 'red');
  assert.equal(r.reasons[0].id, 'not_found_on_official_site');
});

test('workday: search hit is enriched with details', async () => {
  const d = deps({
    companies: wdCompanies,
    searchWorkday: async () => ({ postings: [wdPosting({ createdAt: null, text: '' })], complete: false, total: 500 }),
    fetchWorkdayDetail: async () => wdPosting({ text: 'Base pay range: 150,000 - 190,000 USD' }),
  });
  const r = await checkJob(job({ ...easy, description: '' }), d);
  assert.equal(r.badge, 'green');
  assert.ok(r.reasons.some((x) => x.id === 'salary_listed'));
  assert.ok(r.reasons.some((x) => x.id === 'posted_recently'));
});

test('workday: unreachable -> unknown', async () => {
  const d = deps({
    companies: wdCompanies,
    searchWorkday: async () => {
      throw new HttpError('timeout', 'slow');
    },
  });
  assert.equal((await checkJob(job(easy), d)).badge, 'unknown');
});

const PAGE_HREF = 'https://careers.acme.com/jobs/123';
const pageDeps = (over = {}) =>
  deps({
    companies: buildCompanyIndex({ companies: [] }),
    fetchBoardName: async () => null,
    hasOriginPermission: async () => true,
    fetchPageJobs: async () => ({ status: 200, ok: true, url: PAGE_HREF, postings: [] }),
    fetchSitemapUrls: async () => null,
    ...over,
  });
const ldPosting = (over = {}) => ({
  title: 'Senior Software Engineer - Payments',
  datePosted: '2026-10-05T00:00:00.000Z',
  validThrough: null,
  orgName: 'Acme, Inc.',
  location: 'San Francisco, CA',
  url: PAGE_HREF,
  text: '',
  salary: null,
  ...over,
});

test('self-hosted: no permission yet -> unknown with an allow button', async () => {
  const r = await checkJob(job({ applyHref: PAGE_HREF }), pageDeps({ hasOriginPermission: async () => false }));
  assert.equal(r.badge, 'unknown');
  assert.equal(r.action.type, 'grant-origin');
  assert.equal(r.action.origin, 'https://careers.acme.com');
});

test('self-hosted: JSON-LD JobPosting confirms the job', async () => {
  const r = await checkJob(job({ applyHref: PAGE_HREF }), pageDeps({ fetchPageJobs: async () => ({ status: 200, ok: true, url: PAGE_HREF, postings: [ldPosting()] }) }));
  assert.equal(r.badge, 'green');
  assert.equal(r.officialUrl, PAGE_HREF);
  assert.ok(r.reasons.some((x) => x.id === 'posted_recently'));
});

test('self-hosted: JSON-LD from a different company is not proof', async () => {
  const href = 'https://jobs.staffingpartners.com/123';
  const r = await checkJob(
    job({ applyHref: href }),
    pageDeps({ fetchPageJobs: async () => ({ status: 200, ok: true, url: href, postings: [ldPosting({ orgName: 'Staffing Partners LLC' })] }) }),
  );
  assert.equal(r.badge, 'unknown');
  assert.match(r.reasons[0].text, /Staffing Partners/);
});

test("self-hosted: the company's own domain is trusted whatever legal entity it names (FedEx)", async () => {
  const href = 'https://careers.fedex.com/job/123';
  const page = async () => ({ status: 200, ok: true, url: href, postings: [ldPosting({ orgName: 'Federal Express Corporation AMEA' })] });
  const r = await checkJob(job({ company: 'FedEx', applyHref: href }), pageDeps({ fetchPageJobs: page }));
  assert.equal(r.badge, 'green');
  // A regional entity of the same company name is the same company on any domain.
  const r2 = await checkJob(
    job({ company: 'Federal Express', applyHref: 'https://jobs.example-hr.com/1' }),
    pageDeps({ fetchPageJobs: async () => ({ ...(await page()), url: 'https://jobs.example-hr.com/1' }) }),
  );
  assert.equal(r2.badge, 'green');
});

test('self-hosted: 404 apply page -> closed; 5xx -> unknown', async () => {
  const gone = await checkJob(job({ applyHref: PAGE_HREF }), pageDeps({ fetchPageJobs: async () => ({ status: 404, ok: false, url: PAGE_HREF, postings: [] }) }));
  assert.equal(gone.reasons[0].id, 'apply_link_closed');
  const err = await checkJob(job({ applyHref: PAGE_HREF }), pageDeps({ fetchPageJobs: async () => ({ status: 503, ok: false, url: PAGE_HREF, postings: [] }) }));
  assert.equal(err.badge, 'unknown');
});

test('self-hosted: no JSON-LD but listed in sitemap -> found; not listed -> unknown, never not-found', async () => {
  const listed = await checkJob(job({ applyHref: PAGE_HREF }), pageDeps({ fetchSitemapUrls: async () => new Set(['https://careers.acme.com/jobs/123']) }));
  assert.equal(listed.signals.found_on_official_site, true);
  const missing = await checkJob(job({ applyHref: PAGE_HREF }), pageDeps({ fetchSitemapUrls: async () => new Set(['https://careers.acme.com/jobs/9']) }));
  assert.equal(missing.badge, 'unknown');
  assert.equal(missing.signals.not_found_on_official_site, null);
});

// ------------------------------------------- careers page linking to an ATS

test('careers page without job data, but its Apply button goes to Greenhouse -> checked there', async () => {
  const discovered = { refs: [{ ref: { ats: 'greenhouse', slug: 'acme', jobId: '5551234', region: null }, count: 1 }], unsupported: [] };
  const d = pageDeps({ fetchPageJobs: async () => ({ status: 200, ok: true, url: PAGE_HREF, postings: [], discovered }) });
  const r = await checkJob(job({ applyHref: PAGE_HREF }), d);
  assert.equal(r.badge, 'green');
  assert.equal(r.detected.ats, 'Greenhouse');
  assert.equal(r.detected.boardSource, 'link on careers.acme.com');
  assert.ok(r.reasons.some((x) => /careers\.acme\.com uses Greenhouse/.test(x.text)));
});

test('careers page linking to a board without this job: confirms only, never "not found"', async () => {
  // A link on a page may be a footer link, an old board or a subsidiary's:
  // the company's own site may list the job elsewhere.
  const discovered = { refs: [{ ref: { ats: 'greenhouse', slug: 'acme', jobId: null, region: null }, count: 3 }], unsupported: [] };
  const d = pageDeps({ fetchPageJobs: async () => ({ status: 200, ok: true, url: PAGE_HREF, postings: [], discovered }) });
  const r = await checkJob(job({ applyHref: PAGE_HREF, title: 'Data Scientist', description: '' }), d);
  assert.equal(r.badge, 'unknown');
  assert.equal(r.signals.not_found_on_official_site, null);
  assert.ok(r.checks.some((c) => c.label === 'Greenhouse · acme' && c.status === 'unknown'));
});

test('the apply page shows the job: real, whatever the board linked from it says (all checks, any one finds it)', async () => {
  const discovered = { refs: [{ ref: { ats: 'greenhouse', slug: 'acme', jobId: null, region: null }, count: 3 }], unsupported: [] };
  const page = {
    status: 200, ok: true, url: PAGE_HREF, postings: [], discovered,
    texts: ['Data Scientist, Fraud | Acme Careers', 'Data Scientist, Fraud', 'Acme Careers'], siteName: 'Acme Careers',
  };
  const r = await checkJob(job({ applyHref: PAGE_HREF, title: 'Data Scientist, Fraud', description: '' }), pageDeps({ fetchPageJobs: async () => page }));
  assert.equal(r.badge, 'green');
  assert.equal(r.signals.found_on_official_site, true);
  const byLabel = Object.fromEntries(r.checks.map((c) => [c.label, c.status]));
  assert.equal(byLabel['Apply page on careers.acme.com'], 'found');
  assert.equal(byLabel['Greenhouse · acme'], 'unknown');
});

test('a page on another domain that only names the job is not proof', async () => {
  const href = 'https://jobs.staffingpartners.com/123';
  const page = { status: 200, ok: true, url: href, postings: [], texts: ['Data Scientist, Fraud'], siteName: 'Staffing Partners' };
  const r = await checkJob(job({ applyHref: href, title: 'Data Scientist, Fraud', description: '' }), pageDeps({ fetchPageJobs: async () => page }));
  assert.equal(r.signals.found_on_official_site, null);
});

test('careers page using an unsupported ATS says which one', async () => {
  const discovered = { refs: [], unsupported: ['HERP'] };
  const d = pageDeps({ fetchPageJobs: async () => ({ status: 200, ok: true, url: PAGE_HREF, postings: [], discovered }) });
  const r = await checkJob(job({ applyHref: PAGE_HREF }), d);
  assert.equal(r.badge, 'unknown');
  assert.match(r.reasons[0].text, /HERP, which GhostCheck can't check yet/);
  assert.equal(r.detected.unsupportedAts, 'HERP');
});

test('Japanese LinkedIn title, English-only board: unknown, never "not found"', async () => {
  const r = await checkJob(job({ title: 'シニアソフトウェアエンジニア', description: '', applyHref: null, applyType: 'easy' }), deps());
  assert.equal(r.badge, 'unknown');
  assert.equal(r.signals.not_found_on_official_site, null);
  assert.match(r.reasons[0].text, /different language/);
});

test('Chinese output: badge, reasons and notes', async () => {
  const r = await checkJob(job(), deps({ lang: 'zh' }));
  assert.equal(r.label, '可信');
  assert.equal(r.lang, 'zh');
  assert.ok(r.reasons.some((x) => x.text === '该职位在Acme的官网招聘页上能找到。'));
  assert.ok(r.reasons.some((x) => /已核对 Greenhouse 上的/.test(x.text)));
  const u = await checkJob(job({ company: 'Nobody', linkedinCompanySlug: null, applyHref: null, applyType: 'easy' }), deps({ lang: 'zh' }));
  assert.equal(u.label, '无法确认');
  assert.match(u.reasons[0].text, /Easy Apply 职位/);
});

test('permission prompt offers this site or all careers sites', async () => {
  const r = await checkJob(job({ applyHref: PAGE_HREF }), pageDeps({ hasOriginPermission: async () => false }));
  assert.equal(r.action.label, 'Allow checking careers.acme.com');
  assert.equal(r.action.allLabel, "Allow all careers sites (don't ask again)");
});

test('job board apply link: never read as the official site', async () => {
  const href = 'https://www.liepin.com/job/1970000000.shtml';
  const fetched = [];
  const r = await checkJob(
    job({ company: 'Unlisted Co', linkedinCompanySlug: null, applyHref: href }),
    pageDeps({
      fetchPageJobs: async (url) => {
        fetched.push(url);
        return { status: 200, ok: true, url: href, postings: [ldPosting()] };
      },
    }),
  );
  assert.equal(fetched.some((u) => u.includes('liepin')), false, 'the job board page is not read');
  assert.equal(r.badge, 'unknown');
  assert.equal(r.signals.found_on_official_site, null);
  assert.match(r.reasons[0].text, /Liepin \(猎聘\), a job board/);
  assert.equal(r.detected.jobBoard, 'Liepin (猎聘)');
});

test('job board apply link: the company is still checked through companies.json', async () => {
  const d = deps();
  const r = await checkJob(job({ applyHref: 'https://jp.indeed.com/viewjob?jk=1' }), d);
  assert.equal(d.calls[0].slug, 'acme');
  assert.equal(r.badge, 'green');
  assert.ok(r.reasons.some((x) => /Indeed, a job board/.test(x.text)));
});

test('a malformed % escape in the apply link does not break the check', async () => {
  const href = 'https://www.amazon.jobs/en/jobs/123/100%-remote-engineer';
  const r = await checkJob(job({ applyHref: href }), pageDeps({ fetchPageJobs: async () => ({ status: 200, ok: true, url: href, postings: [ldPosting()] }) }));
  assert.equal(r.badge, 'green');
});

test('failed lookups are reported for the console, and still only give ⚪', async () => {
  const r = await checkJob(
    job({ applyHref: PAGE_HREF }),
    pageDeps({
      fetchPageJobs: async () => {
        throw new HttpError('timeout', 'Request timed out after 12000 ms');
      },
    }),
  );
  assert.equal(r.badge, 'unknown');
  assert.deepEqual(r.errors, [{ step: `careers page ${PAGE_HREF}`, kind: 'timeout', status: null, message: 'Request timed out after 12000 ms' }]);
  const ok = await checkJob(job(), deps());
  assert.equal(ok.errors, undefined);
});

test('English LinkedIn job, German-only board: ask about the working language, never "not found"', async () => {
  const DE = 'Wir suchen dich für unser Team in Berlin. Du arbeitest mit Produktmanagern zusammen und entwickelst die Systeme, die für unsere Kunden Geld bewegen. Das bringst du mit: Erfahrung mit Java und eine strukturierte Arbeitsweise und Spaß an der Arbeit im Team.';
  const board = ['Softwareentwickler (m/w/d)', 'Vertriebsmitarbeiter (m/w/d)', 'Teamleiter Kundenservice (m/w/d)'].map((title, i) => ({
    id: String(i), title, location: 'Berlin', url: `https://boards.greenhouse.io/acme/jobs/${i}`, createdAt: '2026-10-01T00:00:00Z', text: DE,
  }));
  for (const lang of ['en', 'zh']) {
    const r = await checkJob(
      job({ applyHref: 'https://boards.greenhouse.io/acme', description: LONG_JD.repeat(2) }),
      deps({ fetchPostings: async () => board, lang }),
    );
    assert.equal(r.badge, 'unknown');
    assert.equal(r.signals.not_found_on_official_site, null);
    assert.match(r.reasons[0].text, lang === 'en' ? /published in German.*working language/ : /用德语发布.*工作语言/);
  }
});

test('found, but the official posting is in another language: say so', async () => {
  const DE = 'Wir suchen dich für unser Payments Team. Du arbeitest mit Produktmanagern zusammen und entwickelst die Systeme, die für unsere Kunden Geld bewegen. Das bringst du mit: Erfahrung mit Java und eine strukturierte Arbeitsweise und Spaß an der Arbeit im Team.';
  const r = await checkJob(
    job({ description: LONG_JD.repeat(2) }),
    deps({ fetchPostings: async () => ghPostings.map((p) => (p.id === '5551234' ? { ...p, text: DE } : p)) }),
  );
  assert.equal(r.badge, 'green');
  assert.ok(r.reasons.some((x) => /official posting is in German/.test(x.text)));
});

const { parseAmazon, parsePhenom, phenomSite } = await import('../core/sources/site-search.js');
const PHENOM_PAGE =
  '<script>phApp = phApp || {"widgetApiEndpoint":"https://careers.mastercard.com/widgets","country":"us","locale":"en_us","refNum":"MASRUS","baseUrl":"https://careers.mastercard.com/us/en/","siteType":"external"};</script>';
const readFixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('general careers page: never "not found", and the card links to the site', async () => {
  const href = 'https://careers.acme.com/careers';
  const r = await checkJob(job({ applyHref: href }), pageDeps({ fetchPageJobs: async () => ({ status: 200, ok: true, url: href, postings: [] }) }));
  assert.equal(r.badge, 'unknown');
  assert.equal(r.signals.not_found_on_official_site, null);
  assert.match(r.reasons[0].text, /general careers or search page of careers\.acme\.com/);
  assert.equal(r.officialUrl, href);
  assert.equal(r.officialLabel, 'Search for this job on careers.acme.com ↗');
});

test('amazon.jobs: the job id from the apply link is found through the site search', async () => {
  const href = 'https://www.amazon.jobs/en/jobs/10583145/software-development-engineer';
  const queries = [];
  const r = await checkJob(
    job({ company: 'Amazon', title: 'Software Development Engineer', location: 'Seattle, WA', applyHref: href }),
    pageDeps({
      fetchPageJobs: async () => ({ status: 200, ok: true, url: href, postings: [] }),
      searchSite: async (site, query) => {
        queries.push(query);
        return parseAmazon(readFixture('amazon-search.json'));
      },
    }),
  );
  assert.deepEqual(queries, ['10583145']);
  assert.equal(r.badge, 'green');
  assert.equal(r.officialUrl, href);
  assert.ok(r.reasons.some((x) => /amazon\.jobs's own job search/.test(x.text)));
});

test('Phenom careers page: found by title through the site search; a miss is never "not found"', async () => {
  const href = 'https://careers.mastercard.com/us/en/';
  const page = async () => ({ status: 200, ok: true, url: href, postings: [], siteSearch: phenomSite(PHENOM_PAGE, href) });
  const found = await checkJob(
    job({ company: 'Mastercard', title: 'Senior Software Engineer', location: "O'Fallon, Missouri, United States", applyHref: href }),
    pageDeps({ fetchPageJobs: page, searchSite: async (site) => parsePhenom(readFixture('phenom-search.json'), site) }),
  );
  assert.equal(found.badge, 'green');
  assert.equal(found.officialUrl, 'https://careers.mastercard.com/us/en/job/R-286356');

  const missed = await checkJob(
    job({ company: 'Mastercard', title: 'Head of Payments Research', applyHref: href }),
    pageDeps({ fetchPageJobs: page, searchSite: async (site) => parsePhenom(readFixture('phenom-search.json'), site) }),
  );
  assert.equal(missed.badge, 'unknown');
  assert.equal(missed.signals.not_found_on_official_site, null);
  assert.match(missed.reasons[0].text, /job search did not return this job/);
  assert.equal(missed.officialUrl, 'https://careers.mastercard.com/us/en/search-results?keywords=Head+of+Payments+Research');
});

test('posting dates from every source are compared: new on LinkedIn, old on the careers site', async () => {
  const old = ghPostings.map((p) => (p.id === '5551234' ? { ...p, createdAt: '2026-03-01T00:00:00Z', createdAtExact: true } : p));
  const check = (metaText) => checkJob(job({ metaText }), deps({ fetchPostings: async () => old }));

  const reposted = await check('San Francisco, CA · Reposted 3 days ago · 40 applicants');
  assert.equal(reposted.signals.posted_long_ago, true);
  assert.equal(reposted.signals.reposted_to_look_new, true);
  assert.ok(reposted.reasons.some((x) => /LinkedIn \(reposted\) shows it 3 days ago, Greenhouse · acme 234 days ago/.test(x.text)));
  assert.deepEqual(reposted.dates.map((d) => [d.source, d.days]), [['LinkedIn (reposted)', 3], ['Greenhouse · acme', 234]]);

  // LinkedIn agrees that it is old: nothing extra.
  assert.equal((await check('San Francisco, CA · 6 months ago · 40 applicants')).signals.reposted_to_look_new, false);
  // Only one date: nothing to compare.
  assert.equal((await check('San Francisco, CA')).signals.reposted_to_look_new, null);
  // A recent job is never affected.
  const fresh = ghPostings.map((p) => (p.id === '5551234' ? { ...p, createdAt: '2026-10-10T00:00:00Z', createdAtExact: true } : p));
  const r = await checkJob(job({ metaText: 'SF · 2 days ago' }), deps({ fetchPostings: async () => fresh }));
  assert.equal(r.signals.reposted_to_look_new, false);
});


const oracle = await import('../core/sources/oracle.js');
const ORACLE_HREF = 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210788451';
const oracleJob = (over = {}) =>
  job({ company: 'JPMorgan Chase', title: 'Senior Lead Software Engineer - AI/ML Engineering, GPU ML Serving', location: 'Seattle, WA', applyHref: ORACLE_HREF, ...over });
const O = { origin: 'https://jpmc.fa.oraclecloud.com', site: 'CX_1001' };
const oracleDeps = (over = {}) =>
  deps({
    companies: buildCompanyIndex({ companies: [] }),
    searchAts: async () => ({ ...oracle.parseOracleSearch(readFixture('oracle-search.json'), O), complete: false }),
    fetchAtsPosting: async () => oracle.parseOracleDetail(readFixture('oracle-detail.json'), O),
    ...over,
  });

test('Oracle Recruiting: the apply-link posting is found by id; removed -> closed', async () => {
  const r = await checkJob(oracleJob(), oracleDeps());
  assert.equal(r.badge, 'green');
  assert.equal(r.detected.ats, 'Oracle Recruiting');
  assert.equal(r.officialUrl, ORACLE_HREF);

  const gone = await checkJob(oracleJob(), oracleDeps({ fetchAtsPosting: async () => null }));
  assert.equal(gone.signals.apply_link_closed, true);
  // An empty answer from a site that answers nothing is not "removed".
  const dead = await checkJob(oracleJob(), oracleDeps({ fetchAtsPosting: async () => null, searchAts: async () => ({ postings: [], total: 0, complete: true }) }));
  assert.equal(dead.signals.apply_link_closed, null);
});

test('Oracle Recruiting: a large site searched by title never says "not found"; a small complete one can', async () => {
  const href = 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001';
  const missing = await checkJob(oracleJob({ title: 'Head of Treasury Operations', applyHref: href }), oracleDeps());
  assert.equal(missing.badge, 'unknown');
  assert.equal(missing.signals.not_found_on_official_site, null);
  assert.match(missing.reasons[0].text, /Oracle Recruiting's search didn't return this job/);

  const small = await checkJob(
    oracleJob({ title: 'Head of Treasury Operations', applyHref: href }),
    oracleDeps({ searchAts: async () => ({ ...oracle.parseOracleSearch(readFixture('oracle-search.json'), O), total: 1, complete: true }) }),
  );
  assert.equal(small.signals.not_found_on_official_site, true);
});

test('Oracle Recruiting on a company domain asks for permission first', async () => {
  const href = 'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/295484';
  const r = await checkJob(oracleJob({ company: 'Dell Technologies', applyHref: href }), oracleDeps({ hasOriginPermission: async () => false }));
  assert.equal(r.badge, 'unknown');
  assert.equal(r.action.origin, 'https://enterpriseplatform.dell.com');
});

test('SmartRecruiters: apply-link posting found; removed posting -> closed; empty board never counts', async () => {
  const sr = await import('../core/sources/smartrecruiters.js');
  const href = 'https://jobs.smartrecruiters.com/BoschGroup/744000156836731-analista-financiero';
  const j = job({ company: 'Bosch', title: 'Analista Financiero y Cuentas Por Pagar', location: 'Aguascalientes, Mexico', applyHref: href });
  const d = (over) =>
    deps({
      companies: buildCompanyIndex({ companies: [] }),
      searchAts: async () => ({ ...sr.parseSmartRecruitersList(readFixture('smartrecruiters-list.json'), 'BoschGroup'), complete: false }),
      fetchAtsPosting: async () => sr.parseSmartRecruitersDetail(readFixture('smartrecruiters-detail.json'), 'BoschGroup'),
      ...over,
    });
  const r = await checkJob(j, d());
  assert.equal(r.badge, 'green');
  assert.equal(r.detected.ats, 'SmartRecruiters');
  assert.equal((await checkJob(j, d({ fetchAtsPosting: async () => null }))).signals.apply_link_closed, true);
  const empty = await checkJob(j, d({ searchAts: async () => ({ postings: [], total: 0, complete: true }) }));
  assert.equal(empty.badge, 'unknown');
  assert.equal(empty.signals.apply_link_closed, null);
});

test('no usable link: the careers site is found from the company name (Wikidata -> careers page -> ATS)', async () => {
  const fetched = [];
  const d = (over = {}) =>
    deps({
      companies: buildCompanyIndex({ companies: [] }),
      fetchBoardName: async () => null,
      findCompanyWebsite: async (name) => (name === 'Acme' ? { id: 'Q1', url: 'https://www.acme.com/' } : null),
      hasOriginPermission: async (origin) => origin === 'https://careers.acme.com',
      fetchPageJobs: async (url) => {
        fetched.push(url);
        return {
          status: 200,
          ok: true,
          url,
          postings: [],
          discovered: { refs: [{ ref: { ats: 'greenhouse', slug: 'acme', jobId: null, region: null }, count: 3 }], unsupported: [] },
        };
      },
      ...over,
    });
  const easy = job({ applyType: 'easy', applyHref: null, linkedinCompanySlug: null });
  const r = await checkJob(easy, d());
  assert.equal(fetched[0], 'https://careers.acme.com/');
  assert.equal(r.badge, 'green');
  assert.equal(r.detected.website, 'https://www.acme.com/');
  assert.match(r.detected.boardSource, /Wikidata/);
  assert.ok(r.reasons.some((x) => /official website/.test(x.text)));

  // Found by name only: a job missing from that board is never counted.
  const missing = await checkJob({ ...easy, title: 'Chief Llama Officer' }, d());
  assert.equal(missing.signals.not_found_on_official_site, null);

  // Careers site not allowed yet: offer to allow it.
  const blocked = await checkJob(easy, d({ hasOriginPermission: async () => false }));
  assert.equal(blocked.badge, 'unknown');
  assert.equal(blocked.action.origin, 'https://careers.acme.com');
});

test('name guesses cover Workable and SmartRecruiters, verified by the board\'s company name', async () => {
  const tried = [];
  const easy = job({
    company: 'Bosch', applyType: 'easy', applyHref: null, linkedinCompanySlug: null,
    title: 'Analista Financiero y Cuentas Por Pagar', location: 'Aguascalientes, Mexico',
    description: 'Buscamos un analista para el equipo de cuentas por pagar. Serás responsable de las conciliaciones y de los pagos a proveedores. Tu perfil: licenciatura en finanzas y experiencia con SAP. Ofrecemos un entorno internacional y las herramientas para crecer con nosotros.',
  });
  const sr = await import('../core/sources/smartrecruiters.js');
  const r = await checkJob(
    easy,
    deps({
      companies: buildCompanyIndex({ companies: [] }),
      fetchBoardName: async (ref) => {
        tried.push(`${ref.ats}:${ref.slug}`);
        return ref.ats === 'smartrecruiters' && ref.slug === 'BoschGroup' ? 'Bosch Group' : null;
      },
      searchAts: async () => ({ ...sr.parseSmartRecruitersList(readFixture('smartrecruiters-list.json'), 'BoschGroup'), complete: false }),
      fetchAtsPosting: async () => null,
    }),
  );
  assert.deepEqual(tried, ['greenhouse:bosch', 'workable:bosch', 'smartrecruiters:Bosch', 'smartrecruiters:BoschGroup']);
  assert.equal(r.detected.ats, 'SmartRecruiters');
  assert.equal(r.badge, 'green');
});

test('a guessed company domain counts only when the site links to the company\'s LinkedIn page', async () => {
  const sites = {
    'https://acme.com/': { status: 200, ok: true, url: 'https://acme.com/', postings: [], linkedin: ['acme-inc'], siteName: 'Welcome', careersLinks: ['https://acme.com/careers'] },
    'https://acme.com/careers': {
      status: 200, ok: true, url: 'https://acme.com/careers', postings: [],
      searchForm: 'https://acme.com/careers/search?keywords={q}', texts: ['Open roles'],
    },
  };
  const searched = [];
  const d = (linkedin) =>
    deps({
      companies: buildCompanyIndex({ companies: [] }),
      fetchBoardName: async () => null,
      hasOriginPermission: async () => true,
      fetchPageJobs: async (url) => {
        if (url.startsWith('https://acme.com/careers/search')) {
          searched.push(url);
          return { status: 200, ok: true, url, postings: [], texts: ['Senior Software Engineer - Payments', 'Data Analyst'] };
        }
        const page = sites[url];
        if (!page) throw new HttpError('network', 'no such host');
        return url === 'https://acme.com/' ? { ...page, linkedin } : page;
      },
    });
  const easy = job({ applyType: 'easy', applyHref: null });
  const r = await checkJob(easy, d(['acme-inc']));
  assert.equal(r.badge, 'green');
  assert.match(searched[0], /keywords=Senior%20Software%20Engineer/);
  assert.ok(r.checks.some((c) => c.label === 'Job search on acme.com' && c.status === 'found'));

  // Same domain, but it links to another company's LinkedIn page: not used.
  const other = await checkJob(easy, d(['someone-else']));
  assert.equal(other.signals.found_on_official_site, null);
});

test('apply link gone, but the job is listed on the official board: real, with a note', async () => {
  const d = pageDeps({
    companies,
    fetchPostings: async () => ghPostings,
    fetchPageJobs: async () => ({ status: 404, ok: false, url: PAGE_HREF, postings: [] }),
  });
  const r = await checkJob(job({ applyHref: PAGE_HREF }), d);
  assert.equal(r.badge, 'green');
  assert.equal(r.signals.apply_link_closed, false);
  assert.ok(r.reasons.some((x) => /apply link no longer works, but the job is listed elsewhere/.test(x.text)));
  const statuses = Object.fromEntries(r.checks.map((c) => [c.label, c.status]));
  assert.equal(statuses['Apply page on careers.acme.com'], 'closed');
  assert.equal(statuses['Greenhouse · acme'], 'found');
});
