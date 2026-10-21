import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAts } from '../core/ats.js';

test('greenhouse board and job urls', () => {
  assert.deepEqual(detectAts('https://boards.greenhouse.io/acme/jobs/123?gh_src=x'), {
    ats: 'greenhouse', slug: 'acme', jobId: '123', region: null,
  });
  assert.deepEqual(detectAts('https://job-boards.greenhouse.io/Acme/jobs/456'), {
    ats: 'greenhouse', slug: 'acme', jobId: '456', region: null,
  });
  assert.deepEqual(detectAts('https://job-boards.eu.greenhouse.io/acme/jobs/7'), {
    ats: 'greenhouse', slug: 'acme', jobId: '7', region: 'eu',
  });
  assert.deepEqual(detectAts('https://boards.greenhouse.io/acme'), {
    ats: 'greenhouse', slug: 'acme', jobId: null, region: null,
  });
});

test('greenhouse embed url', () => {
  assert.deepEqual(detectAts('https://boards.greenhouse.io/embed/job_app?for=acme&token=999'), {
    ats: 'greenhouse', slug: 'acme', jobId: '999', region: null,
  });
});

test('gh_jid on a company careers page gives the job id but no slug', () => {
  assert.deepEqual(detectAts('https://acme.com/careers/job?gh_jid=4242'), {
    ats: 'greenhouse', slug: null, jobId: '4242', region: null,
  });
});

test('lever urls, including /apply and EU', () => {
  const id = '0a1b2c3d-1111-2222-3333-444455556666';
  assert.deepEqual(detectAts(`https://jobs.lever.co/acme/${id}/apply?lever-source=LinkedIn`), {
    ats: 'lever', slug: 'acme', jobId: id, region: null,
  });
  assert.equal(detectAts(`https://jobs.eu.lever.co/acme/${id}`).region, 'eu');
});

test('ashby urls keep slug case', () => {
  const id = '9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff';
  assert.deepEqual(detectAts(`https://jobs.ashbyhq.com/Acme/${id}/application`), {
    ats: 'ashby', slug: 'Acme', jobId: id, region: null,
  });
});

test('workday is detected (fetching comes in a later stage)', () => {
  const ref = detectAts('https://acme.wd5.myworkdayjobs.com/en-US/External_Careers/job/NY/Engineer_R123');
  assert.equal(ref.ats, 'workday');
  assert.deepEqual(ref.workday, { tenant: 'acme', host: 'acme.wd5.myworkdayjobs.com', site: 'External_Careers' });
});

test('unknown and invalid urls', () => {
  assert.equal(detectAts(null), null);
  assert.equal(detectAts('not a url'), null);
  assert.equal(detectAts('https://careers.acme.com/jobs/123'), null);
  assert.equal(detectAts('https://boards.greenhouse.io/<script>/jobs/1'), null);
});
