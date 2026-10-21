import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { amazonSite, parseAmazon, phenomSite, parsePhenom, phenomSearchBody, phenomSearchPage } from '../core/sources/site-search.js';
import { isGenericCareersUrl } from '../core/careers-page.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
// Head of a real Phenom careers page (careers.mastercard.com), trimmed.
export const PHENOM_HTML =
  '<script>phApp = phApp || {"widgetApiEndpoint":"https://careers.mastercard.com/widgets","country":"us","deviceType":"desktop","locale":"en_us","absUrl":true,"refNum":"MASRUS","baseUrl":"https://careers.mastercard.com/us/en/","pageName":"home","siteType":"external","pageId":"page7"};</script>';

test('amazon.jobs links and search results', () => {
  assert.deepEqual(amazonSite('https://www.amazon.jobs/en/jobs/10583145/software-development-engineer'), { kind: 'amazon', origin: 'https://www.amazon.jobs', jobId: '10583145' });
  assert.equal(amazonSite('https://www.amazon.jobs/en/')?.jobId, null);
  assert.equal(amazonSite('https://careers.acme.com/jobs/10583145'), null);
  const [p] = parseAmazon(fixture('amazon-search.json'));
  assert.equal(p.id, '10583145');
  assert.equal(p.title, 'Software Development Engineer');
  assert.equal(p.location, 'Seattle, Washington, USA');
  assert.equal(p.url, 'https://www.amazon.jobs/en/jobs/10583145/software-development-engineer');
  assert.equal(p.createdAt, '2026-10-19T00:00:00.000Z');
  assert.match(p.text, /non-internship professional/);
  assert.doesNotMatch(p.text, /<br/);
});

test('Phenom sites are recognised from the page config and searched by their widget API', () => {
  const site = phenomSite(PHENOM_HTML, 'https://careers.mastercard.com/us/en/');
  assert.equal(site.endpoint, 'https://careers.mastercard.com/widgets');
  assert.equal(site.refNum, 'MASRUS');
  assert.equal(site.jobId, null);
  assert.equal(phenomSite(PHENOM_HTML, 'https://careers.mastercard.com/us/en/job/R-286356/senior-software-engineer').jobId, 'R-286356');
  // An endpoint on another site is not used (the user's permission covers this site only).
  assert.equal(phenomSite(PHENOM_HTML, 'https://jobs.example.com/'), null);
  assert.equal(phenomSite('<html>no config</html>', 'https://careers.mastercard.com/'), null);

  const body = phenomSearchBody(site, 'Senior Software Engineer');
  assert.equal(body.ddoKey, 'refineSearch');
  assert.equal(body.keywords, 'Senior Software Engineer');
  assert.equal(body.lang, 'en_us');
  assert.equal(phenomSearchPage(site, 'SRE'), 'https://careers.mastercard.com/us/en/search-results?keywords=SRE');

  const [p] = parsePhenom(fixture('phenom-search.json'), site);
  assert.equal(p.id, 'R-286356');
  assert.equal(p.url, 'https://careers.mastercard.com/us/en/job/R-286356');
  assert.equal(p.location, 'O Fallon, United States of America, 63368-7263');
  assert.equal(p.createdAt, '2026-08-18T00:00:00.000Z');
  assert.match(p.applyUrl, /myworkdayjobs/);
});

test('general careers and search pages vs one job', () => {
  for (const url of ['https://careers.fedex.com/', 'https://careers.fedex.com/jobs?keywords=driver', 'https://www.amazon.jobs/en/', 'https://careers.mastercard.com/us/en/search-results', 'https://sakana.ai/careers/']) {
    assert.equal(isGenericCareersUrl(url), true, url);
  }
  for (const url of ['https://www.amazon.jobs/en/jobs/10583145/sde', 'https://careers.mastercard.com/us/en/job/R-282567/x', 'https://careers.acme.com/jobs/123', 'https://sakana.ai/careers/software-engineer-finance/', 'https://databricks.com/company/careers/open-positions/job?gh_jid=8805655002']) {
    assert.equal(isGenericCareersUrl(url), false, url);
  }
});
