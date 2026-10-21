import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectJobBoard, jobBoardName } from '../core/job-boards.js';

test('job boards and agencies are recognised by domain or brand', () => {
  const name = (url, company) => detectJobBoard(url, company)?.name ?? null;
  assert.equal(name('https://www.liepin.com/job/1970000000.shtml'), 'Liepin');
  assert.equal(name('https://m.zhipin.com/job_detail/abc.html'), 'BOSS Zhipin');
  assert.equal(name('https://jp.indeed.com/viewjob?jk=1'), 'Indeed');
  assert.equal(name('https://www.indeed.co.uk/viewjob?jk=1'), 'Indeed');
  assert.equal(name('https://www.michaelpage.co.jp/job-detail/x'), 'Michael Page');
  assert.equal(name('https://www.robertwalters.com.cn/jobs/1'), 'Robert Walters');
  assert.equal(name('https://doda.jp/DodaFront/View/JobSearchDetail/j_jid__1/'), 'doda');
});

test('company sites are not job boards', () => {
  for (const url of ['https://careers.fedex.com/job/1', 'https://boards.greenhouse.io/acme/jobs/1', 'https://monsterenergy.com/careers', 'https://www.hayshouse.com/jobs', 'not a url']) {
    assert.equal(detectJobBoard(url), null, url);
  }
});

test("an agency's own jobs on its own site are its careers site", () => {
  assert.equal(detectJobBoard('https://www.randstad.com/jobs/1', 'Randstad'), null);
  assert.equal(detectJobBoard('https://www.randstad.com/jobs/1', 'Acme')?.name, 'Randstad');
});

test('job board names follow the interface language', () => {
  const liepin = detectJobBoard('https://www.liepin.com/job/1.shtml');
  assert.equal(jobBoardName(liepin, 'zh'), '猎聘');
  assert.equal(jobBoardName(liepin, 'en'), 'Liepin (猎聘)');
  assert.equal(jobBoardName(detectJobBoard('https://www.indeed.com/viewjob?jk=1'), 'zh'), 'Indeed');
});
