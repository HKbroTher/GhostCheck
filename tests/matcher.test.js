import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPosting } from '../core/matcher.js';

const P = (id, title, location = '') => ({ id, title, location, url: null, createdAt: null, text: '' });

const BOARD = [
  P('1', 'Senior Software Engineer, Payments', 'San Francisco, CA'),
  P('2', 'Staff Software Engineer, Payments', 'San Francisco, CA'),
  P('3', 'Engineering Manager, Payments', 'San Francisco, CA'),
  P('4', 'Product Designer', 'Remote - US'),
  P('5', 'Software Engineer Intern', 'New York, NY'),
  P('6', 'Account Executive, Enterprise', 'London, UK'),
];

test('matches by posting id from the apply link first', () => {
  const m = matchPosting({ title: 'Totally different' }, BOARD, { jobId: '4' });
  assert.equal(m.status, 'found');
  assert.equal(m.via, 'id');
  assert.equal(m.posting.id, '4');
});

test('fuzzy match with abbreviations and level', () => {
  const m = matchPosting({ title: 'Sr. Software Eng - Payments', location: 'San Francisco Bay Area' }, BOARD);
  assert.equal(m.status, 'found');
  assert.equal(m.posting.id, '1');
});

test('level must agree when both state one', () => {
  const m = matchPosting({ title: 'Principal Software Engineer, Payments', location: 'San Francisco, CA' }, BOARD);
  assert.equal(m.status, 'similar');
  assert.equal(m.mismatch, 'level');
});

test('title without level matches a leveled posting', () => {
  const m = matchPosting({ title: 'Product Designer', location: 'United States' }, BOARD);
  assert.equal(m.status, 'found');
  assert.equal(m.posting.id, '4');
});

test('different location is "similar", never "not found"', () => {
  const m = matchPosting({ title: 'Account Executive - Enterprise', location: 'Austin, TX' }, BOARD);
  assert.equal(m.status, 'similar');
  assert.equal(m.mismatch, 'location');
});

test('manager vs individual contributor are different jobs', () => {
  const m = matchPosting({ title: 'Engineering Manager', location: 'San Francisco, CA' }, [BOARD[0], BOARD[1]]);
  assert.equal(m.status, 'not_found');
});

test('internships do not match full-time roles', () => {
  const m = matchPosting({ title: 'Software Engineer', location: 'New York, NY' }, [BOARD[4]]);
  assert.notEqual(m.status, 'found');
});

test('nothing similar -> not_found; listed id gone -> id_missing', () => {
  assert.equal(matchPosting({ title: 'Data Scientist' }, BOARD).status, 'not_found');
  assert.equal(matchPosting({ title: 'Data Scientist' }, BOARD, { jobId: '999' }).status, 'id_missing');
});

test('id gone but job reposted under a new id -> found', () => {
  const m = matchPosting({ title: 'Product Designer', location: 'Remote' }, BOARD, { jobId: '999' });
  assert.equal(m.status, 'found');
  assert.equal(m.posting.id, '4');
});
