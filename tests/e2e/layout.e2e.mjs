#!/usr/bin/env node
/**
 * Page-reading test against mock LinkedIn layouts, in a real Chromium with
 * the extension loaded. Dev-only: run by .github/workflows/semantic.yml.
 *
 *   npm install --no-save playwright@1.56.1 && npx playwright install chromium
 *   PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node tests/e2e/layout.e2e.mjs
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../../extension/', import.meta.url));
const html = readFileSync(new URL('./fixtures/linkedin-search-results-2026.html', import.meta.url), 'utf8');

const ctx = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let failed = false;
try {
  await ctx.route('https://www.linkedin.com/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  for (const host of ['https://boards-api.greenhouse.io/**', 'https://raw.githubusercontent.com/**', 'https://archive.org/**']) {
    await ctx.route(host, (r) => r.fulfill({ status: 404, json: {} }));
  }
  const page = await ctx.newPage();

  /** Wait for a finished badge on the heading that starts with `title`, then read the card it opened. */
  async function readCard(title) {
    await page.waitForFunction(
      (t) => {
        const host = document.querySelector('ghostcheck-badge');
        const badge = host?.shadowRoot.querySelector('.badge')?.dataset.badge;
        return host && host.parentElement.textContent.trim().startsWith(t) && badge && badge !== 'loading';
      },
      title,
      { timeout: 20000 },
    );
    const anchorFont = await page.evaluate(() => getComputedStyle(document.querySelector('ghostcheck-badge').parentElement).fontSize);
    // The card opens by itself once the result is ready.
    await page.waitForFunction(() => document.querySelector('ghostcheck-card')?.shadowRoot.querySelector('.card'), null, { timeout: 5000 });
    await page.evaluate(() => (document.querySelector('ghostcheck-card').shadowRoot.querySelector('details').open = true));
    const card = await page.evaluate(() => document.querySelector('ghostcheck-card').shadowRoot.querySelector('.card').innerText);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => !!document.querySelector('ghostcheck-card')), false, 'Escape closes the card');
    return { card, anchorFont };
  }

  await page.goto('https://www.linkedin.com/jobs/search-results/?currentJobId=4471791897&eBP=abc');
  const first = await readCard('Software Application Engineer');
  assert.equal(first.anchorFont, '24px', 'badge must sit on the details heading, not the list entry');
  for (const field of ['Cyient', 'Tokyo, Japan', 'easy', 'cyient']) assert.ok(first.card.includes(field), `card is missing ${field}`);
  // The description, not the Premium, hiring-team or company boxes around it.
  const descLength = Number(first.card.match(/Description length\s+(\d+)/)?.[1]);
  assert.ok(descLength > 850 && descLength < 1100, `description length ${descLength} should be the job text (~960 chars)`);
  assert.ok(await page.evaluate(() => document.fonts.check('20px GhostCheckVT323')), 'pixel font is registered');
  // Closed by the user: LinkedIn re-rendering the title must not pop it open again.
  await page.evaluate(() => document.querySelector('ghostcheck-badge').remove());
  await page.waitForFunction(() => document.querySelector('ghostcheck-badge'), null, { timeout: 5000 });
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => !!document.querySelector('ghostcheck-card')), false, 'a dismissed card stays closed');

  // Switch job: the pane re-renders after 0.5 s, the tab title after 1.2 s.
  await page.click('a[data-id="4471790000"]');
  const second = await readCard('Software Engineer');
  assert.equal(second.anchorFont, '24px');
  assert.match(second.card, /Job title\s+Software Engineer\b/);
  assert.match(second.card, /Location\s+Tokyo\b/);
  console.log('layout e2e: OK');
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await ctx.close();
}
process.exit(failed ? 1 : 0);
