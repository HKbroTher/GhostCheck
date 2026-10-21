/**
 * Load, validate and evaluate rules.yaml.
 */
import { load as parseYaml } from './vendor/js-yaml.mjs';

/**
 * @typedef {object} SignalRule
 * @property {string} id
 * @property {'positive' | 'negative'} type
 * @property {number} weight   always >= 0; `type` decides the sign
 * @property {string} reason
 *
 * @typedef {object} Rules
 * @property {{ green: { min_score: number }, red: { max_score: number } }} badges
 * @property {string[]} require_any_known
 * @property {number} max_reasons
 * @property {{ title_match: number, title_similar: number }} matching
 * @property {{ recent_days: number, old_days: number }} age
 * @property {SignalRule[]} signals
 */

/**
 * Parse and validate rules.yaml. Throws with a readable message on bad input
 * so contributors see what is wrong in CI.
 * @param {string} yamlText
 * @returns {Rules}
 */
export function parseRules(yamlText) {
  const raw = parseYaml(yamlText);
  const fail = (msg) => {
    throw new Error(`rules.yaml: ${msg}`);
  };
  if (!raw || typeof raw !== 'object') fail('not a mapping');
  const num = (v, name) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${name} must be a number`));

  const signals = Array.isArray(raw.signals) ? raw.signals : fail('signals must be a list');
  const seen = new Set();
  for (const s of signals) {
    if (!s || typeof s.id !== 'string' || !/^[a-z0-9_]+$/.test(s.id)) fail(`invalid signal id: ${JSON.stringify(s?.id)}`);
    if (seen.has(s.id)) fail(`duplicate signal id: ${s.id}`);
    seen.add(s.id);
    if (s.type !== 'positive' && s.type !== 'negative') fail(`${s.id}.type must be positive or negative`);
    if (num(s.weight, `${s.id}.weight`) < 0) fail(`${s.id}.weight must be >= 0 (use type for the sign)`);
    if (typeof s.reason !== 'string' || !s.reason.trim()) fail(`${s.id}.reason must be a non-empty string`);
  }

  const rules = {
    badges: {
      green: { min_score: num(raw.badges?.green?.min_score, 'badges.green.min_score') },
      red: { max_score: num(raw.badges?.red?.max_score, 'badges.red.max_score') },
    },
    require_any_known: Array.isArray(raw.require_any_known) ? raw.require_any_known.map(String) : [],
    max_reasons: num(raw.max_reasons ?? 5, 'max_reasons'),
    matching: {
      title_match: num(raw.matching?.title_match ?? 0.8, 'matching.title_match'),
      title_similar: num(raw.matching?.title_similar ?? 0.6, 'matching.title_similar'),
    },
    age: {
      recent_days: num(raw.age?.recent_days ?? 30, 'age.recent_days'),
      old_days: num(raw.age?.old_days ?? 90, 'age.old_days'),
    },
    signals,
  };
  if (rules.badges.red.max_score >= rules.badges.green.min_score) fail('badges.red.max_score must be below badges.green.min_score');
  for (const id of rules.require_any_known) if (!seen.has(id)) fail(`require_any_known lists unknown signal: ${id}`);
  return rules;
}

/** Replace {name} placeholders; unknown placeholders and their brackets are dropped. */
export function fillTemplate(text, vars) {
  return text
    .replace(/\s*\(\s*\{(\w+)\}\s*\)/g, (m, k) => (vars[k] ? ` (${vars[k]})` : ''))
    .replace(/"\{(\w+)\}"/g, (m, k) => (vars[k] ? `"${vars[k]}"` : ''))
    .replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''))
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

/**
 * @param {Rules} rules
 * @param {Record<string, boolean | null | undefined>} signals  true / false / null (unknown)
 * @param {object} [opts]
 * @param {Record<string, unknown>} [opts.vars]       template values
 * @param {string[]} [opts.notes]                      neutral context lines
 * @param {string | null} [opts.unknownReason]         why we cannot verify (shown first when ⚪)
 * @returns {{ badge: 'green' | 'yellow' | 'red' | 'unknown', score: number | null,
 *             reasons: import('./result.js').Reason[] }}
 */
export function evaluate(rules, signals, { vars = {}, notes = [], unknownReason = null } = {}) {
  const known = (id) => signals[id] === true || signals[id] === false;
  const verifiable = rules.require_any_known.length === 0 || rules.require_any_known.some(known);

  let score = 0;
  const hits = [];
  for (const rule of rules.signals) {
    if (signals[rule.id] !== true) continue;
    const delta = rule.type === 'negative' ? -rule.weight : rule.weight;
    score += delta;
    hits.push({ rule, delta });
  }
  hits.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const signalReasons = hits.map(({ rule }) => ({
    id: rule.id,
    polarity: rule.type,
    text: fillTemplate(rule.reason, vars),
  }));
  const noteReasons = notes.filter(Boolean).map((text, i) => ({ id: `note_${i}`, polarity: 'neutral', text }));

  if (!verifiable) {
    const first = unknownReason ? [{ id: 'unknown', polarity: 'neutral', text: unknownReason }] : [];
    return {
      badge: 'unknown',
      score: null,
      reasons: [...first, ...noteReasons, ...signalReasons].slice(0, rules.max_reasons),
    };
  }

  let badge = 'yellow';
  if (score >= rules.badges.green.min_score) badge = 'green';
  else if (score <= rules.badges.red.max_score) badge = 'red';
  return { badge, score, reasons: [...signalReasons, ...noteReasons].slice(0, rules.max_reasons) };
}

/** Signal ids defined in the rules (used to catch typos in code and tests). */
export function signalIds(rules) {
  return new Set(rules.signals.map((s) => s.id));
}
