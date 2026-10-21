#!/usr/bin/env node
/**
 * Copy the shared sources into extension/ so the folder can be loaded as-is.
 * Chrome cannot read files outside the folder you load, so core/ and
 * rules.yaml are copied (not symlinked: symlinks break on Windows and in
 * GitHub ZIP downloads).
 *
 *   node scripts/sync.mjs          copy core/ and rules.yaml into extension/
 *   node scripts/sync.mjs --check  exit 1 if extension/ is out of date (CI)
 *
 * Zero dependencies; Node 18+.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/** [source, destination] pairs, relative to the repo root. */
function plannedCopies() {
  const pairs = [];
  for (const name of readdirSync(join(ROOT, 'core'))) {
    if (name.endsWith('.js')) pairs.push([join('core', name), join('extension', 'core', name)]);
  }
  if (existsSync(join(ROOT, 'rules.yaml'))) pairs.push(['rules.yaml', join('extension', 'rules.yaml')]);
  return pairs;
}

const pairs = plannedCopies();
const expected = new Set(pairs.map(([, dest]) => dest));
const problems = [];

// Files in extension/core that no longer exist in core/.
const destCore = join(ROOT, 'extension', 'core');
if (existsSync(destCore)) {
  for (const name of readdirSync(destCore)) {
    const rel = join('extension', 'core', name);
    if (!expected.has(rel)) {
      if (CHECK) problems.push(`stale file: ${rel}`);
      else rmSync(join(ROOT, rel));
    }
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
