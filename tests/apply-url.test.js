import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApplyUrl, cleanRawUrl } from '../core/apply-url.js';

const GH = 'https://boards.greenhouse.io/acme/jobs/12345';

test('returns direct external URLs unchanged', () => {
  assert.equal(resolveApplyUrl(GH), GH);
});

test('unwraps /redir/redirect', () => {
  const wrapped = `https://www.linkedin.com/redir/redirect?url=${encodeURIComponent(GH)}&urlhash=abc`;
  assert.equal(resolveApplyUrl(wrapped), GH);
});

test('unwraps relative externalApply links', () => {
  const wrapped = `/jobs/view/externalApply/3999?url=${encodeURIComponent(GH)}&urlHash=x`;
  assert.equal(resolveApplyUrl(wrapped), GH);
});

test('unwraps nested redirects', () => {
  const inner = `https://www.linkedin.com/redir/redirect?url=${encodeURIComponent(GH)}`;
  const outer = `https://www.linkedin.com/safety/go?url=${encodeURIComponent(inner)}`;
  assert.equal(resolveApplyUrl(outer), GH);
});

test('handles the logged-out <code id="applyUrl"> comment format', () => {
  const raw = `<!--"https://www.linkedin.com/jobs/view/externalApply/1?url=${encodeURIComponent(GH)}&amp;urlHash=x"-->`;
  assert.equal(resolveApplyUrl(raw), GH);
});

test('strips utm_* tracking parameters only', () => {
  const url = 'https://jobs.lever.co/acme/abc-123?utm_source=linkedin&lever-source=LinkedIn';
  assert.equal(resolveApplyUrl(url), 'https://jobs.lever.co/acme/abc-123?lever-source=LinkedIn');
});

test('returns null for Easy Apply and internal LinkedIn links', () => {
  assert.equal(resolveApplyUrl(null), null);
  assert.equal(resolveApplyUrl(''), null);
  assert.equal(resolveApplyUrl('https://www.linkedin.com/jobs/view/123/'), null);
  assert.equal(resolveApplyUrl('#'), null);
});

test('rejects non-http schemes', () => {
  assert.equal(resolveApplyUrl('javascript:alert(1)'), null);
  assert.equal(
    resolveApplyUrl(`https://www.linkedin.com/redir/redirect?url=${encodeURIComponent('javascript:alert(1)')}`),
    null,
  );
});

test('cleanRawUrl removes quotes, comment markers and entities', () => {
  assert.equal(cleanRawUrl(' <!--"https://a.com/?x=1&amp;y=2"--> '), 'https://a.com/?x=1&y=2');
});
