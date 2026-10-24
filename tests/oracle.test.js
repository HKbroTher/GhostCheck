import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { oracleDetailUrl, oracleSearchUrl, parseOracleDetail, parseOracleSearch } from '../core/sources/oracle.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const O = { origin: 'https://jpmc.fa.oraclecloud.com', site: 'CX_1001' };

test('Oracle Recruiting URLs', () => {
  const search = decodeURIComponent(oracleSearchUrl(O, 'Engineer, "AI"; ML', 50));
  assert.match(search, /recruitingCEJobRequisitions\?onlyData=true/);
  // Finder syntax characters are removed from the keyword.
  assert.match(search, /findReqs;siteNumber=CX_1001,limit=50,keyword="Engineer AI ML",sortBy=POSTING_DATES_DESC/);
  assert.match(decodeURIComponent(oracleDetailUrl(O, '210788451')), /ById;Id="210788451",siteNumber=CX_1001/);
});

test('Oracle Recruiting search and detail responses', () => {
  const { total, postings } = parseOracleSearch(fixture('oracle-search.json'), O);
  assert.equal(total, 2142);
  assert.deepEqual(
    { id: postings[0].id, location: postings[0].location, createdAt: postings[0].createdAt, url: postings[0].url },
    {
      id: '210788451',
      location: 'Seattle, WA, United States; Palo Alto, CA, United States',
      createdAt: '2026-10-21T00:00:00.000Z',
      url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210788451',
    },
  );
  const d = parseOracleDetail(fixture('oracle-detail.json'), O);
  assert.equal(d.createdAt, '2026-10-21T15:09:29.000Z');
  assert.match(d.text, /GPU model serving/);
  assert.match(d.text, /5\+ years/);
  assert.equal(parseOracleDetail({ items: [], count: 0 }, O), null);
});
