import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workday, workdayRef, parsePostedOn, isWorkdayHost } from '../core/sources/workday.js';

const NOW = new Date('2026-10-21T12:00:00Z');
const ref = { ats: 'workday', slug: 'acme', workday: workdayRef({ tenant: 'acme', host: 'acme.wd5.myworkdayjobs.com', site: 'External' }) };

test('postedOn phrases', () => {
  assert.deepEqual(parsePostedOn('Posted Today', NOW), { date: NOW.toISOString(), exact: true });
  assert.equal(parsePostedOn('Posted Yesterday', NOW).date, '2026-10-20T12:00:00.000Z');
  assert.deepEqual(parsePostedOn('Posted 5 Days Ago', NOW), { date: '2026-10-16T12:00:00.000Z', exact: true });
  assert.deepEqual(parsePostedOn('Posted 30+ Days Ago', NOW), { date: '2026-09-21T12:00:00.000Z', exact: false });
  assert.equal(parsePostedOn('', NOW), null);
});

test('search request and parsing', () => {
  assert.equal(workday.searchUrl(ref), 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs');
  assert.deepEqual(workday.searchBody('Data Engineer'), { appliedFacets: {}, limit: 20, offset: 0, searchText: 'Data Engineer' });
  const json = {
    total: 2,
    jobPostings: [
      { title: 'Senior Data Engineer', externalPath: '/job/New-York-NY/Senior-Data-Engineer_R100', locationsText: 'New York, NY', postedOn: 'Posted 3 Days Ago', bulletFields: ['R100'] },
      { title: 'Data Analyst', externalPath: '/job/Remote/Data-Analyst_R101', locationsText: '2 Locations', postedOn: 'Posted 30+ Days Ago' },
      { title: 'broken' },
    ],
  };
  const { total, postings } = workday.parseSearch(json, ref, NOW);
  assert.equal(total, 2);
  assert.equal(postings.length, 2);
  assert.equal(postings[0].url, 'https://acme.wd5.myworkdayjobs.com/External/job/New-York-NY/Senior-Data-Engineer_R100');
  assert.equal(postings[0].createdAtExact, true);
  assert.equal(postings[1].location, ''); // "2 Locations" carries no place
  assert.equal(postings[1].createdAtExact, false);
});

test('detail parsing prefers startDate', () => {
  const json = {
    jobPostingInfo: {
      title: 'Senior Data Engineer',
      jobDescription: '<p>Join the <b>Data Platform</b> team. Pay: $150,000 - $180,000</p>',
      location: 'New York, NY',
      additionalLocations: ['Austin, TX'],
      startDate: '2026-09-01',
      postedOn: 'Posted 30+ Days Ago',
      externalUrl: 'https://acme.wd5.myworkdayjobs.com/External/job/New-York-NY/Senior-Data-Engineer_R100',
    },
  };
  const p = workday.parseDetail(json, ref, '/job/New-York-NY/Senior-Data-Engineer_R100', NOW);
  assert.equal(p.createdAt, '2026-09-01T00:00:00.000Z');
  assert.equal(p.createdAtExact, true);
  assert.equal(p.location, 'New York, NY; Austin, TX');
  assert.match(p.text, /Data Platform team/);
  assert.equal(workday.parseDetail({}, ref, '/x', NOW), null);
});

test('workday hosts', () => {
  assert.ok(isWorkdayHost('acme.wd5.myworkdayjobs.com'));
  assert.ok(isWorkdayHost('wd3.myworkdaysite.com'));
  assert.ok(!isWorkdayHost('myworkdayjobs.com.evil.com'));
});
