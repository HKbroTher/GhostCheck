// GhostCheck options: language, description model, allowed careers sites.
import { resolveLanguage, t } from '../core/i18n.js';

const MODEL_CACHE = 'transformers-cache'; // Transformers.js browser cache name
const MODEL_NAMES = { 'all-MiniLM-L6-v2': 'English', 'paraphrase-multilingual-MiniLM-L12-v2': 'Multilingual' };
const $ = (id) => document.getElementById(id);
let lang = 'en';
const say = (key, vars) => {
  $('status').textContent = t(lang, key, vars);
};

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || {};
}
async function saveSettings(patch) {
  await chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
}

function applyLanguage() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(lang, el.dataset.i18n);
}

async function refreshModelStatus() {
  try {
    const cache = (await caches.has(MODEL_CACHE)) ? await caches.open(MODEL_CACHE) : null;
    const urls = cache ? (await cache.keys()).map((r) => r.url) : [];
    const models = Object.entries(MODEL_NAMES)
      .filter(([id]) => urls.some((u) => u.includes(`/${id}/`)))
      .map(([, name]) => name);
    $('model-status').textContent = t(lang, 'options.modelStatus', { status: models.join(', ') || t(lang, 'options.modelNone') });
  } catch {
    $('model-status').textContent = t(lang, 'options.modelStatus', { status: t(lang, 'options.modelUnknown') });
  }
}

async function refreshOrigins() {
  const list = $('origins');
  list.textContent = '';
  // Only sites the user allowed: not the extension's own hosts, and not
  // LinkedIn itself (granted through content_scripts; removing it would
  // switch GhostCheck off).
  const manifest = chrome.runtime.getManifest();
  const required = new Set([...manifest.host_permissions, ...manifest.content_scripts.flatMap((c) => c.matches)]);
  const { origins = [] } = await chrome.permissions.getAll();
  const optional = origins.filter((o) => !required.has(o) && o !== 'https://*/*');
  if (!optional.length) {
    const li = document.createElement('li');
    li.textContent = t(lang, 'options.sitesNone');
    list.append(li);
    return;
  }
  for (const origin of optional) {
    const li = document.createElement('li');
    const name = document.createElement('code');
    name.textContent = origin.replace(/\/\*$/, '');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = t(lang, 'options.remove');
    remove.addEventListener('click', async () => {
      await chrome.permissions.remove({ origins: [origin] });
      say('options.removed', { site: name.textContent });
      refreshOrigins();
    });
    li.append(name, remove);
    list.append(li);
  }
}

function render() {
  applyLanguage();
  refreshModelStatus();
  refreshOrigins();
}

$('language').addEventListener('change', async (e) => {
  await saveSettings({ language: e.target.value });
  lang = resolveLanguage(e.target.value, chrome.i18n.getUILanguage());
  render();
  say('options.languageChanged');
});

$('semantic').addEventListener('change', async (e) => {
  await saveSettings({ semantic: e.target.checked });
  $('models').disabled = !e.target.checked;
  say(e.target.checked ? 'options.descOn' : 'options.descOff');
});

for (const radio of document.querySelectorAll('input[name="model"]')) {
  radio.addEventListener('change', async (e) => {
    await saveSettings({ semanticModel: e.target.value });
    say('options.modelChanged');
  });
}

$('delete-model').addEventListener('click', async () => {
  await caches.delete(MODEL_CACHE);
  say('options.deleted');
  refreshModelStatus();
});

(async () => {
  const settings = await getSettings();
  lang = resolveLanguage(settings.language, chrome.i18n.getUILanguage());
  $('language').value = settings.language || 'auto';
  $('semantic').checked = settings.semantic !== false;
  $('models').disabled = settings.semantic === false;
  const model = settings.semanticModel === 'multilingual' ? 'multilingual' : 'english';
  document.querySelector(`input[name="model"][value="${model}"]`).checked = true;
  render();
})();
