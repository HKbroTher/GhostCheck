#!/usr/bin/env node
/**
 * Copy the shared sources into extension/ so the folder can be loaded as-is.
 * Chrome cannot read files outside the folder you load, so core/,
 * rules.yaml and data/companies.json are copied (not symlinked: symlinks break on Windows and in
 * GitHub ZIP downloads).
 *
 *   node scripts/sync.mjs          copy core/, rules.yaml, data/companies.json into extension/
 *   node scripts/sync.mjs --check  exit 1 if extension/ is out of date (CI)
 *
 * Zero dependencies; Node 18+.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/** All files under `dir` (relative to the repo root), recursively. */
function walk(dir) {
  const out = [];
  if (!existsSync(join(ROOT, dir))) return out;
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

/** [source, destination] pairs, relative to the repo root. */
function plannedCopies() {
  const pairs = walk('core').map((src) => [src, join('extension', src)]);
  if (existsSync(join(ROOT, 'rules.yaml'))) pairs.push(['rules.yaml', join('extension', 'rules.yaml')]);
  // Bundled fallback; the extension refreshes it from GitHub at runtime.
  const companies = join('data', 'companies.json');
  if (existsSync(join(ROOT, companies))) pairs.push([companies, join('extension', companies)]);
  return pairs;
}

const pairs = plannedCopies();
const expected = new Set(pairs.map(([, dest]) => dest));
const problems = [];

// Files in extension/core that no longer exist in core/.
for (const rel of walk(join('extension', 'core'))) {
  if (!expected.has(rel)) {
    if (CHECK) problems.push(`stale file: ${rel}`);
    else rmSync(join(ROOT, rel));
  }
}

for (const [src, dest] of pairs) {
  const content = readFileSync(join(ROOT, src));
  const destPath = join(ROOT, dest);
  const current = existsSync(destPath) ? readFileSync(destPath) : null;
  if (current && current.equals(content)) continue;
  if (CHECK) {
    problems.push(`${current ? 'out of date' : 'missing'}: ${dest} (from ${src})`);
  } else {
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, content);
    console.log(`copied ${src} -> ${relative(ROOT, destPath)}`);
  }
}

if (CHECK) {
  if (problems.length) {
    console.error('extension/ is out of sync with core/. Run: node scripts/sync.mjs');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('extension/ is in sync.');
}
