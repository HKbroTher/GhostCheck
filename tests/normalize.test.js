import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, locationsCompatible, parseLocation } from '../core/normalize.js';

test('abbreviations, phrases and levels', () => {
  const t = normalizeTitle('Sr. Front-End Eng (Remote)');
  assert.equal(t.level, 'senior');
  assert.deepEqual(t.tokens, ['frontend', 'engineer']);
});

test('noise words and gender notes are removed', () => {
  assert.deepEqual(normalizeTitle('Software Engineer (m/w/d) - Full-time').core, ['software', 'engineer']);
  assert.deepEqual(normalizeTitle('Backend Developer f/m/d').tokens, ['backend', 'developer']);
});

test('core drops parentheticals and trailing segments, tokens keep them', () => {
  const t = normalizeTitle('Software Engineer, Payments');
  assert.deepEqual(t.core, ['software', 'engineer']);
  assert.deepEqual(t.tokens, ['software', 'engineer', 'payments']);
});

test('roman numeral levels only at the end', () => {
  assert.equal(normalizeTitle('Software Engineer II').level, 'mid');
  assert.equal(normalizeTitle('Software Engineer III').level, 'senior');
  assert.equal(normalizeTitle('Software Engineer').level, null);
});

test('associate director is not a junior level', () => {
  assert.equal(normalizeTitle('Associate Director, Marketing').level, null);
  assert.equal(normalizeTitle('Associate Product Manager').level, 'junior');
});

test('swe / pm expansions', () => {
  assert.deepEqual(normalizeTitle('SWE').tokens, ['software', 'engineer']);
  assert.deepEqual(normalizeTitle('Senior PM').tokens, ['product', 'manager']);
});

test('parseLocation basics', () => {
  const sf = parseLocation('San Francisco, CA');
  assert.deepEqual([...sf.cities], ['san francisco']);
  assert.deepEqual([...sf.regions], ['ca']);
  assert.deepEqual([...sf.countries], ['us']);
  const remote = parseLocation('Remote - US');
  assert.equal(remote.remote, true);
  assert.deepEqual([...remote.countries], ['us']);
  assert.deepEqual([...parseLocation('San Francisco Bay Area').cities], ['san francisco']);
  assert.deepEqual([...parseLocation('New York City Metropolitan Area').cities], ['new york']);
  assert.deepEqual([...parseLocation('Greater Boston').cities], ['boston']);
});

test('compatible locations', () => {
  assert.ok(locationsCompatible('San Francisco, CA', 'San Francisco, California, United States'));
  assert.ok(locationsCompatible('San Francisco Bay Area', 'SF / NYC'));
  assert.ok(locationsCompatible('New York, NY', 'New York, NY; London, UK'));
  assert.ok(locationsCompatible('United States', 'Austin, TX'));
  assert.ok(locationsCompatible('Austin, TX', 'Remote (US)'));
  assert.ok(locationsCompatible('Dallas-Fort Worth Metroplex', 'Dallas, TX'));
  assert.ok(locationsCompatible('', 'London'));
  assert.ok(locationsCompatible('London, England, United Kingdom', 'London'));
  assert.ok(locationsCompatible('Berlin, Germany', 'EMEA'));
});

test('incompatible locations', () => {
  assert.ok(!locationsCompatible('London, England, United Kingdom', 'New York, NY'));
  assert.ok(!locationsCompatible('Austin, TX', 'Seattle, WA'));
  assert.ok(!locationsCompatible('Remote - US', 'Remote - Canada'));
  assert.ok(!locationsCompatible('Toronto, ON', 'Austin, TX'));
});
