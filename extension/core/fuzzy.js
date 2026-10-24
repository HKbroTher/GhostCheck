/**
 * Small, dependency-free string similarity helpers (0..1).
 */

/** Dice coefficient over token sets. */
export function tokenDice(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/**
 * How much of the smaller token set is contained in the larger one.
 * Requires at least two tokens so "Engineer" alone does not match everything.
 */
export function tokenContainment(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  if (small.size < 2) return 0;
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  return shared / small.size;
}

function bigrams(s) {
  const out = new Map();
  const str = ` ${s} `;
  for (let i = 0; i < str.length - 1; i++) {
    const g = str.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Dice coefficient over character bigrams; tolerant of typos and plurals. */
export function bigramDice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  let total = 0;
  for (const [g, n] of A) {
    total += n;
    if (B.has(g)) shared += Math.min(n, B.get(g));
  }
  for (const n of B.values()) total += n;
  return (2 * shared) / total;
}

/**
 * Title similarity from normalized token lists.
 * Containment is discounted so it ranks below an exact token match.
 * @param {string[]} a
 * @param {string[]} b
 */
export function titleSimilarity(a, b) {
  const sortedA = [...new Set(a)].sort().join(' ');
  const sortedB = [...new Set(b)].sort().join(' ');
  return Math.max(tokenDice(a, b), 0.9 * tokenContainment(a, b), bigramDice(sortedA, sortedB));
}
