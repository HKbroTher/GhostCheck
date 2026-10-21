#!/usr/bin/env node
/**
 * Daily first-seen snapshot of every board in data/companies.json.
 * Run by .github/workflows/snapshot.yml; zero dependencies.
 *
 *   node scripts/snapshot.mjs              update data/first-seen/
 *   node scripts/snapshot.mjs --dry-run    fetch and report, write nothing
 *   node scripts/snapshot.mjs --only stripe
 *
 * A board that fails to load is left untouched: a failed fetch must never
 * mark its jobs as gone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCompanyIndex } from '../core/companies.js';
import { fetchJson, RateLimiter } from '../core/http.js';
import { SOURCES } from '../core/sources/index.js';
import { mergeSnapshot, serializeSnapshot, snapshotPath } from '../core/snapshot.js';
import { parseWayback, waybackQueryUrl } from '../core/wayback.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > 0 ? (process.argv[onlyIdx + 1] || '').toLowerCase() : '';
const SNAPSHOT_ATS = new Set(['greenhouse', 'lever', 'ashby', 'workable']);

const today = new Date().toISOString().slice(0, 10);
const limiter = new RateLimiter({ minIntervalMs: 500, maxConcurrent: 2 });
const companies = buildCompanyIndex(JSON.parse(readFileSync(join(ROOT, 'data/companies.json'), 'utf8')));
if (companies.errors.length) {
  console.error('companies.json has errors:', companies.errors);
  process.exit(1);
}

const summaryPath = join(ROOT, 'data/first-seen/index.json');
const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : { boards: {} };
let ok = 0;
let failed = 0;
let changedFiles = 0;
const sampleUrls = [];

for (const c of companies.entries) {
  if (!SNAPSHOT_ATS.has(c.ats)) continue;
  if (ONLY && !c.name.toLowerCase().includes(ONLY) && !c.slug.toLowerCase().includes(ONLY)) continue;
  const ref = { ats: c.ats, slug: c.slug, region: c.region };
  const rel = snapshotPath(ref);
  const file = join(ROOT, rel);
  try {
    const source = SOURCES[c.ats];
    const json = await fetchJson(source.listUrl(ref, { content: false }), { timeoutMs: 30000, retries: 2, limiter });
    const postings = source.parse(json);
    if (!postings.length && json && !Array.isArray(json) && !Array.isArray(json.jobs)) throw new Error('unexpected response shape');

    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    const { next, stats } = mergeSnapshot(prev, postings, { ats: c.ats, slug: c.slug, today });
    const text = serializeSnapshot(next);
    const changed = !existsSync(file) || readFileSync(file, 'utf8') !== text;
    if (changed && !DRY_RUN) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    if (changed) changedFiles++;
    summary.boards[rel] = { ats: c.ats, slug: c.slug, open: postings.length, since: next.since, checked: today };
    if (postings[0]?.url && sampleUrls.length < 2) sampleUrls.push(postings[0].url);
    ok++;
    console.log(
      `OK    ${rel.padEnd(48)} open ${String(postings.length).padStart(4)}  +${stats.added} new, ${stats.gone} gone, ${stats.back} back, ${stats.pruned} pruned`,
    );
  } catch (err) {
    failed++;
    console.log(`FAIL  ${rel.padEnd(48)} ${err?.message || err} (left unchanged)`);
  }
}

summary.updated = today;
if (!DRY_RUN) {
  mkdirSync(dirname(summaryPath), { recursive: true });
  const boards = Object.fromEntries(Object.entries(summary.boards).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(summaryPath, `${JSON.stringify({ updated: summary.updated, boards }, null, 2)}\n`);
}

if (DRY_RUN) {
  // Also exercise the Wayback parser against the live API.
  for (const url of [...sampleUrls, 'https://www.linkedin.com/jobs/view/3800000000/']) {
    try {
      const date = parseWayback(await fetchJson(waybackQueryUrl(url), { timeoutMs: 20000, retries: 1, limiter }));
      console.log(`wayback  ${url} -> ${date ?? 'no capture'}`);
    } catch (err) {
      console.log(`wayback  ${url} -> error: ${err?.message || err}`);
    }
  }
}

console.log(`\n${ok} boards ok, ${failed} failed, ${changedFiles} file(s) ${DRY_RUN ? 'would change' : 'changed'}.`);
if (ok === 0 && failed > 0) process.exit(1);
