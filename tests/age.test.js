import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineAge, ageSignals } from '../core/age.js';
import { parseWayback, waybackQueryUrl, linkedinJobUrl } from '../core/wayback.js';

const NOW = new Date('2026-10-21T00:00:00Z');
const T = { recent_days: 30, old_days: 90 };
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

test('the oldest evidence wins', () => {
  const age = combineAge(
    [
      { date: daysAgo(10), exact: true, source: 'ats' },
      { date: daysAgo(150), exact: false, source: 'wayback' },
    ],
    NOW,
  );
  assert.equal(age.days, 150);
  assert.equal(age.oldest.source, 'wayback');
  const s = ageSignals(age, T);
  assert.equal(s.posted_long_ago, true);
  assert.equal(s.posted_recently, false);
  assert.equal(s.refreshed, true); // careers site says 10 days, evidence says 150
});

test('recent needs exact evidence', () => {
  const exact = ageSignals(combineAge([{ date: daysAgo(5), exact: true, source: 'ats' }], NOW), T);
  assert.deepEqual(exact, { posted_recently: true, posted_long_ago: false, refreshed: false });
  const bound = ageSignals(combineAge([{ date: daysAgo(5), exact: false, source: 'snapshot' }], NOW), T);
  assert.deepEqual(bound, { posted_recently: null, posted_long_ago: null, refreshed: false });
});

test('a lower bound alone can prove a job is old', () => {
  const s = ageSignals(combineAge([{ date: daysAgo(120), exact: false, source: 'snapshot' }], NOW), T);
  assert.equal(s.posted_long_ago, true);
});

test('between the thresholds', () => {
  const s = ageSignals(combineAge([{ date: daysAgo(60), exact: true, source: 'ats' }], NOW), T);
  assert.deepEqual(s, { posted_recently: false, posted_long_ago: false, refreshed: false });
});

test('no evidence -> unknown', () => {
  assert.equal(combineAge([], NOW), null);
  assert.equal(combineAge([{ date: 'garbage', exact: true, source: 'ats' }], NOW), null);
  assert.deepEqual(ageSignals(null, T), { posted_recently: null, posted_long_ago: null, refreshed: false });
});

test('wayback parsing', () => {
  const json = {
    url: 'example.com',
    archived_snapshots: { closest: { status: '200', available: true, url: 'http://web.archive.org/web/20250102030405/x', timestamp: '20250102030405' } },
  };
  assert.equal(parseWayback(json), '2025-01-02T03:04:05.000Z');
  assert.equal(parseWayback({ archived_snapshots: {} }), null);
  assert.equal(parseWayback(null), null);
  assert.equal(parseWayback({ archived_snapshots: { closest: { timestamp: 'x' } } }), null);
  assert.equal(
    waybackQueryUrl('https://jobs.lever.co/a/b?x=1'),
    'https://archive.org/wayback/available?url=https%3A%2F%2Fjobs.lever.co%2Fa%2Fb%3Fx%3D1&timestamp=19960101',
  );
  assert.equal(linkedinJobUrl('123'), 'https://www.linkedin.com/jobs/view/123/');
  assert.equal(linkedinJobUrl('abc'), null);
});
