/**
 * First-seen index: one small file per job board, updated daily by
 * scripts/snapshot.mjs and read by the extension.
 *
 * data/first-seen/{ats}/{slug}.json
 * {
 *   "version": 1,
 *   "ats": "greenhouse",
 *   "slug": "stripe",
 *   "since": "2026-10-21",          // first day this board was tracked
 *   "jobs": {
 *     "123": { "t": "Software Engineer", "f": "2026-10-21" },              // open
 *     "456": { "t": "Designer", "f": "2026-10-01", "g": "2026-10-20" }     // gone since
 *   }
 * }
 *
 * Only changes are written (new job, job gone, job back), so unchanged jobs
 * produce no git diff. A job with f === since was already open when tracking
 * started: its real first-seen date is on or before `since`.
 */

export const SNAPSHOT_VERSION = 1;
/** Closed jobs are forgotten after this many days. */
export const KEEP_GONE_DAYS = 180;

/** Path segment safe for any slug (Ashby slugs may contain spaces or capitals). */
export function snapshotPath({ ats, slug, region }) {
  const dir = region === 'eu' ? `${ats}-eu` : ats;
  const file = String(slug).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  return `data/first-seen/${dir}/${file}.json`;
}

const DAY_MS = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/**
 * Merge today's postings into the previous index.
 * @param {object | null} prev   previous file content, or null for a new board
 * @param {import('./sources/index.js').Posting[]} postings
 * @param {{ ats: string, slug: string, today: string }} ctx   today as YYYY-MM-DD
 * @returns {{ next: object, stats: { added: number, gone: number, back: number, pruned: number } }}
 */
export function mergeSnapshot(prev, postings, { ats, slug, today }) {
  const stats = { added: 0, gone: 0, back: 0, pruned: 0 };
  const base = prev && prev.version === SNAPSHOT_VERSION && prev.jobs ? prev : null;
  const since = base?.since || today;
  const jobs = {};
  const open = new Set();

  for (const p of postings) {
    const id = String(p.id);
    open.add(id);
    const old = base?.jobs[id];
    if (!old) {
      jobs[id] = { t: p.title, f: today };
      stats.added++;
    } else {
      jobs[id] = { t: p.title, f: old.f };
      if (old.g) stats.back++; // reopened: keep the original first-seen date
    }
  }

  for (const [id, old] of Object.entries(base?.jobs || {})) {
    if (open.has(id)) continue;
    const gone = old.g || today;
    if (!old.g) stats.gone++;
    if (daysBetween(gone, today) > KEEP_GONE_DAYS) {
      stats.pruned++;
      continue;
    }
    jobs[id] = { t: old.t, f: old.f, g: gone };
  }

  return { next: { version: SNAPSHOT_VERSION, ats, slug, since, jobs }, stats };
}

/**
 * Stable, diff-friendly JSON: one job per line, ids sorted.
 * @param {object} snap
 */
export function serializeSnapshot(snap) {
  const ids = Object.keys(snap.jobs).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const lines = ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(snap.jobs[id])}`);
  return [
    '{',
    `  "version": ${snap.version},`,
    `  "ats": ${JSON.stringify(snap.ats)},`,
    `  "slug": ${JSON.stringify(snap.slug)},`,
    `  "since": ${JSON.stringify(snap.since)},`,
    `  "jobs": {${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}}`,
    '}',
    '',
  ].join('\n');
}

/**
 * Look up a posting in a first-seen file.
 * @param {object | null} snap
 * @param {string} postingId
 * @returns {{ date: string, exact: boolean } | null}
 *   exact=false when the job was already open when tracking began, so the
 *   real date is on or before `date`
 */
export function lookupFirstSeen(snap, postingId) {
  if (!snap || snap.version !== SNAPSHOT_VERSION || !snap.jobs) return null;
  const entry = snap.jobs[String(postingId)];
  if (!entry || typeof entry.f !== 'string') return null;
  return { date: entry.f, exact: entry.f !== snap.since };
}
