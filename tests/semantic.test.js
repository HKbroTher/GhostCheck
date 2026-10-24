import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoilerplate, stripBoilerplate, splitSentences, isMostlyLatin, cosine, refineMatch } from '../core/semantic.js';
import { matchPosting } from '../core/matcher.js';

/** Deterministic stand-in for the model: bag-of-words vectors. */
function fakeEmbed(texts) {
  const vocab = new Map();
  const tokens = texts.map((t) => t.toLowerCase().match(/[a-z]+/g) || []);
  for (const ts of tokens) for (const w of ts) if (!vocab.has(w)) vocab.set(w, vocab.size);
  return Promise.resolve(
    tokens.map((ts) => {
      const v = new Array(vocab.size).fill(0);
      for (const w of ts) v[vocab.get(w)]++;
      return v;
    }),
  );
}

const ABOUT = 'Acme builds payment software used by millions of businesses around the world. ';
const BENEFITS = 'We offer competitive salary, equity, health insurance and a generous parental leave policy. ';
const LEDGER =
  'You will design and build the double entry ledger service that records every money movement. ' +
  'You will own reconciliation pipelines, idempotent transfer APIs and settlement batch jobs. ' +
  'You will work closely with finance and risk to keep balances correct under heavy load. ' +
  'Experience with distributed transactions, Postgres and Kotlin services is expected. ';
const MOBILE =
  'You will build delightful iOS and Android experiences for merchants on the go. ' +
  'You will own offline sync, push notifications and the onboarding flow in our mobile apps. ' +
  'You will partner with designers to ship polished animations and accessible interfaces. ' +
  'Experience with Swift, Kotlin multiplatform and mobile release pipelines is expected. ';
const DATA =
  'You will build the analytics warehouse and the experimentation platform used by every team. ' +
  'You will own event ingestion, dbt models and the metrics layer that powers dashboards. ' +
  'You will help product teams design experiments and interpret results with statistical rigor. ' +
  'Experience with Spark, Airflow and SQL at terabyte scale is expected. ';

const P = (id, title, body) => ({ id, title, location: 'San Francisco, CA', url: `https://x/${id}`, text: ABOUT + body + BENEFITS });
const BOARD = [P('ledger', 'Software Engineer, Payments Ledger', LEDGER), P('mobile', 'Software Engineer, Mobile', MOBILE), P('data', 'Data Engineer, Analytics', DATA)];
const OPTS = { promote_min_similarity: 0.8, min_margin: 0.05, min_chars: 200 };

test('sentences and boilerplate', () => {
  assert.equal(splitSentences('Short. This sentence is long enough to count.').length, 1);
  const bp = buildBoilerplate(BOARD.map((p) => p.text));
  const stripped = stripBoilerplate(BOARD[0].text, bp);
  assert.ok(!stripped.includes('millions of businesses'));
  assert.ok(!stripped.includes('parental leave'));
  assert.ok(stripped.includes('double entry ledger'));
});

test('language and cosine helpers', () => {
  assert.ok(isMostlyLatin(LEDGER));
  assert.ok(!isMostlyLatin('我们正在寻找一位资深软件工程师，负责支付系统的设计与开发，以及账本服务。'.repeat(3)));
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test('a reworded title is promoted when the description clearly matches', async () => {
  const job = { title: 'Member of Technical Staff', location: 'San Francisco, CA', description: ABOUT + LEDGER + BENEFITS };
  const match = matchPosting(job, BOARD);
  assert.equal(match.status, 'not_found');
  const { match: refined, semantic } = await refineMatch(job, match, BOARD, fakeEmbed, OPTS);
  assert.equal(refined.status, 'found');
  assert.equal(refined.posting.id, 'ledger');
  assert.equal(refined.via, 'description');
  assert.equal(semantic.decision, 'promoted');
});

test('boilerplate alone never promotes a job', async () => {
  // Only the company intro and benefits: nothing role-specific left.
  const job = { title: 'Member of Technical Staff', location: 'San Francisco, CA', description: (ABOUT + BENEFITS).repeat(3) };
  const match = matchPosting(job, BOARD);
  const { match: refined, semantic } = await refineMatch(job, match, BOARD, fakeEmbed, OPTS);
  assert.equal(refined.status, 'not_found');
  assert.equal(semantic, null);
});

test('a different job at the same company is not promoted', async () => {
  const other =
    'You will run the security operations center and respond to incidents around the clock. ' +
    'You will own detection rules, threat hunting playbooks and forensic investigations. ' +
    'You will coordinate with legal during breach notifications and regulatory reviews. ' +
    'Experience with SIEM tooling, endpoint telemetry and malware analysis is expected. ';
  const job = { title: 'Member of Technical Staff', location: 'San Francisco, CA', description: ABOUT + other + BENEFITS };
  const { match: refined } = await refineMatch(job, matchPosting(job, BOARD), BOARD, fakeEmbed, OPTS);
  assert.notEqual(refined.status, 'found');
});

test('near-identical titles are told apart by description', async () => {
  const board = [P('a', 'Software Engineer', MOBILE), { ...P('b', 'Software Engineer', LEDGER), location: 'San Francisco, CA' }];
  const job = { title: 'Software Engineer', location: 'San Francisco, CA', description: ABOUT + LEDGER + BENEFITS };
  const match = matchPosting(job, board);
  assert.equal(match.posting.id, 'a'); // title alone picks the first
  const { match: refined } = await refineMatch(job, match, board, fakeEmbed, OPTS);
  assert.equal(refined.posting.id, 'b');
});

test('never demotes, and model failures change nothing', async () => {
  const job = { title: 'Software Engineer, Mobile', location: 'San Francisco, CA', description: ABOUT + DATA + BENEFITS };
  const match = matchPosting(job, BOARD);
  assert.equal(match.status, 'found');
  const { match: refined } = await refineMatch(job, match, BOARD, fakeEmbed, OPTS);
  assert.equal(refined.status, 'found');
  assert.equal(refined.posting.id, 'mobile');

  const failing = () => Promise.reject(new Error('model not loaded'));
  const nf = { title: 'Member of Technical Staff', location: 'San Francisco, CA', description: ABOUT + LEDGER + BENEFITS };
  const m = matchPosting(nf, BOARD);
  assert.deepEqual(await refineMatch(nf, m, BOARD, failing, OPTS), { match: m, semantic: null });
  assert.deepEqual(await refineMatch(nf, m, BOARD, async () => null, OPTS), { match: m, semantic: null });
});

test('level and location rules still apply: only rule-passing postings are candidates', async () => {
  const board = [{ ...P('ledger', 'Software Engineer, Payments Ledger', LEDGER), location: 'London, UK' }];
  const job = { title: 'Member of Technical Staff', location: 'Austin, TX', description: ABOUT + LEDGER + BENEFITS };
  const { match: refined } = await refineMatch(job, matchPosting(job, board), board, fakeEmbed, OPTS);
  assert.notEqual(refined.status, 'found');
});

test('English detection keeps other Latin-script languages away from the English model', async () => {
  const { isLikelyEnglish } = await import('../core/semantic.js');
  assert.ok(isLikelyEnglish(LEDGER + MOBILE));
  const de = 'Du entwickelst und betreibst unseren Ledger-Service, der jede Geldbewegung auf unserer Plattform erfasst. '.repeat(4);
  assert.ok(!isLikelyEnglish(de));
  const job = { title: 'Mitglied des technischen Stabs', location: 'San Francisco, CA', description: de + ABOUT };
  const { semantic } = await refineMatch(job, matchPosting(job, BOARD), BOARD, fakeEmbed, OPTS);
  assert.equal(semantic, null); // skipped, not guessed
});

test('sentence splitting: CJK punctuation splits, dots inside words do not', async () => {
  const { splitSentences, textWeight } = await import('../core/semantic.js');
  assert.deepEqual(splitSentences('We use Node.js and Python 3.5 for our backend services today. Second sentence is long enough here.'), [
    'We use Node.js and Python 3.5 for our backend services today.',
    'Second sentence is long enough here.',
  ]);
  assert.equal(splitSentences('決済基盤チームにて、APIの設計と開発を担当していただきます。当社は東京に本社を置く企業です。').length, 2);
  assert.equal(textWeight('支付平台'), 12);
});

test('multilingual model: a Japanese title is matched to an English posting via titles, then descriptions', async () => {
  // Stand-in multilingual model: a tiny shared vocabulary maps both languages to the same concepts.
  const concepts = { ledger: ['ledger', '元帳'], payments: ['payments', '決済'], mobile: ['mobile', 'モバイル'], data: ['data', 'データ'], engineer: ['engineer', 'エンジニア'], money: ['money', 'お金'], reconciliation: ['reconciliation', '照合'] };
  const embed = async (texts) =>
    texts.map((t) => Object.values(concepts).map((words) => words.reduce((n, w) => n + (t.toLowerCase().split(w).length - 1), 0)));
  const jaJd =
    '元帳 決済 お金 照合 を担当していただきます。元帳 決済 お金 照合 のシステムを開発します。'.repeat(6);
  const job = { title: '決済元帳エンジニア', location: 'San Francisco, CA', description: jaJd };
  const board = [P('ledger', 'Payments Ledger Engineer', 'ledger payments money reconciliation. '.repeat(12)), P('mobile', 'Mobile Engineer', 'mobile mobile engineer data. '.repeat(12))];
  const match = matchPosting(job, board);
  assert.equal(match.status, 'not_found');
  const { match: refined } = await refineMatch(job, match, board, embed, { ...OPTS, multilingual: true, promote_min_similarity: 0.8 });
  assert.equal(refined.status, 'found');
  assert.equal(refined.posting.id, 'ledger');
  // The English-only setting never looks at Japanese text.
  const { semantic } = await refineMatch(job, match, board, embed, { ...OPTS, multilingual: false });
  assert.equal(semantic, null);
});
