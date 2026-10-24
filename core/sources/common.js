/** Helpers shared by the source parsers. */

/** Max characters of description kept per posting (storage budget). */
export const MAX_POSTING_TEXT = 4000;

/** @param {unknown} v */
export function toIsoDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
