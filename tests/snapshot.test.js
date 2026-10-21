import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshot, serializeSnapshot, lookupFirstSeen, snapshotPath, KEEP_GONE_DAYS } from '../core/snapshot.js';

const P = (id, title = `Job ${id}`) => ({ id, title });
const ctx = (today) => ({ ats: 'greenhouse', slug: 'acme', today });

test('first run: every job is a baseline entry', () => {
  const { next, stats } = mergeSnapshot(null, [P('1'), P('2')], ctx('2026-10-01'));
  assert.equal(next.since, '2026-10-01');
  assert.deepEqual(next.jobs['1'], { t: 'Job 1', f: '2026-10-01' });
  assert.equal(stats.added, 2);
  assert.deepEqual(lookupFirstSeen(next, '1'), { date: '2026-10-01', exact: false });
});

test('new, gone and reopened jobs', () => {
  const day1 = mergeSnapshot(null, [P('1'), P('2')], ctx('2026-10-01')).next;
  const day2 = mergeSnapshot(day1, [P('1'), P('3')], ctx('2026-10-02'));
  assert.deepEqual(day2.stats, { added: 1, gone: 1, back: 0, pruned: 0 });
  assert.deepEqual(day2.next.jobs['2'], { t: 'Job 2', f: '2026-10-01', g: '2026-10-02' });
  assert.deepEqual(lookupFirstSeen(day2.next, '3'), { date: '2026-10-02', exact: true });

  const day3 = mergeSnapshot(day2.next, [P('1'), P('2'), P('3')], ctx('2026-10-03'));
  assert.equal(day3.stats.back, 1);
  assert.deepEqual(day3.next.jobs['2'], { t: 'Job 2', f: '2026-10-01' }); // original first-seen kept
});

test('unchanged boards serialize identically (no daily git churn)', () => {
  const day1 = mergeSnapshot(null, [P('1'), P('2')], ctx('2026-10-01')).next;
  const day2 = mergeSnapshot(day1, [P('2'), P('1')], ctx('2026-10-02')).next;
  assert.equal(serializeSnapshot(day1), serializeSnapshot(day2));
});

test('gone jobs are pruned after the retention period', () => {
  const day1 = mergeSnapshot(null, [P('1'), P('2')], ctx('2026-01-01')).next;
  const gone = mergeSnapshot(day1, [P('1')], ctx('2026-01-02')).next;
  const later = new Date(Date.parse('2026-01-02') + (KEEP_GONE_DAYS + 1) * 86400000).toISOString().slice(0, 10);
  const { next, stats } = mergeSnapshot(gone, [P('1')], ctx(later));
  assert.equal(next.jobs['2'], undefined);
  assert.equal(stats.pruned, 1);
});

test('serialization is valid, sorted JSON with one job per line', () => {
  const snap = mergeSnapshot(null, [P('10'), P('9'), P('100')], ctx('2026-10-01')).next;
  const text = serializeSnapshot(snap);
  assert.deepEqual(JSON.parse(text), snap);
  assert.deepEqual(Object.keys(JSON.parse(text).jobs), ['9', '10', '100']);
  assert.equal(text.split('\n').filter((l) => l.includes('"f"')).length, 3);
  assert.deepEqual(JSON.parse(serializeSnapshot({ ...snap, jobs: {} })).jobs, {});
});

test('snapshot paths are safe for any slug', () => {
  assert.equal(snapshotPath({ ats: 'ashby', slug: 'Acme Co/..' }), 'data/first-seen/ashby/acme_co_...json');
  assert.equal(snapshotPath({ ats: 'lever', slug: 'acme', region: 'eu' }), 'data/first-seen/lever-eu/acme.json');
});

test('lookup tolerates missing or foreign data', () => {
  assert.equal(lookupFirstSeen(null, '1'), null);
  assert.equal(lookupFirstSeen({ version: 99, jobs: {} }, '1'), null);
  assert.equal(lookupFirstSeen({ version: 1, since: 'x', jobs: {} }, '1'), null);
});
