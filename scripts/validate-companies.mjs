#!/usr/bin/env node
/**
 * Check every board in data/companies.json against the live public APIs.
 *
 *   node scripts/validate-companies.mjs            all companies
 *   node scripts/validate-companies.mjs stripe     only names/slugs containing "stripe"
 *
 * Exits 1 when a board does not exist (wrong slug) or a Greenhouse board's
 * name does not match the company. Network errors are reported as warnings
 * only, so a flaky API does not block contributions.
 */
import { readFileSync } from 'node:fs';
import { buildCompanyIndex, normalizeCompanyName } from '../core/companies.js';
import { fetchJson, RateLimiter } from '../core/http.js';
import { SOURCES } from '../core/sources/index.js';

const filter = (process.argv[2] || '').toLowerCase();
const index = buildCompanyIndex(JSON.parse(readFileSync(new URL('../data/companies.json', import.meta.url), 'utf8')));
const limiter = new RateLimiter({ minIntervalMs: 300, maxConcurrent: 2 });

if (index.errors.length) {
  console.error('companies.json has errors:');
  for (const e of index.errors) console.error(`  - ${e}`);
  process.exit(1);
}

const failures = [];
const warnings = [];
const shownRawKeys = new Set();

for (const c of index.entries) {
  if (filter && !c.name.toLowerCase().includes(filter) && !c.slug.toLowerCase().includes(filter)) continue;
  const source = SOURCES[c.ats];
  const label = `${c.name.padEnd(24)} ${c.ats.padEnd(10)} ${c.slug}`;
  if (!source) {
    console.log(`SKIP  ${label}  (no source for ${c.ats} yet)`);
    continue;
  }
  try {
    const json = await fetchJson(source.listUrl(c), { timeoutMs: 30000, retries: 2, limiter });
    const postings = source.parse(json);

    // Print the raw field names once per ATS so parser assumptions can be checked.
    if (!shownRawKeys.has(c.ats)) {
      const raw = Array.isArray(json) ? json[0] : json?.jobs?.[0];
      if (raw) {
        shownRawKeys.add(c.ats);
        console.log(`      raw ${c.ats} fields: ${Object.keys(raw).sort().join(', ')}`);
      }
    }

    let nameNote = '';
    if (c.ats === 'greenhouse') {
      const info = await fetchJson(source.infoUrl(c), { timeoutMs: 15000, retries: 2, limiter });
      const same = normalizeCompanyName(info?.name) === normalizeCompanyName(c.name) ||
        c.aliases.some((a) => normalizeCompanyName(a) === normalizeCompanyName(info?.name));
      nameNote = ` board name "${info?.name}"`;
      if (!same) failures.push(`${c.name}: Greenhouse board "${c.slug}" is named "${info?.name}"`);
    }
    const dated = postings.filter((p) => p.createdAt).length;
    const sample = postings[0] ? ` e.g. "${postings[0].title}" @ ${postings[0].location || '?'}` : '';
    console.log(`OK    ${label}  ${postings.length} jobs, ${dated} with publish date.${nameNote}${sample}`);
    if (!postings.length) warnings.push(`${c.name}: board has 0 open jobs`);
  } catch (err) {
    if (err?.isNotFound) {
      console.log(`FAIL  ${label}  board not found (${err.status})`);
      failures.push(`${c.name}: ${c.ats} board "${c.slug}" not found`);
    } else {
      console.log(`WARN  ${label}  ${err?.message || err}`);
      warnings.push(`${c.name}: ${err?.message || err}`);
    }
  }
}

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
}
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll boards in companies.json are valid.');
