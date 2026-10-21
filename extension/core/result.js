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
 * @property {{ step: string, kind: string, status: number | null, message: string }[]} [errors]
 *   failed requests behind a ⚪, logged to the page console for bug reports
 */

import { t } from './i18n.js';

/** @type {Record<BadgeId, string>} */
export const BADGE_EMOJI = { green: '🟢', yellow: '🟡', red: '🔴', unknown: '⚪' };

/**
 * Build a result object.
 * @param {BadgeId} badge
 * @param {'en' | 'zh'} [lang]
 * @param {Partial<CheckResult>} [fields]
 * @returns {CheckResult}
 */
export function makeResult(badge, lang = 'en', fields = {}) {
  const id = BADGE_EMOJI[badge] ? badge : 'unknown';
  return {
    badge: id,
    emoji: BADGE_EMOJI[id],
    label: t(lang, `badge.${id}`),
    lang,
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
 * @param {'en' | 'zh'} [lang]
 * @param {Partial<CheckResult>} [fields]
 * @returns {CheckResult}
 */
export function unknownResult(text, lang = 'en', fields = {}) {
  return makeResult('unknown', lang, {
    ...fields,
    reasons: [{ id: 'unknown', text, polarity: 'neutral' }, ...(fields.reasons ?? [])],
  });
}
