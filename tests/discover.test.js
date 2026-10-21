import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverAts } from '../core/discover.js';
import { detectAts } from '../core/ats.js';

test('API addresses are recognised as boards', () => {
  assert.deepEqual(detectAts('https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true'), {
    ats: 'greenhouse', slug: 'acme', jobId: null, region: null,
  });
  assert.equal(detectAts('https://api.lever.co/v0/postings/acme?mode=json').slug, 'acme');
  assert.equal(detectAts('https://api.ashbyhq.com/posting-api/job-board/acme').slug, 'acme');
});

test('an Apply button to one posting gives the board and the posting', () => {
  const id = '0a1b2c3d-1111-2222-3333-444455556666';
  const { refs } = discoverAts(`<a class="btn" href="https://jobs.ashbyhq.com/acme/${id}/application">Apply</a>`);
  assert.deepEqual(refs[0].ref, { ats: 'ashby', slug: 'acme', jobId: id, region: null });
});

test('embeds inside scripts, with escaped slashes and entities', () => {
  const html =
    '<script>window.cfg={"board":"https:\\/\\/boards.greenhouse.io\\/embed\\/job_board\\/js?for=acme"}</script>' +
    '<iframe src="https://boards.greenhouse.io/embed/job_board?for=acme&amp;b=x"></iframe>';
  const { refs } = discoverAts(html);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].ref.slug, 'acme');
  assert.equal(refs[0].count, 2);
});

test('the most-linked board wins; a page listing many postings is not one posting', () => {
  const html =
    '<a href="https://jobs.lever.co/acme/0a1b2c3d-1111-2222-3333-444455556666">A</a>' +
    '<a href="https://jobs.lever.co/acme/0a1b2c3d-1111-2222-3333-444455556667">B</a>' +
    '<a href="https://boards.greenhouse.io/partner">partner</a>';
  const { refs } = discoverAts(html);
  assert.equal(refs[0].ref.ats, 'lever');
  assert.equal(refs[0].ref.jobId, null);
});

test('unsupported systems are named, unrelated links ignored', () => {
  const { refs, unsupported } = discoverAts(
    '<a href="https://herp.careers/v1/acme/abc">Apply</a> <a href="https://hrmos.co/pages/acme/jobs/1">x</a> <a href="https://twitter.com/acme">t</a>',
  );
  assert.deepEqual(refs, []);
  assert.deepEqual(unsupported.sort(), ['HERP', 'HRMOS']);
  assert.deepEqual(discoverAts(''), { refs: [], unsupported: [] });
});
