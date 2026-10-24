import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCES } from '../core/sources/index.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

test('greenhouse parse', () => {
  const [p, q] = SOURCES.greenhouse.parse(fixture('greenhouse'));
  assert.equal(p.id, '5551234');
  assert.equal(p.title, 'Senior Software Engineer, Payments');
  assert.equal(p.location, 'San Francisco, CA');
  assert.equal(p.createdAt, '2026-10-01T13:00:00.000Z');
  assert.equal(p.department, 'Engineering');
  assert.match(p.text, /Join the Payments Platform team\./);
  assert.match(p.text, /\$150,000 – \$190,000/);
  assert.equal(q.location, 'Remote - US');
});

test('greenhouse urls', () => {
  assert.equal(
    SOURCES.greenhouse.listUrl({ slug: 'acme' }),
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
  );
  assert.equal(SOURCES.greenhouse.infoUrl({ slug: 'acme', region: 'eu' }), 'https://boards-api.eu.greenhouse.io/v1/boards/acme');
});

test('lever parse', () => {
  const [p] = SOURCES.lever.parse(fixture('lever'));
  assert.equal(p.id, '0a1b2c3d-1111-2222-3333-444455556666');
  assert.equal(p.title, 'Backend Engineer');
  assert.equal(p.location, 'London; Remote - UK');
  assert.equal(p.createdAt, new Date(1758000000000).toISOString());
  assert.equal(p.salary, 'GBP 70,000 – 90,000 per-year-salary');
  assert.match(p.text, /Billing API/);
  assert.match(p.text, /Postgres/);
  assert.equal(SOURCES.lever.listUrl({ slug: 'acme', region: 'eu' }), 'https://api.eu.lever.co/v0/postings/acme?mode=json');
});

test('ashby parse skips unlisted jobs', () => {
  const postings = SOURCES.ashby.parse(fixture('ashby'));
  assert.equal(postings.length, 1);
  const [p] = postings;
  assert.equal(p.location, 'New York; San Francisco');
  assert.equal(p.salary, '$220K – $280K • Offers Equity');
  assert.equal(p.department, 'Ranking');
  assert.equal(
    SOURCES.ashby.listUrl({ slug: 'Acme Co' }),
    'https://api.ashbyhq.com/posting-api/job-board/Acme%20Co?includeCompensation=true',
  );
});

test('parsers tolerate malformed responses', () => {
  for (const source of Object.values(SOURCES)) {
    assert.deepEqual(source.parse(null), []);
    assert.deepEqual(source.parse({}), []);
    assert.deepEqual(source.parse({ jobs: [null, { id: 1 }] }), []);
  }
});

test('workable parse', () => {
  const json = {
    name: 'Acme',
    jobs: [
      {
        title: 'Software Engineer (Finance)', shortcode: 'ab12cd34ef', telecommuting: false, department: 'Engineering',
        url: 'https://apply.workable.com/j/AB12CD34EF', published_on: '2026-09-30', created_at: '2026-09-29',
        city: 'Tokyo', state: 'Tokyo', country: 'Japan', description: '<p>Build <b>finance</b> systems.</p>',
        locations: [{ country: 'Japan', countryCode: 'JP', city: 'Tokyo', region: 'Tokyo', hidden: false }],
      },
      { title: 'No code' },
    ],
  };
  const [p, ...rest] = SOURCES.workable.parse(json);
  assert.equal(rest.length, 0);
  assert.equal(p.id, 'AB12CD34EF');
  assert.equal(p.location, 'Tokyo, Japan');
  assert.equal(p.createdAt, '2026-09-30T00:00:00.000Z');
  assert.equal(p.text, 'Build finance systems.');
  assert.equal(SOURCES.workable.listUrl({ slug: 'acme' }), 'https://apply.workable.com/api/v1/widget/accounts/acme?details=true');
});
