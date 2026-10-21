/**
 * Combine evidence about when a job was first posted.
 *
 * Two kinds of evidence:
 *   exact       the date the job appeared (ATS publish date, or a GhostCheck
 *               snapshot that saw it appear after tracking began)
 *   lower bound the job existed on that date, maybe earlier (snapshot of a
 *               job already open when tracking began, Wayback capture)
 *
 * The age is taken from the OLDEST date: any proof that the job existed
 * earlier wins. "Recent" additionally needs exact evidence, because a lower
 * bound cannot show that a job is new.
 */

const DAY_MS = 86400000;

/**
 * @typedef {object} AgeEvidence
 * @property {string} date      ISO date
 * @property {boolean} exact
 * @property {'ats' | 'snapshot' | 'wayback'} source
 */

export const AGE_SOURCE_LABELS = {
  ats: "the company's careers site",
  snapshot: "GhostCheck's daily snapshots",
  wayback: 'the Wayback Machine',
};

/**
 * @param {AgeEvidence[]} evidence
 * @param {Date} now
 * @returns {{ days: number, oldest: AgeEvidence, hasExact: boolean, atsDays: number | null } | null}
 */
export function combineAge(evidence, now) {
  const valid = evidence.filter((e) => e && e.date && !Number.isNaN(Date.parse(e.date)));
  if (!valid.length) return null;
  const daysOf = (e) => Math.max(0, Math.floor((now.getTime() - Date.parse(e.date)) / DAY_MS));
  const oldest = valid.reduce((a, b) => (Date.parse(b.date) < Date.parse(a.date) ? b : a));
  const ats = valid.find((e) => e.source === 'ats');
  return {
    days: daysOf(oldest),
    oldest,
    hasExact: valid.some((e) => e.exact),
    atsDays: ats ? daysOf(ats) : null,
  };
}

/**
 * Age signals for rules.yaml.
 * @param {ReturnType<typeof combineAge>} age
 * @param {{ recent_days: number, old_days: number }} thresholds
 * @returns {{ posted_recently: boolean | null, posted_long_ago: boolean | null, refreshed: boolean }}
 */
export function ageSignals(age, { recent_days, old_days }) {
  if (!age) return { posted_recently: null, posted_long_ago: null, refreshed: false };
  const old = age.days > old_days;
  // A lower bound alone cannot show that a job is new.
  const recent = age.hasExact ? age.days <= recent_days : old ? false : null;
  // Careers site shows a much newer date than the oldest evidence: the
  // posting was probably re-published to look fresh.
  const refreshed = age.atsDays !== null && age.oldest.source !== 'ats' && age.days - age.atsDays > recent_days;
  return {
    posted_recently: recent,
    // Between the thresholds both are false; without enough evidence for
    // either side, a lower bound under old_days says nothing.
    posted_long_ago: old ? true : age.hasExact ? false : null,
    refreshed,
  };
}
