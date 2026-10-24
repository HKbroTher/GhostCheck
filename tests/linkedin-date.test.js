import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkedInPosted } from '../core/linkedin-date.js';

test('LinkedIn posting dates in English, Japanese and Chinese', () => {
  assert.deepEqual(parseLinkedInPosted('Tokyo, Japan · 3 weeks ago · 83 applicants'), { days: 21, reposted: false });
  assert.deepEqual(parseLinkedInPosted('San Francisco, CA · Reposted 2 days ago · Over 100 applicants'), { days: 2, reposted: true });
  assert.deepEqual(parseLinkedInPosted('London · an hour ago · 5 applicants'), { days: 0, reposted: false });
  assert.deepEqual(parseLinkedInPosted('東京都 · 2週間前に再投稿 · 応募者83人'), { days: 14, reposted: true });
  assert.deepEqual(parseLinkedInPosted('上海 · 1 周前重新发布 · 50 位申请者'), { days: 7, reposted: true });
  assert.deepEqual(parseLinkedInPosted('北京 · 2 个月前 · 超过 100 位申请者'), { days: 60, reposted: false });
  assert.equal(parseLinkedInPosted('Remote · 40 applicants'), null);
  assert.equal(parseLinkedInPosted(''), null);
});
