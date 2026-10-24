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

test('JPY and LinkedIn amount-first ranges', () => {
  assert.deepEqual(detectSalary('', '5M JPY/yr - 10.5M JPY/yr'), { value: true, detail: '5M JPY/yr - 10.5M JPY/yr' });
  assert.equal(detectSalary('Salary: ¥6,000,000 - ¥9,000,000').value, true);
});

test('Japanese and Chinese salary formats', () => {
  assert.equal(detectSalary('想定年収：600万円〜900万円（経験による）').detail, '想定年収：600万円〜900万円');
  assert.equal(detectSalary('月給30万円～45万円').value, true);
  assert.equal(detectSalary('月薪15k-25k，14薪').detail, '月薪15k-25k');
  assert.equal(detectSalary('年薪30-50万').value, true);
  assert.equal(detectSalary('給与：経験・能力を考慮の上決定').value, false);
});

test('Japanese and Chinese team names', () => {
  const ja = '当社は決済サービスを提供しています。'.repeat(5) + '当社の決済基盤チームにて開発を担当していただきます。'.repeat(3);
  assert.deepEqual(detectSpecificTeam(ja), { value: true, detail: '決済基盤' });
  const zh = '我们是一家支付公司。'.repeat(8) + '你将加入支付平台团队，负责核心系统。'.repeat(3);
  assert.deepEqual(detectSpecificTeam(zh), { value: true, detail: '支付平台' });
  assert.equal(detectSpecificTeam('我们的团队非常优秀，欢迎你的加入。'.repeat(20)).value, false);
});

test('Japanese and Chinese template phrases; short CJK text still counts', () => {
  assert.equal(detectGenericTemplate('当社のタレントプールにご登録ください。'.repeat(10)).detail, 'タレントプール');
  assert.equal(detectGenericTemplate('本岗位为人才储备岗位，长期有效。'.repeat(10)).detail, '人才储备');
  assert.equal(detectGenericTemplate('決済基盤の開発を担当していただきます。'.repeat(8)).value, false);
});
