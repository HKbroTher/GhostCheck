/**
 * Wayback Machine availability API.
 * https://archive.org/help/wayback_api.php
 *
 * Asking for the snapshot closest to 1996 returns the earliest capture of a
 * URL. A capture proves the page existed by that date; having no capture
 * proves nothing (most pages are never archived).
 */

/** @param {string} url */
export function waybackQueryUrl(url) {
  return `https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=19960101`;
}

/**
 * @param {any} json
 * @returns {string | null} ISO date of the earliest capture, or null
 */
export function parseWayback(json) {
  const closest = json?.archived_snapshots?.closest;
  if (!closest || closest.available === false) return null;
  const m = String(closest.timestamp || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Canonical public URL of a LinkedIn job, as archived pages would use. */
export function linkedinJobUrl(jobId) {
  return /^\d+$/.test(String(jobId || '')) ? `https://www.linkedin.com/jobs/view/${jobId}/` : null;
}
