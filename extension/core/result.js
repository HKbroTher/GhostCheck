/**
 * Shared result model returned by the service worker to the content script.
 */

/** @typedef {'green' | 'yellow' | 'red' | 'unknown'} BadgeId */

/**
 * @typedef {object} Reason
 * @property {string} id
 * @property {string} text
 * @property {'positive' | 'negative' | 'neutral'} polarity
 */

/**
 * @typedef {object} CheckResult
 * @property {BadgeId} badge
 * @property {string} emoji
 * @property {string} label
 * @property {number | null} score
 * @property {Reason[]} reasons
 * @property {string | null} officialUrl
 * @property {string} checkedAt   ISO timestamp
 * @property {Record<string, unknown>} detected  what GhostCheck read / derived
 */

/** @type {Record<BadgeId, {emoji: string, label: string}>} */
export const BADGES = {
  green: { emoji: '🟢', label: 'Likely real' },
  yellow: { emoji: '🟡', label: 'Questionable' },
  red: { emoji: '🔴', label: 'Suspicious' },
  unknown: { emoji: '⚪', label: "Can't verify" },
};

/**
 * Build a result object.
 * @param {BadgeId} badge
 * @param {Partial<CheckResult>} [fields]
 * @returns {CheckResult}
 */
export function makeResult(badge, fields = {}) {
  const display = BADGES[badge] ?? BADGES.unknown;
  return {
    badge: BADGES[badge] ? badge : 'unknown',
    emoji: display.emoji,
    label: display.label,
    score: null,
    reasons: [],
    officialUrl: null,
    detected: {},
    ...fields,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * A "can't verify" result. Used for every failure path: failures must never
 * be presented as negative evidence.
 * @param {string} text  plain-language reason shown to the user
 * @param {Partial<CheckResult>} [fields]
 * @returns {CheckResult}
 */
export function unknownResult(text, fields = {}) {
  return makeResult('unknown', {
    ...fields,
    reasons: [{ id: 'unknown', text, polarity: 'neutral' }, ...(fields.reasons ?? [])],
  });
}
