import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJobPostings } from '../core/jsonld.js';
import { parseSitemap, sitemapsFromRobots, canonicalUrl, isLikelyJobSitemap } from '../core/sitemap.js';

const page = (ld) => `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;

test('JobPosting from JSON-LD', () => {
  const [p] = extractJobPostings(
    page({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Senior Backend Engineer &amp; Lead',
      datePosted: '2026-09-15',
      validThrough: '2026-12-31T00:00',
      hiringOrganization: { '@type': 'Organization', name: 'Acme Inc.' },
      jobLocation: [{ '@type': 'Place', address: { addressLocality: 'Berlin', addressCountry: { name: 'Germany' } } }],
      jobLocationType: 'TELECOMMUTE',
      description: '<p>Join the <b>Payments</b> team.</p>',
      baseSalary: { currency: 'EUR', value: { minValue: 80000, maxValue: 100000, unitText: 'YEAR' } },
    }),
  );
  assert.equal(p.title, 'Senior Backend Engineer & Lead');
  assert.equal(p.datePosted, '2026-09-15T00:00:00.000Z');
  assert.equal(p.orgName, 'Acme Inc.');
  assert.equal(p.location, 'Berlin, Germany; Remote');
  assert.equal(p.text, 'Join the Payments team.');
  assert.equal(p.salary, 'EUR 80000 – 100000 YEAR');
});

test('JobPosting inside @graph and arrays; other types and bad JSON are ignored', () => {
  const html =
    page({ '@graph': [{ '@type': 'Organization', name: 'Acme' }, { '@type': ['JobPosting'], title: 'Designer' }] }) +
    '<script type="application/ld+json">{ not json </script>' +
    page([{ '@type': 'BreadcrumbList' }]);
  const postings = extractJobPostings(html);
  assert.equal(postings.length, 1);
  assert.equal(postings[0].title, 'Designer');
  assert.deepEqual(extractJobPostings('<html>no data</html>'), []);
});

test('robots and sitemaps', () => {
  assert.deepEqual(sitemapsFromRobots('User-agent: *\nSitemap: https://a.com/s1.xml\n sitemap:https://a.com/jobs.xml'), [
    'https://a.com/s1.xml',
    'https://a.com/jobs.xml',
  ]);
  const index = parseSitemap('<?xml version="1.0"?><sitemapindex><sitemap><loc>https://a.com/jobs.xml</loc></sitemap></sitemapindex>');
  assert.deepEqual(index, { urls: [], sitemaps: ['https://a.com/jobs.xml'] });
  const set = parseSitemap('<urlset><url><loc>https://a.com/jobs/1?x=1&amp;y=2</loc><lastmod>2026-10-01</lastmod></url><url><loc><![CDATA[https://a.com/jobs/2]]></loc></url></urlset>');
  assert.deepEqual(set.urls, [
    { loc: 'https://a.com/jobs/1?x=1&y=2', lastmod: '2026-10-01' },
    { loc: 'https://a.com/jobs/2', lastmod: null },
  ]);
  assert.ok(isLikelyJobSitemap('https://a.com/sitemap-jobs.xml'));
  assert.ok(!isLikelyJobSitemap('https://a.com/sitemap-blog.xml'));
});

test('canonical urls ignore case of host, trailing slash, hash and tracking params', () => {
  assert.equal(canonicalUrl('https://A.com/jobs/1/?utm_source=li#apply'), canonicalUrl('https://a.com/jobs/1'));
  assert.notEqual(canonicalUrl('https://a.com/jobs/1?id=2'), canonicalUrl('https://a.com/jobs/1?id=3'));
  assert.equal(canonicalUrl('nope'), null);
  // Seen live: apply links carry ?gh_jid=..., sitemaps do not.
  assert.equal(canonicalUrl('https://careers.acme.com/positions/77?gh_jid=77'), canonicalUrl('https://careers.acme.com/positions/77/'));
  // ...but on a generic page the id is what identifies the job.
  assert.notEqual(canonicalUrl('https://acme.com/careers/job?gh_jid=77'), canonicalUrl('https://acme.com/careers/job'));
});

test('microdata JobPosting (SAP SuccessFactors career sites)', () => {
  // Trimmed from a careers.underarmour.com job page.
  const html = `<div itemscope itemtype="http://schema.org/JobPosting">
    <span itemprop="jobLocation" itemscope itemtype="http://schema.org/Place"><span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
    <meta itemprop="addressLocality" content="Portland"><meta itemprop="addressRegion" content="OR"><meta itemprop="addressCountry" content="US"></span></span>
    <meta itemprop="datePosted" content="Sat Oct 17 07:00:00 UTC 2026"><meta itemprop="hiringOrganization" content="Under Armour">
    <h1><span itemprop="title" data-careersite-propertyid="title" class="rtltextaligneligible">Professional, FEA Engineering &amp; Footwear Innovation</span></h1>
    <span itemprop="description">...</span></div>`;
  assert.deepEqual(extractJobPostings(html), [
    {
      title: 'Professional, FEA Engineering & Footwear Innovation',
      datePosted: '2026-10-17T07:00:00.000Z',
      validThrough: null,
      orgName: 'Under Armour',
      location: 'Portland, OR, US',
      url: null,
      text: '',
      salary: null,
    },
  ]);
  assert.deepEqual(extractJobPostings('<p itemprop="title">Not a job page</p>'), []);
});
