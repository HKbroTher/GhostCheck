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
