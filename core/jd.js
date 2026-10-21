/**
 * Signals read from the job description text. Each detector returns
 * { value: true | false | null, detail?: string } where null means
 * "not enough text to say".
 */

const MIN_TEXT_CHARS = 300;
/** Chinese/Japanese say the same in far fewer characters. */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
function enoughText(text) {
  if (!text) return false;
  const cjk = (text.match(CJK_RE) || []).length;
  return text.length + cjk * 2 >= MIN_TEXT_CHARS;
}

const CURRENCY = String.raw`(?:[$€£¥₹￥]|\b(?:USD|EUR|GBP|CAD|AUD|SGD|CHF|INR|NZD|JPY|CNY|RMB|HKD|TWD|KRW)\b)`;
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
  // 5M JPY/yr - 10.5M JPY/yr (amount before currency, as LinkedIn shows it)
  new RegExp(
    String.raw`\d[\d,.]*\s?[kKmM]?\s?${CURRENCY}(?:\s?\/\s?(?:yr|year|mo|month|hr|hour))?\s*(?:-|–|—|to|〜|～)\s*\d[\d,.]*\s?[kKmM]?(?:\s?${CURRENCY})?(?:\s?\/\s?(?:yr|year|mo|month|hr|hour))?`,
    'i',
  ),
  // 年収600万円〜900万円, 月給30万円～, 年薪30-50万, 月薪15k-25k
  /(?:年収|年俸|月給|月収|給与|給料|想定年収|年薪|月薪|薪资|薪酬|待遇)[^\n。]{0,15}?\d[\d,.]*\s*(?:万|萬|千|k|K)?\s*(?:円|元|人民币)?\s*(?:〜|～|~|-|–|—|至|から)\s*\d[\d,.]*\s*(?:万|萬|千|k|K)?\s*(?:円|元)?/,
  // 600万円〜900万円 without a label
  /\d[\d,.]*\s*万円?\s*(?:〜|～|~|-|–|至)\s*\d[\d,.]*\s*万円/,
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

/** 「決済基盤チーム」, 「支付平台团队」: a name before the word for team/department. */
const CJK_TEAM_RE = /([\p{L}\p{N}ー・&]{2,20}?)(?:チーム|部門|グループ|事業部|团队|團隊|部门|部門|小组|事业部)/gu;
const GENERIC_CJK_TEAM = /^(当社|弊社|私たち|我々|全社|各|同|この|その|開発|我们|我們|公司|整个|优秀|專業|专业|年轻|各个|本|该|的)$|的$|の$/u;

/** Does the description name a concrete team or project? */
export function detectSpecificTeam(text) {
  if (!enoughText(text)) return { value: null };
  CJK_TEAM_RE.lastIndex = 0;
  let c;
  while ((c = CJK_TEAM_RE.exec(text))) {
    // Keep only the name: drop what comes before the last verb or particle
    // ("你将加入支付平台团队" -> "支付平台", "当社の決済チーム" -> "決済").
    const name = c[1].replace(/^.*(?:加入|进入|進入|参与|參與|负责|負責|的|在|于|於|将|將|到|与|與|和|は|が|を|に|で|と|の|へ)/u, '');
    if (name.length >= 2 && !GENERIC_CJK_TEAM.test(name)) return { value: true, detail: name };
  }
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
  // Japanese
  'タレントプール', '将来のポジション', '将来的なポジション', 'オープンポジション', '人材登録', 'キャリア登録',
  // Chinese
  '人才储备', '人才儲備', '储备人才', '儲備人才', '人才库', '人才庫', '储备岗位', '常年招聘', '长期招聘', '多个岗位', '未来机会',
];

/** Does the description read like a generic template or pipeline posting? */
export function detectGenericTemplate(text) {
  if (!enoughText(text)) return { value: null };
  const lower = text.toLowerCase();
  const phrase = TEMPLATE_PHRASES.find((p) => lower.includes(p));
  return phrase ? { value: true, detail: phrase } : { value: false };
}
