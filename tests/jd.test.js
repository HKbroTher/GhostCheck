import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSalary, detectSpecificTeam, detectGenericTemplate } from '../core/jd.js';

const pad = (s) => `${s} ${'We build software for customers around the world. '.repeat(8)}`;

test('salary ranges in several formats', () => {
  assert.equal(detectSalary('The base salary range is $150,000 - $190,000 per year.').detail, '$150,000 - $190,000');
  assert.equal(detectSalary('USD 120k to 150k').value, true);
  assert.equal(detectSalary('Salary: 60.000 – 75.000 EUR').value, true);
  assert.equal(detectSalary('Pay range: 85,000 - 105,000').value, true);
  assert.equal(detectSalary('$25/hr to start').value, true);
  assert.deepEqual(detectSalary('', '$150K/yr - $190K/yr'), { value: true, detail: '$150K/yr - $190K/yr' });
});

test('no salary', () => {
  assert.equal(detectSalary('Competitive compensation and great benefits. 401(k) match. 5 days PTO.').value, false);
  assert.equal(detectSalary('', 'Full-time').value, false);
});

test('specific team or project', () => {
  const r = detectSpecificTeam(pad('You will join our Payments Platform team.'));
  assert.equal(r.value, true);
  assert.equal(r.detail, 'Payments Platform');
  assert.equal(detectSpecificTeam(pad('You will be working on the Atlas Search platform.')).value, true);
});

test('generic team mentions do not count', () => {
  assert.equal(detectSpecificTeam(pad('You will join our Amazing team.')).value, false);
  assert.equal(detectSpecificTeam(pad('Join the team and grow.')).value, false);
});

test('short text is unknown, not false', () => {
  assert.equal(detectSpecificTeam('Join our Payments team').value, null);
  assert.equal(detectGenericTemplate('Talent pool').value, null);
});

test('template / pipeline phrases', () => {
  const r = detectGenericTemplate(pad('Apply to join our talent community for future opportunities.'));
  assert.equal(r.value, true);
  assert.equal(r.detail, 'talent community');
  assert.equal(detectGenericTemplate(pad('You will own the checkout flow.')).value, false);
});
