import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, compareLanguages } from '../core/language.js';

const EN = 'We are looking for a Senior Software Engineer to join our Payments team. You will work with product managers and design the systems that move money for our customers. What you will do: build services, review code and mentor engineers.';
const DE = 'Wir suchen einen Softwareentwickler (m/w/d) für unser Team in Berlin. Du arbeitest mit Produktmanagern zusammen und entwickelst die Systeme, die für unsere Kunden Geld bewegen. Das bringst du mit: Erfahrung mit Java und eine strukturierte Arbeitsweise.';
const FR = 'Nous recherchons un Ingénieur logiciel pour rejoindre notre équipe à Paris. Vous travaillerez avec les chefs de produit et concevrez les systèmes qui déplacent l’argent pour nos clients. Votre profil : une expérience avec Java et le sens du travail en équipe.';
const ES = 'Buscamos un Ingeniero de software para unirse a nuestro equipo en Madrid. Trabajarás con los gerentes de producto y diseñarás los sistemas que mueven el dinero de nuestros clientes. Tu perfil: experiencia con Java y trabajo en equipo.';

test('languages that share the Latin alphabet are told apart', () => {
  assert.equal(detectLanguage(EN), 'en');
  assert.equal(detectLanguage(DE), 'de');
  assert.equal(detectLanguage(FR), 'fr');
  assert.equal(detectLanguage(ES), 'es');
  assert.equal(detectLanguage('ソフトウェアエンジニア（決済）東京オフィスで決済システムの開発を担当'), 'ja');
  assert.equal(detectLanguage('高级软件工程师（支付）负责支付系统的设计与开发'), 'zh');
  assert.equal(detectLanguage('소프트웨어 엔지니어 결제 시스템 개발'), 'ko');
});

test('short titles: only telltale words decide, otherwise unknown', () => {
  assert.equal(detectLanguage('Softwareentwickler (m/w/d)'), 'de');
  assert.equal(detectLanguage('Ingénieur logiciel (H/F)'), 'fr');
  assert.equal(detectLanguage('Software Engineer'), null);
  assert.equal(detectLanguage('Data Analyst'), null);
});

test('an English job against a German board is a language difference', () => {
  const board = [1, 2, 3, 4].map((i) => ({ title: `Softwareentwickler ${i} (m/w/d)`, text: DE }));
  const r = compareLanguages({ title: 'Software Engineer', description: EN }, board);
  assert.deepEqual(r, { jobLang: 'en', boardLang: 'de', different: true });
  const same = compareLanguages({ title: 'Software Engineer', description: EN }, board.map((p) => ({ ...p, text: EN, title: 'Engineer' })));
  assert.equal(same.different, false);
  // Unknown job language: can't tell.
  assert.equal(compareLanguages({ title: 'Software Engineer', description: '' }, board).different, null);
});
