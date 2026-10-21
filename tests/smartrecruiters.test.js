import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSmartRecruitersDetail, parseSmartRecruitersList, smartRecruitersListUrl } from '../core/sources/smartrecruiters.js';
import { detectAts } from '../core/ats.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('SmartRecruiters links', () => {
  assert.deepEqual(detectAts('https://jobs.smartrecruiters.com/BoschGroup/744000156836731-analista-financiero'), {
    ats: 'smartrecruiters', slug: 'BoschGroup', jobId: '744000156836731', region: null,
  });
  assert.equal(detectAts('https://careers.smartrecruiters.com/BoschGroup').slug, 'BoschGroup');
  assert.equal(detectAts('https://jobs.smartrecruiters.com/oneclick-ui/company/x'), null);
  assert.equal(smartRecruitersListUrl('BoschGroup', { q: 'Analista' }), 'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=100&offset=0&q=Analista');
});

test('SmartRecruiters list and posting responses', () => {
  const list = parseSmartRecruitersList(fixture('smartrecruiters-list.json'), 'BoschGroup');
  assert.equal(list.total, 5104);
  assert.equal(list.companyName, 'Bosch Group');
  assert.deepEqual(
    { title: list.postings[0].title, location: list.postings[0].location, createdAt: list.postings[0].createdAt },
    { title: 'Analista Financiero y Cuentas Por Pagar', location: 'Parque Industrial del Valle de Aguascalientes, Ags., Mexico', createdAt: '2026-10-21T15:27:49.561Z' },
  );
  const d = parseSmartRecruitersDetail(fixture('smartrecruiters-detail.json'), 'BoschGroup');
  assert.match(d.url, /^https:\/\/jobs\.smartrecruiters\.com\/BoschGroup\/744000156836731/);
  assert.match(d.text, /cuentas por pagar/);
  assert.match(d.text, /Licenciatura/);
  assert.equal(parseSmartRecruitersDetail({}, 'BoschGroup'), null);
});
