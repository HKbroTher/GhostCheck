import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MESSAGES, LANGUAGES, t, resolveLanguage, pageStrings } from '../core/i18n.js';
import { parseRules, evaluate, fillTemplate } from '../core/rules.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every language has every key with the same placeholders', () => {
  const keys = Object.keys(MESSAGES.en);
  for (const lang of Object.keys(LANGUAGES)) {
    const table = MESSAGES[lang];
    assert.deepEqual(Object.keys(table).sort(), [...keys].sort(), `${lang} keys differ from en`);
    for (const k of keys) {
      assert.ok(table[k].trim(), `${lang}.${k} is empty`);
      assert.deepEqual(placeholders(table[k]), placeholders(MESSAGES.en[k]), `${lang}.${k} placeholders differ`);
    }
  }
});

test('rules.yaml reasons exist in every language with the same placeholders', () => {
  const rules = parseRules(readFileSync(new URL('../rules.yaml', import.meta.url), 'utf8'));
  for (const s of rules.signals) {
    for (const lang of Object.keys(LANGUAGES)) {
      assert.ok(s.reason[lang], `${s.id} has no ${lang} reason`);
      assert.deepEqual(placeholders(s.reason[lang]), placeholders(s.reason.en), `${s.id}.${lang} placeholders differ`);
    }
  }
  const zh = evaluate(rules, { found_on_official_site: true }, { vars: { company: 'Acme' }, lang: 'zh' });
  assert.equal(zh.reasons[0].text, '该职位在Acme的官网招聘页上能找到。');
});

test('translation helpers', () => {
  assert.equal(t('zh', 'badge.green'), '可信');
  assert.equal(t('fr', 'badge.green'), 'Likely real'); // unknown language -> English
  assert.equal(t('en', 'no.such.key'), 'no.such.key');
  assert.equal(t('en', 'ui.allowSite', { host: 'a.com' }), 'Allow checking a.com');
  assert.equal(resolveLanguage('auto', 'zh-CN'), 'zh');
  assert.equal(resolveLanguage('auto', 'ja'), 'en');
  assert.equal(resolveLanguage('en', 'zh-TW'), 'en');
  assert.equal(resolveLanguage(undefined, 'zh-TW'), 'zh');
  assert.ok(Object.keys(pageStrings('zh')).every((k) => /^(badge|ui|field|error)\./.test(k)));
});

test('Chinese templates drop empty placeholders cleanly', () => {
  assert.equal(fillTemplate('职位写明了薪资范围（{salary}）。', {}), '职位写明了薪资范围。');
  assert.equal(fillTemplate('像是人才储备岗位（「{phrase}」）。', {}), '像是人才储备岗位。');
  assert.equal(fillTemplate('像是人才储备岗位（「{phrase}」）。', { phrase: '人才库' }), '像是人才储备岗位（「人才库」）。');
});
