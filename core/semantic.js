/**
 * Job-description similarity with a local embedding model.
 *
 * Used only to IMPROVE a title match, never to make a job look worse:
 *   - a reworded title ("Member of Technical Staff" vs "Software Engineer,
 *     Payments") can be promoted to "found" when the descriptions agree;
 *   - several postings with near-identical titles can be told apart.
 *
 * Postings from one company share boilerplate (about us, benefits, legal), so
 * sentences that recur across the board are removed before embedding;
 * otherwise every job of a company would look alike.
 *
 * The model itself lives in the extension (offscreen document) or a Node
 * script; this module only needs an `embed(texts) => number[][]` function.
 */

const MIN_SENTENCE_CHARS = 25;
/** The model reads ~256 tokens; longer text only costs time. */
const MAX_EMBED_CHARS = 1500;
const MAX_CANDIDATES = 8;

export const DEFAULT_SEMANTIC = {
  enabled: true,
  multilingual: false, // set at runtime from the user's model choice
  min_chars: 300, // role-specific text needed on both sides
  promote_min_similarity: 0.88, // see rules.yaml for the measurements
  min_margin: 0.05,
  tie_title_gap: 0.05, // titles this close count as a tie
};

/** @param {string} text */
export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+|\s[•·]\s/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= MIN_SENTENCE_CHARS);
}

const sentenceKey = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Sentences that appear in at least two of the board's postings.
 * @param {string[]} texts
 * @returns {Set<string>}
 */
export function buildBoilerplate(texts) {
  const counts = new Map();
  for (const text of texts) {
    for (const key of new Set(splitSentences(text).map(sentenceKey))) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = new Set();
  for (const [key, n] of counts) if (n >= 2) out.add(key);
  return out;
}

/** Role-specific part of a description. */
export function stripBoilerplate(text, boilerplate, maxChars = MAX_EMBED_CHARS) {
  return splitSentences(text)
    .filter((s) => !boilerplate.has(sentenceKey(s)))
    .join(' ')
    .slice(0, maxChars);
}

/** Very common English words: their share tells English text from other Latin-script languages. */
const ENGLISH_WORDS = new Set([
  'the', 'and', 'to', 'of', 'a', 'in', 'for', 'with', 'you', 'our', 'we', 'will', 'is', 'are', 'on', 'as', 'be',
  'your', 'or', 'this', 'that', 'an', 'by', 'at', 'from', 'have', 'who', 'work', 'team', 'experience', 'about',
]);

/** Is this text English? (The default model only understands English.) */
export function isLikelyEnglish(text) {
  if (!isMostlyLatin(text)) return false;
  const words = String(text).toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 30) return false;
  const common = words.filter((w) => ENGLISH_WORDS.has(w)).length;
  return common / words.length >= 0.12;
}

/** The bundled model is English-only; skip text that is mostly another script. */
export function isMostlyLatin(text) {
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (letters.length < 50) return false;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return latin / letters.length >= 0.8;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Re-examine a title match using the descriptions.
 *
 * @param {{ description?: string }} job
 * @param {ReturnType<import('./matcher.js').matchPosting>} match
 * @param {import('./sources/index.js').Posting[]} postings   the whole board (for boilerplate)
 * @param {(texts: string[]) => Promise<number[][] | null>} embed
 * @param {Partial<typeof DEFAULT_SEMANTIC>} [opts]
 * @returns {Promise<{ match: object, semantic: { similarity: number, runnerUp: number | null, decision: string } | null }>}
 *   the (possibly improved) match, and what the model said
 */
export async function refineMatch(job, match, postings, embed, opts = {}) {
  const o = { ...DEFAULT_SEMANTIC, ...opts };
  const none = { match, semantic: null };
  if (!o.enabled || !embed || !match?.pool?.length) return none;

  // Which candidates are worth a look?
  let mode;
  let pool;
  if (match.status === 'found' && match.via !== 'id') {
    pool = match.pool.filter((c) => !c.mismatch && match.score - c.score <= o.tie_title_gap);
    if (pool.length < 2) return none;
    mode = 'tiebreak';
  } else if (match.status === 'not_found' || (match.status === 'similar' && match.mismatch === 'title')) {
    pool = match.pool.filter((c) => !c.mismatch || c.mismatch === 'title');
    mode = 'promote';
  } else {
    return none;
  }
  pool = pool.slice(0, MAX_CANDIDATES);
  if (!pool.length) return none;

  const boilerplate = buildBoilerplate(postings.map((p) => p.text));
  const jd = stripBoilerplate(job.description, boilerplate);
  // The default model is English-only; the multilingual one reads any language.
  if (jd.length < o.min_chars || (!o.multilingual && !isLikelyEnglish(jd))) return none;
  const usable = pool
    .map((c) => ({ ...c, text: stripBoilerplate(c.posting.text, boilerplate) }))
    .filter((c) => c.text.length >= o.min_chars && (o.multilingual || isLikelyEnglish(c.text)));
  if (!usable.length) return none;

  let vectors;
  try {
    vectors = await embed([jd, ...usable.map((c) => c.text)]);
  } catch {
    return none; // model unavailable: keep the title result
  }
  if (!vectors || vectors.length !== usable.length + 1) return none;

  const scored = usable.map((c, i) => ({ ...c, similarity: cosine(vectors[0], vectors[i + 1]) }));
  const verdict = decide(scored, mode, o);
  const semantic = { similarity: verdict.similarity, runnerUp: verdict.runnerUp, decision: verdict.decision };
  if (!verdict.pick || (mode === 'tiebreak' && verdict.pick.posting === match.posting)) return { match, semantic };
  if (mode === 'tiebreak') return { match: { ...match, posting: verdict.pick.posting, via: 'description' }, semantic };
  return {
    match: { ...match, status: 'found', posting: verdict.pick.posting, score: verdict.pick.score, via: 'description', mismatch: null },
    semantic,
  };
}

/**
 * The decision rule, shared with scripts/eval-semantic.mjs.
 * @param {Array<{ similarity: number }>} scored   candidates with cosine similarity
 * @param {'promote' | 'tiebreak'} mode
 * @param {typeof DEFAULT_SEMANTIC} o
 * @returns {{ pick: object | null, similarity: number, runnerUp: number | null, decision: 'kept' | 'tiebreak' | 'promoted' }}
 *   decision is a code; core/i18n.js has the words
 */
export function decide(scored, mode, o) {
  const sorted = [...scored].sort((a, b) => b.similarity - a.similarity);
  const [best, second] = sorted;
  const round = (n) => Math.round(n * 100) / 100;
  const out = { pick: null, similarity: round(best.similarity), runnerUp: second ? round(second.similarity) : null, decision: 'kept' };
  const margin = second ? best.similarity - second.similarity : 1;
  if (margin < o.min_margin) return out;
  if (mode === 'tiebreak') return { ...out, pick: best, decision: 'tiebreak' };
  if (best.similarity >= o.promote_min_similarity) return { ...out, pick: best, decision: 'promoted' };
  return out;
}
