import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRules, evaluate, fillTemplate } from '../core/rules.js';

const rules = parseRules(readFileSync(new URL('../rules.yaml', import.meta.url), 'utf8'));

test('rules.yaml is valid', () => {
  assert.ok(rules.signals.length >= 7);
  for (const s of rules.signals) assert.ok(s.weight >= 0);
});

test('found on official site -> green', () => {
  const r = evaluate(rules, { found_on_official_site: true, not_found_on_official_site: false }, { vars: { company: 'Acme' } });
  assert.equal(r.badge, 'green');
  assert.equal(r.reasons[0].text, "This job is listed on Acme's own careers site.");
});

test('not found -> red; not found but specific and paid -> yellow', () => {
  assert.equal(evaluate(rules, { found_on_official_site: false, not_found_on_official_site: true }).badge, 'red');
  assert.equal(
    evaluate(rules, { found_on_official_site: false, not_found_on_official_site: true, salary_listed: true, specific_team: true }).badge,
    'yellow',
  );
});

test('found but open for a long time -> yellow', () => {
  const r = evaluate(rules, { found_on_official_site: true, posted_long_ago: true }, { vars: { days: 140 } });
  assert.equal(r.badge, 'yellow');
  assert.ok(r.reasons.some((x) => x.text.includes('140 days')));
});

test('nothing verifiable -> unknown, even with negative description signals', () => {
  const r = evaluate(rules, { generic_template: true, salary_listed: false }, { unknownReason: 'Could not reach Greenhouse.' });
  assert.equal(r.badge, 'unknown');
  assert.equal(r.score, null);
  assert.equal(r.reasons[0].text, 'Could not reach Greenhouse.');
});

test('unknown signals never change the score', () => {
  const a = evaluate(rules, { found_on_official_site: true });
  const b = evaluate(rules, { found_on_official_site: true, posted_long_ago: null, generic_template: null });
  assert.equal(a.score, b.score);
});

test('reason cap', () => {
  const r = evaluate(
    rules,
    { found_on_official_site: true, posted_recently: true, salary_listed: true, specific_team: true, generic_template: true },
    { notes: ['n1', 'n2'] },
  );
  assert.equal(r.reasons.length, rules.max_reasons);
});

test('templates drop empty placeholders cleanly', () => {
  assert.equal(fillTemplate('The posting states a pay range ({salary}).', {}), 'The posting states a pay range.');
  assert.equal(fillTemplate('Pay ({salary}).', { salary: '$1 - $2' }), 'Pay ($1 - $2).');
  assert.equal(fillTemplate('Template ("{phrase}").', {}), 'Template.');
});

test('invalid rules are rejected with a clear message', () => {
  assert.throws(() => parseRules('signals: []\nbadges: {green: {min_score: 1}, red: {max_score: 2}}'), /below/);
  assert.throws(
    () => parseRules('badges: {green: {min_score: 3}, red: {max_score: -3}}\nsignals:\n  - {id: x, type: good, weight: 1, reason: r}'),
    /type/,
  );
  assert.throws(
    () => parseRules('badges: {green: {min_score: 3}, red: {max_score: -3}}\nrequire_any_known: [nope]\nsignals: []'),
    /unknown signal/,
  );
});
