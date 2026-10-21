/**
 * Normalization of job titles and locations so that LinkedIn and ATS
 * postings can be compared.
 */

/** Lowercase, strip accents, unify dashes/quotes. */
export function basicClean(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[’‘]/g, "'");
}

/** Multi-word phrases unified before tokenizing. Order matters. */
const PHRASES = [
  [/\bfront[\s-]+end\b/g, 'frontend'],
  [/\bback[\s-]+end\b/g, 'backend'],
  [/\bfull[\s-]+stack\b/g, 'fullstack'],
  [/\bdev[\s-]?ops\b/g, 'devops'],
  [/\bmachine[\s-]+learning\b/g, 'ml'],
  [/\bartificial intelligence\b/g, 'ai'],
  [/\bsite reliability\b/g, 'sre'],
  [/\bquality assurance\b/g, 'qa'],
  [/\bvice president\b/g, 'vp'],
  [/\bsoftware development engineer\b/g, 'software engineer'],
  [/\bc\+\+/g, 'cpp'],
  [/\bc#/g, 'csharp'],
  [/\.net\b/g, 'dotnet'],
  [/\bnode\.?js\b/g, 'node'],
  [/\breact\.?js\b/g, 'react'],
];

/** Single-token abbreviations expanded after tokenizing. */
const ABBREVIATIONS = {
  sr: 'senior',
  snr: 'senior',
  jr: 'junior',
  jnr: 'junior',
  eng: 'engineer',
  engr: 'engineer',
  engineering: 'engineer',
  swe: 'software engineer',
  sde: 'software engineer',
  dev: 'developer',
  mgr: 'manager',
  mngr: 'manager',
  mgmt: 'management',
  assoc: 'associate',
  asst: 'assistant',
  admin: 'administrator',
  ops: 'operations',
  dir: 'director',
  exec: 'executive',
  acct: 'account',
  rep: 'representative',
  ae: 'account executive',
  sdr: 'sales development representative',
  bdr: 'business development representative',
  pm: 'product manager',
  tpm: 'technical program manager',
  em: 'engineer manager',
  fe: 'frontend',
  be: 'backend',
  infra: 'infrastructure',
  intl: 'international',
  hr: 'human resources',
};

/**
 * Words that carry no meaning for matching: employment type, workplace,
 * gender notes required in some countries, hiring fluff.
 */
const NOISE = new Set([
  'remote', 'hybrid', 'onsite', 'on-site', 'office', 'fulltime', 'full-time', 'parttime', 'part-time',
  'contract', 'contractor', 'temporary', 'temp', 'permanent', 'freelance',
  'f', 'm', 'd', 'w', 'x', 'h', 'all', 'genders', 'gender', 'mfd', 'mwd', 'fmd', 'wmd', 'hf',
  'urgent', 'urgently', 'hiring', 'new', 'immediate', 'start', 'the', 'a', 'an', 'and', 'of', 'for',
  'to', 'in', 'at', 'with', 'job', 'role', 'position', 'opening', 'opportunity',
]);

/** Seniority words. Levels are compared exactly when both sides state one. */
const LEVEL_WORDS = {
  intern: 'intern',
  internship: 'intern',
  trainee: 'intern',
  apprentice: 'intern',
  graduate: 'junior',
  entry: 'junior',
  junior: 'junior',
  associate: 'junior',
  mid: 'mid',
  intermediate: 'mid',
  senior: 'senior',
  staff: 'staff',
  principal: 'principal',
  distinguished: 'distinguished',
  fellow: 'distinguished',
};

/** Roman/arabic level suffixes: "Engineer II", "Engineer 3". */
const LEVEL_NUMERALS = { i: 'junior', ii: 'mid', iii: 'senior', iv: 'staff', v: 'principal', 1: 'junior', 2: 'mid', 3: 'senior', 4: 'staff', 5: 'principal' };

/**
 * @param {string} title
 * @returns {{ tokens: string[], core: string[], level: string | null }}
 *   tokens: meaningful words of the whole title, level words removed
 *   core:   same, but without "(...)" and trailing " - ..." / ", ..." segments
 *   level:  normalized seniority or null when the title states none
 */
export function normalizeTitle(title) {
  const cleaned = basicClean(title);
  const coreText = cleaned
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/\s[-|–:]\s|,\s/)[0];
  const full = tokenizeTitle(cleaned);
  const core = tokenizeTitle(coreText);
  return { tokens: full.tokens, core: core.tokens, level: full.level ?? core.level };
}

function tokenizeTitle(text) {
  let s = text;
  for (const [re, rep] of PHRASES) s = s.replace(re, rep);
  // "m/f/d", "w/m/d", "h/f" gender notes
  s = s.replace(/\b[mfwdhx](?:\s*\/\s*[mfwdhx]){1,2}\b/g, ' ');
  const raw = s.split(/[^a-z0-9+#]+/).filter(Boolean);

  const tokens = [];
  let level = null;
  raw.forEach((word, i) => {
    const expanded = (ABBREVIATIONS[word] ?? word).split(' ');
    for (const w of expanded) {
      if (LEVEL_WORDS[w] && !(w === 'associate' && raw[i + 1] === 'director')) {
        level = level ?? LEVEL_WORDS[w];
        continue;
      }
      // Numerals only count as levels at the end of the title ("Engineer II").
      if (LEVEL_NUMERALS[w] && i === raw.length - 1 && i > 0) {
        level = level ?? LEVEL_NUMERALS[w];
        continue;
      }
      if (NOISE.has(w)) continue;
      tokens.push(w);
    }
  });
  return { tokens, level };
}

/**
 * Levels are compatible unless both are stated and differ.
 * @param {string | null} a
 * @param {string | null} b
 */
export function levelsCompatible(a, b) {
  return !a || !b || a === b;
}

// ---------------------------------------------------------------- locations

const US_STATES = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan',
  mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada',
  nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota',
  oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina',
  sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington',
  wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia',
};
const CA_PROVINCES = {
  ab: 'alberta', bc: 'british columbia', mb: 'manitoba', nb: 'new brunswick', nl: 'newfoundland and labrador',
  ns: 'nova scotia', on: 'ontario', pe: 'prince edward island', qc: 'quebec', sk: 'saskatchewan',
};
const STATE_NAMES = new Map([
  ...Object.entries(US_STATES).map(([code, name]) => [name, { region: code, country: 'us' }]),
  ...Object.entries(CA_PROVINCES).map(([code, name]) => [name, { region: code, country: 'ca' }]),
]);

/** Country aliases -> ISO-ish code. */
const COUNTRIES = {
  'united states': 'us', 'united states of america': 'us', usa: 'us', us: 'us', 'u.s.': 'us', 'u.s.a.': 'us', america: 'us',
  'united kingdom': 'gb', uk: 'gb', 'great britain': 'gb', england: 'gb', scotland: 'gb', wales: 'gb',
  canada: 'ca', germany: 'de', deutschland: 'de', france: 'fr', spain: 'es', italy: 'it', netherlands: 'nl',
  ireland: 'ie', portugal: 'pt', poland: 'pl', sweden: 'se', norway: 'no', denmark: 'dk', finland: 'fi',
  switzerland: 'ch', austria: 'at', belgium: 'be', india: 'in', singapore: 'sg', japan: 'jp', china: 'cn',
  'hong kong': 'hk', 'hong kong sar': 'hk', taiwan: 'tw', korea: 'kr', 'south korea': 'kr', australia: 'au',
  'new zealand': 'nz', brazil: 'br', mexico: 'mx', argentina: 'ar', colombia: 'co', chile: 'cl', israel: 'il',
  'united arab emirates': 'ae', uae: 'ae', philippines: 'ph', indonesia: 'id', vietnam: 'vn', thailand: 'th',
  malaysia: 'my', 'south africa': 'za', nigeria: 'ng', kenya: 'ke', egypt: 'eg', turkey: 'tr', romania: 'ro',
  'czech republic': 'cz', czechia: 'cz', hungary: 'hu', ukraine: 'ua', greece: 'gr', estonia: 'ee',
  lithuania: 'lt', latvia: 'lv', serbia: 'rs', bulgaria: 'bg', croatia: 'hr', luxembourg: 'lu',
  emea: 'emea', europe: 'emea', eu: 'emea', apac: 'apac', latam: 'latam', 'north america': 'na', americas: 'na',
};

/** City aliases -> canonical city name. */
const CITY_ALIASES = {
  sf: 'san francisco', 'san francisco bay area': 'san francisco', 'bay area': 'san francisco', 'sf bay area': 'san francisco',
  nyc: 'new york', 'new york city': 'new york', 'new york city metropolitan area': 'new york', manhattan: 'new york',
  brooklyn: 'new york', la: 'los angeles', 'washington dc': 'washington', 'washington d.c.': 'washington',
  'dc-baltimore area': 'washington', bengaluru: 'bangalore', 'greater london': 'london', 'city of london': 'london',
  munchen: 'munich', 'munich': 'munich', koln: 'cologne', 'tel aviv-yafo': 'tel aviv', 'sao paulo': 'sao paulo',
};

/**
 * @typedef {object} ParsedLocation
 * @property {boolean} remote
 * @property {Set<string>} cities
 * @property {Set<string>} regions    US state / CA province codes
 * @property {Set<string>} countries
 */

function cleanCity(s) {
  let c = s
    .replace(/^greater\s+/, '')
    .replace(/\s+(metropolitan|metro)\s+area$/, '')
    .replace(/\s+(bay\s+)?area$/, (m) => (/bay/.test(m) ? ' bay area' : ''))
    .trim();
  c = CITY_ALIASES[c] ?? c;
  return c;
}

/**
 * Parse free-text locations such as "San Francisco, CA", "Remote - US",
 * "New York, NY; London, UK", "Greater Boston" or "SF / NYC / Remote".
 * @param {string} text
 * @returns {ParsedLocation}
 */
export function parseLocation(text) {
  const loc = { remote: false, cities: new Set(), regions: new Set(), countries: new Set() };
  let s = basicClean(text);
  if (!s.trim()) return loc;

  if (/\b(remote|anywhere|distributed|work from home|wfh)\b/.test(s)) loc.remote = true;
  s = s
    .replace(/\b(remote|anywhere|distributed|work from home|wfh|hybrid|on-?site|in-office|office)\b/g, ' ')
    .replace(/\(\s*\)/g, ' ');

  for (const segment of s.split(/;|\||\/|\bor\b|&|\n|\(|\)/)) {
    const parts = segment.split(/,|\s-\s|\s–\s/).map((p) => p.replace(/[^a-z .'-]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    parts.forEach((part, i) => {
      const p = part.replace(/^-+|-+$/g, '').trim();
      if (!p) return;
      if (COUNTRIES[p]) return loc.countries.add(COUNTRIES[p]);
      if (STATE_NAMES.has(p)) {
        const st = STATE_NAMES.get(p);
        loc.regions.add(st.region);
        return loc.countries.add(st.country);
      }
      // Two-letter codes are states/provinces only after a city ("Austin, TX").
      if (i > 0 && p.length === 2 && (US_STATES[p] || CA_PROVINCES[p])) {
        loc.regions.add(p);
        return loc.countries.add(US_STATES[p] ? 'us' : 'ca');
      }
      if (i === 0 || !loc.cities.size) {
        const city = cleanCity(p);
        if (city.length > 1) loc.cities.add(city);
      }
    });
  }
  return loc;
}

function intersects(a, b) {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/** Cities match exactly or as a word prefix ("dallas" ~ "dallas-fort worth metroplex"). */
function citiesIntersect(a, b) {
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      const [short, long] = x.length < y.length ? [x, y] : [y, x];
      if (long.startsWith(short) && /[\s-]/.test(long[short.length])) return true;
    }
  }
  return false;
}

/**
 * Whether two locations could describe the same job. Lenient by design:
 * unknown or broader locations are compatible; only clearly different
 * places (different cities, different countries) are not.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function locationsCompatible(a, b) {
  const x = parseLocation(a);
  const y = parseLocation(b);
  const empty = (l) => !l.remote && !l.cities.size && !l.regions.size && !l.countries.size;
  if (empty(x) || empty(y)) return true;

  const countriesKnown = x.countries.size && y.countries.size;
  if (countriesKnown && !intersects(x.countries, y.countries)) {
    // Regional buckets like "EMEA" are too vague to rule anything out.
    const vague = (l) => [...l.countries].some((c) => ['emea', 'apac', 'latam', 'na'].includes(c));
    if (!vague(x) && !vague(y)) return false;
  }
  if (citiesIntersect(x.cities, y.cities)) return true;
  if (x.remote || y.remote) return true;
  if (x.cities.size && y.cities.size) return false;
  if (x.regions.size && y.regions.size) return intersects(x.regions, y.regions);
  return true;
}
