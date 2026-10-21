import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCompanyIndex, lookupCompany, normalizeCompanyName, guessSlugs } from '../core/companies.js';

test('data/companies.json is valid and has no duplicates', () => {
  const json = JSON.parse(readFileSync(new URL('../data/companies.json', import.meta.url), 'utf8'));
  const index = buildCompanyIndex(json);
  assert.deepEqual(index.errors, []);
  assert.equal(index.entries.length, json.companies.length);
});

test('company name normalization', () => {
  assert.equal(normalizeCompanyName('Stripe, Inc.'), 'stripe');
  assert.equal(normalizeCompanyName('Palantir Technologies Inc.'), 'palantir technologies');
  assert.equal(normalizeCompanyName('Ben & Jerry’s'), 'ben and jerry s');
  assert.equal(normalizeCompanyName('Société Générale S.A.'), 'societe generale');
});

test('lookup by LinkedIn id, then by name or alias', () => {
  const index = buildCompanyIndex({
    companies: [{ name: 'Palantir Technologies', aliases: ['Palantir'], linkedin: ['palantir-technologies'], ats: 'lever', slug: 'palantir' }],
  });
  assert.equal(lookupCompany(index, { linkedinCompanySlug: 'palantir-technologies' }).slug, 'palantir');
  assert.equal(lookupCompany(index, { company: 'Palantir' }).slug, 'palantir');
  assert.equal(lookupCompany(index, { company: 'Palantir Technologies Inc.' }).slug, 'palantir');
  assert.equal(lookupCompany(index, { company: 'Palantirx' }), null);
});

test('invalid entries are reported and skipped', () => {
  const index = buildCompanyIndex({
    companies: [
      { name: 'A', ats: 'taleo', slug: 'a' },
      { name: 'B', ats: 'lever', slug: '../x' },
      { name: 'C', ats: 'lever', slug: 'c' },
    ],
  });
  assert.equal(index.entries.length, 1);
  assert.equal(index.errors.length, 2);
});

test('slug guesses', () => {
  assert.deepEqual(guessSlugs('Acme Robotics, Inc.'), ['acmerobotics', 'acme-robotics']);
  assert.deepEqual(guessSlugs('Stripe'), ['stripe']);
});
