#!/usr/bin/env node
/**
 * Evaluate description matching on live job boards with the real model.
 * Dev-only: needs `npm install --no-save @huggingface/transformers@3.7.6`
 * (the extension itself bundles its own copy). Run by .github/workflows/semantic.yml.
 *
 * For sampled postings P, the "LinkedIn description" is P's text with a
 * quarter of its sentences dropped (LinkedIn copies are often edited).
 * Candidates are P plus its closest-titled siblings on the same board.
 *
 *   positives: P is among the candidates -> how often is P promoted, how
 *              often a sibling (a wrong job)?
 *   negatives: P is removed -> any promotion is a false "found".
 */
import { pipeline } from '@huggingface/transformers';
import { fetchJson, RateLimiter } from '../core/http.js';
import { SOURCES } from '../core/sources/index.js';
import { normalizeTitle } from '../core/normalize.js';
import { titleSimilarity } from '../core/fuzzy.js';
import { buildBoilerplate, stripBoilerplate, splitSentences, isMostlyLatin, cosine, decide, DEFAULT_SEMANTIC } from '../core/semantic.js';

const BOARDS = [
  ['greenhouse', 'stripe'],
  ['greenhouse', 'airbnb'],
  ['greenhouse', 'figma'],
  ['greenhouse', 'cloudflare'],
  ['greenhouse', 'discord'],
  ['greenhouse', 'duolingo'],
  ['lever', 'spotify'],
  ['ashby', 'notion'],
  ['ashby', 'ramp'],
];
const PER_BOARD = 25;
const SIBLINGS = 7;
const GRID_SIM = [0.75, 0.8, 0.85, 0.88, 0.9, 0.93];
const GRID_MARGIN = [0.02, 0.05, 0.08];

// Small deterministic RNG so runs are comparable.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const limiter = new RateLimiter({ minIntervalMs: 400, maxConcurrent: 2 });
console.log('Loading model...');
const t0 = Date.now();
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
console.log(`Model ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const embed = async (texts) => (await extractor(texts, { pooling: 'mean', normalize: true })).tolist();

const cases = []; // { positive: scored[], negative: scored[] }
let embedded = 0;
const tEmbed = Date.now();

for (const [ats, slug] of BOARDS) {
  let postings;
  try {
    postings = SOURCES[ats].parse(await fetchJson(SOURCES[ats].listUrl({ slug }), { timeoutMs: 60000, retries: 2, limiter }));
  } catch (err) {
    console.log(`skip ${ats}/${slug}: ${err.message}`);
    continue;
  }
  const boilerplate = buildBoilerplate(postings.map((p) => p.text));
  const stripped = new Map(postings.map((p) => [p, stripBoilerplate(p.text, boilerplate)]));
  const usable = postings.filter((p) => stripped.get(p).length >= DEFAULT_SEMANTIC.min_chars && isMostlyLatin(stripped.get(p)));
  const titles = new Map(usable.map((p) => [p, normalizeTitle(p.title)]));
  const vectors = new Map();
  const vec = async (p) => {
    if (!vectors.has(p)) {
      vectors.set(p, (await embed([stripped.get(p)]))[0]);
      embedded++;
    }
    return vectors.get(p);
  };

  const sample = [...usable].sort(() => rand() - 0.5).slice(0, PER_BOARD);
  for (const p of sample) {
    const siblings = usable
      .filter((q) => q !== p && q.title.toLowerCase() !== p.title.toLowerCase())
      .map((q) => ({ q, s: titleSimilarity(titles.get(p).tokens, titles.get(q).tokens) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, SIBLINGS)
      .map((x) => x.q);
    if (siblings.length < 2) continue;

    // The "LinkedIn" copy: same job, a quarter of its sentences dropped.
    const sentences = splitSentences(p.text).filter(() => rand() > 0.25);
    const jd = stripBoilerplate(sentences.join(' '), boilerplate);
    if (jd.length < DEFAULT_SEMANTIC.min_chars) continue;
    const [jdVec] = await embed([jd]);
    embedded++;

    const score = async (q) => ({ posting: q, score: 0, similarity: cosine(jdVec, await vec(q)), isTrue: q === p });
    const negative = await Promise.all(siblings.map(score));
    const positive = [await score(p), ...negative];
    cases.push({ positive, negative, board: `${ats}/${slug}`, title: p.title });
  }
  console.log(`${ats}/${slug}: ${postings.length} postings, ${usable.length} usable, ${cases.length} cases so far`);
}

const perEmbed = (Date.now() - tEmbed) / Math.max(1, embedded);
console.log(`\n${cases.length} cases, ${embedded} embeddings, ${perEmbed.toFixed(0)} ms per embedding (incl. network)\n`);

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const trueSims = cases.map((c) => c.positive[0].similarity);
const bestWrong = cases.map((c) => Math.max(...c.negative.map((x) => x.similarity)));
console.log(`similarity to the true posting: mean ${avg(trueSims).toFixed(3)}, min ${Math.min(...trueSims).toFixed(3)}`);
console.log(`best wrong sibling:             mean ${avg(bestWrong).toFixed(3)}, max ${Math.max(...bestWrong).toFixed(3)}\n`);

console.log('threshold margin | promoted correctly | promoted WRONG (P present) | false found (P absent)');
for (const sim of GRID_SIM) {
  for (const margin of GRID_MARGIN) {
    const o = { ...DEFAULT_SEMANTIC, promote_min_similarity: sim, min_margin: margin };
    let right = 0;
    let wrong = 0;
    let falseFound = 0;
    for (const c of cases) {
      const pos = decide(c.positive, 'promote', o).pick;
      if (pos?.isTrue) right++;
      else if (pos) wrong++;
      if (decide(c.negative, 'promote', o).pick) falseFound++;
    }
    const pct = (n) => `${((100 * n) / cases.length).toFixed(1)}%`.padStart(6);
    const mark = sim === DEFAULT_SEMANTIC.promote_min_similarity && margin === DEFAULT_SEMANTIC.min_margin ? '  <- current' : '';
    console.log(`  ${sim.toFixed(2)}    ${margin.toFixed(2)}  |   ${pct(right)}           |   ${pct(wrong)}                  |   ${pct(falseFound)}${mark}`);
  }
}

// Tie-break: two postings, the true one and its closest-titled sibling.
const o = DEFAULT_SEMANTIC;
let tbRight = 0;
let tbWrong = 0;
for (const c of cases) {
  const pick = decide([c.positive[0], c.negative[0]], 'tiebreak', o).pick;
  if (pick?.isTrue) tbRight++;
  else if (pick) tbWrong++;
}
console.log(`\ntie-break (true vs closest sibling, margin ${o.min_margin}): right ${tbRight}, wrong ${tbWrong}, undecided ${cases.length - tbRight - tbWrong}`);
