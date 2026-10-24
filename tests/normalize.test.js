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

test('real-world multi-location formats', () => {
  // Formats observed on live Greenhouse boards.
  assert.ok(locationsCompatible('San Francisco, CA', 'Seattle, San Francisco, New York City; US'));
  assert.ok(locationsCompatible('New York, NY', 'San Francisco, CA • New York, NY • United States; US'));
  assert.ok(locationsCompatible('New York, NY', 'New York City, NY; New York, NY, United States'));
  assert.ok(locationsCompatible('Austin, TX', 'US - Remote Zone 1 (Job Requisitions Only)'));
  assert.ok(locationsCompatible('Miami, FL', 'New York, NY (HQ); Remote (Canada); Remote (US); Miami, FL; Remote'));
  assert.ok(!locationsCompatible('Tokyo, Japan', 'San Francisco, CA | Seattle, WA; San Francisco, California, United States'));
});

test('incompatible locations', () => {
  assert.ok(!locationsCompatible('London, England, United Kingdom', 'New York, NY'));
  assert.ok(!locationsCompatible('Austin, TX', 'Seattle, WA'));
  assert.ok(!locationsCompatible('Remote - US', 'Remote - Canada'));
  assert.ok(!locationsCompatible('Toronto, ON', 'Austin, TX'));
});

test('Japanese and Chinese titles: levels and noise inside tokens', () => {
  const ja = normalizeTitle('シニアソフトウェアエンジニア【東京/フルリモート可】');
  assert.equal(ja.level, 'senior');
  assert.deepEqual(ja.core, normalizeTitle('ソフトウェアエンジニア').core);
  assert.equal(normalizeTitle('ジュニアエンジニア').level, 'junior');
  const zh = normalizeTitle('高级软件工程师（远程）');
  assert.equal(zh.level, 'senior');
  assert.deepEqual(zh.tokens, normalizeTitle('软件工程师').tokens);
  assert.equal(normalizeTitle('软件工程实习生').level, 'intern');
});

test('Japanese and Chinese place names', () => {
  assert.ok(locationsCompatible('東京都', 'Tokyo, Japan'));
  assert.ok(locationsCompatible('東京都港区', 'Tokyo'));
  assert.ok(locationsCompatible('上海', 'Shanghai, China'));
  assert.ok(!locationsCompatible('上海', 'Tokyo, Japan'));
  assert.ok(parseLocation('フルリモート').remote);
});

test('title language', async () => {
  const { titleScript, sameTitleLanguage } = await import('../core/normalize.js');
  assert.equal(titleScript('ソフトウェアエンジニア'), 'cjk');
  assert.equal(titleScript('Software Engineer'), 'latin');
  assert.equal(titleScript('ソフトウェアエンジニア / Software Engineer'), 'mixed');
  const english = [{ title: 'Software Engineer' }, { title: 'Data Scientist' }];
  assert.equal(sameTitleLanguage('ソフトウェアエンジニア', english), false);
  assert.equal(sameTitleLanguage('Backend Engineer', english), true);
  assert.equal(sameTitleLanguage('ソフトウェアエンジニア / Software Engineer', english), true);
});

test("apostrophes in place names don't split them (O'Fallon = O Fallon)", () => {
  assert.ok(locationsCompatible("O'Fallon, Missouri, United States", 'O Fallon, United States of America, 63368-7263'));
});

test('a city written with its district or park still matches the city', () => {
  assert.ok(locationsCompatible('Aguascalientes, Mexico', 'Parque Industrial del Valle de Aguascalientes, Ags., Mexico'));
  assert.ok(!locationsCompatible('Aguascalientes, Mexico', 'Monterrey, Mexico'));
});
