import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRules } from '../core/rules.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const rules = parseRules(readFileSync(new URL('../rules.yaml', import.meta.url), 'utf8'));

test('README scoring table matches rules.yaml', () => {
  for (const s of rules.signals) {
    const points = `${s.type === 'negative' ? '−' : '+'}${s.weight}`;
    const row = readme.split('\n').map((line) => line.trim()).find((line) => line.startsWith(`| \`${s.id}\` |`));
    assert.ok(row, `README has no row for signal ${s.id}`);
    assert.ok(row.includes(`| ${points} |`), `README shows the wrong weight for ${s.id} (expected ${points}): ${row}`);
  }
  assert.ok(readme.includes(`**+${rules.badges.green.min_score} or more is 🟢**`), 'README green threshold is out of date');
  assert.ok(readme.includes(`**−${-rules.badges.red.max_score} or less is 🔴**`), 'README red threshold is out of date');
});
