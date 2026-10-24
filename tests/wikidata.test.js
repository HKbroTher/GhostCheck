import { test } from 'node:test';
import assert from 'node:assert/strict';
import { careersCandidates, pickCompanyWebsite, wikidataSearchUrl } from '../core/wikidata.js';

// Shapes as Wikidata returned them for "FedEx" and "Notion" (trimmed).
const claims = (site, types) => ({
  ...(site ? { P856: site.map((v) => ({ mainsnak: { datavalue: { value: v } } })) } : {}),
  P31: types.map((id) => ({ mainsnak: { datavalue: { value: { id } } } })),
});
const entity = (label, site, types, aliases = []) => ({
  labels: { en: { value: label } },
  aliases: { en: aliases.map((value) => ({ value })) },
  claims: claims(site, types),
});

test('the official website of the company, not of a namesake', () => {
  const search = { search: [{ id: 'Q459477' }, { id: 'Q1426' }, { id: 'Q782557' }] };
  const entities = {
    entities: {
      Q459477: entity('FedEx', ['https://www.fedex.com/'], ['Q4830453', 'Q891723']),
      Q1426: entity('Roger Federer', ['https://www.rogerfederer.com/'], ['Q5']),
      Q782557: entity('FedEx Express', ['https://www.fedex.com/'], ['Q46970']),
    },
  };
  assert.deepEqual(pickCompanyWebsite('FedEx', search, entities), { id: 'Q459477', url: 'https://www.fedex.com/' });

  // Notion (software) has notion.so; the ancient city has no website, the window manager has another domain.
  const notion = {
    entities: {
      Q60747998: entity('Notion', ['https://www.notion.com', 'https://www.notion.so'], ['Q7247856']),
      Q28975260: entity('notion', ['https://notionwm.net/'], ['Q341']),
    },
  };
  assert.equal(pickCompanyWebsite('Notion', { search: [{ id: 'Q60747998' }, { id: 'Q28975260' }] }, notion).url, 'https://www.notion.com');

  // A website whose domain does not carry the name is not trusted.
  const odd = { entities: { Q1: entity('Acme', ['https://example.org/'], ['Q4830453']) } };
  assert.equal(pickCompanyWebsite('Acme', { search: [{ id: 'Q1' }] }, odd), null);
  // Names in other scripts: only items typed as companies.
  const ja = { entities: { Q2: entity('サカナAI', ['https://sakana.ai/'], ['Q4830453']), Q3: entity('サカナAI', ['https://x.example/'], ['Q11424']) } };
  assert.equal(pickCompanyWebsite('サカナAI', { search: [{ id: 'Q3' }, { id: 'Q2' }] }, ja).url, 'https://sakana.ai/');
});

test('careers site candidates and the search URL', () => {
  assert.deepEqual(careersCandidates('https://www.fedex.com/en-us/home.html'), [
    'https://careers.fedex.com/',
    'https://jobs.fedex.com/',
    'https://www.fedex.com/careers',
    'https://www.fedex.com/jobs',
  ]);
  assert.deepEqual(careersCandidates('https://sakana.ai/'), [
    'https://careers.sakana.ai/',
    'https://jobs.sakana.ai/',
    'https://sakana.ai/careers',
    'https://sakana.ai/jobs',
    'https://www.sakana.ai/careers',
    'https://www.sakana.ai/jobs',
  ]);
  assert.match(wikidataSearchUrl('FedEx'), /action=wbsearchentities&search=FedEx&language=en/);
});
