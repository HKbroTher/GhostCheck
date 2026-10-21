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
  assert.deepEqual(r.action, { type: 'grant-origin', origin: 'https://careers.acme.com', label: 'Allow checking careers.acme.com' });
});

test('self-hosted: JSON-LD JobPosting confirms the job', async () => {
  const r = await checkJob(job({ applyHref: PAGE_HREF }), pageDeps({ fetchPageJobs: async () => ({ status: 200, ok: true, url: PAGE_HREF, postings: [ldPosting()] }) }));
  assert.equal(r.badge, 'green');
  assert.equal(r.officialUrl, PAGE_HREF);
  assert.ok(r.reasons.some((x) => x.id === 'posted_recently'));
});

test('self-hosted: JSON-LD from a different company is not proof', async () => {
  const r = await checkJob(
    job({ applyHref: PAGE_HREF }),
    pageDeps({ fetchPageJobs: async () => ({ status: 200, ok: true, url: PAGE_HREF, postings: [ldPosting({ orgName: 'Staffing Partners LLC' })] }) }),
  );
  assert.equal(r.badge, 'unknown');
  assert.match(r.reasons[0].text, /Staffing Partners/);
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

test('careers page linking to a board without this job -> not found counts', async () => {
  const discovered = { refs: [{ ref: { ats: 'greenhouse', slug: 'acme', jobId: null, region: null }, count: 3 }], unsupported: [] };
  const d = pageDeps({ fetchPageJobs: async () => ({ status: 200, ok: true, url: PAGE_HREF, postings: [], discovered }) });
  const r = await checkJob(job({ applyHref: PAGE_HREF, title: 'Data Scientist', description: '' }), d);
  assert.equal(r.badge, 'red');
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
