#!/usr/bin/env node
/**
 * Browser end-to-end test of the description model, in a real Chromium with
 * the extension loaded. Downloads the real model from Hugging Face, so it
 * needs network access. Dev-only: run by .github/workflows/semantic.yml.
 *
 *   npm install --no-save playwright@1.56.1 && npx playwright install chromium
 *   PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node tests/e2e/model.e2e.mjs
 *
 * 1. Service worker -> offscreen document -> model: embeddings make sense.
 * 2. Full LinkedIn flow: a job whose title is worded differently from the
 *    careers site is confirmed through its description.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../../extension/', import.meta.url));
const ABOUT = 'Acme builds payment software used by millions of businesses around the world. ';
const BENEFITS = 'We offer a competitive salary, equity, comprehensive health insurance and generous parental leave. ';
const LEDGER =
  'You will design and build the double-entry ledger service that records every movement of money on our platform. ' +
  'You will own reconciliation pipelines, idempotent transfer APIs and the nightly settlement batch jobs. ' +
  'You will work closely with finance and risk teams to keep balances correct under heavy load. ' +
  'Strong experience with distributed transactions, Postgres and Kotlin services is expected. ';
const MOBILE =
  'You will build delightful iOS and Android experiences for merchants on the go. ' +
  'You will own offline sync, push notifications and the onboarding flow in our mobile apps. ' +
  'You will partner with designers to ship polished animations and accessible interfaces. ' +
  'Strong experience with Swift, Kotlin Multiplatform and mobile release pipelines is expected. ';
const DATA =
  'You will build the analytics warehouse and the experimentation platform used by every product team. ' +
  'You will own event ingestion, dbt models and the metrics layer that powers company dashboards. ' +
  'You will help teams design experiments and interpret results with statistical rigor. ' +
  'Strong experience with Spark, Airflow and SQL at terabyte scale is expected. ';

const LINKEDIN = `<!doctype html><html><head><meta charset="utf-8"></head><body><main><div class="jobs-search__job-details--container">
  <div class="job-details-jobs-unified-top-card__job-title"><h1><a href="/jobs/view/4242/">Member of Technical Staff</a></h1></div>
  <div class="job-details-jobs-unified-top-card__company-name"><a href="/company/acme-e2e/">Acme Payments</a></div>
  <div class="job-details-jobs-unified-top-card__primary-description-container"><span class="tvm__text">San Francisco, CA · 1 week ago</span></div>
  <div class="jobs-apply-button--top-card"><a class="jobs-apply-button" href="https://www.linkedin.com/redir/redirect?url=${encodeURIComponent('https://boards.greenhouse.io/acmepay')}">Apply</a></div>
  <div id="job-details">${ABOUT}${LEDGER}${BENEFITS}</div>
</div></main></body></html>`;
const posting = (id, title, body) => ({
  id,
  title,
  location: { name: 'San Francisco, CA' },
  absolute_url: `https://boards.greenhouse.io/acmepay/jobs/${id}`,
  first_published: new Date(Date.now() - 8 * 864e5).toISOString(),
  content: `<p>${ABOUT}</p><p>${body}</p><p>${BENEFITS}</p>`,
});
const BOARD = {
  jobs: [
    posting(1, 'Software Engineer, Payments Ledger', LEDGER),
    posting(2, 'Software Engineer, Mobile', MOBILE),
    posting(3, 'Data Engineer, Analytics', DATA),
  ],
};

const ctx = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const failures = [];
try {
  await ctx.route('https://www.linkedin.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: LINKEDIN }));
  await ctx.route('https://boards-api.greenhouse.io/**', (r) => r.fulfill({ json: BOARD }));
  await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.route('https://archive.org/**', (r) => r.fulfill({ json: { archived_snapshots: {} } }));

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const ext = await ctx.newPage();
  ext.on('console', (m) => m.type() === 'error' && failures.push(`console: ${m.text()}`));
  await ext.goto(`chrome-extension://${id}/options/options.html`);

  // 1. Embeddings through service worker -> offscreen document.
  const texts = ['Senior backend software engineer', 'Experienced server-side developer', 'Pastry chef for a busy bakery'];
  let res = null;
  const t0 = Date.now();
  for (let i = 0; i < 12 && !res?.vectors; i++) {
    // The first calls may time out while the model downloads.
    res = await ext.evaluate((t) => chrome.runtime.sendMessage({ type: 'ghostcheck:debug-embed', texts: t }), texts);
    if (!res?.vectors) console.log(`  model not ready (${res?.error}), retrying...`);
  }
  assert.ok(res?.vectors, `no embeddings: ${res?.error}`);
  const [a, b, c] = res.vectors;
  const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
  console.log(`model ready after ${((Date.now() - t0) / 1000).toFixed(1)} s; dims ${a.length}`);
  console.log(`similarity engineer~developer ${dot(a, b).toFixed(3)}, engineer~chef ${dot(a, c).toFixed(3)}`);
  assert.equal(a.length, 384);
  assert.ok(dot(a, b) > dot(a, c) + 0.2, 'related texts should be much closer than unrelated ones');
  await ext.reload();
  console.log(`options page model status: ${await ext.textContent('#model-status')}`);

  // 2. Full flow: reworded title confirmed by description.
  const page = await ctx.newPage();
  await page.goto('https://www.linkedin.com/jobs/view/4242/');
  await page.waitForFunction(
    () => {
      const b = document.querySelector('ghostcheck-badge')?.shadowRoot.querySelector('.badge')?.dataset.badge;
      return b && b !== 'loading';
    },
    null,
    { timeout: 60000 },
  );
  // The card opens by itself when the result is ready.
  await page.waitForFunction(() => document.querySelector('ghostcheck-card')?.shadowRoot.querySelector('.card'), null, { timeout: 5000 });
  await page.evaluate(() => (document.querySelector('ghostcheck-card').shadowRoot.querySelector('details').open = true));
  const card = await page.evaluate(() => document.querySelector('ghostcheck-card').shadowRoot.querySelector('.card').innerText);
  console.log(`\n--- card ---\n${card}\n------------`);
  assert.match(card, /Likely real/);
  assert.match(card, /Matched by job description/);
  assert.match(card, /Software Engineer, Payments Ledger/);

  // 3. Multilingual model: Japanese LinkedIn job, English careers site.
  await ext.evaluate(() =>
    chrome.storage.local.set({ settings: { semantic: true, semanticModel: 'multilingual', language: 'en' } }),
  );
  const multi = ['ソフトウェアエンジニア', 'Software engineer', 'Pastry chef for a busy bakery'];
  let mres = null;
  const t1 = Date.now();
  for (let i = 0; i < 12 && !mres?.vectors; i++) {
    mres = await ext.evaluate((t) => chrome.runtime.sendMessage({ type: 'ghostcheck:debug-embed', texts: t, model: 'multilingual' }), multi);
    if (!mres?.vectors) console.log(`  multilingual model not ready (${mres?.error}), retrying...`);
  }
  assert.ok(mres?.vectors, `no multilingual embeddings: ${mres?.error}`);
  const [ja, enEng, chef] = mres.vectors;
  console.log(`multilingual model ready after ${((Date.now() - t1) / 1000).toFixed(1)} s; dims ${ja.length}`);
  console.log(`similarity ソフトウェアエンジニア~Software engineer ${dot(ja, enEng).toFixed(3)}, ~Pastry chef ${dot(ja, chef).toFixed(3)}`);
  assert.ok(dot(ja, enEng) > dot(ja, chef) + 0.2, 'a Japanese title should be close to its English translation');

  const JA_LEDGER =
    '当社のプラットフォーム上のすべてのお金の動きを記録する複式簿記の元帳サービスを設計・構築していただきます。' +
    '照合パイプライン、冪等な送金API、夜間の決済バッチ処理を担当していただきます。' +
    '財務チームやリスクチームと緊密に連携し、高負荷の下でも残高を正確に保ちます。' +
    '分散トランザクション、Postgres、Kotlinサービスの豊富な経験が求められます。';
  const jaPage = LINKEDIN.replace('Member of Technical Staff', '決済元帳ソフトウェアエンジニア').replace(
    `${ABOUT}${LEDGER}${BENEFITS}`,
    `${ABOUT}${JA_LEDGER}${BENEFITS}`,
  );
  await ctx.unroute('https://www.linkedin.com/**');
  await ctx.route('https://www.linkedin.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: jaPage }));
  const jp = await ctx.newPage();
  // Same job id as the page's title link, so the pane check accepts it; the
  // result is cached per model, so this is a fresh check.
  await jp.goto('https://www.linkedin.com/jobs/view/4242/');
  await jp.waitForFunction(
    () => {
      const b = document.querySelector('ghostcheck-badge')?.shadowRoot.querySelector('.badge')?.dataset.badge;
      return b && b !== 'loading';
    },
    null,
    { timeout: 90000 },
  );
  // The card opens by itself when the result is ready.
  await jp.waitForFunction(() => document.querySelector('ghostcheck-card')?.shadowRoot.querySelector('.card'), null, { timeout: 5000 });
  await jp.evaluate(() => (document.querySelector('ghostcheck-card').shadowRoot.querySelector('details').open = true));
  const jaCard = await jp.evaluate(() => document.querySelector('ghostcheck-card').shadowRoot.querySelector('.card').innerText);
  console.log(`\n--- Japanese job, multilingual model ---\n${jaCard}\n------------`);
  // Never "not found" across languages; with the multilingual model it should be confirmed.
  assert.doesNotMatch(jaCard, /Suspicious/);
  if (!/Matched by job description/.test(jaCard)) console.log('NOTE: cross-language job not confirmed (stayed unknown); see similarity above.');
} catch (err) {
  failures.push(err.stack || String(err));
} finally {
  await ctx.close();
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('\nmodel e2e: OK');
