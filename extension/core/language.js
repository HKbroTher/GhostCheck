/**
 * Which language a job is written in. Scripts tell Japanese, Chinese and
 * Korean apart; common function words tell the Latin-script languages apart
 * (English vs German vs French, which share an alphabet). Short texts with
 * no clear answer return null: callers then fall back to comparing scripts.
 *
 * @typedef {'en' | 'de' | 'fr' | 'es' | 'pt' | 'it' | 'nl' | 'ja' | 'zh' | 'ko'} LangCode
 */

/** Frequent words, each listed for one language only, so overlaps (de, en, una, con) don't blur the counts. */
const STOPWORDS = {
  en: 'the and you our with will for are this that your who have from team about what work',
  de: 'und der die das mit für wir sie ist ein eine bei auf zu den von im unser unsere oder',
  fr: 'et les des vous nous pour avec dans est sur votre aux du notre ce au sont une',
  es: 'y los las del para por el nuestro nuestra es como al su tus somos',
  pt: 'os das dos para com em o nossa nosso você é na no ao seu sua',
  it: 'il gli della delle per nel nella sono che di un nostro nostra siamo',
  nl: 'het een van voor met wij jij je op bij ons onze naar als zijn',
};
const WORDS = Object.fromEntries(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

/** Title words that give the language away even in a short title. */
const TITLE_HINTS = [
  ['de', /\((?:m\/w\/d|w\/m\/d|m\/f\/d|all genders)\)|\b(?:entwickler\w*|ingenieur(?:in)?|mitarbeiter\w*|leiter\w*|sachbearbeiter\w*|berater\w*|werkstudent\w*|kaufm[aä]nn\w*)\b/i],
  ['fr', /\((?:h\/f|f\/h)\)|\b(?:ingénieur\w*|développeur\w*|responsable|chef de projet|chargée? de|stagiaire|alternance|technicien\w*)\b/i],
  ['es', /\b(?:ingenier[oa]|desarrollador\w*|gerente|jefe de|analista|becari[oa]|técnic[oa])\b/i],
  ['pt', /\b(?:engenheir[oa]|desenvolvedor\w*|estagiári[oa]|analista|gerente de)\b/i],
  ['it', /\b(?:sviluppatore|ingegnere|tirocinio|responsabile)\b/i],
  ['nl', /\b(?:medewerker|ontwikkelaar|stagiair|adviseur)\b/i],
];

/**
 * @param {string} text   title, or title + description
 * @returns {LangCode | null}
 */
export function detectLanguage(text) {
  const s = String(text || '');
  const letters = s.match(/\p{L}/gu) || [];
  if (!letters.length) return null;
  const count = (re) => letters.filter((c) => re.test(c)).length / letters.length;
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/u);
  const hangul = count(/\p{Script=Hangul}/u);
  const han = count(/\p{Script=Han}/u);
  if (kana >= 0.05 && kana + han >= 0.3) return 'ja';
  if (hangul >= 0.3) return 'ko';
  if (han >= 0.3) return 'zh';
  if (count(/\p{Script=Latin}/u) < 0.7) return null;

  const words = s.toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length >= 25) {
    const scores = Object.entries(WORDS)
      .map(([lang, set]) => [lang, words.filter((w) => set.has(w)).length])
      .sort((a, b) => b[1] - a[1]);
    const [[best, top], [, second]] = scores;
    if (top >= 5 && top / words.length >= 0.06 && top >= second * 1.5) return /** @type {LangCode} */ (best);
  }
  for (const [lang, re] of TITLE_HINTS) if (re.test(s)) return /** @type {LangCode} */ (lang);
  return null;
}

const MAX_SAMPLE = 200;
const SAMPLE_TEXT = 1500;

/** Language of one posting from its title and the start of its description. */
export function postingLanguage(posting) {
  return detectLanguage(`${posting.title || ''}\n${String(posting.text || '').slice(0, SAMPLE_TEXT)}`);
}

/**
 * Is the board written in another language than the LinkedIn job?
 * @param {{ title: string, description?: string }} job
 * @param {Array<{ title: string, text?: string }>} postings
 * @returns {{ jobLang: LangCode | null, boardLang: LangCode | null, different: boolean | null }}
 *   different: null when it can't be told (the caller falls back to scripts)
 */
export function compareLanguages(job, postings) {
  const jobLang = detectLanguage(`${job.title || ''}\n${String(job.description || '').slice(0, 4000)}`);
  const counts = new Map();
  let detected = 0;
  for (const p of postings.slice(0, MAX_SAMPLE)) {
    const lang = postingLanguage(p);
    if (!lang) continue;
    detected++;
    counts.set(lang, (counts.get(lang) || 0) + 1);
  }
  const boardLang = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // Too few readable postings, or an unknown job language: can't tell.
  if (!jobLang || detected < Math.min(3, postings.length)) return { jobLang, boardLang, different: null };
  // "Not found" is meaningful only when nearly every posting is in the job's language.
  return { jobLang, boardLang, different: (counts.get(jobLang) || 0) / detected < 0.8 };
}
