/**
 * Signals read from the job description text. Each detector returns
 * { value: true | false | null, detail?: string } where null means
 * "not enough text to say".
 */

const MIN_TEXT_CHARS = 300;

const CURRENCY = String.raw`(?:[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD|SGD|CHF|INR|NZD)\b)`;
const AMOUNT = String.raw`\d[\d,.]*\s?[kKmM]?(?:\s?\/\s?(?:yr|year|hr|hour|mo|month))?`;
const SALARY_PATTERNS = [
  // $120,000 - $150,000 / USD 120k to 150k / €60.000–€75.000
  new RegExp(String.raw`${CURRENCY}\s?${AMOUNT}\s*(?:-|–|—|to)\s*${CURRENCY}?\s?${AMOUNT}`, 'i'),
  // 120,000 - 150,000 USD
  new RegExp(String.raw`\d[\d,.]{2,}\s?[kK]?\s*(?:-|–|—|to)\s*\d[\d,.]{2,}\s?[kK]?\s*${CURRENCY}`, 'i'),
  // salary / pay range: 120,000 - 150,000
  /\b(?:salary|compensation|pay|base)\b[^.\n]{0,60}?\d[\d,.]{2,}\s?[kK]?\s*(?:-|–|—|to)\s*\d[\d,.]*\s?[kK]?/i,
  // $25/hr, $30 per hour
  new RegExp(String.raw`${CURRENCY}\s?\d+(?:\.\d+)?\s?(?:/|per)\s?(?:hr|hour)\b`, 'i'),
];

/**
 * @param {string} text           job description
 * @param {...(string | null | undefined)} extra  other places pay may appear
 */
export function detectSalary(text, ...extra) {
  for (const s of [...extra, text]) {
    if (!s) continue;
    for (const re of SALARY_PATTERNS) {
      const m = String(s).match(re);
      if (m) return { value: true, detail: m[0].trim() };
    }
  }
  if (extra.some((s) => s && /\d/.test(s) && new RegExp(CURRENCY, 'i').test(s))) return { value: true, detail: null };
  return { value: false };
}

/** Words that look like team names but say nothing specific. */
const GENERIC_TEAM_WORDS = new Set([
  'our', 'the', 'a', 'great', 'amazing', 'awesome', 'growing', 'dynamic', 'global', 'talented', 'world-class',
  'talent', 'recruiting', 'people', 'hr', 'hiring', 'leadership', 'wider', 'whole', 'entire', 'core',
]);

const TEAM_RE =
  /\b(?:join|joining|on|onto|part of|within|in|lead|leading|for)\s+(?:our|the)\s+((?:[A-Z][\w&+.\-/]*\s+){1,4})(?:team|squad|group|org|organization|tribe)\b/g;
const PROJECT_RE =
  /\b(?:work on|working on|build|building|own|owning)\s+(?:our|the)\s+((?:[A-Z][\w&+.\-]*\s+){1,3})(?:platform|product|project|service|engine|app|api)\b/g;

/** Does the description name a concrete team or project? */
export function detectSpecificTeam(text) {
  if (!text || text.length < MIN_TEXT_CHARS) return { value: null };
  for (const re of [TEAM_RE, PROJECT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1].trim();
      const words = name.toLowerCase().split(/\s+/);
      if (words.every((w) => GENERIC_TEAM_WORDS.has(w))) continue;
      return { value: true, detail: name };
    }
  }
  return { value: false };
}

/**
 * Phrases typical of pipeline / evergreen / template postings: the company is
 * collecting resumes rather than filling a specific opening.
 */
const TEMPLATE_PHRASES = [
  'talent pool', 'talent community', 'talent pipeline', 'pipeline of candidates', 'building a pipeline',
  'pipeline requisition', 'evergreen', 'future opportunities', 'future openings', 'future roles',
  'future consideration', 'upcoming opportunities', 'anticipated openings', 'general application',
  'general interest', 'not a current opening', 'no current opening', 'not an active opening',
  'various positions', 'various roles', 'multiple positions across', 'always looking for talented',
  'always on the lookout', 'may not be immediately available',
];

/** Does the description read like a generic template or pipeline posting? */
export function detectGenericTemplate(text) {
  if (!text || text.length < MIN_TEXT_CHARS) return { value: null };
  const lower = text.toLowerCase();
  const phrase = TEMPLATE_PHRASES.find((p) => lower.includes(p));
  return phrase ? { value: true, detail: phrase } : { value: false };
}
